'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {collectFiles,writeArchive,extractArchive,checkPassword}=require('./encrypted-archive');
const {validateProfile}=require('./profile-validation');
const {inspectExtension}=require('./extensions');
const locks=new Set(),UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function assertProfileUnlocked(id){if(locks.has(id))throw new Error('这个环境正在备份，请完成后再操作');}
const excluded=new Set(['Cache','Code Cache','GPUCache','DawnCache','GrShaderCache','ShaderCache','Crashpad','BrowserMetrics','BrowserMetrics-spare.pma','SingletonLock','SingletonCookie','SingletonSocket','LOCK','lockfile','.DS_Store']);
async function directoryHash(directory){
 const hash=crypto.createHash('sha256'),files=(await collectFiles(directory,'extension')).sort((a,b)=>a.path.localeCompare(b.path));
 for(const file of files){hash.update(file.path);hash.update('\0');hash.update(String(file.size));hash.update('\0');for await(const chunk of fs.createReadStream(file.source))hash.update(chunk);}
 return hash.digest('hex');
}
class ProfileBackups{
 constructor({app,session,store,extensions,runtime,starting=()=>[]}){
  Object.assign(this,{app,session,store,extensions,runtime,starting});this.pending=new Map();this.state={busy:false,phase:'idle'};
  this.stagingRoot=path.join(app.getPath('userData'),'backup-staging');
  this.ready=(async()=>{await fsp.mkdir(this.stagingRoot,{recursive:true,mode:0o700});const entries=await fsp.readdir(this.stagingRoot);await Promise.all(entries.filter(entry=>UUID.test(entry)).map(entry=>fsp.rm(path.join(this.stagingRoot,entry),{recursive:true,force:true})));})();
  this.ready.catch(()=>{});
 }
 status(){return {...this.state};}
 async run(phase,action){
  if(this.state.busy)throw new Error('请等待当前备份或恢复完成');
  this.state={busy:true,phase,completed:0,total:0,files:0};
  try{await this.ready;const result=await action();this.state={...this.state,busy:false,phase:'completed'};return result;}
  catch(error){this.state={...this.state,busy:false,phase:'failed',error:error.message};throw error;}
 }
 progress(value){this.state={...this.state,...value};}
 async export(destination,password,ids){
  checkPassword(password);
  if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>!UUID.test(id)||!this.store.get(id)))throw new Error('请选择 1–500 个现有环境');
  const unique=[...new Set(ids)],active=new Set([...this.runtime().map(row=>row.id),...this.starting()]);
  if(unique.some(id=>active.has(id)))throw new Error('请先停止所选环境，再保存备份');
  return this.run('collecting',async()=>{
   for(const id of unique)locks.add(id);
   try{
    this.store.flush();const profiles=unique.map(id=>structuredClone(this.store.get(id))),cookies={},histories={},files=[];
    for(const profile of profiles){
     const ses=this.session.fromPartition('persist:tfb-env-'+profile.id);ses.flushStorageData();await ses.cookies.flushStore();
     cookies[profile.id]=await ses.cookies.get({});histories[profile.id]=structuredClone(this.store.history(profile.id));
     if(ses.storagePath)files.push(...await collectFiles(ses.storagePath,'profiles/'+profile.id+'/electron',{exclude:name=>excluded.has(name)||['Cookies','Cookies-journal'].includes(name)}));
     files.push(...await collectFiles(path.join(this.app.getPath('userData'),'profiles',profile.id,'user-data'),'profiles/'+profile.id+'/chrome',{exclude:name=>excluded.has(name)}));
    }
    const extensionIds=[...new Set(profiles.flatMap(p=>p.extensions||[]))],extensions=[];
    for(const id of extensionIds){const record=this.extensions.list().find(e=>e.id===id);if(!record)throw new Error('部分扩展已缺失，请先修复环境设置');const directory=this.extensions.directory(id);extensions.push({...structuredClone(record),contentHash:await directoryHash(directory)});files.push(...await collectFiles(directory,'extensions/'+id));}
    const manifest={kind:'star-environments',version:1,appVersion:this.app.getVersion(),platform:process.platform,createdAt:Date.now(),profiles,cookies,histories,extensions};
    this.progress({phase:'encrypting'});const result=await writeArchive(destination,password,manifest,files,value=>this.progress(value));
    this.store.activity('保存加密备份',`${profiles.length} 个环境`);return {ok:true,...result,count:profiles.length};
   }finally{for(const id of unique)locks.delete(id);}
  });
 }
 async preview(source,password,sender){
  checkPassword(password);await this.expire();
  return this.run('decrypting',async()=>{
   const token=crypto.randomUUID(),directory=path.join(this.stagingRoot,token);
   try{
    const decoded=await extractArchive(source,password,directory,value=>this.progress(value));
    const manifest=decoded.manifest;
    if(manifest.kind!=='star-environments'||manifest.version!==1||!Array.isArray(manifest.profiles)||!manifest.profiles.length||manifest.profiles.length>500||!Array.isArray(manifest.extensions))throw new Error('备份版本或环境说明无效');
    const ids=new Set(),extensionIds=new Set();
    for(const p of manifest.profiles){if(!UUID.test(p.id)||ids.has(p.id))throw new Error('备份环境标识无效或重复');ids.add(p.id);validateProfile(p,true);if(!Array.isArray(manifest.cookies?.[p.id])||manifest.cookies[p.id].length>50000)throw new Error('备份 Cookie 格式无效');}
    for(const extension of manifest.extensions){if(!UUID.test(extension.id)||extensionIds.has(extension.id))throw new Error('备份扩展标识无效或重复');extensionIds.add(extension.id);const root=path.join(directory,'extensions',extension.id);await inspectExtension(root);if(await directoryHash(root)!==extension.contentHash)throw new Error('备份扩展内容不完整');}
    for(const p of manifest.profiles)if(p.extensions?.some(id=>!extensionIds.has(id)))throw new Error('备份缺少环境使用的扩展');
    for(const relative of decoded.paths){if(relative==='manifest.json')continue;const parts=relative.split('/');if(parts[0]==='profiles'&&ids.has(parts[1])&&['electron','chrome'].includes(parts[2])&&parts.length>3)continue;if(parts[0]==='extensions'&&extensionIds.has(parts[1])&&parts.length>2)continue;throw new Error('备份包含环境范围之外的文件');}
    const item={directory,manifest,sender,time:Date.now()};this.pending.set(token,item);
    item.timer=setTimeout(()=>this.discard(token).catch(()=>{}),10*60*1000);item.timer.unref?.();
    return {token,count:ids.size,createdAt:manifest.createdAt,version:manifest.appVersion,bytes:decoded.bytes,files:decoded.files,extensions:manifest.extensions.map(e=>({name:e.name,version:e.version})),profiles:manifest.profiles.map(p=>({name:p.name,group:p.group,cookieCount:manifest.cookies[p.id].length,hasChrome:decoded.paths.some(relative=>relative.startsWith('profiles/'+p.id+'/chrome/'))}))};
   }catch(error){await fsp.rm(directory,{recursive:true,force:true});throw error;}
  });
 }
 async restore(token,sender){
  const item=this.pending.get(token);if(!item||item.sender!==sender||Date.now()-item.time>10*60*1000)throw new Error('恢复预览已过期，请重新选择备份');
  return this.run('restoring',async()=>{
   this.pending.delete(token);clearTimeout(item.timer);const created=[],extensionRecords=[],extensionMap=new Map(),prepared=[];
   try{
    for(const saved of item.manifest.extensions){
     const source=path.join(item.directory,'extensions',saved.id),existing=this.extensions.list().find(e=>e.id===saved.id);
     if(existing&&await directoryHash(this.extensions.directory(existing.id))===saved.contentHash){extensionMap.set(saved.id,existing.id);continue;}
     const id=existing?crypto.randomUUID():saved.id,destination=this.extensions.directory(id);
     if(fs.existsSync(destination))throw new Error('目标扩展目录已存在，请先检查本地扩展库');
     created.push(destination);await fsp.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fsp.cp(source,destination,{recursive:true,errorOnExist:true,force:false});
     const inspected=await inspectExtension(destination);extensionRecords.push({id,...inspected.metadata,createdAt:Date.now()});extensionMap.set(saved.id,id);
    }
    for(const original of item.manifest.profiles){
     const id=crypto.randomUUID(),data=validateProfile({...original,name:original.name+'（恢复）',extensions:(original.extensions||[]).map(value=>extensionMap.get(value))},true);
     const target=path.join(this.app.getPath('sessionData'),'Partitions','tfb-env-'+id),chromeTarget=path.join(this.app.getPath('userData'),'profiles',id,'user-data');
     for(const [kind,destination] of [['electron',target],['chrome',chromeTarget]]){
      const source=path.join(item.directory,'profiles',original.id,kind);if(!fs.existsSync(source))continue;
      if(fs.existsSync(destination))throw new Error('目标环境目录已存在');created.push(kind==='chrome'?path.dirname(destination):destination);await fsp.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fsp.cp(source,destination,{recursive:true,errorOnExist:true,force:false});
     }
     created.push(target);const ses=this.session.fromPartition('persist:tfb-env-'+id);
     if(ses.storagePath!==target)throw new Error('当前内核的环境存储路径不兼容');
     for(const cookie of item.manifest.cookies[original.id]){
      if(!cookie||typeof cookie.name!=='string'||typeof cookie.value!=='string'||typeof cookie.domain!=='string'||cookie.expirationDate&&cookie.expirationDate<=Date.now()/1000)continue;
      const host=cookie.domain.replace(/^\./,''),details={url:(cookie.secure?'https://':'http://')+host+(cookie.path||'/'),name:cookie.name,value:cookie.value,path:cookie.path||'/',secure:!!cookie.secure,httpOnly:!!cookie.httpOnly};
      if(!cookie.hostOnly)details.domain=cookie.domain;
      if(!cookie.session&&Number.isFinite(cookie.expirationDate))details.expirationDate=cookie.expirationDate;
      if(['unspecified','no_restriction','lax','strict'].includes(cookie.sameSite))details.sameSite=cookie.sameSite;
      await ses.cookies.set(details);
     }
     await ses.cookies.flushStore();
     prepared.push({id,data,original});this.progress({completed:prepared.length,total:item.manifest.profiles.length});
    }
    const profiles=this.store.transaction(()=>{
     for(const record of extensionRecords)this.store.saveExtension(record);
     const result=prepared.map(({id,data,original})=>{const p=this.store.create(data,id);this.store.sessionTabs(id,original.sessionTabs,original.sessionActive);this.store.restoreHistory(id,item.manifest.histories?.[original.id]);return p;});
     this.store.activity('恢复加密备份',`${result.length} 个独立环境`);return result;
    });
    return {ok:true,count:profiles.length,profiles:profiles.map(p=>({id:p.id,name:p.name}))};
   }catch(error){for(const directory of new Set(created.reverse()))await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{});throw error;}
   finally{await fsp.rm(item.directory,{recursive:true,force:true});}
  });
 }
 async discard(token,sender){const item=this.pending.get(token);if(!item||sender!==undefined&&item.sender!==sender)return false;this.pending.delete(token);clearTimeout(item.timer);await fsp.rm(item.directory,{recursive:true,force:true});return true;}
 async expire(){for(const [token,item]of this.pending)if(Date.now()-item.time>10*60*1000)await this.discard(token);}
}
module.exports={ProfileBackups,assertProfileUnlocked};
