'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const args=process.argv.slice(2),options={platform:'all'};
for(let index=0;index<args.length;index+=2){
 const key=args[index]?.replace(/^--/,'');
 if(!['platform','arch'].includes(key)||!args[index+1])throw new Error('用法：verify:artifacts [--platform all|mac|win] [--arch arm64|x64]');
 options[key]=args[index+1];
}
if(!['all','mac','win'].includes(options.platform)||options.arch&&!['arm64','x64'].includes(options.arch))throw new Error('平台或架构无效');
if(options.platform==='all'&&options.arch)throw new Error('指定架构时请选择一个平台');
const targets=options.platform==='all'?[['mac','arm64'],['win','x64']]:[[options.platform,options.arch||(options.platform==='mac'?'arm64':'x64')]];
const checks=[],artifacts=[];
async function sha256(file){
 const hash=crypto.createHash('sha256');
 for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 return hash.digest('hex');
}
async function verifyPE(file){
 const handle=await fsp.open(file,'r');
 try{
  const dos=Buffer.alloc(64);const first=await handle.read(dos,0,64,0);
  if(first.bytesRead!==64||dos.toString('ascii',0,2)!=='MZ')throw new Error('Windows 安装程序缺少有效 DOS 头');
  const offset=dos.readUInt32LE(60),header=Buffer.alloc(26),size=(await handle.stat()).size;
  if(offset<64||offset+header.length>size)throw new Error('Windows 安装程序 PE 位置无效');
  const next=await handle.read(header,0,header.length,offset);
  if(next.bytesRead!==header.length||header.readUInt32LE(0)!==0x00004550)throw new Error('Windows 安装程序缺少有效 PE 头');
  const machine=header.readUInt16LE(4),magic=header.readUInt16LE(24);
  if(![0x14c,0x8664,0xaa64].includes(machine)||![0x10b,0x20b].includes(magic))throw new Error('Windows 安装程序 PE 类型无效');
  return {machine:machine.toString(16),optionalHeader:magic.toString(16)};
 }finally{await handle.close();}
}
function reader(file,entry,format='zip'){
 const seven=format==='nsis'||process.platform==='win32';
 return {command:seven?require('7zip-bin').path7za:'/usr/bin/unzip',parameters:seven?['e','-so',file,entry]:['-p',file,entry]};
}
async function archivePrefix(file,entry,format){
 const {command,parameters}=reader(file,entry,format);
 const child=spawn(command,parameters,{stdio:['ignore','pipe','pipe']}),chunks=[];let length=0,stderr='';
 child.stderr.on('data',chunk=>{if(stderr.length<4096)stderr+=chunk.toString();});
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`无法读取 ZIP 中的 ${entry}：${stderr}`)));});
 try{for await(const chunk of child.stdout){const kept=chunk.subarray(0,Math.max(0,65536-length));if(kept.length){chunks.push(kept);length+=kept.length;}}await exit;}
 catch(error){child.kill();await exit.catch(()=>{});throw error;}
 return Buffer.concat(chunks,length);
}
function verifyBinary(header,platform,arch){
 let binary;
 if(platform==='win'){
  if(header.length<64||header.toString('ascii',0,2)!=='MZ')throw new Error('发行包中浏览器程序 DOS 头无效');
  const offset=header.readUInt32LE(60);if(offset<64||offset+26>header.length||header.readUInt32LE(offset)!==0x00004550)throw new Error('发行包中浏览器程序 PE 头无效');
  const machine=header.readUInt16LE(offset+4),expected=arch==='arm64'?0xaa64:0x8664;
  if(machine!==expected)throw new Error('发行包中浏览器程序架构与目标不符');binary={format:'PE',machine:machine.toString(16)};
 }else{
  const expected=arch==='arm64'?0x0100000c:0x01000007;
  if(header.length<32||header.readUInt32LE(0)!==0xfeedfacf||header.readUInt32LE(4)!==expected)throw new Error('发行包中浏览器程序 Mach-O 架构与目标不符');
  binary={format:'Mach-O',cpuType:header.readUInt32LE(4).toString(16)};
 }
 return binary;
}
async function verifyAsar(asar){
 const asarApi=require('@electron/asar');
 const packaged=JSON.parse(asarApi.extractFile(asar,'package.json').toString('utf8'));
 if(packaged.version!==pkg.version||packaged.name!==pkg.name)throw new Error('发行包内应用身份或版本与源码不符');
 const files=[];
 async function collect(directory){
  for(const entry of await fsp.readdir(path.join(root,directory),{withFileTypes:true})){
   const relative=directory+'/'+entry.name;
   if(entry.isDirectory())await collect(relative);
   else if(entry.isFile())files.push(relative);
   else throw new Error('源码资源中出现不受支持的文件类型');
  }
 }
 await collect('src');files.sort();const sourceTree=crypto.createHash('sha256');
 const archived=asarApi.listPackage(asar).map(entry=>entry.replaceAll('\\','/').replace(/^\//,'')).filter(entry=>entry.startsWith('src/')&&!asarApi.statFile(asar,path.normalize(entry)).files).sort();
 if(JSON.stringify(archived)!==JSON.stringify(files))throw new Error('发行包内源码文件列表与当前工作区不符，请重新构建');
 for(const required of files){
  const content=asarApi.extractFile(asar,path.normalize(required)),source=await fsp.readFile(path.join(root,required));
  if(!content.equals(source))throw new Error(`发行包内 ${required} 与当前源码不符，请重新构建`);
  sourceTree.update(required+'\0').update(source).update('\0');
 }
 return {version:packaged.version,sourceFilesMatched:files.length,sourceTreeSha256:sourceTree.digest('hex')};
}
async function verifyPayload(file,platform,arch,format='zip'){
 const member=platform==='mac'?'Star Browser.app/Contents/MacOS/Star Browser':'Star Browser.exe';
 const binary=verifyBinary(await archivePrefix(file,member,format),platform,arch);
 const asarMember=platform==='mac'?'Star Browser.app/Contents/Resources/app.asar':'resources/app.asar';
 const temporary=await fsp.mkdtemp(path.join(os.tmpdir(),'star-artifact-payload-'));
 try{
  const {command,parameters}=reader(file,asarMember,format);
  const {stdout}=await run(command,parameters,{encoding:'buffer',maxBuffer:64*1024*1024});
  const asar=path.join(temporary,'app.asar');await fsp.writeFile(asar,stdout,{mode:0o600});
  return {binary,...await verifyAsar(asar)};
 }finally{await fsp.rm(temporary,{recursive:true,force:true});}
}
async function verifyMountedDmg(file,arch){
 const mount=await fsp.mkdtemp(path.join(os.tmpdir(),'star-artifact-dmg-'));let attached=false;
 try{
  await run('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,file],{maxBuffer:1024*1024});attached=true;
  const bundle=path.join(mount,'Star Browser.app/Contents'),handle=await fsp.open(path.join(bundle,'MacOS/Star Browser'),'r');let header;
  try{header=Buffer.alloc(65536);await handle.read(header,0,header.length,0);}finally{await handle.close();}
  return {binary:verifyBinary(header,'mac',arch),...await verifyAsar(path.join(bundle,'Resources/app.asar'))};
 }finally{
  if(attached)await run('/usr/bin/hdiutil',['detach',mount],{maxBuffer:1024*1024});
  await fsp.rm(mount,{recursive:true,force:true});
 }
}
async function verifyZip(file){
 if(process.platform==='win32')await run(require('7zip-bin').path7za,['t',file],{maxBuffer:1024*1024});
 else await run('/usr/bin/unzip',['-t',file],{maxBuffer:1024*1024});
}
(async()=>{
 let failed;
 try{
  for(const [platform,arch]of targets){
   for(const extension of [platform==='mac'?'dmg':'exe','zip']){
    const name=`Star-Browser-${pkg.version}-${platform}-${arch}.${extension}`,file=path.join(root,'dist',name),stat=await fsp.stat(file);
    if(!stat.isFile()||stat.size<1024*1024)throw new Error(`${name} 为空或不是发行文件`);
    let type,payload;
    if(extension==='zip'){await verifyZip(file);payload=await verifyPayload(file,platform,arch);type='ZIP archive; full integrity test passed';}
    else if(extension==='exe'){type=await verifyPE(file);await run(require('7zip-bin').path7za,['t',file],{maxBuffer:1024*1024});payload=await verifyPayload(file,platform,arch,'nsis');}
    else if(process.platform==='darwin'){await run('/usr/bin/hdiutil',['verify',file],{maxBuffer:1024*1024});payload=await verifyMountedDmg(file,arch);type='DMG; image checksum and mounted application verified';}
    else{const handle=await fsp.open(file,'r');try{const footer=Buffer.alloc(512);await handle.read(footer,0,512,stat.size-512);if(footer.toString('ascii',0,4)!=='koly')throw new Error('DMG 缺少 UDIF 结束头');type='DMG; UDIF trailer verified, platform runtime not exercised';}finally{await handle.close();}}
    const artifact={name,platform,arch,bytes:stat.size,sha256:await sha256(file),type,payload};artifacts.push(artifact);checks.push({name,status:'passed'});console.log(`PASS ${name} (${stat.size} bytes)`);
   }
  }
  const suffix=options.platform==='all'?'':`-${targets[0].join('-')}`;
  const checksum=path.join(root,'dist',`SHA256SUMS-${pkg.version}${suffix}.txt`),temporary=checksum+'.tmp';
  try{await fsp.writeFile(temporary,artifacts.map(item=>`${item.sha256}  ${item.name}`).join('\n')+'\n',{mode:0o600});await fsp.rename(temporary,checksum);}finally{await fsp.rm(temporary,{force:true});}
 }catch(error){failed=error;console.error(error.message);process.exitCode=1;}
 finally{
  const report={status:failed?'failed':'passed',checkedAt:new Date().toISOString(),version:pkg.version,host:{platform:process.platform,arch:process.arch},requestedTargets:targets,artifacts,checks,error:failed?.message,limitations:['文件格式、完整性和 SHA-256 不替代目标平台上的安装与运行验收。','校验不证明所有网站的指纹检测效果或定制 Chromium 已通过原生验收。']};
  const directory=path.join(root,'test-results');await fsp.mkdir(directory,{recursive:true});
  await fsp.writeFile(path.join(directory,`artifact-verification-${options.platform}.json`),JSON.stringify(report,null,2)+'\n');
 }
})();
