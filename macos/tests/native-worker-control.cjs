'use strict';
// Independent stock Electron process; no preload, extension, fingerprint source
// or application main code. Only the same native CDP configuration is applied.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {CdpSocket}=require('../src/main/cdp-socket');const {applyProtocol}=require('../src/main/fingerprint-protocol');
async function until(fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error('Native Worker control timeout');}
async function nativeWorkerControl(origin,fp){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-native-worker-control-'));let child,pipe,stderr='';
 try{
  const main=path.join(dir,'main.cjs');fs.writeFileSync(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(dir)});app.commandLine.appendSwitch('remote-debugging-port','0');let window;app.whenReady().then(()=>{window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});window.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(require('electron'),[main],{env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3000);});
  const endpoint=await until(()=>{try{const lines=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n');return 'ws://127.0.0.1:'+lines[0]+lines[1];}catch{return null;}});pipe=new CdpSocket(endpoint);await pipe.ready;
  const jobs=new Map(),errors=[],targets=[];
  pipe.on('message',message=>{if(message.method==='Target.attachedToTarget'){
   const {sessionId,targetInfo}=message.params;targets.push(targetInfo.type);const send=(method,params)=>pipe.send(method,params,sessionId);
   const job=(async()=>{try{await send('Runtime.enable',{});if(targetInfo.type==='page')await send('Page.enable',{});await applyProtocol(send,fp,{metrics:targetInfo.type==='page',worker:targetInfo.type!=='page'});if(targetInfo.type==='page')await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'worker'},{exclude:true}]});}finally{await send('Runtime.runIfWaitingForDebugger',{}).catch(()=>{});}})();jobs.set(targetInfo.targetId,{sessionId,job,type:targetInfo.type});job.catch(error=>errors.push({type:targetInfo.type,error:error.message}));
  }});
  await pipe.send('Target.setDiscoverTargets',{discover:true});await pipe.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page'},{type:'worker'},{type:'shared_worker'},{type:'service_worker'},{exclude:true}]});
  const page=await until(async()=>{const target=(await pipe.send('Target.getTargets')).targetInfos.find(t=>t.type==='page');return target&&jobs.get(target.targetId);});await page.job;
  async function evaluate(expression){const result=await pipe.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},page.sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
  await pipe.send('Page.navigate',{url:origin.url+'/probe?native-control'},page.sessionId);await until(()=>evaluate('document.readyState==="complete"'));
  const worker=await evaluate(`new Promise((resolve,reject)=>{const worker=new Worker('/fingerprint-worker.js?native-control');worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=e=>reject(new Error(e.message));})`);
  const shared_worker=await evaluate(`new Promise((resolve,reject)=>{const worker=new SharedWorker('/fingerprint-worker.js?native-shared');worker.port.start();worker.port.onmessage=e=>{worker.port.close();resolve(e.data);};worker.onerror=e=>reject(new Error(e.message));})`);
  const service_worker=await evaluate(`(async()=>{const registration=await navigator.serviceWorker.register('/fingerprint-worker.js?native-service',{scope:'/'});await navigator.serviceWorker.ready;const worker=await new Promise(resolve=>{const wait=()=>registration.active?.state==='activated'?resolve(registration.active):setTimeout(wait,20);wait();});return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data);};worker.postMessage({},[channel.port2]);});})()`);
  return {version:await pipe.send('Browser.getVersion'),noInjection:true,errors,targets,semantics:{worker:worker.semantics,shared_worker:shared_worker.semantics,service_worker:service_worker.semantics},values:{worker,shared_worker,service_worker}};
 }catch(error){throw new Error(error.message+'\n'+stderr);}
 finally{await pipe?.send('Browser.close').catch(()=>{});pipe?.close();if(child)await until(()=>child.exitCode!==null||child.signalCode!==null,6000).catch(()=>child.kill());fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={nativeWorkerControl};
