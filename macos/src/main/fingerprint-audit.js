'use strict';
function readSource(fp){
 const cfg=JSON.stringify({width:fp.screen.width,height:fp.screen.height,dpr:fp.devicePixelRatio});
 return `(async()=>{const cfg=${cfg};const read=()=>({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,numberLocale:new Intl.NumberFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone});const page=read();page.screen=screen.width+' × '+screen.height;page.dpr=devicePixelRatio;page.screenMedia=matchMedia('(device-width: '+cfg.width+'px) and (device-height: '+cfg.height+'px)').matches;page.dprMedia=matchMedia('(resolution: '+devicePixelRatio+'dppx)').matches;try{const gl=document.createElement('canvas').getContext('webgl');const debug=gl?.getExtension('WEBGL_debug_renderer_info');page.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;}catch{}let worker;try{worker=await new Promise(resolve=>{const blob=URL.createObjectURL(new Blob(['postMessage(('+read.toString()+')())'],{type:'text/javascript'}));let child,timer;const finish=value=>{clearTimeout(timer);child?.terminate();URL.revokeObjectURL(blob);resolve(value);};try{child=new Worker(blob);child.onmessage=event=>finish(event.data);child.onerror=()=>finish({error:'当前页面无法运行检查 Worker'});timer=setTimeout(()=>finish({error:'Worker 检查超时'}),3000);}catch{finish({error:'当前页面的策略阻止 Worker 检查'});}});}catch(error){worker={error:error.message};}let webgpu;try{if(!navigator.gpu)webgpu={available:false};else{const adapter=await Promise.race([navigator.gpu.requestAdapter(),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);webgpu={available:!!adapter,info:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null};}}catch(error){webgpu={available:false,error:error.message};}return {page,worker,webgpu};})()`;
}
function report(fp,observed,{engine,url,zoom=1,targetErrors=[]}){
 const rows=[];const add=(context,label,expected,actual)=>rows.push({context,label,expected:expected??null,actual:actual??null,state:actual===undefined||actual===null?'unknown':JSON.stringify(expected)===JSON.stringify(actual)?'match':'different'});
 for(const [key,label,expected]of [['ua','User Agent',fp.userAgent],['platform','平台',fp.platform],['language','语言',fp.language],['languages','语言列表',fp.languages],['locale','默认日期语言',fp.language],['numberLocale','默认数字语言',fp.language],['cpu','处理器核心',fp.hardwareConcurrency],['memory','设备内存',fp.deviceMemory],['tz','时区',fp.timezone]])add('网页',label,expected,observed.page[key]);
 add('网页','屏幕尺寸',fp.screen.width+' × '+fp.screen.height,observed.page.screen);add('网页','像素比（含缩放）',Number((fp.devicePixelRatio*zoom).toFixed(4)),Number(observed.page.dpr.toFixed(4)));add('CSS','屏幕媒体查询',true,observed.page.screenMedia);add('CSS','像素比媒体查询',true,observed.page.dprMedia);
 if(fp.noise.webgl)add('网页','WebGL 标识',fp.webgl.renderer,observed.page.gpu);else rows.push({context:'网页',label:'WebGL 标识',expected:null,actual:observed.page.gpu,state:observed.page.gpu?'native':'unknown'});
 if(!observed.worker.error)for(const [key,label]of [['ua','User Agent'],['platform','平台'],['language','语言'],['languages','语言列表'],['locale','默认日期语言'],['numberLocale','默认数字语言'],['cpu','处理器核心'],['memory','设备内存'],['tz','时区']])add('Worker',label,observed.page[key],observed.worker[key]);
 let address='';try{const clean=new URL(url);address=clean.origin+clean.pathname;}catch{}
 const advice=[];
 if(rows.some(row=>['语言','语言列表','默认日期语言','默认数字语言'].includes(row.label)&&row.state==='different'))advice.push({title:'语言读数不一致',text:'网页偏好语言与默认日期或数字格式可能来自不同的区域设置。检查环境的手动语言，保存后重新打开环境并复测；仍有差异时保留报告定位具体上下文。'});
 if(rows.some(row=>row.label==='时区'&&row.state==='different'))advice.push({title:'时区读数不一致',text:'核对手动时区与当前出口。切换系统代理不会自动改变已打开网页的区域设置，重新应用环境后检查。'});
 if(rows.some(row=>row.state==='unknown')||observed.worker.error)advice.push({title:'部分项目尚未读取',text:'等待页面完成加载后重试。网页权限、协议和后台上下文可能限制读取，未读取不代表通过。'});
 return {checkedAt:Date.now(),engine,url:address,rows,advice,differences:rows.filter(row=>row.state==='different').length,unknown:rows.filter(row=>row.state==='unknown').length,workerError:observed.worker.error||'',webgpu:observed.webgpu,targetErrors};
}
async function auditElectron(wc){
 const fp=wc.__tfbFingerprint;if(!fp)throw new Error('这个标签的指纹尚未就绪，请等待加载后重试');
 if(wc.isLoading())throw new Error('页面仍在加载，请完成后再检查');if(!/^https?:/.test(wc.getURL()))throw new Error('打开一个 HTTP 或 HTTPS 网页后再检查');
 const value=await wc.debugger.sendCommand('Runtime.evaluate',{expression:readSource(fp),returnByValue:true,awaitPromise:true,timeout:7000});
 if(value.exceptionDetails||!value.result?.value)throw new Error('网页检查失败，请重新加载后重试');
 return report(fp,value.result.value,{engine:'内置 Chromium '+process.versions.chrome,url:wc.getURL(),zoom:wc.getZoomFactor(),targetErrors:wc.__starTargetErrors});
}
function cleanUrl(url){try{const clean=new URL(url);return clean.origin+clean.pathname;}catch{return '';}}
async function chromeTargets(running){
 if(!running||running.pipe.closed)throw new Error('这个环境的本机 Chrome 已停止，请重新启动');
 const {targetInfos}=await running.pipe.send('Target.getTargets');return targetInfos.filter(t=>t.type==='page'&&/^https?:/.test(t.url));
}
async function chromePages(running){return (await chromeTargets(running)).map(target=>({id:target.targetId,title:target.title||'未命名网页',url:cleanUrl(target.url)}));}
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
 const current=await running.pipe.send('Target.getTargetInfo',{targetId:target.targetId});
 if(current.targetInfo.url!==target.url)throw new Error('所选网页在检查期间跳转，请重新检查');
 return {...report(running.fingerprint,result.result.value,{engine:'本机 Chrome '+running.fingerprint.chromeVersion,url:target.url,zoom:result.result.value.page.dpr/running.fingerprint.devicePixelRatio,targetErrors:running.targetErrors||[]}),targetId:target.targetId,title:current.targetInfo.title||'未命名网页'};
}
module.exports={readSource,report,auditElectron,auditChrome,chromePages};
