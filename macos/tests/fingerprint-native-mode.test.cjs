'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const createRuntime=require('../src/extension/fp-core');
function run(expression){return vm.runInNewContext(`
 class Navigator {
  get userAgent(){return 'Mozilla/5.0 Native';}get appVersion(){return '5.0 Native';}
  get platform(){return 'MacIntel';}get language(){return 'fr-FR';}get languages(){return Object.freeze(['fr-FR','en-US']);}
  get hardwareConcurrency(){if(!(this instanceof Navigator))throw new TypeError('Illegal invocation');return 4;}
  get deviceMemory(){if(!(this instanceof Navigator))throw new TypeError('Illegal invocation');return 4;}
  get vendor(){return 'Google Inc.';}get maxTouchPoints(){return 0;}get webdriver(){return false;}
 }
 class Screen {get width(){return 1600;}get height(){return 900;}get availWidth(){return 1600;}get availHeight(){return 860;}get colorDepth(){return 24;}get pixelDepth(){return 24;}}
 class CanvasRenderingContext2D {constructor(){this.canvas={width:2,height:2};}getImageData(){return {data:new Uint8ClampedArray(16).fill(100),width:2,height:2};}}
 class WebGLRenderingContext {getParameter(){return 'native GPU';}}
 class AudioBuffer {getChannelData(){return new Float32Array(4);}}
 class Element {getBoundingClientRect(){return {x:0,y:0,width:120,height:40};}}
 const navigator=new Navigator(),screen=new Screen();
 Object.assign(globalThis,{Navigator,Screen,CanvasRenderingContext2D,WebGLRenderingContext,AudioBuffer,Element,navigator,screen});
 const cfg={userAgent:'Mozilla/5.0 Native',platform:'MacIntel',language:'fr-FR',languages:['fr-FR','en-US'],hardwareConcurrency:4,deviceMemory:4,maxTouchPoints:0,screen:{width:1600,height:900,availWidth:1600,availHeight:860,colorDepth:24,pixelDepth:24},webrtc:'proxy',noise:{canvas:false,audio:false,webgl:false,clientRects:false},canvasNoise:1234};
 const runtime=(${createRuntime.toString()})(globalThis);
 ${expression}
 `);}
test('原生配置已一致时保持 getter、图形音频几何和 Function.toString 的真实身份',()=>{
 const result=run(`const before={};for(const [type,key]of [[Navigator,'userAgent'],[Navigator,'language'],[Navigator,'languages'],[Navigator,'hardwareConcurrency'],[Navigator,'deviceMemory'],[Screen,'width'],[Screen,'height']])before[type.name+key]=Object.getOwnPropertyDescriptor(type.prototype,key).get;
 const methods=[Function.prototype.toString,CanvasRenderingContext2D.prototype.getImageData,WebGLRenderingContext.prototype.getParameter,AudioBuffer.prototype.getChannelData,Element.prototype.getBoundingClientRect];
 runtime.installFingerprint(cfg);runtime.installFingerprint(cfg);
 ({getters:Object.entries(before).every(([name,getter])=>{const type=name.startsWith('Screen')?Screen:Navigator;const key=name.slice(type.name.length);return Object.getOwnPropertyDescriptor(type.prototype,key).get===getter;}),methods:methods.every((fn,i)=>fn===[Function.prototype.toString,CanvasRenderingContext2D.prototype.getImageData,WebGLRenderingContext.prototype.getParameter,AudioBuffer.prototype.getChannelData,Element.prototype.getBoundingClientRect][i])});`);
 assert.equal(result.getters,true);assert.equal(result.methods,true);
});
test('显式开启覆盖时才安装，重复配置不叠加包装且返回原生模式保留真实读值',()=>{
 const result=run(`const original=CanvasRenderingContext2D.prototype.getImageData;runtime.installFingerprint(cfg);const untouched=CanvasRenderingContext2D.prototype.getImageData===original;
 runtime.installFingerprint({...cfg,noise:{canvas:true}});const installed=CanvasRenderingContext2D.prototype.getImageData;runtime.installFingerprint({...cfg,noise:{canvas:true}});const once=installed===CanvasRenderingContext2D.prototype.getImageData;
 runtime.installFingerprint(cfg);const image=new CanvasRenderingContext2D().getImageData(0,0,2,2);
 ({untouched,installed:installed!==original,once,nativeValues:Array.from(image.data).every(x=>x===100)});`);
 for(const key of ['untouched','installed','once','nativeValues'])assert.equal(result[key],true,key);
});
test('必要的内存 fallback 保留原生接收者校验和动态配置，已经原生管理时不安装',()=>{
 const result=run(`const original=Object.getOwnPropertyDescriptor(Navigator.prototype,'deviceMemory').get;runtime.installFingerprint({...cfg,nativeHardware:true,deviceMemory:2});const native=Object.getOwnPropertyDescriptor(Navigator.prototype,'deviceMemory').get===original;
 runtime.installFingerprint({...cfg,deviceMemory:2});const getter=Object.getOwnPropertyDescriptor(Navigator.prototype,'deviceMemory').get;let rejected=false;try{getter.call({});}catch(e){rejected=e instanceof TypeError;}
 const first=navigator.deviceMemory;runtime.installFingerprint({...cfg,deviceMemory:8});({native,rejected,first,changed:navigator.deviceMemory,once:getter===Object.getOwnPropertyDescriptor(Navigator.prototype,'deviceMemory').get});`);
 assert.equal(result.native,true);assert.equal(result.rejected,true);assert.equal(result.first,2);assert.equal(result.changed,8);assert.equal(result.once,true);
});
