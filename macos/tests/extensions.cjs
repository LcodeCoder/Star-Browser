'use strict';
const {_electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-extensions-'));const results=[];let app,manager,origin;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function until(run){const limit=Date.now()+20000;while(Date.now()<limit){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('等待扩展测试条件超时');}
async function check(name,run){await run();results.push({name,status:'passed'});console.log('PASS',name);}
async function marker(id){return app.evaluate(async({webContents},id)=>{const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&!w.isLoading()&&w.getURL().includes('/probe'));return wc?wc.executeJavaScript('({name:document.body.dataset.starExtension,count:document.body.dataset.extensionCount})'):null;},id);}
async function close(id){await app.evaluate(({BrowserWindow},id)=>{for(const w of BrowserWindow.getAllWindows())if(w._profile?.id===id)w.close();},id);await until(()=>app.evaluate(({BrowserWindow},id)=>!BrowserWindow.getAllWindows().some(w=>w._profile?.id===id),id));}
(async()=>{
 try{
  origin=await startOrigin();const source=path.join(data,'source');fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({manifest_version:3,name:'Star QA Extension',description:'仅用于验证本地加载与独立存储',version:'1.0.0',permissions:['storage'],content_scripts:[{matches:['http://localhost/*'],js:['content.js'],run_at:'document_start'}]}));
  fs.writeFileSync(path.join(source,'content.js'),"document.addEventListener('DOMContentLoaded',()=>chrome.storage.local.get(['count'],r=>{document.body.dataset.starExtension=chrome.runtime.getManifest().name;document.body.dataset.extensionCount=String(r.count||0);chrome.storage.local.set({count:(r.count||0)+1});}));");
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)},timeout:30000});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
  let extension;
  await check('通过扩展库预览、权限确认与添加，保存独立副本',async()=>{
   await manager.locator('#navExtensions').click();await manager.getByRole('button',{name:'添加扩展',exact:true}).first().click();const dialog=manager.getByRole('dialog',{name:'添加到扩展库'});await dialog.waitFor();assert.ok((await dialog.textContent()).includes('http://localhost/*'));await dialog.getByRole('button',{name:'添加扩展',exact:true}).click();
   extension=await until(async()=>(await api('snapshot')).extensions[0]);assert.equal(extension.name,'Star QA Extension');assert.ok(fs.existsSync(path.join(data,'extensions',extension.id,'content.js')));fs.rmSync(source,{recursive:true});await dialog.waitFor({state:'hidden'});const row=manager.locator('[data-extension-id="'+extension.id+'"]');await row.waitFor();await row.locator('summary').click();await manager.waitForFunction(()=>!document.querySelector('.dialog-overlay'));await manager.screenshot({path:path.resolve('test-results/extensions-library.png')});
  });
  const base={os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:'http://localhost:'+origin.port+'/probe'};
  const a=await api('create',{...base,name:'扩展环境 A'}),b=await api('create',{...base,name:'扩展环境 B',extensions:[extension.id]}),plain=await api('create',{...base,name:'无扩展环境'});
  await check('环境设置中的扩展勾选保存后在内置浏览器实际运行',async()=>{
   await manager.locator('#navEnv').click();await manager.locator('[data-act="edit"][data-id="'+a.id+'"]').click();await manager.getByRole('checkbox',{name:'启用 Star QA Extension'}).check();await manager.locator('#btnSave').click();
   assert.deepEqual((await api('list')).find(p=>p.id===a.id).extensions,[extension.id]);await api('browse',a.id);const result=await until(async()=>{const row=await marker(a.id);return row?.name==='Star QA Extension'?row:null;});assert.equal(result.count,'0');
  });
  await check('扩展 storage 在两个环境隔离，未分配环境不加载',async()=>{
   await api('browse',b.id);const first=await until(async()=>{const row=await marker(b.id);return row?.name==='Star QA Extension'?row:null;});assert.equal(first.count,'0');await api('browse',plain.id);const absent=await until(()=>marker(plain.id));assert.equal(absent.name,undefined);
   const count=await app.evaluate(({session},id)=>session.fromPartition('persist:tfb-env-'+id).extensions.getAllExtensions().length,plain.id);assert.equal(count,0);
  });
  await check('运行中阻止移除，关闭恢复后扩展数据仍持久',async()=>{
   await assert.rejects(api('extensionRemove',extension.id),/先停止/);await close(a.id);await api('browse',a.id);const restored=await until(async()=>{const row=await marker(a.id);return row?.name==='Star QA Extension'?row:null;});assert.equal(restored.count,'1');await close(a.id);await close(b.id);await close(plain.id);
  });
  const native=await api('create',{...base,name:'本机扩展 QA',extensions:[extension.id]});
  await check('本机 Chrome 加载用户扩展并执行真实内容脚本',async()=>{
   await api('launch',native.id);
   const value=await until(()=>app.evaluate(async(_,id)=>{const launcher=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('./src/main/launcher');const running=launcher.getLaunchedBrowser(id);if(!running)return null;const {targetInfos}=await running.pipe.send('Target.getTargets');const target=targetInfos.find(t=>t.type==='page'&&t.url.includes('/probe'));const attached=target&&running.pageSessions.get(target.targetId);if(!attached)return null;await attached.ready;const result=await running.pipe.send('Runtime.evaluate',{expression:'document.body?.dataset.starExtension',returnByValue:true},attached.sessionId);return result.result?.value;},native.id));assert.equal(value,'Star QA Extension');
   await api('action','stop',[native.id]);
  });
  await check('移除扩展清理环境配置，下次启动不再加载',async()=>{
   await api('extensionRemove',extension.id);assert.equal((await api('snapshot')).extensions.length,0);assert.ok((await api('list')).every(p=>!p.extensions.includes(extension.id)));assert.equal(fs.existsSync(path.join(data,'extensions',extension.id)),false);await api('browse',a.id);const noExtension=await until(()=>marker(a.id));assert.equal(noExtension.name,undefined);
  });
 }catch(error){console.error(error);results.push({name:'扩展实际验证',status:'failed',error:error.stack});process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.resolve('test-results/extensions-failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/extensions.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
