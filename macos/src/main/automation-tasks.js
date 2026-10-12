'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BrowserWindow,webContents}=require('electron');
const {assertProfileUnlocked,lockProfile,unlockProfile}=require('./profile-backups');
const TYPES=new Set(['navigate','waitFor','click','fill','press','scroll','wait','screenshot']);
const KEYS={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Home:36,End:35};
const string=(value,max)=>String(value??'').trim().slice(0,max);
function validateTask(input){
 if(!input||typeof input!=='object'||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>50)throw new Error('每个任务需要 1–50 个步骤');
 const name=string(input.name,120);if(!name)throw new Error('请输入任务名称');
 const steps=input.steps.map((step,index)=>{
  const fail=message=>{throw new Error(`第 ${index+1} 步：${message}`);};
  if(!step||!TYPES.has(step.type))fail('请选择支持的操作');const out={type:step.type};
  if(['navigate'].includes(step.type)){out.url=string(step.url,4096);try{const url=new URL(out.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('地址需使用不含账号密码的 HTTP 或 HTTPS');}catch{fail('请输入完整的 HTTP 或 HTTPS 地址');}}
  if(['waitFor','click','fill','scroll'].includes(step.type)){out.selector=string(step.selector,1000);if(!out.selector&&step.type!=='scroll')fail('请输入 CSS 元素定位');}
  if(step.type==='fill'){out.text=String(step.text??'').slice(0,100000);}
  if(step.type==='press'){out.key=step.key;if(!Object.hasOwn(KEYS,out.key))fail('请选择支持的按键');}
  if(step.type==='scroll'){out.x=Number(step.x)||0;out.y=Number(step.y)||0;if(!Number.isFinite(out.x)||!Number.isFinite(out.y)||Math.abs(out.x)>10000||Math.abs(out.y)>10000)fail('滚动距离最多 10000 像素');}
  if(step.type==='wait'){out.duration=Number(step.duration);if(!Number.isInteger(out.duration)||out.duration<100||out.duration>30000)fail('等待时间为 100–30000 毫秒');}
  if(!['wait','press','screenshot'].includes(step.type)){out.timeout=Number(step.timeout)||15000;if(!Number.isInteger(out.timeout)||out.timeout<1000||out.timeout>60000)fail('超时为 1000–60000 毫秒');}
  return out;
 });return {name,description:string(input.description,1000),steps};
}
class TaskCancelled extends Error{constructor(){super('任务已取消');}}
class AutomationTasks{
 constructor({app,store,commands,synchronizer}){
  Object.assign(this,{app,store,commands,synchronizer});this.queue=[];this.active=null;this.output=path.join(app.getPath('userData'),'task-output');
  const interrupted=store.taskRuns().filter(run=>['queued','starting','running'].includes(run.state));if(interrupted.length)store.transaction(()=>{for(const run of interrupted)store.saveTaskRun({...run,state:'interrupted',finishedAt:Date.now(),error:'应用已退出，任务没有自动继续'});});
 }
 save(input){const data=validateTask(input);if(input.id&&!this.store.tasks().some(t=>t.id===input.id))throw new Error('任务已不存在');return this.store.saveTask({...data,id:input.id||crypto.randomUUID(),updatedAt:Date.now()});}
 remove(id){if(this.store.taskRuns().some(run=>run.taskId===id&&['queued','starting','running'].includes(run.state)))throw new Error('请先取消这个任务的运行，再删除');return this.store.removeTask(id);}
 start(taskId,ids){
  const task=this.store.tasks().find(t=>t.id===taskId);if(!task)throw new Error('任务已不存在');
  if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw new Error('每次请选择 1–50 个不同环境');
  if(this.queue.length+(this.active?1:0)+ids.length>100)throw new Error('执行队列最多 100 个环境，请等待完成或取消后再添加');
  const sync=this.synchronizer.status(),participants=sync.active?new Set([sync.master,...sync.followers]):new Set();
  for(const id of ids){const profile=this.store.get(id);if(!profile||profile.archived)throw new Error('部分环境不存在或已归档');assertProfileUnlocked(id);if(participants.has(id))throw new Error('请先停止所选环境的窗口同步');if(this.store.taskRuns().some(r=>r.profileId===id&&['queued','starting','running'].includes(r.state)))throw new Error('部分环境已有任务，请等待结束或取消');}
  const data=validateTask(task),runs=ids.map(id=>({id:crypto.randomUUID(),taskId,taskName:task.name,profileId:id,profileName:this.store.get(id).name,state:'queued',step:0,total:data.steps.length,createdAt:Date.now(),steps:[],outputs:[]}));
  this.store.transaction(()=>{for(const run of runs)this.store.saveTaskRun(run);this.store.activity('排队执行任务',task.name,`${ids.length} 个环境`);});
  this.queue.push(...runs.map(run=>({run,task:structuredClone(data),cancelled:false})));this.pump().catch(()=>{});return runs;
 }
 cancel(id){
  const item=this.active?.run.id===id?this.active:this.queue.find(row=>row.run.id===id);if(!item)throw new Error('此任务已经结束');item.cancelled=true;
  if(item!==this.active){this.queue=this.queue.filter(row=>row!==item);this.store.saveTaskRun({...item.run,state:'cancelled',finishedAt:Date.now()});}
  return true;
 }
 async pump(){
  if(this.active)return;const item=this.queue.shift();if(!item)return;this.active=item;
  try{await this.execute(item);}finally{this.active=null;queueMicrotask(()=>this.pump().catch(()=>{}));}
 }
 check(item){if(item.cancelled)throw new TaskCancelled();if(!this.store.get(item.run.profileId))throw new Error('任务环境已不存在');if(item.windowReady&&!this.synchronizer.window(item.run.profileId))throw new Error('任务浏览器窗口已关闭');if(item.guestId&&this.synchronizer.activeGuest(item.run.profileId)?.wc.id!==item.guestId)throw new Error('任务标签已切换或关闭，请回到原标签后重新执行');if(Date.now()-item.startedAt>15*60*1000)throw new Error('任务已超过 15 分钟，请拆分步骤后重试');}
 async wait(item,ms){const limit=Date.now()+ms;while(Date.now()<limit){this.check(item);await new Promise(resolve=>setTimeout(resolve,Math.min(80,limit-Date.now())));}}
 async guest(item,timeout=15000){
  const deadline=Date.now()+timeout;while(Date.now()<deadline){this.check(item);const profileId=item.run.profileId,window=BrowserWindow.getAllWindows().find(w=>!w._starClosing&&!w.isDestroyed()&&w._profile?.id===profileId);if(!window)throw new Error('任务浏览器窗口已关闭');const selected=this.synchronizer.activeGuest(profileId),guest=selected?.wc;
   if(guest&&!guest.isDestroyed()&&!guest.isLoading()){item.guestId||=guest.id;return guest;}await this.wait(item,60);
  }throw new Error('页面加载超时，请检查网络或代理');
 }
 async evaluate(wc,expression){if(!wc.debugger.isAttached())wc.debugger.attach('1.3');const result=await wc.debugger.sendCommand('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,timeout:3000});if(result.exceptionDetails)throw new Error('网页操作失败，请检查元素定位');return result.result?.value;}
 async element(item,wc,selector,timeout){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){this.check(item);const result=await this.evaluate(wc,`(()=>{let element;try{element=document.querySelector(${JSON.stringify(selector)});}catch{return {invalid:true};}if(!element)return null;element.scrollIntoView({block:'center',inline:'center'});const box=element.getBoundingClientRect(),style=getComputedStyle(element);if(box.width<=0||box.height<=0||style.visibility==='hidden'||style.display==='none')return null;return {x:box.x+box.width/2,y:box.y+box.height/2,editable:element.isContentEditable||element.matches('textarea,input:not([type]),input[type=text],input[type=search],input[type=password],input[type=email],input[type=url],input[type=tel],input[type=number]'),disabled:!!element.disabled||!!element.readOnly||element.getAttribute('aria-disabled')==='true'};})()`);
   if(result?.invalid)throw new Error('CSS 元素定位格式无效');if(result)return result;await this.wait(item,100);
  }throw new Error('等待元素超时，请检查页面和元素定位');
 }
 async step(item,step,index){
  const wc=await this.guest(item,step.timeout||15000);this.check(item);
  if(step.type==='navigate'){
   let done=false,failure;const finished=()=>{done=true;},failed=(_event,code,message,url,isMain)=>{if(isMain&&code!==-3)failure=new Error('页面加载失败：'+message);};wc.once('did-finish-load',finished);wc.on('did-fail-load',failed);
   const window=BrowserWindow.getAllWindows().find(w=>w._profile?.id===item.run.profileId);window.webContents.send('star:syncNavigate',step.url);
   try{const deadline=Date.now()+step.timeout;while(!done){this.check(item);if(failure)throw failure;if(Date.now()>deadline)throw new Error('打开网页超时，请检查网络或代理');await this.wait(item,60);}}finally{wc.removeListener('did-finish-load',finished);wc.removeListener('did-fail-load',failed);}
  }
  else if(step.type==='wait')await this.wait(item,step.duration);
  else if(step.type==='waitFor')await this.element(item,wc,step.selector,step.timeout);
  else if(['click','fill'].includes(step.type)){
   const element=await this.element(item,wc,step.selector,step.timeout);if(element.disabled)throw new Error('目标元素当前不可操作');if(step.type==='fill'&&!element.editable)throw new Error('目标元素不是输入框');
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:element.x,y:element.y});await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:element.x,y:element.y});
   if(step.type==='fill'){await this.evaluate(wc,`(()=>{const element=document.querySelector(${JSON.stringify(step.selector)});element.focus();if(element.select)element.select();else{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}})()`);await wc.debugger.sendCommand('Input.insertText',{text:step.text});}
  }else if(step.type==='press'){await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:step.key,windowsVirtualKeyCode:KEYS[step.key],...(step.key==='Enter'?{text:'\r'}:{})});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:step.key,windowsVirtualKeyCode:KEYS[step.key]});}
  else if(step.type==='scroll'){const point=step.selector?await this.element(item,wc,step.selector,step.timeout):{x:100,y:100};await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:step.x,deltaY:step.y});}
  else if(step.type==='screenshot'){const directory=path.join(this.output,item.run.id);await fs.promises.mkdir(directory,{recursive:true,mode:0o700});const destination=path.join(directory,'step-'+String(index+1).padStart(2,'0')+'.png');const image=await wc.capturePage();await fs.promises.writeFile(destination,image.toPNG(),{mode:0o600});item.run.outputs.push({name:'第 '+(index+1)+' 步截图',path:destination});}
  this.check(item);
 }
 async execute(item){
  const run=item.run;item.startedAt=Date.now();let locked=false;
  try{
   this.check(item);assertProfileUnlocked(run.profileId);const sync=this.synchronizer.status();if(sync.active&&[sync.master,...sync.followers].includes(run.profileId))throw new Error('这个环境已加入窗口同步，请停止同步后重试任务');run.state='starting';run.startedAt=item.startedAt;this.store.saveTaskRun({...run});
   await this.commands('browse',[run.profileId]);item.windowReady=true;this.check(item);lockProfile(run.profileId,run.id,'这个环境正在执行任务，请完成或取消后再操作');locked=true;
   await this.guest(item);
   run.state='running';this.store.saveTaskRun({...run});
   for(let index=0;index<item.task.steps.length;index++){
    this.check(item);run.step=index+1;this.store.saveTaskRun({...run});const started=Date.now();
    await this.step(item,item.task.steps[index],index);run.steps.push({index:index+1,type:item.task.steps[index].type,state:'completed',duration:Date.now()-started});this.store.saveTaskRun({...run,steps:[...run.steps],outputs:[...run.outputs]});
   }
   run.state='completed';run.finishedAt=Date.now();this.store.transaction(()=>{this.store.saveTaskRun({...run});this.store.activity('任务完成',run.taskName,run.profileName);});
  }catch(error){run.state=error instanceof TaskCancelled?'cancelled':'failed';run.error=error instanceof TaskCancelled?'':error.message;run.finishedAt=Date.now();this.store.transaction(()=>{this.store.saveTaskRun({...run});this.store.activity(run.state==='cancelled'?'任务已取消':'任务失败',run.taskName,run.profileName);});}
  finally{if(locked)unlockProfile(run.profileId,run.id);}
 }
 outputFile(runId,index){const run=this.store.taskRuns().find(r=>r.id===runId),file=run?.outputs?.[index]?.path;if(!file||!path.resolve(file).startsWith(this.output+path.sep)||!fs.existsSync(file))throw new Error('截图已移动或删除');return file;}
}
module.exports={AutomationTasks,validateTask};
