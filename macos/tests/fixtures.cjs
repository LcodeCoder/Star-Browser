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
<script>window.early={ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:navigator.languages,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,cores:navigator.hardwareConcurrency,width:screen.width,height:screen.height,webdriver:navigator.webdriver};</script>
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
