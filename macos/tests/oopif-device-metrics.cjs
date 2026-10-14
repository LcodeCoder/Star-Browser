'use strict';
// Fixture scripts only measure native behavior and record clicks. No browser
// API replacement, preload, extension, or CDP script injection is permitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {PNG} = require('playwright-core/lib/utilsBundle');
const {NativeBrowser} = require('./native-browser.cjs');
const {findChrome} = require('../src/main/launcher');
const {browserArtifact} = require('../src/main/native-kernel');
const lock = require('../../kernel/chromium.lock.json');
const A = {width:1600, height:900, dpr:1.5};
const B = {width:1800, height:1000, dpr:1.25};
const SCOPES = ['page', 'sameOrigin', 'crossOrigin', 'nestedCrossOrigin', 'srcdoc', 'aboutBlank'];
const CONTROLS = ['control.native-main-frame', 'control.true-oopif-mismatch',
  'control.native-pixels-and-input', 'control.target-association'];
const CANDIDATE = ['candidate.source-and-bundle', 'candidate.first-script-and-css',
  'candidate.pixels-and-input', 'candidate.independent-tabs', 'candidate.manual-window-resize',
  'candidate.resize-pixels-and-input', 'candidate.dynamic-existing-oopif',
  'candidate.dynamic-pixels-and-input', 'candidate.clear-existing-oopif',
  'candidate.clear-pixels-and-input', 'candidate.navigate-new-process',
  'candidate.navigate-pixels-and-input', 'candidate.restart-first-script-and-css',
  'candidate.restart-pixels-and-input', 'candidate.no-api-injection'];
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function measurement(expected) {
  const rawDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio').get;
  const rawWidth = Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get;
  const native = f => /\[native code\]/.test(Function.prototype.toString.call(f));
  const box = document.querySelector('#pixelTarget').getBoundingClientRect();
  const style = getComputedStyle(document.documentElement);
  return {screen:{width:rawWidth.call(screen), height:screen.height}, dpr:rawDpr.call(window),
    nativeGetters:native(rawDpr) && native(rawWidth),
    css:{width:matchMedia('(device-width:' + expected.width + 'px)').matches,
      height:matchMedia('(device-height:' + expected.height + 'px)').matches,
      resolution:matchMedia('(resolution:' + expected.dpr + 'dppx)').matches,
      computedWidth:style.getPropertyValue('--screen-' + expected.width).trim() === '1',
      computedHeight:style.getPropertyValue('--height-' + expected.height).trim() === '1',
      computedResolution:style.getPropertyValue('--dpr-' + String(expected.dpr).replaceAll('.', '-')).trim() === '1'},
    viewport:{width:innerWidth, height:innerHeight},
    box:{x:box.x, y:box.y, width:box.width, height:box.height},
    clicks:window.__clicks || 0, mediaChanges:window.__mediaChanges || 0};
}
const readSource = '(' + measurement.toString() + ')';

async function until(run, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await run();
    if (value) return value;
    await delay(50);
  }
  throw new Error('Native OOPIF measurement timed out');
}
function metrics(value) {
  // Preserve manual window sizing while changing native web screen metrics.
  return {width:0, height:0, mobile:false, deviceScaleFactor:value.dpr,
    screenWidth:value.width, screenHeight:value.height, dontSetVisibleSize:true};
}
function matches(value, expected, label) {
  assert.deepEqual(value.screen, {width:expected.width, height:expected.height}, label + ' screen');
  assert.equal(value.dpr, expected.dpr, label + ' native DPR');
  assert.equal(value.nativeGetters, true, label + ' native getters');
  for (const [key, matched] of Object.entries(value.css)) assert.equal(matched, true, label + ' CSS ' + key);
  assert.equal(value.box.width, 120, label + ' CSS box width');
  assert.equal(value.box.height, 30, label + ' CSS box height');
}
function allMatch(values, expected, first = true) {
  for (const scope of SCOPES) {
    if (first) matches(values[scope].first, expected, scope + ' first script');
    matches(values[scope].current, expected, scope + ' current');
  }
}

