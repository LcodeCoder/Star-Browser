'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../src/main/store');

const failures=[
 ['偏好设置', store=>store.preferences({theme:'dark',density:'compact'})],
 ['新建任务', store=>store.saveTask({id:'new-task',name:'待保存任务',steps:[{type:'wait',duration:100}]})],
 ['修改任务', store=>store.saveTask({id:'saved-task',name:'未保存的修改',steps:[{type:'wait',duration:500}]})],
 ['删除任务', store=>store.removeTask('saved-task')],
 ['任务运行状态', store=>store.saveTaskRun({id:'saved-run',state:'completed',createdAt:1,steps:[{index:1,state:'completed'}],outputs:[]})],
 ['删除环境和历史', (store,profile)=>store.remove(profile.id)],
];
for(const [name,mutate] of failures)test(`${name}在真实写入失败后保留内存、文件与修订号，并可重试`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-storage-recovery-'));
 try{
  const store=new Store(dir),profile=store.create({name:'持久环境'});
  store.saveTask({id:'saved-task',name:'已保存任务',steps:[{type:'wait',duration:100}]});
  store.saveTaskRun({id:'saved-run',state:'queued',createdAt:1,steps:[],outputs:[]});
  store.restoreHistory(profile.id,[{url:'https://example.test/saved',title:'持久历史',time:1}]);
  const memory=structuredClone(store._data),disk=fs.readFileSync(store.file,'utf8'),revision=store.revision();
  let changes=0;store.on('changed',()=>changes++);
  fs.mkdirSync(store.file+'.tmp');
  assert.throws(()=>mutate(store,profile),error=>['EISDIR','EACCES','EPERM'].includes(error.code));
  assert.deepEqual(store._data,memory);
  assert.equal(fs.readFileSync(store.file,'utf8'),disk);
  assert.equal(store.revision(),revision);
  assert.equal(changes,0);
  assert.equal(store.get(profile.id)?.name,profile.name);
  fs.rmSync(store.file+'.tmp',{recursive:true});
  mutate(store,profile);
  assert.equal(store.revision(),revision+1);
  assert.equal(changes,1);
  assert.deepEqual(new Store(dir)._data,store._data);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('任务定义和运行记录隔离调用者的后续修改，失败状态更新不会污染已保存记录',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-task-snapshot-'));
 try{
  const store=new Store(dir),task={id:'task',name:'独立定义',steps:[{type:'fill',selector:'#text',text:'已保存'}]};
  const run={id:'run',state:'queued',createdAt:1,steps:[],outputs:[]};
  store.saveTask(task);store.saveTaskRun(run);
  task.steps[0].text='未保存';run.state='running';run.steps.push({index:1,state:'completed'});run.outputs.push({path:'unsaved.png'});
  assert.equal(store.tasks()[0].steps[0].text,'已保存');
  assert.deepEqual(store.taskRuns()[0],{id:'run',state:'queued',createdAt:1,steps:[],outputs:[]});
  const disk=fs.readFileSync(store.file,'utf8');fs.mkdirSync(store.file+'.tmp');
  assert.throws(()=>store.saveTaskRun(run),error=>['EISDIR','EACCES','EPERM'].includes(error.code));
  assert.equal(store.taskRuns()[0].state,'queued');
  assert.equal(store.taskRuns()[0].outputs.length,0);
  assert.equal(fs.readFileSync(store.file,'utf8'),disk);
  fs.rmSync(store.file+'.tmp',{recursive:true});store.saveTaskRun(run);
  assert.equal(new Store(dir).taskRuns()[0].state,'running');
  assert.equal(new Store(dir).taskRuns()[0].outputs[0].path,'unsaved.png');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
