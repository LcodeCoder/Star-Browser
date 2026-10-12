'use strict';
const {_electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const http=require('node:http');
const {startOrigin}=require('./fixtures.cjs');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-api-'));const results=[];let app,manager,origin,base,token,busyServer;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){await run();results.push({name,status:'passed'});console.log('PASS',name);}
async function request(method,url,body,extra={}){if(extra.Host)return new Promise((resolve,reject)=>{const req=http.request(base+url,{method,headers:{Authorization:'Bearer '+token,...extra}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(text)}));});req.on('error',reject);req.end();});const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};}
async function until(run){const limit=Date.now()+15000;while(Date.now()<limit){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('等待 API 测试条件超时');}
(async()=>{
 try{
  origin=await startOrigin();app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  await check('本地 API 默认关闭，通过实际设置开启，密钥文件权限受限',async()=>{
   assert.equal((await api('localApiStatus')).listening,false);await manager.locator('#navSettings').click();const toggle=manager.getByRole('switch',{name:'本地自动化 API'});await toggle.waitFor();await until(async()=>!(await toggle.isDisabled()));await toggle.click();const status=await until(async()=>{const s=await api('localApiStatus');return s.listening?s:null;});base=status.url;
   const file=path.join(data,'local-api.json');token=JSON.parse(fs.readFileSync(file)).token;assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal((await request('GET','/v1/health')).status,200);await manager.waitForFunction(url=>document.querySelector('.api-address')?.textContent===url,base);await manager.screenshot({path:path.resolve('test-results/local-api-settings.png')});
  });
  await check('真实 HTTP 鉴权、网页来源拒绝与 JSON 约束',async()=>{
   assert.equal((await request('GET','/v1/health',undefined,{Authorization:'Bearer wrong'})).status,401);
   assert.equal((await request('GET','/v1/health',undefined,{Origin:'https://example.test'})).status,403);
   assert.equal((await request('GET','/v1/health',undefined,{Host:'evil.example'})).status,403);
   assert.equal((await request('POST','/v1/profiles',{name:'Bad'},{'Content-Type':'text/plain'})).status,415);
   assert.equal((await request('POST','/v1/profiles',{note:'x'.repeat(1024*1024+1)})).status,413);
  });
  let profile,copy;
  await check('真实 HTTP 创建、过滤、更新与凭据脱敏',async()=>{
   const created=await request('POST','/v1/profiles',{name:'API 配置 QA',group:'API',tags:['qa'],proxy:{type:'http',host:'127.0.0.1',port:'1',user:'qa-account',pass:'qa-test-password'}});assert.equal(created.status,201);profile=created.value.data;
   assert.equal(JSON.stringify(created.value).includes('qa-test-password'),false);assert.equal(profile.proxy.user,undefined);
   const updated=await request('PATCH','/v1/profiles/'+profile.id,{note:'updated',pinned:true});assert.equal(updated.status,200);assert.equal(updated.value.data.note,'updated');
   const list=await request('GET','/v1/profiles?group=API&tag=qa&search=QA');assert.equal(list.value.total,1);assert.equal(JSON.stringify(list.value).includes('qa-account'),false);
   const clone=await request('POST','/v1/profiles/'+profile.id+'/clone',{});assert.equal(clone.status,201);copy=clone.value.data;assert.notEqual(copy.id,profile.id);assert.notEqual(copy.seed,profile.seed);
  });
  await check('启动前校验、并发启动复用、首文档指纹与可靠停止',async()=>{
   assert.equal((await request('POST','/v1/profiles/'+profile.id+'/start',{})).status,400);
   const created=await request('POST','/v1/profiles',{name:'API 浏览 QA',os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:'http://localhost:'+origin.port+'/probe'});const id=created.value.data.id;
   const starts=await Promise.all([request('POST','/v1/profiles/'+id+'/start',{}),request('POST','/v1/profiles/'+id+'/start',{})]);assert.ok(starts.every(r=>r.status===200));
   assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().filter(w=>w._profile?.id===id).length,id),1);
   const early=await until(()=>app.evaluate(async({webContents},id)=>{const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&!w.isLoading()&&w.getURL().includes('/probe'));return wc?wc.executeJavaScript('window.early'):null;},id));assert.equal(early.language,'ja-JP');assert.equal(early.tz,'Asia/Tokyo');
   assert.equal((await request('DELETE','/v1/profiles/'+id)).status,409);assert.equal((await request('POST','/v1/profiles/'+id+'/stop',{})).status,200);
   assert.equal((await request('GET','/v1/profiles/'+id)).value.data.running,false);assert.equal((await request('DELETE','/v1/profiles/'+id)).status,200);
  });
  await check('密钥轮换即时失效旧密钥，端口冲突保留原服务',async()=>{
   const old=token;await api('localApiRotateToken');token=JSON.parse(fs.readFileSync(path.join(data,'local-api.json'))).token;assert.notEqual(token,old);
   assert.equal((await request('GET','/v1/health',undefined,{Authorization:'Bearer '+old})).status,401);assert.equal((await request('GET','/v1/health')).status,200);
   busyServer=http.createServer();await new Promise(resolve=>busyServer.listen(0,'127.0.0.1',resolve));await assert.rejects(api('localApiConfigure',{enabled:true,port:busyServer.address().port}),/端口/);
   const restored=await api('localApiStatus');assert.equal(restored.listening,true);base=restored.url;assert.equal((await request('GET','/v1/health')).status,200);
  });
  await check('接口说明可读取，关闭服务后连接停止',async()=>{
   assert.ok((await api('localApiDocs')).includes('/v1/profiles/<id>/start'));await api('localApiConfigure',{enabled:false});assert.equal((await api('localApiStatus')).listening,false);await assert.rejects(fetch(base+'/v1/health'));
  });
 }catch(error){console.error(error);results.push({name:'本地 API 实际验证',status:'failed',error:error.stack});process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.resolve('test-results/local-api-failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();if(busyServer)await new Promise(resolve=>busyServer.close(resolve));fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/local-api.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
