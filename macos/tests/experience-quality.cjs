'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-experience-')),out=path.resolve('test-results/star-0.13.0'),results=[],errors=[];
let app,manager,browser,origin,slow;const sockets=new Set();fs.mkdirSync(out,{recursive:true});
async function until(run,timeout=16000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('体验验收等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const started=Date.now(),detail=await run();results.push({name,status:'passed',durationMs:Date.now()-started,detail});console.log('PASS',name);}
async function size(width,height=820){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows().find(w=>w._profile).setSize(width,height),{width,height});}
async function openChecks(){if(await browser.locator('#batchPanel').isHidden()){if(await browser.locator('#batchBtn').isVisible())await browser.locator('#batchBtn').click();else{await browser.locator('#browserMenuBtn').click();await browser.locator('#openProxyChecks').click();}}await browser.locator('#batchPanel').waitFor();await browser.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));}
async function contrast(page,pairs){return page.evaluate(pairs=>{
 const rgb=text=>text.match(/[\d.]+/g).slice(0,3).map(Number),lum=color=>rgb(color).map(c=>{c/=255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 return pairs.map(([selector,bgSelector])=>{const element=document.querySelector(selector),surface=document.querySelector(bgSelector),text=getComputedStyle(element).color,bg=getComputedStyle(surface).backgroundColor,a=lum(text),b=lum(bg);return {selector,text,bg,ratio:Math.round((Math.max(a,b)+.05)/(Math.min(a,b)+.05)*100)/100};});
},pairs);}
(async()=>{try{
 origin=await startOrigin();slow=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>slow.listen(0,'127.0.0.1',resolve));
 const env={...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)};
 const packaged=process.env.STAR_QA_EXECUTABLE;
 app=await _electron.launch({...packaged?{executablePath:packaged,args:[]}:{args:['.']},cwd:process.cwd(),env});manager=await app.firstWindow();manager.on('pageerror',e=>errors.push(e.message));await manager.locator('#btnNew').waitFor();
 const p=await api('create',{name:'Studio · 工作环境',country:'JP',os:process.platform==='win32'?'win':'mac',timezone:'Asia/Tokyo',timezoneManual:true,language:'ja-JP',langManual:true,startUrl:origin.url+'/probe'});
 for(let i=0;i<42;i++)await api('create',{name:'Studio · 工作 '+String(i+1).padStart(2,'0'),country:i%2?'JP':'US',tags:[i%2?'内容':'项目']});
 await check('工作台全部页面在浅深主题的布局与真实对比度',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w._profile).setSize(1280,820));const measurements=[];
  for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>manager.evaluate(t=>document.documentElement.dataset.theme===t,theme));for(const id of ['navEnv','navProxy','navCookie','navBookmarks','navDownloads','navExtensions','navSynchronizer','navTasks','navActivity','navSettings']){await manager.locator('#'+id).click();await manager.locator('main h1').waitFor();assert.equal(await manager.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}await manager.locator('#navEnv').click();
   const ratios=await contrast(manager,[['h1','.main'],['.page-title>p','.main'],['.nav-label','.sidebar'],['.button.primary','.button.primary']]);for(const row of ratios)assert.ok(row.ratio>=4.5,theme+' '+JSON.stringify(row));measurements.push({theme,ratios});await manager.screenshot({path:path.join(out,'workbench-'+theme+'.png')});
  }return measurements;
 });
 await check('长环境列表保留原生滚动，减少动画模式停用平滑定位',async()=>{
  const scroller=manager.locator('.object-table');assert.equal(await scroller.evaluate(el=>getComputedStyle(el).scrollBehavior),'smooth');await scroller.hover();await manager.mouse.wheel(0,500);await until(()=>scroller.evaluate(el=>el.scrollTop>0));const pos=await scroller.evaluate(el=>el.scrollTop);
  await manager.emulateMedia({reducedMotion:'reduce'});assert.equal(await scroller.evaluate(el=>getComputedStyle(el).scrollBehavior),'auto');await manager.emulateMedia({reducedMotion:'no-preference'});return {scrollTop:pos};
 });
 const next=app.waitForEvent('window');await api('browse',p.id);browser=await next;browser.on('pageerror',e=>errors.push(e.message));await browser.waitForFunction(()=>typeof StarNetwork==='object');await size(1280);await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()));
 await check('新标签紧邻标签末尾，溢出定位当前标签并保留入口',async()=>{
  const last=await browser.locator('#tabs .tab').last().boundingBox(),plus=await browser.locator('#newTab').boundingBox();assert.ok(plus.x-last.x-last.width<=12);assert.ok(plus.x>last.x);
  await browser.evaluate(()=>{for(let i=0;i<34;i++)createTab('about:home',{background:true});activateTab(tabs.at(-1).id);});
  await until(()=>browser.locator('#tabs').evaluate(el=>el.scrollLeft>0));const scroll=await browser.locator('#tabs').evaluate(el=>({scrollLeft:el.scrollLeft,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}));assert.ok(scroll.scrollWidth>scroll.clientWidth);const active=await browser.locator('#tabs .active').boundingBox(),viewport=await browser.locator('#tabs').boundingBox();await until(async()=>{const a=await browser.locator('#tabs .active').boundingBox();return a.x>=viewport.x-1&&a.x+a.width<=viewport.x+viewport.width+1;});assert.equal(await browser.locator('#newTab').isVisible(),true);assert.equal(await browser.locator('#tabSearchBtn').isVisible(),true);
  await browser.evaluate(()=>{const keep=tabs[0].id;for(const t of [...tabs])if(t.id!==keep)closeTab(t.id);activateTab(keep);});return scroll;
 });
 await check('批量输入区、结果表格与固定操作区在宽窄窗口布局正确',async()=>{
  const boxes=[];
  for(const width of [1280,780,640]){await size(width,720);await openChecks();const dialog=await browser.locator('#batchPanel').boundingBox(),input=await browser.locator('#batch-input').boundingBox(),footer=await browser.locator('.batch-footer').boundingBox();assert.ok(input.height>=130);assert.ok(dialog.x>=0&&dialog.x+dialog.width<=width);assert.ok(footer.y+footer.height<=dialog.y+dialog.height+1);assert.equal(await browser.locator('#batch-run').isDisabled(),true);assert.equal(await browser.locator('#batch-export').isDisabled(),true);assert.equal(await browser.locator('#batch-empty').isVisible(),true);await browser.screenshot({path:path.join(out,'proxy-check-empty-'+width+'.png')});boxes.push({width,dialog,input});await browser.locator('#batch-close').click();}
  return boxes;
 });
 await check('批量弹层键盘闭环、焦点约束和菜单入口返回',async()=>{
  await openChecks();assert.equal(await browser.locator('#batch-input').evaluate(el=>el===document.activeElement),true);await browser.locator('#batch-close').focus();await browser.keyboard.press('Shift+Tab');assert.equal(await browser.evaluate(()=>document.activeElement.id),'batch-table');await browser.keyboard.press('Tab');assert.equal(await browser.evaluate(()=>document.activeElement.id),'batch-close');
  await browser.locator('#batch-filter').focus();await browser.keyboard.press('Tab');assert.equal(await browser.evaluate(()=>document.activeElement.id),'batch-table');
  await browser.keyboard.press('Escape');assert.equal(await browser.locator('#batchPanel').isHidden(),true);assert.equal(await browser.locator('#batchOverlay').isHidden(),true);assert.equal(await browser.evaluate(()=>document.querySelector('.toolbar').inert),false);assert.equal(await browser.evaluate(()=>document.activeElement.id),'browserMenuBtn');
 });
 await check('逐条失败结果、搜索筛选、错误保留及重开保持上下文',async()=>{
  await size(1280);await openChecks();await browser.locator('#batch-input').fill('not-a-proxy\nhttp://127.0.0.1:1\nsocks5://127.0.0.1:2');await browser.locator('#batch-run').click();await until(()=>browser.locator('#batch-run').isEnabled());assert.equal(await browser.locator('#batch-body tr').count(),3);assert.match(await browser.locator('#batch-status').innerText(),/3 \/ 3/);assert.equal(await browser.locator('#batch-export').isEnabled(),true);
  await browser.locator('#batch-filter').selectOption('ok');assert.equal(await browser.locator('#batch-body tr').count(),0);assert.match(await browser.locator('#batch-empty-title').innerText(),/没有符合/);await browser.locator('#batch-filter').selectOption('failed');assert.equal(await browser.locator('#batch-body tr').count(),3);await browser.locator('#batch-search').fill('127.0.0.1:1');assert.equal(await browser.locator('#batch-body tr').count(),1);await browser.locator('#batch-close').click();await openChecks();assert.equal(await browser.locator('#batch-search').inputValue(),'127.0.0.1:1');await browser.locator('#batch-search').fill('');await browser.locator('#batch-filter').selectOption('all');await browser.screenshot({path:path.join(out,'proxy-check-failures.png')});
 });
 await check('检测成功/失败/未知信息的对比度在浅深主题均可读',async()=>{
  const samples=[];for(const theme of ['light','dark']){await api('preferences',{theme});await until(()=>browser.evaluate(t=>document.documentElement.dataset.theme===t,theme));const ratios=await contrast(browser,[['.batch-head h2','#batchPanel'],['#batch-description','#batchPanel'],['#batch-format','#batchPanel'],['#batch-input','#batch-input'],['.batch-tbl th','.batch-tbl th'],['.st-fail','.batch-table-wrap'],['#batch-run','#batch-run']]);for(const row of ratios)assert.ok(row.ratio>=4.5,theme+' '+JSON.stringify(row));samples.push({theme,ratios});await browser.screenshot({path:path.join(out,'proxy-check-'+theme+'.png')});}return samples;
 });
 await check('停止检测不提交新连接，关闭重开仍显示完成进度',async()=>{
  await browser.locator('#batch-clear').click();const proxy=`socks5://qa:pw@127.0.0.1:${slow.address().port}`;await browser.locator('#batch-input').fill(Array(15).fill(proxy).join('\n'));await browser.locator('#batch-run').click();await until(()=>sockets.size>0);await browser.locator('#batch-cancel').click();await browser.locator('#batch-close').click();await openChecks();assert.match(await browser.locator('#batch-status').innerText(),/停止/);for(const socket of sockets)socket.destroy();await until(()=>browser.locator('#batch-run').isEnabled());assert.match(await browser.locator('#batch-status').innerText(),/已停止/);assert.ok(await browser.locator('#batch-body tr').count()<15);return {completed:await browser.locator('#batch-body tr').count(),queued:15};
 });
 await check('超限输入给出就地错误，编辑后可恢复，减少动画用于浏览器弹层',async()=>{
  await browser.locator('#batch-input').fill(Array(501).fill('bad').join('\n'));assert.equal(await browser.locator('#batch-run').isDisabled(),true);assert.match(await browser.locator('#batch-error').innerText(),/500/);await browser.locator('#batch-input').fill('bad');assert.equal(await browser.locator('#batch-error').isHidden(),true);await browser.emulateMedia({reducedMotion:'reduce'});assert.equal(await browser.locator('.batch-content').evaluate(el=>getComputedStyle(el).scrollBehavior),'auto');assert.equal(await browser.locator('#batchPanel').evaluate(el=>getComputedStyle(el).animationName),'none');await browser.keyboard.press('Escape');await browser.emulateMedia({reducedMotion:'no-preference'});
 });
 await check('每个浏览器工具面板使用语义深色面与有效入口',async()=>{
  await size(1280);await api('preferences',{theme:'dark'});for(const [trigger,panel,close] of [['#bmBtn','#bmPanel','#bm-close'],['#launchBtn','#launcher','#launcher-close'],['#gear','#settings','#s-cancel'],['#historyBtn','#historyPanel','#historyClose'],['#tabSearchBtn','#tabSearchPanel','#tabSearchClose']]){await browser.locator(trigger).click();await browser.locator(panel).waitFor();const bg=await browser.locator(panel).evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(bg,'rgb(40, 45, 53)');await browser.locator(close).click();}await browser.locator('#browserMenuBtn').click();await browser.screenshot({path:path.join(out,'browser-tools-dark.png')});await browser.keyboard.press('Escape');
 });
 await check('界面无未捕获错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);results.push({name:'体验质量验收',status:'failed',error:error.stack});if(browser)await browser.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
 finally{if(app)await app.close().catch(()=>{});for(const socket of sockets)socket.destroy();if(slow)await new Promise(r=>slow.close(r));if(origin)await origin.close();fs.writeFileSync(path.join(out,'experience-quality.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),packaged:!!process.env.STAR_QA_EXECUTABLE,results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});}
})();
