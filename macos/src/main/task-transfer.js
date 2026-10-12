'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateTask}=require('./automation-tasks');
const MAX_BYTES=32*1024*1024,MAX_TASKS=100,TTL=10*60*1000;
function definition(input,index){
 const fail=message=>{throw new Error(`任务 ${index+1}：${message}`);};
 if(!input||typeof input!=='object'||Array.isArray(input))fail('任务格式无效');
 for(const [key,max]of [['name',120],['description',1000]])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>max))fail(`${key==='name'?'名称':'说明'}最多 ${max} 个字符`);
 if(Array.isArray(input.steps))for(const step of input.steps){
  if(!step||typeof step!=='object'||Array.isArray(step))fail('步骤格式无效');
  for(const [key,max,label]of [['url',4096,'地址'],['selector',1000,'元素定位'],['text',100000,'填入文本']])if(step[key]!==undefined&&(typeof step[key]!=='string'||step[key].length>max))fail(`${label}最多 ${max} 个字符`);
 }
 try{return validateTask(input);}catch(error){fail(error.message);}
}
function parseDocument(value){
 if(!value||value.format!=='star-browser-tasks'||value.version!==1)throw new Error('请选择 Star Browser 导出的任务 JSON（格式版本 1）');
 if(!Array.isArray(value.tasks)||!value.tasks.length||value.tasks.length>MAX_TASKS)throw new Error('每次可导入 1–100 个任务');
 return value.tasks.map(definition);
}
async function readDocument(file){
 const handle=await fs.promises.open(file,'r');let stream;
 try{
  const stat=await handle.stat();if(!stat.isFile())throw new Error('请选择普通的 JSON 文件');if(stat.size>MAX_BYTES)throw new Error('任务文件最多 32 MB');
  let size=0;const chunks=[];stream=handle.createReadStream({autoClose:false});
  for await(const chunk of stream){size+=chunk.length;if(size>MAX_BYTES)throw new Error('任务文件最多 32 MB');chunks.push(chunk);}
  let parsed;try{parsed=JSON.parse(Buffer.concat(chunks,size).toString('utf8').replace(/^\uFEFF/,''));}catch{throw new Error('任务文件不是有效的 JSON，请检查后重新选择');}
  return parseDocument(parsed);
 }finally{stream?.destroy();await handle.close();}
}
class TaskTransfers{
 constructor(store,{now=Date.now}={}){this.store=store;this.now=now;this.pending=new Map();this.timer=setInterval(()=>this.prune(),60000);this.timer.unref?.();}
 prune(){for(const [token,item]of this.pending)if(this.now()-item.time>=TTL)this.pending.delete(token);}
 cancelOwner(owner){for(const [token,item]of this.pending)if(item.owner===owner)this.pending.delete(token);}
 cancel(token,owner){if(this.pending.get(token)?.owner===owner)this.pending.delete(token);return true;}
 document(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>MAX_TASKS||new Set(ids).size!==ids.length)throw new Error('每次请选择 1–100 个不同任务');
  const saved=this.store.tasks(),tasks=ids.map((id,index)=>{const task=saved.find(item=>item.id===id);if(!task)throw new Error('部分任务已删除，请重新选择');return definition(task,index);});
  const text=JSON.stringify({format:'star-browser-tasks',version:1,exportedAt:new Date(this.now()).toISOString(),tasks},null,2)+'\n';
  if(Buffer.byteLength(text)>MAX_BYTES)throw new Error('导出文件超过 32 MB，请减少任务数量');return {text,count:tasks.length};
 }
 async write(file,document){
  const temporary=path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmp');let handle;
  try{handle=await fs.promises.open(temporary,'wx',0o600);await handle.writeFile(document.text,'utf8');await handle.sync();await handle.close();handle=null;await fs.promises.rename(temporary,file);}
  finally{if(handle)await handle.close().catch(()=>{});await fs.promises.rm(temporary,{force:true}).catch(()=>{});}
  this.store.activity('导出任务','本地任务',`${document.count} 个定义`);return {count:document.count};
 }
 async preview(file,owner){
  const tasks=await readDocument(file);this.prune();this.cancelOwner(owner);if(this.pending.size>=4)throw new Error('当前预览较多，请稍后重试');
  const token=crypto.randomUUID();this.pending.set(token,{tasks,owner,time:this.now()});
  return {token,count:tasks.length,tasks:tasks.map(task=>({name:task.name,description:task.description,stepCount:task.steps.length,inputSteps:task.steps.filter(step=>step.type==='fill').length,steps:task.steps.map(step=>({type:step.type,...(step.type==='navigate'?{url:step.url}:{}),...(step.selector?{selector:step.selector}:{}),...(step.type==='fill'?{characters:step.text.length}:{}),...(step.type==='press'?{key:step.key}:{})}))}))};
 }
 apply(token,owner){
  this.prune();const item=this.pending.get(token);if(!item||item.owner!==owner)throw new Error('任务预览已过期，请重新选择文件');
  const tasks=this.store.transaction(()=>{const created=item.tasks.map(input=>this.store.saveTask({...input,id:crypto.randomUUID(),updatedAt:this.now()}));this.store.activity('导入任务','本地任务',`${created.length} 个独立定义`);return created;});
  this.pending.delete(token);return {count:tasks.length,ids:tasks.map(task=>task.id)};
 }
 dispose(){clearInterval(this.timer);this.pending.clear();}
}
module.exports={TaskTransfers,parseDocument,readDocument,MAX_BYTES};
