'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateProxyImport,ProxyImportError}=require('../src/main/proxy-import-validation');
test('批量代理导入统一解析 HTTPS、SOCKS5、IPv6 与 URL 编码凭据',()=>{
 const proxies=validateProxyImport(' \r\nhttps://qa%40star:p%3Aa%20ss@[::1]:8443\r\n\r\nlocalhost:1080:user:pass:colon\nhttp://127.0.0.1:8080');
 assert.equal(proxies.length,3);
 assert.deepEqual(proxies.map(({type,host,port,user,pass})=>({type,host,port,user,pass})),[
  {type:'https',host:'::1',port:'8443',user:'qa@star',pass:'p:a ss'},
  {type:'socks5',host:'localhost',port:'1080',user:'user',pass:'pass:colon'},
  {type:'http',host:'127.0.0.1',port:'8080',user:'',pass:''}
 ]);
});
test('代理导入错误定位实际文本行和 CRLF 选择范围，错误不暴露凭据',()=>{
 const text='\r\nhttp://localhost:8080\r\n \r\nftp://private:secret@localhost:21\r\n';
 assert.throws(()=>validateProxyImport(text),error=>{
  assert.ok(error instanceof ProxyImportError);assert.equal(error.line,4);
  assert.equal(error.message,'第 4 行代理格式无效');assert.equal(text.slice(error.start,error.end),'ftp://private:secret@localhost:21');
  assert.ok(!error.message.includes('private')&&!error.message.includes('secret'));return true;
 });
});
test('批量导入允许 500 条，501 条在解析前拒绝并定位超限行',()=>{
 const valid=Array.from({length:500},(_,index)=>`127.0.0.1:${1000+index}`).join('\n');
 assert.equal(validateProxyImport(valid).length,500);
 const text='\n\n'+valid+'\nhttp://localhost:9999';
 assert.throws(()=>validateProxyImport(text),error=>{assert.equal(error.line,503);assert.match(error.message,/最多.*500/);assert.equal(text.slice(error.start,error.end),'http://localhost:9999');return true;});
});
test('空输入和非法协议、端口、编码凭据均被拒绝',()=>{
 for(const input of ['',null,'\r\n \r\n\t'])assert.throws(()=>validateProxyImport(input),/至少一条/);
 for(const line of ['ftp://localhost:80','http://localhost:0x20','http://bad%XX:secret@localhost:8080','localhost:65536','[::1]:0'])assert.throws(()=>validateProxyImport(line),/第 1 行/);
});