async function startFixture() {
  let port;
  function page(kind, expected, baseline, instance) {
    const rules = new Set();
    for (const value of [A, B, baseline]) {
      rules.add('@media(device-width:' + value.width + 'px){html{--screen-' + value.width + ':1}}');
      rules.add('@media(device-height:' + value.height + 'px){html{--height-' + value.height + ':1}}');
      rules.add('@media(resolution:' + value.dpr + 'dppx){html{--dpr-' + String(value.dpr).replaceAll('.', '-') + ':1}}');
    }
    const css = 'html{margin:0;background:white}body{margin:0}' +
      '#pixelTarget{position:absolute;left:20px;top:20px;width:120px;height:30px;border:0;padding:0;background:rgb(37,157,111)}' +
      'iframe{border:0;position:absolute;width:300px;height:180px;left:180px;top:80px}' + [...rules].join('');
    const query = new URLSearchParams({...expected, nativeWidth:baseline.width,
      nativeHeight:baseline.height, nativeDpr:baseline.dpr, instance});
    const script = `window.__clicks=0;window.__mediaChanges=0;document.querySelector('#pixelTarget').onclick=()=>window.__clicks++;window.__read=${readSource};window.__first=window.__read(${json(expected)});for(const q of ['(device-width:1600px)','(device-width:1800px)','(resolution:1.5dppx)','(resolution:1.25dppx)'])matchMedia(q).addEventListener('change',()=>window.__mediaChanges++);`;
    const prefix = '<!doctype html><meta charset="utf-8"><style>' + css +
      '</style><button id="pixelTarget" aria-label="Native input target"></button><script>' + script;
    if (kind === 'nested' || kind === 'frame') return prefix + '</script>';
    if (kind === 'cross') return prefix + `const nested=document.createElement('iframe');nested.id='nested';nested.style.cssText='left:20px;top:70px;width:200px;height:100px;border:0';nested.src=${json('http://nested.star.test:' + port + '/nested?' + query)};document.body.append(nested);` + '</script>';
    const same = 'http://localhost:' + port + '/frame?' + query;
    const cross = 'http://127.0.0.1:' + port + '/cross?' + query;
    const srcdoc = page('frame', expected, baseline, instance);
    return prefix + `
      window.__ready=false;
      async function createFrame(id,url,html,top){const f=document.createElement('iframe');f.id=id;f.style.top=top+'px';const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(id+' load timeout')),15000);f.onload=()=>{clearTimeout(timer);resolve()}});if(html)f.srcdoc=html;else f.src=url;document.body.append(f);await loaded;}
      (async()=>{await createFrame('same',${json(same)},null,80);await createFrame('cross',${json(cross)},null,300);await createFrame('srcdoc',null,${json(srcdoc)},520);const blank=document.createElement('iframe');blank.id='blank';blank.style.top='520px';blank.style.left='500px';document.body.append(blank);blank.contentDocument.write(${json(srcdoc)});blank.contentDocument.close();window.__ready=true;})().catch(e=>window.__error=e.stack);
    ` + '</script>';
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const number = (key, fallback) => Number(url.searchParams.get(key)) || fallback;
    const expected = {width:number('width', A.width), height:number('height', A.height), dpr:number('dpr', A.dpr)};
    const baseline = {width:number('nativeWidth', A.width), height:number('nativeHeight', A.height), dpr:number('nativeDpr', A.dpr)};
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(page(url.pathname.slice(1) || 'root', expected, baseline, url.searchParams.get('instance')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  return {url:(expected, pg) => 'http://localhost:' + port + '/root?' +
    new URLSearchParams({...expected, instance:pg.targetId, nativeWidth:pg.baseline.width,
      nativeHeight:pg.baseline.height, nativeDpr:pg.baseline.dpr}),
    close:() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();})};
}
async function evaluate(browser, sessionId, expression) {
  const result = await browser.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true}, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Native evaluation failed');
  return result.result?.value;
}
async function navigate(browser, fixture, pg, expected, suffix = '') {
  const navigation = await browser.send('Page.navigate', {url:fixture.url(expected, pg) + suffix}, pg.sessionId);
  assert.ok(!navigation.errorText, navigation.errorText);
  await until(async () => {
    const state = await evaluate(browser, pg.sessionId, '({ready:window.__ready,error:window.__error})');
    if (state?.error) throw new Error(state.error);
    return state?.ready;
  });
}
async function createPage(browser, fixture, expected) {
  const {targetId} = await browser.send('Target.createTarget', {url:'about:blank', width:1000, height:850, newWindow:true});
  const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten:true});
  const pg = {targetId, sessionId};
  await browser.send('Page.enable', {}, sessionId);
  pg.baseline = await evaluate(browser, sessionId, '({width:screen.width,height:screen.height,dpr:devicePixelRatio})');
  await browser.send('Emulation.setDeviceMetricsOverride', metrics(expected), sessionId);
  await navigate(browser, fixture, pg, expected);
  return pg;
}
async function contexts(browser, pg, expected) {
  const targets = (await browser.send('Target.getTargets')).targetInfos;
  const belongs = (target, pathname) => {
    if (target.type !== 'iframe' || !target.url) return false;
    const url = new URL(target.url);
    return url.pathname === pathname && url.searchParams.get('instance') === pg.targetId;
  };
  const cross = targets.filter(t => belongs(t, '/cross'));
  const nested = targets.filter(t => belongs(t, '/nested'));
  assert.equal(cross.length, 1, 'Exactly one real cross-process iframe must belong to this page');
  assert.equal(nested.length, 1, 'Exactly one nested cross-process iframe must belong to this page');
  const attach = async target => (await browser.send('Target.attachToTarget', {targetId:target.targetId, flatten:true})).sessionId;
  const crossSession = await attach(cross[0]), nestedSession = await attach(nested[0]);
  // Validate the parent/child relationship through Chromium's own frame trees.
  const rootTree = await browser.send('Page.getFrameTree', {}, pg.sessionId);
  const childTree = await browser.send('Page.getFrameTree', {}, crossSession);
  const nestedTree = await browser.send('Page.getFrameTree', {}, nestedSession);
  assert.equal(childTree.frameTree.frame.parentId, rootTree.frameTree.frame.id, 'OOPIF is a child of this page');
  assert.equal(nestedTree.frameTree.frame.parentId, childTree.frameTree.frame.id, 'Nested OOPIF is a child of this OOPIF');
  const expression = w => `({first:${w}.__first,current:${w}.__read(${json(expected)})})`;
  const local = await evaluate(browser, pg.sessionId, `({page:${expression('window')},sameOrigin:${expression("document.querySelector('#same').contentWindow")},srcdoc:${expression("document.querySelector('#srcdoc').contentWindow")},aboutBlank:${expression("document.querySelector('#blank').contentWindow")}})`);
  local.crossOrigin = await evaluate(browser, crossSession, expression('window'));
  local.nestedCrossOrigin = await evaluate(browser, nestedSession, expression('window'));
  return {values:local, crossSession, nestedSession, targets:[cross[0].targetId, nested[0].targetId]};
}

