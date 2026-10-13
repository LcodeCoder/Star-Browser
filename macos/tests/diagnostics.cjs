'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-diagnostics-'));
const output=path.resolve('test-results/star-0.13.0/diagnostics');
const results=[],errors=[];
let app,manager,browser,origin,profile;
async function until(read,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('检测入口验证等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const start=Date.now();const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-start,detail});console.log('PASS',name);}
async function openDetails(id){await manager.locator('#navEnv').click();const data=(await api('list')).find(p=>p.id===id);await manager.locator('.profile-name').filter({hasText:data.name}).click();await manager.getByRole('tab',{name:'指纹',exact:true}).click();}
async function browserPanel(){await browser.locator('#browserMenuBtn').click();await browser.getByRole('menuitem',{name:'检测此环境',exact:true}).click();await browser.locator('#diagnosticSearch').waitFor();}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 try{
  origin=await startOrigin();
  app=await _electron.launch({...process.env.STAR_QA_EXECUTABLE?{executablePath:process.env.STAR_QA_EXECUTABLE,args:[]}:{args:['.']},cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)}});
  manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  profile=await api('create',{name:'检测入口环境',os:process.platform==='win32'?'win':'mac',country:'UK',langManual:true,language:'en-GB',timezoneManual:true,timezone:'Europe/London',startUrl:'about:home'});
  await check('固定检测目录与无效项目拒绝，不创建多余环境',async()=>{
   const catalog=await api('diagnosticCatalog');assert.equal(catalog.length,7);assert.equal(new Set(catalog.map(row=>row.id)).size,7);
   for(const row of catalog){const url=new URL(row.url);assert.equal(url.protocol,'https:');assert.ok(['www.browserscan.net','browserleaks.com'].includes(url.hostname));}
   await assert.rejects(api('diagnosticOpen',profile.id,'file:///etc/passwd'),/检测项目不存在/);
   await assert.rejects(api('diagnosticOpen','missing','browserscan'),/环境不存在/);assert.equal((await api('list')).length,1);
   return {catalog:catalog.map(row=>row.id)};
  });
  await check('工作台检测搜索、空结果、离线恢复、主题与窄窗',async()=>{
   await openDetails(profile.id);await manager.getByRole('button',{name:'外部检测',exact:true}).click();const modal=manager.getByRole('dialog');await modal.waitFor();
   await manager.getByLabel('搜索检测项目',{exact:true}).fill('语言');assert.equal(await modal.locator('.diagnostic-option').count(),2);
   await manager.getByLabel('搜索检测项目',{exact:true}).fill('nothing-matches');await modal.getByText('没有匹配的检测项目',{exact:true}).waitFor();await modal.getByRole('button',{name:'清除搜索'}).click();assert.equal(await modal.locator('.diagnostic-option').count(),7);
   await manager.context().setOffline(true);await modal.getByText('当前离线，连接网络后再检测。',{exact:true}).waitFor();assert.equal(await modal.getByRole('button',{name:'BrowserScan',exact:true}).isDisabled(),true);await manager.context().setOffline(false);await until(()=>modal.getByRole('button',{name:'BrowserScan',exact:true}).isEnabled());
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w._profile).setSize(780,700));
   for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>manager.evaluate(t=>document.documentElement.dataset.theme===t,theme));await manager.screenshot({path:path.join(output,'workbench-'+theme+'.png')});const overflow=await modal.evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(overflow,false);}
   await manager.keyboard.press('Escape');await modal.waitFor({state:'hidden'});await until(()=>manager.getByRole('button',{name:'外部检测',exact:true}).evaluate(el=>el===document.activeElement));
  });
  await check('未启动环境从工作台打开检测标签，保持同一会话和配置',async()=>{
   await manager.getByRole('button',{name:'外部检测',exact:true}).click();const next=app.waitForEvent('window');await manager.getByRole('dialog').getByRole('button',{name:'BrowserScan',exact:true}).click();browser=await next;browser.on('pageerror',error=>errors.push(error.message));
   await browser.waitForFunction(()=>typeof activeTab==='function'&&activeTab()?.url==='https://www.browserscan.net/zh');
   assert.equal(await browser.evaluate(()=>profile.id),profile.id);
   const count=await browser.evaluate(()=>tabs.length);assert.ok(count>=2);
   // Deterministic local content validates the same guest without treating an
   // external website's availability or score as a UI assertion.
   await browser.evaluate(url=>go(url),origin.url+'/probe');
   const guest=await until(()=>app.evaluate(({webContents},id)=>webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().endsWith('/probe')&&!w.isLoading())?.id,profile.id));
   const early=await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('window.early'),guest);assert.equal(early.language,'en-GB');assert.equal(early.tz,'Europe/London');
   return {tabs:count,language:early.language,timezone:early.tz};
  });
  await check('浏览器检测面板搜索、Tab、Escape 焦点、离线和浅深布局',async()=>{
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w._profile).setSize(640,600));await browserPanel();
   await browser.getByLabel('搜索检测项目',{exact:true}).fill('不存在的项目');await browser.getByText('没有匹配的检测项目',{exact:true}).waitFor();await browser.getByRole('button',{name:'清除搜索',exact:true}).click();
   await browser.locator('#diagnosticSearch').focus();await browser.keyboard.press('Tab');assert.equal(await browser.getByRole('button',{name:'BrowserScan',exact:true}).evaluate(el=>el===document.activeElement),true);
   await browser.context().setOffline(true);await browser.locator('#diagnosticOffline').waitFor();assert.equal(await browser.getByRole('button',{name:'BrowserScan',exact:true}).isDisabled(),true);await browser.context().setOffline(false);await until(()=>browser.getByRole('button',{name:'BrowserScan',exact:true}).isEnabled());
   for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>browser.evaluate(t=>document.documentElement.dataset.theme===t,theme));await browser.screenshot({path:path.join(output,'browser-'+theme+'.png')});const dimensions=await browser.locator('#diagnosticPanel').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth};});assert.ok(dimensions.left>=0&&dimensions.right<=dimensions.width&&dimensions.bottom<=dimensions.height);assert.equal(dimensions.overflow,false);}
   await browser.keyboard.press('Escape');assert.equal(await browser.locator('#diagnosticPanel').isHidden(),true);assert.equal(await browser.locator('#browserMenuBtn').evaluate(el=>el===document.activeElement),true);
  });
  await check('浏览器菜单在当前环境新标签打开，拒绝跨环境操作',async()=>{
   const other=await api('create',{name:'另一环境',startUrl:'about:home'});await assert.rejects(browser.evaluate(id=>window.api.diagnosticOpen(id,'browserscan'),other.id),/只能检测当前环境/);
   const before=await browser.evaluate(()=>tabs.length);await browserPanel();await browser.getByLabel('搜索检测项目',{exact:true}).fill('WebRTC');await browser.getByRole('button',{name:'WebRTC',exact:true}).click();await browser.waitForFunction(()=>activeTab()?.url==='https://browserleaks.com/webrtc');assert.equal(await browser.evaluate(()=>tabs.length),before+1);assert.equal(await browser.evaluate(()=>profile.id),profile.id);
   await browser.evaluate(url=>go(url),origin.url+'/probe');return {tabs:before+1};
  });
  await check('代理启动失败保留选择、就地错误与返回焦点；归档拒绝',async()=>{
   const failed=await api('create',{name:'代理失败检测',proxy:{type:'http',host:'127.0.0.1',port:1},startUrl:'about:home'});await openDetails(failed.id);await manager.getByRole('button',{name:'外部检测',exact:true}).click();const modal=manager.getByRole('dialog');await modal.getByRole('button',{name:'BrowserScan',exact:true}).click();await modal.getByRole('alert').filter({hasText:'代理不可达'}).waitFor();assert.equal(await modal.getByRole('button',{name:'BrowserScan',exact:true}).isDisabled(),false);await manager.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
   await api('action','archive',[failed.id]);await assert.rejects(api('diagnosticOpen',failed.id,'browserscan'),/请先恢复归档环境/);
  });
  await check('本机 Chrome 的检测新标签保持原环境协议配置',async()=>{
   const found=await api('chrome');if(!found){results.push({name:'本机 Chrome 未安装',status:'not-available'});return {available:false};}
   const native=await api('create',{name:'本机 Chrome 检测',os:process.platform==='win32'?'win':'mac',country:'UK',langManual:true,language:'en-GB',timezoneManual:true,timezone:'Europe/London',startUrl:origin.url+'/probe'});await api('launch',native.id);
   const opened=await api('diagnosticOpen',native.id,'browserscan');assert.equal(opened.engine,'chrome');
   const observed=await app.evaluate(async({app} ,id)=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),running=require('./src/main/launcher').getLaunchedBrowser(id);const {targetInfos}=await running.pipe.send('Target.getTargets');return {profile:running.profileId||id,version:running.fingerprint.chromeVersion,targets:targetInfos.filter(t=>t.type==='page').map(t=>({id:t.targetId,url:t.url}))};},native.id);
   assert.ok(observed.targets.length>=2);await api('action','stop',[native.id]);return {available:true,version:observed.version,pages:observed.targets.length};
  });
  await check('检测流程无未处理页面脚本错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){process.exitCode=1;console.error(error);results.push({name:'检测闭环验证',status:'failed',error:error.stack});if(manager&&!manager.isClosed())await manager.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
 finally{
  if(app){await app.evaluate(async({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');for(const[,running]of require('./src/main/launcher').getLaunchedBrowsers()){await running.pipe.send('Browser.close').catch(()=>running.child.kill());}}).catch(()=>{});await app.close().catch(()=>{});}
  if(origin)await origin.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),platform:process.platform,results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
})();
