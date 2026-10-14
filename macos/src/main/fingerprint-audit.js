'use strict';
// Check the stylesheet engine as well as matchMedia. CSP-blocked styles stay unread.
function displayObservation(width,height){
 const id='star-display-audit-'+Math.random().toString(36).slice(2),style=document.createElement('style'),box=document.createElement('span');
 const dimensions={width:width??screen.width,height:height??screen.height},dpr=devicePixelRatio;
 const screenQuery='(device-width: '+dimensions.width+'px) and (device-height: '+dimensions.height+'px)',dprQuery='(resolution: '+dpr+'dppx)';
 const value={screen:screen.width+' × '+screen.height,displayScreen:{width:screen.width,height:screen.height},dpr,screenMedia:matchMedia(screenQuery).matches,dprMedia:matchMedia(dprQuery).matches,screenStyle:null,dprStyle:null};
 box.id=id;box.setAttribute('aria-hidden','true');
 style.textContent='#'+id+' {--star-audit-ready:1;--star-audit-screen:0;--star-audit-dpr:0;display:none!important} @media '+screenQuery+' {#'+id+' {--star-audit-screen:1}} @media '+dprQuery+' {#'+id+' {--star-audit-dpr:1}}';
 try{document.documentElement.append(style,box);const computed=getComputedStyle(box);if(computed.getPropertyValue('--star-audit-ready').trim()==='1'){value.screenStyle=computed.getPropertyValue('--star-audit-screen').trim()==='1';value.dprStyle=computed.getPropertyValue('--star-audit-dpr').trim()==='1';}}
 finally{style.remove();box.remove();}
 return value;
}
function displaySource(fp,{frame=false}={}){return '('+displayObservation.toString()+')('+((!frame&&fp.displayMode==='native')?'undefined,undefined':JSON.stringify(fp.screen.width)+','+JSON.stringify(fp.screen.height))+')';}

