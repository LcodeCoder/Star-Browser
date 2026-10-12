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
  await app.evaluate(async({session},id)=>{await session.fromPartition('persist:tfb-env-'+id).cookies.set({url:'http://qa.local',name:'packageQA',value:'yes',expirationDate:Date.now()/1000+3600});},profile.id);
  assert.equal((await manager.evaluate(id=>window.api.cookieCount(id),profile.id)).count,1);
  assert.equal((await manager.evaluate(()=>window.api.localApiStatus())).listening,false);
  assert.ok((await manager.evaluate(()=>window.api.localApiDocs())).includes('/v1/profiles/<id>/start'));
  const api=await manager.evaluate(()=>window.api.localApiConfigure({enabled:true,port:0}));
  const token=JSON.parse(fs.readFileSync(path.join(data,'local-api.json'),'utf8')).token;
  const response=await fetch(api.url+'/v1/health',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);assert.equal((await response.json()).data.version,'0.3.0');
  await manager.evaluate(()=>window.api.localApiConfigure({enabled:false}));
  results.push({name:'打包应用的 Cookie、IPC 与实际本地 API',status:'passed'});
  await browser.screenshot({path:path.join(root,'test-results/packaged-browser.png')});
  await manager.screenshot({path:path.join(root,'test-results/packaged-management.png')});
  console.log('Packaged macOS app: 4 checks passed.');
 }catch(error){console.error(error);results.push({name:'打包应用测试',status:'failed',error:error.stack});process.exitCode=1;}
 finally{
  if(app)await app.close().catch(()=>{});
  if(origin)await origin.close();
  fs.rmSync(data,{recursive:true,force:true});
  fs.writeFileSync(path.join(root,'test-results/package-smoke.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');
 }
})();
