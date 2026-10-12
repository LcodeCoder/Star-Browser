'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {Store}=require('../src/main/store');
const {generateFingerprint,resolveGeo}=require('../src/main/fingerprint');
const {parseProxyInput,buildProxyRules}=require('../src/main/proxy-parse');
const {connectSocks5,needsGateway}=require('../src/main/local-proxy');
const {startSocks,startOrigin}=require('./fixtures.cjs');

test('环境增删改与重启持久化，包含手动语言和时区',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'changyi-store-'));
  try{
    const store=new Store(dir);
    const profile=store.create({name:'macOS QA',os:'mac',country:'JP',language:'ja-JP',langManual:true,timezone:'Asia/Tokyo',timezoneManual:true,tags:['qa']});
    assert.equal(profile.language,'ja-JP');
    assert.equal(profile.seed,profile.id);
    store.update(profile.id,{name:'Updated',note:'保存测试'});
    const reopened=new Store(dir);
    assert.equal(reopened.get(profile.id).name,'Updated');
    assert.equal(reopened.get(profile.id).timezone,'Asia/Tokyo');
    assert.deepEqual(reopened.get(profile.id).tags,['qa']);
    assert.equal(reopened.remove(profile.id),true);
    assert.equal(new Store(dir).list().length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('云书签更新保留用户收藏，访问记录跨重启保存',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'changyi-bookmarks-'));
  try{
    const store=new Store(dir);
    const own=store.addBookmark({title:'QA',url:'https://example.test/own'});
    store.mergeCloudBookmarks([{id:'official',title:'官方',url:'https://example.test/cloud'}]);
    assert.equal(store.listBookmarks().length,2);
    assert.ok(store.listBookmarks().some(b=>b.id===own.id));
    store.recordVisit('https://example.test/item?a=1','Item');
    store.recordVisit('https://example.test/item?a=2','Item');
    store.flush();assert.equal(new Store(dir).topVisits(1)[0].count,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

for(const system of ['win','mac','android'])test(`${system} 指纹可重复生成，环境种子保持独立`,()=>{
  const opts={os:system,country:'JP',language:'ja-JP',timezone:'Asia/Tokyo'};
  const fp=generateFingerprint('qa-stable',opts);
  assert.deepEqual(generateFingerprint('qa-stable',opts),fp);
  assert.notEqual(generateFingerprint('qa-other',opts).canvasNoise,fp.canvasNoise);
  assert.equal(fp.timezone,'Asia/Tokyo');assert.equal(fp.language,'ja-JP');
  assert.equal(fp.platform,{win:'Win32',mac:'MacIntel',android:'Linux armv8l'}[system]);
  assert.ok(fp.fonts.length>0);assert.ok(fp.screen.width>0);
});

test('HTTP / SOCKS5 代理文本解析和鉴权规则',()=>{
  assert.deepEqual(parseProxyInput('socks5://qa:pw@127.0.0.1:1080'),{type:'socks5',host:'127.0.0.1',port:'1080',user:'qa',pass:'pw'});
  assert.equal(parseProxyInput('http://127.0.0.1:8080:qa:pw').user,'qa');
  assert.equal(buildProxyRules({type:'http',host:'127.0.0.1',port:'8080',user:'user@name',pass:'a:b'}),'http://127.0.0.1:8080');
  assert.equal(needsGateway({type:'socks5',host:'localhost',user:'qa'}),true);
  assert.equal(needsGateway({type:'http',host:'localhost',user:'qa'}),false);
});

test('带鉴权 SOCKS5 分片握手不会把协议尾部混入网页响应',{timeout:5000},async()=>{
  const origin=await startOrigin(),socks=await startSocks({fragmentReply:true});
  let socket;
  try{
    socket=await connectSocks5({host:'127.0.0.1',port:socks.port,user:'qa-user',pass:'qa-pass'},'127.0.0.1',origin.port);
    socket.setTimeout(2500,()=>socket.destroy(new Error('SOCKS5 tunnel did not finish')));
    const result=await new Promise((resolve,reject)=>{
      let data='';socket.on('data',chunk=>{data+=chunk.toString();});socket.once('end',()=>resolve(data));socket.once('error',reject);
      socket.write(`GET /status HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\nConnection: close\r\n\r\n`);
    });
    assert.ok(result.startsWith('HTTP/1.1 201'),JSON.stringify(result.slice(0,60)));
    assert.deepEqual(socks.authentications,[{user:'qa-user',pass:'qa-pass'}]);
  }finally{if(socket)socket.destroy();await socks.close();await origin.close();}
});

test('SOCKS5 错误密码返回鉴权失败',{timeout:5000},async()=>{
  const socks=await startSocks();
  try{await assert.rejects(connectSocks5({host:'127.0.0.1',port:socks.port,user:'qa-user',pass:'bad'},'127.0.0.1',80),/鉴权失败/);}
  finally{await socks.close();}
});
