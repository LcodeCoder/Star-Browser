'use strict';
const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'star-hardware-headers-'));
const output = path.resolve('test-results/hardware-headers.json');
const results = [], requests = [];
let app, manager, port;
const policy = 'Device-Memory, Sec-CH-Device-Memory';
const server = http.createServer((request,response) => {
  const url = new URL(request.url,'http://localhost');
  requests.push({url:request.url,headers:request.headers});
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Accept-CH',policy);
  if(url.pathname === '/headers') {
    response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(request.headers));
  } else if(url.pathname === '/worker.js') {
    response.setHeader('Content-Type','text/javascript');
    response.end(`fetch('/headers?worker').then(r=>r.json()).then(headers=>postMessage({memory:navigator.deviceMemory,headers}));`);
  } else {
    response.setHeader('Content-Type','text/html');
    if(url.pathname === '/blocked') response.setHeader('Permissions-Policy','ch-device-memory=()');
    response.end(`<!doctype html><meta charset="utf-8"><title>Hardware headers probe</title><script>
      window.__hardwareHeaders=(async()=>({memory:navigator.deviceMemory,headers:await fetch('/headers?${url.pathname.slice(1)}').then(r=>r.json())}))();
    </script>`);
  }
});
async function check(name,run) {
  try {const detail=await run();results.push({name,status:'passed',detail});console.log('PASS',name);}
  catch(error){results.push({name,status:'failed',error:error.stack});throw error;}
}
async function api(method,...args) {return manager.evaluate(({method,args})=>window.api[method](...args),{method,args});}
async function guest(url) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    const id=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>!w.isDestroyed()&&w.getURL()===url)?.id,url);
    if(id) return id;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Guest did not navigate to '+url);
}
async function read(id,expression) {return app.evaluate(({webContents},{id,expression})=>webContents.fromId(id).executeJavaScript(expression),{id,expression});}
function memoryHeaders(headers) {return Object.fromEntries(Object.entries(headers).filter(([key])=>['device-memory','sec-ch-device-memory'].includes(key)));}
function assertMemory(headers,expected) {
  const actual=memoryHeaders(headers);
  for(const value of Object.values(actual)) assert.equal(Number(value),expected);
  return {state:Object.keys(actual).length?'observed':'not-emitted',headers:actual};
}
(async()=>{
 try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});port=server.address().port;
  app=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:data}});
  manager=await app.firstWindow();await manager.locator('#btnNew').waitFor();
  let profile,id,url;
  await check('初次请求不补发内存头，声明后保留浏览器实际发送决定',async()=>{
    url=`http://127.0.0.1:${port}/first?profile=one`;
    profile=await api('create',{name:'Header memory 2',startUrl:url,os:process.platform==='win32'?'win':'mac',fingerprint:{deviceMemory:2}});
    await api('browse',profile.id);id=await guest(url);
    const value=await read(id,'window.__hardwareHeaders');assert.equal(value.memory,2);
    const initial=requests.find(r=>r.url==='/first?profile=one');assert.ok(initial);assert.deepEqual(memoryHeaders(initial.headers),{});
    return {memory:value.memory,firstHeaders:memoryHeaders(initial.headers),optInHeaders:assertMemory(value.headers,2)};
  });
  await check('Worker 内存一致且请求头不绕过浏览器发送决定',async()=>{
    const value=await read(id,`new Promise((resolve,reject)=>{const worker=new Worker('/worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('Worker timeout'));},5000);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};})`);
    assert.equal(value.memory,2);return {memory:value.memory,headers:assertMemory(value.headers,2)};
  });
  await check('新的独立环境不继承前一环境的 Client Hints 声明或内存值',async()=>{
    const nextUrl=`http://127.0.0.1:${port}/first?profile=two`;
    const second=await api('create',{name:'Header memory 4',startUrl:nextUrl,os:process.platform==='win32'?'win':'mac',fingerprint:{deviceMemory:4}});
    await api('browse',second.id);const secondId=await guest(nextUrl);const value=await read(secondId,'window.__hardwareHeaders');
    const initial=requests.find(r=>r.url==='/first?profile=two');assert.ok(initial);assert.deepEqual(memoryHeaders(initial.headers),{});assert.equal(value.memory,4);
    await api('action','stop',[second.id]);return {memory:value.memory,firstHeaders:memoryHeaders(initial.headers),optInHeaders:assertMemory(value.headers,4)};
  });
  await check('Permissions Policy 禁止内存头时，应用不会补发已被浏览器禁止的值',async()=>{
    const blocked=`http://127.0.0.1:${port}/blocked`;
    await app.evaluate(async({webContents},{id,blocked})=>{await webContents.fromId(id).loadURL(blocked);},{id,blocked});
    const value=await read(id,'window.__hardwareHeaders');assert.equal(value.memory,2);assert.deepEqual(memoryHeaders(value.headers),{});
    return {memory:value.memory,blockedHeaders:memoryHeaders(value.headers)};
  });
  await api('action','stop',[profile.id]);
  await check('本机 Chrome 被动诊断原生内存头差异，审计不增加探测请求',async()=>{
    await api('launch',profile.id);
    const ready=await app.evaluate(async(_,{id})=>{
      const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
      const running=require('./src/main/launcher').getLaunchedBrowser(id);
      const {targetInfos}=await running.pipe.send('Target.getTargets');const target=targetInfos.find(t=>t.type==='page'&&t.url.includes('/first?profile=one'));
      const attached=running.pageSessions.get(target.targetId);await attached.ready;
      const value=await running.pipe.send('Runtime.evaluate',{expression:'window.__hardwareHeaders',awaitPromise:true,returnByValue:true},attached.sessionId);
      return {targetId:target.targetId,value:value.result.value};
    },{id:profile.id});
    const actual=assertMemory(ready.value.headers,Number(ready.value.headers['device-memory']||ready.value.headers['sec-ch-device-memory']));
    assert.equal(actual.state,'observed');assert.equal(ready.value.memory,2);
    const before=requests.length;const audit=await api('fingerprintAudit',profile.id,ready.targetId);assert.equal(requests.length,before);
    const rows=audit.rows.filter(row=>row.context==='网络请求头');assert.ok(rows.length>0);
    for(const row of rows){assert.equal(row.expected,2);assert.equal(row.actual,Number(ready.value.headers['device-memory']||ready.value.headers['sec-ch-device-memory']));assert.equal(row.state,row.actual===2?'match':'different');}
    assert.ok(!JSON.stringify(audit.network).includes('profile=one'));
    await manager.locator(`[data-profile-id="${profile.id}"] .profile-name`).click();
    await manager.getByRole('tab',{name:'指纹',exact:true}).click();
    await manager.getByRole('button',{name:'刷新网页列表',exact:true}).waitFor();
    await manager.getByRole('button',{name:'检查所选网页',exact:true}).click();
    await manager.getByText('内存请求头与页面不同',{exact:true}).waitFor();
    const group=manager.locator('.audit-group').filter({hasText:'网络请求头'});assert.ok(await group.isVisible());assert.match(await group.innerText(),/2 项需检查/);
    fs.mkdirSync(path.resolve('test-results/hardware-headers'),{recursive:true});
    for(const theme of ['light','dark']){
      await api('preferences',{theme});await manager.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
      await manager.screenshot({path:path.resolve('test-results/hardware-headers/network-'+theme+'.png'),animations:'disabled'});
      const overflow=await group.evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=1,'Network audit must fit the detail panel');
    }
    await api('action','stop',[profile.id]);return {pageMemory:2,nativeHeaders:actual.headers,rows,auditAddsRequests:false,uiThemes:['light','dark']};
  });
 }catch(error){console.error(error);process.exitCode=1;}
 finally{
  if(app)await app.close().catch(()=>{});
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),electronNativeMemoryHeaderObserved:results.some(row=>row.detail?.optInHeaders?.state==='observed'||row.detail?.headers?.state==='observed'),results},null,2)+'\n');
  fs.rmSync(data,{recursive:true,force:true});
 }
})();
