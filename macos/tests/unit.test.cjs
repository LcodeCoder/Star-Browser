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
