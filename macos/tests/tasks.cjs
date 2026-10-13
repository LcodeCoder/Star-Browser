'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-tasks-')),results=[];let app,manager,origin,a,b,c,task;
async function until(run,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('等待任务条件超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const start=Date.now();await run();results.push({name,status:'passed',durationMs:Date.now()-start});console.log('PASS',name);}
async function runState(id){return (await api('snapshot')).taskRuns.find(row=>row.id===id);}
async function finished(id){return until(async()=>{const run=await runState(id);return ['completed','failed','cancelled','interrupted'].includes(run?.state)&&run;});}
async function value(id,expression){return app.evaluate(async({webContents},{id,expression})=>{const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/sync')&&!w.isLoading());return wc?await wc.executeJavaScript(expression):null;},{id,expression});}
async function launch(){app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)}});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();}
(async()=>{
 try{
  origin=await startOrigin();await launch();
  a=await api('create',{name:'任务 A',startUrl:'about:home'});b=await api('create',{name:'任务 B',url:'about:home'});c=await api('create',{name:'独立环境',startUrl:'http://localhost:'+origin.port+'/sync'});
  await check('任务页真实创建、保存、编辑与步骤排序',async()=>{
   await manager.locator('#navTasks').click();await manager.getByText('把重复的网页操作保存为任务',{exact:true}).waitFor();await manager.getByRole('button',{name:'新建任务',exact:true}).first().click();
   await manager.getByLabel('任务名称',{exact:true}).fill('本地网页工作');await manager.getByLabel('任务用途',{exact:true}).fill('真实点击与输入');await manager.getByLabel('第 1 步地址',{exact:true}).fill('http://localhost:'+origin.port+'/sync');await manager.getByRole('button',{name:'添加步骤',exact:true}).click();await manager.getByLabel('第 2 步操作',{exact:true}).selectOption('waitFor');await manager.getByLabel('第 2 步元素',{exact:true}).fill('#text');await manager.getByRole('button',{name:'保存任务',exact:true}).click();await manager.getByText('本地网页工作',{exact:true}).waitFor();
   task=(await api('snapshot')).tasks[0];assert.equal(task.steps[1].type,'waitFor');await manager.getByRole('button',{name:'编辑 本地网页工作',exact:true}).click();await manager.getByRole('button',{name:'上移第 2 步',exact:true}).click();assert.equal(await manager.getByLabel('第 1 步操作',{exact:true}).inputValue(),'waitFor');await manager.getByRole('button',{name:'下移第 1 步',exact:true}).click();await manager.getByRole('button',{name:'保存任务',exact:true}).click();await until(async()=>(await api('snapshot')).tasks[0].steps[0].type==='navigate');
  });
  await check('真实磁盘故障保留任务编辑草稿和设置，恢复后可直接重试',async()=>{
   const before=await api('snapshot'),file=path.join(dir,'data','profiles.json'),disk=fs.readFileSync(file,'utf8');
   await manager.getByRole('button',{name:'编辑 本地网页工作',exact:true}).click();
   await manager.getByLabel('任务用途',{exact:true}).fill('磁盘恢复后保存的草稿');
   fs.mkdirSync(file+'.tmp');
   try{
    await assert.rejects(api('preferences',{theme:before.preferences.theme==='dark'?'light':'dark'}),/EISDIR|EACCES|EPERM/);
    await manager.getByRole('button',{name:'保存任务',exact:true}).click();
    await manager.locator('#task-editor-error').waitFor();
    assert.match(await manager.locator('#task-editor-error').innerText(),/数据路径发生冲突|无法访问本地数据/);
    assert.equal(await manager.getByLabel('任务用途',{exact:true}).inputValue(),'磁盘恢复后保存的草稿');
    assert.ok(await manager.getByRole('button',{name:'保存任务',exact:true}).isEnabled());
    const failed=await api('snapshot');
    assert.deepEqual(failed.tasks,before.tasks);assert.deepEqual(failed.preferences,before.preferences);
    assert.equal(fs.readFileSync(file,'utf8'),disk);
   }finally{fs.rmSync(file+'.tmp',{recursive:true,force:true});}
   await manager.getByRole('button',{name:'保存任务',exact:true}).click();
   await manager.locator('.task-editor-modal').waitFor({state:'hidden'});
   task=(await api('snapshot')).tasks.find(row=>row.id===task.id);assert.equal(task.description,'磁盘恢复后保存的草稿');
   const theme=before.preferences.theme==='dark'?'light':'dark';await api('preferences',{theme});
   await until(()=>manager.evaluate(theme=>document.documentElement.dataset.theme===theme,theme));
   await api('preferences',before.preferences);
  });
  await check('任务定义校验、重复环境与队列总量限制',async()=>{
   for(const steps of [[],[{type:'unsupported'}],[{type:'navigate',url:'javascript:alert(1)'}],[{type:'navigate',url:'https://a:b@example.com'}],[{type:'fill',selector:''}],[{type:'wait',duration:60000}],[{type:'press',key:'F99'}]])await assert.rejects(api('taskSave',{name:'无效任务',steps}));await assert.rejects(api('taskStart',task.id,[a.id,a.id]),/不同环境/);
   const bounded=await app.evaluate(async()=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const {AutomationTasks}=require(process.cwd()+'/src/main/automation-tasks');const runner=new AutomationTasks({app:require('electron').app,store:{taskRuns:()=>[],tasks:()=>[{id:'fixture',name:'上限',steps:[{type:'wait',duration:100}]}]},commands:()=>{},synchronizer:{status:()=>({active:false})}});runner.queue=Array.from({length:100},()=>({}));try{runner.start('fixture',['another']);return false;}catch(error){return error.message.includes('100');}});assert.equal(bounded,true);
  });
  await check('两个环境串行完成真实点击、填写、按键、滚动与 PNG 截图',async()=>{
   task=await api('taskSave',{...task,steps:[{type:'navigate',url:'http://localhost:'+origin.port+'/sync'},{type:'waitFor',selector:'#text'},{type:'fill',selector:'#text',text:'任务私有文字 314159'},{type:'press',key:'Enter'},{type:'click',selector:'#click'},{type:'scroll',y:500,x:0},{type:'wait',duration:300},{type:'screenshot'}]});
   await api('browse',c.id);await until(async()=>(await value(c.id,'window.syncClicks'))===0);await manager.getByRole('button',{name:'执行',exact:true}).click();await manager.getByLabel('搜索任务环境',{exact:true}).fill('任务 A');await manager.getByLabel('任务环境 任务 A',{exact:true}).check();await manager.getByLabel('搜索任务环境',{exact:true}).fill('任务 B');await manager.getByLabel('任务环境 任务 B',{exact:true}).check();await manager.getByLabel('搜索任务环境',{exact:true}).fill('');await manager.getByRole('button',{name:'加入执行队列',exact:true}).click();const runs=await until(async()=>{const r=(await api('snapshot')).taskRuns.filter(x=>x.taskId===task.id);return r.length===2&&r;});const ar=runs.find(r=>r.profileId===a.id),br=runs.find(r=>r.profileId===b.id);assert.equal(br.state,'queued');const resultA=await finished(ar.id),resultB=await finished(br.id);assert.equal(resultA.state,'completed',resultA.error);assert.equal(resultB.state,'completed',resultB.error);assert.ok(resultB.startedAt>=resultA.finishedAt);for(const id of [a.id,b.id]){assert.equal(await value(id,'window.syncClicks'),1);assert.deepEqual(await value(id,'window.trustedClicks'),[true]);assert.equal(await value(id,'document.querySelector("#text").value'),'任务私有文字 314159');assert.ok(await value(id,'scrollY')>100);}assert.equal(await value(c.id,'window.syncClicks'),0);assert.equal(await value(c.id,'document.querySelector("#text").value'),'');
   const image=resultA.outputs[0].path;assert.deepEqual([...fs.readFileSync(image).subarray(0,8)],[137,80,78,71,13,10,26,10]);if(process.platform!=='win32')assert.equal(fs.statSync(image).mode&0o777,0o600);assert.ok(!JSON.stringify([resultA,resultB]).includes('314159'));assert.ok(!JSON.stringify((await api('snapshot')).activity).includes('314159'));
  });
  await check('截图遇到暂时不可用的绘制表面后受控重试并保存真实 PNG',async()=>{
   await app.evaluate(({webContents},id)=>{const wc=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id),capture=wc.capturePage.bind(wc);let calls=0;wc.capturePage=(...args)=>{calls++;wc.__qaCaptureAttempts=calls;if(calls===1)return Promise.reject(new Error('UnknownVizError'));return capture(...args);};},a.id);
   const retry=await api('taskSave',{name:'截图恢复验证',steps:[{type:'screenshot'}]});const [run]=await api('taskStart',retry.id,[a.id]),result=await finished(run.id);assert.equal(result.state,'completed',result.error);assert.equal(result.outputs.length,1);assert.deepEqual([...fs.readFileSync(result.outputs[0].path).subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(await app.evaluate(({webContents},id)=>webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id).__qaCaptureAttempts,a.id),2);
  });
  await check('运行时环境锁、取消活动与排队任务并释放保护',async()=>{
   const wait=await api('taskSave',{name:'可取消任务',steps:[{type:'wait',duration:30000},{type:'click',selector:'#click'}]});const runs=await api('taskStart',wait.id,[a.id,b.id]);await until(async()=>(await runState(runs[0].id)).state==='running');await assert.rejects(api('action','regenerate',[a.id]),/执行任务/);await assert.rejects(api('syncStart',{master:a.id,followers:[c.id],navigation:false}),/执行任务/);await assert.rejects(api('taskRemove',wait.id),/取消/);await assert.rejects(api('taskStart',wait.id,[a.id]),/执行任务|已有任务/);await api('taskCancel',runs[1].id);await api('taskCancel',runs[0].id);assert.equal((await finished(runs[1].id)).state,'cancelled');assert.equal((await finished(runs[0].id)).state,'cancelled');assert.equal(await value(a.id,'window.syncClicks'),1);await api('action','update',[a.id],{note:'取消后可修改'});assert.equal((await api('snapshot')).profiles.find(p=>p.id===a.id).note,'取消后可修改');await api('taskRemove',wait.id);
  });
  await check('窗口同步冲突与元素失败、超时反馈准确，后续任务可执行',async()=>{
   await api('syncStart',{master:a.id,followers:[b.id],navigation:false});await assert.rejects(api('taskStart',task.id,[a.id]),/窗口同步/);await api('syncStop');
   for(const selector of ['??[','#missing']){const bad=await api('taskSave',{name:'失败验证',steps:[{type:'waitFor',selector,timeout:1000}]});const [run]=await api('taskStart',bad.id,[a.id]);const result=await finished(run.id);assert.equal(result.state,'failed');assert.match(result.error,selector==='#missing'?/等待元素超时/:/格式无效/);assert.equal(result.step,1);await api('taskRemove',bad.id);}const [good]=await api('taskStart',task.id,[a.id]);assert.equal((await finished(good.id)).state,'completed');
  });
  await check('填入文本拒绝非输入元素，切换标签及时中止后续操作',async()=>{
   const invalid=await api('taskSave',{name:'非输入元素验证',steps:[{type:'fill',selector:'#click',text:'不能点击'}]});const before=await value(a.id,'window.syncClicks');const [bad]=await api('taskStart',invalid.id,[a.id]);assert.equal((await finished(bad.id)).state,'failed');assert.equal(await value(a.id,'window.syncClicks'),before);
   const wait=await api('taskSave',{name:'标签保护验证',steps:[{type:'wait',duration:30000},{type:'click',selector:'#click'}]});const [run]=await api('taskStart',wait.id,[a.id]);await until(async()=>(await runState(run.id)).state==='running');let shell;for(const page of app.windows()){if(await page.evaluate(()=>typeof profile!=='undefined'&&profile?.id).catch(()=>null)===a.id){shell=page;break;}}assert.ok(shell);await shell.bringToFront();await shell.locator('#newTab').click();const failed=await finished(run.id);assert.equal(failed.state,'failed');assert.match(failed.error,/标签已切换或关闭/);
  });
  await check('队列取消写入失败后保持排队，恢复后能取消并继续使用',async()=>{
   const wait=await api('taskSave',{name:'取消恢复验证',steps:[{type:'wait',duration:30000}]});
   const runs=await api('taskStart',wait.id,[a.id,b.id]);
   await until(async()=>{const run=await runState(runs[0].id);return run?.state==='running'&&run.step===1;});
   const file=path.join(dir,'data','profiles.json');fs.mkdirSync(file+'.tmp');
   try{await assert.rejects(api('taskCancel',runs[1].id),/EISDIR|EACCES|EPERM/);assert.equal((await runState(runs[1].id)).state,'queued');}
   finally{fs.rmSync(file+'.tmp',{recursive:true,force:true});}
   await api('taskCancel',runs[1].id);assert.equal((await runState(runs[1].id)).state,'cancelled');
   await api('taskCancel',runs[0].id);assert.equal((await finished(runs[0].id)).state,'cancelled');
  });
  await check('关闭浏览器会结束任务并继续下个环境',async()=>{
   const wait=await api('taskSave',{name:'关闭验证',steps:[{type:'wait',duration:30000},{type:'click',selector:'#click'}]});const runs=await api('taskStart',wait.id,[a.id,b.id]);await until(async()=>(await runState(runs[0].id)).state==='running');await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w._profile?.id===id).close(),a.id);const failed=await finished(runs[0].id);assert.equal(failed.state,'failed');assert.match(failed.error,/关闭/);await until(async()=>(await runState(runs[1].id)).state==='running');await api('taskCancel',runs[1].id);assert.equal((await finished(runs[1].id)).state,'cancelled');
  });
  await check('完成结果保存失败时保留真实结果、暂停队列，重试不会重复网页操作',async()=>{
   const saved=await api('taskSave',{name:'结果恢复验证',steps:[{type:'navigate',url:'http://localhost:'+origin.port+'/sync'},{type:'click',selector:'#click'}]});
   await app.evaluate(({},{profileId})=>{
    const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),fs=require('node:fs'),path=require('node:path');
    globalThis.__starTaskRename=fs.renameSync;
    fs.renameSync=function(from,to,...args){
     if(path.basename(String(to))==='profiles.json'){
      const data=JSON.parse(fs.readFileSync(from,'utf8'));
      if(data.taskRuns.some(run=>run.taskName==='结果恢复验证'&&run.profileId===profileId&&run.state==='completed')){const error=new Error('ENOSPC: simulated full disk during terminal result');error.code='ENOSPC';throw error;}
     }
     return globalThis.__starTaskRename.call(this,from,to,...args);
    };
   },{profileId:a.id});
   try{
    const runs=await api('taskStart',saved.id,[a.id,b.id]);
    const pending=await until(async()=>{const run=await runState(runs[0].id);return run?.persistenceError&&run;});
    assert.equal(pending.state,'completed');assert.equal(pending.steps.length,2);assert.match(pending.persistenceError,/ENOSPC/);
    assert.equal((await runState(runs[1].id)).state,'queued');assert.equal(await value(a.id,'window.syncClicks'),1);
    await assert.rejects(api('taskRetrySave'),/ENOSPC/);await assert.rejects(api('taskStart',saved.id,[c.id]),/先保存/);
    assert.equal((await runState(runs[0].id)).state,'completed');
    const guarded=await app.evaluate(async({app,dialog})=>{
     const original=dialog.showMessageBox,shown=[];
     dialog.showMessageBox=async options=>{shown.push(options);return {response:1};};
     try{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};app.emit('before-quit',event);await new Promise(resolve=>setImmediate(resolve));return {prevented:event.defaultPrevented,shown};}
     finally{dialog.showMessageBox=original;}
    });
    assert.equal(guarded.prevented,true);assert.equal(guarded.shown.length,1);assert.equal(guarded.shown[0].cancelId,1);
    assert.equal((await runState(runs[0].id)).persistenceError,pending.persistenceError);
    await manager.bringToFront();await manager.locator('#navTasks').click();await manager.getByRole('button',{name:'刷新工作台',exact:true}).click();
    await manager.locator('.task-persistence-warning').waitFor();await manager.getByRole('button',{name:/执行记录/}).click();
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>!w._profile);win.setMinimumSize(480,600);win.setSize(500,850);});
    await manager.waitForFunction(()=>innerWidth===500);
    for(const theme of ['light','dark']){
     await api('preferences',{theme});await until(()=>manager.evaluate(theme=>document.documentElement.dataset.theme===theme,theme));
     const layout=await manager.locator('.task-persistence-warning').evaluate(el=>{const r=el.getBoundingClientRect(),button=el.querySelector('button').getBoundingClientRect();return {viewport:innerWidth,width:r.width,overflow:document.documentElement.scrollWidth-innerWidth,buttonVisible:button.left>=0&&button.right<=innerWidth&&button.top>=0&&button.bottom<=innerHeight};});
     assert.ok(layout.viewport===500&&layout.overflow<=1&&layout.buttonVisible,JSON.stringify(layout));
     const search=await manager.getByLabel('搜索任务',{exact:true}).boundingBox();assert.ok(search.width>300,JSON.stringify(search));
     await manager.screenshot({animations:'disabled',path:path.resolve('test-results/task-persistence-'+theme+'-500.png')});
    }
    await app.evaluate(()=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');require('node:fs').renameSync=globalThis.__starTaskRename;delete globalThis.__starTaskRename;});
    await manager.getByRole('button',{name:'重试保存结果',exact:true}).click();await manager.locator('.task-persistence-warning').waitFor({state:'hidden'});
    assert.equal((await finished(runs[1].id)).state,'completed');assert.equal((await runState(runs[0].id)).persistenceError,undefined);
    assert.equal(await value(a.id,'window.syncClicks'),1);assert.equal(await value(b.id,'window.syncClicks'),1);
    const document=JSON.parse(fs.readFileSync(path.join(dir,'data','profiles.json'),'utf8'));
    assert.equal(document.taskRuns.find(run=>run.id===runs[0].id).state,'completed');
    assert.equal(document.activity.filter(row=>row.action==='任务完成'&&row.name===saved.name&&row.detail===a.name).length,1);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w._profile).setBounds({width:1440,height:850}));
   }finally{await app.evaluate(()=>{if(globalThis.__starTaskRename){const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');require('node:fs').renameSync=globalThis.__starTaskRename;delete globalThis.__starTaskRename;}});}
  });
  await check('执行结果、任务搜索、浅深主题与窄窗口实际页面',async()=>{
   await manager.bringToFront();await manager.getByRole('button',{name:/我的任务/}).click();await manager.getByLabel('搜索任务',{exact:true}).fill('不存在');await manager.getByText('没有找到这个任务',{exact:true}).waitFor();await manager.getByLabel('搜索任务',{exact:true}).fill('');await api('preferences',{theme:'light'});await until(()=>manager.evaluate(()=>document.documentElement.dataset.theme==='light'));await manager.screenshot({path:path.resolve('test-results/tasks-light.png')});await api('preferences',{theme:'dark'});await until(()=>manager.evaluate(()=>document.documentElement.dataset.theme==='dark'));await manager.screenshot({path:path.resolve('test-results/tasks-dark.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w._profile).setBounds({width:780,height:850}));await manager.getByRole('button',{name:'编辑 本地网页工作',exact:true}).click();await manager.getByLabel('任务名称',{exact:true}).waitFor({state:'visible'});await manager.getByLabel('任务名称',{exact:true}).scrollIntoViewIfNeeded();await manager.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await manager.screenshot({path:path.resolve('test-results/tasks-editor-narrow.png')});assert.ok(await manager.getByLabel('任务名称',{exact:true}).isVisible());await manager.getByRole('button',{name:'取消',exact:true}).click();await manager.getByRole('button',{name:/执行记录/}).click();await manager.getByRole('button',{name:'查看结果',exact:true}).first().click();await manager.getByRole('dialog').waitFor();await manager.screenshot({path:path.resolve('test-results/tasks-result.png')});await manager.getByRole('button',{name:'关闭',exact:true}).last().click();
  });
  await check('任务定义与结果重启持久，中断标记不会自动重复',async()=>{
   await app.close();app=null;const location=path.join(dir,'data','profiles.json'),saved=JSON.parse(fs.readFileSync(location,'utf8'));const marker={id:'restart-interrupted',taskId:task.id,taskName:task.name,profileId:a.id,profileName:a.name,state:'running',step:2,total:8,createdAt:Date.now(),steps:[],outputs:[]};saved.taskRuns.unshift(marker);fs.writeFileSync(location,JSON.stringify(saved));await launch();const snapshot=await api('snapshot');assert.equal(snapshot.tasks.find(t=>t.id===task.id).steps[2].text,'任务私有文字 314159');assert.equal(snapshot.taskRuns.find(r=>r.id===marker.id).state,'interrupted');assert.equal(snapshot.runtime.length,0);assert.ok(snapshot.taskRuns.some(r=>r.state==='completed'&&r.outputs.length===1));
  });
 }catch(error){console.error(error);results.push({name:'任务实际验证',status:'failed',error:error.stack});process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.resolve('test-results/tasks-failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/tasks.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});}
})();
