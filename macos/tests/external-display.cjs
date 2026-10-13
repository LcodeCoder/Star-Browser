'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'star-external-display-'));const results=[],limitations=[];let app,manager,origin;
async function api(method,...args){return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function until(fn){const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error('External display timeout');}
async function check(name,fn){const started=Date.now();try{const detail=await fn();results.push({name,status:'passed',detail,durationMs:Date.now()-started});console.log('PASS',name);}catch(error){results.push({name,status:'failed',error:error.stack});throw error;}}
async function evaluate(id,expression,{frame=false}={}){
 return app.evaluate(async(_,{id,expression,frame})=>{
  const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const running=require('./src/main/launcher').getLaunchedBrowser(id);
  if(!running)throw new Error('External browser is unavailable');
  const targets=(await running.pipe.send('Target.getTargets')).targetInfos;
  const target=targets.find(t=>t.type===(frame?'iframe':'page')&&t.url.includes(frame?'/display-frame':'/display-page'));
  if(!target)return null;
  const attached=frame?[...running.targetSessions.values()].find(t=>t.targetInfo.targetId===target.targetId):running.pageSessions.get(target.targetId);
  if(!attached)return null;await attached.ready;
  const response=await running.pipe.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},attached.sessionId);
  if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
  return response.result.value;
 },{id,expression,frame});
}
const read=dpr=>`({dpr:devicePixelRatio,css:matchMedia('(resolution: ${dpr}dppx)').matches,screen:{width:screen.width,height:screen.height},screenCss:matchMedia('(device-width: 1600px) and (device-height: 900px)').matches,nativeGetter:Object.getOwnPropertyDescriptor(window,'devicePixelRatio').get.toString().includes('[native code]'),buttonWidth:document.querySelector('button').getBoundingClientRect().width})`;
(async()=>{
 try{
  origin=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Display verification</title><style>button{width:120px;height:40px;margin:0;padding:0;border:0}</style><button>Layout target</button>');});await new Promise(r=>origin.listen(0,'127.0.0.1',r));const port=origin.address().port;
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data,TFB_TEST_ORIGIN_PORT:String(port)}});manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  const profiles=[];
  for(const dpr of [1.5,1.25]){
   const profile=await api('create',{name:'原生缩放 '+dpr,os:'mac',country:'FR',language:'fr-FR',langManual:true,timezone:'Europe/Paris',timezoneManual:true,startUrl:`http://localhost:${port}/display-page`,fingerprint:{devicePixelRatio:dpr,screen:{width:1600,height:900}}});profiles.push(profile);
   await check('独立 Chrome '+dpr+' DPR 与跨进程框架 CSS 一致',async()=>{
    await api('launch',profile.id);await until(()=>evaluate(profile.id,'document.readyState==="complete"'));await evaluate(profile.id,`new Promise(resolve=>{const frame=document.createElement('iframe');frame.src='http://127.0.0.1:${port}/display-frame';frame.onload=()=>resolve(true);document.body.append(frame);})`);
    const top=await evaluate(profile.id,read(dpr)),frame=await until(()=>evaluate(profile.id,read(dpr),{frame:true}));
    for(const value of [top,frame]){assert.equal(value.dpr,dpr);assert.equal(value.css,true);assert.equal(value.nativeGetter,true);assert.deepEqual(value.screen,{width:1600,height:900});assert.equal(value.buttonWidth,120);}
    if(!frame.screenCss)limitations.push({profileId:profile.id,surface:'OOPIF screen CSS',expected:'1600 × 900',actual:frame.screenCss,reason:'Native screen dimensions still require the prepared display policy; JS getters do not change CSS media queries.'});return {top,frame,oopif:true};
   });
  }
  await check('两个独立进程的 DPR 策略相互隔离',async()=>{const first=await evaluate(profiles[0].id,read(1.5),{frame:true}),second=await evaluate(profiles[1].id,read(1.25),{frame:true});assert.equal(first.dpr,1.5);assert.equal(second.dpr,1.25);return {first,second};});
  await check('关闭后重开保持原生 DPR 与 CSS，像素比 getter 未注入',async()=>{const id=profiles[0].id;await api('action','stop',[id]);await api('launch',id);await until(()=>evaluate(id,'document.readyState==="complete"'));await evaluate(id,`new Promise(resolve=>{const frame=document.createElement('iframe');frame.src='http://127.0.0.1:${port}/display-frame';frame.onload=()=>resolve(true);document.body.append(frame);})`);const frame=await until(()=>evaluate(id,read(1.5),{frame:true}));assert.equal(frame.dpr,1.5);assert.equal(frame.css,true);assert.equal(frame.nativeGetter,true);return frame;});
 }catch(error){console.error(error);process.exitCode=1;}
 finally{
  if(app){await app.evaluate(async({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');await Promise.all(require('./src/main/launcher').getLaunchedBrowsers().map(async([,browser])=>{await browser.pipe.send('Browser.close').catch(()=>browser.child.kill());for(let i=0;i<150&&browser.child.exitCode===null&&browser.child.signalCode===null;i++)await new Promise(r=>setTimeout(r,30));if(browser.child.exitCode===null&&browser.child.signalCode===null)browser.child.kill();}));}).catch(()=>{});await app.close().catch(()=>{});}
  if(origin)await new Promise(r=>origin.close(r));fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/external-display.json',JSON.stringify({testedAt:new Date().toISOString(),status:process.exitCode?'failed':limitations.length?'partial':'passed',results,limitations},null,2));fs.rmSync(data,{recursive:true,force:true});
 }
})();
