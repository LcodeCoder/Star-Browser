'use strict';
// Electron ClientRequest has no guaranteed setTimeout method. Own the timer
// so one silent provider cannot stall a parallel geolocation lookup.
function requestGeoJSON(requestFactory, url, {timeoutMs = 4000, maxBytes = 256 * 1024} = {}) {
  return new Promise(resolve => {
    let request, timer, done = false, bytes = 0, data = '';
    const finish = (result, abort = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (abort) try { request?.abort(); } catch {}
      resolve(result);
    };
    try {
      request = requestFactory(url);
      timer = setTimeout(() => finish({error: '检测超时（' + timeoutMs + 'ms）'}, true), timeoutMs);
      request.on('response', response => {
        if (done) return;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish({error: '检测服务返回 HTTP ' + response.statusCode}, true);
          return;
        }
        response.on('data', chunk => {
          if (done) return;
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) { finish({error: '检测响应过大'}, true); return; }
          data += chunk.toString('utf8');
        });
        response.on('error', error => finish({error: error.message}, true));
        response.on('end', () => {
          if (done) return;
          try {
            const value = JSON.parse(data);
            finish(value && typeof value === 'object' && !Array.isArray(value) ? value : {error: '检测响应格式无效'});
          } catch { finish({error: '检测响应不是有效 JSON'}); }
        });
      });
      request.on('error', error => finish({error: error.message}));
      request.end();
    } catch (error) { finish({error: error.message}, true); }
  });
}
module.exports = {requestGeoJSON};
