'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {installTaskQuitGuard}=require('../src/main/task-quit-guard');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(response,retryFails=false){
 const app=new EventEmitter(),shown=[],calls=[];let quits=0,shownWorkspace=0;
 app.quit=()=>{quits++;app.emit('before-quit',event());};
 const tasks={pendingResults:new Map([['run',{}]]),retryResults:options=>{calls.push(options);if(retryFails)throw new Error('disk full');tasks.pendingResults.clear();}};
 const dispose=installTaskQuitGuard({app,tasks,showWorkspace:()=>{shownWorkspace++;},dialog:{showMessageBox:async options=>{shown.push(options);return {response};}}});
 function event(){return {defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};}
 return {app,tasks,shown,calls,dispose,event,quits:()=>quits,shownWorkspace:()=>shownWorkspace};
}
test('待保存结果阻止退出，继续使用和取消都保留结果，重复退出只显示一个提示',async()=>{
 const f=fixture(1),first=f.event(),second=f.event();f.app.emit('before-quit',first);f.app.emit('before-quit',second);await tick();
 assert.equal(first.defaultPrevented,true);assert.equal(second.defaultPrevented,true);assert.equal(f.shown.length,1);
 assert.equal(f.shown[0].defaultId,1);assert.equal(f.shown[0].cancelId,1);assert.equal(f.quits(),0);assert.equal(f.tasks.pendingResults.size,1);assert.equal(f.shownWorkspace(),1);f.dispose();
});
test('保存后退出只持久化结果，不恢复后续队列',async()=>{
 const f=fixture(0);f.app.emit('before-quit',f.event());await tick();assert.deepEqual(f.calls,[{resume:false}]);assert.equal(f.tasks.pendingResults.size,0);assert.equal(f.quits(),1);assert.equal(f.shown.length,1);f.dispose();
});
test('再次保存失败保持应用打开，错误提示不会放弃结果',async()=>{
 const f=fixture(0,true);f.app.emit('before-quit',f.event());await tick();assert.equal(f.tasks.pendingResults.size,1);assert.equal(f.quits(),0);assert.equal(f.shown.length,2);assert.equal(f.shown[1].type,'error');assert.equal(f.shownWorkspace(),1);f.dispose();
});
test('明确放弃结果后退出，无待保存结果时直接退出且不显示提示',async()=>{
 const f=fixture(2);f.app.emit('before-quit',f.event());await tick();assert.equal(f.quits(),1);assert.equal(f.calls.length,0);
 f.dispose();f.tasks.pendingResults.clear();const clean=f.event();f.app.emit('before-quit',clean);await tick();assert.equal(clean.defaultPrevented,false);assert.equal(f.shown.length,1);
});
