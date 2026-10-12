'use strict';
const {metadata}=require('./fingerprint-protocol');
const FILTER=[{type:'worker'},{type:'shared_worker'},{type:'iframe'},{exclude:true}];
function workerSource(fp){
 return `(()=>{const fp=${JSON.stringify(fp)},meta=${JSON.stringify(metadata(fp))};const proto=Object.getPrototypeOf(navigator);const values={userAgent:fp.userAgent,platform:fp.platform,language:fp.language,languages:Object.freeze(fp.languages.slice()),hardwareConcurrency:fp.hardwareConcurrency,deviceMemory:fp.deviceMemory};for(const [key,value]of Object.entries(values)){try{Object.defineProperty(proto,key,{get:()=>value,configurable:true,enumerable:true});}catch{}}if(navigator.userAgentData){const ua=Object.getPrototypeOf(navigator.userAgentData);for(const key of ['brands','platform','mobile'])try{Object.defineProperty(ua,key,{get:()=>structuredClone(meta[key]),configurable:true,enumerable:true});}catch{}ua.getHighEntropyValues=async hints=>{const out={brands:structuredClone(meta.brands),platform:meta.platform,mobile:meta.mobile};for(const key of hints||[]){if(key==='uaFullVersion')out[key]=meta.fullVersion;else if(key in meta)out[key]=structuredClone(meta[key]);}return out;};}return true;})()`;
}
async function configureTarget(rawSend,fp,type,pageSource){
 const send=(method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('后台协议超时：'+method)),3000);rawSend(method,params).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
 try{
  if(type==='iframe'){
   const {applyProtocol}=require('./fingerprint-protocol');await applyProtocol(send,fp,{metrics:false});await send('Page.addScriptToEvaluateOnNewDocument',{source:pageSource});
  }else{
   await send('Runtime.enable',{});
   const value=await send('Runtime.evaluate',{expression:workerSource(fp),returnByValue:true,timeout:3000});if(value.exceptionDetails)throw new Error('Worker 配置未应用：'+(value.exceptionDetails.text||'脚本执行失败'));
  }
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:FILTER}).catch(()=>{});
 }finally{await send('Runtime.runIfWaitingForDebugger',{}).catch(()=>{});}
}
async function bindElectronTargets(wc,fp,pageSource){
 if(wc.__starTargetsBound)return;wc.__starTargetsBound=true;const debuggerApi=wc.debugger;wc.__starTargetErrors=[];
 debuggerApi.on('message',(_event,method,params)=>{
  if(method!=='Target.attachedToTarget')return;
  const {sessionId,targetInfo}=params;configureTarget((method,params)=>debuggerApi.sendCommand(method,params,sessionId),fp,targetInfo.type,pageSource).catch(error=>{wc.__starTargetErrors.push({type:targetInfo.type,error:error.message});wc.__starTargetErrors=wc.__starTargetErrors.slice(-20);});
 });
 try{await debuggerApi.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'worker'},{type:'iframe'},{exclude:true}]});}catch(error){wc.__starTargetsBound=false;throw error;}
}
module.exports={workerSource,configureTarget,bindElectronTargets,FILTER};