async function pixelsAndInput(browser, pg, ctx, label, output) {
  await browser.send('Target.activateTarget', {targetId:pg.targetId});
  await until(() => evaluate(browser, pg.sessionId, 'document.hasFocus()'));
  const geometry = await evaluate(browser, pg.sessionId, `(()=>{const f=document.querySelector('#cross').getBoundingClientRect();return {frame:{x:f.x,y:f.y},viewport:{width:innerWidth,height:innerHeight}}})()`);
  const inner = await evaluate(browser, ctx.crossSession, `(()=>{const f=document.querySelector('#nested').getBoundingClientRect();return {x:f.x,y:f.y}})()`);
  const captured = await browser.send('Page.captureScreenshot', {format:'png', fromSurface:true}, pg.sessionId);
  const buffer = Buffer.from(captured.data, 'base64');
  fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output, buffer);
  const image = PNG.sync.read(buffer), scale = image.width / geometry.viewport.width;
  assert.ok(Math.abs(scale - ctx.values.page.current.dpr) < 0.01, label + ' screenshot scale');
  const top = ctx.values.page.current.box;
  // macOS color management converts sRGB green. Compare child surfaces to the
  // actual captured main-frame color instead of assuming an output profile.
  const center = (Math.round((top.y + top.height / 2) * scale) * image.width + Math.round((top.x + top.width / 2) * scale)) * 4;
  const color = Array.from(image.data.subarray(center, center + 3));
  assert.ok(color[1] > color[0] + 20 && color[1] > color[2] + 15, label + ' painted target');
  function span(box, offset, vertical = false) {
    const origin = (vertical ? offset.y + box.y : offset.x + box.x) * scale;
    const size = (vertical ? box.height : box.width) * scale;
    const fixed = Math.round((vertical ? offset.x + box.x + box.width / 2 : offset.y + box.y + box.height / 2) * scale);
    const limit = vertical ? image.height : image.width;
    let first = Infinity, last = -1;
    for (let n = Math.max(0, Math.floor(origin - 10 * scale)); n <= Math.min(limit - 1, Math.ceil(origin + size + 30 * scale)); n++) {
      const pixel = (vertical ? n * image.width + fixed : fixed * image.width + n) * 4;
      if (color.every((value, i) => Math.abs(image.data[pixel + i] - value) <= 8)) {first = Math.min(first, n); last = Math.max(last, n);}
    }
    assert.ok(last >= first, label + ' visible target');
    return last - first + 1;
  }
  const topPixels = {width:span(top, {x:0,y:0}), height:span(top, {x:0,y:0}, true)};
  assert.ok(Math.abs(topPixels.width - 120 * scale) <= 2, label + ' main physical width');
  assert.ok(Math.abs(topPixels.height - 30 * scale) <= 2, label + ' main physical height');
  const surfaces = [];
  for (const [scope, session, offset] of [
    ['crossOrigin', ctx.crossSession, geometry.frame],
    ['nestedCrossOrigin', ctx.nestedSession, {x:geometry.frame.x + inner.x, y:geometry.frame.y + inner.y}],
  ]) {
    const box = ctx.values[scope].current.box;
    const pixels = {width:span(box, offset), height:span(box, offset, true)};
    for (const axis of ['width','height']) assert.ok(Math.abs(topPixels[axis] - pixels[axis]) <= 2, label + ' ' + scope + ' pixel ' + axis);
    const before = await evaluate(browser, session, 'window.__clicks');
    const x = offset.x + box.x + box.width / 2, y = offset.y + box.y + box.height / 2;
    for (const type of ['mouseMoved','mousePressed','mouseReleased']) await browser.send('Input.dispatchMouseEvent',
      {type, x, y, ...(type === 'mouseMoved' ? {} : {button:'left', clickCount:1})}, pg.sessionId);
    await until(async () => (await evaluate(browser, session, 'window.__clicks')) === before + 1);
    surfaces.push({scope, pixels, clickedAt:{x,y}});
  }
  return {screenshot:output, topPixels, surfaces, scale};
}
function options() {
  const opts = {stock:findChrome(), controlsOnly:false, output:path.resolve('test-results/oopif-device-metrics.json')};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--controls-only') opts.controlsOnly = true;
    else if (['--stock','--executable','--output'].includes(key) && args[i+1]) opts[key.slice(2)] = path.resolve(args[++i]);
    else throw new Error('Usage: oopif-device-metrics.cjs [--controls-only] [--stock Chrome] [--executable Chromium] [--output report.json]');
  }
  if (!opts.stock) throw new Error('Stock Chrome is required');
  if (!opts.executable) opts.controlsOnly = true;
  return opts;
}

