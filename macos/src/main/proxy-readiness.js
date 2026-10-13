'use strict';
const http = require('node:http');
const https = require('node:https');
const {validateProxy} = require('./profile-validation');
const {connectSocks5} = require('./local-proxy');
function failure(code, message) {const error = new Error(message); error.code = code; return error;}
function assertStatus(status) {
  if (status === 407) throw failure('authentication', '代理账号或密码未通过验证');
  if (status < 200 || status >= 400) throw failure('target-response', '代理测试目标返回 HTTP ' + status);
}
function probeHttp(proxy, target, signal, ca) {
  return new Promise((resolve, reject) => {
    const headers = {Host: target.host, Connection: 'close'};
    if (proxy.user || proxy.pass) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(proxy.user + ':' + proxy.pass, 'utf8').toString('base64');
    const transport = proxy.type === 'https' ? https : http;
    const request = transport.request({hostname: proxy.host, port: Number(proxy.port), method: 'GET', path: target.href,
      headers, agent: false, signal, ...(ca ? {ca} : {})}, response => {
      try {assertStatus(response.statusCode);resolve(response.statusCode);} catch (error) {reject(error);}
      response.once("error", () => {}); response.resume(); request.destroy();
    });
    request.once('error', reject); request.end();
  });
}
async function probeSocks(proxy, target, signal, timeout) {
  const socket = await connectSocks5(proxy, target.hostname, Number(target.port) || 80, {signal, timeout});
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0), settled = false;
    const finish = (error, status) => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', aborted); socket.removeListener('data', data); socket.removeListener('end', ended); socket.removeListener('error', failed);
      socket.destroy(); error ? reject(error) : resolve(status);
    };
    const aborted = () => finish(failure('cancelled', '代理检查已中止'));
    const ended = () => finish(failure('closed', '代理在返回 HTTP 响应前关闭了连接'));
    const failed = error => finish(error);
    const data = chunk => {
      response = Buffer.concat([response, chunk]);
      const lineEnd = response.indexOf('\r\n');
      if (lineEnd < 0) {if (response.length > 8192) finish(failure('invalid-response', '代理未返回有效 HTTP 响应')); return;}
      const match = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(response.subarray(0,lineEnd).toString('latin1'));
      if (!match) {finish(failure('invalid-response', '代理未返回有效 HTTP 响应'));return;}
      try {assertStatus(Number(match[1]));finish(null, Number(match[1]));} catch (error) {finish(error);}
    };
    signal.addEventListener('abort', aborted, {once:true});socket.on('data', data);socket.once('end', ended);socket.once('error', failed);
    if (signal.aborted) {aborted();return;}
    socket.write('GET ' + target.pathname + target.search + ' HTTP/1.1\r\nHost: ' + target.host + '\r\nConnection: close\r\n\r\n');
    socket.resume();
  });
}
// One bounded real request proves this proxy's protocol, credentials and transfer
// for the configured probe target. It does not promise reachability of every site.
async function probeProxy(input, {targetUrl = 'http://example.com/', timeout = 6000, signal, ca} = {}) {
  const startedAt = Date.now();
  let proxy, target;
  try {
    proxy = validateProxy(input); if (!proxy) throw new Error('请填写代理地址');
    target = new URL(targetUrl);
    if (target.protocol !== 'http:' || target.username || target.password) throw new Error('代理测试目标需为不含账号密码的 HTTP 地址');
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 30000) throw new Error('代理检查期限无效');
  } catch (error) {return {ok:false,code:'configuration',error:error.message,field:error.field,durationMs:Date.now()-startedAt};}
  const controller = new AbortController(); let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(() => {timedOut = true;controller.abort();}, timeout);
  try {
    const status = proxy.type === 'socks5' ? await probeSocks(proxy, target, controller.signal, timeout) : await probeHttp(proxy, target, controller.signal, ca);
    return {ok:true,status,code:'ready',durationMs:Date.now()-startedAt};
  } catch (error) {
    const code = timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : error.code === 'authentication' || /鉴权/.test(error.message) ? 'authentication' : error.code === 'target-response' ? 'target-response' : error.code === 'invalid-response' ? 'invalid-response' : 'connection';
    const message = timedOut ? '代理检查超时' : signal?.aborted ? '代理检查已取消' : code === 'authentication' ? '代理账号或密码未通过验证' : ['target-response','invalid-response'].includes(code) ? error.message : '无法通过代理取得 HTTP 响应';
    return {ok:false,code,error:message,durationMs:Date.now()-startedAt};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort', cancel);}
}
module.exports = {probeProxy};
