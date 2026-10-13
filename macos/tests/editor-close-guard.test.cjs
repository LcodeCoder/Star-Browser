'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {EditorCloseGuard}=require('../src/main/editor-close-guard');
const {installTaskQuitGuard}=require('../src/main/task-quit-guard');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function event(){return {defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};}
function fixture(responses=[0]){
 const app=new EventEmitter(),window=new EventEmitter(),sender=new EventEmitter(),shown=[];
 let closed=0,quits=0,shownWorkspace=0,quitEvent;
 window.id=1;sender.id=10;window.webContents=sender;window.isDestroyed=()=>closed>0;window.isMinimized=()=>false;window.show=()=>shownWorkspace++;window.focus=()=>{};
 window.close=()=>{const attempt=event();window.emit('close',attempt);if(!attempt.defaultPrevented){closed++;sender.emit('destroyed');}return attempt;};
 const BrowserWindow={getAllWindows:()=>closed?[]:[window],fromWebContents:candidate=>candidate===sender?window:null};
 app.quit=()=>{quits++;quitEvent=event();app.emit('before-quit',quitEvent);if(!quitEvent.defaultPrevented)window.close();};
 const dialog={showMessageBox:async(...args)=>{const options=args.at(-1);shown.push(options);return {response:responses.shift()??0};}};
 const guard=new EditorCloseGuard({app,dialog,BrowserWindow});
 const set=(dirty,busy=false,id='editor')=>guard.update(sender,{id,dirty,busy});
 return {app,window,sender,dialog,guard,set,shown,closed:()=>closed,quits:()=>quits,shownWorkspace:()=>shownWorkspace,quitEvent:()=>quitEvent};
}
test('未保存编辑阻止系统关窗，取消和重复关闭保留草稿且仅显示一个提示',async()=>{
 const f=fixture();f.set(true);assert.equal(f.window.close().defaultPrevented,true);assert.equal(f.window.close().defaultPrevented,true);await tick();
 assert.equal(f.closed(),0);assert.equal(f.shown.length,1);assert.equal(f.shown[0].defaultId,0);assert.equal(f.shown[0].cancelId,0);assert.equal(f.guard.state(f.window).blocked,true);assert.equal(f.shownWorkspace(),1);
});
test('保存过程中只能继续等待，不能确认放弃后退出',async()=>{
 const f=fixture([1]);f.set(true,true);f.app.quit();await tick();assert.equal(f.quitEvent().defaultPrevented,true);assert.equal(f.closed(),0);assert.deepEqual(f.shown[0].buttons,['继续等待']);assert.equal(f.guard.state(f.window).busy,true);
});
test('明确放弃关闭当前窗口，所有者状态在窗口销毁后释放',async()=>{
 const f=fixture([1]);f.set(true);f.window.close();await tick();assert.equal(f.closed(),1);assert.equal(f.quits(),0);assert.equal(f.guard.owners.size,0);assert.equal(f.guard.allowedWindows.size,0);
});
test('明确放弃并退出重新发起退出，干净窗口直接关闭',async()=>{
 const f=fixture([1]);f.set(true);f.app.quit();await tick();assert.equal(f.quits(),2);assert.equal(f.closed(),1);assert.equal(f.shown.length,1);
 const clean=fixture();clean.set(false);clean.app.quit();await tick();assert.equal(clean.closed(),1);assert.equal(clean.shown.length,0);
});
test('多个编辑器独立登记，卸载其中一个不会取消另一个的保护',async()=>{
 const f=fixture();f.set(true,false,'first');f.set(true,false,'second');f.set(false,false,'first');assert.equal(f.guard.state(f.window).blocked,true);f.set(false,false,'second');assert.equal(f.guard.state(f.window).blocked,false);f.window.close();await tick();assert.equal(f.closed(),1);assert.equal(f.shown.length,0);
});
test('待保存任务结果优先阻止退出，取消后编辑草稿仍有保护',async()=>{
 const f=fixture([1,0]);f.set(true);const tasks={pendingResults:new Map([['run',{}]]),retryResults(){}};
 installTaskQuitGuard({app:f.app,dialog:f.dialog,tasks});f.app.quit();await tick();assert.equal(f.shown.length,1);assert.equal(f.shown[0].title,'执行结果尚未保存');assert.equal(f.closed(),0);
 tasks.pendingResults.clear();f.app.quit();await tick();assert.equal(f.shown.length,2);assert.equal(f.shown[1].title,'修改尚未保存');assert.equal(f.closed(),0);assert.equal(f.guard.state(f.window).blocked,true);
});
