'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/main/store');
const {ProfileBackups,assertProfileUnlocked}=require('../src/main/profile-backups');
const {extractArchive}=require('../src/main/encrypted-archive');

async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'star-backup-consistency-'));
 const store=new Store(root),profile=store.create({name:'备份一致性'});
 const storage=path.join(root,'browser-storage'),source=path.join(storage,'client.db'),destination=path.join(root,'environment.starbackup');
 fs.mkdirSync(storage);fs.writeFileSync(source,'saved-state');
 let flushes=0,activities=0;
 const originalActivity=store.activity.bind(store);store.activity=(...args)=>{activities++;return originalActivity(...args);};
 const session={storagePath:storage,flushStorageData(){flushes++;},cookies:{async flushStore(){},async get(){return [];}}};
 const backups=new ProfileBackups({app:{getPath:()=>root,getVersion:()=>require('../package.json').version},session:{fromPartition:()=>session},store,extensions:{list:()=>[]},runtime:()=>[]});
 await backups.ready;
 return {root,profile,source,destination,backups,counts:()=>({flushes,activities}),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function assertNoTemporaryFiles(root){assert.equal(fs.readdirSync(root).some(name=>name.includes('.tmp-')),false);}

test('备份遇到迟到写入时在环境锁内重新采集，解密得到完整的新内容',async()=>{
 const f=await fixture(),original=fs.promises.lstat;let scans=0;
 try{
  fs.promises.lstat=async(...args)=>{
   const stat=await original(...args);
   if(args[0]===f.source){scans++;assert.throws(()=>assertProfileUnlocked(f.profile.id),/正在备份/);if(scans===1)fs.appendFileSync(f.source,'-flushed');}
   return stat;
  };
  const result=await f.backups.export(f.destination,'test-password',[f.profile.id]);
  assert.equal(result.count,1);assert.equal(scans,2);assert.deepEqual(f.counts(),{flushes:1,activities:1});
  const restored=path.join(f.root,'restored');await extractArchive(f.destination,'test-password',restored);
  assert.equal(fs.readFileSync(path.join(restored,'profiles',f.profile.id,'electron','client.db'),'utf8'),'saved-state-flushed');
  assert.doesNotThrow(()=>assertProfileUnlocked(f.profile.id));assert.equal(f.backups.status().busy,false);assertNoTemporaryFiles(f.root);
 }finally{fs.promises.lstat=original;f.cleanup();}
});

test('持续变化的环境文件在三次采集后报错，保留已有备份并释放锁',async()=>{
 const f=await fixture(),original=fs.promises.lstat;let scans=0;fs.writeFileSync(f.destination,'existing-backup');
 try{
  fs.promises.lstat=async(...args)=>{
   const stat=await original(...args);
   if(args[0]===f.source){scans++;assert.throws(()=>assertProfileUnlocked(f.profile.id),/正在备份/);fs.appendFileSync(f.source,'-changing');}
   return stat;
  };
  await assert.rejects(f.backups.export(f.destination,'test-password',[f.profile.id]),error=>error.code==='STAR_BACKUP_SOURCE_CHANGED');
  assert.equal(scans,3);assert.equal(fs.readFileSync(f.destination,'utf8'),'existing-backup');assert.deepEqual(f.counts(),{flushes:1,activities:0});
  assert.doesNotThrow(()=>assertProfileUnlocked(f.profile.id));assert.equal(f.backups.status().phase,'failed');assert.equal(f.backups.status().busy,false);assertNoTemporaryFiles(f.root);
 }finally{fs.promises.lstat=original;f.cleanup();}
});

test('备份读取权限失败直接传播，不重复执行或覆盖已有备份',async()=>{
 const f=await fixture(),original=fs.promises.open;let attempts=0;fs.writeFileSync(f.destination,'existing-backup');
 try{
  fs.promises.open=async(...args)=>{if(args[0]===f.source){attempts++;throw Object.assign(new Error('模拟读取权限失败'),{code:'EACCES'});}return original(...args);};
  await assert.rejects(f.backups.export(f.destination,'test-password',[f.profile.id]),error=>error.code==='EACCES');
  assert.equal(attempts,1);assert.equal(fs.readFileSync(f.destination,'utf8'),'existing-backup');assert.equal(f.counts().activities,0);
  assert.doesNotThrow(()=>assertProfileUnlocked(f.profile.id));assert.equal(f.backups.status().busy,false);assertNoTemporaryFiles(f.root);
 }finally{fs.promises.open=original;f.cleanup();}
});
