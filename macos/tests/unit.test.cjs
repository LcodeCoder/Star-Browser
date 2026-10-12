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

test('复制环境生成新种子，不复制会话和浏览数据',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-clone-'));
 try{const store=new Store(dir),original=store.create({name:'Source',tags:['work'],pinned:true});store.sessionTabs(original.id,[{url:'https://example.test/login',title:'Login'}],0);store.recordHistory(original.id,'https://example.test/login','Login');const copy=store.clone(original.id);assert.notEqual(copy.id,original.id);assert.notEqual(copy.seed,original.seed);assert.equal(copy.pinned,false);assert.deepEqual(copy.tags,['work']);assert.equal(copy.sessionTabs,undefined);assert.deepEqual(store.history(copy.id),[]);store.flush();}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('配置导入校验保留受支持字段，阻止 ID 覆盖和不安全起始地址',()=>{
 const {validateProfile,importProfiles}=require('../src/main/profile-validation');
 assert.deepEqual(validateProfile({id:'overwrite',sessionTabs:[{url:'file:///etc/passwd'}],name:' QA ',tags:['a','a','b']}),{name:'QA',tags:['a','b']});
 assert.throws(()=>importProfiles([{name:'Bad',startUrl:'javascript:alert(1)'}]),/第 1 个环境/);
 assert.throws(()=>validateProfile({timezone:'Not/AZone'}),/时区/);assert.throws(()=>validateProfile({fingerprint:{hardwareConcurrency:999}}),/硬件/);
});
test('备份恢复保留损坏文件，恢复后的写入不污染备份',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-recovery-'));
 try{const store=new Store(dir),p=store.create({name:'Original'});store.update(p.id,{name:'Latest'});fs.writeFileSync(store.file,'{corrupt');const recovered=new Store(dir);assert.equal(recovered.get(p.id).name,'Original');recovered.update(p.id,{note:'Recovered'});assert.ok(fs.readdirSync(dir).some(n=>n.includes('.corrupt-')));assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(store.file+'.bak','utf8')));assert.equal(new Store(dir).get(p.id).note,'Recovered');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('每环境历史独立保存，URL 中的账户密码不会写入历史',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-history-'));
 try{const store=new Store(dir),a=store.create({name:'A'}),b=store.create({name:'B'});assert.equal(store.recordHistory(a.id,'https://user:password@example.test/page','Page'),true);store.recordHistory(a.id,'file:///tmp/private','No');store.flush();assert.equal(new Store(dir).history(a.id).length,1);assert.equal(store.history(a.id)[0].url,'https://example.test/page');assert.deepEqual(store.history(b.id),[]);store.clearHistory(a.id);assert.equal(store.history(a.id).length,0);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('标签恢复拒绝任意本地文件，保存新标签页和有效活动序号',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-session-'));
 try{const store=new Store(dir),p=store.create({name:'Tabs'});store.sessionTabs(p.id,[{url:'file:///etc/passwd'},{url:'about:home'},{url:'https://example.test'}],99);assert.deepEqual(p.sessionTabs.map(t=>t.url),['about:home','https://example.test']);assert.equal(p.sessionActive,1);assert.equal(new Store(dir).get(p.id).sessionTabs.length,2);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTTPS、IPv6 和 URL 编码凭据正确解析，未知协议不会静默降级',()=>{
 assert.deepEqual(parseProxyInput('https://name%40company:pa%3Ass@[::1]:8443'),{type:'https',host:'::1',port:'8443',user:'name@company',pass:'pa:ss'});
 assert.equal(buildProxyRules({type:'https',host:'::1',port:8443}),'https://[::1]:8443');
 assert.equal(parseProxyInput('ssh://localhost:22'),null);assert.equal(parseProxyInput('localhost:65536'),null);assert.equal(parseProxyInput('http://user:%GG@localhost:80'),null);assert.equal(parseProxyInput('localhost:8080:user:pa:ss').pass,'pa:ss');
});
