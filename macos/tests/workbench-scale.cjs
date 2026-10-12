'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {Store}=require('../src/main/store');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-scale-'));
const output=path.resolve('test-results');fs.mkdirSync(output,{recursive:true});
const results=[];let app,manager;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const start=performance.now();const detail=await run();results.push({name,status:'passed',durationMs:Math.round(performance.now()-start),...detail});console.log('PASS',name);}
(async()=>{
 try{
  const store=new Store(path.join(data,'data')),seedStart=performance.now();
  store.transaction(()=>{for(let i=0;i<10000;i++)store.create({name:'环境 '+String(i).padStart(5,'0'),group:'分组 '+i%40,tags:['scale','tag'+i%20],note:'本地性能验证'});});
  const seedMs=performance.now()-seedStart,launchStart=performance.now();
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data},timeout:30000});manager=await app.firstWindow();
  await manager.locator('#btnNew').waitFor();
  await check('一万个真实环境的分页界面正常加载',async()=>{
   assert.equal((await api('list')).length,10000);assert.equal(await manager.locator('#rows tr').count(),75);
   return {seedMs:Math.round(seedMs),launchMs:Math.round(performance.now()-launchStart)};
  });
  await check('稳定状态只返回短标记，批量更改只提交一次',async()=>{
   const full=await api('snapshot'),unchanged=await api('snapshot',full.token);
   assert.equal(unchanged.unchanged,true);assert.equal(unchanged.profiles,undefined);
   const ids=full.profiles.slice(0,500).map(p=>p.id),revision=Number(full.token.split(':')[0]);
   await api('action','update',ids,{tags:['updated']});const next=await api('snapshot');
   assert.equal(Number(next.token.split(':')[0]),revision+1);assert.equal(next.profiles.filter(p=>p.tags.includes('updated')).length,500);
   return {fullBytes:Buffer.byteLength(JSON.stringify(full)),unchangedBytes:Buffer.byteLength(JSON.stringify(unchanged))};
  });
  await check('命令搜索可以定位第一个两百项之外的环境',async()=>{
   await manager.locator('#search').focus();await manager.keyboard.press('Meta+k');const dialog=manager.getByRole('dialog',{name:'搜索与快速操作'});await dialog.waitFor();
   const searchStart=performance.now();await dialog.locator('[cmdk-input]').fill('环境 09999');
   const result=dialog.locator('[cmdk-item]').filter({hasText:'环境 09999'});await result.waitFor();await result.click();
   await manager.locator('#drawer').waitFor();assert.ok((await manager.locator('#drawer').textContent()).includes('环境 09999'));await manager.screenshot({path:path.join(output,'workbench-scale.png')});
   return {searchMs:Math.round(performance.now()-searchStart)};
  });
  await check('一千环境导入一次写盘并持久化',async()=>{
   const file=path.join(data,'import.json');fs.writeFileSync(file,JSON.stringify({profiles:Array.from({length:1000},(_,i)=>({name:'Import '+i,group:'Imported'}))}));
   await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
   const before=await api('snapshot'),preview=await api('importPreview');assert.equal(preview.count,1000);
   const importStart=performance.now();assert.equal((await api('importApply',preview.token)).count,1000);const next=await api('snapshot');
   assert.equal(Number(next.token.split(':')[0]),Number(before.token.split(':')[0])+1);assert.equal(next.profiles.length,11000);
   return {importMs:Math.round(performance.now()-importStart)};
  });
  await app.close();app=null;assert.equal(new Store(path.join(data,'data')).list().length,11000);
 }catch(error){console.error(error);results.push({name:'大规模工作台验证',status:'failed',error:error.stack});process.exitCode=1;}
 finally{
  if(app)await app.close().catch(()=>{});
  fs.writeFileSync(path.join(output,'workbench-scale.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');
  fs.rmSync(data,{recursive:true,force:true});
 }
})();
