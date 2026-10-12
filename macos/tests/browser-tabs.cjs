'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {startOrigin}=require('./fixtures.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-tabs-')),results=[];let app,manager,browser,origin,profile,first,other;
async function until(run,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('标签验证等待超时');}
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){const started=Date.now();const detail=await run();results.push({name,status:'passed',durationMs:Date.now()-started,detail});console.log('PASS',name);}
async function launch(){app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)}});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();}
async function open(){const next=app.waitForEvent('window');await api('browse',profile.id);browser=await next;await browser.waitForFunction(()=>typeof createTab==="function"&&Array.isArray(tabs));await until(()=>browser.evaluate(()=>activeTab()?.web?.__starReady&&!activeTab().web.isLoading()&&/^http/.test(activeTab().web.getURL())));}
async function guest(id,expression){return app.evaluate(async({webContents},{id,expression})=>webContents.fromId(id).executeJavaScript(expression),{id,expression});}
async function menu(id,label){await browser.locator(`[data-tab-id="${id}"]`).click({button:'right'});await browser.getByRole('menu',{name:'标签页操作'}).waitFor();await browser.getByRole('menuitem',{name:label,exact:true}).click();}
(async()=>{
 try{
  origin=await startOrigin();await launch();profile=await api('create',{name:'标签专项',os:'mac',country:'JP',langManual:true,language:'ja-JP',timezoneManual:true,timezone:'Asia/Tokyo',startUrl:'http://localhost:'+origin.port+'/probe'});await open();
  first=await browser.evaluate(()=>({id:tabs[0].id,guest:tabs[0].web.getWebContentsId()}));
  await check('真实标签固定、排序、静音与键盘菜单',async()=>{
   other=await browser.evaluate(url=>createTab(url),'http://localhost:'+origin.port+'/sync');await until(()=>browser.evaluate(()=>tabs[1].web?.__starReady&&!tabs[1].web.isLoading()));
   await menu(other,'固定标签');assert.deepEqual(await browser.evaluate(()=>tabs.map(t=>({id:t.id,pinned:t.pinned}))),[{id:other,pinned:true},{id:first.id,pinned:false}]);
   await menu(other,'静音标签');assert.equal(await app.evaluate(({webContents},id)=>webContents.fromId(id).isAudioMuted(),await browser.evaluate(id=>tabs.find(t=>t.id===id).web.getWebContentsId(),other)),true);
   await menu(other,'取消固定标签');await menu(other,'向右移动');assert.equal(await browser.evaluate(()=>tabs[1].id),other);
   await browser.locator(`[data-tab-id="${other}"]`).focus();await browser.keyboard.press('Shift+F10');await browser.getByRole('menu',{name:'标签页操作'}).waitFor();await browser.keyboard.press('End');assert.equal(await browser.evaluate(()=>document.activeElement.textContent),'关闭标签');await browser.keyboard.press('Escape');assert.equal(await browser.getByRole('menu',{name:'标签页操作'}).isVisible(),false);
   return {order:await browser.evaluate(()=>tabs.map(t=>t.id)),muted:true};
  });
  await check('后台标签实际销毁 guest，Cookie 与存储在唤醒后保持',async()=>{
   await guest(first.guest,"localStorage.setItem('tabsQA','kept');document.cookie='tabsQA=kept; path=/';true");
   await menu(first.id,'休眠后台标签');assert.equal(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest),false);assert.equal(await browser.evaluate(id=>tabs.find(t=>t.id===id).sleeping,first.id),true);
   await browser.locator(`[data-tab-id="${first.id}"]`).click();await until(()=>browser.evaluate(id=>{const t=tabs.find(t=>t.id===id);return t.web?.__starReady&&!t.web.isLoading()&&t.web.getURL().includes('/probe');},first.id));
   const newGuest=await browser.evaluate(id=>tabs.find(t=>t.id===id).web.getWebContentsId(),first.id);assert.notEqual(newGuest,first.guest);first.guest=newGuest;
   const actual=await guest(newGuest,"({local:localStorage.getItem('tabsQA'),cookie:document.cookie,tz:window.early.tz})");assert.equal(actual.local,'kept');assert.ok(actual.cookie.includes('tabsQA=kept'));assert.equal(actual.tz,'Asia/Tokyo');return actual;
  });
  await check('当前标签不能休眠，未保存输入与 beforeunload 被保护',async()=>{
   await browser.locator(`[data-tab-id="${first.id}"]`).click({button:'right'});assert.equal(await browser.getByRole('menuitem',{name:'休眠后台标签',exact:true}).isDisabled(),true);await browser.keyboard.press('Escape');
   await browser.locator(`[data-tab-id="${other}"]`).click();
   await guest(first.guest,"const text=document.createElement('input');text.id='unsaved';document.body.append(text);text.value='unsaved';true");await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'未提交输入'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));
   await guest(first.guest,"document.querySelector('#unsaved').value='';window.onbeforeunload=e=>{e.preventDefault();e.returnValue='';};true");
   // Chromium only honors beforeunload after a real activation. Guest click is native input.
   await app.evaluate(({webContents},id)=>webContents.fromId(id).sendInputEvent({type:'mouseDown',x:20,y:20,button:'left',clickCount:1}),first.guest);await app.evaluate(({webContents},id)=>webContents.fromId(id).sendInputEvent({type:'mouseUp',x:20,y:20,button:'left',clickCount:1}),first.guest);
   await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'离开确认'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));await guest(first.guest,'window.onbeforeunload=null;true');
  });
  await check('真实静音媒体播放与未完成下载阻止休眠',async()=>{
   const media=await app.evaluate(async({webContents},id)=>webContents.fromId(id).executeJavaScript("(async()=>{const audio=document.createElement('audio');audio.id='sleepMedia';audio.src='/silence.wav';audio.muted=true;audio.loop=true;document.body.append(audio);await audio.play();return {paused:audio.paused,ready:audio.readyState};})()",true),first.guest);assert.equal(media.paused,false);
   await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'播放媒体'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));await guest(first.guest,"document.querySelector('#sleepMedia').pause();document.querySelector('#sleepMedia').remove();true");
   await app.evaluate(({webContents},{id,file})=>webContents.fromId(id).session.once('will-download',(_e,item)=>item.setSavePath(file)),{id:first.guest,file:path.join(dir,'sleep-download.bin')});await guest(first.guest,"const download=document.createElement('a');download.href='/download?sleep-guard';document.body.append(download);download.click();true");const download=await until(async()=>(await api('snapshot')).downloads.find(row=>row.profileId===profile.id&&row.state==='progressing'));
   await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'未完成下载'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));await api('downloadAction',download.id,'cancel');return {media,downloadBlocked:true};
  });
  await check('运行任务与参与同步的环境阻止标签休眠',async()=>{
   const task=await api('taskSave',{name:'休眠冲突',steps:[{type:'wait',duration:2000}]});const runs=await api('taskStart',task.id,[profile.id]);await until(async()=>(await api('snapshot')).taskRuns.find(r=>r.id===runs[0].id)?.state==='running');await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'任务'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));await api('taskCancel',runs[0].id);await until(async()=>!['queued','running'].includes((await api('snapshot')).taskRuns.find(r=>r.id===runs[0].id)?.state));
   const second=await api('create',{name:'同步保护',os:'mac',startUrl:'http://localhost:'+origin.port+'/sync'});await api('browse',second.id);await until(()=>app.evaluate(({webContents},id)=>webContents.getAllWebContents().some(w=>w.getType()==='webview'&&w.session.__tfbEnvId===id&&w.getURL().includes('/sync')&&!w.isLoading()),second.id));await api('syncStart',{master:profile.id,followers:[second.id],navigation:false});await menu(first.id,'休眠后台标签');await browser.locator('#toast').filter({hasText:'窗口同步'}).waitFor();assert.ok(await app.evaluate(({webContents},id)=>!!webContents.fromId(id),first.guest));await api('syncStop');await api('action','stop',[second.id]);
  });
  await check('复制标签与关闭恢复保留静音/固定，休眠状态重启恢复',async()=>{
   await menu(other,'复制标签');const duplicate=await browser.evaluate(()=>activeId);assert.equal(await browser.evaluate(()=>activeTab().muted),true);await menu(duplicate,'固定标签');await browser.evaluate(id=>closeTab(id),duplicate);await browser.keyboard.press('Meta+Shift+t');assert.equal(await browser.evaluate(()=>activeTab().pinned),true);assert.equal(await browser.evaluate(()=>activeTab().muted),true);
   await browser.locator(`[data-tab-id="${other}"]`).click();await menu(first.id,'休眠后台标签');await browser.evaluate(()=>StarBrowser.persist(true));await until(async()=>{const p=(await api('list')).find(p=>p.id===profile.id);return p.sessionTabs.some(t=>t.sleeping)&&p.sessionTabs.some(t=>t.pinned&&t.muted);});
   await browser.screenshot({path:path.resolve('test-results/tabs-light.png')});await api('preferences',{theme:'dark'});await until(()=>browser.evaluate(()=>document.documentElement.dataset.theme==='dark'));await browser.screenshot({path:path.resolve('test-results/tabs-dark.png')});
   await app.close();app=null;await launch();await open();assert.equal(await browser.evaluate(()=>tabs.filter(t=>t.sleeping).length),1);assert.equal(await browser.evaluate(()=>tabs.filter(t=>t.pinned&&t.muted).length),1);assert.ok(await browser.evaluate(()=>activeTab().web));
  });
  await check('浏览器菜单入口、窄窗口与减少动画保持操作可达',async()=>{
   await app.evaluate(({BrowserWindow},id)=>{const window=BrowserWindow.getAllWindows().find(w=>w._profile?.id===id);window.setMinimumSize(480,500);window.setSize(780,680);},profile.id);
   await browser.emulateMedia({reducedMotion:'reduce'});await browser.locator('#browserMenuBtn').click();await browser.locator('#tabActionsBtn').click();await browser.getByRole('menu',{name:'标签页操作'}).waitFor();const bounds=await browser.getByRole('menu',{name:'标签页操作'}).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=780);await browser.screenshot({path:path.resolve('test-results/tabs-narrow-menu.png')});await browser.keyboard.press('Escape');
   await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w._profile?.id===id).setSize(1280,800),profile.id);
  });
  await check('标签搜索能定位休眠标签，唤醒后首脚本一致且不重复历史',async()=>{
   await browser.locator('#tabSearchBtn').click();await browser.locator('#tabSearchInput').fill('/probe');await browser.locator('.tab-search-item').first().click();await until(()=>browser.evaluate(()=>activeTab().web?.__starReady&&!activeTab().web.isLoading()&&activeTab().web.getURL().includes('/probe')));const id=await browser.evaluate(()=>activeTab().web.getWebContentsId());assert.equal((await guest(id,'window.early')).tz,'Asia/Tokyo');assert.equal(await browser.evaluate(()=>activeTab().sleeping),false);
  });
 }catch(error){console.error(error);results.push({name:'标签专项',status:'failed',error:error.stack});process.exitCode=1;if(browser&&!browser.isClosed())await browser.screenshot({path:path.resolve('test-results/tabs-failure.png')}).catch(()=>{});}
 finally{if(app){await app.evaluate(({app})=>{try{const fs=process.getBuiltinModule('fs');fs.copyFileSync(app.getPath('userData')+'/tfb-debug.log',process.cwd()+'/test-results/tabs-runtime.log');}catch{}}).catch(()=>{});await app.close().catch(()=>{});}if(origin)await origin.close();fs.writeFileSync('test-results/tabs.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});}
})();
