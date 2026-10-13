'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-editor-close-')),results=[],errors=[];
let app,manager,child;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function check(name,run){await run();results.push({name,status:'passed'});console.log('PASS',name);}
async function messages(count){
 for(let attempt=0;attempt<100;attempt++){
  const rows=await app.evaluate(()=>globalThis.__starCloseMessages);
  if(rows.length>=count)return rows;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 throw new Error('系统关闭提示没有出现');
}
async function closeWindow(){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window._profile).close());}
(async()=>{
 try{
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});child=app.process();manager=await app.firstWindow();manager.on('pageerror',error=>errors.push(error.message));await manager.locator('#btnNew').waitFor();
  await app.evaluate(({dialog},file)=>{
   globalThis.__starCloseMessages=[];globalThis.__starCloseResponse=0;
   dialog.showMessageBox=async(...args)=>{globalThis.__starCloseMessages.push(args.at(-1));process.getBuiltinModule('fs').writeFileSync(file,JSON.stringify(globalThis.__starCloseMessages));return {response:globalThis.__starCloseResponse};};
  },path.join(data,'close-prompts.json'));
  await check('系统关窗保护真实环境编辑草稿，默认继续编辑',async()=>{
   await manager.locator('#btnNew').click();await manager.locator('#f_name').fill('关窗草稿');await closeWindow();const shown=await messages(1);assert.equal(shown[0].title,'修改尚未保存');assert.equal(shown[0].cancelId,0);assert.equal(manager.isClosed(),false);assert.equal(await manager.locator('#f_name').inputValue(),'关窗草稿');assert.equal((await api('snapshot')).profiles.length,0);
  });
  await check('退出应用也保护草稿，取消退出后工作台仍可调用 IPC',async()=>{
   const prevented=await app.evaluate(({app})=>{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};app.emit('before-quit',event);return event.defaultPrevented;});assert.equal(prevented,true);const shown=await messages(2);assert.ok(shown[1].buttons.includes('放弃更改并退出'));assert.equal(await manager.locator('#f_name').inputValue(),'关窗草稿');assert.equal((await api('snapshot')).profiles.length,0);
   await manager.keyboard.press('Escape');await manager.getByRole('button',{name:'放弃更改',exact:true}).click();await manager.locator('.profile-editor-modal').waitFor({state:'hidden'});
  });
  await check('共用代理编辑器的未保存修改同样保护系统关窗',async()=>{
   await manager.locator('#navProxy').click();await manager.getByRole('button',{name:'添加代理',exact:true}).first().click();await manager.locator('#proxy-name').fill('窗口关闭验证');await manager.locator('#proxy-host').fill('127.0.0.1');await manager.locator('#proxy-port').fill('8080');await closeWindow();const shown=await messages(3);assert.equal(shown[2].title,'修改尚未保存');assert.equal(await manager.locator('#proxy-name').inputValue(),'窗口关闭验证');assert.equal((await api('snapshot')).proxies.length,0);
  });
  await check('真实保存等待期间拒绝关窗，保存完成后完整写入并撤销保护',async()=>{
   await app.evaluate(({ipcMain})=>{globalThis.__starCloseOriginal=ipcMain._invokeHandlers.get('star:proxySave');ipcMain.removeHandler('star:proxySave');ipcMain.handle('star:proxySave',async(event,...inputs)=>{await new Promise(resolve=>{globalThis.__starCloseRelease=resolve;});return globalThis.__starCloseOriginal(event,...inputs);});});
   await manager.getByRole('button',{name:'保存代理',exact:true}).click();await manager.getByRole('button',{name:'保存中…',exact:true}).waitFor();await closeWindow();const shown=await messages(4);assert.equal(shown[3].title,'正在保存');assert.deepEqual(shown[3].buttons,['继续等待']);assert.ok(await manager.locator('#proxy-host').isDisabled());
   await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('star:proxySave');ipcMain.handle('star:proxySave',globalThis.__starCloseOriginal);globalThis.__starCloseRelease();delete globalThis.__starCloseRelease;});await manager.locator('.proxy-editor-modal').waitFor({state:'hidden'});assert.equal((await api('snapshot')).proxies.length,1);
   const event=await app.evaluate(({app})=>{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};app.emit('before-quit',event);return event.defaultPrevented;});assert.equal(event,false);assert.equal((await app.evaluate(()=>globalThis.__starCloseMessages)).length,4);
  });
  await check('明确放弃草稿后真实退出应用，未保存代理没有写盘',async()=>{
   await manager.getByRole('button',{name:'添加代理',exact:true}).first().click();await manager.locator('#proxy-name').fill('明确放弃的代理');assert.deepEqual(errors,[]);await app.evaluate(()=>{globalThis.__starCloseResponse=1;});const closed=app.waitForEvent('close');await app.evaluate(({app})=>{setImmediate(()=>app.quit());});await closed;
   const shown=JSON.parse(fs.readFileSync(path.join(data,'close-prompts.json'),'utf8'));assert.equal(shown.length,5);assert.ok(shown[4].buttons.includes('放弃更改并退出'));assert.equal(JSON.parse(fs.readFileSync(path.join(data,'data/profiles.json'),'utf8')).proxies.length,1);assert.equal(child.exitCode,0);
  });
 }catch(error){console.error(error);results.push({name:'系统关闭编辑保护验证',status:'failed',error:error.stack});process.exitCode=1;if(manager&&!manager.isClosed())await manager.screenshot({path:path.resolve('test-results/editor-close-failure.png')}).catch(()=>{});}
 finally{
  if(app){await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await app.close().catch(()=>{});}
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/editor-close.json',JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results},null,2)+'\n');fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
})();
