'use strict';
const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'star-workspace-editors-'));
const output = path.resolve('test-results/workspace-editors');
fs.mkdirSync(output, {recursive:true});
const results = [], errors = [];
let app, manager, proxy, savedTask;
const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
async function api(method,...args) { return manager.evaluate(({method,args}) => window.api[method](...args), {method,args}); }
async function check(name,run) {
  const start=Date.now();
  try { const detail=await run(); results.push({name,status:'passed',durationMs:Date.now()-start,detail}); console.log('PASS',name); }
  catch(error) { results.push({name,status:'failed',error:error.stack}); throw error; }
}
async function focus(id) { await manager.waitForFunction(id => document.activeElement.id === id,id); }
async function setSize(width) { await app.evaluate(({BrowserWindow},width) => {const win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Star Browser'); win.setMinimumSize(480,600); win.setSize(width,760);},width); }
async function layout(selector) {
  return manager.locator(selector).evaluate(el => {
    const rect=el.getBoundingClientRect(),footer=el.querySelector('.dialog-footer').getBoundingClientRect(),body=el.querySelector('.dialog-body');
    return {viewport:innerWidth,width:rect.width,bodyHeight:body.clientHeight,horizontalOverflow:body.scrollWidth-body.clientWidth,footerVisible:footer.bottom<=innerHeight&&footer.top>=0};
  });
}
async function intercept(channel,mode) {
  await app.evaluate(({ipcMain},{channel,mode}) => {
    globalThis.__starEditorOriginal ||= new Map();
    const original=ipcMain._invokeHandlers.get(channel);
    if(!original) throw new Error('Missing handler '+channel);
    globalThis.__starEditorOriginal.set(channel,original);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel,async(event,...inputs) => {
      if(mode==='failure') throw new Error('模拟磁盘写入失败');
      await new Promise(resolve => {globalThis.__starEditorRelease=resolve;});
      return original(event,...inputs);
    });
  },{channel,mode});
}
async function restore(channel,release=false) {
  await app.evaluate(({ipcMain},{channel,release}) => {
    const original=globalThis.__starEditorOriginal?.get(channel);
    if(original) {ipcMain.removeHandler(channel);ipcMain.handle(channel,original);globalThis.__starEditorOriginal.delete(channel);}
    if(release) {globalThis.__starEditorRelease?.();delete globalThis.__starEditorRelease;}
  },{channel,release});
}
(async()=>{
 try {
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});
  manager=await app.firstWindow();manager.on('pageerror',e=>errors.push(e.message));await manager.locator('#btnNew').waitFor();await setSize(1180);
  await check('未修改代理可直接关闭，完整 URL 粘贴保留 IPv6 与凭据',async()=>{
    await manager.locator('#navProxy').click();await manager.getByRole('button',{name:'添加代理',exact:true}).first().click();
    await manager.keyboard.press('Escape');await manager.locator('.proxy-editor-modal').waitFor({state:'hidden'});
    await manager.getByRole('button',{name:'添加代理',exact:true}).first().click();await manager.locator('#proxy-name').fill('代理编辑体验');
    assert.equal(await manager.getByRole('textbox',{name:'地址',exact:true}).count(),1);assert.ok(await manager.locator('#proxy-host').getAttribute('aria-describedby'));await manager.locator('#proxy-host').focus();await app.evaluate(({clipboard})=>clipboard.writeText('https://qa%40star:p%3Aa%20ss@[::1]:8443'));
    await manager.keyboard.press(process.platform==='darwin'?'Meta+V':'Control+V');
    await manager.waitForFunction(()=>document.getElementById('proxy-host').value==='::1');
    assert.equal(await manager.locator('#proxy-type').inputValue(),'https');assert.equal(await manager.locator('#proxy-port').inputValue(),'8443');
    assert.equal(await manager.locator('#proxy-user').inputValue(),'qa@star');assert.equal(await manager.locator('#proxy-pass').inputValue(),'p:a ss');
    assert.match(await manager.locator('.proxy-editor-modal').innerText(),/已解析/);
  });
  await check('代理错误定位端口、地址和超长 SOCKS5 密码，失败不写入记录',async()=>{
    const count=(await api('snapshot')).proxies.length;
    for(const [id,value,focused,pattern] of [['proxy-port','0x20','proxy-port',/整数/],['proxy-host','localhost:8080','proxy-host',/不包含协议与端口/]]) {
      await manager.locator('#'+id).fill(value);await manager.getByRole('button',{name:'保存代理',exact:true}).click();await focus(focused);
      assert.match(await manager.locator('#proxy-editor-error').innerText(),pattern);assert.equal(await manager.locator('#'+focused).getAttribute('aria-invalid'),'true');
      await manager.locator('#proxy-port').fill('8443');await manager.locator('#proxy-host').fill('::1');
    }
    await manager.locator('#proxy-type').selectOption('socks5');await manager.locator('#proxy-pass').fill('密'.repeat(86));await manager.getByRole('button',{name:'保存代理',exact:true}).click();await focus('proxy-pass');
    assert.match(await manager.locator('#proxy-editor-error').innerText(),/UTF-8/);assert.equal((await api('snapshot')).proxies.length,count);
    await manager.locator('#proxy-type').selectOption('https');await manager.locator('#proxy-pass').fill('p:a ss');
  });
  await check('关闭保护保留输入，保存期间锁定编辑与关闭，快捷键只保存一次',async()=>{
    await manager.locator('#proxy-host').focus();await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).waitFor();
    await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await focus('proxy-host');assert.equal(await manager.locator('#proxy-pass').inputValue(),'p:a ss');
    await intercept('star:proxySave','hold');await manager.keyboard.press(shortcut);await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();
    assert.ok(await manager.locator('#proxy-host').isDisabled());assert.ok(await manager.locator('.proxy-editor-modal').getByRole('button',{name:'关闭',exact:true}).isDisabled());
    await manager.keyboard.press('Escape');await manager.keyboard.press(shortcut);assert.ok(await manager.locator('.proxy-editor-modal').isVisible());
    await restore('star:proxySave',true);await manager.locator('.proxy-editor-modal').waitFor({state:'hidden'});
    const matches=(await api('snapshot')).proxies.filter(p=>p.name==='代理编辑体验');assert.equal(matches.length,1);proxy=matches[0];assert.equal(proxy.host,'::1');assert.equal(proxy.pass,'p:a ss');
    assert.match(await manager.locator('.object-table').innerText(),/\[::1\]:8443/);
  });
  await check('代理编辑放弃更改保留原配置，窄窗浅深主题保存区可见',async()=>{
    const row=manager.locator('.object-table tr').filter({hasText:'代理编辑体验'});await row.getByRole('button',{name:'更多操作'}).click();await manager.getByRole('menuitem',{name:'编辑代理',exact:true}).click();assert.equal(await manager.locator('.toast.success').count(),0);
    await manager.locator('#proxy-name').fill('不会保存');const measurements=[];
    for(const theme of ['light','dark']) {await setSize(500);await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await manager.emulateMedia({reducedMotion:'reduce'});const size=await layout('.proxy-editor-modal');assert.ok(size.footerVisible&&size.width<=size.viewport&&size.horizontalOverflow<=1,JSON.stringify(size));measurements.push({theme,...size});await manager.screenshot({animations:'disabled',path:path.join(output,'proxy-'+theme+'-500.png')});}
    await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.proxy-editor-modal').waitFor({state:'hidden'});assert.equal((await api('snapshot')).proxies.find(p=>p.id===proxy.id).name,'代理编辑体验');await setSize(1180);return measurements;
  });
  await check('任务校验定位名称和步骤字段，错误时保留排序与文本',async()=>{
    await manager.locator('#navTasks').click();await manager.getByRole('button',{name:'新建任务',exact:true}).first().click();await manager.getByRole('button',{name:'保存任务',exact:true}).click();await focus('task-name');
    await manager.locator('#task-name').fill('任务编辑体验');await manager.getByRole('button',{name:'保存任务',exact:true}).click();await focus('task-steps-0-url');assert.match(await manager.locator('#task-editor-error').innerText(),/HTTP/);
    await manager.getByLabel('第 1 步地址',{exact:true}).fill('https://example.com');await manager.getByRole('button',{name:'添加步骤',exact:true}).click();await manager.getByLabel('第 2 步操作',{exact:true}).selectOption('fill');await manager.getByLabel('第 2 步文本',{exact:true}).fill('  保存完整文本\n ');
    await manager.getByRole('button',{name:'保存任务',exact:true}).click();await focus('task-steps-1-selector');assert.equal(await manager.getByLabel('第 2 步文本',{exact:true}).inputValue(),'  保存完整文本\n ');
    await manager.getByLabel('第 2 步元素',{exact:true}).fill('#input');await manager.getByRole('button',{name:'上移第 2 步',exact:true}).click();assert.equal(await manager.getByLabel('第 1 步操作',{exact:true}).inputValue(),'fill');await manager.getByRole('button',{name:'下移第 1 步',exact:true}).click();
    await manager.getByLabel('第 2 步文本',{exact:true}).focus();await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await focus('task-steps-1-text');
    await manager.keyboard.press(shortcut);await manager.locator('.task-editor-modal').waitFor({state:'hidden'});savedTask=(await api('snapshot')).tasks.find(t=>t.name==='任务编辑体验');assert.equal(savedTask.steps[1].text,'  保存完整文本\n ');
  });
  await check('任务保存失败保留草稿，字段与关闭入口恢复可操作状态',async()=>{
    await manager.getByRole('button',{name:'编辑 任务编辑体验',exact:true}).click();await manager.locator('#task-description').fill('失败后继续编辑');await intercept('star:taskSave','failure');
    await manager.getByRole('button',{name:'保存任务',exact:true}).click();await manager.locator('#task-editor-error').waitFor();assert.match(await manager.locator('#task-editor-error').innerText(),/模拟磁盘写入失败/);assert.ok(await manager.locator('#task-description').isEnabled());
    assert.equal((await api('snapshot')).tasks.find(t=>t.id===savedTask.id).description,'');await restore('star:taskSave');await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.task-editor-modal').waitFor({state:'hidden'});
  });
  await check('长任务自动滚动到错误步骤，浅深主题与窄窗保持保存入口',async()=>{
    const task=await api('taskSave',{name:'长任务编辑',steps:Array.from({length:40},(_,i)=>({type:'navigate',url:'https://example.com/'+i,timeout:15000}))});await api('snapshot');await manager.getByRole('button',{name:'刷新工作台'}).click();await manager.getByRole('button',{name:'编辑 长任务编辑',exact:true}).click();assert.equal(await manager.locator('.toast.success').count(),0);
    await manager.locator('#task-steps-39-timeout').fill('0');await manager.getByRole('button',{name:'保存任务',exact:true}).click();await focus('task-steps-39-timeout');
    assert.match(await manager.locator('#task-editor-error').innerText(),/第 40 步/);await manager.waitForFunction(()=>{const el=document.getElementById('task-steps-39-timeout'),r=el.getBoundingClientRect(),body=el.closest('.dialog-body').getBoundingClientRect();return r.top>=body.top-1&&r.bottom<=body.bottom+1;});
    const measurements=[];
    for(const width of [780,500])for(const theme of ['light','dark']) {await setSize(width);await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const size=await layout('.task-editor-modal');assert.ok(size.footerVisible&&size.width<=size.viewport&&size.horizontalOverflow<=1,JSON.stringify(size));assert.ok(size.bodyHeight>200);measurements.push({width,theme,...size});await manager.screenshot({animations:'disabled',path:path.join(output,'task-'+theme+'-'+width+'.png')});}
    await manager.locator('#task-steps-39-timeout').fill('1000');await intercept('star:taskSave','hold');await manager.keyboard.press(shortcut);await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();assert.ok(await manager.locator('#task-steps-39-timeout').isDisabled());assert.ok(await manager.getByRole('button',{name:'添加步骤',exact:true}).isDisabled());await manager.keyboard.press('Escape');assert.ok(await manager.locator('.task-editor-modal').isVisible());await restore('star:taskSave',true);await manager.locator('.task-editor-modal').waitFor({state:'hidden'});assert.equal((await api('snapshot')).tasks.find(t=>t.id===task.id).steps[39].timeout,1000);return measurements;
  });
  await setSize(1180);await api('preferences',{theme:'light'});
  await check('书签必填错误定位字段，未保存确认保留焦点，快捷键保存规范网址',async()=>{
    await manager.locator('#navBookmarks').click();await manager.getByRole('button',{name:'添加书签',exact:true}).click();
    await manager.keyboard.press('Escape');await manager.locator('.bookmark-editor-modal').waitFor({state:'hidden'});
    await manager.getByRole('button',{name:'添加书签',exact:true}).click();await manager.getByRole('button',{name:'保存书签',exact:true}).click();await focus('bookmark-title');
    await manager.getByLabel('名称',{exact:true}).fill('  书签编辑体验  ');await manager.getByRole('button',{name:'保存书签',exact:true}).click();await focus('bookmark-url');
    await manager.getByLabel('网址',{exact:true}).fill('https://name:secret@example.com');await manager.getByRole('button',{name:'保存书签',exact:true}).click();await focus('bookmark-url');assert.match(await manager.locator('#bookmark-editor-error').innerText(),/账号或密码/);
    await manager.getByLabel('网址',{exact:true}).fill('HTTPS://EXAMPLE.COM:443/bookmark');await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'继续编辑',exact:true}).click();await focus('bookmark-url');
    await manager.keyboard.press(shortcut);await manager.locator('.bookmark-editor-modal').waitFor({state:'hidden'});
    const item=(await api('bookmarksList')).find(b=>b.title==='书签编辑体验');assert.equal(item.url,'https://example.com/bookmark');
  });
  await check('书签编辑失败保留草稿，保存中阻止关闭和二次提交，完成后可刷新',async()=>{
    const item=(await api('bookmarksList')).find(b=>b.title==='书签编辑体验');
    // Open with the row menu to exercise the same route used by a person.
    const row=manager.locator('.object-item').filter({hasText:'书签编辑体验'});await row.getByRole('button',{name:'更多操作',exact:true}).click();await manager.getByRole('menuitem',{name:'编辑书签',exact:true}).click();
    await manager.locator('#bookmark-title').fill('失败后继续编辑');await intercept('bookmarks:update','failure');await manager.getByRole('button',{name:'保存书签',exact:true}).click();await manager.locator('#bookmark-editor-error').waitFor();assert.match(await manager.locator('#bookmark-editor-error').innerText(),/模拟磁盘写入失败/);
    assert.equal((await api('bookmarksList')).find(b=>b.id===item.id).title,'书签编辑体验');assert.equal(await manager.locator('#bookmark-title').inputValue(),'失败后继续编辑');await restore('bookmarks:update');
    await intercept('bookmarks:update','hold');await manager.keyboard.press(shortcut);await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();assert.ok(await manager.locator('#bookmark-title').isDisabled());await manager.keyboard.press('Escape');assert.ok(await manager.locator('.bookmark-editor-modal').isVisible());await restore('bookmarks:update',true);await manager.locator('.bookmark-editor-modal').waitFor({state:'hidden'});
    assert.equal((await api('bookmarksList')).find(b=>b.id===item.id).title,'失败后继续编辑');
  });
  await check('书签编辑浅深主题与窄窗无横向溢出，未保存放弃不会留下记录',async()=>{
    await manager.getByRole('button',{name:'添加书签',exact:true}).click();await manager.getByLabel('名称',{exact:true}).fill('未保存书签');
    const measurements=[];
    for(const width of [780,500])for(const theme of ['light','dark']){await setSize(width);await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const size=await layout('.bookmark-editor-modal');assert.ok(size.footerVisible&&size.width<=size.viewport&&size.horizontalOverflow<=1,JSON.stringify(size));measurements.push({width,theme,...size});await manager.screenshot({animations:'disabled',path:path.join(output,'bookmark-'+theme+'-'+width+'.png')});}
    await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.bookmark-editor-modal').waitFor({state:'hidden'});assert.ok(!(await api('bookmarksList')).some(b=>b.title==='未保存书签'));return measurements;
  });
  await check('编辑过程没有未捕获页面错误',async()=>assert.deepEqual(errors,[]));
 } catch(error) {console.error(error);process.exitCode=1;if(manager)await manager.screenshot({animations:'disabled',path:path.join(output,'failure.png')}).catch(()=>{});}
 finally {if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,errors},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true});}
})();
