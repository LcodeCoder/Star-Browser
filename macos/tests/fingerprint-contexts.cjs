'use strict';
// Launch without Playwright's browser autoattach: a second inspector can resume a
// newly created Shared Worker before the application's configuration has finished.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {CdpSocket}=require('../src/main/cdp-socket');
const {startOrigin}=require('./fixtures.cjs');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-contexts-'));
const results=[],evidence=[],limitations=[];let origin,child,pipe,manager,profile,second,nativeControl,stderr='';
async function until(run,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error('等待浏览器上下文超时\n'+stderr.slice(-1000));}
async function evaluate(expression,sessionId=manager){const response=await pipe.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,timeout:15000},sessionId,18000);if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result?.value;}
async function api(method,...args){return evaluate('window.api['+JSON.stringify(method)+'](...'+JSON.stringify(args)+')');}
async function start(){
 stderr='';child=spawn(require('electron'),['.'],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'',TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir,TFB_TEST_ORIGIN_PORT:String(origin.port)},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8000);});
 let endpoint=await until(async()=>{try{const lines=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n');const response=await fetch('http://127.0.0.1:'+lines[0]+'/json/version');const json=await response.json();return json.webSocketDebuggerUrl?.replace('localhost','127.0.0.1');}catch{return null;}});
 pipe=new CdpSocket(endpoint);await pipe.ready;
 const target=await until(async()=>(await pipe.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.endsWith('/index.html')));
 manager=(await pipe.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await until(()=>evaluate('typeof window.api?.create === "function"'));
}
async function stop(){if(!child)return;const closing=child;await pipe?.send('Browser.close').catch(()=>{});pipe?.close();await until(()=>closing.exitCode!==null||closing.signalCode!==null,7000).catch(()=>closing.kill());child=null;pipe=null;}
async function page(marker){
 const info=await until(async()=>(await pipe.send('Target.getTargets')).targetInfos.find(t=>t.type==='webview'&&t.url.includes(marker)));
 const sessionId=(await pipe.send('Target.attachToTarget',{targetId:info.targetId,flatten:true})).sessionId;
 await until(()=>evaluate('document.readyState === "complete"',sessionId));
 return {sessionId,info};
}
const read=`({markers:['installFingerprint','__FP_ACTIVE__','__FP_CONFIG__'].filter(key=>key in globalThis),ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date('2026-01-15T12:00:00Z').getTimezoneOffset()})`;
async function expected(p){const fp=await api('preview',p.id);return {ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,locale:fp.language,tz:fp.timezone,offset:fp.timezone==='Asia/Tokyo'?-540:-60};}
function consistent(actual,want,label){evidence.push({label,actual,expected:want});assert.deepEqual(actual.markers,[],label+' public installation globals');for(const key of Object.keys(want))assert.deepEqual(actual[key],want[key],label+' '+key);if(actual.first){assert.deepEqual(actual.first.markers,[],label+' first public installation globals');for(const key of Object.keys(want))assert.deepEqual(actual.first[key],want[key],label+' first '+key);}}
function hints(actual,fp){
 const major=fp.chromeVersion.split('.')[0];
 assert.equal(actual.hints.uaFullVersion,fp.chromeVersion);
 assert.equal(actual.uaData.platform,fp.os==='mac'?'macOS':fp.os==='android'?'Android':'Windows');
 assert.equal(actual.uaData.mobile,fp.os==='android');
 assert.ok(actual.hints.fullVersionList.some(b=>b.brand==='Chromium'&&b.version===fp.chromeVersion));
 assert.ok(actual.uaData.brands.some(b=>b.brand==='Chromium'&&b.version===major));
 assert.ok(nativeControl?.semantics[actual.scopeType],'An independent native Worker control is required');
 assert.deepEqual(actual.semantics,nativeControl.semantics[actual.scopeType],'Worker APIs preserve the independently measured native validation and function properties');
}
async function worker(pg,{module=false,blob=false,nested=false}={}){
 const url=blob?null:'/fingerprint-'+(module?'module':'worker')+'.js?'+(nested?'parent':'strict')+'='+Date.now();
 return evaluate(`new Promise((resolve,reject)=>{
  const url=${blob?`URL.createObjectURL(new Blob([${JSON.stringify('const value='+read+';postMessage({...value,first:value});')}],{type:'text/javascript'}))`:JSON.stringify(url)};
  const child=new Worker(url,${JSON.stringify(module?{type:'module'}:{})});
  const timer=setTimeout(()=>{child.terminate();reject(new Error('Worker 超时'));},8000);
  child.onmessage=e=>{clearTimeout(timer);child.terminate();${blob?'URL.revokeObjectURL(url);':''}resolve(e.data);};child.onerror=e=>{clearTimeout(timer);child.terminate();reject(new Error(e.message));};
 })`,pg.sessionId);
}
async function shared(pg,{name='strict-shared',module=false,headers=false,nested=false}={}){
 return evaluate(`new Promise((resolve,reject)=>{
  window.sharedStrict=new SharedWorker(${JSON.stringify('/fingerprint-'+(module?'module':'worker')+'.js?shared-strict')},${JSON.stringify({name,type:module?'module':'classic'})});
  const port=sharedStrict.port;port.start();const timer=setTimeout(()=>reject(new Error('Shared Worker 超时')),8000);
  port.onmessage=e=>{clearTimeout(timer);port.onmessage=null;resolve(e.data);};sharedStrict.onerror=e=>reject(new Error(e.message));
 })`,pg.sessionId).then(async first=>{
  if(!headers&&!nested)return first;
  return evaluate(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Shared Worker 请求超时')),8000);sharedStrict.port.onmessage=e=>{clearTimeout(timer);sharedStrict.port.onmessage=null;resolve(e.data);};sharedStrict.port.postMessage(${JSON.stringify({headers,nested})});})`,pg.sessionId);
 });
}
async function service(pg,{register=true,module=false,headers=false}={}){
 return evaluate(`(async()=>{
  const reg=${register?`await navigator.serviceWorker.register(${JSON.stringify('/fingerprint-'+(module?'module':'worker')+'.js?service-strict')},{scope:'/',type:${JSON.stringify(module?'module':'classic')}})`:'await navigator.serviceWorker.getRegistration()'};
  if(!reg)throw new Error('找不到 Service Worker');
  await navigator.serviceWorker.ready;
  const active=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Service Worker 激活超时')),8000);const check=()=>{if(reg.active&&reg.active.state==='activated'${register?'&&reg.active.scriptURL.includes('+JSON.stringify('/fingerprint-'+(module?'module':'worker')+'.js')+')':''}){clearTimeout(timer);resolve(reg.active);}else setTimeout(check,40);};check();});
  return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(new Error('Service Worker 响应超时')),8000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};active.postMessage(${JSON.stringify({headers})},[channel.port2]);});
 })()`,pg.sessionId);
}
async function check(name,run){const started=Date.now(),previousLimits=limitations.length;try{const detail=await run(),status=limitations.length>previousLimits?'partial':'passed';results.push({name,status,durationMs:Date.now()-started,detail});console.log(status==='partial'?'PARTIAL':'PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
(async()=>{try{
 origin=await startOrigin();await start();
 profile=await api('create',{name:'JS/CDP 严格验证',os:'mac',country:'FR',langManual:true,language:'fr-FR',timezoneManual:true,timezone:'Europe/Paris',startUrl:`http://localhost:${origin.port}/probe?strict=FR`,fingerprint:{hardwareConcurrency:4,deviceMemory:4,devicePixelRatio:1.5,screen:{width:1600,height:900}}});
 await api('browse',profile.id);let pg=await page('strict=FR'),want=await expected(profile),fp=await api('preview',profile.id);
 await check('独立原生 Worker 对照不加载项目注入，语义来自当前内核',async()=>{nativeControl=await require('./native-worker-control.cjs').nativeWorkerControl(origin,fp);assert.equal(nativeControl.noInjection,true);assert.deepEqual(nativeControl.errors,[]);for(const value of Object.values(nativeControl.semantics)){for(const key of ['memoryReceiver','uaReceiver','uaOmitted','uaNull','uaNumber','jsonReceiver','languagesFrozen','brandsFrozen'])assert.equal(value[key],true,key);assert.equal(value.prototype,false);}return nativeControl;});
 await check('页面首段脚本及经典、模块、Blob、嵌套 Dedicated Worker',async()=>{
  consistent(await evaluate(read,pg.sessionId),want,'page');const values=[];
  for(const options of [{},{module:true},{blob:true},{blob:true,module:true},{nested:true},{nested:true,module:true}]){
   const value=await worker(pg,options);consistent(value,want,JSON.stringify(options));if(!options.blob)hints(value,fp);
   if(options.module&&!options.blob)assert.equal(value.module,'native-module-import');if(options.nested)consistent(value.nested,want,'nested dedicated');values.push({options,value});
  }
  const early=await evaluate('window.early',pg.sessionId);assert.deepEqual(early.markers,[],'first page script installation globals');assert.equal(early.ua,want.ua);assert.equal(early.language,want.language);assert.equal(early.cores,want.cpu);return values;
 });
 await check('经典及模块 Shared Worker 首段脚本和请求头',async()=>{
  const values=[];for(const module of [false,true]){const value=await shared(pg,{module,name:'strict-'+module,headers:true});consistent(value,want,'shared '+module);hints(value,fp);assert.equal(value.headers['user-agent'],want.ua);assert.deepEqual(value.headers['accept-language'].split(',').map(s=>s.split(';')[0]),want.languages);assert.ok(value.headers['sec-ch-ua-full-version-list'].includes(fp.chromeVersion));values.push(value);}return values;
 });
 await check('Service Worker 首段脚本、原生注册、接管、请求头及 fetch',async()=>{
  const value=await service(pg,{headers:true});consistent(value,want,'service');hints(value,fp);assert.equal(value.headers['user-agent'],want.ua);assert.deepEqual(value.headers['accept-language'].split(',').map(s=>s.split(';')[0]),want.languages);
  const fetched=await evaluate(`fetch('/service-snapshot').then(r=>r.json())`,pg.sessionId);consistent(fetched,want,'service fetch');assert.equal(fetched.instance,value.instance);return {value,fetched};
 });
 await check('Service Worker 停止后自动重启和模块重新注册',async()=>{
  const before=await service(pg,{register:false});await pipe.send('ServiceWorker.enable',{},pg.sessionId);await pipe.send('ServiceWorker.stopAllWorkers',{},pg.sessionId);
  const after=await service(pg,{register:false});consistent(after,want,'service restarted');assert.notEqual(before.instance,after.instance);
  await evaluate(`navigator.serviceWorker.getRegistration().then(r=>r.unregister())`,pg.sessionId);
  const module=await service(pg,{module:true});consistent(module,want,'module service');hints(module,fp);assert.equal(module.module,'native-module-import');return {before:before.instance,after:after.instance,module};
 });
 await check('同源、跨源 iframe、srcdoc 和同步 about:blank',async()=>{
  const values=[];
  for(const src of [`http://localhost:${origin.port}/fingerprint-frame`,`http://127.0.0.1:${origin.port}/fingerprint-frame`]){
   const value=await evaluate(`new Promise((resolve,reject)=>{const frame=document.createElement('iframe'),timer=setTimeout(()=>reject(new Error('frame 超时')),8000);const handler=e=>{if(e.source===frame.contentWindow&&e.data.starFrame){clearTimeout(timer);removeEventListener('message',handler);window.strictFrame=frame;resolve(e.data.starFrame);}};addEventListener('message',handler);frame.src=${JSON.stringify(src)};document.body.append(frame);})`,pg.sessionId);
   consistent(value,want,'frame '+src);assert.deepEqual(value.screen,{width:1600,height:900});if(value.dpr!==1.5)limitations.push({surface:'OOPIF devicePixelRatio/CSS resolution',url:src,expected:{dpr:1.5,screenMedia:true,dprMedia:true},actual:{dpr:value.dpr,screenMedia:value.screenMedia,dprMedia:value.dprMedia},reason:'Chromium device metrics override does not propagate to out-of-process iframe widgets'});values.push(value);await evaluate('window.strictFrame.remove()',pg.sessionId);
  }
  const blank=await evaluate(`(()=>{const frame=document.createElement('iframe');document.body.append(frame);const n=frame.contentWindow.navigator;const value={ua:n.userAgent,language:n.language,cpu:n.hardwareConcurrency,memory:n.deviceMemory};frame.remove();return value;})()`,pg.sessionId);
  for(const key of Object.keys(blank))assert.equal(blank[key],want[key],'synchronous about blank '+key);
  const srcdoc=await evaluate(`new Promise(resolve=>{const frame=document.createElement('iframe');const handler=e=>{if(e.source===frame.contentWindow){removeEventListener('message',handler);frame.remove();resolve(e.data);}};addEventListener('message',handler);frame.srcdoc=${JSON.stringify('<script>parent.postMessage('+read+',"*")</script>')};document.body.append(frame);})`,pg.sessionId);consistent(srcdoc,want,'srcdoc');return {values,blank,srcdoc};
 });
 const shell=(await pipe.send('Target.attachToTarget',{targetId:pg.info.parentId,flatten:true})).sessionId;
 let secondTab;
 await check('Shared Worker 在两标签间保持原生身份、连接与存活',async()=>{
  const first=await shared(pg,{name:'identity'});secondTab=await evaluate(`createTab('http://localhost:${origin.port}/probe?strict=tab2')`,shell);const other=await page('strict=tab2');
  const secondRead=await shared(other,{name:'identity'});consistent(secondRead,want,'shared second tab');assert.equal(secondRead.instance,first.instance);assert.ok(secondRead.connected>first.connected);
  await evaluate(`sharedStrict.port.close()`,pg.sessionId);const again=await shared(other,{name:'identity'});assert.equal(again.instance,first.instance);return {first,second:secondRead,again};
 });
 await check('双环境并行 Worker、时区和语言独立，跨平台声明同步',async()=>{
  second=await api('create',{name:'东京声明',os:'win',country:'JP',langManual:true,language:'ja-JP',timezoneManual:true,timezone:'Asia/Tokyo',startUrl:`http://localhost:${origin.port}/probe?strict=JP`,fingerprint:{hardwareConcurrency:12,deviceMemory:8}});await api('browse',second.id);
  const other=await page('strict=JP'),otherWant=await expected(second),otherFp=await api('preview',second.id);consistent(await evaluate(read,other.sessionId),otherWant,'parallel page');
  const values=[];for(const value of [await worker(other),await shared(other,{name:'identity'}),await service(other)]){consistent(value,otherWant,'parallel worker');hints(value,otherFp);values.push(value);}consistent(await worker(pg),want,'original environment');return values;
 });
 await check('DevTools 打开、导航和关闭后，各类 Worker 的首段脚本保持配置',async()=>{
  const guest=await evaluate(`tabs.find(t=>t.url.includes('strict=FR')).web.getWebContentsId()`,shell);await evaluate(`window.api.guestDevTools(${guest})`,shell);
  consistent(await worker(pg,{module:true}),want,'devtools dedicated');consistent(await shared(pg,{name:'devtools-open'}),want,'devtools shared');consistent(await service(pg,{register:false}),want,'devtools service');
  await pipe.send('Page.navigate',{url:`http://localhost:${origin.port}/probe?strict=FR&devtools`},pg.sessionId);await until(()=>evaluate('document.readyState==="complete" && !!window.early',pg.sessionId));consistent(await evaluate(read,pg.sessionId),want,'devtools navigate');
  await evaluate(`window.api.guestDevTools(${guest})`,shell);consistent(await worker(pg),want,'devtools closed');return {opened:true,navigated:true,closed:true};
 });
 await check('原生 getter、Client Hints 的接收者、参数校验与函数属性',async()=>{
  const value=await evaluate(`(async()=>{
   const fail=async run=>{try{await run();return false;}catch(e){return e instanceof TypeError;}};
   const memory=Object.getOwnPropertyDescriptor(Navigator.prototype,'deviceMemory').get;
   const hev=NavigatorUAData.prototype.getHighEntropyValues;
   return {memoryReceiver:await fail(()=>memory.call({})),uaReceiver:await fail(()=>hev.call({},[])),uaOmitted:await fail(()=>hev.call(navigator.userAgentData)),uaNull:await fail(()=>hev.call(navigator.userAgentData,null)),uaNumber:await fail(()=>hev.call(navigator.userAgentData,1)),name:memory.name,length:memory.length,prototype:Object.hasOwn(memory,'prototype'),native:memory.toString().includes('[native code]'),toStringPrototype:Object.hasOwn(Function.prototype.toString,'prototype'),canvasLength:CanvasRenderingContext2D.prototype.getImageData.length,rtcPrototype:RTCPeerConnection.prototype===Object.getPrototypeOf(Object.create(RTCPeerConnection.prototype))};
  })()`,pg.sessionId);
  for(const key of ['memoryReceiver','uaReceiver','uaOmitted','uaNull','uaNumber','native','rtcPrototype'])assert.equal(value[key],true,key);assert.equal(value.name,'get deviceMemory');assert.equal(value.length,0);assert.equal(value.prototype,false);assert.equal(value.toStringPrototype,false);assert.equal(value.canvasLength,4);return value;
 });
 await check('工作台检查列出实际运行中的 Shared/Service Worker',async()=>{
  const report=await api('fingerprintAudit',profile.id);assert.equal(report.differences,0,JSON.stringify(report.rows.filter(r=>r.state==='different')));assert.deepEqual(report.targetErrors,[]);assert.ok(report.rows.some(r=>r.context.startsWith('Shared Worker')));assert.ok(report.rows.some(r=>r.context.startsWith('Service Worker')));return {rows:report.rows.length,contexts:report.contexts};
 });
 await check('休眠和唤醒后的新文档与 Worker',async()=>{
  const firstTab=await evaluate(`tabs.find(t=>t.url.includes('strict=FR')).id`,shell);await evaluate(`activateTab(${JSON.stringify(secondTab)});StarTabs.sleep(${JSON.stringify(firstTab)})`,shell);await evaluate(`activateTab(${JSON.stringify(firstTab)})`,shell);pg=await page('strict=FR');consistent(await evaluate(read,pg.sessionId),want,'wake page');consistent(await worker(pg),want,'wake dedicated');consistent(await shared(pg,{name:'after-wake'}),want,'wake shared');consistent(await service(pg,{register:false}),want,'wake service');return {slept:true,woke:true};
 });
 await api('action','stop',[second.id]);
 await check('稳定 Canvas/OffscreenCanvas 读值、裁剪和导出，音频复制一致',async()=>{
  await api('action','stop',[profile.id]);await api('update',profile.id,{fingerprint:{hardwareConcurrency:4,deviceMemory:4,devicePixelRatio:1.5,screen:{width:1600,height:900},noise:{canvas:true,audio:true,webgl:true,clientRects:true}},webrtc:'disable'});await api('browse',profile.id);pg=await page('strict=FR');
  const value=await evaluate(`(async()=>{
   const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
   const hash=a=>Array.from(a).reduce((h,v)=>Math.imul(h^v,16777619)>>>0,2166136261);
   const c=document.createElement('canvas');c.width=128;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#376bad';ctx.fillRect(0,0,128,64);
   const pixels=ctx.getImageData(0,0,128,64).data,again=ctx.getImageData(0,0,128,64).data,crop=ctx.getImageData(8,8,16,16).data;
   let cropSame=true;for(let y=0;y<16;y++)for(let x=0;x<16;x++)for(let k=0;k<4;k++)if(crop[(y*16+x)*4+k]!==pixels[((y+8)*128+x+8)*4+k])cropSame=false;
   const url=c.toDataURL(),image=new Image();image.src=url;await image.decode();const d=document.createElement('canvas');d.width=128;d.height=64;d.getContext('2d').drawImage(image,0,0);const exported=d.getContext('2d').getImageData(0,0,128,64).data;
   const off=new OffscreenCanvas(128,64),oc=off.getContext('2d');oc.fillStyle='#376bad';oc.fillRect(0,0,128,64);const offPixels=oc.getImageData(0,0,128,64).data;
   const bitmap=await createImageBitmap(await off.convertToBlob());const decoded=new OffscreenCanvas(128,64);decoded.getContext('2d').drawImage(bitmap,0,0);const offExport=decoded.getContext('2d').getImageData(0,0,128,64).data;bitmap.close();
   const buffer=new AudioBuffer({length:1024,numberOfChannels:1,sampleRate:44100});buffer.copyToChannel(new Float32Array(1024).fill(.25),0);const copy=new Float32Array(1024);buffer.copyFromChannel(copy,0);const channel=buffer.getChannelData(0),offset=new Float32Array(64);buffer.copyFromChannel(offset,0,500);const silent=new AudioBuffer({length:1024,numberOfChannels:1,sampleRate:44100});
   const rects=document.body.getClientRects();let rectReceiver=false,canvasReceiver=false,rtcDisabled=false,rtcPrototypeDisabled=false;try{rects.item.call({},0);}catch(e){rectReceiver=e instanceof TypeError;}try{ctx.getImageData.call({},0,0,1,1);}catch(e){canvasReceiver=e instanceof TypeError;}try{new RTCPeerConnection();}catch(e){rtcDisabled=e.name==='NotSupportedError';}try{new RTCPeerConnection.prototype.constructor();}catch(e){rtcPrototypeDisabled=e.name==='NotSupportedError';}
   return {hash:hash(pixels),same:equal(pixels,again),cropSame,exportSame:equal(pixels,exported),offSame:equal(pixels,offPixels),offExportSame:equal(offPixels,offExport),audioSame:equal(copy,channel),audioOffset:equal(offset,channel.slice(500,564)),silent:Array.from(silent.getChannelData(0)).every(v=>v===0),rectNative:rects instanceof DOMRectList,rectIdentity:rects[0]===rects.item(0),rectReceiver,canvasReceiver,rtcDisabled,rtcPrototypeDisabled};
  })()`,pg.sessionId);
  for(const [key,result] of Object.entries(value))if(key!=='hash')assert.equal(result,true,key);
  const workerHash=await evaluate(`new Promise((resolve,reject)=>{const child=new Worker(URL.createObjectURL(new Blob([\`const c=new OffscreenCanvas(128,64),ctx=c.getContext('2d');ctx.fillStyle='#376bad';ctx.fillRect(0,0,128,64);const data=ctx.getImageData(0,0,128,64).data;postMessage(Array.from(data).reduce((h,v)=>Math.imul(h^v,16777619)>>>0,2166136261));\`],{type:'text/javascript'})));child.onmessage=e=>{child.terminate();resolve(e.data);};child.onerror=e=>reject(new Error(e.message));})`,pg.sessionId);assert.equal(workerHash,value.hash);return {...value,workerHash};
 });
 await check('保留 WebRTC 模式返回原生连接、事件与 RTCStatsReport',async()=>{
  await api('action','stop',[profile.id]);await api('update',profile.id,{webrtc:'proxy'});await api('browse',profile.id);pg=await page('strict=FR');
  const value=await evaluate(`(async()=>{const pc=new RTCPeerConnection();const value={native:pc instanceof RTCPeerConnection,constructor:pc.constructor===RTCPeerConnection,events:pc instanceof EventTarget,stats:(await pc.getStats()) instanceof RTCStatsReport};pc.close();return value;})()`,pg.sessionId);assert.deepEqual(value,{native:true,constructor:true,events:true,stats:true});return value;
 });
 await check('完整应用重启后，持久 Service Worker 的首段脚本重新配置',async()=>{
  await service(pg,{register:false});await stop();await start();await api('browse',profile.id);pg=await page('strict=FR');want=await expected(profile);const value=await service(pg,{register:false});consistent(value,want,'persistent service restarted');consistent(await shared(pg,{name:'app-restart'}),want,'app restarted shared');return value;
 });
}catch(error){console.error(error);process.exitCode=1;try{const targets=await pipe.send('Target.getTargets');evidence.push({label:'failure targets',actual:targets});for(const t of targets.targetInfos.filter(t=>t.type==='iframe')){const s=(await pipe.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;const v=await evaluate('({memory:navigator.deviceMemory,cpu:navigator.hardwareConcurrency})',s);console.log('frame after',JSON.stringify(v));evidence.push({label:'failure frame after',actual:v});}if(profile)evidence.push({label:'failure audit',actual:await api('fingerprintAudit',profile.id)});console.log('failure context summary',JSON.stringify({contexts:evidence.at(-1).actual.contexts,differences:evidence.at(-1).actual.differences,unknown:evidence.at(-1).actual.unknown,errors:evidence.at(-1).actual.targetErrors}));}catch(diagnostic){console.log('diagnostic',diagnostic.message);}}finally{
 await stop().catch(()=>{child?.kill();});await origin?.close();fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/fingerprint-contexts.json'),JSON.stringify({status:process.exitCode?'failed':limitations.length?'partial':'passed',testedAt:new Date().toISOString(),results,evidence,limitations},null,2)+'\n');fs.rmSync(dir,{recursive:true,force:true});
}})();
