'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startOrigin}=require('./fixtures.cjs');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-browser-bookmarks-'));
const output=path.resolve('test-results/browser-bookmarks');fs.mkdirSync(output,{recursive:true});
const results=[],errors=[];let app,manager,browser,origin,saved;
const shortcut=process.platform==='darwin'?'Meta+Enter':'Control+Enter';
const api=(method,...args)=>manager.evaluate(({method,args})=>window.api[method](...args),{method,args});
async function check(name,run){const start=Date.now();try{const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-start,detail});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
async function focus(id){await browser.waitForFunction(id=>document.activeElement.id===id,id);}
async function intercept(channel,mode){await app.evaluate(({ipcMain},{channel,mode})=>{
 globalThis.__starBookmarkOriginal ||= new Map();const original=ipcMain._invokeHandlers.get(channel);globalThis.__starBookmarkOriginal.set(channel,original);ipcMain.removeHandler(channel);
 ipcMain.handle(channel,async(event,...inputs)=>{if(mode==='failure')throw new Error('模拟磁盘写入失败');await new Promise(resolve=>{globalThis.__starBookmarkRelease=resolve;});return original(event,...inputs);});
},{channel,mode});}
async function restore(channel,release=false){await app.evaluate(({ipcMain},{channel,release})=>{const original=globalThis.__starBookmarkOriginal.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,original);globalThis.__starBookmarkOriginal.delete(channel);if(release){globalThis.__starBookmarkRelease?.();delete globalThis.__starBookmarkRelease;}},{channel,release});}
(async()=>{
 try{
  origin=await startOrigin();app=await _electron.launch({args:['.','--host-resolver-rules=MAP qa.local 127.0.0.1'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(origin.port)}});
  manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();manager.on('pageerror',e=>errors.push(e.message));
  const profile=await api('create',{name:'浏览器书签验证',os:'mac',startUrl:'http://qa.local:'+origin.port+'/probe',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true});
  const next=app.waitForEvent('window');await api('browse',profile.id);browser=await next;browser.on('pageerror',e=>errors.push(e.message));await browser.waitForFunction(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading());
  await check('星标收藏使用完整网址，过长网页标题规范截取，真实字段标签可定位',async()=>{
   const id=await browser.evaluate(()=>activeTab().web.getWebContentsId());await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('document.title="长".repeat(600)'),id);
   await browser.locator('#starBtn').click();await browser.locator('#starPop').waitFor({state:'visible'});await focus('starTitle');assert.equal((await browser.getByLabel('名称',{exact:true}).inputValue()).length,512);
   saved=(await api('bookmarksList')).find(b=>b.title==='长'.repeat(512));assert.ok(saved?.id);assert.equal(await browser.getByLabel('网址',{exact:true}).inputValue(),saved.url);
  });
  await check('错误定位名称与网址，未保存确认恢复焦点，快捷键保存与星标状态一致',async()=>{
   await browser.getByLabel('名称',{exact:true}).fill(' ');await browser.getByRole('button',{name:'保存',exact:true}).click();await focus('starTitle');assert.equal(await browser.locator('#starTitle').getAttribute('aria-invalid'),'true');
   await browser.getByLabel('名称',{exact:true}).fill('浏览器书签');await browser.getByLabel('网址',{exact:true}).fill('https://name:secret@example.com');await browser.getByRole('button',{name:'保存',exact:true}).click();await focus('starUrl');assert.match(await browser.locator('#starError').innerText(),/账号或密码/);assert.ok(await browser.locator('#starUrl').getAttribute('aria-describedby'));
   await browser.getByLabel('网址',{exact:true}).fill('HTTP://QA.LOCAL:'+origin.port+'/probe');await browser.keyboard.press('Escape');await focus('starContinue');await browser.getByRole('button',{name:'继续编辑',exact:true}).click();await focus('starUrl');await browser.keyboard.press(shortcut);await browser.locator('#starPop').waitFor({state:'hidden'});await focus('starBtn');
   const item=(await api('bookmarksList')).find(b=>b.id===saved.id);assert.equal(item.title,'浏览器书签');assert.equal(item.url,'http://qa.local:'+origin.port+'/probe');assert.ok((await browser.locator('#starBtn').getAttribute('class')).includes('on'));
  });
  await check('磁盘失败保留书签草稿，忙碌时锁定关闭，按钮焦点下快捷键可重试',async()=>{
   await browser.locator('#starBtn').click();await browser.getByLabel('名称',{exact:true}).fill('失败后重试');await intercept('bookmarks:update','failure');await browser.getByRole('button',{name:'保存',exact:true}).click();await browser.locator('#starError').waitFor({state:'visible'});await focus('starError');assert.match(await browser.locator('#starError').innerText(),/模拟磁盘写入失败/);assert.equal(await browser.locator('#starTitle').inputValue(),'失败后重试');assert.equal((await api('bookmarksList')).find(b=>b.id===saved.id).title,'浏览器书签');await restore('bookmarks:update');
   await intercept('bookmarks:update','hold');await browser.locator('#starDone').focus();await focus('starDone');await browser.keyboard.press(shortcut);await browser.getByRole('button',{name:'保存中…',exact:true}).waitFor();assert.ok(await browser.locator('#starTitle').isDisabled());assert.ok(await browser.locator('#starCancel').isDisabled());await browser.keyboard.press('Escape');assert.ok(await browser.locator('#starPop').isVisible());await restore('bookmarks:update',true);await browser.locator('#starPop').waitFor({state:'hidden'});assert.equal((await api('bookmarksList')).find(b=>b.id===saved.id).title,'失败后重试');
  });
  await check('点击外部和 Escape 均保护修改，浅深主题窄窗书签气泡保持可见',async()=>{
   await browser.locator('#starBtn').click();await browser.getByLabel('名称',{exact:true}).fill('尚未保存');await browser.locator('#addr').click();await focus('starContinue');await browser.getByRole('button',{name:'继续编辑',exact:true}).click();
   const measures=[];
   for(const width of [780,500])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow},{width,id})=>{const win=BrowserWindow.getAllWindows().find(w=>w._profile?.id===id);win.setMinimumSize(480,500);win.setSize(width,760);}, {width,id:profile.id});await api('preferences',{theme});await browser.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
    // Re-open through the normal route after resizing, retaining the saved item.
    await browser.keyboard.press('Escape');await browser.getByRole('button',{name:'放弃更改',exact:true}).click();await browser.locator('#starBtn').click();await browser.locator('#starPop').waitFor({state:'visible'});await browser.getByLabel('名称',{exact:true}).fill('尚未保存');
    const rect=await browser.locator('#starPop').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth-el.clientWidth};});assert.ok(rect.left>=0&&rect.right<=rect.width&&rect.bottom<=rect.height&&rect.overflow<=1,JSON.stringify(rect));measures.push({width,theme,...rect});await browser.screenshot({animations:'disabled',path:path.join(output,'bookmark-'+theme+'-'+width+'.png')});
   }
   await browser.keyboard.press('Escape');await browser.getByRole('button',{name:'放弃更改',exact:true}).click();assert.equal((await api('bookmarksList')).find(b=>b.id===saved.id).title,'失败后重试');return measures;
  });
  await check('删除失败仍可继续编辑和重试，完成后清除星标并返回触发按钮',async()=>{
   await browser.locator('#starBtn').click();await intercept('bookmarks:remove','failure');await browser.getByRole('button',{name:'删除',exact:true}).click();await browser.locator('#starError').waitFor({state:'visible'});await focus('starError');assert.ok((await api('bookmarksList')).some(b=>b.id===saved.id));assert.ok(await browser.locator('#starRemove').isEnabled());await restore('bookmarks:remove');await browser.getByRole('button',{name:'删除',exact:true}).click();await browser.locator('#starPop').waitFor({state:'hidden'});await focus('starBtn');assert.ok(!(await api('bookmarksList')).some(b=>b.id===saved.id));assert.ok(!(await browser.locator('#starBtn').getAttribute('class')).includes('on'));
  });
  await check('窄窗浏览菜单支持方向键、首尾定位、Escape 与系统收藏快捷键',async()=>{
   assert.ok(await browser.locator('#starBtn').isVisible());await browser.locator('#browserMenuBtn').focus();await browser.keyboard.press('ArrowDown');await browser.getByRole('menu',{name:'浏览器菜单',exact:true}).waitFor();await browser.waitForFunction(()=>document.activeElement.dataset.command==='devtools');assert.equal(await browser.locator('#browserMenuBtn').getAttribute('aria-expanded'),'true');
   await browser.keyboard.press('End');await focus('themeToggle');await browser.keyboard.press('Home');await browser.waitForFunction(()=>document.activeElement.dataset.command==='devtools');await browser.keyboard.press('ArrowDown');await browser.waitForFunction(()=>document.activeElement.dataset.command==='diagnostics');await browser.keyboard.press('Escape');await focus('browserMenuBtn');assert.equal(await browser.locator('#browserMenuBtn').getAttribute('aria-expanded'),'false');
   await browser.locator('#browserMenuBtn').click();await browser.getByRole('menuitem',{name:'收藏夹',exact:true}).click();await browser.locator('#bmPanel').waitFor({state:'visible'});await browser.locator('#bm-close').click();
   await app.evaluate(({BrowserWindow,Menu},id)=>{const win=BrowserWindow.getAllWindows().find(w=>w._profile?.id===id);win.focus();const command=Menu.getApplicationMenu().getMenuItemById('bookmarkCurrentPage');if(command.accelerator!=='CmdOrCtrl+D')throw new Error('Missing bookmark accelerator');command.click({},win,win.webContents);},profile.id);
   await browser.locator('#starPop').waitFor({state:'visible'});await focus('starTitle');await browser.locator('#starCancel').click();await browser.locator('#starPop').waitFor({state:'hidden'});
  });
  await check('书签浏览操作没有未捕获页面错误',async()=>assert.deepEqual(errors,[]));
 }catch(error){console.error(error);process.exitCode=1;if(browser)await browser.screenshot({animations:'disabled',path:path.join(output,'failure.png')}).catch(()=>{});}
 finally{if(app)await app.close().catch(()=>{});if(origin)await origin.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,errors},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
