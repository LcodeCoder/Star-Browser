'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const net=require('node:net'),http=require('node:http'),https=require('node:https');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {probeProxy}=require('../src/main/proxy-readiness');
const {getGateway,closeGateways}=require('../src/main/local-proxy');
const {listen,startOrigin,startHttpProxy,startSocks}=require('./fixtures.cjs');

test('HTTP 代理验证转发与完整 UTF-8 凭据，407 明确报告鉴权失败',async()=>{
 const origin=await startOrigin(),user=' account ',pass=' 密码 '+ '密'.repeat(200),proxy=await startHttpProxy({user,pass});
 try{
  const input={type:'http',host:'127.0.0.1',port:proxy.port,user,pass};
  const good=await probeProxy(input,{targetUrl:origin.url});assert.equal(good.ok,true);assert.equal(good.status,200);assert.equal(proxy.requests[0].authorization,'Basic '+Buffer.from(user+':'+pass).toString('base64'));
  const bad=await probeProxy({...input,pass:'incorrect'},{targetUrl:origin.url});assert.equal(bad.ok,false);assert.equal(bad.code,'authentication');assert.match(bad.error,/账号或密码/);
 }finally{await proxy.close();await origin.close();}
});
test('SOCKS5 通过鉴权、目标 CONNECT 与 HTTP 响应验证，错误密码失败',async()=>{
 const origin=await startOrigin(),proxy=await startSocks({fragmentReply:true});
 try{
  const input={type:'socks5',host:'127.0.0.1',port:proxy.port,user:'qa-user',pass:'qa-pass'};
  const good=await probeProxy(input,{targetUrl:origin.url+'/status'});assert.equal(good.ok,true);assert.equal(good.status,201);assert.equal(proxy.connections[0].port,origin.port);
  const bad=await probeProxy({...input,pass:'wrong'},{targetUrl:origin.url});assert.equal(bad.code,'authentication');assert.equal(bad.ok,false);
 }finally{await proxy.close();await origin.close();}
});
test('无鉴权 SOCKS5 请求正确方法，端口连通但协议无效仍失败',async()=>{
 const methods=[];
 const proxy=await listen(net.createServer(socket=>{let stage=0,buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(stage===0&&buffer.length>=3){methods.push(buffer[2]);buffer=Buffer.alloc(0);stage=1;socket.write(Buffer.from([5,0]));}else if(stage===1&&buffer.length>=7){buffer=Buffer.alloc(0);stage=2;socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,80]));}else if(stage===2&&buffer.includes(Buffer.from('\r\n\r\n'))){stage=3;socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n');}});}));
 const invalid=await listen(net.createServer(socket=>socket.end('not a proxy')));
 try{
  const good=await probeProxy({type:'socks5',host:'127.0.0.1',port:proxy.port},{timeout:1000});assert.equal(good.ok,true);assert.equal(methods[0],0);
  const bad=await probeProxy({type:'socks5',host:'127.0.0.1',port:invalid.port},{timeout:1000});assert.equal(bad.ok,false);
 }finally{await proxy.close();await invalid.close();}
});
test('期限与取消关闭挂起连接，不遗留 20 秒的 SOCKS5 握手',async()=>{
 let live=0;const proxy=await listen(net.createServer(socket=>{live++;socket.on('close',()=>live--);socket.resume();}));
 try{
  for(const type of ['http','socks5']){
   const input={type,host:'127.0.0.1',port:proxy.port,user:type==='socks5'?'qa':''};
   const result=await probeProxy(input,{timeout:50});assert.equal(result.code,'timeout');assert.ok(result.durationMs<600,result.durationMs);
   const controller=new AbortController();const pending=probeProxy(input,{timeout:5000,signal:controller.signal});setTimeout(()=>controller.abort(),20);const cancelled=await pending;assert.equal(cancelled.code,'cancelled');assert.ok(cancelled.durationMs<600);
  }
  const deadline=Date.now()+500;while(live&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(live,0);
 }finally{await proxy.close();}
});
test('HTTPS 代理验证 TLS，可信本地证书转发成功，默认不接受自签证书',async t=>{
 if(spawnSync('openssl',['version'],{stdio:'ignore'}).status!==0){t.skip('OpenSSL is unavailable for the local TLS fixture');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-proxy-tls-'));let proxy,origin;
 try{
  const config=path.join(dir,'openssl.cnf');fs.writeFileSync(config,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n');
  const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',config,'-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem')],{encoding:'utf8',timeout:15000});assert.equal(generated.status,0,generated.stderr);
  const ca=fs.readFileSync(path.join(dir,'cert.pem'));origin=await startOrigin();
  proxy=await listen(https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:ca},(request,response)=>{const target=new URL(request.url);http.get(target,upstream=>{response.writeHead(upstream.statusCode);upstream.pipe(response);}).on('error',()=>{response.writeHead(502);response.end();});}));
  const input={type:'https',host:'127.0.0.1',port:proxy.port};const untrusted=await probeProxy(input,{targetUrl:origin.url,timeout:1000});assert.equal(untrusted.ok,false);
  const trusted=await probeProxy(input,{targetUrl:origin.url,ca});assert.equal(trusted.ok,true);assert.equal(trusted.status,200);
 }finally{if(proxy)await proxy.close();if(origin)await origin.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('并发网关只创建一个端口，凭据分隔符不导致两个环境共享错误网关',async()=>{
 const origin=await startOrigin(),proxy=await startSocks({user:'a|b',pass:'c'});
 async function request(port){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:origin.url,headers:{Connection:'close'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});}
 try{
  const first={type:'socks5',host:'127.0.0.1',port:proxy.port,user:'a|b',pass:'c'};
  const ports=await Promise.all(Array.from({length:8},()=>getGateway(first)));assert.equal(new Set(ports).size,1);assert.equal(await request(ports[0]),200);
  const other=await getGateway({...first,user:'a',pass:'b|c'});assert.notEqual(other,ports[0]);assert.equal(await request(other),502);assert.ok(proxy.authentications.some(auth=>auth.user==='a'&&auth.pass==='b|c'));
 }finally{closeGateways();await proxy.close();await origin.close();}
});

test('关闭浏览器请求会取消网关中仍在握手的上游连接，退出关闭两端',async()=>{
 let live=0;
 const proxy=await listen(net.createServer(socket=>{live++;socket.on('close',()=>live--);socket.resume();}));
 const input={type:'socks5',host:'127.0.0.1',port:proxy.port,user:'qa',pass:'secret'};
 async function until(fn){const deadline=Date.now()+1000;while(!fn()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(fn(),'连接未在期限内释放');}
 try{
  const port=await getGateway(input);
  for(const request of ['GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n','CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n']){
   const client=net.connect(port,'127.0.0.1');client.on('error',()=>{});client.resume();await new Promise(resolve=>client.once('connect',resolve));client.write(request);await until(()=>live===1);client.destroy();await until(()=>live===0);
  }
  const client=net.connect(port,'127.0.0.1');client.on('error',()=>{});client.resume();await new Promise(resolve=>client.once('connect',resolve));client.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');await until(()=>live===1);closeGateways();await until(()=>live===0&&client.destroyed);
 }finally{closeGateways();await proxy.close();}
});

test('网关监听未完成时退出会拒绝等待者，同一配置随后可重新创建',async()=>{
 const proxy=await startSocks(),origin=await startOrigin();
 try{
  const input={type:'socks5',host:'127.0.0.1',port:proxy.port,user:'qa-user',pass:'qa-pass'};
  const cancelled=getGateway(input);closeGateways();const resumed=getGateway(input);
  await assert.rejects(cancelled,/启动已取消/);const port=await resumed;assert.equal(await getGateway(input),port);
  const status=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:origin.url,headers:{Connection:'close'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));assert.equal(status,200);
 }finally{closeGateways();await proxy.close();await origin.close();}
});

test('CONNECT 与首段数据同包时不丢失内容，关闭网关同时释放已建立隧道',async()=>{
 const proxy=await startSocks(),origin=await startOrigin();let client;
 try{
  const port=await getGateway({type:'socks5',host:'127.0.0.1',port:proxy.port,user:'qa-user',pass:'qa-pass'});
  client=net.connect(port,'127.0.0.1');client.on('error',()=>{});
  const received=new Promise((resolve,reject)=>{let response='';client.on('data',chunk=>{response+=chunk.toString();if(response.includes('201 Created'))resolve(response);});client.on('error',reject);client.on('end',()=>response.includes('201 Created')?resolve(response):reject(new Error(response)));});
  await new Promise(resolve=>client.once('connect',resolve));client.write('CONNECT 127.0.0.1:'+origin.port+' HTTP/1.1\r\nHost: 127.0.0.1:'+origin.port+'\r\n\r\nGET /status HTTP/1.1\r\nHost: 127.0.0.1:'+origin.port+'\r\nConnection: close\r\n\r\n');
  const response=await received;assert.match(response,/200 Connection Established/);assert.equal(origin.requests.at(-1).url,'/status');closeGateways();
 }finally{client?.destroy();closeGateways();await proxy.close();await origin.close();}
});
