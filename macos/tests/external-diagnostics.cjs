'use strict';
// A manual network diagnostic: external websites are evidence, never a CI score.
const { _electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const requested = process.argv.slice(2);
const availableSites = [
  ['browserscan', 'https://www.browserscan.net/zh'],
  ['javascript', 'https://browserleaks.com/javascript'],
  ['client-hints', 'https://browserleaks.com/client-hints'],
  ['webrtc', 'https://browserleaks.com/webrtc'],
  ['canvas', 'https://browserleaks.com/canvas'],
  ['webgl', 'https://browserleaks.com/webgl'],
  ['tls', 'https://browserleaks.com/tls'],
];
if (requested.some(name => !availableSites.some(site => site[0] === name))) throw new Error('检测页面名称无效');
const sites = requested.length ? availableSites.filter(site => requested.includes(site[0])) : availableSites;
const output = path.resolve('test-results/star-0.13.0/' + (requested.length ? 'external-' + requested.join('-') : 'external'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'star-external-'));
const report = { testedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch }, isolated: true, results: [] };
let app;
const readSource = `(() => ({
 title: document.title, url: location.href, ready: document.readyState,
 text: document.body?.innerText.slice(0, 40000) || '',
 values: { ua: navigator.userAgent, platform: navigator.platform, language: navigator.language,
 languages: [...navigator.languages], locale: Intl.DateTimeFormat().resolvedOptions().locale,
 numberLocale: Intl.NumberFormat().resolvedOptions().locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, webdriver: navigator.webdriver,
 screen: {width:screen.width,height:screen.height}, dpr: devicePixelRatio,
 webrtc: typeof RTCPeerConnection, webgpu: !!navigator.gpu },
 rows: [...document.querySelectorAll('tr')].map(row => row.innerText).filter(Boolean)
}))()`;
async function waitFor(run, timeout = 30000) {
 const end = Date.now() + timeout;
 while (Date.now() < end) { const value = await run(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
 throw new Error('网页在等待时间内未就绪');
}
(async () => {
 fs.mkdirSync(output, { recursive: true });
 try {
  const env = { ...process.env, TFB_USER_DATA_DIR: data };
  delete env.TFB_TEST_MODE; delete env.TFB_TEST_ORIGIN_PORT;
  app = await _electron.launch({ ...(process.env.STAR_QA_EXECUTABLE ? {executablePath:process.env.STAR_QA_EXECUTABLE,args:[]} : {args:['.']}), cwd: process.cwd(), env, timeout: 30000 });
  const manager = await app.firstWindow(); await manager.locator('#btnNew').waitFor();
  const profile = await manager.evaluate(os => window.api.create({name:'外部检测 · 隔离临时环境',os,country:'US',startUrl:'about:home',webrtc:'disable'}), process.platform === 'win32' ? 'win' : 'mac');
  const next = app.waitForEvent('window'); await manager.evaluate(id => window.api.browse(id), profile.id);
  const browser = await next; await browser.waitForFunction(() => typeof go === 'function' && typeof activeTab === 'function');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window._profile).setSize(1280, 820));
  report.runtime = await app.evaluate(() => ({electron: process.versions.electron, chrome: process.versions.chrome}));
  report.configuration = await manager.evaluate(id => window.api.preview(id), profile.id);
  for (const [name, url] of sites) {
   console.log('OPEN', name, url);
   const result = {name,url};
   try {
    await browser.evaluate(url => go(url), url);
    const guest = await waitFor(() => app.evaluate(({webContents},id) => webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.session.__tfbEnvId === id)?.id, profile.id));
    const read = () => app.evaluate(({webContents},{id,source}) => webContents.fromId(id).executeJavaScript(source), {id:guest,source:readSource});
    await waitFor(async () => {const snapshot = await read();return snapshot.url.startsWith(url) && snapshot.ready !== 'loading' && snapshot.text.length > 300 ? snapshot : false;});
    // Dynamic diagnostics keep working after HTML load. Wait for readings to
    // settle, with a bounded limit; empty/blocked readings remain explicit.
    let previous = '', stable = 0, snapshot;
    const deadline = Date.now() + 15000;
    do {
     snapshot = await read(); const text = snapshot.text.replace(/\d{2}:\d{2}:\d{2}/g,'TIME');
     stable = text === previous ? stable + 1 : 0; previous = text;
     if (stable >= 5) break;
     await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    result.page = snapshot;
    result.status = /Just a moment|verify you are human|Access denied|安全验证/i.test(snapshot.title + ' ' + snapshot.text.slice(0, 600)) ? 'blocked' : 'observed';
    result.internalAudit = await manager.evaluate(id => window.api.fingerprintAudit(id), profile.id).catch(error => ({error:error.message}));
    const png = await app.evaluate(async({webContents},id) => (await webContents.fromId(id).capturePage()).toPNG().toString('base64'), guest);
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(png,'base64'));
    console.log(result.status.toUpperCase(), name, JSON.stringify({title:snapshot.title,language:snapshot.values.language,locale:snapshot.values.locale,timezone:snapshot.values.timezone,differences:result.internalAudit.differences,unknown:result.internalAudit.unknown}));
   } catch (error) {result.status='unavailable';result.error=error.message;console.log('UNAVAILABLE',name,error.message);}
   report.results.push(result);
   fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
 } catch (error) { report.error=error.stack; process.exitCode=1; console.error(error); }
 finally {
  if (app) await app.close().catch(()=>{});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  fs.rmSync(data,{recursive:true,force:true});
 }
})();
