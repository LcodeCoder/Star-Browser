'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-workbench-')),results=[],errors=[];let app,manager,browser,origin,slow;
const out=path.resolve('test-results/star-0.12.0');fs.mkdirSync(out,{recursive:true});
const timeline=path.join(out,'workbench-browser-lifecycle.jsonl');fs.writeFileSync(timeline,'');
function record(event,detail={}){fs.appendFileSync(timeline,JSON.stringify({at:new Date().toISOString(),source:'test',event,...detail})+'\n');}
async function diagnostics(){
 const child=app.process();child.on('exit',(code,signal)=>record('process-exit',{code,signal}));app.on('close',()=>record('connection-closed'));
 await app.evaluate(({app,crashReporter,webContents},{timeline,dumps})=>{
  const fs=process.getBuiltinModule('fs');fs.mkdirSync(dumps,{recursive:true});app.setPath('crashDumps',dumps);crashReporter.start({uploadToServer:false});
  const record=(event,detail={})=>fs.appendFileSync(timeline,JSON.stringify({at:new Date().toISOString(),source:'main',event,...detail})+'\n');
  process.on('exit',code=>record('process-exit',{code}));process.on('uncaughtExceptionMonitor',error=>record('uncaught-exception',{error:error.stack}));
  app.on('child-process-gone',(_event,details)=>record('child-process-gone',details));app.on('quit',(_event,code)=>record('app-quit',{code}));
  const observe=wc=>{const id=wc.id;record('web-contents-created',{id,type:wc.getType()});
   wc.on('render-process-gone',(_event,details)=>record('render-process-gone',{id,...details}));wc.once('destroyed',()=>record('web-contents-destroyed',{id}));
   wc.on('devtools-opened',()=>record('devtools-opened',{id}));wc.prependListener('devtools-closed',()=>record('devtools-closed',{id}));
   wc.debugger.on('detach',(_event,reason)=>record('debugger-detached',{id,reason}));
  };webContents.getAllWebContents().forEach(observe);app.on('web-contents-created',(_event,wc)=>observe(wc));
 },{timeline,dumps:path.join(out,'crash-dumps')});
}
async function until(run,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await run())return;await new Promise(r=>setTimeout(r,80));}throw new Error('验证等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){record('check-start',{name});const detail=await run();results.push({name,status:'passed',detail});record('check-passed',{name});console.log('PASS',name);}
async function closeGuestDevTools(id){
 record('close-devtools-request',{id});
 await app.evaluate(async({webContents},id)=>{
  const wc=webContents.fromId(id);if(!wc.isDevToolsOpened())return;
  await new Promise((resolve,reject)=>{
   const closed=()=>{clearTimeout(timer);setImmediate(resolve);};
   const timer=setTimeout(()=>{wc.removeListener('devtools-closed',closed);reject(new Error('开发者工具未完成关闭'));},10000);
   wc.once('devtools-closed',closed);wc.closeDevTools();
  });
 },id);
 await until(()=>app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id);return !wc.isDevToolsOpened()&&wc.__tfbFpInjected&&wc.debugger.isAttached();},id));
 record('close-devtools-complete',{id});
}

