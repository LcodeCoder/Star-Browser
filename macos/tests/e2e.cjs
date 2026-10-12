'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {startOrigin,startSocks,startHttpProxy}=require('./fixtures.cjs');
const results=[],errors=[];
const output=path.resolve('test-results');
fs.mkdirSync(output,{recursive:true});
const data=fs.mkdtempSync(path.join(os.tmpdir(),'changyi-e2e-'));
let app,manager,origin,httpProxy,authProxy,socks;

async function check(name,run){
 const start=Date.now();
 try{const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-start,...(detail?{detail}:{})});console.log('PASS',name);}
 catch(error){results.push({name,status:'failed',error:error.stack});throw error;}
}
async function until(fn,timeout=15000){
 const limit=Date.now()+timeout;
 while(Date.now()<limit){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}
 throw new Error('等待测试条件超时');
}
async function launch(){
 app=await _electron.launch({args:['.','--host-resolver-rules=MAP qa.local 127.0.0.1'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});
 app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
 manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));
 await manager.waitForFunction(()=>typeof window.api==='object');await manager.locator('#btnNew').waitFor();
}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function guestFor(profileId,urlPart='/probe'){
 return until(()=>app.evaluate(({webContents},{id,part})=>{
  const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes(part)&&!w.isLoading());
  return wc?wc.id:null;
 },{id:profileId,part:urlPart}));
}
async function guestEval(id,code){return app.evaluate(({webContents},{id,code})=>webContents.fromId(id).executeJavaScript(code),{id,code});}
async function closeProfile(id){await app.evaluate(({BrowserWindow},id)=>{for(const w of BrowserWindow.getAllWindows())if(w._profile?.id===id)w.close();},id);}
async function createProfile(name,proxy=null){
 return api('create',{name,os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:`http://qa.local:${origin.port}/probe`,proxy});
}

