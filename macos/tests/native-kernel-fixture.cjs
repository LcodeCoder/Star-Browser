'use strict';
const http = require('node:http');

async function readHardware() {
  const cpu = navigator.hardwareConcurrency, memory = navigator.deviceMemory;
  const descriptors = {};
  for (const key of ['hardwareConcurrency', 'deviceMemory']) {
    let object = navigator, descriptor, owner;
    while (object && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) owner = object === navigator ? 'own' : object.constructor?.name;
      object = Object.getPrototypeOf(object);
    }
    let illegalReceiver = false;
    try { descriptor?.get.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
    descriptors[key] = descriptor ? {owner, name: descriptor.get?.name, length: descriptor.get?.length,
      native: typeof descriptor.get === 'function' && /\[native code\]/.test(Function.prototype.toString.call(descriptor.get)),
      enumerable: descriptor.enumerable, configurable: descriptor.configurable, illegalReceiver} : null;
  }
  let hints = null;
  if (navigator.userAgentData) hints = await navigator.userAgentData.getHighEntropyValues(
    ['architecture', 'bitness', 'platformVersion', 'fullVersionList', 'model', 'wow64']);
  return {cpu, memory, descriptors, ua: navigator.userAgent, platform: navigator.platform,
    language: navigator.language, languages: Array.from(navigator.languages), hints,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    functionToStringNative: /\[native code\]/.test(Function.prototype.toString.call(Function.prototype.toString))};
}

function hashPixels(bytes) {
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value.toString(16).padStart(8, '0');
}

function drawCanvas(canvas) {
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgb(40, 80, 160)'; context.fillRect(0, 0, 256, 64);
  context.font = '19px Arial'; context.fillStyle = 'rgb(238, 196, 61)';
  context.fillText('Star Browser Ω 中 012345', 3, 29);
  context.strokeStyle = 'rgb(170, 30, 60)'; context.lineWidth = 1.5;
  context.beginPath(); context.arc(198, 37, 19, 0, 5); context.stroke();
  return context;
}

