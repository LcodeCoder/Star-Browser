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
  assert.ok(fp.nativeSignals.includes('fonts'));assert.ok(fp.screen.width>0);if(system==='mac')assert.match(fp.webgl.renderer,/Metal/);
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


test('一万环境批量持久化只提交一次，失败恢复索引与完整原数据',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-batch-'));
 try{
  const store=new Store(dir),revision=store.revision();
  const created=store.transaction(()=>Array.from({length:10000},(_,i)=>store.create({name:'Scale '+i,tags:['qa']})));
  assert.equal(store.revision(),revision+1);assert.equal(new Store(dir).list().length,10000);
  const original=fs.readFileSync(store.file,'utf8'),failedRevision=store.revision();
  assert.throws(()=>store.transaction(()=>{store.update(created[0].id,{name:'Should roll back'});store.remove(created[1].id);store.create({name:'Temporary'});store.create({timezone:'Invalid/Zone'});}),/时区/);
  assert.equal(store.revision(),failedRevision);assert.equal(fs.readFileSync(store.file,'utf8'),original);assert.equal(store.get(created[0].id).name,'Scale 0');assert.ok(store.get(created[1].id));assert.equal(store.list().length,10000);
  store.update(created[0].id,{note:'After rollback'});assert.equal(new Store(dir).get(created[0].id).note,'After rollback');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('批量提交遇到磁盘失败不会污染已保存数据',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-disk-failure-'));
 try{
  const store=new Store(dir),p=store.create({name:'Safe'}),before=fs.readFileSync(store.file,'utf8');
  const rename=t.mock.method(fs,'renameSync',()=>{throw new Error('QA disk full');});
  assert.throws(()=>store.transaction(()=>store.update(p.id,{name:'Unsaved'})),/disk full/);
  rename.mock.restore();assert.equal(store.get(p.id).name,'Safe');assert.equal(fs.readFileSync(store.file,'utf8'),before);
  store.update(p.id,{note:'Still usable'});assert.equal(new Store(dir).get(p.id).note,'Still usable');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('重启将未完成下载标记中断，已完成文件记录保持原状态',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-download-state-'));
 try{const store=new Store(dir);store.saveDownload({id:'active',state:'progressing',received:10});store.saveDownload({id:'paused',state:'paused',received:20});store.saveDownload({id:'done',state:'completed',path:'/tmp/qa'});const reopened=new Store(dir);assert.deepEqual(reopened.downloads().map(d=>[d.id,d.state]),[['done','completed'],['paused','interrupted'],['active','interrupted']]);assert.equal(new Store(dir).downloads().find(d=>d.id==='active').state,'interrupted');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('扩展导入保存自有副本，缺清单或符号链接失败不会留下记录',async()=>{
 const {ExtensionLibrary}=require('../src/main/extensions');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-extension-files-'));
 try{
  const source=path.join(dir,'source');fs.mkdirSync(source);const store=new Store(path.join(dir,'data')),library=new ExtensionLibrary(dir,store);
  await assert.rejects(library.import(source),/manifest.json/);assert.equal(library.list().length,0);
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({manifest_version:3,name:'QA',version:'1.0.0'}));fs.writeFileSync(path.join(source,'content.js'),'/* QA */');
  fs.symlinkSync('/etc/passwd',path.join(source,'linked'));await assert.rejects(library.import(source),/符号链接/);assert.equal(library.list().length,0);fs.unlinkSync(path.join(source,'linked'));
  const record=await library.import(source);fs.rmSync(source,{recursive:true});assert.equal(fs.readFileSync(path.join(library.directory(record.id),'content.js'),'utf8'),'/* QA */');
  const p=store.create({name:'Extension profile',extensions:[record.id]});assert.equal(library.resolve(p).length,1);await library.remove(record.id);assert.deepEqual(store.get(p.id).extensions,[]);assert.equal(fs.existsSync(library.directory(record.id)),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('加密备份流式往返、文件权限、错误密码和篡改清理',async()=>{
 const {writeArchive,extractArchive,collectFiles}=require('../src/main/encrypted-archive');
 const crypto=require('node:crypto'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-archive-'));
 try{
  const source=path.join(dir,'source');fs.mkdirSync(source);const bytes=crypto.randomBytes(2*1024*1024);fs.writeFileSync(path.join(source,'data.bin'),bytes);
  const archive=path.join(dir,'data.starbackup'),manifest={kind:'test',secret:'metadata-secret'};
  await writeArchive(archive,'test-password',manifest,await collectFiles(source,'profile'));
  if(process.platform!=='win32')assert.equal(fs.statSync(archive).mode&0o777,0o600);assert.equal(fs.readFileSync(archive).includes(Buffer.from('metadata-secret')),false);
  const restored=await extractArchive(archive,'test-password',path.join(dir,'restored'));assert.deepEqual(restored.manifest,manifest);assert.deepEqual(fs.readFileSync(path.join(dir,'restored/profile/data.bin')),bytes);
  const wrong=path.join(dir,'wrong');await assert.rejects(extractArchive(archive,'wrong-password',wrong));assert.equal(fs.existsSync(wrong),false);
  const corrupted=fs.readFileSync(archive);corrupted[corrupted.length-1]^=1;fs.writeFileSync(path.join(dir,'corrupt.starbackup'),corrupted);
  const bad=path.join(dir,'bad');await assert.rejects(extractArchive(path.join(dir,'corrupt.starbackup'),'test-password',bad),/损坏/);assert.equal(fs.existsSync(bad),false);
  const preserved=path.join(dir,'preserved');fs.mkdirSync(preserved);fs.writeFileSync(path.join(preserved,'important'),'keep');await assert.rejects(extractArchive(archive,'test-password',preserved));assert.equal(fs.readFileSync(path.join(preserved,'important'),'utf8'),'keep');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('备份拒绝经过认证的路径越界、重复文件和超限帧，不跟随符号链接',async()=>{
 const crypto=require('node:crypto'),zlib=require('node:zlib'),{extractArchive,collectFiles}=require('../src/main/encrypted-archive');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-archive-guard-'));
 function frame(p,size,content=Buffer.alloc(0)){const json=Buffer.from(JSON.stringify({path:p,size})),length=Buffer.alloc(4);length.writeUInt32BE(json.length);return Buffer.concat([length,json,content]);}
 function archive(records,file){const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),header=Buffer.concat([Buffer.from('STARBAK1'),salt,iv]),key=crypto.scryptSync('test-password',salt,32,{N:65536,r:8,p:1,maxmem:128*1024*1024}),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);fs.writeFileSync(file,Buffer.concat([header,cipher.update(zlib.gzipSync(records)),cipher.final(),cipher.getAuthTag()]));}
 try{
  for(const [name,records]of [['traversal',frame('../outside',0)],['absolute',frame('/tmp/outside',0)],['duplicate',Buffer.concat([frame('manifest.json',2,Buffer.from('{}')),frame('manifest.json',0)])],['limit',frame('large',2*1024**3+1)]]){const file=path.join(dir,name+'.starbackup');archive(records,file);await assert.rejects(extractArchive(file,'test-password',path.join(dir,name)));assert.equal(fs.existsSync(path.join(dir,name)),false);}
  const source=path.join(dir,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(dir,'private'),'private');fs.symlinkSync(path.join(dir,'private'),path.join(source,'link'));assert.deepEqual(await collectFiles(source,'profile'),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('备份准备期间遇到任务或启动冲突，已取得的环境锁完整释放',async()=>{
 const {ProfileBackups,lockProfile,unlockProfile,assertProfileUnlocked}=require('../src/main/profile-backups');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-backup-lock-'));
 let b;
 try{
  const store=new Store(dir),a=store.create({name:'A'});b=store.create({name:'B'});
  const runtime=[];const backups=new ProfileBackups({app:{getPath:()=>dir},session:{},store,extensions:{},runtime:()=>runtime});await backups.ready;
  let ready;backups.ready=new Promise(resolve=>{ready=resolve;});const pending=backups.export(path.join(dir,'never.starbackup'),'test-lock-password',[a.id,b.id]);lockProfile(b.id,'other','正在执行任务');ready();await assert.rejects(pending,/执行任务/);assert.doesNotThrow(()=>assertProfileUnlocked(a.id));assert.throws(()=>assertProfileUnlocked(b.id),/执行任务/);unlockProfile(b.id,'other');
  backups.ready=new Promise(resolve=>{ready=resolve;});const started=backups.export(path.join(dir,'never.starbackup'),'test-lock-password',[a.id]);runtime.push({id:a.id});ready();await assert.rejects(started,/停止所选环境/);assert.doesNotThrow(()=>assertProfileUnlocked(a.id));assert.equal(fs.existsSync(path.join(dir,'never.starbackup')),false);
 }finally{if(b)unlockProfile(b.id,'other');fs.rmSync(dir,{recursive:true,force:true});}
});

test('执行记录达到保留上限时，活动任务仍能更新且重启保留',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-task-retention-'));
 try{
  const store=new Store(dir);store.saveTaskRun({id:'active',state:'running',createdAt:1,step:1});
  store.transaction(()=>{for(let index=0;index<250;index++)store.saveTaskRun({id:'finished-'+index,state:'completed',createdAt:index+2});});
  assert.equal(store.taskRuns().length,200);assert.ok(store.taskRuns().some(run=>run.id==='active'));store.saveTaskRun({id:'active',state:'running',createdAt:1,step:2});assert.equal(new Store(dir).taskRuns().find(run=>run.id==='active').step,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('指纹策略、屏幕校验与导入保持明确设置，原生信号不填入虚构数据',()=>{
 const {validateProfile,importProfiles}=require('../src/main/profile-validation');
 const input={name:'配置',os:'mac',fingerprint:{screen:{width:1600,height:900},devicePixelRatio:1.5,noise:{canvas:false,audio:true,webgl:false,clientRects:false}}};
 const saved=validateProfile(input,true);assert.deepEqual(importProfiles([input])[0].fingerprint,saved.fingerprint);assert.throws(()=>validateProfile({fingerprint:{screen:{width:1600}}}),/屏幕/);assert.throws(()=>validateProfile({fingerprint:{noise:{canvas:'false'}}}),/策略/);
 const fp=generateFingerprint('settings-consistency',saved);assert.equal(fp.noise.canvas,false);assert.equal(fp.noise.audio,true);assert.equal(fp.screen.width,1600);for(const key of ['audioSampleRate','fonts','mediaDevices','speechVoices','plugins'])assert.equal(fp[key],undefined);
});


test('标签会话保留固定、静音和休眠，旧数据仍可读取且配置复制不带会话',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-tab-metadata-'));
 try{const store=new Store(dir),profile=store.create({name:'Tab metadata'});store.sessionTabs(profile.id,[{url:'https://example.test/one',title:'One',pinned:true,muted:true,sleeping:true},{url:'about:home',title:'Home'}],1);const restored=new Store(dir).get(profile.id);assert.deepEqual(restored.sessionTabs[0],{url:'https://example.test/one',title:'One',pinned:true,muted:true,sleeping:true});assert.equal(restored.sessionTabs[1].pinned,false);assert.equal(restored.sessionActive,1);assert.equal(store.clone(profile.id).sessionTabs,undefined);store.flush();}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('任务文件格式与字段限制明确拒绝，保留文本且剥离身份及执行数据',()=>{
 const {parseDocument}=require('../src/main/task-transfer');
 const doc={format:'star-browser-tasks',version:1,tasks:[{id:'old',name:'任务定义',description:'复用',profileId:'never-import',runs:[{state:'running'}],steps:[{type:'fill',selector:'#text',text:'完整保留的私有文字',unknown:'drop'}]}]};
 const [task]=parseDocument(doc);assert.equal(task.steps[0].text,'完整保留的私有文字');assert.equal(task.id,undefined);assert.equal(task.profileId,undefined);assert.equal(task.runs,undefined);assert.equal(task.steps[0].unknown,undefined);
 assert.throws(()=>parseDocument({...doc,version:2}),/格式版本/);assert.throws(()=>parseDocument({...doc,tasks:Array(101).fill(doc.tasks[0])}),/1–100/);assert.throws(()=>parseDocument({...doc,tasks:[{...doc.tasks[0],steps:[{type:'fill',selector:'#text',text:'x'.repeat(100001)}]}]}),/100000/);
});

test('任务导入令牌绑定窗口且限时，一百任务只提交一次，磁盘失败可重试',(t)=>{
 const {TaskTransfers}=require('../src/main/task-transfer'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-task-token-'));let transfer;
 try{
  const store=new Store(dir);let clock=1000;transfer=new TaskTransfers(store,{now:()=>clock});const payload=Array.from({length:100},(_,i)=>({name:'导入 '+i,description:'',steps:[{type:'wait',duration:100}]}));transfer.pending.set('preview',{tasks:payload,time:clock,owner:42});
  const before=fs.readFileSync(store.file,'utf8'),revision=store.revision();assert.throws(()=>transfer.apply('preview',7),/预览已过期/);assert.equal(transfer.pending.has('preview'),true);assert.equal(store.tasks().length,0);
  const rename=t.mock.method(fs,'renameSync',()=>{throw new Error('QA disk full');});assert.throws(()=>transfer.apply('preview',42),/disk full/);rename.mock.restore();assert.equal(store.tasks().length,0);assert.equal(store.revision(),revision);assert.equal(fs.readFileSync(store.file,'utf8'),before);assert.equal(transfer.pending.has('preview'),true);
  const result=transfer.apply('preview',42);assert.equal(result.count,100);assert.equal(new Set(result.ids).size,100);assert.equal(store.revision(),revision+1);assert.equal(new Store(dir).tasks().length,100);assert.equal(store.taskRuns().length,0);assert.throws(()=>transfer.apply('preview',42),/预览已过期/);
  transfer.pending.set('expired',{tasks:payload,time:clock,owner:42});clock+=10*60*1000;assert.throws(()=>transfer.apply('expired',42),/预览已过期/);assert.equal(transfer.pending.size,0);
 }finally{transfer?.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('任务文件写入限制权限，替换失败保留旧文件并清理临时内容',async(t)=>{
 const {TaskTransfers}=require('../src/main/task-transfer'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-task-files-'));let transfer;
 try{
  const store=new Store(path.join(dir,'data')),task={id:'export-test',name:'可备份任务',description:'',steps:[{type:'fill',selector:'#text',text:'private-file-content'}]};store.saveTask(task);transfer=new TaskTransfers(store);const document=transfer.document([task.id]),file=path.join(dir,'tasks.json');fs.writeFileSync(file,'old-file',{mode:0o644});
  const rename=t.mock.method(fs.promises,'rename',async()=>{throw new Error('QA rename denied');});await assert.rejects(transfer.write(file,document),/rename denied/);rename.mock.restore();assert.equal(fs.readFileSync(file,'utf8'),'old-file');assert.ok(!fs.readdirSync(dir).some(name=>name.endsWith('.tmp')));
  await transfer.write(file,document);if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);const preview=await transfer.preview(file,12);assert.equal(preview.count,1);assert.ok(!JSON.stringify(preview).includes('private-file-content'));assert.equal(transfer.apply(preview.token,12).count,1);assert.ok(!JSON.stringify(store.activities()).includes('private-file-content'));
 }finally{transfer?.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});


test('默认保留图形音频原生信号，历史指纹不能覆盖实际内核版本',()=>{
 const fp=generateFingerprint('native-defaults',{os:'mac',chromeVersion:'152.0.7977.130',fingerprint:{chromeVersion:'124.0.0.0',userAgent:'old preview'}});
 assert.deepEqual(fp.noise,{canvas:false,audio:false,webgl:false,clientRects:false});
 assert.equal(fp.chromeVersion,'152.0.7977.130');assert.match(fp.userAgent,/Chrome\/152\.0\.0\.0/);
 for(const signal of ['canvas','audio','webgl','clientRects'])assert.ok(fp.nativeSignals.includes(signal));
 const explicit=generateFingerprint('explicit',{os:'mac',fingerprint:{noise:{canvas:true,audio:true,webgl:true}}});
 assert.equal(explicit.noise.canvas,true);assert.equal(explicit.noise.audio,true);assert.equal(explicit.noise.webgl,true);
 assert.ok(!explicit.nativeSignals.includes('webgl'));
});


test('Apple Silicon Client Hints 与宿主架构系统版本一致',()=>{
 const {metadata}=require('../src/main/fingerprint-protocol');const fp=generateFingerprint('metadata',{os:'mac',chromeVersion:'152.0.7977.130'});
 const hints=metadata(fp,{platform:'darwin',arch:'arm64',systemVersion:'26.1'});
 assert.equal(hints.architecture,'arm');assert.equal(hints.platformVersion,'26.1.0');assert.equal(hints.fullVersion,fp.chromeVersion);
 assert.equal(metadata(fp,{platform:'darwin',arch:'x64',systemVersion:'14.6.1'}).architecture,'x86');
 const windows=metadata({...fp,os:'win'},{platform:'darwin',arch:'arm64',systemVersion:'26.1'});assert.equal(windows.architecture,'x86');assert.equal(windows.platformVersion,'10.0.0');
});

test('Windows x64/ARM64 Client Hints 使用原生系统数据，跨系统模拟保留独立值',()=>{
 const {metadata}=require('../src/main/fingerprint-protocol');const fp=generateFingerprint('windows-native',{os:'win',chromeVersion:'152.0.7977.130'});
 for(const [arch,architecture] of [['x64','x86'],['arm64','arm']]){
  const result=metadata(fp,{platform:'win32',arch,hints:{platformVersion:'19.0.0',architecture,bitness:'64',wow64:false}});
  assert.equal(result.platform,'Windows');assert.equal(result.platformVersion,'19.0.0');assert.equal(result.architecture,architecture);assert.equal(result.bitness,'64');
 }
 const simulated=metadata({...fp,os:'mac'},{platform:'win32',arch:'arm64',hints:{platformVersion:'19.0.0',architecture:'arm'}});assert.equal(simulated.platform,'macOS');assert.equal(simulated.platformVersion,'14.0.0');assert.equal(simulated.architecture,'x86');
});

test('手动 WebGL 配置必须成对填写，保存并生成真实选定值',()=>{
 const {validateProfile}=require('../src/main/profile-validation');const fingerprint={noise:{webgl:true},webgl:{vendor:'QA vendor',renderer:'QA renderer'}};
 const data=validateProfile({fingerprint});const fp=generateFingerprint('manual-webgl',{os:'win',...data});assert.deepEqual(fp.webgl,fingerprint.webgl);assert.equal(fp.noise.webgl,true);
 assert.throws(()=>validateProfile({fingerprint:{webgl:{vendor:'incomplete'}}}),/同时填写/);
});

test('Client Hints 高熵头只在安全源声明后发送，按源隔离并支持撤销',()=>{
 const {createClientHints}=require('../src/main/client-hints-headers'),hints=createClientHints(),fp=generateFingerprint('headers',{os:'mac',chromeVersion:'152.0.7977.130'});
 assert.deepEqual(hints.apply('http://remote.test/',{},fp),{});
 let headers=hints.apply('https://one.test/',{},fp);assert.equal(headers['sec-ch-ua-platform'],'"macOS"');assert.ok(!headers['sec-ch-ua-arch']);
 hints.receive('https://one.test/',{'Accept-CH':['Sec-CH-UA-Arch, Sec-CH-UA-Full-Version-List']});headers=hints.apply('https://one.test/path',{},fp);assert.ok(headers['sec-ch-ua-arch']);assert.match(headers['sec-ch-ua-full-version-list'],/152\.0\.7977\.130/);assert.ok(!hints.apply('https://two.test/',{},fp)['sec-ch-ua-arch']);
 hints.receive('https://one.test/',{'accept-ch':['']});assert.ok(!hints.apply('https://one.test/',{},fp)['sec-ch-ua-arch']);
});

test('批量检测逐条进度、受限并发与按输入顺序返回',async()=>{
 const {ProxyBatchRunner}=require('../src/main/proxy-batch');let active=0,max=0;const progress=[];
 const batch=new ProxyBatchRunner(async raw=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,raw==='first'?25:2));active--;return {raw,ok:true};},{concurrency:2});
 const response=await batch.run(1,['first','second','third'],'ordered',event=>progress.push(event));
 assert.equal(max,2);assert.deepEqual(response.results.map(row=>row.raw),['first','second','third']);assert.equal(response.completed,3);assert.equal(progress.filter(row=>row.result).length,3);assert.equal(progress.at(-1).done,true);assert.equal(batch.jobs.size,0);
});

test('取消只作用于发起窗口与当前请求，保留已完成结果并停止排队',async()=>{
 const {ProxyBatchRunner}=require('../src/main/proxy-batch');const issued=[];let release;
 const batch=new ProxyBatchRunner(async raw=>{issued.push(raw);if(raw==='slow')await new Promise(resolve=>release=resolve);return {raw,ok:true};},{concurrency:1});
 const job=batch.run(7,['slow','queued'],'owner');await assert.rejects(batch.run(7,['other'],'another'),/已有检测/);
 assert.equal(batch.cancel(8,'owner').ok,false);assert.equal(batch.cancel(7,'previous').ok,false);assert.equal(batch.cancel(7,'owner').ok,true);release();
 const result=await job;assert.equal(result.cancelled,true);assert.deepEqual(issued,['slow']);assert.equal(result.completed,1);assert.equal(batch.jobs.size,0);
});

test('检测输入受限，窗口关闭停止后续工作，失败不会中断其他条目',async()=>{
 const {ProxyBatchRunner}=require('../src/main/proxy-batch');const runner=new ProxyBatchRunner(async raw=>{if(raw==='bad')throw new Error('实际失败');return {raw,ok:true};},{concurrency:1});
 for(const input of [[],new Array(501).fill('a'),[''],[{}],['x'.repeat(2049)]])await assert.rejects(runner.run(2,input,'input'));
 const result=await runner.run(2,['bad','good'],'recovery');assert.equal(result.results[0].error,'实际失败');assert.equal(result.results[1].ok,true);
 let release;const closed=new ProxyBatchRunner(async raw=>{await new Promise(resolve=>release=resolve);return {raw,ok:true};},{concurrency:1});const job=closed.run(3,['one','two'],'close');closed.close(3);release();assert.equal((await job).completed,1);
});

test('网页诊断呈现默认区域语言差异与可执行建议',()=>{
 const {report}=require('../src/main/fingerprint-audit');const fp=generateFingerprint('locale-report',{language:'ja-JP',timezone:'Asia/Tokyo'});
 const observed={page:{ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,locale:'zh-CN',numberLocale:'ja-JP',cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,tz:fp.timezone,screen:fp.screen.width+' × '+fp.screen.height,dpr:fp.devicePixelRatio,screenMedia:true,dprMedia:true,gpu:'native'},worker:{error:'后台读取受限'},webgpu:{available:false}};
 const result=report(fp,observed,{engine:'test',url:'https://example.test/'});assert.equal(result.differences,1);assert.ok(result.advice.some(row=>row.title==='语言读数不一致'));assert.equal(result.rows.find(row=>row.label==='默认日期语言').actual,'zh-CN');
});


test('地域查询按自身期限中止无响应连接，不依赖 ClientRequest.setTimeout', async () => {
  const {EventEmitter} = require('node:events');
  const {requestGeoJSON} = require('../src/main/geo-network');
  let aborted = 0;
  const request = new EventEmitter(); request.end = () => {}; request.abort = () => {aborted++;};
  const started = Date.now();
  const result = await requestGeoJSON(() => request, 'https://geo.invalid', {timeoutMs:30});
  assert.match(result.error, /超时/); assert.equal(aborted, 1); assert.ok(Date.now()-started < 1000);
});

test('地域查询拒绝 HTTP 错误、无效 JSON 与超大响应，并保留正常对象', async () => {
  const {EventEmitter} = require('node:events');
  const {requestGeoJSON} = require('../src/main/geo-network');
  function provider(statusCode, body) {
    return () => {
      const request = new EventEmitter(); request.abort = () => {};
      request.end = () => queueMicrotask(() => {const response = new EventEmitter(); response.statusCode = statusCode; request.emit('response', response); response.emit('data', Buffer.from(body)); response.emit('end');});
      return request;
    };
  }
  assert.match((await requestGeoJSON(provider(429, '{}'),'https://geo.invalid')).error,/429/);
  assert.match((await requestGeoJSON(provider(200, '<html>error</html>'),'https://geo.invalid')).error,/JSON/);
  assert.match((await requestGeoJSON(provider(200, '123456789'),'https://geo.invalid',{maxBytes:4})).error,/过大/);
  assert.deepEqual(await requestGeoJSON(provider(200, '{"ip":"8.8.8.8","timezone":"Asia/Tokyo"}'),'https://geo.invalid'),{ip:'8.8.8.8',timezone:'Asia/Tokyo'});
});


test('HTTP 语言列表保留完整偏好顺序，单语言不生成重复项',()=>{
 const {languages,acceptLanguage}=require('../src/main/language-settings');
 assert.equal(acceptLanguage({languages:['zh-CN','en-US']}),'zh-CN,en-US;q=0.9');
 assert.equal(acceptLanguage({language:'en-US'}),'en-US');
 assert.deepEqual(languages({languages:['fr-FR','en-US','fr-FR']}),['fr-FR','en-US']);
});


test('当前文档未完成或检查期间导航时拒绝返回过期报告',async()=>{
 const {auditElectron}=require('../src/main/fingerprint-audit');
 const fp=generateFingerprint('audit-readiness',{os:'mac',country:'US'});
 const wc={__tfbFingerprint:fp,getURL:()=> 'https://example.test/',debugger:{sendCommand:async()=>({result:{value:'loading'}})}};
 await assert.rejects(auditElectron(wc),/仍在加载/);
 let reads=0;wc.debugger.sendCommand=async()=> ++reads===1?{result:{value:'complete'}}:{result:{value:{}}};
 wc.isDestroyed=()=>false;wc.getURL=()=>reads<2?'https://example.test/':'https://another.test/';
 await assert.rejects(auditElectron(wc),/检查期间跳转/);
});

test('后台协议错误必须报告，页面与 Worker 的重复区域覆盖只接受相同语言',async()=>{
 const {applyProtocol}=require('../src/main/fingerprint-protocol');const fp=generateFingerprint('strict-protocol',{language:'fr-FR',timezone:'Europe/Paris'});
 const send=async method=>{if(method==='Emulation.setLocaleOverride')throw new Error('Another locale override is already in effect');if(method==='Runtime.evaluate')return {result:{value:'fr-FR'}};return {};};
 await applyProtocol(send,fp,{metrics:false,worker:true});
 await assert.rejects(applyProtocol(async(method,params)=>method==='Runtime.evaluate'?{result:{value:'zh-CN'}}:send(method,params),fp,{metrics:false,worker:true}),/语言配置冲突/);
 await assert.rejects(applyProtocol(async method=>{if(method==='Emulation.setHardwareConcurrencyOverride')throw new Error('hardware unavailable');return {};},fp,{metrics:false,worker:true}),/hardware unavailable/);
});

test('Worker 重复配置保留首次原生 UA 验证，避免把旧 JS 覆盖误认为原生支持',async()=>{
 const {configureTarget}=require('../src/main/fingerprint-targets');const fp=generateFingerprint('worker-native-state',{language:'fr-FR'});let releases=0,reads=0,source='';
 const send=async(method,params)=>{if(method==='Runtime.runIfWaitingForDebugger')releases++;if(method==='Runtime.evaluate'){if(params.expression.startsWith('({ua:')){reads++;return {result:{value:{ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages}}};}source=params.expression;return {result:{value:true}};}return {};};
 const result=await configureTarget(send,fp,'shared_worker','',{protocolManaged:false});assert.equal(result.protocolManaged,false);assert.equal(reads,0);assert.equal(releases,1);assert.ok(source.includes('"protocolManaged":false'));
 await assert.rejects(configureTarget(async(method,params)=>{if(method==='Emulation.setTimezoneOverride')throw new Error('invalid timezone');return send(method,params);},fp,'service_worker',''),/invalid timezone/);assert.equal(releases,2);
});

test('报告列出 Worker 配置差异、框架像素比限制，读取失败和未运行不记作通过',()=>{
 const {report}=require('../src/main/fingerprint-audit');const fp=generateFingerprint('context-report',{language:'fr-FR',timezone:'Europe/Paris'});
 const value={ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,locale:fp.language,numberLocale:fp.language,cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,tz:fp.timezone};
 const page={...value,screen:fp.screen.width+' × '+fp.screen.height,dpr:1.5,screenMedia:true,dprMedia:true,gpu:'native'};
 const observed={page,worker:value,webgpu:{available:false},contexts:[{type:'shared_worker',url:'https://example.test/shared.js',value:{...value,memory:16}},{type:'service_worker',url:'https://example.test/service.js',error:'actual timeout'},{type:'iframe',url:'https://frame.test/frame',value:{...page,dpr:1,dprMedia:false}}]};
 const result=report({...fp,devicePixelRatio:1.5},observed,{engine:'test',url:'https://example.test/?private'});
 assert.ok(result.rows.some(row=>row.context==='Shared Worker 1'&&row.label==='设备内存'&&row.state==='different'));
 assert.ok(result.rows.some(row=>row.context==='iframe 1'&&row.label==='像素比（含缩放）'&&row.state==='different'));assert.ok(result.unknown>0);
 assert.ok(result.advice.some(item=>item.title==='跨进程框架像素比未对齐'));assert.equal(result.contexts.find(item=>item.type==='service_worker').status,'unread');
 const empty=report(fp,{page:{...page,dpr:fp.devicePixelRatio},worker:value,webgpu:{available:false},contexts:[]},{engine:'test',url:'https://example.test/'});assert.equal(empty.contexts.find(item=>item.type==='service_worker').status,'not-running');
});


test('报告分别说明 CSS 屏幕尺寸与 DPR，原生缩放匹配不误报像素比短板',()=>{
 const {report}=require('../src/main/fingerprint-audit');const fp=generateFingerprint('screen-css-report',{os:'mac'});
 const value={ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,locale:fp.language,numberLocale:fp.language,cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,tz:fp.timezone};
 const page={...value,screen:fp.screen.width+' × '+fp.screen.height,dpr:fp.devicePixelRatio,screenMedia:true,dprMedia:true,gpu:'native'};
 const observed={page,worker:value,webgpu:{available:false},contexts:[{type:'iframe',url:'https://frame.test/',value:{...page,screenMedia:false}}]};
 const result=report(fp,observed,{engine:'本机 Chrome',url:'https://example.test/'});
 assert.equal(result.differences,1);assert.ok(result.advice.some(row=>row.title==='CSS 屏幕尺寸未对齐'));assert.ok(!result.advice.some(row=>row.title==='跨进程框架像素比未对齐'));
 const main=report(fp,{...observed,page:{...page,screenMedia:false},contexts:[]},{engine:'test',url:'https://example.test/'});assert.ok(main.advice.some(row=>row.title==='CSS 屏幕尺寸未对齐'));
 const aligned=report(fp,{...observed,contexts:[{...observed.contexts[0],value:page}]},{engine:'test',url:'https://example.test/'});assert.ok(!aligned.advice.some(row=>row.title.includes('屏幕尺寸未对齐')));
});


test('环境校验规范化地区语言并提供可定位错误，不静默丢弃半填代理',()=>{
 const {validateProfile,validateProxy,ProfileValidationError}=require('../src/main/profile-validation');
 const saved=validateProfile({name:' QA ',country:' jp ',language:'EN-us',startUrl:'HTTPS://example.com/',proxy:{type:'https',host:'proxy.example',port:'8443',user:'qa@star',pass:'p:a$$'}});
 assert.equal(saved.country,'JP');assert.equal(saved.language,'en-US');assert.equal(saved.proxy.pass,'p:a$$');
 assert.equal(validateProxy({type:'http',host:'',port:'',user:'',pass:''}),null);
 const failures=[
  [{country:'USA'},'country'],[{language:'not_a_locale'},'language'],
  [{proxy:{host:'',port:'8080'}},'proxy.host'],[{proxy:{host:'',pass:'secret'}},'proxy.host'],
  [{proxy:{host:'proxy.example',port:'70000'}},'proxy.port'],[{proxy:'http://proxy.example:8080'},'proxy.host'],
  [{fingerprint:{screen:{width:1600}}},'fingerprint.screen.height'],[{fingerprint:{screen:{height:900}}},'fingerprint.screen.width'],
  [{fingerprint:{webgl:{vendor:'QA'}}},'fingerprint.webgl.renderer'],[{startUrl:'file:///tmp/private'},'startUrl']
 ];
 for(const [input,field] of failures)assert.throws(()=>validateProfile(input),error=>error instanceof ProfileValidationError&&error.field===field,JSON.stringify(input));
});


test('内存请求头只修正原生已发送值，保留浏览器声明与权限决定',()=>{
 const {createClientHints}=require('../src/main/client-hints-headers'),hints=createClientHints(),fp=generateFingerprint('memory-headers',{fingerprint:{deviceMemory:2}});
 hints.receive('https://memory.test/',{'Accept-CH':['Device-Memory, Sec-CH-Device-Memory']});
 const none=hints.apply('https://memory.test/',{},fp);assert.ok(!('device-memory' in none));assert.ok(!('sec-ch-device-memory' in none));
 const native=hints.apply('https://memory.test/',{'Device-Memory':'8','sec-ch-device-memory':'8'},fp);
 assert.equal(native['Device-Memory'],'2');assert.equal(native['sec-ch-device-memory'],'2');
 const insecure=hints.apply('http://remote.test/',{'device-memory':'8'},fp);assert.equal(insecure['device-memory'],'8');
});

test('网络观察只保留两类内存头，ExtraInfo 顺序与重定向不会保存凭据或地址参数',()=>{
 const {NetworkFingerprintObserver}=require('../src/main/network-fingerprint-observer');const observer=new NetworkFingerprintObserver();observer.setMainFrame('top');
 observer.record('Network.requestWillBeSentExtraInfo',{requestId:'early',headers:{'Device-Memory':'16',Cookie:'secret-cookie',Authorization:'secret-auth','Proxy-Authorization':'secret-proxy'}});
 observer.record('Network.requestWillBeSent',{requestId:'early',type:'Fetch',request:{url:'https://user:password@one.test/private?q=secret-query',headers:{}}});
 let snapshot=observer.snapshot();assert.equal(snapshot.requests[0].origin,'https://one.test');assert.deepEqual(snapshot.requests[0].headers,{'device-memory':'16'});assert.equal(snapshot.requests[0].source,'extra-info');assert.ok(!JSON.stringify(snapshot).includes('secret'));assert.ok(!JSON.stringify(snapshot).includes('password'));assert.ok(!JSON.stringify(snapshot).includes('/private'));
 observer.record('Network.requestWillBeSent',{requestId:'redirect',type:'Document',frameId:'child',request:{url:'https://two.test/first',headers:{'device-memory':'8'}}});
 observer.record('Network.requestWillBeSent',{requestId:'redirect',redirectResponse:{},redirectHasExtraInfo:false,type:'Document',frameId:'child',request:{url:'https://three.test/final',headers:{}}});
 observer.record('Network.requestWillBeSentExtraInfo',{requestId:'redirect',headers:{'sec-ch-device-memory':'4'}});
 snapshot=observer.snapshot();assert.deepEqual(snapshot.requests.find(row=>row.origin==='https://three.test').headers,{'sec-ch-device-memory':'4'});assert.deepEqual(snapshot.requests.find(row=>row.origin==='https://two.test').headers,{'device-memory':'8'});
});
test('网络观察按顶层导航清理旧证据，数据与未匹配请求有界',()=>{
 const {NetworkFingerprintObserver}=require('../src/main/network-fingerprint-observer');const observer=new NetworkFingerprintObserver({limit:2,pendingLimit:3});observer.setMainFrame('top');
 observer.record('Network.requestWillBeSent',{requestId:'old',type:'Document',frameId:'top',loaderId:'old-loader',request:{url:'https://one.test/old',headers:{'device-memory':'16'}}});
 observer.record('Network.requestWillBeSent',{requestId:'new',type:'Document',frameId:'top',loaderId:'new-loader',request:{url:'https://one.test/new',headers:{}}});
 assert.equal(observer.snapshot().requestsObserved,1);assert.deepEqual(observer.snapshot().requests[0].headers,{});
 for(let i=0;i<10;i++)observer.record('Network.requestWillBeSent',{requestId:'bounded-'+i,type:'Fetch',request:{url:'https://host'+i+'.test/?private',headers:{'device-memory':'4'}}});
 assert.equal(observer.snapshot().requests.length,2);assert.ok(observer.pending.size<=3);const detached=observer.snapshot();detached.requests[0].headers['device-memory']='999';assert.notEqual(observer.snapshot().requests[0].headers['device-memory'],'999');
});
test('网页 JS 一致时仍报告真实内存请求头差异，未发出不会计为通过',()=>{
 const {report}=require('../src/main/fingerprint-audit'),{metadata}=require('../src/main/fingerprint-protocol');const fp=generateFingerprint('network-audit',{os:'mac',fingerprint:{deviceMemory:2}});
 const page={ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,locale:fp.language,numberLocale:fp.language,cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,tz:fp.timezone,uaHints:metadata(fp),screen:fp.screen.width+' × '+fp.screen.height,dpr:fp.devicePixelRatio,screenMedia:true,dprMedia:true,gpu:'native'};
 let value=report(fp,{page,worker:page,network:{status:'observed',requests:[{origin:'https://one.test',headers:{'device-memory':'16','sec-ch-device-memory':'16'}}]}},{engine:'test',url:'https://one.test/'});
 assert.equal(value.rows.filter(row=>row.context==='网络请求头'&&row.state==='different').length,2);assert.ok(value.advice.some(row=>row.title==='内存请求头与页面不同'));
 value=report(fp,{page,worker:page,network:{status:'observed',requests:[{origin:'https://one.test',headers:{}}]}},{engine:'test',url:'https://one.test/'});
 assert.equal(value.rows.find(row=>row.context==='网络请求头').state,'not-observed');assert.ok(value.advice.some(row=>row.title==='内存请求头尚未观测'));
});

test('原生内核验收绑定完整发行包，Framework 改变会使旧报告失效',async()=>{
 const {browserArtifact,validateAcceptance,ABI,HARDWARE_SCOPE,REQUIRED_CHECKS}=require('../src/main/native-kernel');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-native-artifact-'));
 try{
  const root=path.join(dir,'Chromium.app'),executable=path.join(root,'Contents/MacOS/Chromium'),framework=path.join(root,'Contents/Frameworks/ChromiumFramework.framework/Versions/A/ChromiumFramework');
  fs.mkdirSync(path.dirname(executable),{recursive:true});fs.mkdirSync(path.dirname(framework),{recursive:true});fs.writeFileSync(executable,'fixture launcher');fs.writeFileSync(framework,'fixture Blink runtime');
  const artifact=await browserArtifact(executable,'darwin'),commit='a'.repeat(40);
  const report={schemaVersion:1,abi:ABI,status:'hardware-accepted',scope:[...HARDWARE_SCOPE],p0Complete:false,expectedSourceCommit:commit,binary:{platform:'darwin',arch:'arm64',version:'155.0.8059.40',sourceCommit:commit,bundleSha256:artifact.bundleSha256,executableSha256:artifact.executableSha256},checks:REQUIRED_CHECKS.map(id=>({id,status:'passed'}))};
  assert.equal(validateAcceptance(report,artifact,{platform:'darwin',arch:'arm64'}).p0Complete,false);
  fs.writeFileSync(framework,'changed Blink runtime');const changed=await browserArtifact(executable,'darwin');assert.equal(changed.executableSha256,artifact.executableSha256);assert.notEqual(changed.bundleSha256,artifact.bundleSha256);assert.throws(()=>validateAcceptance(report,changed,{platform:'darwin',arch:'arm64'}),/内核包或平台/);
  for(const mutate of [r=>{r.p0Complete=true},r=>{r.checks=[]},r=>{r.checks=[...r.checks,r.checks[0]]},r=>{r.checks[0].status='partial'},r=>{r.binary.sourceCommit='b'.repeat(40)},r=>{r.scope.push('all-fingerprints')}]){const value=structuredClone(report);mutate(value);assert.throws(()=>validateAcceptance(value,artifact,{platform:'darwin',arch:'arm64'}));}
  const outside=path.join(dir,'outside');fs.writeFileSync(outside,'outside runtime');fs.symlinkSync(outside,path.join(root,'external'));await assert.rejects(browserArtifact(executable,'darwin'),/外部符号链接/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('原生策略和路径必须完整，未配置继续使用当前引擎',async()=>{
 const {hardwareArguments,resolveNativeKernel}=require('../src/main/native-kernel');assert.deepEqual(hardwareArguments({hardwareConcurrency:4,deviceMemory:2}),['--star-fingerprint-hardware=4,2']);
 for(const value of [null,{hardwareConcurrency:0,deviceMemory:2},{hardwareConcurrency:4,deviceMemory:999}])assert.throws(()=>hardwareArguments(value),/支持范围/);
 assert.equal(await resolveNativeKernel({}),null);await assert.rejects(resolveNativeKernel({STAR_NATIVE_KERNEL_EXECUTABLE:'/tmp/missing'}),/必须同时设置/);
});


test('代理地址与端口规范化，拒绝带端口地址和模糊数值，IPv6 不丢失', () => {
 const {validateProxy,ProfileValidationError}=require('../src/main/profile-validation');
 for(const host of ['proxy.example:8080','http://proxy.example','proxy.example/path','proxy.example?x','proxy.example#x','proxy.example\\path','proxy%2eexample','[::1]:8080']) assert.throws(()=>validateProxy({host,port:8080}),e=>e instanceof ProfileValidationError&&e.field==='proxy.host',host);
 for(const port of ['0x1f90','8e3','8080.0','+8080','0','65536']) assert.throws(()=>validateProxy({host:'localhost',port}),e=>e.field==='proxy.port',port);
 assert.equal(validateProxy({host:'Proxy.Example',port:'08080'}).host,'proxy.example');
 assert.equal(validateProxy({host:'[2001:0db8::0001]',port:'8080'}).host,'2001:db8::1');
 assert.equal(buildProxyRules(validateProxy({type:'https',host:'::1',port:8443})),'https://[::1]:8443');
 assert.equal(parseProxyInput('localhost:8080','https').type,'https');
 assert.equal(parseProxyInput('https://localhost:8080','socks5').type,'https');
});
test('代理凭据完整保留，按协议检查 UTF-8 字节数，不截断且不写入无效配置', () => {
 const {validateProxy}=require('../src/main/profile-validation');
 const input={type:'http',host:'localhost',port:8080,user:' account ',pass:' '+ '密'.repeat(200)+' '};
 assert.equal(validateProxy(input).user,input.user);assert.equal(validateProxy(input).pass,input.pass);
 assert.throws(()=>validateProxy({...input,type:'socks5'}),e=>e.field==='proxy.pass');
 assert.equal(validateProxy({...input,type:'socks5',user:'密'.repeat(85),pass:'密'.repeat(85)}).pass.length,85);
 assert.throws(()=>validateProxy({...input,type:'socks5',user:'密'.repeat(86),pass:''}),e=>e.field==='proxy.user');
 assert.throws(()=>validateProxy({...input,pass:'x'.repeat(4097)}),e=>e.field==='proxy.pass');
 assert.equal(parseProxyInput('socks5://user:'+encodeURIComponent('密'.repeat(86))+'@localhost:1080'),null);
 assert.throws(()=>validateProxy({host:'',pass:' '}),e=>e.field==='proxy.host');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-invalid-proxy-'));
 try{const store=new Store(dir);const before=store.listProxies().length;assert.throws(()=>store.saveProxy({...input,host:'localhost:8080'}));assert.equal(store.listProxies().length,before);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('任务共享校验定位具体字段，保留文本并拒绝无效滚动和零超时', () => {
 const {validateTask,TaskValidationError}=require('../src/main/task-validation');
 const cases=[[{name:'',steps:[{type:'wait',duration:100}]},'name'],[{name:'QA',steps:[{type:'navigate',url:'https://u:p@example.com'}]},'steps.0.url'],[{name:'QA',steps:[{type:'click',selector:''}]},'steps.0.selector'],[{name:'QA',steps:[{type:'scroll',x:'oops',y:0}]},'steps.0.x'],[{name:'QA',steps:[{type:'navigate',url:'https://example.com',timeout:0}]},'steps.0.timeout'],[{name:'QA',steps:[{type:'fill',selector:'#x',text:'x'.repeat(100001)}]},'steps.0.text']];
 for(const[input,field]of cases)assert.throws(()=>validateTask(input),e=>e instanceof TaskValidationError&&e.field===field,field);
 const data=validateTask({name:' QA ',steps:[{type:'fill',selector:' #input ',text:'  password\n ',timeout:''},{type:'scroll',x:'',y:-25}]});
 assert.equal(data.name,'QA');assert.equal(data.steps[0].text,'  password\n ');assert.equal(data.steps[0].timeout,15000);assert.equal(data.steps[1].x,0);
});

test('启动状态按真实步骤和时间记录，快照不可变且保留活动启动', () => {
 const {LaunchState}=require('../src/main/launch-state');let now=1000,changes=0;
 const state=new LaunchState({clock:()=>now,changed:()=>changes++,limit:2,ttl:100});
 state.begin('browse','a');const initial=state.snapshot()[0];now+=20;state.stage('browse','a','proxy');assert.equal(initial.stage,'checking');
 const proxy=state.snapshot()[0];assert.equal(proxy.startedAt,1000);assert.equal(proxy.updatedAt,1020);proxy.stage='fake';assert.equal(state.snapshot()[0].stage,'proxy');
 now+=30;state.finish('browse','a',new Error('代理鉴权失败'));const failed=state.snapshot()[0];assert.equal(failed.status,'failed');assert.equal(failed.stage,'proxy');assert.equal(failed.durationMs,50);
 state.stage('browse','a','opening');assert.equal(state.snapshot()[0].stage,'proxy');
 state.begin('browse','pending');state.begin('launch','b');state.finish('launch','b');state.begin('launch','c');state.finish('launch','c');assert.equal(state.snapshot().length,2);assert.ok(state.snapshot().some(r=>r.id==='pending'));
 now+=101;assert.equal(state.snapshot().length,1);assert.equal(state.snapshot()[0].status,'starting');assert.equal(changes,8);
 assert.throws(()=>state.stage('browse','pending','pretend'),/Unsupported/);
});
test('浏览器界面握手成功、关闭和超时后清理监听器，不把建窗口当作就绪', async () => {
 const {EventEmitter}=require('node:events');const {waitForBrowseReady}=require('../src/main/launch-readiness');
 const window=()=>{const value=new EventEmitter();value.webContents=new EventEmitter();value.isDestroyed=()=>false;return value;};
 const ready=window();let resolved=false;const promise=waitForBrowseReady(ready,100).then(()=>resolved=true);await Promise.resolve();assert.equal(resolved,false);ready._starBrowseReady=true;ready.emit('star:browse-ready');await promise;assert.equal(ready.listenerCount('closed'),0);assert.equal(ready.webContents.listenerCount('did-fail-load'),0);
 const closed=window();const closePromise=waitForBrowseReady(closed,100);closed.emit('closed');await assert.rejects(closePromise,/准备期间已关闭/);assert.equal(closed.listenerCount('star:browse-ready'),0);
 const timeout=window();await assert.rejects(waitForBrowseReady(timeout,5),/准备超时/);assert.equal(timeout.listenerCount('closed'),0);
 const failed=window();const failPromise=waitForBrowseReady(failed,100);failed.webContents.emit('did-fail-load',{},-3,'aborted','file:fixture',true);assert.equal(failed.listenerCount('closed'),1);failed.webContents.emit('did-fail-load',{},-6,'FILE_NOT_FOUND','file:fixture',true);await assert.rejects(failPromise,/FILE_NOT_FOUND/);assert.equal(failed.listenerCount('closed'),0);
});

test('原生硬件模式不发送 CPU Emulation，也不允许 RAM 不一致时被 JS fallback 掩盖',async()=>{
 const {applyProtocol}=require('../src/main/fingerprint-protocol');const fp={...generateFingerprint('accepted-hardware',{language:'fr-FR',timezone:'Europe/Paris'}),hardwareConcurrency:4,deviceMemory:4,nativeHardware:true};const calls=[];
 const send=async(method,params)=>{calls.push(method);if(method==='Runtime.evaluate')return {result:{value:{cpu:4,memory:4,secure:true}}};return {};};
 await applyProtocol(send,fp,{metrics:false,worker:true});assert.ok(!calls.includes('Emulation.setHardwareConcurrencyOverride'));
 await assert.rejects(applyProtocol(async(method,params)=>method==='Runtime.evaluate'?{result:{value:{cpu:4,memory:16,secure:true}}}:send(method,params),fp,{metrics:false,worker:true}),/原生硬件策略未生效/);
 await assert.rejects(applyProtocol(async(method,params)=>method==='Runtime.evaluate'?{result:{value:{cpu:10,memory:4,secure:false}}}:send(method,params),fp,{metrics:false,worker:true}),/原生硬件策略未生效/);
 await applyProtocol(async(method,params)=>method==='Runtime.evaluate'?{result:{value:{cpu:4,secure:false}}}:send(method,params),fp,{metrics:false,worker:true});
});

test('原生内核拒绝缺失或未验收报告，报告不合格时先拒绝而不读取整个浏览器',async()=>{
 const {resolveNativeKernel}=require('../src/main/native-kernel');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-invalid-kernel-'));
 try{
  const report=path.join(dir,'acceptance.json');fs.writeFileSync(report,JSON.stringify({schemaVersion:1,status:'hardware-rejected'}));
  await assert.rejects(resolveNativeKernel({STAR_NATIVE_KERNEL_EXECUTABLE:'missing-browser'}),/必须同时设置/);
  await assert.rejects(resolveNativeKernel({STAR_NATIVE_KERNEL_EXECUTABLE:'missing-browser',STAR_NATIVE_KERNEL_ACCEPTANCE:path.join(dir,'missing-report')}),/无法读取原生内核验收报告/);
  await assert.rejects(resolveNativeKernel({STAR_NATIVE_KERNEL_EXECUTABLE:'missing-browser',STAR_NATIVE_KERNEL_ACCEPTANCE:report}),/缺少有效的原生硬件验收报告/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('书签校验定位具体字段，拒绝凭据网址且规范化标题和 URL',()=>{
 const {validateBookmark,BookmarkValidationError}=require('../src/main/bookmark-validation');
 assert.deepEqual(validateBookmark({title:'  测试书签  ',url:' HTTPS://EXAMPLE.COM:443/阅读?q=中文 '}),{title:'测试书签',url:'https://example.com/%E9%98%85%E8%AF%BB?q=%E4%B8%AD%E6%96%87'});
 for(const [value,field] of [
  [{title:' ',url:'https://example.com'},'title'],
  [{title:'x'.repeat(513),url:'https://example.com'},'title'],
  [{title:'QA',url:''},'url'],
  [{title:'QA',url:'javascript:alert(1)'},'url'],
  [{title:'QA',url:'https:example.com'},'url'],
  [{title:'QA',url:'https://example.com/line\nnext'},'url'],
  [{title:'QA',url:'https://user:secret@example.com'},'url'],
  [{title:'QA',url:'https://example.com/'+ 'x'.repeat(4096)},'url']
 ])assert.throws(()=>validateBookmark(value),e=>e instanceof BookmarkValidationError&&e.field===field);
});

test('书签部分更新保留旧字段，新增、更新和删除遇到磁盘失败均完整回滚',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-bookmark-failure-'));
 try{
  const store=new Store(dir),saved=store.transaction(()=>store.addBookmark({title:'安全书签',url:'https://example.com/'}));
  store.transaction(()=>store.updateBookmark(saved.id,{title:'更新名称'}));
  assert.equal(new Store(dir).listBookmarks().find(b=>b.id===saved.id).url,saved.url);
  const before=fs.readFileSync(store.file,'utf8'),records=structuredClone(store.listBookmarks()),revision=store.revision();
  const rename=t.mock.method(fs,'renameSync',()=>{throw new Error('disk full');});
  for(const run of [()=>store.addBookmark({title:'新书签',url:'https://example.org/'}),()=>store.updateBookmark(saved.id,{url:'https://example.org/changed'}),()=>store.removeBookmark(saved.id)]){
   assert.throws(()=>store.transaction(run),/disk full/);
   assert.deepEqual(store.listBookmarks(),records);assert.equal(store.revision(),revision);assert.equal(fs.readFileSync(store.file,'utf8'),before);
  }
  rename.mock.restore();
  store.transaction(()=>store.updateBookmark(saved.id,{url:'https://example.org/retry'}));
  assert.equal(new Store(dir).listBookmarks().find(b=>b.id===saved.id).url,'https://example.org/retry');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
