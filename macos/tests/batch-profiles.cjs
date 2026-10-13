'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-batch-profile-')),results=[],errors=[];
const shortcut=process.platform==='darwin'?'Meta+Enter':'Control+Enter';
let app,manager,profiles,proxy;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){await run();results.push({name,status:'passed'});console.log('PASS',name);}
async function open(){await manager.locator('#batchBar').getByRole('button',{name:'更多操作',exact:true}).click();await manager.getByRole('menuitem',{name:'更改分组 / 标签 / 代理',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor();}
async function focus(id){await manager.waitForFunction(id=>document.activeElement.id===id,id);}
async function model(){const snapshot=await api('snapshot');return {profiles:snapshot.profiles,activity:snapshot.activity,disk:fs.readFileSync(path.join(data,'data','profiles.json'),'utf8')};}
async function gate(release=false){await app.evaluate(({ipcMain},release)=>{
 if(release){const original=globalThis.__starBatchOriginal;ipcMain.removeHandler('star:action');ipcMain.handle('star:action',original);globalThis.__starBatchRelease?.();delete globalThis.__starBatchRelease;return;}
 globalThis.__starBatchOriginal=ipcMain._invokeHandlers.get('star:action');ipcMain.removeHandler('star:action');
 ipcMain.handle('star:action',async(event,...args)=>{await new Promise(resolve=>{globalThis.__starBatchRelease=resolve;});return globalThis.__starBatchOriginal(event,...args);});
 },release);}
(async()=>{
 try{
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  profiles=[await api('create',{name:'批量 A',group:'分组 A',tags:['独立 A'],note:'保留 A'}),await api('create',{name:'批量 B',group:'分组 B',tags:['独立 B'],note:'保留 B'})];
  proxy=await api('proxySave',{name:'批量代理',type:'http',host:'127.0.0.1',port:'8080'});
  for(const profile of profiles)await manager.getByRole('checkbox',{name:'选择 '+profile.name,exact:true}).check();
  await check('批量编辑未修改可关闭，空更新和标签错误准确定位',async()=>{
   await open();await manager.keyboard.press('Escape');await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   await open();await manager.getByRole('button',{name:'保存更改',exact:true}).click();await focus('batch-group');assert.match(await manager.locator('#batch-editor-error').innerText(),/至少一项/);
   await manager.locator('#batch-tags-mode').selectOption('replace');await manager.getByRole('button',{name:'保存更改',exact:true}).click();await focus('batch-tags');
   await manager.locator('#batch-tags').fill(Array.from({length:21},(_,i)=>'标签'+i).join(','));await manager.getByRole('button',{name:'保存更改',exact:true}).click();await focus('batch-tags');assert.match(await manager.locator('#batch-editor-error').innerText(),/20/);
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await focus('batch-tags');assert.ok((await manager.locator('#batch-tags').inputValue()).includes('标签20'));
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
  });
  await check('真实磁盘故障完整回滚批量分组、标签、代理和工作记录，草稿可重试',async()=>{
   const before=await model();await open();await manager.locator('#batch-group').fill('共同分组');await manager.locator('#batch-tags-mode').selectOption('replace');await manager.locator('#batch-tags').fill('工作，工作, 测试');await manager.locator('#batch-proxy').selectOption(proxy.id);
   const temporary=path.join(data,'data','profiles.json.tmp');fs.mkdirSync(temporary);
   try{await manager.getByRole('button',{name:'保存更改',exact:true}).click();await manager.locator('#batch-editor-error').waitFor();assert.match(await manager.locator('#batch-editor-error').innerText(),/数据路径发生冲突|无法访问本地数据/);assert.deepEqual(await model(),before);assert.equal(await manager.locator('#batch-group').inputValue(),'共同分组');assert.equal(await manager.locator('#batch-proxy').inputValue(),proxy.id);}
   finally{fs.rmSync(temporary,{recursive:true,force:true});}
   await manager.keyboard.press(shortcut);await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   const snapshot=await api('snapshot');for(const original of profiles){const current=snapshot.profiles.find(row=>row.id===original.id);assert.equal(current.group,'共同分组');assert.deepEqual(current.tags,['工作','测试']);assert.equal(current.proxy.host,'127.0.0.1');assert.equal(current.note,original.note);assert.equal(current.seed,original.seed);}
  });
  await check('保存中锁定关闭、字段和重复提交，保留标签并实际改为本机网络',async()=>{
   await open();await manager.locator('#batch-proxy').selectOption('direct');await gate();await manager.getByRole('button',{name:'保存更改',exact:true}).click();await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();
   assert.ok(await manager.locator('#batch-group').isDisabled());assert.ok(await manager.getByRole('button',{name:'关闭',exact:true}).isDisabled());await manager.keyboard.press('Escape');assert.ok(await manager.locator('.batch-profile-editor-modal').isVisible());
   await manager.keyboard.press(shortcut);await gate(true);await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   for(const current of(await api('snapshot')).profiles){assert.equal(current.proxy,null);assert.deepEqual(current.tags,['工作','测试']);}
  });
  await check('批量追加标签保留各环境原标签，按环境去重并保存',async()=>{
   await api('action','update',[profiles[0].id],{tags:['独立 A']});await api('action','update',[profiles[1].id],{tags:['独立 B']});
   const before=(await api('snapshot')).profiles;await open();await manager.locator('#batch-tags-mode').selectOption('append');await manager.locator('#batch-tags').fill('工作，独立 A,工作');await manager.keyboard.press(shortcut);await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   const after=(await api('snapshot')).profiles;
   assert.deepEqual(after.find(row=>row.id===profiles[0].id).tags,['独立 A','工作']);assert.deepEqual(after.find(row=>row.id===profiles[1].id).tags,['独立 B','工作','独立 A']);
   for(const current of after){const previous=before.find(row=>row.id===current.id);assert.deepEqual({...current,tags:previous.tags,updatedAt:previous.updatedAt},previous);}
  });
  await check('任一环境追加标签超限时准确定位，主进程独立阻止整批修改',async()=>{
   await api('action','update',[profiles[1].id],{tags:Array.from({length:20},(_,index)=>'已有'+index)});
   const before=await model();await open();await manager.locator('#batch-group').fill('不能保存的分组');await manager.locator('#batch-tags-mode').selectOption('append');await manager.locator('#batch-tags').fill('新增');await manager.getByRole('button',{name:'保存更改',exact:true}).click();await focus('batch-tags');assert.match(await manager.locator('#batch-editor-error').innerText(),/批量 B.*20/);assert.deepEqual(await model(),before);
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   await assert.rejects(api('action','update',profiles.map(profile=>profile.id),{group:'不能保存的分组',tags:['新增']},{tagsMode:'append'}),/批量 B.*20/);assert.deepEqual(await model(),before);
   await assert.rejects(api('action','update',profiles.map(profile=>profile.id),{group:'不能保存的分组',tags:[]},{tagsMode:'append'}),/添加的标签/);assert.deepEqual(await model(),before);
  });
  await check('清空标签有明确操作，其他环境配置保持原值',async()=>{
   const before=(await api('snapshot')).profiles;await open();await manager.locator('#batch-tags-mode').selectOption('clear');await manager.getByRole('button',{name:'保存更改',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});
   const after=(await api('snapshot')).profiles;for(const current of after){const previous=before.find(row=>row.id===current.id);assert.deepEqual(current.tags,[]);assert.deepEqual({...current,tags:previous.tags,updatedAt:previous.updatedAt},previous);}
  });
  await check('编辑期间代理被移除时保留草稿并定位，重新选择后可保存',async()=>{
   await open();await manager.locator('#batch-proxy').selectOption(proxy.id);await manager.locator('#batch-group').fill('最终分组');await api('proxyRemove',proxy.id);await manager.getByRole('button',{name:'保存更改',exact:true}).click();await focus('batch-proxy');assert.match(await manager.locator('#batch-editor-error').innerText(),/代理已不存在/);
   assert.equal(await manager.locator('#batch-group').inputValue(),'最终分组');await manager.locator('#batch-proxy').selectOption('direct');await manager.getByRole('button',{name:'保存更改',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});assert.ok((await api('snapshot')).profiles.every(profile=>profile.group==='最终分组'));
  });
  await check('500px 浅深主题中批量编辑输入、错误和保存区均可操作',async()=>{
   await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(window=>!window._profile);window.setMinimumSize(480,600);window.setSize(500,760);});await manager.waitForFunction(()=>innerWidth===500);await open();await manager.locator('#batch-tags-mode').selectOption('replace');await manager.locator('#batch-tags').fill('布局检查');
   for(const theme of ['light','dark']){await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const layout=await manager.locator('.batch-profile-editor-modal').evaluate(el=>{const r=el.getBoundingClientRect(),footer=el.querySelector('.dialog-footer').getBoundingClientRect(),body=el.querySelector('.dialog-body');return {width:r.width,viewport:innerWidth,overflow:body.scrollWidth-body.clientWidth,footerVisible:footer.bottom<=innerHeight&&footer.top>=0};});assert.ok(layout.viewport===500&&layout.width<=500&&layout.overflow<=1&&layout.footerVisible,JSON.stringify(layout));await manager.screenshot({animations:'disabled',path:path.resolve('test-results/batch-profiles-'+theme+'-500.png')});}
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.batch-profile-editor-modal').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
  });
 }catch(error){console.error(error);results.push({name:'批量环境编辑验证',status:'failed',error:error.stack});process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.resolve('test-results/batch-profiles-failure.png')}).catch(()=>{});}
 finally{if(app){await app.evaluate(({ipcMain})=>{if(globalThis.__starBatchOriginal){ipcMain.removeHandler('star:action');ipcMain.handle('star:action',globalThis.__starBatchOriginal);globalThis.__starBatchRelease?.();}}).catch(()=>{});await app.close().catch(()=>{});}fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/batch-profiles.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})();