(async()=>{try{
 origin=await startOrigin();slow=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.write('<title>加载中的网页</title><h1>网络请求进行中</h1>');const timer=setTimeout(()=>res.end('完成'),8000);res.once('close',()=>clearTimeout(timer));});await new Promise(r=>slow.listen(0,'127.0.0.1',r));
 app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir}});manager=await app.firstWindow();await diagnostics();manager.on('pageerror',e=>errors.push(e.message));await manager.locator('#btnNew').waitFor();
 const p=await api('create',{name:'Studio · 主工作环境',os:process.platform==='win32'?'win':'mac',country:'JP',timezone:'Asia/Tokyo',timezoneManual:true,language:'ja-JP',langManual:true,startUrl:origin.url+'/probe',tags:['日常'],note:'用于工作台与浏览器交互验证'});await api('create',{name:'Studio · 内容协作',country:'US',tags:['内容']});
 await check('搜索、相邻详情与返回保留上下文和焦点',async()=>{await manager.locator('#search').fill('Studio');await manager.locator('.profile-name').first().click();await manager.locator('#drawer').waitFor();const title=await manager.locator('#drawer h2').innerText();await manager.getByRole('button',{name:'下一个环境',exact:true}).click();assert.notEqual(await manager.locator('#drawer h2').innerText(),title);await manager.locator('#drawerClose').click();assert.equal(await manager.locator('#search').inputValue(),'Studio');await until(()=>manager.evaluate(()=>document.activeElement.classList.contains('profile-name')));await manager.locator('#search').fill('不存在的环境');await manager.getByText('没有找到匹配的环境',{exact:true}).waitFor();await manager.screenshot({path:path.join(out,'empty.png')});await manager.locator('#search').fill('');});
 await check('侧栏收起与命令搜索定位',async()=>{await manager.getByRole('button',{name:'收起侧栏',exact:true}).click();assert.ok(await manager.locator('.sidebar-collapsed').count());await manager.keyboard.press(process.platform==='darwin'?'Meta+k':'Control+k');await manager.locator('[cmdk-input]').fill('内容协作');await manager.keyboard.press('ArrowDown');await manager.keyboard.press('Enter');await manager.locator('#drawer').waitFor();await manager.locator('#drawerClose').click();await manager.getByRole('button',{name:'展开侧栏',exact:true}).click();});
 await check('全部工作页、浅深主题、窄窗口及减少动效',async()=>{for(const id of ['navEnv','navProxy','navCookie','navBookmarks','navDownloads','navExtensions','navSynchronizer','navTasks','navActivity','navSettings']){await manager.locator('#'+id).click();await manager.locator('main h1').waitFor();assert.equal(await manager.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}await manager.locator('#navEnv').click();for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>manager.evaluate(t=>document.documentElement.dataset.theme===t,theme));await manager.screenshot({path:path.join(out,'workbench-'+theme+'.png')});}await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w._profile);w.setSize(780,720);});await manager.emulateMedia({reducedMotion:'reduce'});await manager.locator('.profile-name').first().click();await manager.screenshot({path:path.join(out,'workbench-narrow-detail.png')});await manager.getByRole('button',{name:'返回环境',exact:true}).click();await api('preferences',{theme:'light'});});
 const next=app.waitForEvent('window');await api('browse',p.id);browser=await next;browser.on('pageerror',e=>errors.push(e.message));await browser.waitForFunction(()=>typeof activeTab==='function');await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/probe')));
 const guest=await browser.evaluate(()=>activeTab().web.getWebContentsId());
 await check('网页请求携带与 JavaScript 一致的 Client Hints',async()=>{const headers=origin.requests.find(row=>row.url==='/probe').headers;assert.match(headers['sec-ch-ua']||'',/Chromium/);assert.equal(headers['sec-ch-ua-platform'],process.platform==='win32'?'"Windows"':'"macOS"');assert.equal(headers['sec-ch-ua-mobile'],'?0');const high=await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript("fetch('/client-hints').then(()=>fetch('/client-hints')).then(r=>r.json())"),guest);assert.match(high['sec-ch-ua-full-version-list'],/152\./);assert.ok(high['sec-ch-ua-arch']);assert.ok(high['sec-ch-ua-platform-version']);return {brands:headers['sec-ch-ua'],platform:headers['sec-ch-ua-platform'],architecture:high['sec-ch-ua-arch']};});
 await check('加载、停止及标签切换不覆盖工具栏按钮',async()=>{const first=await browser.evaluate(()=>activeId);await browser.evaluate(url=>createTab(url),'http://127.0.0.1:'+slow.address().port+'/slow');await browser.getByRole('button',{name:'停止加载',exact:true}).waitFor();assert.match(await browser.locator('#addr').inputValue(),/\/slow$/);const line=await browser.locator('#spinner').boundingBox(),bookmark=await browser.locator('#bmBtn').boundingBox();assert.ok(line.y>=bookmark.y+bookmark.height);await browser.screenshot({path:path.join(out,'browser-loading.png')});const second=await browser.evaluate(()=>activeId);await browser.evaluate(id=>activateTab(id),first);assert.equal(await browser.locator('#reload').getAttribute('aria-label'),'刷新');await browser.evaluate(id=>activateTab(id),second);assert.equal(await browser.locator('#reload').getAttribute('aria-label'),'停止加载');await browser.locator('#reload').click();await until(()=>browser.evaluate(()=>!activeTab().loading));await browser.evaluate(id=>closeTab(id),second);});
 await check('开发者工具作用于当前网页，刷新和关闭后配置一致',async()=>{await browser.locator('#browserMenuBtn').click();await browser.locator('[data-command=devtools]').click();await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),guest));assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w._profile).webContents.isDevToolsOpened()),false);const attached=await app.evaluate(({webContents},id)=>webContents.fromId(id).debugger.isAttached(),guest);await app.evaluate(({webContents},id)=>webContents.fromId(id).reload(),guest);await until(()=>app.evaluate(({webContents},id)=>!webContents.fromId(id).isLoading(),guest));const early=await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('window.early'),guest);assert.equal(early.tz,'Asia/Tokyo');assert.equal(early.language,'ja-JP');await closeGuestDevTools(guest);await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).__tfbFpInjected&&webContents.fromId(id).debugger.isAttached(),guest));return {attachedWhileOpen:attached,timezone:early.tz,language:early.language};});
 await check('网页内 F12 与宿主快捷键',async()=>{await app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id);wc.focus();wc.sendInputEvent({type:'keyDown',keyCode:'F12'});wc.sendInputEvent({type:'keyUp',keyCode:'F12'});},guest);await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),guest));await closeGuestDevTools(guest);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w._profile);w.show();w.focus();});await browser.bringToFront();await browser.locator('#addr').focus();await browser.keyboard.press(process.platform==='darwin'?'Meta+Alt+i':'Control+Shift+i');await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),guest));await app.evaluate(({webContents},id)=>webContents.fromId(id).openDevTools({mode:'detach',activate:true}),guest);await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsFocused(),guest));await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.find(m=>m.label==='文件').submenu.items.find(m=>m.label==='关闭标签页').click());await until(()=>app.evaluate(({webContents},id)=>!webContents.fromId(id).isDevToolsOpened(),guest));});
 await check('连续切换开发者工具、重载及关闭前台标签保持环境',async()=>{
  const rounds=[];
  for(let round=0;round<6;round++){
   record('devtools-cycle-start',{round});
   await app.evaluate(({webContents},id)=>webContents.fromId(id).openDevTools({mode:'detach',activate:true}),guest);
   await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),guest));
   await app.evaluate(({webContents},id)=>webContents.fromId(id).reload(),guest);
   await until(()=>app.evaluate(({webContents},id)=>!webContents.fromId(id).isLoading(),guest));
   const early=await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('window.early'),guest);
   assert.equal(early.tz,'Asia/Tokyo');assert.equal(early.language,'ja-JP');
   await closeGuestDevTools(guest);
   rounds.push({round,timezone:early.tz,language:early.language});
  }
  const temporary=await browser.evaluate(url=>createTab(url),origin.url+'/probe');
  await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()));
  const closing=await browser.evaluate(()=>activeTab().web.getWebContentsId());
  await app.evaluate(({webContents},id)=>webContents.fromId(id).openDevTools({mode:'detach',activate:true}),closing);
  await until(()=>app.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),closing));
  await browser.evaluate(id=>closeTab(id),temporary);
  await until(()=>app.evaluate(({webContents},id)=>!webContents.fromId(id),closing));
  assert.equal(await browser.evaluate(()=>activeTab().web.getWebContentsId()),guest);
  assert.equal(browser.isClosed(),false);
  return {rounds,closedGuest:closing};
 });
 await check('640px 浏览窗口、浅深主题与错误重试',async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w._profile).setSize(640,600));for(const id of ['back','forward','reload','addr','browserMenuBtn'])assert.equal(await browser.locator('#'+id).isVisible(),true);for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>browser.evaluate(t=>document.documentElement.dataset.theme===t,theme));await browser.screenshot({path:path.join(out,'browser-narrow-'+theme+'.png')});}await browser.evaluate(()=>go('http://127.0.0.1:1/fail'));await browser.locator('#fatal').waitFor();await browser.locator('#fatalRetry').waitFor();await browser.screenshot({path:path.join(out,'browser-error.png')});});
 await check('离线状态与恢复保留本地工作上下文',async()=>{await manager.context().setOffline(true);await manager.locator('.network-banner').waitFor();await manager.locator('#navEnv').click();assert.ok(await manager.locator('.profile-name').count());await manager.screenshot({path:path.join(out,'workbench-offline.png')});await manager.context().setOffline(false);await manager.locator('.network-banner').waitFor({state:'hidden'});});
 await check('手动 WebGL 配置在编辑器保存、重开后保留',async()=>{await manager.locator('.profile-name').first().click();await manager.getByRole('button',{name:'编辑环境',exact:true}).click();await manager.locator('details.advanced-settings summary,details.advanced summary').count().then(async count=>{if(count)await manager.locator('details.advanced-settings summary,details.advanced summary').click();else await manager.getByText('指纹、硬件与网站权限',{exact:false}).click();});await manager.getByLabel('WebGL 标识策略',{exact:true}).selectOption('stable');await manager.getByLabel('WebGL 厂商',{exact:false}).fill('QA vendor');await manager.getByLabel('WebGL 渲染器',{exact:true}).fill('QA renderer');await manager.getByRole('button',{name:'保存更改',exact:true}).click();await manager.getByRole('dialog').waitFor({state:'hidden'});const saved=(await api('list')).find(row=>row.fingerprint?.webgl?.vendor==='QA vendor');assert.equal(saved.fingerprint.webgl.renderer,'QA renderer');});
 await check('页面无未处理脚本错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){record('check-failed',{error:error.stack});console.error(error);process.exitCode=1;results.push({name:'工作台与浏览器验证',status:'failed',error:error.stack});if(browser&&!browser.isClosed())await browser.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{record('cleanup-start');if(app)await app.close().catch(()=>{});if(origin)await origin.close();if(slow){slow.closeAllConnections();await new Promise(r=>slow.close(r));}fs.writeFileSync(path.join(out,'workbench-browser.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2));fs.rmSync(dir,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
})();
