'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {CdpSocket}=require('./cdp-socket');
const {configureTarget,isWebsiteTarget,FILTER}=require('./fingerprint-targets');
let controller,connecting;

function enableFingerprintChannel(app) {
  // Shared Workers have no page debugger/preload hook. A browser connection is required.
  if(!app.commandLine.hasSwitch('remote-debugging-port'))app.commandLine.appendSwitch('remote-debugging-port','0');
  app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
}
function readEndpoint(port) {
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/json/version',timeout:1000},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>65536)req.destroy(new Error('浏览器配置地址无效'));});
      response.on('end',()=>{try{const value=JSON.parse(body);const url=new URL(value.webSocketDebuggerUrl);url.hostname='127.0.0.1';resolve(url.href);}catch(error){reject(error);}});
    });
    req.on('timeout',()=>req.destroy(new Error('等待浏览器配置通道超时')));req.on('error',reject);
  });
}
async function connect(app) {
  if(controller&&!controller.pipe.closed)return controller;
  if(connecting)return connecting;
  connecting=(async()=>{
    const end=Date.now()+7000;let endpoint,lastError;
    while(Date.now()<end&&!endpoint){
      try{
        const configured=Number(app.commandLine.getSwitchValue('remote-debugging-port'));
        const port=configured||Number(fs.readFileSync(path.join(app.getPath('userData'),'DevToolsActivePort'),'utf8').split('\n')[0]);
        if(!Number.isInteger(port)||port<1||port>65535)throw new Error('浏览器配置端口尚未就绪');
        endpoint=await readEndpoint(port);
      }catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,40));}
    }
    if(!endpoint)throw new Error('无法准备 Worker 配置通道：'+lastError?.message);
    const pipe=new CdpSocket(endpoint);await pipe.ready;
    const state={pipe,contexts:new Map(),pages:new Map(),targets:new Map()};
    pipe.on('message',message=>{
      if(message.method==='Target.attachedToTarget'){
        const {sessionId,targetInfo}=message.params;
        const owner=state.contexts.get(targetInfo.browserContextId)||state.targets.get(message.sessionId)?.owner||state.pages.get(message.sessionId)?.owner;
        if(targetInfo.type==='webview'||targetInfo.type==='page')return;
        if(!owner||!isWebsiteTarget(targetInfo)){
          pipe.send('Runtime.runIfWaitingForDebugger',{},sessionId).catch(()=>{});
          // Do not keep extension or management targets attached.
          pipe.send('Target.detachFromTarget',{sessionId}).catch(()=>{});return;
        }
        const target={sessionId,targetInfo,owner};state.targets.set(sessionId,target);
        configureWorker(state,target);
      }
      const worker=state.targets.get(message.sessionId);
      if(worker&&message.method==='Runtime.executionContextsCleared')worker.active=false;
      if(worker&&message.method==='Runtime.executionContextCreated'){worker.active=true;worker.contextId=message.params.context.id;}
      if(worker&&message.method==='Runtime.executionContextDestroyed'&&message.params.executionContextId===worker.contextId){worker.active=false;worker.needsRestart=worker.targetInfo.type!=='iframe';}
      if(worker&&worker.targetInfo.type!=='iframe'&&message.method==='Runtime.executionContextsCleared'&&!worker.configuring)worker.needsRestart=true;
      if(worker&&message.method==='Runtime.executionContextCreated'&&worker.needsRestart&&!worker.configuring){worker.needsRestart=false;configureWorker(state,worker);}
      if(message.method==='Target.targetDestroyed')for(const [sessionId,target] of state.targets)if(target.targetInfo.targetId===message.params.targetId)state.targets.delete(sessionId);
      if(message.method==='Target.targetInfoChanged')for(const target of state.targets.values())if(target.targetInfo.targetId===message.params.targetInfo.targetId)target.targetInfo=message.params.targetInfo;
      if(message.method==='Target.detachedFromTarget'){
        const page=state.pages.get(message.params.sessionId);
        state.targets.delete(message.params.sessionId);state.pages.delete(message.params.sessionId);
        if(page)for(const target of state.targets.values())if(target.owner===page.owner&&target.active!==false&&['shared_worker','service_worker'].includes(target.targetInfo.type))configureWorker(state,target);
      }
    });
    // Page connections take care of dedicated/nested Workers and out-of-process frames.
    try{
      await pipe.send('Target.setDiscoverTargets',{discover:true});
      await pipe.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'shared_worker'},{type:'service_worker'},{type:'iframe'},{exclude:true}]});
    }catch(error){pipe.close();throw error;}
    controller=state;
    pipe.on('closed',()=>{for(const owner of state.contexts.values())for(const wc of owner.contents)if(!wc.isDestroyed())wc.__tfbFpInjected=false;});
    app.once('will-quit',()=>pipe.close());
    return state;
  })();
  try{return await connecting;}finally{connecting=null;}
}
function configureWorker(state,target){
  const previous=target.ready;
  target.configuring=true;
  const job=(async()=>{
    if(previous)await previous.catch(()=>{});
    const result=await configureTarget((method,params)=>state.pipe.send(method,params,target.sessionId),target.owner.session.__tfbFp,target.targetInfo.type,target.owner.source(),{filter:FILTER,protocolManaged:target.protocolManaged});
    target.protocolManaged=result.protocolManaged;
  })();
  target.ready=job;
  job.catch(error=>recordError(target.owner,target.targetInfo,error)).finally(()=>{if(target.ready===job)target.configuring=false;});
}
function recordError(owner,info,error) {
  owner.errors.push({type:info.type,error:error.message});owner.errors.splice(0,Math.max(0,owner.errors.length-20));
}
async function prepareElectronFingerprint(app,wc,fp,sourceFor) {
  const state=await connect(app);
  const {targetInfo}=await wc.debugger.sendCommand('Target.getTargetInfo');
  const contextId=targetInfo.browserContextId;
  if(!contextId)throw new Error('无法识别浏览环境分区');
  let owner=state.contexts.get(contextId);
  if(!owner){const session=wc.session;owner={session,contents:new Set(),errors:[],source:()=>sourceFor(session.__tfbFp||fp)};state.contexts.set(contextId,owner);}
  owner.contents.add(wc);wc.__starTargetErrors=owner.errors;
  wc.once('destroyed',()=>owner.contents.delete(wc));
  let page=[...state.pages.values()].find(item=>item.targetId===targetInfo.targetId);
  if(!page){
    const attached=await state.pipe.send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:true});
    page={sessionId:attached.sessionId,targetId:targetInfo.targetId,owner};state.pages.set(page.sessionId,page);
  }
  const send=(method,params)=>state.pipe.send(method,params,page.sessionId);
  await send('Page.enable');
  await require('./fingerprint-protocol').applyProtocol(send,fp);
  await require('./display-settings').captureDisplay(send,fp,wc.getZoomFactor());
  if(page.scriptId)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:page.scriptId});
  page.scriptId=(await send('Page.addScriptToEvaluateOnNewDocument',{source:sourceFor(fp),runImmediately:true})).identifier;
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:FILTER});
  await Promise.all([...state.targets.values()].filter(t=>t.owner===owner&&t.active!==false&&['shared_worker','service_worker'].includes(t.targetInfo.type)).map(async target=>{await target.ready.catch(()=>{});configureWorker(state,target);await target.ready.catch(()=>{});}));
  wc.__starFingerprintSession=page.sessionId;
  return page;
}
async function electronWorkerObservations(wc,expression,frameExpression){
  if(!controller||controller.pipe.closed)return [];
  let origin;try{origin=new URL(wc.getURL()).origin;}catch{return [];}
  const page=controller.pages.get(wc.__starFingerprintSession);
  function belongs(target){
    let parent=target.targetInfo.parentId;
    for(let i=0;parent&&i<30;i++){
      if(parent===page?.targetId)return true;
      parent=[...controller.targets.values()].find(t=>t.targetInfo.targetId===parent)?.targetInfo.parentId;
    }
    return false;
  }
  const targets=[...controller.targets.values()].filter(target=>{
    if(target.active===false||target.owner.session!==wc.session)return false;
    if(target.targetInfo.type==='iframe')return belongs(target);
    if(!['shared_worker','service_worker'].includes(target.targetInfo.type))return false;
    try{return new URL(target.targetInfo.url).origin===origin;}catch{return false;}
  });
  return Promise.all(targets.map(async target=>{
    const item={type:target.targetInfo.type,url:target.targetInfo.url};
    try{
      await target.ready;
      const info=await controller.pipe.send('Target.getTargetInfo',{targetId:target.targetInfo.targetId});item.url=info.targetInfo.url;
      const response=await controller.pipe.send('Runtime.evaluate',{expression:item.type==='iframe'?frameExpression:expression,awaitPromise:true,returnByValue:true},target.sessionId);
      if(response.exceptionDetails)throw new Error('后台上下文读取失败');item.value=response.result?.value;if(!item.value)throw new Error('后台上下文没有返回读值');
    }catch(error){item.error=error.message;}return item;
  }));
}
module.exports={enableFingerprintChannel,prepareElectronFingerprint,electronWorkerObservations};
