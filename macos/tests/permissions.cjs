'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-permissions-'));
const results=[];let app,origin,manager;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function until(run){const limit=Date.now()+15000;while(Date.now()<limit){const result=await run();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw new Error('等待权限测试条件超时');}
async function check(name,run){await run();results.push({name,status:'passed'});console.log('PASS',name);}
async function guest(id,expression){return app.evaluate(async({webContents},{id,expression})=>{
 const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&!w.isLoading());
 if(!wc)return null;return {value:await wc.executeJavaScript(expression,true)};
},{id,expression});}
(async()=>{
 try{
  origin=await startOrigin();app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  await app.evaluate(({dialog})=>{globalThis.starPermissionDialogs=[];dialog.showMessageBox=async(parent,options)=>{globalThis.starPermissionDialogs.push(options);return {response:0};};});
  const base={os:'mac',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:'http://localhost:'+origin.port+'/probe'};
  const ask=await api('create',{...base,name:'权限询问 QA',permissions:{notifications:'ask'}});
  await api('browse',ask.id);await until(()=>guest(ask.id,'document.readyState'));
  await check('询问模式真实请求触发网站来源提示并遵守拒绝',async()=>{
   const result=await guest(ask.id,'Notification.requestPermission()');assert.equal(result.value,'denied');
   const dialogs=await app.evaluate(()=>globalThis.starPermissionDialogs);assert.equal(dialogs.length,1);assert.ok(dialogs[0].message.includes('localhost:'+origin.port));assert.ok(dialogs[0].title.includes('权限询问 QA'));assert.equal(dialogs[0].defaultId,0);
  });
  const blocked=await api('create',{...base,name:'拒绝权限 QA',permissions:{notifications:'block',geolocation:'block'}});await api('browse',blocked.id);await until(()=>guest(blocked.id,'document.readyState'));
  await check('始终拒绝的环境不会弹窗或隐式允许',async()=>{
   assert.equal((await guest(blocked.id,'Notification.requestPermission()')).value,'denied');assert.equal((await app.evaluate(()=>globalThis.starPermissionDialogs)).length,1);
  });
  const allowed=await api('create',{...base,name:'允许权限 QA',permissions:{notifications:'allow',geolocation:'allow'}});await api('browse',allowed.id);await until(()=>guest(allowed.id,'document.readyState'));
  await check('显式允许的环境权限检查返回已允许，其他环境保持独立',async()=>{
   assert.equal((await guest(allowed.id,"navigator.permissions.query({name:'geolocation'}).then(p=>p.state)")).value,'granted');
   assert.notEqual((await guest(blocked.id,"navigator.permissions.query({name:'geolocation'}).then(p=>p.state)")).value,'granted');
   assert.equal((await app.evaluate(()=>globalThis.starPermissionDialogs)).length,1);
  });
 }catch(error){console.error(error);results.push({name:'网站权限验证',status:'failed',error:error.stack});process.exitCode=1;}
 finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/permissions.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});}
})();
