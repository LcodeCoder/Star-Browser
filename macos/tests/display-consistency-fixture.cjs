'use strict';
const http = require('node:http');

// A measurement fixture. It installs styles and listeners, never API overrides.
function probeDisplay(expected, identity) {
  const fields = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth'];
  const actualScreen = Object.fromEntries(fields.map(key => [key, screen[key]]));
  const descriptors = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(Screen.prototype, key);
    let illegalReceiver = false;
    try { descriptor.get.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
    descriptors[key] = {name: descriptor.get.name, length: descriptor.get.length, enumerable: descriptor.enumerable,
      configurable: descriptor.configurable, native: /\[native code\]/.test(Function.prototype.toString.call(descriptor.get)), illegalReceiver};
  }
  const getter = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio').get;
  let illegalReceiver = false;
  try { getter.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
  const width = expected.screen.width, height = expected.screen.height, dpr = expected.dpr;
  const cases = [
    ['width', `(device-width: ${width}px)`, true],
    ['height', `(device-height: ${height}px)`, true],
    ['aspect', `(device-aspect-ratio: ${width}/${height})`, true],
    ['min-width', `(min-device-width: ${width}px)`, true],
    ['max-width', `(max-device-width: ${width}px)`, true],
    ['wrong-width', `(device-width: ${width + 1}px)`, false],
    ['wrong-height', `(device-height: ${height + 1}px)`, false],
    ['resolution', `(resolution: ${dpr}dppx)`, true],
    ['dpi', `(resolution: ${dpr * 96}dpi)`, true],
    ['dpcm', `(resolution: ${dpr * 96 / 2.54}dpcm)`, true],
    ['min-resolution', `(min-resolution: ${dpr}dppx)`, true],
    ['max-resolution', `(max-resolution: ${dpr}dppx)`, true],
    ['range', `(resolution >= ${dpr}dppx)`, true],
    ['reverse-range', `(${dpr}dppx <= resolution)`, true],
    ['below-range', `(resolution < ${dpr}dppx)`, false],
    ['above-range', `(resolution > ${dpr}dppx)`, false],
    ['negated', `not all and (resolution: ${dpr}dppx)`, false],
    ['wrong-resolution', `(resolution: ${dpr + 0.5}dppx)`, false],
    ['color', `(color: ${expected.screen.colorDepth / 3})`, true],
  ];
  const style = document.createElement('style');
  style.textContent = cases.map(([, media], index) => `html {--star-display-${index}:0} @media ${media} {html {--star-display-${index}:1}}`).join('\n');
  document.documentElement.append(style);
  const computed = getComputedStyle(document.documentElement);
  const queries = cases.map(([name, media, want], index) => ({name, media, expected: want,
    matches: matchMedia(media).matches, computed: computed.getPropertyValue(`--star-display-${index}`).trim() === '1'}));
  style.remove();
  const box = document.createElement('div');
  box.style.cssText = 'width:120px;height:30px;position:fixed;left:0;top:0';
  document.documentElement.append(box);
  const rect = box.getBoundingClientRect();
  const layout = {width: rect.width, height: rect.height};
  box.remove();
  return {screen: actualScreen, dpr: devicePixelRatio, queries, descriptors, layout,
    documentState: {visibility: document.visibilityState, readyState: document.readyState, viewport: {width: innerWidth, height: innerHeight},
      root: {width: document.documentElement.getBoundingClientRect().width, height: document.documentElement.getBoundingClientRect().height}},
    dprGetter: {name: getter.name, length: getter.length, native: /\[native code\]/.test(Function.prototype.toString.call(getter)), illegalReceiver},
    identity: !identity || (getter === identity.dpr && fields.every(key => Object.getOwnPropertyDescriptor(Screen.prototype, key).get === identity[key])),
    language: navigator.language, timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone};
}
function documentSource(expected, page, port, host = 'localhost') {
  const setup = `
    const expected=${JSON.stringify(expected)}, probe=${probeDisplay.toString()};
    const identity=Object.fromEntries(['width','height','availWidth','availHeight','colorDepth','pixelDepth'].map(key=>[key,Object.getOwnPropertyDescriptor(Screen.prototype,key).get]));
    identity.dpr=Object.getOwnPropertyDescriptor(window,'devicePixelRatio').get;
    window.__displayFirst=probe(expected,identity);
    window.__displayEvents=[];
    window.__displayRead=dpr=>({first:window.__displayFirst,now:probe({...expected,dpr},identity),events:window.__displayEvents});
    let listeners=[];
    window.__displayWatch=(from,to)=>{
      for(const [mql,standard,legacy] of listeners){mql.removeEventListener('change',standard);mql.removeListener(legacy);}
      listeners=[];window.__displayEvents=[];
      for(const [name,dpr] of [['old',from],['new',to]]){
        const mql=matchMedia('(resolution: '+dpr+'dppx)');
        const handler=kind=>event=>window.__displayEvents.push({name,kind,matches:event.matches,media:event.media,dpr:devicePixelRatio,target:event.target===mql,eventType:event.type});
        const standard=handler('standard'),legacy=handler('legacy');
        mql.addEventListener('change',standard);mql.addListener(legacy);listeners.push([mql,standard,legacy]);
      }
      return listeners.map(([mql])=>mql.matches);
    };
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.type!=='star-display-call'||!event.ports[0])return;
      const {operation,dpr,from,to}=event.data;
      const value=operation==='watch'?window.__displayWatch(from,to):window.__displayRead(dpr);
      event.ports[0].postMessage(value);event.ports[0].close();
    });
  `;
  if (!page) return '<!doctype html><meta charset="utf-8"><title>Display frame</title><script>' + setup + '</script>';
  const params = new URLSearchParams({expected: JSON.stringify(expected)}).toString();
  const srcdoc = documentSource(expected, false, port, host);
  const pageSetup = `
    const frames={};
    async function frame(name,owner,src,html){
      const element=owner.document.createElement('iframe');element.style.cssText='width:300px;height:180px';
      const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(name+' frame timeout')),15000);element.onload=()=>{clearTimeout(timer);resolve();};});
      if(html)element.srcdoc=html;else element.src=src;
      owner.document.documentElement.append(element);frames[name]=element;
      await loaded;return element.contentWindow;
    }
    async function call(name,operation,args){
      const target=frames[name].contentWindow;
      if(name!=='crossOrigin')return operation==='watch'?target.__displayWatch(args.from,args.to):target.__displayRead(args.dpr);
      return new Promise((resolve,reject)=>{
        const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('cross-origin measurement timeout'));},8000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
        target.postMessage({type:'star-display-call',operation,...args},'*',[channel.port2]);
      });
    }
    window.__displayReadAll=async dpr=>{
      const values={page:window.__displayRead(dpr)};
      for(const name of Object.keys(frames))values[name]=await call(name,'read',{dpr});
      return values;
    };
    window.__displayWatchAll=async(from,to)=>{
      const values={page:window.__displayWatch(from,to)};
      for(const name of Object.keys(frames))values[name]=await call(name,'watch',{from,to});
      return values;
    };
    (async()=>{
      const same=await frame('sameOrigin',window,${JSON.stringify('http://' + host + ':' + port + '/frame?' + params)});
      await frame('crossOrigin',window,${JSON.stringify('http://' + (host === 'localhost' ? '127.0.0.1' : 'localhost') + ':' + port + '/frame?' + params)});
      await frame('srcdoc',window,null,${JSON.stringify(srcdoc).replaceAll('<', '\\u003c')});
      await frame('nested',same,null,${JSON.stringify(srcdoc).replaceAll('<', '\\u003c')});
      const blank=document.createElement('iframe');document.documentElement.append(blank);frames.aboutBlank=blank;
      // Measure about:blank synchronously before waiting for any load event.
      blank.contentWindow.eval(${JSON.stringify(setup).replaceAll('<', '\\u003c')});
      window.__displayReady=true;
    })().catch(error=>window.__displayError=error.stack);
  `;
  return '<!doctype html><meta charset="utf-8"><title>Display consistency</title><script>' + setup + pageSetup + '</script>';
}
async function startConsistencyOrigin() {
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://' + request.headers.host);
      const expected = JSON.parse(url.searchParams.get('expected'));
      if (!expected?.screen || !(expected.dpr > 0)) throw new Error('Invalid display expectation');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/blocked') response.setHeader('Content-Security-Policy', "style-src 'none'");
      response.end(documentSource(expected, url.pathname !== '/frame', server.address().port, url.hostname));
    } catch {
      response.writeHead(400); response.end('Invalid measurement request');
    }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  return {port, url: 'http://localhost:' + port,
    pageUrl: (expected, marker) => 'http://localhost:' + port + '/page?expected=' + encodeURIComponent(JSON.stringify(expected)) + '&display=' + marker,
    close: () => new Promise(resolve => server.close(resolve))};
}
module.exports = {probeDisplay, startConsistencyOrigin};
