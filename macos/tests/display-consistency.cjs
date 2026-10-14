'use strict';
// Avoid a second browser autoattach controller: application startup owns its targets.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {CdpSocket} = require('../src/main/cdp-socket');
const {startConsistencyOrigin} = require('./display-consistency-fixture.cjs');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'star-display-consistency-'));
const results = [], scopes = ['page', 'sameOrigin', 'crossOrigin', 'srcdoc', 'nested', 'aboutBlank'];
let origin, app, manager, control, profile, parallel, pg, reference, error;
async function until(read, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Display consistency timeout\n' + (app?.stderr || control?.stderr || '').slice(-1500));
}
async function evaluate(connection, sessionId, expression) {
  let value;
  try { value = await connection.pipe.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, timeout: 15000}, sessionId, 18000); }
  catch (failure) { throw new Error(failure.message + ' [' + expression.slice(0, 120) + ']\n' + connection.stderr.slice(-1800)); }
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result?.value;
}
async function api(method, ...args) { return evaluate(app, manager, 'window.api[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + ')'); }
async function launch(args, directory, managed) {
  fs.rmSync(path.join(directory, 'DevToolsActivePort'), {force:true});
  const state = {stderr: '', child: spawn(require('electron'), args, {cwd: root,
    env: {...process.env, ELECTRON_RUN_AS_NODE: '', ...(managed ? {TFB_TEST_MODE: '1', TFB_USER_DATA_DIR: directory, TFB_TEST_ORIGIN_PORT: String(origin.port)} : {})},
    stdio: ['ignore', 'ignore', 'pipe']})};
  state.child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-6000); });
  try {
    const endpoint = await until(() => {
      if (state.child.exitCode !== null) throw new Error('Electron exited: ' + state.stderr);
      try { const lines = fs.readFileSync(path.join(directory, 'DevToolsActivePort'), 'utf8').split('\n'); return 'ws://127.0.0.1:' + lines[0] + lines[1]; } catch { return null; }
    });
    state.pipe = new CdpSocket(endpoint); await state.pipe.ready; return state;
  } catch (failure) { await close(state); throw failure; }
}
async function close(connection) {
  if (!connection) return;
  await connection.pipe?.send('Browser.close').catch(() => {}); connection.pipe?.close();
  await until(() => connection.child.exitCode !== null || connection.child.signalCode !== null, 6000).catch(async () => {connection.child.kill();await until(() => connection.child.exitCode !== null || connection.child.signalCode !== null,3000).catch(()=>{});});
}
async function start() {
  app = await launch(['.'], data, true);
  const info = await until(async () => (await app.pipe.send('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url.endsWith('/index.html')));
  manager = (await app.pipe.send('Target.attachToTarget', {targetId: info.targetId, flatten: true})).sessionId;
  await until(() => evaluate(app, manager, 'typeof window.api?.create === "function"'));
}
async function page(marker) {
  let attached;
  return until(async () => {
    const info = (await app.pipe.send('Target.getTargets')).targetInfos.find(target => target.type === 'webview' && target.url.includes('&display=' + marker));
    if (!info) return null;
    try {
      if (!attached || attached.info.targetId !== info.targetId) attached = {info, sessionId: (await app.pipe.send('Target.attachToTarget', {targetId: info.targetId, flatten: true})).sessionId};
      const state = await evaluate(app, attached.sessionId, '({ready:window.__displayReady,error:window.__displayError})');
      if (state?.error) throw new Error(state.error);
      return state?.ready && attached;
    } catch (failure) {
      if (!/Session with given id not found|No target with given id|Cannot find context|Execution context was destroyed/.test(failure.message)) throw failure;
      attached = null; return null;
    }
  }, 25000);
}
async function ready(connection, sessionId) {
  await until(async () => {
    const state = await evaluate(connection, sessionId, '({ready:window.__displayReady,error:window.__displayError})');
    if (state?.error) throw new Error(state.error); return state?.ready;
  });
}
async function shell(page) {
  return (await app.pipe.send('Target.attachToTarget', {targetId: page.info.parentId, flatten: true})).sessionId;
}
function verify(values, dpr, {first = true, events = false} = {}) {
  assert.deepEqual(Object.keys(values).sort(), [...scopes].sort());
  for (const [scope, entry] of Object.entries(values)) {
    for (const [phase, sample] of [['now', entry.now], ...(first ? [['first', entry.first]] : [])]) {
      const label = scope + ' ' + phase;
      if (phase === 'now') assert.deepEqual(sample.screen, reference.screen, label + ' independently measured current display');
      else {
        for (const key of ['width','height','colorDepth','pixelDepth']) assert.equal(sample.screen[key], reference.initialScreen[key], label + ' native ' + key);
        // The OS work area can change between document creation and later checks.
        assert.ok(sample.screen.availWidth > 0 && sample.screen.availWidth <= sample.screen.width);
        assert.ok(sample.screen.availHeight > 0 && sample.screen.availHeight <= sample.screen.height);
      }
      assert.ok(Math.abs(sample.dpr - (phase === 'first' ? reference.dpr : dpr)) < 0.000001, label + ' DPR: ' + sample.dpr + ' vs ' + dpr);
      assert.equal(sample.identity, true, label + ' original getter identity');
      assert.deepEqual(sample.descriptors, reference.control[scope].now.descriptors, label + ' native screen getter semantics');
      assert.deepEqual(sample.dprGetter, reference.control[scope].now.dprGetter, label + ' native DPR getter semantics');
      assert.deepEqual(sample.layout, {width: 120, height: 30}, label + ' CSS pixel geometry');
      for (const query of sample.queries) {
        assert.equal(query.matches, query.expected, label + ' matchMedia ' + query.media);
        assert.equal(query.computed, query.expected, label + ' actual @media style ' + query.media);
      }
    }
    if (events) for (const kind of ['standard', 'legacy']) for (const [name, matches] of [['old', false], ['new', true]]) {
      assert.ok(entry.events.some(event => event.kind === kind && event.name === name && event.matches === matches && event.target && event.eventType === 'change' && Math.abs(event.dpr - dpr) < 0.000001), scope + ' missing native ' + kind + ' ' + name + ' resolution change');
    }
  }
  return values;
}
async function measure(page = pg, dpr = reference.dpr, options) {
  const readNative = () => evaluate(control, reference.sessionId, '({width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,colorDepth:screen.colorDepth,pixelDepth:screen.pixelDepth})');
  const before = await readNative();
  const values = await evaluate(app, page.sessionId, 'window.__displayReadAll(' + dpr + ')');
  const after = await readNative();
  const observed = values.page.now.screen;
  const confirmed = [before,after].find(snapshot => JSON.stringify(snapshot) === JSON.stringify(observed));
  assert.ok(confirmed, 'Current display must match an independent native process before or after the measurement');
  reference.screen = confirmed;
  return verify(values, dpr, options);
}
async function check(name, run) {
  const start = Date.now();
  try { const detail = await run(); results.push({name, status: 'passed', durationMs: Date.now() - start, detail}); console.log('PASS', name); }
  catch (failure) { results.push({name, status: 'failed', error: failure.stack}); throw failure; }
}
(async () => {
  try {
    origin = await startConsistencyOrigin();
    await check('独立原生 Electron 对照无预加载和指纹注入，实测显示器与 CSS', async () => {
      const directory = path.join(data, 'control'); fs.mkdirSync(directory);
      const main = path.join(directory, 'main.cjs');
      fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(directory)});app.commandLine.appendSwitch('remote-debugging-port','0');let win;app.whenReady().then(()=>{win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());`);
      control = await launch([main], directory, false);
      const info = await until(async () => (await control.pipe.send('Target.getTargets')).targetInfos.find(target => target.type === 'page'));
      const sessionId = (await control.pipe.send('Target.attachToTarget', {targetId: info.targetId, flatten: true})).sessionId;
      reference = await evaluate(control, sessionId, '({screen:Object.fromEntries(["width","height","availWidth","availHeight","colorDepth","pixelDepth"].map(key=>[key,screen[key]])),dpr:devicePixelRatio})');
      await control.pipe.send('Page.navigate', {url: origin.pageUrl(reference, 'control')}, sessionId);
      await ready(control, sessionId);
      reference.initialScreen = {...reference.screen}; reference.sessionId = sessionId;
      reference.control = await evaluate(control, sessionId, 'window.__displayReadAll(' + reference.dpr + ')');
      verify(reference.control, reference.dpr);
      const targets = (await control.pipe.send('Target.getTargets')).targetInfos;
      assert.ok(targets.some(target => target.type === 'iframe' && target.url.startsWith('http://127.0.0.1:')), 'Independent control must use a real OOPIF');
      const detail = {screen: reference.screen, dpr: reference.dpr, version: await control.pipe.send('Browser.getVersion'), noInjection: true, values: reference.control};
      return detail;
    });
    await start();
    profile = await api('create', {name: '原生 DPR/CSS 严格验收', os: process.platform === 'win32' ? 'win' : 'mac', country: 'FR',
      language: 'fr-FR', langManual: true, timezone: 'Europe/Paris', timezoneManual: true, restoreSession: false,
      startUrl: origin.pageUrl({screen: reference.screen, dpr: reference.dpr}, 'primary'),
      fingerprint: {displayMode: 'native', devicePixelRatio: 1.5, screen: {width: 1600, height: 900}}});
    await api('browse', profile.id); pg = await page('primary');
    await check('首段脚本、同源、真正 OOPIF、srcdoc、嵌套及同步 about:blank 的 DPR/CSS', async () => {
      const values = await measure();
      const targets = (await app.pipe.send('Target.getTargets')).targetInfos;
      const frames = targets.filter(target => target.type === 'iframe' && target.url.startsWith('http://127.0.0.1:') && target.parentId === pg.info.targetId);
      assert.ok(frames.length, 'Application must keep a real out-of-process cross-origin frame');
      const saved = (await api('list')).find(item => item.id === profile.id);
      assert.equal(saved.fingerprint.displayMode, 'native'); assert.equal(saved.fingerprint.devicePixelRatio, 1.5); assert.equal(saved.fingerprint.screen.width, 1600);
      return {oopifs: frames.map(frame => ({id: frame.targetId, parentId: frame.parentId, url: frame.url})), values, customValuesPreserved: true};
    });
    await check('页面缩放更新全部框架的 DPR、真实 CSS 与标准/旧式 change 事件', async () => {
      const session = await shell(pg), from = reference.dpr, to = reference.dpr * 1.25;
      const armed = await evaluate(app, pg.sessionId, `window.__displayWatchAll(${from},${to})`);
      for (const value of Object.values(armed)) assert.deepEqual(value, [true, false]);
      await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.setZoomFactor(1.25)`);
      await until(async () => { const value = await evaluate(app, pg.sessionId, `window.__displayReadAll(${to})`); return Object.values(value).every(entry => entry.events.length >= 4) && value; });
      const zoomed = await measure(pg, to, {events: true});
      const resetArmed = await evaluate(app, pg.sessionId, `window.__displayWatchAll(${to},${from})`);
      for (const value of Object.values(resetArmed)) assert.deepEqual(value, [true, false]);
      await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.setZoomFactor(1)`);
      await until(async () => { const value = await evaluate(app, pg.sessionId, `window.__displayReadAll(${from})`); return Object.values(value).every(entry => entry.events.length >= 4) && value; });
      return {zoomed, reset: await measure(pg, from, {events: true})};
    });
    await check('重载与跨站导航的首段脚本使用同一原生显示参数', async () => {
      await evaluate(app, pg.sessionId, 'window.__displayReady=false');
      await app.pipe.send('Page.reload', {ignoreCache: true}, pg.sessionId);
      pg = await page('primary'); const reload = await measure();
      const crossUrl = origin.pageUrl({screen: reference.screen, dpr: reference.dpr}, 'primary').replace('localhost', '127.0.0.1');
      await evaluate(app, pg.sessionId, 'window.__displayReady=false');
      await app.pipe.send('Page.navigate', {url: crossUrl}, pg.sessionId); pg = await page('primary');
      const cross = await measure();
      await evaluate(app, pg.sessionId, 'window.__displayReady=false');
      await app.pipe.send('Page.navigate', {url: profile.startUrl}, pg.sessionId); pg = await page('primary');
      return {reload, cross, returned: await measure()};
    });
    await check('DevTools 打开、重载和关闭后保持原生 DPR/CSS', async () => {
      const session = await shell(pg);
      const guest = await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.getWebContentsId()`);
      await evaluate(app, session, `window.api.guestDevTools(${guest})`);
      await until(() => evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.isDevToolsOpened()`));
      const opened = await measure();
      await evaluate(app, pg.sessionId, 'window.__displayReady=false');
      await app.pipe.send('Page.reload', {ignoreCache: true}, pg.sessionId); pg = await page('primary'); const reloaded = await measure();
      const currentGuest = await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.getWebContentsId()`);
      if (await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.isDevToolsOpened()`)) await evaluate(app, session, `window.api.guestDevTools(${currentGuest})`);
      assert.equal(await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).web.isDevToolsOpened()`),false);
      return {guestBefore:guest,guestAfter:currentGuest,opened,reloaded,closed:await measure()};
    });
    await check('两个环境并行使用原生显示，语言/时区和页面缩放各自独立', async () => {
      parallel = await api('create', {name: '独立显示环境', os: process.platform === 'win32' ? 'win' : 'mac', country: 'JP',
        language: 'ja-JP', langManual: true, timezone: 'Asia/Tokyo', timezoneManual: true, restoreSession: false,
        startUrl: origin.pageUrl({screen: reference.screen, dpr: reference.dpr}, 'parallel')});
      assert.equal((await api('preview', parallel.id)).displayMode, 'native');
      await api('browse', parallel.id); const other = await page('parallel');
      const primary = await measure(), secondary = await measure(other);
      for (const entry of Object.values(primary)) { assert.equal(entry.now.language, 'fr-FR'); assert.equal(entry.now.timezone, 'Europe/Paris'); }
      for (const entry of Object.values(secondary)) { assert.equal(entry.now.language, 'ja-JP'); assert.equal(entry.now.timezone, 'Asia/Tokyo'); }
      const session = await shell(other);
      await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=parallel')).web.setZoomFactor(1.25)`);
      await until(async () => Math.abs((await evaluate(app, other.sessionId, 'devicePixelRatio')) - reference.dpr * 1.25) < 0.000001);
      const zoomed = await measure(other, reference.dpr * 1.25);
      await measure();
      await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=parallel')).web.setZoomFactor(1)`);
      return {primary, secondary, zoomed, primaryUnaffected: true};
    });
    await check('标签休眠唤醒、环境关闭重开和完整应用重启后显示仍一致', async () => {
      const session = await shell(pg);
      const firstTab = await evaluate(app, session, `tabs.find(t=>t.url.includes('&display=primary')).id`);
      const secondTab = await evaluate(app, session, `createTab(${JSON.stringify(origin.pageUrl({screen: reference.screen, dpr: reference.dpr}, 'background'))})`);
      await page('background');
      await evaluate(app, session, `StarTabs.sleep(${JSON.stringify(firstTab)})`);
      assert.equal(await evaluate(app, session, `tabs.find(t=>t.id===${JSON.stringify(firstTab)}).sleeping`), true);
      await evaluate(app, session, `activateTab(${JSON.stringify(firstTab)})`); pg = await page('primary'); const wake = await measure();
      await evaluate(app, session, `closeTab(${JSON.stringify(secondTab)})`);
      await api('action', 'stop', [parallel.id]); await api('action', 'stop', [profile.id]);
      await api('browse', profile.id); pg = await page('primary'); const reopen = await measure();
      await close(app); app = null; await start();
      await api('browse', profile.id); pg = await page('primary');
      return {wake, reopen, restart: await measure()};
    });
    await check('工作台诊断实际读取跨进程框架的显示与 CSS', async () => {
      const audit = await api('fingerprintAudit', profile.id);
      assert.equal(audit.differences, 0, JSON.stringify(audit.rows.filter(row => row.state === 'different')));
      assert.deepEqual(audit.targetErrors, []);
      assert.ok(audit.contexts.some(item => item.type === 'iframe' && item.status === 'read'));
      return audit;
    });
    await check('CSP 阻止诊断样式时明确未读取，JS 查询一致不冒充 CSS 已通过', async () => {
      await evaluate(app, pg.sessionId, 'window.__displayReady=false');
      await app.pipe.send('Page.navigate', {url:profile.startUrl.replace('/page?','/blocked?')}, pg.sessionId);
      pg=await page('primary');
      const audit=await api('fingerprintAudit',profile.id);
      for(const label of ['屏幕 @media 样式','像素比 @media 样式'])assert.equal(audit.rows.find(row=>row.context==='CSS'&&row.label===label).state,'unknown');
      for(const label of ['屏幕媒体查询','像素比媒体查询'])assert.equal(audit.rows.find(row=>row.context==='CSS'&&row.label===label).state,'match');
      assert.ok(audit.unknown>=2);return audit;
    });
  } catch (failure) { error = failure.stack; console.error(failure); process.exitCode = 1; }
  finally {
    await close(app); await close(control); await origin?.close();
    fs.mkdirSync(path.join(root, 'test-results'), {recursive: true});
    fs.writeFileSync(path.join(root, 'test-results/display-consistency.json'), JSON.stringify({testedAt: new Date().toISOString(),
      status: error ? 'failed' : 'passed', platform: process.platform, mode: 'native', siteIsolation: 'enabled',
      physicalMultiMonitor: 'not-tested', systemSuspend: 'not-tested', error, results}, null, 2));
    fs.rmSync(data, {recursive: true, force: true, maxRetries:10, retryDelay:100});
  }
})();
