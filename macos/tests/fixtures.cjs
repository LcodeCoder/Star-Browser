'use strict';
const net = require('node:net');
const http = require('node:http');

async function listen(server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server, port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function startOrigin() {
  const requests = [];
  const fixture = await listen(http.createServer((req, res) => {
    requests.push({url: req.url, headers: req.headers});
    // Deliberately unresolved subframe for document-readiness regression.
    if(req.url.startsWith('/background-frame')) return;
    if(req.url.startsWith('/client-hints')){
      res.writeHead(200,{'Content-Type':'application/json','Accept-CH':'Sec-CH-UA-Arch, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List'});res.end(JSON.stringify(req.headers));return;
    }
    if(req.url.startsWith('/silence.wav')){
      const bytes=32000,sound=Buffer.alloc(44+bytes,128);sound.write('RIFF',0);sound.writeUInt32LE(36+bytes,4);sound.write('WAVEfmt ',8);sound.writeUInt32LE(16,16);sound.writeUInt16LE(1,20);sound.writeUInt16LE(1,22);sound.writeUInt32LE(8000,24);sound.writeUInt32LE(8000,28);sound.writeUInt16LE(1,32);sound.writeUInt16LE(8,34);sound.write('data',36);sound.writeUInt32LE(bytes,40);
      res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':sound.length});res.end(sound);return;
    }
    if(req.url.startsWith('/fingerprint-worker.js')||req.url.startsWith('/fingerprint-module.js')){
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Service-Worker-Allowed':'/','Accept-CH':'Sec-CH-UA-Arch, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List'});
      const module=req.url.startsWith('/fingerprint-module.js');
      res.end((module?"import {dependency} from '/fingerprint-dependency.js';\n":'')+`
const read=()=>({markers:['installFingerprint','__FP_ACTIVE__','__FP_CONFIG__'].filter(key=>key in globalThis),ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date('2026-01-15T12:00:00Z').getTimezoneOffset()});
const first=read(),instance=crypto.randomUUID(),hintKeys=['architecture','bitness','platformVersion','model','wow64','fullVersionList','uaFullVersion','formFactors'];
const firstHints=navigator.userAgentData?.getHighEntropyValues(hintKeys);
async function semantics(){const fail=async run=>{try{await run();return false;}catch(error){return error instanceof TypeError;}};const getter=Object.getOwnPropertyDescriptor(WorkerNavigator.prototype,'deviceMemory').get;const data=navigator.userAgentData,proto=Object.getPrototypeOf(data);return {memoryReceiver:await fail(()=>getter.call({})),uaReceiver:await fail(()=>proto.getHighEntropyValues.call({},[])),uaOmitted:await fail(()=>data.getHighEntropyValues()),uaNull:await fail(()=>data.getHighEntropyValues(null)),uaNumber:await fail(()=>data.getHighEntropyValues(1)),jsonReceiver:await fail(()=>proto.toJSON.call({})),name:getter.name,length:getter.length,prototype:Object.hasOwn(getter,'prototype'),native:getter.toString().includes('[native code]'),toStringPrototype:Object.hasOwn(Function.prototype.toString,'prototype'),languagesStable:navigator.languages===navigator.languages,languagesFrozen:Object.isFrozen(navigator.languages),brandsFrozen:Object.isFrozen(data.brands),brandFrozen:Object.isFrozen(data.brands[0]),jsonBrandsFrozen:Object.isFrozen(data.toJSON().brands)};}
let connected=0;
async function snapshot(options={}){
 const scopeType=typeof ServiceWorkerGlobalScope!=='undefined'&&self instanceof ServiceWorkerGlobalScope?'service_worker':typeof SharedWorkerGlobalScope!=='undefined'&&self instanceof SharedWorkerGlobalScope?'shared_worker':'worker';
 const result={scopeType,...read(),first,hints:await firstHints,uaData:navigator.userAgentData?.toJSON(),instance,connected,semantics:await semantics(),module:${module?'dependency':"null"}};
 if(options.headers){await fetch('/client-hints?worker-opt-in');result.headers=await fetch('/client-hints?worker-read').then(r=>r.json());}
 if(options.nested)result.nested=await new Promise((resolve,reject)=>{const child=new Worker('/fingerprint-worker.js?nested');child.onmessage=e=>{child.terminate();resolve(e.data);};child.onerror=e=>reject(new Error(e.message));});
 return result;
}
if(typeof ServiceWorkerGlobalScope!=='undefined'&&self instanceof ServiceWorkerGlobalScope){
 self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
 self.addEventListener('message',event=>event.waitUntil(snapshot(event.data).then(value=>event.ports[0].postMessage(value)).catch(error=>event.ports[0].postMessage({error:error.message}))));
 self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/service-snapshot')event.respondWith(snapshot({headers:true}).then(value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})));});
}else if(typeof SharedWorkerGlobalScope!=='undefined'&&self instanceof SharedWorkerGlobalScope){
 self.onconnect=event=>{connected++;const port=event.ports[0];port.onmessage=event=>snapshot(event.data).then(value=>port.postMessage(value)).catch(error=>port.postMessage({error:error.message}));port.start();snapshot().then(value=>port.postMessage(value)).catch(error=>port.postMessage({error:error.message}));};
}else{snapshot({nested:new URL(location.href).searchParams.has('parent')}).then(value=>postMessage(value));self.onmessage=event=>snapshot(event.data).then(value=>postMessage(value));}
`);return;
    }
    if(req.url.startsWith('/fingerprint-dependency.js')){res.writeHead(200,{'Content-Type':'text/javascript'});res.end("export const dependency='native-module-import';");return;}
    if(req.url.startsWith('/fingerprint-frame')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'"});
      res.end(`<!doctype html><script>parent.postMessage({starFrame:{markers:['installFingerprint','__FP_ACTIVE__','__FP_CONFIG__'].filter(key=>key in globalThis),ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:Array.from(navigator.languages),cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:new Intl.DateTimeFormat().resolvedOptions().locale,tz:new Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),screen:{width:screen.width,height:screen.height},dpr:devicePixelRatio,screenMedia:matchMedia('(device-width: 1600px) and (device-height: 900px)').matches,dprMedia:matchMedia('(resolution: 1.5dppx)').matches}},'*');</script>`);return;
    }
    if(req.url.startsWith('/sync')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<!doctype html><html><head><title>窗口同步验证</title><style>body{margin:0;height:3000px;font:16px sans-serif}button,input,a{position:absolute;left:20px;height:40px;box-sizing:border-box}#click{top:80px;width:160px}#text{top:150px;width:300px}#link{top:230px}#scrollTarget{position:absolute;top:2200px}</style></head><body><button id="click">点击计数 0</button><input id="text" aria-label="文本输入"><a id="link" href="/sync-next">跳转页面</a><div id="scrollTarget">滚动位置</div><script>window.syncClicks=0;window.trustedClicks=[];document.querySelector("#click").onclick=e=>{window.syncClicks++;window.trustedClicks.push(e.isTrusted);e.target.textContent="点击计数 "+window.syncClicks;};</script></body></html>');return;
    }
    if (req.url.startsWith('/download')) {
      const total=4*1024*1024,chunk=Buffer.alloc(64*1024,0x53);let sent=0;
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="star-qa.bin"','Content-Length':total,'Accept-Ranges':'bytes'});
      const timer=setInterval(()=>{if(sent>=total){clearInterval(timer);res.end();return;}res.write(chunk);sent+=chunk.length;},40);
      res.once('close',()=>clearInterval(timer));return;
    }
    if (req.url.startsWith('/geo')) {
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({status:'success',ip:'8.8.8.8',query:'8.8.8.8',country:'Japan',country_name:'Japan',country_code:'JP',countryCode:'JP',timezone:'Asia/Tokyo',time_zone:'Asia/Tokyo',offset:32400,city:'Tokyo',region:'Tokyo',regionName:'Tokyo',org:'AS64500 QA',isp:'QA',as:'AS64500 QA',hosting:false,proxy:false,mobile:false}));
      return;
    }
    if (req.url === '/status') {
      res.writeHead(201, {'Content-Type':'text/plain','Set-Cookie':'gateway=verified; Path=/','X-QA':'upstream'});
      res.write('first:');
      setImmediate(() => res.end('second'));
      return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html><head><title>macOS 浏览器测试页</title>
<script>window.early={markers:['installFingerprint','__FP_ACTIVE__','__FP_CONFIG__'].filter(key=>key in window),ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:navigator.languages,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,cores:navigator.hardwareConcurrency,width:screen.width,height:screen.height,webdriver:navigator.webdriver};</script>
</head><body><h1>macOS 浏览器测试页</h1><a id="popup" target="_blank" href="/popup">打开新标签</a><script>document.querySelector('h1').dataset.ready='yes';</script></body></html>`);
  }));
  return {...fixture, requests, url:`http://127.0.0.1:${fixture.port}`};
}

async function startSocks({user='qa-user',pass='qa-pass',fragmentReply=false}={}) {
  const authentications = [], connections = [];
  const upstreams = new Set();
  const fixture = await listen(net.createServer(client => {
    let buffer=Buffer.alloc(0), state='greet';
    const receive = chunk => {
      buffer=Buffer.concat([buffer,chunk]);
      while (true) {
        if (state==='greet') {
          if (buffer.length<2 || buffer.length<2+buffer[1]) return;
          const methods=buffer.subarray(2,2+buffer[1]);
          if (!methods.includes(2)) {client.end(Buffer.from([5,255]));return;}
          buffer=buffer.subarray(2+buffer[1]); state='auth';
          client.write(Buffer.from([5,2]));
        } else if (state==='auth') {
          if (buffer.length<2 || buffer.length<3+buffer[1]) return;
          const ul=buffer[1],pl=buffer[2+ul];
          if (buffer.length<3+ul+pl) return;
          const gotUser=buffer.subarray(2,2+ul).toString();
          const gotPass=buffer.subarray(3+ul,3+ul+pl).toString();
          authentications.push({user:gotUser,pass:gotPass});
          buffer=buffer.subarray(3+ul+pl);
          if (gotUser!==user || gotPass!==pass) {client.end(Buffer.from([1,1]));return;}
          state='connect'; client.write(Buffer.from([1,0]));
        } else if (state==='connect') {
          if (buffer.length<5) return;
          const type=buffer[3];
          const length=type===3 ? 5+buffer[4]+2 : type===1 ? 10 : 22;
          if (buffer.length<length) return;
          const host=type===3 ? buffer.subarray(5,5+buffer[4]).toString() : Array.from(buffer.subarray(4,8)).join('.');
          const port=buffer.readUInt16BE(length-2);
          connections.push({host,port});
          const rest=buffer.subarray(length);
          state='tunnel'; client.removeListener('data',receive);
          if(!['qa.local','127.0.0.1','localhost'].includes(host)){client.end(Buffer.from([5,4,0,1,0,0,0,0,0,0]));return;}
          const remote=net.connect(port,host==='qa.local'?'127.0.0.1':host,()=>{
            const reply=Buffer.from([5,0,0,1,127,0,0,1,0,0]);
            const connected=()=>{if(rest.length)remote.write(rest);client.pipe(remote);remote.pipe(client);};
            if (fragmentReply) {
              client.write(reply.subarray(0,5));
              setTimeout(()=>{client.write(reply.subarray(5));connected();},20);
            } else {client.write(reply);connected();}
          });
          upstreams.add(remote);
          remote.on('close',()=>upstreams.delete(remote));
          remote.on('error',()=>{client.end(Buffer.from([5,5,0,1,0,0,0,0,0,0]));});
          client.on('close',()=>remote.destroy());
          return;
        } else return;
      }
    };
    client.on('data',receive);
  }));
  const close=fixture.close;
  return {...fixture,authentications,connections,async close(){for(const socket of upstreams)socket.destroy();await close();}};
}

async function startHttpProxy({user='',pass=''}={}) {
  const requests=[];
  const expected=user?'Basic '+Buffer.from(user+':'+pass).toString('base64'):null;
  const fixture=await listen(http.createServer((req,res)=>{
    requests.push({url:req.url,authorization:req.headers['proxy-authorization']||''});
    let url;
    try{url=new URL(req.url);}catch{res.writeHead(400);res.end();return;}
    if(!['qa.local','127.0.0.1','localhost'].includes(url.hostname)){res.writeHead(204);res.end();return;}
    if(expected&&req.headers['proxy-authorization']!==expected){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="macOS test"'});res.end();return;}
    const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
    if(url.hostname==='qa.local')url.hostname='127.0.0.1';
    const upstream=http.request(url,{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  }));
  return {...fixture,requests};
}
module.exports={listen,startOrigin,startSocks,startHttpProxy};
