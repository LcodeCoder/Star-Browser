'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {startOrigin}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..');
const platform=process.platform,architecture=process.arch;
const bundle=platform==='darwin'?path.join(root,'dist',architecture==='arm64'?'mac-arm64':'mac','Star Browser.app'):path.join(root,'dist',architecture==='arm64'?'win-arm64-unpacked':'win-unpacked');
const executable=platform==='darwin'?path.join(bundle,'Contents/MacOS/Star Browser'):path.join(bundle,'Star Browser.exe');
const profileOs=platform==='win32'?'win':'mac';
const packageVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const data=fs.mkdtempSync(path.join(os.tmpdir(),'changyi-package-'));
const results=[];
let app,origin;
(async()=>{
 try{
  assert.ok(['darwin','win32'].includes(platform),'此打包测试需要 macOS 或 Windows 主机');
  assert.ok(fs.existsSync(executable),platform==='darwin'?'先运行对应架构的 build:mac':'先运行对应架构的 build:win');
  if(platform==='darwin'){const signature=execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',bundle],{encoding:'utf8',stdio:['ignore','pipe','pipe']});results.push({name:'打包 .app 的完整签名校验',status:'passed',detail:signature.trim()||'valid'});}
  origin=await startOrigin();
  app=await _electron.launch({executablePath:executable,args:['--host-resolver-rules=MAP qa.local 127.0.0.1'],cwd:root,env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});
  const manager=await app.firstWindow();await manager.waitForFunction(()=>typeof window.api==='object');await manager.locator('#btnNew').waitFor();
  const metadata=await app.evaluate(({app})=>({packaged:app.isPackaged,platform:process.platform,arch:process.arch,version:app.getVersion(),electron:process.versions.electron,executable:process.execPath}));
  assert.equal(metadata.packaged,true);assert.equal(metadata.platform,platform);assert.equal(metadata.arch,architecture);assert.equal(metadata.version,packageVersion);assert.equal(await manager.title(),'Star Browser');
  results.push({name:'安装包中的应用实际启动与管理界面',status:'passed',detail:metadata});
  await manager.locator('#btnNew').click();await manager.locator('#f_name').fill('安装包关窗保护草稿');
  await app.evaluate(({BrowserWindow,dialog})=>{globalThis.__starPackageDialog=dialog.showMessageBox;globalThis.__starPackageClosePrompts=[];dialog.showMessageBox=async(...args)=>{globalThis.__starPackageClosePrompts.push(args.at(-1));return {response:0};};BrowserWindow.getAllWindows().find(window=>!window._profile).close();});
  let closePrompt;for(let index=0;index<100&&!closePrompt;index++){closePrompt=await app.evaluate(()=>globalThis.__starPackageClosePrompts[0]);if(!closePrompt)await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(closePrompt?.title,'修改尚未保存');assert.equal(closePrompt.cancelId,0);assert.equal(manager.isClosed(),false);assert.equal(await manager.locator('#f_name').inputValue(),'安装包关窗保护草稿');assert.equal((await manager.evaluate(()=>window.api.snapshot())).profiles.length,0);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__starPackageDialog;delete globalThis.__starPackageDialog;});await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.profile-editor-modal').waitFor({state:'hidden'});
  results.push({name:'打包应用的系统关窗保护保留未保存草稿',status:'passed'});
  const profile=await manager.evaluate(({startUrl,profileOs})=>window.api.create({name:'安装包运行测试',os:profileOs,country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl}),{startUrl:`http://qa.local:${origin.port}/probe`,profileOs});
  const next=app.waitForEvent('window');await manager.evaluate(id=>window.api.browse(id),profile.id);const browser=await next;
  let early;
  for(let i=0;i<100&&!early;i++){
   early=await app.evaluate(async({webContents},id)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/probe')&&!w.isLoading());return guest?guest.executeJavaScript('window.early'):null;},profile.id);
   if(!early)await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(early?.platform,profileOs==='mac'?'MacIntel':'Win32');assert.equal(early?.language,'ja-JP');assert.equal(early?.tz,'Asia/Tokyo');
  results.push({name:'asar 内浏览器资源、动态 preload 与首屏指纹',status:'passed',detail:early});
  const nativeDate=await app.evaluate(async({webContents},id)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/probe'));return guest.executeJavaScript("(()=>{const d=new Date('2026-01-15T12:00:00Z');return {month:d.getMonth(),hour:d.getHours(),offset:d.getTimezoneOffset(),utc:new Intl.DateTimeFormat('en-GB',{timeZone:'UTC'}).resolvedOptions().timeZone,invalid:Number.isNaN(new Date('invalid').getMonth())};})()");},profile.id);
  assert.deepEqual(nativeDate,{month:0,hour:21,offset:-540,utc:'UTC',invalid:true});
  const audit=await manager.evaluate(id=>window.api.fingerprintAudit(id),profile.id);assert.equal(audit.differences,0);assert.equal(audit.workerError,'');assert.equal(audit.rows.find(row=>row.context==='Worker'&&row.label==='时区').actual,'Asia/Tokyo');
  results.push({name:'打包应用原生日期语义与实际网页/Worker/CSS检查',status:'passed',detail:{nativeDate,rows:audit.rows.length,unknown:audit.unknown}});
  await browser.locator('#gear').click();
  assert.equal(await browser.locator('#s-start').inputValue(),'http://qa.local:'+origin.port+'/probe');
  assert.equal(await browser.locator('#s-language').inputValue(),'ja-JP');
  await browser.locator('#s-language').selectOption('en-GB');await browser.locator('#s-timezone').selectOption('Europe/London');await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});
  let settingsEarly;
  for(let i=0;i<100&&!settingsEarly;i++){
   settingsEarly=await app.evaluate(async({webContents},id)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/probe')&&!w.isLoading());return guest?guest.executeJavaScript('window.early'):null;},profile.id);
   if(!settingsEarly)await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(settingsEarly?.language,'en-GB');assert.equal(settingsEarly?.tz,'Europe/London');
  results.push({name:'安装包内设置资源、准确回填与保存后首脚本生效',status:'passed',detail:settingsEarly});
  await browser.locator('#gear').click();await browser.locator('#s-language').selectOption('ja-JP');await browser.locator('#s-timezone').selectOption('Asia/Tokyo');await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});
  await browser.waitForFunction(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/probe'));
  const sourceTab=await browser.evaluate(()=>({id:activeId,guest:activeTab().web.getWebContentsId()}));
  await browser.evaluate(url=>createTab(url),'http://localhost:'+origin.port+'/sync');
  for(let i=0;i<100;i++){if(await browser.evaluate(()=>activeTab().web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/sync')))break;await new Promise(resolve=>setTimeout(resolve,50));}
  await browser.evaluate(id=>{StarTabs.pin(id);StarTabs.mute(id);},sourceTab.id);await browser.evaluate(id=>StarTabs.sleep(id),sourceTab.id);
  assert.equal(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),sourceTab.guest),false);assert.equal(await browser.evaluate(id=>tabs.find(t=>t.id===id).sleeping,sourceTab.id),true);
  await browser.evaluate(id=>activateTab(id),sourceTab.id);let woke=false;for(let i=0;i<100&&!woke;i++){woke=await browser.evaluate(id=>{const t=tabs.find(t=>t.id===id);return t.web?.__starReady&&!t.web.isLoading()&&t.web.getURL().includes('/probe');},sourceTab.id);if(!woke)await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(woke,true);assert.equal(await browser.evaluate(()=>activeTab().muted&&activeTab().pinned),true);
  results.push({name:'打包应用的固定/静音及真实标签休眠/唤醒',status:'passed'});
  await app.evaluate(async({session},id)=>{await session.fromPartition('persist:tfb-env-'+id).cookies.set({url:'http://qa.local',name:'packageQA',value:'yes',expirationDate:Date.now()/1000+3600});},profile.id);
  assert.equal((await manager.evaluate(id=>window.api.cookieCount(id),profile.id)).count,1);
  assert.equal((await manager.evaluate(()=>window.api.localApiStatus())).listening,false);
  assert.ok((await manager.evaluate(()=>window.api.localApiDocs())).includes('/v1/profiles/<id>/start'));
  const api=await manager.evaluate(()=>window.api.localApiConfigure({enabled:true,port:0}));
  const token=JSON.parse(fs.readFileSync(path.join(data,'local-api.json'),'utf8')).token;
  const response=await fetch(api.url+'/v1/health',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);assert.equal((await response.json()).data.version,await app.evaluate(({app})=>app.getVersion()));
  await manager.evaluate(()=>window.api.localApiConfigure({enabled:false}));
  results.push({name:'打包应用的 Cookie、IPC 与实际本地 API',status:'passed'});
  await browser.screenshot({path:path.join(root,'test-results/packaged-browser.png')});
  await manager.screenshot({path:path.join(root,'test-results/packaged-management.png')});
  await manager.evaluate(id=>window.api.action('stop',[id]),profile.id);
  const backupFile=path.join(data,'package.starbackup');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backupFile);
  assert.equal((await manager.evaluate(({id})=>window.api.backupExport([id],'package-test-password'),{id:profile.id})).count,1);
  const backupPreview=await manager.evaluate(()=>window.api.backupPreview('package-test-password'));assert.equal(backupPreview.count,1);
  const restored=await manager.evaluate(token=>window.api.backupRestore(token),backupPreview.token);assert.equal(restored.count,1);assert.notEqual(restored.profiles[0].id,profile.id);
  assert.equal((await manager.evaluate(id=>window.api.cookieCount(id),restored.profiles[0].id)).count,1);
  results.push({name:'打包应用的实际加密环境备份与恢复',status:'passed'});
  await manager.evaluate(async ids=>{for(const id of ids)await window.api.browse(id);},[profile.id,restored.profiles[0].id]);
  let syncReady=false;
  for(let i=0;i<100&&!syncReady;i++){try{await manager.evaluate(config=>window.api.syncStart(config),{master:profile.id,followers:[restored.profiles[0].id],navigation:false});syncReady=true;}catch(error){if(!error.message.includes('等待页面就绪'))throw error;await new Promise(resolve=>setTimeout(resolve,50));}}
  assert.equal(syncReady,true);assert.equal((await manager.evaluate(()=>window.api.syncStatus())).active,true);
  await manager.evaluate(()=>window.api.syncPause(true));assert.equal((await manager.evaluate(()=>window.api.syncStatus())).paused,true);
  await manager.evaluate(()=>window.api.syncPause(false));await manager.evaluate(()=>window.api.syncStop());assert.equal((await manager.evaluate(()=>window.api.syncStatus())).active,false);
  results.push({name:'打包应用的实际主从窗口同步生命周期',status:'passed'});
  const savedTask=await manager.evaluate(url=>window.api.taskSave({name:'安装包任务',steps:[{type:'navigate',url},{type:'waitFor',selector:'body'},{type:'screenshot'}]}),'http://localhost:'+origin.port+'/sync');
  const [taskRun]=await manager.evaluate(({id,profile})=>window.api.taskStart(id,[profile]),{id:savedTask.id,profile:profile.id});let taskResult;
  for(let i=0;i<150;i++){taskResult=(await manager.evaluate(()=>window.api.snapshot())).taskRuns.find(run=>run.id===taskRun.id);if(['completed','failed'].includes(taskResult?.state))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(taskResult?.state,'completed',taskResult?.error);assert.equal(taskResult.outputs.length,1);assert.deepEqual([...fs.readFileSync(taskResult.outputs[0].path).subarray(0,8)],[137,80,78,71,13,10,26,10]);
  results.push({name:'打包应用中的实际任务执行与截图',status:'passed'});
  const taskFile=path.join(data,'package-tasks.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},taskFile);
  assert.equal((await manager.evaluate(id=>window.api.taskExport([id]),savedTask.id)).count,1);if(platform!=='win32')assert.equal(fs.statSync(taskFile).mode&0o777,0o600);assert.equal(JSON.parse(fs.readFileSync(taskFile,'utf8')).tasks[0].id,undefined);
  const taskPreview=await manager.evaluate(()=>window.api.taskImportPreview());assert.equal(taskPreview.count,1);const importedTask=await manager.evaluate(token=>window.api.taskImportApply(token),taskPreview.token);assert.equal(importedTask.count,1);assert.notEqual(importedTask.ids[0],savedTask.id);assert.equal((await manager.evaluate(()=>window.api.snapshot())).taskRuns.length,1);
  results.push({name:'打包应用的真实任务文件导出、预览与独立导入',status:'passed'});
  const installedChrome=(await manager.evaluate(()=>window.api.snapshot())).engine.chrome;
  if(installedChrome){
  await manager.evaluate(id=>window.api.action('stop',[id]),profile.id);await manager.evaluate(id=>window.api.launch(id),profile.id);
  const chromeVersion=await app.evaluate(({app} ,id)=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');return require('./src/main/launcher').getLaunchedBrowser(id).fingerprint.chromeVersion;},profile.id);
  assert.equal((await manager.evaluate(id=>window.api.preview(id),profile.id)).chromeVersion,chromeVersion);
  const secondChromeTab=await app.evaluate(async({app},{id,url})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');return (await require('./src/main/launcher').getLaunchedBrowser(id).pipe.send('Target.createTarget',{url})).targetId;},{id:profile.id,url:'http://localhost:'+origin.port+'/sync?private=package'});
  let chromeAudit;for(let i=0;i<100;i++){try{chromeAudit=await manager.evaluate(({id,target})=>window.api.fingerprintAudit(id,target),{id:profile.id,target:secondChromeTab});break;}catch(error){if(!/未就绪|仍在加载/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,50));}}
  assert.ok(chromeAudit);assert.equal(chromeAudit.targetId,secondChromeTab);assert.ok(chromeAudit.url.endsWith('/sync'));assert.equal(chromeAudit.differences,0);
  assert.equal((await manager.evaluate(id=>window.api.fingerprintPages(id),profile.id)).pages.length,2);
  const chromePid=await app.evaluate(({app},id)=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');return require('./src/main/launcher').getLaunchedBrowser(id).child.pid;},profile.id);
  await manager.evaluate(id=>window.api.action('stop',[id]),profile.id);assert.throws(()=>process.kill(chromePid,0),{code:'ESRCH'});
  results.push({name:'打包应用中的真实 Chrome 多标签选择检查与运行配置',status:'passed'});
  }else{results.push({name:'打包应用中的真实 Chrome 多标签选择检查与运行配置',status:'not-exercised',detail:'测试主机没有安装独立 Chrome，未验证此路径'});}
  console.log(`Packaged ${platform} ${architecture} app: ${results.filter(row=>row.status==='passed').length} checks passed.`);
 }catch(error){console.error(error);results.push({name:'打包应用测试',status:'failed',error:error.stack});process.exitCode=1;}
 finally{
  if(app){await app.evaluate(async({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),browsers=require('./src/main/launcher').getLaunchedBrowsers();await Promise.all(browsers.map(async([,running])=>{await running.pipe.send('Browser.close').catch(()=>running.child.kill());for(let i=0;i<150&&running.child.exitCode===null&&running.child.signalCode===null;i++)await new Promise(resolve=>setTimeout(resolve,30));if(running.child.exitCode===null&&running.child.signalCode===null)running.child.kill();}));}).catch(()=>{});await app.close().catch(()=>{});}
  if(origin)await origin.close();
  fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const report={platform,arch:architecture,version:packageVersion,executable,status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results};
  for(const name of ['package-smoke.json',`package-smoke-${platform}-${architecture}.json`])fs.writeFileSync(path.join(root,'test-results',name),JSON.stringify(report,null,2)+'\n');
 }
})();
