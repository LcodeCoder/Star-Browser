'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-launch-experience-'));
const output=path.resolve('test-results/launch-experience');fs.mkdirSync(output,{recursive:true});
const results=[],errors=[];let app,manager,profile;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function until(fn,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Launch condition timeout');}
async function check(name,fn){const start=Date.now();try{const detail=await fn();results.push({name,status:'passed',durationMs:Date.now()-start,detail});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
(async()=>{
 try{
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  profile=await api('create',{name:'启动体验',startUrl:'about:home',timezone:'Asia/Tokyo',timezoneManual:true,language:'ja-JP',langManual:true});await manager.getByRole('button',{name:'刷新工作台'}).click();
  await check('启动进度显示实际步骤，重复启动合并，窗口握手后才完成',async()=>{
   await app.evaluate(async()=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const library=require('./src/main/extensions').getExtensionLibrary();const original=library.loadForSession;const gate=new Promise(resolve=>{globalThis.__starLaunchRelease=resolve;});library.loadForSession=async function(...args){await gate;return original.apply(this,args);};globalThis.__starLaunchRestore=()=>{library.loadForSession=original;};});
   const pending=api('browse',profile.id);const duplicate=api('browse',profile.id);pending.catch(()=>{});duplicate.catch(()=>{});
   const state=await until(async()=>{const record=(await api('snapshot')).startups.find(r=>r.id===profile.id);return record?.stage==='extensions'&&record;});assert.equal(state.status,'starting');await assert.rejects(api('update',profile.id,{note:'would race'}),/正在启动/);await assert.rejects(api('remove',profile.id),/正在启动/);await assert.rejects(api('launch',profile.id),/正在通过另一方式启动/);await assert.rejects(api('action','archive',[profile.id]),/正在启动/);
   const row=manager.locator('[data-profile-id="'+profile.id+'"]');await row.getByText('准备扩展',{exact:true}).waitFor();assert.ok(await row.locator('.launch-button').isDisabled());assert.ok(await row.getByRole('button',{name:'编辑 启动体验',exact:true}).isDisabled());await row.locator('.profile-name').click();await manager.getByLabel('环境启动状态',{exact:true}).waitFor();assert.match(await manager.getByLabel('环境启动状态',{exact:true}).innerText(),/准备扩展/);assert.ok(await manager.getByRole('button',{name:'启动中…',exact:true}).isDisabled());assert.ok(await manager.getByRole('button',{name:'编辑环境',exact:true}).isDisabled());
   for(const theme of ['light','dark']){await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await manager.screenshot({animations:'disabled',path:path.join(output,'progress-'+theme+'.png')});}
   await app.evaluate(async()=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const library=require('./src/main/extensions').getExtensionLibrary();globalThis.__starLaunchRestore();globalThis.__starLaunchRelease();delete globalThis.__starLaunchRestore;delete globalThis.__starLaunchRelease;});
   assert.deepEqual(await pending,{ok:true});assert.deepEqual(await duplicate,{ok:true});
   const record=(await api('snapshot')).startups.find(r=>r.id===profile.id);assert.equal(record.status,'ready');assert.equal(record.stage,'ready');assert.ok(record.durationMs>=0);
   const windows=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().filter(w=>w._profile?.id===id).map(w=>({ready:w._starBrowseReady,destroyed:w.isDestroyed()})),profile.id);assert.equal(windows.length,1);assert.equal(windows[0].ready,true);await api('action','stop',[profile.id]);return {stage:state.stage,deduplicatedWindows:windows.length,handshake:windows[0].ready,durationMs:record.durationMs};
  });
  await check('代理失败保留原因与重试入口，未创建窗口也未记作已打开',async()=>{
   const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
   await api('update',profile.id,{proxy:{type:'http',host:'127.0.0.1',port}});await assert.rejects(api('browse',profile.id),/代理不可达/);
   const record=(await api('snapshot')).startups.find(r=>r.id===profile.id);assert.equal(record.status,'failed');assert.equal(record.stage,'proxy');assert.match(record.error,/代理/);
   assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().filter(w=>w._profile?.id===id).length,profile.id),0);
   await manager.getByRole('button',{name:'刷新工作台'}).click();await manager.getByLabel('环境启动状态',{exact:true}).waitFor();assert.match(await manager.getByLabel('环境启动状态',{exact:true}).innerText(),/代理不可达/);await manager.getByRole('button',{name:'检查代理配置',exact:true}).waitFor();await manager.getByRole('button',{name:'重新启动',exact:true}).waitFor();await manager.screenshot({animations:'disabled',path:path.join(output,'failure-dark.png')});
   await manager.getByRole('button',{name:'检查代理配置',exact:true}).click();await manager.locator('#modal').waitFor();await manager.keyboard.press('Escape');await manager.locator('#modal').waitFor({state:'hidden'});return {failureStage:record.stage,error:record.error,windowsCreated:0};
  });
  await check('修正配置后真实重试成功，清除旧失败并返回运行状态',async()=>{
   await api('update',profile.id,{proxy:null});await manager.getByRole('button',{name:'刷新工作台'}).click();await manager.getByRole('button',{name:'重新启动',exact:true}).click();
   await until(async()=>{const record=(await api('snapshot')).startups.find(r=>r.id===profile.id);return record?.status==='ready';});await manager.getByRole('button',{name:'切回浏览器',exact:true}).waitFor();assert.equal(await manager.getByLabel('环境启动状态',{exact:true}).count(),0);const profileWindows=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().filter(w=>w._profile?.id===id).length,profile.id);assert.equal(profileWindows,1);await api('action','stop',[profile.id]);return {retrySucceeded:true,windows:profileWindows};
  });
  await check('原生内核未验收时停在内核检查，失败不会改用本机 Chrome',async()=>{
   const report=path.join(data,'unaccepted-native.json');fs.writeFileSync(report,JSON.stringify({schemaVersion:1,status:'hardware-rejected'}));
   const original=await app.evaluate((_,report)=>{const prior={executable:process.env.STAR_NATIVE_KERNEL_EXECUTABLE,acceptance:process.env.STAR_NATIVE_KERNEL_ACCEPTANCE};process.env.STAR_NATIVE_KERNEL_EXECUTABLE='missing-native-browser';process.env.STAR_NATIVE_KERNEL_ACCEPTANCE=report;return prior;},report);
   try{await assert.rejects(api('launch',profile.id),/缺少有效的原生硬件验收报告/);const state=(await api('snapshot')).startups.find(r=>r.id===profile.id);assert.equal(state.status,'failed');assert.equal(state.stage,'kernel');const launched=await app.evaluate((_,id)=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');return !!require('./src/main/launcher').getLaunchedBrowser(id);},profile.id);assert.equal(launched,false);return {stage:state.stage,error:state.error};}
   finally{await app.evaluate((_,prior)=>{for(const [key,value]of Object.entries({STAR_NATIVE_KERNEL_EXECUTABLE:prior.executable,STAR_NATIVE_KERNEL_ACCEPTANCE:prior.acceptance})){if(value===undefined)delete process.env[key];else process.env[key]=value;}},original);}
  });
  await check('归档环境的失败停在配置检查，状态快照缓存不会隐藏新错误',async()=>{
   const before=await api('snapshot');assert.equal((await api('snapshot',before.token)).unchanged,true);await api('update',profile.id,{archived:true});await assert.rejects(api('browse',profile.id),/恢复归档/);const after=await api('snapshot',before.token);assert.equal(after.unchanged,undefined);const record=after.startups.find(r=>r.id===profile.id);assert.equal(record.stage,'checking');assert.equal(record.status,'failed');
  });
  await check('启动交互没有未捕获页面错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);process.exitCode=1;if(manager)await manager.screenshot({animations:'disabled',path:path.join(output,'test-failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,errors},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
