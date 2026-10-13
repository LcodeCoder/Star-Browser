'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-proxy-workspace-')),output=path.resolve('test-results/proxy-workspace');
fs.mkdirSync(output,{recursive:true});const results=[],errors=[];let app,manager,profile,proxy;
const shortcut=process.platform==='darwin'?'Meta+Enter':'Control+Enter';
const api=(method,...args)=>manager.evaluate(({method,args})=>window.api[method](...args),{method,args});
async function check(name,run){const start=Date.now();try{const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-start,detail});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
async function until(run){const end=Date.now()+15000;while(Date.now()<end){if(await run())return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('代理工作台检查等待超时');}
async function fault(value){await app.evaluate(({app},enabled)=>{const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path');if(enabled){globalThis.__proxyDiskRename=fs.renameSync;const target=path.join(app.getPath('userData'),'data','profiles.json');fs.renameSync=function(from,to){if(to===target)throw new Error('模拟代理存储磁盘写入失败');return globalThis.__proxyDiskRename.apply(this,arguments);};}else if(globalThis.__proxyDiskRename){fs.renameSync=globalThis.__proxyDiskRename;delete globalThis.__proxyDiskRename;}},value);}
async function model(){const snapshot=await api('snapshot');return {profiles:snapshot.profiles,proxies:snapshot.proxies,activity:snapshot.activity,disk:fs.readFileSync(path.join(data,'data','profiles.json'),'utf8')};}
async function hold(channel){await app.evaluate(({ipcMain},channel)=>{globalThis.__proxyHoldOriginal=ipcMain._invokeHandlers.get(channel);globalThis.__proxyHoldCalls=0;ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,...args)=>{globalThis.__proxyHoldCalls++;await new Promise(resolve=>{globalThis.__proxyHoldRelease=resolve;});return globalThis.__proxyHoldOriginal(event,...args);});},channel);}
async function release(channel){return app.evaluate(({ipcMain},channel)=>{const count=globalThis.__proxyHoldCalls;ipcMain.removeHandler(channel);ipcMain.handle(channel,globalThis.__proxyHoldOriginal);globalThis.__proxyHoldRelease();return count;},channel);}
const proxyRow=name=>manager.locator('.object-table tr').filter({hasText:name});
async function assignment(){await proxyRow(proxy.name).getByRole('button',{name:'更多操作',exact:true}).click();await manager.getByRole('menuitem',{name:'分配给环境',exact:true}).click();await manager.locator('.proxy-assignment-modal').waitFor();}
(async()=>{
 try{
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  profile=await api('create',{name:'代理分配环境',os:process.platform==='win32'?'win':'mac'});const archived=await api('create',{name:'已归档环境',os:process.platform==='win32'?'win':'mac'});await api('action','archive',[archived.id]);await manager.locator('#navProxy').click();
  await check('代理导入错误定位实际行并保留选择，关闭确认恢复焦点与草稿',async()=>{
   await manager.getByRole('button',{name:'批量导入',exact:true}).click();await manager.keyboard.press('Escape');await manager.locator('.text-import-modal').waitFor({state:'hidden'});
   await manager.getByRole('button',{name:'批量导入',exact:true}).click();const input=manager.getByRole('textbox',{name:'批量导入代理',exact:true}),text='\nhttp://localhost:8080\n\nftp://private:secret@localhost:21';const before=await model();
   await input.fill(text);await manager.getByRole('button',{name:'导入',exact:true}).click();await manager.locator('#text-import-error').waitFor();assert.match(await manager.locator('#text-import-error').innerText(),/第 4 行/);assert.deepEqual(await model(),before);
   const range=await input.evaluate(el=>({selected:el.value.slice(el.selectionStart,el.selectionEnd),focused:document.activeElement===el}));assert.equal(range.selected,'ftp://private:secret@localhost:21');assert.ok(range.focused);
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await until(()=>input.evaluate(el=>document.activeElement===el));assert.equal(await input.inputValue(),text);
  });
  await check('批量代理真实磁盘写入失败回滚全部数据，重试与底部快捷键只导入一次',async()=>{
   const input=manager.getByRole('textbox',{name:'批量导入代理',exact:true}),text='https://qa%40star:p%3Aa%20ss@[::1]:8443\nhttp://127.0.0.1:8080';await input.fill(text);const before=await model();await fault(true);
   await manager.getByRole('button',{name:'导入',exact:true}).click();await manager.locator('#text-import-error').getByText(/磁盘写入失败/).waitFor();assert.equal(await input.inputValue(),text);assert.deepEqual(await model(),before);await fault(false);
   await hold('star:proxyImport');await manager.getByRole('button',{name:'取消',exact:true}).focus();await manager.keyboard.press(shortcut);await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();assert.ok(await input.isDisabled());assert.ok(await manager.locator('.text-import-modal').getByRole('button',{name:'关闭',exact:true}).isDisabled());await manager.keyboard.press('Escape');await manager.keyboard.press(shortcut);assert.ok(await manager.locator('.text-import-modal').isVisible());assert.equal(await release('star:proxyImport'),1);await manager.locator('.text-import-modal').waitFor({state:'hidden'});
   const saved=(await api('snapshot')).proxies;assert.equal(saved.length,before.proxies.length+2);proxy=saved.find(item=>item.host==='::1');assert.equal(proxy.type,'https');assert.equal(proxy.user,'qa@star');assert.equal(proxy.pass,'p:a ss');
  });
  await check('代理分配校验选择并排除归档，真实磁盘失败保留目标和原配置',async()=>{
   await assignment();assert.equal(await manager.locator('#proxy-assignment-target option').filter({hasText:'已归档环境'}).count(),0);await manager.getByRole('button',{name:'分配到环境',exact:true}).click();await manager.locator('#proxy-assignment-error').waitFor();await until(()=>manager.locator('#proxy-assignment-target').evaluate(el=>document.activeElement===el));
   await manager.locator('#proxy-assignment-target').selectOption(profile.id);const before=await model();await fault(true);await manager.getByRole('button',{name:'分配到环境',exact:true}).click();await manager.locator('#proxy-assignment-error').getByText(/磁盘写入失败/).waitFor();await until(()=>manager.locator('#proxy-assignment-target').evaluate(el=>document.activeElement===el));assert.equal(await manager.locator('#proxy-assignment-target').inputValue(),profile.id);assert.deepEqual(await model(),before);await fault(false);
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await until(()=>manager.locator('#proxy-assignment-target').evaluate(el=>document.activeElement===el));
   await hold('profiles:update');await manager.getByRole('button',{name:'取消',exact:true}).focus();await manager.keyboard.press(shortcut);await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();assert.ok(await manager.locator('#proxy-assignment-target').isDisabled());await manager.keyboard.press(shortcut);await manager.keyboard.press('Escape');assert.ok(await manager.locator('.proxy-assignment-modal').isVisible());assert.equal(await release('profiles:update'),1);await manager.locator('.proxy-assignment-modal').waitFor({state:'hidden'});assert.equal((await api('snapshot')).profiles.find(item=>item.id===profile.id).proxy.host,'::1');
  });
  await check('代理保存和检测结果的真实磁盘失败均回滚内存、文件与工作记录',async()=>{
   for(const [method,args] of [['proxySave',[{...proxy,name:'未保存名称'}]],['proxyResult',[proxy.id,{ok:true,ip:'203.0.113.1',latency:10}]]]){const before=await model();await fault(true);await assert.rejects(()=>api(method,...args),/磁盘写入失败/);assert.deepEqual(await model(),before);await fault(false);}
   await api('proxyResult',proxy.id,{ok:true,ip:'203.0.113.1',latency:10});assert.equal((await api('snapshot')).proxies.find(item=>item.id===proxy.id).check.ip,'203.0.113.1');
  });
  await check('代理删除失败保留确认并显示具体错误，恢复后可重试而环境配置保留',async()=>{
   const before=await model();await proxyRow(proxy.name).getByRole('button',{name:'更多操作',exact:true}).click();await manager.getByRole('menuitem',{name:'删除代理',exact:true}).click();const dialog=manager.getByRole('dialog',{name:'删除代理配置？',exact:true});await fault(true);await dialog.getByRole('button',{name:'删除配置',exact:true}).click();await dialog.locator('#confirmation-error').getByText(/磁盘写入失败/).waitFor();assert.ok(await dialog.isVisible());assert.deepEqual(await model(),before);await fault(false);await dialog.getByRole('button',{name:'删除配置',exact:true}).click();await dialog.waitFor({state:'hidden'});const after=await api('snapshot');assert.ok(!after.proxies.some(item=>item.id===proxy.id));assert.equal(after.profiles.find(item=>item.id===profile.id).proxy.host,'::1');proxy=after.proxies[0];
  });
  await check('代理导入与分配在 500px 浅深主题保持保存区可见且无横向溢出',async()=>{
   await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>!win._profile);win.setMinimumSize(480,600);win.setSize(500,760);});const measurements=[];
   for(const type of ['import','assignment']){
    if(type==='import')await manager.getByRole('button',{name:'批量导入',exact:true}).click();else await assignment();const selector=type==='import'?'.text-import-modal':'.proxy-assignment-modal';
    for(const theme of ['light','dark']){await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const size=await manager.locator(selector).evaluate(el=>{const rect=el.getBoundingClientRect(),footer=el.querySelector('.dialog-footer').getBoundingClientRect(),body=el.querySelector('.dialog-body');return {width:rect.width,viewport:innerWidth,footerVisible:footer.bottom<=innerHeight&&footer.top>=0,overflow:body.scrollWidth-body.clientWidth};});assert.ok(size.footerVisible&&size.width<=size.viewport&&size.overflow<=1,JSON.stringify(size));measurements.push({type,theme,...size});await manager.screenshot({animations:'disabled',path:path.join(output,type+'-'+theme+'-500.png')});}await manager.keyboard.press('Escape');await manager.locator(selector).waitFor({state:'hidden'});
   }return measurements;
  });
  await check('代理失败恢复流程没有未捕获页面错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);process.exitCode=1;if(manager)await manager.screenshot({animations:'disabled',path:path.join(output,'failure.png')}).catch(()=>{});}
 finally{if(app){await fault(false).catch(()=>{});await app.close().catch(()=>{});}fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,errors},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