async function graphicsProbe() {
  const result = {};
  try {
    const canvas = document.createElement('canvas'), context = drawCanvas(canvas);
    const read = () => hashPixels(context.getImageData(0, 0, 256, 64).data);
    const direct = read(), again = read();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const image = await createImageBitmap(blob);
    const decoded = document.createElement('canvas'); decoded.width = 256; decoded.height = 64;
    decoded.getContext('2d').drawImage(image, 0, 0); image.close();
    const exported = hashPixels(decoded.getContext('2d').getImageData(0, 0, 256, 64).data);
    const offscreen = new OffscreenCanvas(256, 64), offscreenContext = drawCanvas(offscreen);
    result.canvas = {direct, again, exported,
      offscreen: hashPixels(offscreenContext.getImageData(0, 0, 256, 64).data),
      nativeReadback: /\[native code\]/.test(Function.prototype.toString.call(context.getImageData))};
    result.fonts = Object.fromEntries(['Arial', 'Times New Roman', 'Courier New', 'Segoe UI', 'Helvetica', 'system-ui'].map(font => {
      context.font = '19px "' + font + '"'; return [font, context.measureText('Star Browser Ω 中 012345').width];
    }));
  } catch (error) { result.canvas = {error: error.message}; }
  try {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL unavailable');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const pixels = new Uint8Array(16);
    gl.clearColor(.2, .4, .6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    result.webgl = {vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      version: gl.getParameter(gl.VERSION), pixels: hashPixels(pixels),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)};
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (error) { result.webgl = {error: error.message}; }
  try {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    result.webgpu = {vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description,
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D};
  } catch (error) { result.webgpu = {error: error.message}; }
  try {
    async function render() {
      const audio = new OfflineAudioContext(1, 4096, 44100), oscillator = audio.createOscillator();
      oscillator.type = 'triangle'; oscillator.frequency.value = 997;
      oscillator.connect(audio.destination); oscillator.start();
      const buffer = await audio.startRendering(), direct = buffer.getChannelData(0);
      const copy = new Float32Array(direct.length); buffer.copyFromChannel(copy, 0);
      const hash = values => hashPixels(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
      return {hash: hash(direct), copyHash: hash(copy), sameArray: direct === buffer.getChannelData(0), sampleRate: buffer.sampleRate};
    }
    result.audio = {first: await render(), second: await render()};
  } catch (error) { result.audio = {error: error.message}; }
  return result;
}

const hardwareSource = readHardware.toString();
const workerHardwareSource = hardwareSource + ';async function readWithHeaders(){const value=await readHardware();value.headers=await fetch(self.location.origin+"/headers?worker").then(r=>r.json());return value;}';
const workerSource = workerHardwareSource + ';readWithHeaders().then(value => postMessage(value)).catch(error => postMessage({error:error.message}));';
const sharedSource = workerHardwareSource + ';onconnect = event => {const port=event.ports[0];readWithHeaders().then(value => port.postMessage(value)).catch(error => port.postMessage({error:error.message}));};';
const serviceSource = workerHardwareSource + `;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => event.waitUntil(readWithHeaders().then(value => event.ports[0].postMessage(value)).catch(error => event.ports[0].postMessage({error:error.message}))));`;

function pageSource(port) {
  return `<!doctype html><meta charset="utf-8"><title>Star native kernel probe</title><body>Native kernel acceptance<script>
${hardwareSource};${hashPixels.toString()};${drawCanvas.toString()};${graphicsProbe.toString()};
const firstScript = readHardware();
function workerProbe(kind) {
  return new Promise(resolve => {
    let worker, port, url;
    const finish = value => {clearTimeout(timer);if(port)port.close();else worker?.terminate();if(url)URL.revokeObjectURL(url);resolve(value);};
    const timer = setTimeout(() => finish({error:kind+' timeout'}), 7000);
    try {
      if(kind==='shared') {worker=new SharedWorker('/shared.js',{name:'star-native'});port=worker.port;port.onmessage=e=>finish(e.data);port.start();}
      else {url=kind==='blob'?URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}],{type:'text/javascript'})):null;
        worker=new Worker(url||'/worker.js',kind==='module'?{type:'module'}:undefined);worker.onmessage=e=>finish(e.data);}
      worker.onerror=event=>finish({error:event.message||kind+' failed'});
    } catch(error) {finish({error:error.message});}
  });
}
async function serviceProbe() {
  try {
    const registration = await navigator.serviceWorker.register('/service.js', {scope:'/'});
    await navigator.serviceWorker.ready;
    const worker = registration.active;
    if(!worker)throw new Error('Service Worker is not active');
    return await new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(()=>{channel.port1.close();resolve({error:'service timeout'});},7000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
      worker.postMessage({},[channel.port2]);
    });
  } catch(error) {return {error:error.message};}
}
function frameProbe(cross) {
  return new Promise(resolve => {
    const frame=document.createElement('iframe');
    const token=crypto.randomUUID();
    const receive=event=>{if(event.source===frame.contentWindow&&event.data?.token===token){cleanup();resolve(event.data.value);}};
    const cleanup=()=>{clearTimeout(timer);removeEventListener('message',receive);frame.remove();};
    const timer=setTimeout(()=>{cleanup();resolve({error:'frame timeout'});},7000);
    addEventListener('message',receive);
    frame.src=(cross?'http://localhost:${port}':'')+'/frame?token='+encodeURIComponent(token);
    document.body.append(frame);
  });
}
window.__nativeResult=(async()=>{
  const first=await firstScript;
  const scopes={page:first,sameOrigin:await frameProbe(false),crossOrigin:await frameProbe(true),
    dedicated:await workerProbe('dedicated'),blob:await workerProbe('blob'),module:await workerProbe('module'),
    shared:await workerProbe('shared'),service:await serviceProbe()};
  const repeat=await readHardware();
  const headers=await fetch('/headers').then(response=>response.json());
  const graphics=await Promise.race([graphicsProbe(),new Promise(resolve=>setTimeout(()=>resolve({error:'graphics timeout'}),8000))]);
  return {first,scopes,repeat,headers,graphics};
})().catch(error=>({error:error.stack}));
</script>`;
}

async function startNativeOrigin() {
  let port;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Accept-CH', 'Sec-CH-Device-Memory, Device-Memory, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List');
    if (url.pathname === '/headers') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.headers));
    } else if (url.pathname === '/worker.js' || url.pathname === '/shared.js' || url.pathname === '/service.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(url.pathname === '/worker.js' ? workerSource : url.pathname === '/shared.js' ? sharedSource : serviceSource);
    } else if (url.pathname === '/frame') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><script>' + hardwareSource +
        ';readHardware().then(async value=>{value.headers=await fetch("/headers").then(r=>r.json());parent.postMessage({token:new URL(location.href).searchParams.get("token"),value},"*");});</script>');
    } else {
      response.setHeader('Content-Type', 'text/html'); response.end(pageSource(port));
    }
  });
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  port = server.address().port;
  return {port, url: 'http://127.0.0.1:' + port + '/probe',
    close: () => new Promise(resolve => {server.close(resolve);server.closeAllConnections();})};
}
module.exports = {startNativeOrigin};
