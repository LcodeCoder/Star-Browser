'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startOrigin,startHttpProxy}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-settings-')),results=[];let app,manager,browser,origin,proxy,profile;const pageErrors=[];
async function until(run,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,60));}throw new Error('设置验证等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function saved(){return (await api('list')).find(row=>row.id===profile.id);}
async function check(name,run){const started=Date.now();const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-started,detail});console.log('PASS',name);}
async function ready(){await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/probe')));}
(async()=>{
 try{
  fs.mkdirSync('test-results',{recursive:true});origin=await startOrigin();proxy=await startHttpProxy();
  app=await _electron.launch({args:['.','--host-resolver-rules=MAP qa.local 127.0.0.1'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)}});
  manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  profile=await api('create',{name:'浏览器设置验证',os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:'about:home',note:'保留这段备注',tags:['工作','日本']});
  const next=app.waitForEvent('window');await api('browse',profile.id);browser=await next;browser.on('pageerror',error=>pageErrors.push(error.message));await browser.waitForFunction(()=>typeof StarSettings==='object'&&Array.isArray(tabs));
  await check('初始回填国家、手动语言时区、原始起始页、备注和标签',async()=>{
   await browser.locator('#gear').click();assert.equal(await browser.locator('#s-start').inputValue(),'about:home');assert.equal(await browser.locator('#s-country').inputValue(),'JP');assert.equal(await browser.locator('#s-language').inputValue(),'ja-JP');assert.equal(await browser.locator('#s-timezone').inputValue(),'Asia/Tokyo');assert.equal(await browser.locator('#s-note').inputValue(),'保留这段备注');assert.equal(await browser.locator('#s-tags').inputValue(),'工作, 日本');assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-start');
  });
  await check('保存后新 guest 首个网页脚本读取更新的语言和时区',async()=>{
   await browser.locator('#s-cancel').click();await browser.evaluate(url=>createTab(url),'http://qa.local:'+origin.port+'/probe');await ready();await browser.locator('#gear').click();
   await browser.locator('#s-start').fill('http://qa.local:'+origin.port+'/probe');await browser.locator('#s-language').selectOption('en-GB');await browser.locator('#s-timezone').selectOption('Europe/London');await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});await ready();
   const id=await browser.evaluate(()=>activeTab().web.getWebContentsId());const early=await app.evaluate(async({webContents},id)=>webContents.fromId(id).executeJavaScript('window.early'),id);assert.equal(early.language,'en-GB');assert.equal(early.tz,'Europe/London');const data=await saved();assert.equal(data.note,'保留这段备注');assert.deepEqual(data.tags,['工作','日本']);return early;
  });
  await check('无效起始页就地报错，保留草稿且不修改窗口或保存配置',async()=>{
   await browser.locator('#gear').click();await browser.locator('#s-start').fill('file:///tmp/invalid');await browser.locator('#s-save').click();await browser.locator('#settingsError').waitFor();assert.match(await browser.locator('#settingsError').innerText(),/起始页/);assert.equal(await browser.locator('#s-start').inputValue(),'file:///tmp/invalid');assert.equal((await saved()).startUrl,'http://qa.local:'+origin.port+'/probe');assert.equal(await browser.evaluate(()=>profile.configuredStartUrl),'http://qa.local:'+origin.port+'/probe');assert.equal(await browser.locator('#s-save').isEnabled(),true);await browser.locator('#s-start').fill('http://qa.local:'+origin.port+'/probe');
  });
  await check('任务保护锁阻止设置保存，解除后可重试',async()=>{
   await app.evaluate(({app},id)=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');req('./src/main/profile-backups').lockProfile(id,'settings-qa','这个环境正在执行任务');},profile.id);
   await browser.locator('#s-save').click();await until(async()=>/正在执行任务/.test(await browser.locator('#settingsError').innerText()));await app.evaluate(({app},id)=>{const req=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');req('./src/main/profile-backups').unlockProfile(id,'settings-qa');},profile.id);
  });
  await check('自动恢复只修改草稿，取消与 Escape 返回设置入口',async()=>{
   await browser.locator('#s-lang-reset').click();await browser.locator('#s-tz-reset').click();assert.equal(await browser.evaluate(()=>StarSettings.languageManual()),false);assert.equal(await browser.locator('#s-timezone').inputValue(),'');await browser.keyboard.press('Escape');assert.equal(await browser.evaluate(()=>document.activeElement.id),'gear');assert.equal((await saved()).timezone,'Europe/London');await browser.locator('#gear').click();assert.equal(await browser.locator('#s-timezone').inputValue(),'Europe/London');
  });
  await check('当前表单代理走真实 HTTP 代理检测，预览不保存或重建网页',async()=>{
   const guestBefore=await browser.evaluate(()=>activeTab().web.getWebContentsId());await browser.locator('#s-proxyOn').check();await browser.locator('#s-type').selectOption('http');await browser.locator('#s-host').fill('127.0.0.1:'+proxy.port);
   await app.evaluate(({net},url)=>{globalThis.__settingsNet=net.request;net.request=options=>globalThis.__settingsNet(typeof options==='string'?url:{...options,url});},'http://qa.local:'+origin.port+'/geo');
   try{await browser.locator('#s-check').click();await until(async()=>/连接成功/.test(await browser.locator('#s-check-result').innerText()));assert.match(await browser.locator('#s-check-result').innerText(),/8\.8\.8\.8/);assert.ok(proxy.requests.length);assert.ok(!(await saved()).proxy?.host);assert.equal(await browser.evaluate(()=>activeTab().web.getWebContentsId()),guestBefore);}
   finally{await app.evaluate(({net})=>{net.request=globalThis.__settingsNet;delete globalThis.__settingsNet;});}
   await browser.locator('#s-cancel').click();
  });
  await check('保存代理并自动对齐出口时，保留手动语言与时区且新网页首脚本一致',async()=>{
   await browser.locator('#gear').click();await browser.locator('#s-proxyOn').check();await browser.locator('#s-type').selectOption('http');await browser.locator('#s-host').fill('127.0.0.1:'+proxy.port);await browser.locator('#s-country').selectOption('US');
   await app.evaluate(({net},url)=>{globalThis.__settingsNet=net.request;net.request=options=>globalThis.__settingsNet(typeof options==='string'?url:{...options,url});},'http://qa.local:'+origin.port+'/geo');
   try{await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});await browser.waitForFunction(()=>!document.querySelector('#s-save').disabled);await ready();const data=await saved();assert.equal(data.timezone,'Europe/London');assert.equal(data.language,'en-GB');assert.equal(data.country,'JP');const guest=await browser.evaluate(()=>activeTab().web.getWebContentsId());const early=await app.evaluate(async({webContents},id)=>webContents.fromId(id).executeJavaScript('window.early'),guest);assert.equal(early.tz,'Europe/London');assert.equal(early.language,'en-GB');}
   finally{await app.evaluate(({net})=>{net.request=globalThis.__settingsNet;delete globalThis.__settingsNet;});}
   await browser.locator('#gear').click();await browser.locator('#s-proxyOn').uncheck();await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});await ready();
  });
  await check('浅深主题、780px窗口、固定操作栏与双向键盘焦点限制',async()=>{
   await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w._profile?.id===id).setSize(780,660),profile.id);await browser.emulateMedia({reducedMotion:'reduce'});await browser.locator('#gear').click();
   for(const theme of ['light','dark']){await browser.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const p=await browser.locator('#settings').boundingBox(),save=await browser.locator('#s-save').boundingBox();assert.ok(p.x>=0&&p.x+p.width<=780);assert.ok(save.y+save.height<=660);await browser.screenshot({path:path.resolve('test-results/settings-'+theme+'.png')});}
   await browser.locator('#s-close').focus();await browser.keyboard.press('Shift+Tab');assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-save');await browser.keyboard.press('Tab');assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-close');assert.ok(await browser.locator('#s-type option[value="https"]').count());await browser.keyboard.press('Escape');
  });
  await check('设置文件与脚本正常加载，无未处理的浏览器异常',async()=>{
   assert.equal(await browser.evaluate(()=>typeof StarSettings.checkProxy),'function');await browser.locator('#gear').click();await browser.locator('#s-start').fill('about:home');await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});assert.equal((await saved()).startUrl,'about:home');assert.deepEqual(pageErrors,[]);
  });
 }catch(error){console.error(error);results.push({name:'浏览器设置专项',status:'failed',error:error.stack});process.exitCode=1;if(browser&&!browser.isClosed())await browser.screenshot({path:path.resolve('test-results/settings-failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});if(proxy)await proxy.close();if(origin)await origin.close();fs.writeFileSync('test-results/browser-settings.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});}
})();