(async () => {
  const checks = [], browsers = []; let opts, fixture, root;
  const report = {schemaVersion:1, abi:'star-oopif-v1', scope:[...lock.preparedOopifScope],
    siteIsolation:'enabled', p0Complete:false, oopifPropagationRuntimeAccepted:false, checks};
  async function check(id, run) {
    try {const detail = await run(); checks.push({id,status:'passed',detail}); console.log('PASS', id);}
    catch (error) {checks.push({id,status:'failed',error:error.stack}); console.error('FAIL', id, error.message);}
  }
  function launch(executable, name) {
    const browser = new NativeBrowser(executable, path.join(root, name),
      ['--site-per-process','--no-proxy-server','--host-resolver-rules=MAP nested.star.test 127.0.0.1']);
    browsers.push(browser); return browser;
  }
  const requiredPass = ids => ids.every(id => checks.filter(c => c.id === id && c.status === 'passed').length === 1);
  const imagePath = label => opts.output.replace(/\.json$/, '') + '.' + label + '.png';
  try {
    opts = options(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'star-native-oopif-')); fixture = await startFixture();
    const stock = launch(opts.stock, 'stock'), control = await createPage(stock, fixture, A);
    const controlContexts = await contexts(stock, control, A);
    await check('control.native-main-frame', () => {matches(controlContexts.values.page.first,A,'Stock first'); matches(controlContexts.values.page.current,A,'Stock current'); return controlContexts.values.page;});
    await check('control.true-oopif-mismatch', () => {
      const values = ['crossOrigin','nestedCrossOrigin'].map(scope => controlContexts.values[scope].first);
      assert.ok(values.every(v => v.nativeGetters));
      assert.ok(values.some(v => v.screen.width !== A.width || v.screen.height !== A.height || v.dpr !== A.dpr || !v.css.computedResolution), 'Unmodified Chrome must expose the OOPIF mismatch');
      return {targets:controlContexts.targets, first:values};
    });
    await check('control.native-pixels-and-input', () => pixelsAndInput(stock,control,controlContexts,'stock',imagePath('stock')));
    await check('control.target-association', async () => {
      const other = await createPage(stock,fixture,A), otherCtx = await contexts(stock,other,A);
      assert.ok(otherCtx.targets.every(id => !controlContexts.targets.includes(id)));
      assert.equal(otherCtx.values.crossOrigin.current.clicks,0);
      const previous = await contexts(stock,control,A);
      assert.deepEqual(previous.targets,controlContexts.targets);
      assert.equal(previous.values.crossOrigin.current.clicks,1);
      return {first:previous.targets,second:otherCtx.targets};
    });
    await stock.close();
    if (!opts.controlsOnly) {
      const browser = launch(opts.executable, 'candidate');
      const version = await browser.send('Browser.getVersion');
      const revision = version.revision?.replace(/^@/, '');
      await check('candidate.source-and-bundle', async () => {
        assert.equal(version.product.split('/').at(-1),lock.version); assert.equal(revision,lock.commit);
        report.binary = {...await browserArtifact(opts.executable), platform:process.platform, arch:process.arch,
          version:lock.version, sourceCommit:revision};
        return {version:version.product, sourceCommit:revision};
      });
      const first = await createPage(browser,fixture,A); let firstCtx = await contexts(browser,first,A);
      await check('candidate.first-script-and-css', () => {allMatch(firstCtx.values,A); return firstCtx.values;});
      await check('candidate.pixels-and-input', () => pixelsAndInput(browser,first,firstCtx,'candidate',imagePath('candidate')));
      const second = await createPage(browser,fixture,B);
      await check('candidate.independent-tabs', async () => {
        const secondCtx = await contexts(browser,second,B); allMatch(secondCtx.values,B);
        firstCtx = await contexts(browser,first,A); allMatch(firstCtx.values,A);
        assert.ok(secondCtx.targets.every(id => !firstCtx.targets.includes(id))); return {first:A,second:B};
      });
      await check('candidate.manual-window-resize', async () => {
        const {windowId,bounds} = await browser.send('Browser.getWindowForTarget',{targetId:first.targetId});
        const before = await evaluate(browser,first.sessionId,'innerWidth');
        await browser.send('Browser.setWindowBounds',{windowId,bounds:{width:Math.max(650,bounds.width - 90)}});
        await until(async () => (await evaluate(browser,first.sessionId,'innerWidth')) !== before);
        firstCtx = await contexts(browser,first,A); allMatch(firstCtx.values,A);
        return {before,after:firstCtx.values.page.current.viewport.width};
      });
      await check('candidate.resize-pixels-and-input', () => pixelsAndInput(browser,first,firstCtx,'resize',imagePath('resize')));
      await check('candidate.dynamic-existing-oopif', async () => {
        const old = [...firstCtx.targets];
        await browser.send('Emulation.setDeviceMetricsOverride',metrics(B),first.sessionId);
        try {
          await until(async () => {const v=await evaluate(browser,firstCtx.nestedSession,'window.__read(' + json(B) + ')'); return v?.dpr===B.dpr && v.screen.width===B.width && v.css.computedResolution && v.mediaChanges>0;});
        } finally {
          // Pixel/input checks still measure the current surfaces if native
          // web metrics fail, so stale samples do not create geometry failures.
          firstCtx = await contexts(browser,first,B);
        }
        allMatch(firstCtx.values,B,false);
        assert.deepEqual(firstCtx.targets,old,'Existing OOPIF targets must update without navigation');
        assert.ok(firstCtx.values.crossOrigin.current.mediaChanges>0); return firstCtx.values;
      });
      await check('candidate.dynamic-pixels-and-input', () => pixelsAndInput(browser,first,firstCtx,'dynamic',imagePath('dynamic')));
      await check('candidate.clear-existing-oopif', async () => {
        await browser.send('Emulation.clearDeviceMetricsOverride',{},first.sessionId);
        await until(async () => {const top=await evaluate(browser,first.sessionId,'window.__read(' + json(first.baseline) + ')'), child=await evaluate(browser,firstCtx.nestedSession,'window.__read(' + json(first.baseline) + ')'); return top?.dpr===first.baseline.dpr && child?.dpr===first.baseline.dpr && top.screen.width===first.baseline.width && child.screen.width===first.baseline.width && child.css.computedResolution;});
        firstCtx = await contexts(browser,first,first.baseline); allMatch(firstCtx.values,first.baseline,false);
        const isolated = await contexts(browser,second,B); allMatch(isolated.values,B);
        return {restored:first.baseline,independentTab:B,values:firstCtx.values};
      });
      await check('candidate.clear-pixels-and-input', () => pixelsAndInput(browser,first,firstCtx,'clear',imagePath('clear')));
      await check('candidate.navigate-new-process', async () => {
        const previous=[...firstCtx.targets];
        await browser.send('Emulation.setDeviceMetricsOverride',metrics(A),first.sessionId);
        await navigate(browser,fixture,first,A,'&navigation=2');
        firstCtx = await contexts(browser,first,A); allMatch(firstCtx.values,A);
        // Target IDs are evidence of actual OOPIFs; Chromium may reuse a renderer.
        return {previous,after:firstCtx.targets};
      });
      await check('candidate.navigate-pixels-and-input', () => pixelsAndInput(browser,first,firstCtx,'navigate',imagePath('navigate')));
      await browser.close();
      const restarted = launch(opts.executable,'candidate'); let restartPage, restartCtx;
      await check('candidate.restart-first-script-and-css', async () => {
        const runtime=await restarted.send('Browser.getVersion'); assert.equal(runtime.revision?.replace(/^@/,''),revision);
        restartPage=await createPage(restarted,fixture,A);
        assert.deepEqual(restartPage.baseline,first.baseline,'CDP emulation must not persist into a restarted browser');
        restartCtx=await contexts(restarted,restartPage,A); allMatch(restartCtx.values,A);
        return {nativeBaseline:restartPage.baseline,values:restartCtx.values};
      });
      await check('candidate.restart-pixels-and-input', async () => {assert.ok(restartCtx,'Restart measurement must succeed'); return pixelsAndInput(restarted,restartPage,restartCtx,'restart',imagePath('restart'));});
      await check('candidate.no-api-injection', () => {
        for (const instance of browsers) {
          assert.ok(!instance.commands.some(name => name==='Page.addScriptToEvaluateOnNewDocument' || name==='Extensions.loadUnpacked'));
          assert.ok(instance.commands.filter(name=>name.startsWith('Emulation.')).every(name=>['Emulation.setDeviceMetricsOverride','Emulation.clearDeviceMetricsOverride'].includes(name)));
        }
        return {nativeCommandsOnly:true,commands:[...new Set(browsers.flatMap(b=>b.commands))]};
      });
    }
    report.requiredChecks = opts.controlsOnly ? CONTROLS : [...CONTROLS,...CANDIDATE];
    report.status = opts.controlsOnly ? (requiredPass(CONTROLS)?'control-only':'control-failed') :
      (requiredPass(report.requiredChecks) && checks.every(c=>c.status==='passed')?'oopif-accepted':'oopif-rejected');
    report.oopifPropagationRuntimeAccepted = report.status === 'oopif-accepted';
  } catch (error) {
    report.status='probe-failed'; checks.push({id:'probe',status:'failed',error:error.stack}); console.error(error);
  } finally {
    for (const browser of browsers) await browser.close().catch(()=>{});
    await fixture?.close();
    if (root) fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
    report.testedAt=new Date().toISOString();
    const output=opts?.output || path.resolve('test-results/oopif-device-metrics.json');
    fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    if (!['control-only','oopif-accepted'].includes(report.status)) process.exitCode=1;
  }
})();
