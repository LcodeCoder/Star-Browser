'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {validateProfile}=require('./profile-validation');
function publicProfile(profile){
 const result={id:profile.id,...validateProfile(profile,true),createdAt:profile.createdAt,updatedAt:profile.updatedAt,lastOpenedAt:profile.lastOpenedAt};
 if(result.proxy)result.proxy={type:result.proxy.type,host:result.proxy.host,port:result.proxy.port};
 return result;
}
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
class LocalApi{
 constructor(directory,{store,commands,runtime,version}){
  this.file=path.join(directory,'local-api.json');this.store=store;this.commands=commands;this.runtime=runtime;this.version=version;this.server=null;this.error='';this.port=null;this._requests=0;
  this.config={enabled:false,port:0,token:crypto.randomBytes(32).toString('hex')};
  try{const config=JSON.parse(fs.readFileSync(this.file,'utf8'));if(/^[a-f\d]{64}$/i.test(config.token))this.config={enabled:config.enabled===true,port:Number.isInteger(config.port)&&config.port>=0&&config.port<=65535?config.port:0,token:config.token};}catch{}
 }
 status(){return {enabled:this.config.enabled,listening:!!this.server?.listening,port:this.port,configuredPort:this.config.port,url:this.server?.listening?'http://127.0.0.1:'+this.port:'',error:this.error};}
 token(){return this.config.token;}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.config),{mode:0o600});fs.renameSync(temp,this.file);}
 async start(){
  if(this.server?.listening)return this.status();
  this.error='';const server=http.createServer((req,res)=>this.handle(req,res));server.requestTimeout=45000;server.headersTimeout=10000;server.maxHeadersCount=30;
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.config.port,'127.0.0.1',resolve);});
   this.server=server;this.port=server.address().port;server.on('error',error=>{this.error=error.message;});
  }catch(error){this.error=error.code==='EADDRINUSE'?'端口已被占用，请更换端口':error.message;throw new Error(this.error);}
  return this.status();
 }
 async stop(){const server=this.server;this.server=null;this.port=null;if(server){server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}return this.status();}
 async configure(patch){
  const next={...this.config};
  if(patch.port!==undefined){const port=Number(patch.port);if(!Number.isInteger(port)||port<0||port>65535||port>0&&port<1024)throw new Error('使用 1024–65535 的端口，或填写 0 自动分配');next.port=port;}
  if(patch.enabled!==undefined)next.enabled=patch.enabled===true;
  const previous=this.config;
  await this.stop();this.config=next;
  try{if(next.enabled)await this.start();this.save();this.store.activity(next.enabled?'启用本地 API':'关闭本地 API','127.0.0.1');return this.status();}
  catch(error){await this.stop();this.config=previous;if(previous.enabled)await this.start().catch(()=>{});throw error;}
 }
 rotateToken(){this.config.token=crypto.randomBytes(32).toString('hex');this.save();this.store.activity('更新 API 密钥','旧密钥已失效');return this.status();}
 async body(req){
  if(String(req.headers['content-type']||'').toLowerCase().split(';')[0].trim()!=='application/json')throw new ApiError(415,'请求正文需要 application/json');
  if(Number(req.headers['content-length'])>1024*1024){req.resume();throw new ApiError(413,'请求正文不能超过 1 MB');}
  const bytes=await new Promise((resolve,reject)=>{
    let length=0,chunks=[];
    const cleanup=()=>{req.off('data',receive);req.off('end',complete);req.off('error',fail);};
    const fail=error=>{cleanup();reject(error);};
    const receive=chunk=>{length+=chunk.length;if(length>1024*1024){chunks=[];fail(new ApiError(413,'请求正文不能超过 1 MB'));req.resume();}else chunks.push(chunk);};
    const complete=()=>{cleanup();resolve(Buffer.concat(chunks));};
    req.on('data',receive);req.once('end',complete);req.once('error',fail);
  });
  try{return JSON.parse(bytes.toString('utf8')||'{}');}catch{throw new ApiError(400,'JSON 格式无效');}
 }
 async handle(req,res){
  const respond=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   const hosts=new Set(['127.0.0.1:'+this.port,'localhost:'+this.port]);
   if(!hosts.has(req.headers.host)||req.headers.origin||req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'仅接受本机脚本请求');
   const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(Buffer.byteLength(supplied)!==Buffer.byteLength(this.config.token)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(this.config.token)))throw new ApiError(401,'API 密钥无效');
   if(this._requests>=8)throw new ApiError(429,'同时执行的请求过多，请稍后重试');this._requests++;
   try{
    const url=new URL(req.url,'http://127.0.0.1:'+this.port),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]!=='v1')throw new ApiError(404,'接口不存在');
    if(parts[1]==='health'&&parts.length===2&&req.method==='GET')return respond(200,{ok:true,data:{version:this.version,apiVersion:1}});
    if(parts[1]!=='profiles')throw new ApiError(404,'接口不存在');
    if(parts.length===2){
     if(req.method==='GET'){
      const search=(url.searchParams.get('search')||'').toLowerCase(),group=url.searchParams.get('group'),tag=url.searchParams.get('tag'),state=url.searchParams.get('state');
      const running=new Set(this.runtime().map(r=>r.id));
      const list=this.store.list().filter(p=> (!search||[p.name,p.group,p.note,...(p.tags||[])].join(' ').toLowerCase().includes(search))&&(!group||p.group===group)&&(!tag||p.tags?.includes(tag))&&(state==='archived'?p.archived:!p.archived)&&(state!=='running'||running.has(p.id)));
      const offset=Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0)),limit=Math.min(500,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||100)));
      return respond(200,{ok:true,data:list.slice(offset,offset+limit).map(p=>({...publicProfile(p),running:running.has(p.id)})),total:list.length,offset,limit});
     }
     if(req.method==='POST'){const data=await this.commands('create',[await this.body(req)]);return respond(201,{ok:true,data:publicProfile(data)});}
     throw new ApiError(405,'该接口不支持此方法');
    }
    const id=parts[2],profile=this.store.get(id);if(!profile)throw new ApiError(404,'环境不存在');
    if(parts.length===3){
     if(req.method==='GET')return respond(200,{ok:true,data:{...publicProfile(profile),running:this.runtime().some(row=>row.id===id)}});
     if(req.method==='PATCH'){const data=await this.commands('update',[id,await this.body(req)]);return respond(200,{ok:true,data:publicProfile(data)});}
     if(req.method==='DELETE'){if(this.runtime().some(row=>row.id===id))throw new ApiError(409,'请先停止环境，再删除配置');await this.commands('remove',[id]);return respond(200,{ok:true});}
     throw new ApiError(405,'该接口不支持此方法');
    }
    if(parts.length===4&&req.method==='POST'){
     const body=await this.body(req);
     if(parts[3]==='start'){
      if(body.engine!==undefined&&!['electron','chrome'].includes(body.engine))throw new ApiError(400,'engine 使用 electron 或 chrome');
      const result=await this.commands(body.engine==='chrome'?'launch':'browse',[id]);return respond(200,{ok:true,data:result});
     }
     if(parts[3]==='stop'){await this.commands('stop',[id]);return respond(200,{ok:true});}
     if(parts[3]==='clone'){const copy=this.store.transaction(()=>{const p=this.store.clone(id);this.store.activity('API 复制环境',p.name);return p;});return respond(201,{ok:true,data:publicProfile(copy)});}
    }
    throw new ApiError(404,'接口不存在');
   }finally{this._requests--;}
  }catch(error){respond(error.status||400,{ok:false,error:error.message});}
 }
}
module.exports={LocalApi,publicProfile};
