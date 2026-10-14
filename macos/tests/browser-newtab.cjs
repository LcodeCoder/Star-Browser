'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const version=require('../package.json').version;
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-newtab-'));
const output=path.resolve('test-results/star-'+version,process.env.STAR_QA_EXECUTABLE?'packaged':''),results=[],errors=[];
let app,manager,browser,origin,profile;
async function until(run,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('新标签页验证等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const start=Date.now();try{const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-start,detail});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
async function expandNotes(){
 const summary=browser.locator('#s-note').locator('..').locator('summary');
 await summary.focus();if(!await summary.evaluate(el=>el.parentElement.open))await summary.press('Enter');
 await browser.locator('#s-note').waitFor({state:'visible'});
}
async function size(width,height=820){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows().find(win=>win._profile).setSize(width,height),{width,height});}
async function guest(){return until(()=>browser.evaluate(()=>{const t=activeTab();return !t?.ntp&&t?.web?.__starReady&&!t.web.isLoading()&&t.web.getURL().includes('/probe')&&t.web.getWebContentsId();}));}
async function read(id,source){return app.evaluate(async({webContents},{id,source})=>webContents.fromId(id).executeJavaScript(source),{id,source});}
async function releaseBookmarks(){await app.evaluate(({ipcMain})=>{
 const gate=globalThis.__newtabBookmarksGate;if(!gate)return;
 ipcMain.removeHandler('bookmarks:list');ipcMain.handle('bookmarks:list',gate.original);
 gate.release();delete globalThis.__newtabBookmarksGate;
});}
(async()=>{
 try{
  fs.mkdirSync(output,{recursive:true});origin=await startOrigin();
  const packaged=process.env.STAR_QA_EXECUTABLE;
  app=await _electron.launch({...packaged?{executablePath:packaged,args:[]}:{args:['.']},cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)}});
  manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  profile=await api('create',{name:'设计工作室',os:process.platform==='win32'?'win':'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,startUrl:'about:home'});
  await api('bookmarksAdd',{title:'GitHub',url:'https://github.com'});await api('bookmarksAdd',{title:'Wikipedia',url:'https://www.wikipedia.org'});
  // Delay the initial IPC response until the new tab has rendered its empty state.
  await app.evaluate(({ipcMain})=>{
   const gate={original:ipcMain._invokeHandlers.get('bookmarks:list'),requests:0};
   const ready=new Promise(resolve=>{gate.release=resolve;});globalThis.__newtabBookmarksGate=gate;
   ipcMain.removeHandler('bookmarks:list');ipcMain.handle('bookmarks:list',async(...args)=>{gate.requests++;await ready;return gate.original(...args);});
  });
  const opened=app.waitForEvent('window');await api('browse',profile.id);browser=await opened;browser.on('pageerror',error=>errors.push(error.message));await browser.waitForFunction(()=>profile?.id&&typeof StarSettings==='object');await browser.locator('#ntp').waitFor();
  await check('首次打开时迟到的收藏自动出现在新标签页',async()=>{
   await until(()=>app.evaluate(()=>globalThis.__newtabBookmarksGate.requests>0));
   assert.equal(await browser.locator('#ntpBookmarks button').count(),0);
   assert.match(await browser.locator('#ntpBookmarks').innerText(),/收藏常用网站/);
   await releaseBookmarks();await until(()=>browser.locator('#ntpBookmarks button').count());
   const titles=await browser.locator('#ntpBookmarks .ntp-label').allTextContents();
   assert.ok(titles.includes('GitHub'));assert.ok(titles.includes('Wikipedia'));return {titles};
  });
  await check('新标签页浅深主题与宽窄窗口保持完整布局和文字对比度',async()=>{
   await until(()=>browser.locator('#ntpBookmarks button').count());assert.equal(await browser.locator('#ntpCommon button').count(),4);
   const layouts=[];
   for(const theme of ['light','dark']){
    await api('preferences',{theme});await until(()=>browser.evaluate(theme=>document.documentElement.dataset.theme===theme,theme));
    for(const width of [1280,780,640]){
     await size(width,width===640?640:820);
     const layout=await browser.evaluate(()=>{
      const ntp=document.querySelector('#ntp'),search=document.querySelector('.ntp-search'),footer=document.querySelector('#ntp-footer');
      const rgb=text=>text.match(/[\d.]+/g).slice(0,3).map(Number),lum=color=>rgb(color).map(c=>{c/=255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const surface=getComputedStyle(ntp).backgroundColor,b=lum(surface);
      const ratios=['.ntp-logo','.ntp-environment','.ntp-section-title','.ntp-empty','.ntp-footer'].map(selector=>{const a=lum(getComputedStyle(document.querySelector(selector)).color);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
      return {overflow:document.documentElement.scrollWidth>innerWidth,search:search.getBoundingClientRect().toJSON(),ntp:ntp.getBoundingClientRect().toJSON(),toolbarBottom:document.querySelector('#bmBar').getBoundingClientRect().bottom,footer:footer.textContent,ratios};
     });
     assert.equal(layout.overflow,false);assert.ok(layout.search.x>=0&&layout.search.right<=width);assert.ok(layout.ntp.top>=layout.toolbarBottom-1);for(const row of layout.ratios)assert.ok(row.ratio>=4.5,JSON.stringify(row));
     assert.match(layout.footer,process.platform==='darwin'?/⌘L/:/Ctrl\+L/);
     await browser.screenshot({animations:'disabled',path:path.join(output,'browser-newtab-'+theme+(width===1280?'':'-'+width)+'.png')});layouts.push({theme,width,...layout});
    }
   }
   return layouts;
  });
  await check('常用网址支持键盘并留在当前环境，首脚本和会话正确',async()=>{
   await size(1280);await browser.evaluate(url=>renderCommonUrls([{name:'本地验证网站',url}]),origin.url+'/probe?from=common');
   await app.evaluate(({shell})=>{globalThis.__newtabExternal=shell.openExternal;globalThis.__newtabExternalCalls=[];shell.openExternal=async url=>{globalThis.__newtabExternalCalls.push(url);};});
   try{
    await browser.locator('#ntpCommon button').focus();await browser.keyboard.press('Enter');const id=await guest();
    const first=await read(id,'window.early');assert.equal(first.language,'ja-JP');assert.equal(first.tz,'Asia/Tokyo');assert.equal(await browser.locator('#ntp').isHidden(),true);
    assert.equal(await app.evaluate(({webContents},id)=>webContents.fromId(id).session.__tfbEnvId,id),profile.id);
    assert.deepEqual(await app.evaluate(()=>globalThis.__newtabExternalCalls),[]);
    await read(id,"localStorage.setItem('newtab-session','retained');document.cookie='newtab=retained; Path=/';true");
    await browser.locator('#home').click();await browser.locator('#ntpCommon button').focus();await browser.keyboard.press('Space');const second=await guest();
    const session=await read(second,"({value:localStorage.getItem('newtab-session'),cookies:document.cookie})");assert.equal(session.value,'retained');assert.match(session.cookies,/newtab=retained/);return {first,session};
   }finally{await app.evaluate(({shell})=>{shell.openExternal=globalThis.__newtabExternal;delete globalThis.__newtabExternal;delete globalThis.__newtabExternalCalls;});}
  });
  await check('回到起始页更新标签和窗口标题，清除旧页面加载提示',async()=>{
   await browser.evaluate(()=>{showFatal('旧页面失败');setTabLoading(activeId,true);});await browser.locator('#home').click();
   assert.equal(await browser.locator('#fatal').isHidden(),true);assert.equal(await browser.locator('#spinner').isHidden(),true);assert.equal(await browser.locator('#tabs .active .title').innerText(),'新标签');assert.match(await browser.title(),/设计工作室 · Star Browser/);assert.equal(await browser.locator('#addr').inputValue(),'');
   await browser.locator('#ntpSearch').fill(origin.url+'/probe?from=search');await browser.locator('#ntpSearch').press('Enter');const id=await guest();assert.equal((await read(id,'window.early')).language,'ja-JP');
  });
  await check('矮窗口的设置分区支持键盘和鼠标展开收起',async()=>{
   await size(780,620);await browser.locator('#profileIdentityBtn').click();
   const summary=browser.locator('#s-note').locator('..').locator('summary');
   await expandNotes();assert.equal(await summary.evaluate(el=>el.parentElement.open),true);
   await summary.focus();await summary.press('Space');assert.equal(await summary.evaluate(el=>el.parentElement.open),false);
   await summary.click();await browser.locator('#s-note').waitFor({state:'visible'});
   await summary.click();assert.equal(await summary.evaluate(el=>el.parentElement.open),false);
   const save=await browser.locator('#s-save').boundingBox();const height=await browser.evaluate(()=>innerHeight);assert.ok(save.y+save.height<=height);
   await browser.keyboard.press('Escape');await size(1280);
  });
  await check('环境身份入口关闭、取消和保存后返回原按钮，失败保留草稿',async()=>{
   await browser.locator('#profileIdentityBtn').click();await browser.locator('#settings').waitFor();assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-start');assert.equal(await browser.locator('#profileIdentityBtn').getAttribute('aria-expanded'),'true');
   await browser.keyboard.press('Escape');assert.equal(await browser.evaluate(()=>document.activeElement.id),'profileIdentityBtn');
   await browser.locator('#profileIdentityBtn').click();await expandNotes();await browser.locator('#s-note').fill('保留新草稿');await browser.keyboard.press('Escape');await browser.locator('#s-continue').click();assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-note');
   await browser.locator('#s-start').fill('file:///invalid');await browser.locator('#s-save').click();await browser.locator('#settingsError').waitFor();assert.equal(await browser.locator('#s-note').inputValue(),'保留新草稿');assert.equal(await browser.evaluate(()=>document.activeElement.id),'s-start');
   await browser.locator('#s-start').fill(origin.url+'/probe');await browser.locator('#s-save').click();await browser.locator('#settings').waitFor({state:'hidden'});await guest();assert.equal(await browser.evaluate(()=>document.activeElement.id),'profileIdentityBtn');assert.equal((await api('list')).find(row=>row.id===profile.id).note,'保留新草稿');
   await browser.locator('#gear').click();await browser.locator('#s-cancel').click();assert.equal(await browser.evaluate(()=>document.activeElement.id),'gear');
  });
  await check('离线备用起始页采用共享主题且可导航，不出现旧渐变界面',async()=>{
   await browser.evaluate(()=>go(homeUrl));const id=await until(()=>browser.evaluate(()=>{const web=activeTab()?.web;return web?.__starReady&&!web.isLoading()&&web.getURL().startsWith('data:')&&web.getWebContentsId();}));
   const colors=await read(id,"({background:getComputedStyle(document.body).backgroundColor,image:getComputedStyle(document.body).backgroundImage,palette:getComputedStyle(document.documentElement).getPropertyValue('--ui-surface')})");assert.equal(colors.image,'none');assert.ok(colors.palette.trim());
   await read(id,"document.getElementById('u').value='file:///invalid';document.getElementById('search').requestSubmit();true");assert.equal(await read(id,"document.getElementById('error').hidden"),false);
   await read(id,`document.getElementById('u').value=${JSON.stringify(origin.url+'/probe?from=offline')};document.getElementById('search').requestSubmit();true`);await guest();return colors;
  });
  await check('新标签页没有未捕获脚本异常',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);process.exitCode=1;if(browser&&!browser.isClosed())await browser.screenshot({path:path.join(output,'newtab-failure.png')}).catch(()=>{});}
 finally{if(app){await releaseBookmarks().catch(()=>{});await app.close().catch(()=>{});}if(origin)await origin.close();fs.writeFileSync(path.join(output,'browser-newtab.json'),JSON.stringify({status:process.exitCode?'failed':'passed',version,packaged:!!process.env.STAR_QA_EXECUTABLE,testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
