'use strict';
function readSource(fp){
 const cfg=JSON.stringify({width:fp.screen.width,height:fp.screen.height,dpr:fp.devicePixelRatio});
 return `(async()=>{const cfg=${cfg};const read=()=>({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone});const page=read();page.screen=screen.width+' × '+screen.height;page.dpr=devicePixelRatio;page.screenMedia=matchMedia('(device-width: '+cfg.width+'px) and (device-height: '+cfg.height+'px)').matches;page.dprMedia=matchMedia('(resolution: '+devicePixelRatio+'dppx)').matches;try{const gl=document.createElement('canvas').getContext('webgl');const debug=gl?.getExtension('WEBGL_debug_renderer_info');page.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;}catch{}let worker;try{worker=await new Promise(resolve=>{const blob=URL.createObjectURL(new Blob(['postMessage(('+read.toString()+')())'],{type:'text/javascript'}));let child,timer;const finish=value=>{clearTimeout(timer);child?.terminate();URL.revokeObjectURL(blob);resolve(value);};try{child=new Worker(blob);child.onmessage=event=>finish(event.data);child.onerror=()=>finish({error:'当前页面无法运行检查 Worker'});timer=setTimeout(()=>finish({error:'Worker 检查超时'}),3000);}catch{finish({error:'当前页面的策略阻止 Worker 检查'});}});}catch(error){worker={error:error.message};}let webgpu;try{if(!navigator.gpu)webgpu={available:false};else{const adapter=await Promise.race([navigator.gpu.requestAdapter(),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);webgpu={available:!!adapter,info:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null};}}catch(error){webgpu={available:false,error:error.message};}return {page,worker,webgpu};})()`;
}
function report(fp,observed,{engine,url,zoom=1,targetErrors=[]}){
 const rows=[];const add=(context,label,expected,actual)=>rows.push({context,label,expected:expected??null,actual:actual??null,state:actual===undefined||actual===null?'unknown':JSON.stringify(expected)===JSON.stringify(actual)?'match':'different'});
 for(const [key,label,expected]of [['ua','User Agent',fp.userAgent],['platform','平台',fp.platform],['language','语言',fp.language],['languages','语言列表',fp.languages],['cpu','处理器核心',fp.hardwareConcurrency],['memory','设备内存',fp.deviceMemory],['tz','时区',fp.timezone]])add('网页',label,expected,observed.page[key]);
 add('网页','屏幕尺寸',fp.screen.width+' × '+fp.screen.height,observed.page.screen);add('网页','像素比（含缩放）',Number((fp.devicePixelRatio*zoom).toFixed(4)),Number(observed.page.dpr.toFixed(4)));add('CSS','屏幕媒体查询',true,observed.page.screenMedia);add('CSS','像素比媒体查询',true,observed.page.dprMedia);
 if(fp.noise.webgl)add('网页','WebGL 标识',fp.webgl.renderer,observed.page.gpu);else rows.push({context:'网页',label:'WebGL 标识',expected:null,actual:observed.page.gpu,state:observed.page.gpu?'native':'unknown'});
 if(!observed.worker.error)for(const [key,label]of [['ua','User Agent'],['platform','平台'],['language','语言'],['languages','语言列表'],['cpu','处理器核心'],['memory','设备内存'],['tz','时区']])add('Worker',label,observed.page[key],observed.worker[key]);
 let address='';try{const clean=new URL(url);address=clean.origin+clean.pathname;}catch{}
 return {checkedAt:Date.now(),engine,url:address,rows,differences:rows.filter(row=>row.state==='different').length,unknown:rows.filter(row=>row.state==='unknown').length,workerError:observed.worker.error||'',webgpu:observed.webgpu,targetErrors};
}
async function auditElectron(wc){
 const fp=wc.__tfbFingerprint;if(!fp)throw new Error('这个标签的指纹尚未就绪，请等待加载后重试');
 if(wc.isLoading())throw new Error('页面仍在加载，请完成后再检查');if(!/^https?:/.test(wc.getURL()))throw new Error('打开一个 HTTP 或 HTTPS 网页后再检查');
 const value=await wc.debugger.sendCommand('Runtime.evaluate',{expression:readSource(fp),returnByValue:true,awaitPromise:true,timeout:7000});
 if(value.exceptionDetails||!value.result?.value)throw new Error('网页检查失败，请重新加载后重试');
 return report(fp,value.result.value,{engine:'内置 Chromium '+process.versions.chrome,url:wc.getURL(),zoom:wc.getZoomFactor(),targetErrors:wc.__starTargetErrors});
}
async function auditChrome(running){
 const {targetInfos}=await running.pipe.send('Target.getTargets');const pages=targetInfos.filter(t=>t.type==='page'&&/^https?:/.test(t.url));
 if(pages.length!==1)throw new Error(pages.length?'本机 Chrome 有多个网页，请保留一个标签后检查':'在本机 Chrome 打开一个 HTTP 或 HTTPS 网页后再检查');
 const target=pages[0],attached=running.pageSessions.get(target.targetId);if(!attached)throw new Error('本机 Chrome 页面未就绪，请稍后重试');await attached.ready;
 const result=await running.pipe.send('Runtime.evaluate',{expression:readSource(running.fingerprint),returnByValue:true,awaitPromise:true,timeout:7000},attached.sessionId);
 if(result.exceptionDetails||!result.result?.value)throw new Error('本机 Chrome 网页检查失败，请重新加载后重试');
 return report(running.fingerprint,result.result.value,{engine:'本机 Chrome '+running.fingerprint.chromeVersion,url:target.url,zoom:result.result.value.page.dpr/running.fingerprint.devicePixelRatio,targetErrors:running.targetErrors||[]});
}
module.exports={readSource,report,auditElectron,auditChrome};
