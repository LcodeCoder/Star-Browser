'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {promisify} = require('node:util');
const derive = promisify(crypto.scrypt);
const MAGIC = Buffer.from('STARBAK1');
const HEADER_BYTES = 36, TAG_BYTES = 16;
const MAX_BYTES = 2 * 1024 ** 3, MAX_FILES = 100000;
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024)
    throw new Error('备份密码需要 8–1024 个字符');
}
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('备份包含无效文件路径');
  return value;
}
async function keyFor(password, salt) {
  checkPassword(password);
  return derive(password, salt, 32, {N:65536,r:8,p:1,maxmem:128*1024*1024});
}
async function collectFiles(root, prefix, {exclude = () => false} = {}) {
  const files = [];
  async function visit(relative = '') {
    let entries;
    try { entries = await fsp.readdir(path.join(root, relative), {withFileTypes:true}); }
    catch(error) { if (error.code === 'ENOENT' && !relative) return; throw error; }
    for (const entry of entries) {
      if (exclude(entry.name, relative)) continue;
      const child = relative ? relative + '/' + entry.name : entry.name;
      const full = path.join(root, child), stat = await fsp.lstat(full);
      // Chromium's socket and lock links are transient; never follow links.
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) continue;
      if (stat.isDirectory()) await visit(child);
      else {
        files.push({path:safeRelative(prefix + '/' + child),source:full,size:stat.size});
        if (files.length > MAX_FILES) throw new Error('备份文件过多，请先清理环境数据');
      }
    }
  }
  await visit();
  return files;
}
function sourceChanged(file) {
  return Object.assign(new Error('环境文件已变更，请重新备份'),{code:'STAR_BACKUP_SOURCE_CHANGED',entry:file.path});
}
function entryHeader(relative, size) {
  safeRelative(relative);
  const metadata = Buffer.from(JSON.stringify({path:relative,size}));
  const length = Buffer.alloc(4);length.writeUInt32BE(metadata.length);
  return [length, metadata];
}
async function writeArchive(destination, password, manifest, files, onProgress = () => {}) {
  const serialized = Buffer.from(JSON.stringify(manifest));
  const total = files.reduce((sum,file) => sum + file.size, serialized.length);
  if (serialized.length > 8*1024*1024 || total > MAX_BYTES || files.length > MAX_FILES)
    throw new Error('单份备份最多 2 GB、100000 个文件');
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC,salt,nonce]);
  const key = await keyFor(password,salt);
  const cipher = crypto.createCipheriv('aes-256-gcm',key,nonce);key.fill(0);cipher.setAAD(header);
  const temporary = destination + '.tmp-' + crypto.randomUUID();
  let completed = 0;
  async function* records() {
    yield* entryHeader('manifest.json',serialized.length);yield serialized;
    for(const file of files) {
      let handle;
      try { handle = await fsp.open(file.source,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
      catch(error) { if(error.code === 'ENOENT') throw sourceChanged(file);throw error; }
      try {
        const stat = await handle.stat();
        if(!stat.isFile() || stat.size !== file.size) throw sourceChanged(file);
        yield* entryHeader(file.path,file.size);
        let read = 0;
        for await(const chunk of handle.createReadStream({autoClose:false})) { read += chunk.length;yield chunk; }
        if(read !== file.size) throw sourceChanged(file);
      } finally { await handle.close(); }
      completed += file.size;onProgress({completed,total,files:files.length});
    }
  }
  try {
    await fsp.writeFile(temporary,header,{mode:0o600,flag:'wx'});
    await pipeline(Readable.from(records(),{objectMode:false}),zlib.createGzip({level:3}),cipher,fs.createWriteStream(temporary,{flags:'a',mode:0o600}));
    await fsp.appendFile(temporary,cipher.getAuthTag());
    // Windows FlushFileBuffers requires write access; keep the archive intact.
    const handle = await fsp.open(temporary,'r+');try { await handle.sync(); } finally { await handle.close(); }
    await fsp.rename(temporary,destination);
    return {bytes:(await fsp.stat(destination)).size,files:files.length};
  } catch(error) { await fsp.rm(temporary,{force:true});throw error; }
}
class RecordReader {
  constructor(stream) { this.iterator=stream[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);this.done=false; }
  async read(length, allowEnd=false) {
    while(this.buffer.length<length && !this.done) {
      const next=await this.iterator.next();this.done=next.done;
      if(!next.done) this.buffer=Buffer.concat([this.buffer,next.value]);
    }
    if(allowEnd && this.done && this.buffer.length===0) return null;
    if(this.buffer.length<length) throw new Error('备份文件不完整');
    const result=this.buffer.subarray(0,length);this.buffer=this.buffer.subarray(length);return result;
  }
}
async function extractArchive(source,password,destination,onProgress=()=>{}) {
  const stat=await fsp.stat(source);
  if(!stat.isFile() || stat.size<HEADER_BYTES+TAG_BYTES+1 || stat.size>MAX_BYTES+128*1024*1024) throw new Error('备份大小或格式无效');
  const handle=await fsp.open(source,'r');let header,tag;
  try { header=Buffer.alloc(HEADER_BYTES);tag=Buffer.alloc(TAG_BYTES);await handle.read(header,0,header.length,0);await handle.read(tag,0,tag.length,stat.size-TAG_BYTES); } finally { await handle.close(); }
  if(!header.subarray(0,8).equals(MAGIC)) throw new Error('请选择 Star Browser 加密备份文件');
  const key=await keyFor(password,header.subarray(8,24));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,header.subarray(24));key.fill(0);decipher.setAAD(header);decipher.setAuthTag(tag);
  const input=fs.createReadStream(source,{start:HEADER_BYTES,end:stat.size-TAG_BYTES-1}),unzip=zlib.createGunzip();
  // Keep the failure handled while the framed reader consumes the output.
  const transfer=pipeline(input,decipher,unzip);transfer.catch(()=>{});
  const reader=new RecordReader(unzip),seen=new Set();let total=0,count=0,created=false;
  try {
    await fsp.mkdir(destination,{recursive:false,mode:0o700});created=true;
    for(;;) {
      const length=await reader.read(4,true);if(!length)break;
      const size=length.readUInt32BE();if(size<1||size>8192)throw new Error('备份条目格式无效');
      let entry;try { entry=JSON.parse((await reader.read(size)).toString('utf8')); }catch{throw new Error('备份条目格式无效');}
      const relative=safeRelative(entry.path);
      if(seen.has(relative)||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>MAX_BYTES)throw new Error('备份条目无效或重复');
      seen.add(relative);count++;total+=entry.size;
      if(count>MAX_FILES+1||total>MAX_BYTES || relative==='manifest.json' && entry.size>8*1024*1024)throw new Error('备份解压后超过允许范围');
      const target=path.join(destination,...relative.split('/'));
      await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
      const output=await fsp.open(target,'wx',0o600);
      try { let remaining=entry.size;while(remaining){const chunk=await reader.read(Math.min(remaining,65536));let written=0;while(written<chunk.length){const part=await output.write(chunk,written,chunk.length-written);written+=part.bytesWritten;}remaining-=chunk.length;} }
      finally { await output.close(); }
      onProgress({completed:total,files:count});
    }
    await transfer;
    if(!seen.has('manifest.json'))throw new Error('备份缺少环境说明');
    const manifest=JSON.parse(await fsp.readFile(path.join(destination,'manifest.json'),'utf8'));
    return {manifest,paths:[...seen],bytes:total,files:count-1};
  } catch(error) {
    input.destroy();decipher.destroy();unzip.destroy();await transfer.catch(()=>{});
    if(created)await fsp.rm(destination,{recursive:true,force:true});
    if(/authenticate|bad decrypt|incorrect header|invalid distance|unexpected end/i.test(error.message))throw new Error('密码错误或备份文件已损坏');
    throw error;
  }
}
module.exports={writeArchive,extractArchive,collectFiles,safeRelative,checkPassword,MAX_BYTES,MAX_FILES};
