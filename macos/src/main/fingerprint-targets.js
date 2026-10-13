'use strict';
const {metadata,applyProtocol}=require('./fingerprint-protocol');
const {fingerprintSource}=require('./fingerprint-runtime');
// Shared/Service Workers are covered by the browser connection, not page autoattach.
const FILTER=[{type:'worker'},{type:'iframe'},{exclude:true}];
const BROWSER_FILTER=[{type:'page'},{type:'worker'},{type:'shared_worker'},{type:'service_worker'},{type:'iframe'},{exclude:true}];
function isWebsiteTarget(info){return !/^(chrome-extension|devtools|chrome|edge):/.test(info.url||'');}
function workerSource(fp,{protocolManaged=true}={}){
 return fingerprintSource({...fp,userAgentMetadata:metadata(fp),protocolManaged});
}
async function configureTarget(send,fp,type,pageSource,{filter=FILTER,protocolManaged}={}) {
 try{
  if(type==='iframe'){
   await send('Page.enable',{});await send('Runtime.enable',{});
   await applyProtocol(send,fp,{metrics:false});

   await send('Page.addScriptToEvaluateOnNewDocument',{source:pageSource,runImmediately:true});
  }else{
   await send('Runtime.enable',{});
   await applyProtocol(send,fp,{metrics:false,worker:true});
   // Some worker agents accept the UA override but leave WorkerNavigator unchanged.
   // Only use JS for these values when a native read proves that it is necessary.
   if(protocolManaged===undefined){
    const native=await send('Runtime.evaluate',{expression:'({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages)})',returnByValue:true});
    if(native.exceptionDetails)throw new Error('无法读取 Worker 原生配置');
    const value=native.result?.value;
    protocolManaged=!!value&&value.ua===fp.userAgent&&value.platform===fp.platform&&value.language===fp.language&&JSON.stringify(value.languages)===JSON.stringify(fp.languages);
   }
   const installed=await send('Runtime.evaluate',{expression:workerSource(fp,{protocolManaged}),returnByValue:true,timeout:5000});
   if(installed.exceptionDetails)throw new Error('Worker 配置未应用：'+(installed.exceptionDetails.text||'脚本执行失败'));
  }
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter});
 }finally{await send('Runtime.runIfWaitingForDebugger',{}).catch(()=>{});}
 return {protocolManaged};
}
module.exports={workerSource,configureTarget,isWebsiteTarget,FILTER,BROWSER_FILTER};
