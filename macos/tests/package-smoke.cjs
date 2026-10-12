'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {startOrigin}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..');
const bundle=path.join(root,'dist/mac-arm64/Star Browser.app');
const executable=path.join(bundle,'Contents/MacOS/Star Browser');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'changyi-package-'));
const results=[];
let app,origin;
(async()=>{
 try{
  assert.ok(fs.existsSync(executable),'先运行 npm run build:mac');
  const signature=execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',bundle],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  results.push({name:'打包 .app 的完整签名校验',status:'passed',detail:signature.trim()||'valid'});
  origin=await startOrigin();
  app=await _electron.launch({executablePath:executable,args:['--host-resolver-rules=MAP qa.local 127.0.0.1'],cwd:root,env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});
  const manager=await app.firstWindow();await manager.waitForFunction(()=>typeof window.api==='object');await manager.locator('#btnNew').waitFor();
  const metadata=await app.evaluate(({app})=>({packaged:app.isPackaged,platform:process.platform,arch:process.arch,electron:process.versions.electron,executable:process.execPath}));
  assert.equal(metadata.packaged,true);assert.equal(metadata.arch,'arm64');assert.equal(await manager.title(),'Star Browser');
  results.push({name:'安装包中的应用实际启动与管理界面',status:'passed',detail:metadata});
  const profile=await manager.evaluate(startUrl=>window.api.create({name:'安装包运行测试',os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl}),`http://qa.local:${origin.port}/probe`);
  const next=app.waitForEvent('window');await manager.evaluate(id=>window.api.browse(id),profile.id);const browser=await next;
  let early;
  for(let i=0;i<100&&!early;i++){
   early=await app.evaluate(async({webContents},id)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/probe')&&!w.isLoading());return guest?guest.executeJavaScript('window.early'):null;},profile.id);
   if(!early)await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(early?.platform,'MacIntel');assert.equal(early?.language,'ja-JP');assert.equal(early?.tz,'Asia/Tokyo');
  results.push({name:'asar 内浏览器资源、动态 preload 与首屏指纹',status:'passed',detail:early});
  const nativeDate=await app.evaluate(async({webContents},id)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/probe'));return guest.executeJavaScript("(()=>{const d=new Date('2026-01-15T12:00:00Z');return {month:d.getMonth(),hour:d.getHours(),offset:d.getTimezoneOffset(),utc:new Intl.DateTimeFormat('en-GB',{timeZone:'UTC'}).resolvedOptions().timeZone,invalid:Number.isNaN(new Date('invalid').getMonth())};})()");},profile.id);
  assert.deepEqual(nativeDate,{month:0,hour:21,offset:-540,utc:'UTC',invalid:true});
  const audit=await manager.evaluate(id=>window.api.fingerprintAudit(id),profile.id);assert.equal(audit.differences,0);assert.equal(audit.workerError,'');assert.equal(audit.rows.find(row=>row.context==='Worker'&&row.label==='时区').actual,'Asia/Tokyo');
  results.push({name:'打包应用原生日期语义与实际网页/Worker/CSS检查',status:'passed',detail:{nativeDate,rows:audit.rows.length,unknown:audit.unknown}});
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
  console.log('Packaged macOS app: 8 checks passed.');
 }catch(error){console.error(error);results.push({name:'打包应用测试',status:'failed',error:error.stack});process.exitCode=1;}
 finally{
  if(app)await app.close().catch(()=>{});
  if(origin)await origin.close();
  fs.rmSync(data,{recursive:true,force:true});
  fs.writeFileSync(path.join(root,'test-results/package-smoke.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');
 }
})();
