'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const MAX_FILES=5000,MAX_BYTES=100*1024*1024;
const ignored=new Set(['.git','node_modules','.DS_Store','_metadata']);
let activeLibrary;
async function inspectExtension(directory){
 const root=await fs.promises.realpath(directory),files=[];let bytes=0;
 async function visit(relative=''){
  for(const entry of await fs.promises.readdir(path.join(root,relative),{withFileTypes:true})){
   if(ignored.has(entry.name)||entry.name.startsWith('.'))continue;
   const name=path.join(relative,entry.name),full=path.join(root,name),stat=await fs.promises.lstat(full);
   if(stat.isSymbolicLink())throw new Error('扩展目录包含符号链接，请使用独立的完整目录');
   if(stat.isDirectory())await visit(name);
   else if(stat.isFile()){
    bytes+=stat.size;files.push(name);
    if(bytes>MAX_BYTES||files.length>MAX_FILES)throw new Error('扩展最多 100 MB、5000 个文件');
   }else throw new Error('扩展目录包含不支持的文件类型');
  }
 }
 await visit();
 if(!files.includes('manifest.json'))throw new Error('请选择包含 manifest.json 的扩展目录');
 const raw=await fs.promises.readFile(path.join(root,'manifest.json'),'utf8');let manifest;
 try{manifest=JSON.parse(raw);}catch{throw new Error('manifest.json 格式无效');}
 if(![2,3].includes(manifest.manifest_version)||typeof manifest.name!=='string'||typeof manifest.version!=='string'||!/^\d+(\.\d+){0,3}$/.test(manifest.version))throw new Error('扩展清单需要有效的名称、版本和 Manifest 2/3');
 let name=manifest.name;
 const localized=name.match(/^__MSG_(\w+)__$/);
 if(localized&&/^[\w-]+$/.test(manifest.default_locale||'')){
  try{const messages=JSON.parse(await fs.promises.readFile(path.join(root,'_locales',manifest.default_locale,'messages.json'),'utf8'));name=messages[localized[1]]?.message||name;}catch{}
 }
 for(const field of ['permissions','host_permissions','content_scripts'])if(manifest[field]!==undefined&&!Array.isArray(manifest[field]))throw new Error(field+' 必须是数组');
 const matches=(manifest.content_scripts||[]).flatMap(script=>Array.isArray(script.matches)?script.matches:[]);
 const permissions=[...new Set([...(manifest.permissions||[]),...(manifest.host_permissions||[]),...matches].filter(p=>typeof p==='string'))].slice(0,100);
 return {root,files,manifestHash:crypto.createHash('sha256').update(raw).digest('hex'),metadata:{name:name.slice(0,160),version:manifest.version,description:String(manifest.description||'').slice(0,1000),manifestVersion:manifest.manifest_version,permissions,bytes,fileCount:files.length}};
}
class ExtensionLibrary{
 constructor(userData,store){this.root=path.join(userData,'extensions');this.store=store;}
 list(){return this.store.listExtensions();}
 directory(id){if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('扩展标识无效');return path.join(this.root,id);}
 async import(directory,expectedHash){
  const inspected=await inspectExtension(directory);if(expectedHash&&expectedHash!==inspected.manifestHash)throw new Error('扩展清单已更改，请重新预览');
  const id=crypto.randomUUID(),destination=this.directory(id);
  await fs.promises.mkdir(destination,{recursive:true,mode:0o700});
  try{
   for(const relative of inspected.files){
    const source=path.join(inspected.root,relative),target=path.join(destination,relative),stat=await fs.promises.lstat(source);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('扩展文件已更改，请重新选择目录');
    await fs.promises.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.promises.copyFile(source,target);await fs.promises.chmod(target,0o600);
   }
   const record={id,...inspected.metadata,createdAt:Date.now()};
   this.store.transaction(()=>{this.store.saveExtension(record);this.store.activity('添加扩展',record.name);});return record;
  }catch(error){await fs.promises.rm(destination,{recursive:true,force:true});throw error;}
 }
 async remove(id){
  const extension=this.list().find(x=>x.id===id);if(!extension)throw new Error('扩展已不存在');
  this.store.transaction(()=>{this.store.removeExtension(id);this.store.activity('移除扩展',extension.name);});
  await fs.promises.rm(this.directory(id),{recursive:true,force:true});
 }
 resolve(profile){return (profile.extensions||[]).map(id=>{
  const item=this.list().find(x=>x.id===id);if(!item)throw new Error('环境引用的扩展已缺失，请重新添加或在环境设置中取消');
  const directory=this.directory(id);if(!fs.existsSync(path.join(directory,'manifest.json')))throw new Error(item.name+' 的文件已缺失，请重新导入');
  return {...item,directory};
 });}
 async loadForSession(ses,profile){
  const requested=this.resolve(profile),api=ses.extensions||ses;
  ses.__starExtensions ||= new Map();
  for(const [id,loadedId] of ses.__starExtensions)if(!requested.some(x=>x.id===id)){api.removeExtension(loadedId);ses.__starExtensions.delete(id);}
  const loaded=[];
  for(const item of requested){
   let loadedId=ses.__starExtensions.get(item.id);
   if(!loadedId){
    try{const extension=await api.loadExtension(item.directory,{allowFileAccess:false});loadedId=extension.id;ses.__starExtensions.set(item.id,loadedId);}
    catch(error){throw new Error('无法加载 '+item.name+'：'+error.message);}
   }
   loaded.push({id:item.id,name:item.name,runtimeId:loadedId});
  }
  return loaded;
 }
}
function initExtensionLibrary(userData,store){activeLibrary=new ExtensionLibrary(userData,store);return activeLibrary;}
module.exports={ExtensionLibrary,inspectExtension,initExtensionLibrary,getExtensionLibrary:()=>activeLibrary};
