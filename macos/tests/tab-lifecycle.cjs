'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'star-lifecycle-')),results=[],samples=[];let app,origin;
async function until(fn){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw new Error('生命周期等待超时');}
(async()=>{try{
 origin=await startOrigin();app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:temp,TFB_TEST_ORIGIN_PORT:String(origin.port)}});const manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
 const environments=[];
 for(const [index,tz] of ['Asia/Tokyo','Europe/London'].entries()){
  const profile=await manager.evaluate(data=>window.api.create(data),{name:'生命周期 '+index,os:'mac',country:index?'GB':'JP',language:index?'en-GB':'ja-JP',langManual:true,timezone:tz,timezoneManual:true,startUrl:'http://localhost:'+origin.port+'/probe'});
  const next=app.waitForEvent('window');await manager.evaluate(id=>window.api.browse(id),profile.id);const browser=await next;await browser.waitForFunction(()=>typeof StarTabs==='object'&&Array.isArray(tabs));await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/probe')));
  const target=await browser.evaluate(()=>activeId),background=await browser.evaluate(url=>createTab(url),'http://localhost:'+origin.port+'/sync');await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()));
  const guest=await browser.evaluate(id=>tabs.find(t=>t.id===id).web.getWebContentsId(),target);await app.evaluate(async({webContents},{guest,index})=>webContents.fromId(guest).executeJavaScript('localStorage.setItem("lifecycle",'+JSON.stringify(String(index))+');true'),{guest,index});environments.push({profile,browser,target,background,tz,index});
 }
 const count=()=>app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getType()==='webview').length);
 const initial=await count();assert.equal(initial,4);
 for(let cycle=0;cycle<20;cycle++){
  const env=environments[cycle%2];await env.browser.evaluate(id=>activateTab(id),env.background);
  const old=await env.browser.evaluate(id=>tabs.find(t=>t.id===id).web.getWebContentsId(),env.target);
  await env.browser.evaluate(async id=>StarTabs.sleep(id),env.target);assert.equal(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),old),false);assert.equal(await count(),3);
  await env.browser.evaluate(id=>activateTab(id),env.target);await until(()=>env.browser.evaluate(id=>{const t=tabs.find(t=>t.id===id);return t.web?.__starReady&&!t.web.isLoading()&&t.web.getURL().includes('/probe');},env.target));
  const guest=await env.browser.evaluate(id=>tabs.find(t=>t.id===id).web.getWebContentsId(),env.target);assert.notEqual(guest,old);
  const actual=await app.evaluate(async({webContents},id)=>webContents.fromId(id).executeJavaScript('({tz:window.early.tz,local:localStorage.getItem("lifecycle")})'),guest);assert.equal(actual.tz,env.tz);assert.equal(actual.local,String(env.index));assert.equal(await count(),4);
  const metrics=await app.evaluate(({app})=>app.getAppMetrics());samples.push({cycle:cycle+1,environment:env.profile.id,oldGuest:old,newGuest:guest,guestCount:4,metrics});
 }
 results.push({name:'两个环境交替完成20次真实guest销毁与重建，数量保持4',status:'passed',detail:{cycles:20,initialGuestCount:initial,finalGuestCount:await count()}});
 results.push({name:'每次唤醒首脚本保持各自时区，持久存储保留且环境隔离',status:'passed'});
 results.push({name:'保存真实进程CPU与内存采样，不推断未测得的内存节省',status:'passed',detail:{samples:samples.length}});console.log('PASS 20次双环境休眠/唤醒，guest数量与隔离保持');
}catch(error){console.error(error);results.push({name:'反复休眠生命周期',status:'failed',error:error.stack});process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/tab-lifecycle.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,samples},null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true});}})();