(async()=>{
 try{
  origin=await startOrigin();httpProxy=await startHttpProxy();authProxy=await startHttpProxy({user:'qa',pass:'secret'});socks=await startSocks({fragmentReply:true});
  await launch();
  await check('macOS 启动、Star 工作台和 IPC 桥接',async()=>{
   assert.equal(await manager.title(),'Star Browser');assert.ok(await manager.locator('#btnNew').isVisible());
   const runtime=await app.evaluate(({app})=>({version:process.versions.electron,chrome:process.versions.chrome,arch:process.arch,userData:app.getPath('userData')}));
   assert.equal(runtime.arch,'arm64');assert.equal(runtime.userData,data);return runtime;
  });
  let primary,second,firstGuest;
  await check('通过界面创建、编辑、搜索环境并预览指纹',async()=>{
   await manager.locator('#btnNew').click();await manager.locator('#f_name').fill('macOS QA 日本');
   await manager.locator('#f_os').selectOption('mac');await manager.locator('#f_country').selectOption('JP');
   await manager.locator('#f_language').selectOption('ja-JP');await manager.locator('#f_timezone').selectOption('Asia/Tokyo');
   await manager.locator('#f_url').fill(`http://qa.local:${origin.port}/probe`);await manager.locator('#f_tags').fill('QA,Mac');
   await manager.locator('#btnSave').click();
   primary=await until(async()=> (await api('list')).find(p=>p.name==='macOS QA 日本'));
   assert.equal(primary.language,'ja-JP');assert.equal(primary.langManual,true);
   await manager.locator(`[data-act="edit"][data-id="${primary.id}"]`).click();await manager.locator('#f_note').fill('macOS 回归测试');await manager.locator('#btnSave').click();
   await manager.locator('#search').fill('macOS QA');assert.equal(await manager.locator('#rows tr').count(),1);await manager.locator('#search').fill('');
   await manager.locator(`[data-act="fp"][data-id="${primary.id}"]`).click();await manager.locator('#drawer').waitFor({state:'visible'});await manager.locator('#drawerClose').click();
   const preview=await api('preview',primary.id);assert.equal(preview.platform,'MacIntel');assert.equal(preview.language,'ja-JP');assert.equal(preview.timezone,'Asia/Tokyo');
   await manager.screenshot({path:path.join(output,'management.png')});
  });
  await check('内置浏览器首个页面脚本读取到目标指纹',async()=>{
   const newWindow=app.waitForEvent('window');await api('browse',primary.id);const browser=await newWindow;
   firstGuest=await guestFor(primary.id);
   const early=await guestEval(firstGuest,'window.early');const preview=await api('preview',primary.id);
   assert.equal(early.platform,'MacIntel');assert.equal(early.language,'ja-JP');assert.equal(early.tz,'Asia/Tokyo');assert.equal(early.ua,preview.userAgent);assert.equal(early.width,preview.screen.width);assert.equal(early.cores,preview.hardwareConcurrency);assert.equal(early.webdriver,false);
   await browser.screenshot({path:path.join(output,'browser.png')});return early;
  });
  await check('Cookie 和 localStorage 在不同环境之间隔离',async()=>{
   await guestEval(firstGuest,"document.cookie='sessionQA=first; path=/; max-age=3600'; localStorage.setItem('qa','first'); true");
   second=await createProfile('隔离环境 B');await api('browse',second.id);const other=await guestFor(second.id);
   assert.equal(await guestEval(other,"localStorage.getItem('qa')"),null);assert.equal((await api('cookieCount',second.id)).count,0);assert.equal((await api('cookieCount',primary.id)).count,1);
   await closeProfile(second.id);
  });
  await check('Cookie 备份、清空、恢复与取消文件选择',async()=>{
   const file=path.join(data,'cookies.json');
   await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
   const backup=await api('cookieExport',primary.id);assert.equal(backup.ok,true);assert.equal(backup.count,1);assert.ok(fs.existsSync(file));
   assert.equal((await api('cookieClear',primary.id)).ok,true);assert.equal((await api('cookieCount',primary.id)).count,0);
   const restored=await api('cookieImport',primary.id);assert.equal(restored.ok,true);assert.equal(restored.okCount,1);assert.equal(restored.failCount,0);
   assert.equal((await api('cookieCount',primary.id)).count,1);
   await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});assert.equal((await api('cookieExport',primary.id)).canceled,true);
  });
  await check('书签增改、云端合并和最常访问记录',async()=>{
   const bm=await api('bookmarksAdd',{title:'QA',url:origin.url});assert.ok(bm.id);await api('bookmarksUpdate',bm.id,{title:'QA 更新'});
   await api('bookmarksMergeCloud',[{id:'qa-cloud',title:'测试',url:origin.url+'/cloud'}]);assert.ok((await api('bookmarksList')).some(b=>b.id===bm.id&&b.title==='QA 更新'));
   await api('visitsRecord',origin.url+'/visited','Visit');assert.ok((await api('visitsTop',10)).some(v=>v.url.includes('/visited')));assert.equal(await api('bookmarksRemove',bm.id),true);
  });
  await check('弹窗作为新标签打开，macOS Command+T 新建标签',async()=>{
   const windowCount=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length);await guestEval(firstGuest,"document.getElementById('popup').click(); true");await guestFor(primary.id,'/popup');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),windowCount);
   const browser=(await app.windows()).find(p=>p.url().includes('browser-shell'));
   const before=await browser.locator('#tabs > *').count();await browser.locator('#addr').focus();await browser.keyboard.press('Meta+t');await until(async()=> (await browser.locator('#tabs > *').count())>before);
   const afterNew=await browser.locator('#tabs > *').count();await browser.keyboard.press('Meta+w');
   await until(async()=> (await browser.locator('#tabs > *').count())===afterNew-1);assert.equal(browser.isClosed(),false);
   await closeProfile(primary.id);
  });
  for(const [name,proxy,fixture]of[
   ['HTTP 代理', {type:'http',host:'127.0.0.1',port:String(httpProxy.port)},httpProxy],
   ['HTTP 账号密码代理',{type:'http',host:'127.0.0.1',port:String(authProxy.port),user:'qa',pass:'secret'},authProxy],
   ['SOCKS5 账号密码网关',{type:'socks5',host:'127.0.0.1',port:String(socks.port),user:'qa-user',pass:'qa-pass'},socks],
  ])await check(name+'实际网页转发',async()=>{
   const profile=await createProfile(name,proxy);await api('browse',profile.id);const guest=await guestFor(profile.id);
   assert.ok((fixture.requests||fixture.connections).length>0,'网页流量未经过配置的代理');
   const response=await guestEval(guest,"fetch('/status').then(async r=>({status:r.status,header:r.headers.get('x-qa'),body:await r.text()}))");
   assert.deepEqual(response,{status:201,header:'upstream',body:'first:second'});assert.equal((await api('cookieCount',profile.id)).count,1);
   if(name.includes('HTTP 账号'))assert.ok(fixture.requests.some(r=>r.authorization==='Basic cWE6c2VjcmV0'));
   if(name.includes('SOCKS'))assert.ok(socks.authentications.some(a=>a.user==='qa-user'&&a.pass==='qa-pass'));
   await closeProfile(profile.id);await api('remove',profile.id);
  });
  await check('代理出口 IP 与国家时区解析、批量代理检测（本地模拟检测服务）',async()=>{
   await app.evaluate(({net},url)=>{
     globalThis.__qaNetRequest=net.request;
     net.request=options=>globalThis.__qaNetRequest(typeof options==='string'?url:{...options,url});
   },`http://qa.local:${origin.port}/geo`);
   try{
     for(const proxy of [
       {type:'http',host:'127.0.0.1',port:String(authProxy.port),user:'qa',pass:'secret'},
       {type:'socks5',host:'127.0.0.1',port:String(socks.port),user:'qa-user',pass:'qa-pass'},
     ]){
       const result=await api('proxyCheck',proxy);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.ip,'8.8.8.8');assert.equal(result.country,'JP');assert.equal(result.timezone,'Asia/Tokyo');
     }
     const batch=await api('proxyBatchCheck',[`http://qa:secret@127.0.0.1:${authProxy.port}`,`socks5://qa-user:qa-pass@127.0.0.1:${socks.port}`]);
     assert.equal(batch.results.length,2);assert.ok(batch.results.every(item=>item.ok),JSON.stringify(batch));
   }finally{await app.evaluate(({net})=>{net.request=globalThis.__qaNetRequest;delete globalThis.__qaNetRequest;});}
  });
  for (const [name,proxy] of [
   ['独立 Chrome',null],
   ['独立 Chrome HTTP 鉴权',{type:'http',host:'127.0.0.1',port:String(authProxy.port),user:'qa',pass:'secret'}],
   ['独立 Chrome SOCKS5 鉴权',{type:'socks5',host:'127.0.0.1',port:String(socks.port),user:'qa-user',pass:'qa-pass'}],
  ]) await check(name+' 扩展和首屏指纹',async()=>{
   const profile=await createProfile(name,proxy);
   try {
    const launched=await api('launch',profile.id);assert.ok(launched.pid);assert.ok(launched.extensionId);
    const send=(method,params={},sessionId)=>app.evaluate(async(_,{id,method,params,sessionId})=>{
      const load=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
      const launcher=load('./src/main/launcher.js');
      return launcher.getLaunchedBrowser(id).pipe.send(method,params,sessionId);
    },{id:profile.id,method,params,sessionId});
    const {targetInfos}=await send('Target.getTargets');
    const target=targetInfos.find(t=>t.type==='page');assert.ok(target);
    const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    let early;
    try {early=await until(async()=>{const response=await send('Runtime.evaluate',{expression:'window.early',returnByValue:true},sessionId);return response.result.value;});}
    catch(error){
      const diagnostic={name,targets:await send('Target.getTargets'),page:await send('Runtime.evaluate',{expression:'({url:location.href,title:document.title,text:document.body?.innerText})',returnByValue:true},sessionId),requests:authProxy.requests};
      for(const worker of diagnostic.targets.targetInfos.filter(t=>t.type==='service_worker')){
        const attached=await send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});
        diagnostic.worker=await send('Runtime.evaluate',{expression:'({proxy:typeof PROXY!=="undefined"?PROXY:null,ready:typeof configReady})',returnByValue:true},attached.sessionId);
      }
      fs.writeFileSync(path.join(output,'chrome-diagnostic.json'),JSON.stringify(diagnostic,null,2));throw error;
    }
    assert.equal(early.platform,'MacIntel');assert.equal(early.language,'ja-JP');assert.equal(early.tz,'Asia/Tokyo');assert.equal(early.ua,launched.ua);
    const response=await send('Runtime.evaluate',{expression:"fetch('/status').then(async r=>({status:r.status,body:await r.text()}))",returnByValue:true,awaitPromise:true},sessionId);
    assert.deepEqual(response.result.value,{status:201,body:'first:second'});
    if(name==='独立 Chrome'){
      const shot=await send('Page.captureScreenshot',{},sessionId);fs.writeFileSync(path.join(output,'external-chrome.png'),Buffer.from(shot.data,'base64'));
    }
    await send('Browser.close').catch(()=>{});
   } finally {
    await app.evaluate(async(_,id)=>{const running=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('./src/main/launcher.js').getLaunchedBrowser(id);if(running&&!running.pipe.closed)await running.pipe.send('Browser.close').catch(()=>running.child.kill());},profile.id).catch(()=>{});
    await api('remove',profile.id);
   }
  });
  await check('应用重启后环境与 Cookie 保持持久化',async()=>{
   await app.evaluate(async({session},ids)=>{for(const id of ids)await session.fromPartition('persist:tfb-env-'+id).cookies.flushStore();},[primary.id,second.id]);
   await app.close();app=null;await launch();
   assert.ok((await api('list')).some(p=>p.id===primary.id&&p.note==='macOS 回归测试'));assert.equal((await api('cookieCount',primary.id)).count,1);
   await api('browse',primary.id);const guest=await guestFor(primary.id);assert.equal(await guestEval(guest,"localStorage.getItem('qa')"),'first');await closeProfile(primary.id);
  });
  await check('关闭所有窗口后 Dock 激活重新创建管理窗口',async()=>{
   await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.close();});await until(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length===0));const next=app.waitForEvent('window');await app.evaluate(({app})=>app.emit('activate'));manager=await next;await manager.waitForFunction(()=>typeof window.api==='object');await manager.locator('#btnNew').waitFor();assert.equal(await manager.title(),'Star Browser');
  });
  await check('页面运行无未捕获 JavaScript 异常',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
 finally{
  if(app){await app.evaluate(({app})=>{try{process.getBuiltinModule('fs').copyFileSync(process.getBuiltinModule('path').join(app.getPath('userData'),'tfb-debug.log'),process.getBuiltinModule('path').join(process.cwd(),'test-results','runtime.log'));}catch{};}).catch(()=>{});await app.close().catch(()=>{});}
  for(const fixture of[socks,authProxy,httpProxy,origin])if(fixture)await fixture.close();
  fs.writeFileSync(path.join(output,'e2e.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,results,errors},null,2)+'\n');
  fs.rmSync(data,{recursive:true,force:true});
 }
})();