function readWorkerSource(){return `(async()=>({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,numberLocale:new Intl.NumberFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone,uaHints:await navigator.userAgentData?.getHighEntropyValues(['architecture','bitness','platformVersion','model','wow64','fullVersionList','uaFullVersion','formFactors'])}))()`;}
function readFrameSource(fp){return `(async()=>({...await ${readWorkerSource()},...${displaySource(fp,{frame:true})}}))()`;}
function readSource(fp){
 return `(async()=>{const read=()=>({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,numberLocale:new Intl.NumberFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone});const page=read();page.uaHints=await navigator.userAgentData?.getHighEntropyValues(['architecture','bitness','platformVersion','model','wow64','fullVersionList','uaFullVersion','formFactors']);Object.assign(page,${displaySource(fp)});try{const gl=document.createElement('canvas').getContext('webgl');const debug=gl?.getExtension('WEBGL_debug_renderer_info');page.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;}catch{}let worker;try{worker=await new Promise(resolve=>{const blob=URL.createObjectURL(new Blob(['('+read.toString()+');'+${JSON.stringify(readWorkerSource()+'.then(value=>postMessage(value))')}],{type:'text/javascript'}));let child,timer;const finish=value=>{clearTimeout(timer);child?.terminate();URL.revokeObjectURL(blob);resolve(value);};try{child=new Worker(blob);child.onmessage=event=>finish(event.data);child.onerror=()=>finish({error:'当前页面无法运行检查 Worker'});timer=setTimeout(()=>finish({error:'Worker 检查超时'}),3000);}catch{finish({error:'当前页面的策略阻止 Worker 检查'});}});}catch(error){worker={error:error.message};}let webgpu;try{if(!navigator.gpu)webgpu={available:false};else{const adapter=await Promise.race([navigator.gpu.requestAdapter(),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);webgpu={available:!!adapter,info:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null};}}catch(error){webgpu={available:false,error:error.message};}return {page,worker,webgpu};})()`;
}
function report(fp,observed,{engine,url,zoom=1,targetErrors=[]}){
 const rows=[];const add=(context,label,expected,actual)=>rows.push({context,label,expected:expected??null,actual:actual??null,state:actual===undefined||actual===null?'unknown':JSON.stringify(expected)===JSON.stringify(actual)?'match':'different'});
 for(const [key,label,expected]of [['ua','User Agent',fp.userAgent],['platform','平台',fp.platform],['language','语言',fp.language],['languages','语言列表',fp.languages],['locale','默认日期语言',fp.language],['numberLocale','默认数字语言',fp.language],['cpu','处理器核心',fp.hardwareConcurrency],['memory','设备内存',fp.deviceMemory],['tz','时区',fp.timezone]])add('网页',label,expected,observed.page[key]);
 if(fp.displayMode==='native')for(const [label,actual]of [['屏幕尺寸',observed.page.screen],['像素比（含缩放）',observed.page.dpr]])rows.push({context:'网页',label,expected:null,actual:actual??null,state:actual===undefined||actual===null?'unknown':'native'});
 else {add('网页','屏幕尺寸',fp.screen.width+' × '+fp.screen.height,observed.page.screen);add('网页','像素比（含缩放）',Number((fp.devicePixelRatio*zoom).toFixed(4)),Number(observed.page.dpr.toFixed(4)));}
 add('CSS','屏幕媒体查询',true,observed.page.screenMedia);add('CSS','像素比媒体查询',true,observed.page.dprMedia);add('CSS','屏幕 @media 样式',true,observed.page.screenStyle);add('CSS','像素比 @media 样式',true,observed.page.dprStyle);
 if(fp.noise.webgl)add('网页','WebGL 标识',fp.webgl.renderer,observed.page.gpu);else rows.push({context:'网页',label:'WebGL 标识',expected:null,actual:observed.page.gpu,state:observed.page.gpu?'native':'unknown'});
 if(!observed.worker.error)for(const [key,label]of [['ua','User Agent'],['platform','平台'],['language','语言'],['languages','语言列表'],['locale','默认日期语言'],['numberLocale','默认数字语言'],['cpu','处理器核心'],['memory','设备内存'],['tz','时区']])add('Worker',label,observed.page[key],observed.worker[key]);
 const meta=require('./fingerprint-protocol').metadata(fp);
 const hintExpected={brands:meta.brands,mobile:meta.mobile,platform:meta.platform,architecture:meta.architecture,bitness:meta.bitness,platformVersion:meta.platformVersion,model:meta.model,wow64:meta.wow64,fullVersionList:meta.fullVersionList,uaFullVersion:meta.fullVersion,formFactors:meta.formFactors};
 const addHints=(context,value)=>{if(!value){add(context,'Client Hints',hintExpected,null);return;}for(const [key,expected] of Object.entries(hintExpected))add(context,'Client Hints · '+key,expected,value[key]);};
 addHints('网页',observed.page.uaHints);if(!observed.worker.error)addHints('Worker',observed.worker.uaHints);
 const contexts=[];let contextUnknown=0;
 const counts={shared_worker:0,service_worker:0,iframe:0};
 for(const item of observed.contexts||[]){
   const context=(item.type==='shared_worker'?'Shared Worker':item.type==='service_worker'?'Service Worker':'iframe')+' '+(++counts[item.type]);
   contexts.push({context,type:item.type,status:item.error?'unread':'read',url:cleanUrl(item.url),error:item.error||''});
   if(item.error){contextUnknown++;continue;}
   for(const [key,label] of [['ua','User Agent'],['platform','平台'],['language','语言'],['languages','语言列表'],['locale','默认日期语言'],['numberLocale','默认数字语言'],['cpu','处理器核心'],['memory','设备内存'],['tz','时区']])add(context,label,observed.page[key],item.value[key]);
   addHints(context,item.value.uaHints);
   if(item.type==='iframe'){add(context,'屏幕尺寸',observed.page.screen,item.value.screen);add(context,'像素比（含缩放）',observed.page.dpr,item.value.dpr);add(context,'CSS 屏幕媒体查询',true,item.value.screenMedia);add(context,'CSS 像素比媒体查询',true,item.value.dprMedia);add(context,'CSS 屏幕 @media 样式',true,item.value.screenStyle);add(context,'CSS 像素比 @media 样式',true,item.value.dprStyle);}
 }
 for(const type of ['shared_worker','service_worker'])if(!counts[type])contexts.push({context:type==='shared_worker'?'Shared Worker':'Service Worker',type,status:'not-running'});
 let address='';try{const clean=new URL(url);address=clean.origin+clean.pathname;}catch{}
 let memoryHeaderObserved=false;
 if(observed.network){
  for(const request of observed.network.requests||[])for(const [name,actual] of Object.entries(request.headers||{})){
   if(!['device-memory','sec-ch-device-memory'].includes(name))continue;
   memoryHeaderObserved=true;
   const numeric=Number(actual);add('网络请求头',name+' · '+request.origin,fp.deviceMemory,Number.isFinite(numeric)?numeric:actual);
  }
  if(!memoryHeaderObserved)rows.push({context:'网络请求头',label:'设备内存请求头',expected:fp.deviceMemory,actual:null,state:'not-observed'});
 }
 const advice=[];
 if(rows.some(row=>row.context.startsWith('iframe')&&row.state==='different'&&row.label.includes('像素比')))advice.push({title:'跨进程框架像素比未对齐',text:'该框架的实际像素比或 CSS 分辨率与当前页面不同。独立 Chrome 可在启动时应用原生缩放参数；内置窗口仍可能受到跨进程设备模拟限制。完整关闭并重新打开环境后复测，报告保留实际读值。'});
 if(rows.some(row=>row.state==='different'&&row.label.includes('屏幕')&&(row.context==='CSS'||row.context.startsWith('iframe'))))advice.push({title:'CSS 屏幕尺寸未对齐',text:'屏幕读值或 CSS 屏幕查询在框架中仍有差异；仅修改页面的 screen 读值不能同步 CSS。保存配置后完整重启并复测，持续存在的差异需要通过原生屏幕策略验收。'});
 if(rows.some(row=>['语言','语言列表','默认日期语言','默认数字语言'].includes(row.label)&&row.state==='different'))advice.push({title:'语言读数不一致',text:'网页偏好语言与默认日期或数字格式可能来自不同的区域设置。检查环境的手动语言，保存后重新打开环境并复测；仍有差异时保留报告定位具体上下文。'});
 if(rows.some(row=>row.label==='时区'&&row.state==='different'))advice.push({title:'时区读数不一致',text:'核对手动时区与当前出口。切换系统代理不会自动改变已打开网页的区域设置，重新应用环境后检查。'});
 if(rows.some(row=>row.context==='网络请求头'&&row.state==='different'))advice.push({title:'内存请求头与页面不同',text:'网站声明后，本机 Chrome 仍可能发送原生设备内存。页面层覆盖没有改变此网络值；需要通过原生内核一致性验收才能消除差异。'});
 if(observed.network&&!memoryHeaderObserved)advice.push({title:'内存请求头尚未观测',text:'当前网页尚未发出可比较的内存请求头。检查不会主动发送探测请求；未观测不代表原生网络值已一致。'});
 if(rows.some(row=>row.state==='unknown')||observed.worker.error||contextUnknown)advice.push({title:'部分项目尚未读取',text:'等待页面完成加载后重试。网页权限、协议和后台上下文可能限制读取，未读取不代表通过。'});
 if(targetErrors.length)advice.push({title:'后台配置发生错误',text:'浏览器返回了配置错误，需重新打开环境并复测。配置错误不会记作验证通过。'});
 return {checkedAt:Date.now(),contexts,network:observed.network,engine,url:address,rows,advice,differences:rows.filter(row=>row.state==='different').length,unknown:rows.filter(row=>row.state==='unknown').length+contextUnknown,workerError:observed.worker.error||'',webgpu:observed.webgpu,targetErrors};
}
async function auditElectron(wc){
 const fp=wc.__tfbFingerprint;if(!fp)throw new Error('这个标签的指纹尚未就绪，请等待加载后重试');
 const url=wc.getURL();if(!/^https?:/.test(url))throw new Error('打开一个 HTTP 或 HTTPS 网页后再检查');
 // An ad frame can keep webContents loading after the inspected document is ready.
 const state=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'document.readyState',returnByValue:true,timeout:2000});
 if(state.result?.value!=='complete')throw new Error('页面仍在加载，请完成后再检查');
 const displayFp=fp.displayMode==='native'?{...fp}:fp;
 const value=await wc.debugger.sendCommand('Runtime.evaluate',{expression:readSource(displayFp),returnByValue:true,awaitPromise:true,timeout:7000});
 if(value.exceptionDetails||!value.result?.value)throw new Error('网页检查失败，请重新加载后重试');
 if(wc.isDestroyed()||wc.getURL()!==url)throw new Error('网页在检查期间跳转，请重新检查');
 if(fp.displayMode==='native'&&value.result.value.page.displayScreen)displayFp.screen=value.result.value.page.displayScreen;
 value.result.value.contexts=await require('./electron-fingerprint').electronWorkerObservations(wc,readWorkerSource(),readFrameSource(displayFp));
 return report(displayFp,value.result.value,{engine:'内置 Chromium '+process.versions.chrome,url,zoom:wc.getZoomFactor(),targetErrors:wc.__starTargetErrors});
}
function cleanUrl(url){try{const clean=new URL(url);return clean.origin+clean.pathname;}catch{return '';}}
async function chromeTargets(running){
 if(!running||running.pipe.closed)throw new Error('这个环境的本机 Chrome 已停止，请重新启动');
 const {targetInfos}=await running.pipe.send('Target.getTargets');return targetInfos.filter(t=>t.type==='page'&&/^https?:/.test(t.url));
}
async function chromePages(running){return (await chromeTargets(running)).map(target=>({id:target.targetId,title:target.title||'未命名网页',url:cleanUrl(target.url)}));}
async function chromeWorkerObservations(running,url,targetId,displayFp=running.fingerprint){
 const origin=new URL(url).origin,all=[...(running.targetSessions?.values()||[])];
 function belongs(target){let id=target.targetInfo.parentId;for(let depth=0;id&&depth<30;depth++){if(id===targetId)return true;id=all.find(t=>t.targetInfo.targetId===id)?.targetInfo.parentId;}return false;}
 return Promise.all(all.filter(target=>target.active!==false&&(target.targetInfo.type==='iframe'?belongs(target):['shared_worker','service_worker'].includes(target.targetInfo.type)&&new URL(target.targetInfo.url).origin===origin)).map(async target=>{
  const item={type:target.targetInfo.type,url:target.targetInfo.url};
  try{await target.ready;const info=await running.pipe.send('Target.getTargetInfo',{targetId:target.targetInfo.targetId});item.url=info.targetInfo.url;const response=await running.pipe.send('Runtime.evaluate',{expression:item.type==='iframe'?readFrameSource(displayFp):readWorkerSource(),awaitPromise:true,returnByValue:true},target.sessionId);if(response.exceptionDetails||!response.result?.value)throw new Error('后台上下文读取失败');item.value=response.result.value;}catch(error){item.error=error.message;}return item;
 }));
}
async function auditChrome(running,targetId){
 const pages=await chromeTargets(running);
 if(!pages.length)throw new Error('在本机 Chrome 打开一个 HTTP 或 HTTPS 网页后再检查');
 if(targetId!==undefined&&(typeof targetId!=='string'||targetId.length>160))throw new Error('网页标识无效，请刷新网页列表');
 const target=targetId?pages.find(page=>page.targetId===targetId):pages.length===1?pages[0]:null;
 if(!target)throw new Error(targetId?'所选网页已关闭或不再可检查，请刷新网页列表':'请选择要检查的网页');
 const attached=running.pageSessions.get(target.targetId);if(!attached)throw new Error('本机 Chrome 页面未就绪，请稍后重试');await attached.ready;
 const state=await running.pipe.send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true},attached.sessionId);
 if(state.result?.value!=='complete')throw new Error('所选网页仍在加载，请完成后再检查');
 const result=await running.pipe.send('Runtime.evaluate',{expression:readSource(running.fingerprint),returnByValue:true,awaitPromise:true,timeout:7000},attached.sessionId);
 if(result.exceptionDetails||!result.result?.value)throw new Error('本机 Chrome 网页检查失败，请重新加载后重试');
 const displayFp=running.fingerprint.displayMode==='native'?{...running.fingerprint,screen:result.result.value.page.displayScreen}:running.fingerprint;
 result.result.value.contexts=await chromeWorkerObservations(running,target.url,target.targetId,displayFp);
 result.result.value.network=attached.networkObserver?.snapshot();
 const current=await running.pipe.send('Target.getTargetInfo',{targetId:target.targetId});
 if(current.targetInfo.url!==target.url)throw new Error('所选网页在检查期间跳转，请重新检查');
 return {...report(displayFp,result.result.value,{engine:'本机 Chrome '+running.fingerprint.chromeVersion,url:target.url,zoom:result.result.value.page.dpr/running.fingerprint.devicePixelRatio,targetErrors:running.targetErrors||[]}),targetId:target.targetId,title:current.targetInfo.title||'未命名网页'};
}
module.exports={displayObservation,readSource,readWorkerSource,readFrameSource,report,auditElectron,auditChrome,chromePages};
