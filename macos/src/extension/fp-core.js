'use strict';
/* Shared page/Worker runtime. CDP owns dates, Intl, UA/Client Hints and CSS metrics.
 * JS supplies device memory, optional stable readback and the explicit RTC policy.
 * Native fonts, media, speech, plugins, WebGPU and rendering capabilities stay native.
 */
module.exports=function createFingerprintRuntime(scope){
  'use strict';
  var CFG,toStringPatched=false,languageKey,languageValues,parts=Object.create(null);
  var patched=new WeakMap(),nativeToString=Function.prototype.toString;
  function mark(fn,original){
    patched.set(fn,Reflect.apply(nativeToString,original,[]));
    if(!toStringPatched){
      toStringPatched=true;
      var proxy=new Proxy(nativeToString,{apply:function(target,receiver,args){return patched.has(receiver)?patched.get(receiver):Reflect.apply(target,receiver,args);}});
      patched.set(proxy,Reflect.apply(nativeToString,nativeToString,[]));
      Object.defineProperty(Function.prototype,'toString',Object.assign({},Object.getOwnPropertyDescriptor(Function.prototype,'toString'),{value:proxy}));
    }
    return fn;
  }
  function wrap(proto,key,apply){
    if(!proto||typeof proto[key]!=='function')return;
    var descriptor=Object.getOwnPropertyDescriptor(proto,key),original=proto[key];
    if(patched.has(original))return original;
    var proxy=mark(new Proxy(original,{apply:apply}),original);
    Object.defineProperty(proto,key,Object.assign({},descriptor,{value:proxy}));
    return original;
  }
  function def(proto,key,read){
    var descriptor=Object.getOwnPropertyDescriptor(proto,key);
    if(!descriptor||typeof descriptor.get!=='function')return;
    var original=descriptor.get;
    if(patched.has(original))return;
    var getter=mark(new Proxy(original,{apply:function(target,receiver,args){
      var native=Reflect.apply(target,receiver,args); // Native brand and receiver validation.
      return read(native);
    }}),original);
    Object.defineProperty(proto,key,Object.assign({},descriptor,{get:getter}));
  }
  function defAligned(proto,key,read,receiver,expected){
    var descriptor=Object.getOwnPropertyDescriptor(proto,key);
    if(!descriptor||typeof descriptor.get!=='function')return;
    // Prefer the actual native getter whenever the protocol or native policy
    // already supplies the requested value. Never replace it merely to forward.
    if(!patched.has(descriptor.get)){
      try{if(JSON.stringify(Reflect.apply(descriptor.get,receiver,[]))===JSON.stringify(expected))return;}catch(_){}
    }
    def(proto,key,read);
  }
  function installPart(key,enabled,run){if(enabled&&!parts[key]){parts[key]=true;run();}}
  function metadata(){
    return CFG.userAgentMetadata||{
      brands:[{brand:'Chromium',version:CFG.chromeVersion.split('.')[0]},{brand:'Google Chrome',version:CFG.chromeVersion.split('.')[0]},{brand:'Not-A.Brand',version:'99'}],
      platform:CFG.os==='android'?'Android':CFG.os==='mac'?'macOS':'Windows',mobile:CFG.os==='android',architecture:CFG.os==='android'?'arm':'x86',bitness:'64',model:CFG.os==='android'?'SM-S918B':'',
      platformVersion:CFG.os==='android'?'13.0.0':CFG.os==='mac'?'14.0.0':'10.0.0',fullVersion:CFG.chromeVersion,
      fullVersionList:[{brand:'Chromium',version:CFG.chromeVersion},{brand:'Google Chrome',version:CFG.chromeVersion},{brand:'Not-A.Brand',version:'99.0.0.0'}],wow64:false
    };
  }
  function clone(value){return value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):value;}
  function patchUA(proto){
    ['userAgent','platform','language'].forEach(function(key){defAligned(proto,key,function(){return CFG[key];},scope.navigator,CFG[key]);});
    defAligned(proto,'appVersion',function(){return CFG.userAgent.replace(/^Mozilla\//,'');},scope.navigator,CFG.userAgent.replace(/^Mozilla\//,''));
    defAligned(proto,'languages',function(){
      var key=JSON.stringify(CFG.languages);
      if(languageKey!==key){languageKey=key;languageValues=Object.freeze(CFG.languages.slice());}
      return languageValues;
    },scope.navigator,CFG.languages);
    if(!scope.navigator.userAgentData)return;
    var uaProto=Object.getPrototypeOf(scope.navigator.userAgentData);
    ['brands','platform','mobile'].forEach(function(key){defAligned(uaProto,key,function(native){
      var expected=metadata()[key];
      if(CFG.protocolManaged&&JSON.stringify(native)===JSON.stringify(expected))return native;
      var aligned=clone(expected);
      return native&&typeof native==='object'&&Object.isFrozen(native)?Object.freeze(aligned):aligned;
    },scope.navigator.userAgentData,metadata()[key]);});
    function align(out){
      var meta=metadata();Object.keys(out).forEach(function(key){
        var value=key==='uaFullVersion'?meta.fullVersion:key in meta?meta[key]:out[key];
        if(JSON.stringify(out[key])!==JSON.stringify(value))out[key]=clone(value);
      });return out;
    }
    if(CFG.protocolManaged===false){
      wrap(uaProto,'getHighEntropyValues',function(target,receiver,args){return Reflect.apply(target,receiver,args).then(align);});
      wrap(uaProto,'toJSON',function(target,receiver,args){return align(Reflect.apply(target,receiver,args));});
    }
  }
  function patchCanvas(){
    var sources=[];
    [scope.CanvasRenderingContext2D,scope.OffscreenCanvasRenderingContext2D].forEach(function(Type){
      if(!Type)return;var proto=Type.prototype,original=proto.getImageData;sources.push({proto:proto,read:original});
      wrap(proto,'getImageData',function(target,receiver,args){
        var image=Reflect.apply(target,receiver,args);
        if(CFG.noise.canvas&&image.data instanceof Uint8ClampedArray){
          // Do not repeat user-supplied object conversions after native argument validation.
          var x=typeof args[0]==='number'?args[0]|0:0,y=typeof args[1]==='number'?args[1]|0:0;
          if(typeof args[2]==='number'&&args[2]<0)x+=args[2]|0;
          if(typeof args[3]==='number'&&args[3]<0)y+=args[3]|0;
          perturb(image,x,y,receiver.canvas.width,receiver.canvas.height);
        }
        return image;
      });
    });
    function random(index){var x=((CFG.canvasNoise||12345)^Math.imul(index,2654435761))>>>0;x^=x>>>15;x=Math.imul(x,2246822507);x^=x>>>13;x=Math.imul(x,3266489909);x^=x>>>16;return (x>>>0)/4294967296;}
    function perturb(image,sx,sy,width,height){
      var data=image.data;
      for(var y=0;y<image.height;y++)for(var x=0;x<image.width;x++){
        var i=(y*image.width+x)*4,px=x+sx,py=y+sy;
        if(!data[i+3]||px<0||py<0||px>=width||py>=height)continue;
        var index=(py*width+px)*4;
        if(random(index)>=.02)continue;
        // Assign a seeded low bit: repeated read/export/decode cannot accumulate noise.
        for(var channel=0;channel<3;channel++)data[i+channel]=(data[i+channel]&254)|(random(index+channel+1)<.5?0:1);
      }
    }
    function shadow(canvas,offscreen){
      var w=canvas.width,h=canvas.height;if(!w||!h)return null;
      var copy=offscreen?new scope.OffscreenCanvas(w,h):scope.document.createElement('canvas');copy.width=w;copy.height=h;
      var context=copy.getContext('2d');context.drawImage(canvas,0,0);
      var native=sources.find(function(item){return item.proto.isPrototypeOf(context);});
      var image=Reflect.apply(native.read,context,[0,0,w,h]);perturb(image,0,0,w,h);context.putImageData(image,0,0);return copy;
    }
    if(scope.HTMLCanvasElement)['toDataURL','toBlob'].forEach(function(key){wrap(scope.HTMLCanvasElement.prototype,key,function(target,receiver,args){
      if(CFG.noise.canvas){try{var copy=shadow(receiver,false);if(copy)return Reflect.apply(target,copy,args);}catch{}}
      return Reflect.apply(target,receiver,args);
    });});
    if(scope.OffscreenCanvas)wrap(scope.OffscreenCanvas.prototype,'convertToBlob',function(target,receiver,args){
      if(CFG.noise.canvas){try{var copy=shadow(receiver,true);if(copy)return Reflect.apply(target,copy,args);}catch{}}
      return Reflect.apply(target,receiver,args);
    });
  }
  function patchAudio(){
    if(!scope.AudioBuffer)return;
    var proto=scope.AudioBuffer.prototype,nativeRead=proto.getChannelData,samples=new WeakMap();
    function perturb(data){
      if(!CFG.noise.audio)return data;
      var previous=samples.get(data),fresh=!previous;
      if(fresh){previous=new Float32Array(Math.ceil(data.length/500));samples.set(data,previous);}
      for(var i=0;i<data.length;i+=500){if(data[i]!==0&&(fresh||data[i]!==previous[i/500]))data[i]+=CFG.audioNoise||.0001;previous[i/500]=data[i];}
      return data;
    }
    wrap(proto,'getChannelData',function(target,receiver,args){return perturb(Reflect.apply(target,receiver,args));});
    wrap(proto,'copyFromChannel',function(target,receiver,args){
      // Validate first. Primitive channel/offset arguments can then be safely reused.
      var result=Reflect.apply(target,receiver,args);
      if(CFG.noise.audio&&typeof args[1]!=='object'&&typeof args[2]!=='object'){
        perturb(Reflect.apply(nativeRead,receiver,[args[1]]));return Reflect.apply(target,receiver,args);
      }
      return result;
    });
    if(!scope.AnalyserNode)return;
    [['getFloatFrequencyData',.6],['getByteFrequencyData',3],['getFloatTimeDomainData',.002],['getByteTimeDomainData',3]].forEach(function(item){
      wrap(scope.AnalyserNode.prototype,item[0],function(target,receiver,args){
        var result=Reflect.apply(target,receiver,args);if(!CFG.noise.audio)return result;
        var data=args[0],seed=CFG.canvasNoise||12345;
        for(var i=0;i<data.length;i++){
          if(!Number.isFinite(data[i])||data[i]===0)continue;
          var x=Math.sin((i+1)*12.9898+seed)*43758.5453,value=data[i]+(x-Math.floor(x)-.5)*item[1];
          data[i]=data instanceof Uint8Array?Math.max(0,Math.min(255,Math.round(value))):value;
        }
        return result;
      });
    });
  }
  function patchRects(){
    function shift(rect){return new scope.DOMRect(rect.x+(((CFG.rectNoise||1)%7)-3)/10,rect.y+((((CFG.rectNoise||1)>>>3)%7)-3)/10,rect.width,rect.height);}
    [scope.Element,scope.Range].forEach(function(Type){if(!Type)return;
      wrap(Type.prototype,'getBoundingClientRect',function(target,receiver,args){var rect=Reflect.apply(target,receiver,args);return CFG.noise.clientRects?shift(rect):rect;});
      wrap(Type.prototype,'getClientRects',function(target,receiver,args){
        var list=Reflect.apply(target,receiver,args);if(!CFG.noise.clientRects)return list;
        var cache=new Map(),proxy;function at(index){if(!list[index])return undefined;if(!cache.has(index))cache.set(index,shift(list[index]));return cache.get(index);}
        var item=mark(new Proxy(list.item,{apply:function(fn,receiver,values){
          var native=Reflect.apply(fn,receiver===proxy?list:receiver,values);
          if(!native)return null;return at(Array.prototype.indexOf.call(list,native))||shift(native);
        }}),list.item);
        proxy=new Proxy(list,{get:function(target,key){
          if(key==='item')return item;
          if(key===Symbol.iterator)return function*(){for(var i=0;i<list.length;i++)yield at(i);};
          if(typeof key==='string'&&/^\d+$/.test(key))return at(Number(key));
          return Reflect.get(target,key,target);
        },getOwnPropertyDescriptor:function(target,key){var desc=Reflect.getOwnPropertyDescriptor(target,key);if(desc&&desc.configurable&&/^\d+$/.test(key))desc.value=at(Number(key));return desc;}});
        return proxy;
      });
    });
  }
  function patchRTC(){
    var constructors=new WeakMap();
    ['RTCPeerConnection','webkitRTCPeerConnection'].forEach(function(key){
      var original=scope[key];if(typeof original!=='function')return;
      var proxy=constructors.get(original);
      if(!proxy){
        proxy=mark(new Proxy(original,{construct:function(target,args,newTarget){
          if(CFG.webrtc!=='proxy')throw new DOMException('WebRTC is disabled by this browser environment.','NotSupportedError');
          return Reflect.construct(target,args,newTarget);
        }}),original);
        constructors.set(original,proxy);
        var constructor=Object.getOwnPropertyDescriptor(original.prototype,'constructor');
        if(constructor)Object.defineProperty(original.prototype,'constructor',Object.assign({},constructor,{value:proxy}));
      }
      var descriptor=Object.getOwnPropertyDescriptor(scope,key);Object.defineProperty(scope,key,Object.assign({},descriptor,{value:proxy}));
    });
  }
  function installFingerprint(config){
    if(!config)return;
    CFG=Object.assign({},config,{noise:Object.assign({canvas:false,audio:false,webgl:false,clientRects:false},config.noise||{})});
    var navProto=scope.Navigator?scope.Navigator.prototype:scope.WorkerNavigator?.prototype;
    if(!navProto)return;
    // Native CDP state can change as related pages/workers are recreated. Guard live reads too.
    patchUA(navProto);

    defAligned(navProto,'webdriver',function(){return false;},scope.navigator,false);
    if(!CFG.nativeHardware)defAligned(navProto,'hardwareConcurrency',function(){return CFG.hardwareConcurrency;},scope.navigator,CFG.hardwareConcurrency);
    if(!CFG.nativeHardware)defAligned(navProto,'deviceMemory',function(){return CFG.deviceMemory;},scope.navigator,CFG.deviceMemory);
    defAligned(navProto,'vendor',function(){return 'Google Inc.';},scope.navigator,'Google Inc.');
    defAligned(navProto,'maxTouchPoints',function(){return CFG.maxTouchPoints||0;},scope.navigator,CFG.maxTouchPoints||0);
    // Language/UA are set natively where supported. Do not add legacy IE properties.
    if(scope.Screen)['width','height','availWidth','availHeight','colorDepth','pixelDepth'].forEach(function(key){defAligned(scope.Screen.prototype,key,function(){return CFG.screen[key];},scope.screen,CFG.screen[key]);});
    installPart('webgl',CFG.noise.webgl,function(){[scope.WebGLRenderingContext,scope.WebGL2RenderingContext].forEach(function(Type){if(!Type)return;wrap(Type.prototype,'getParameter',function(target,receiver,args){
      var native=Reflect.apply(target,receiver,args);
      if(!CFG.noise.webgl||!receiver.getExtension('WEBGL_debug_renderer_info'))return native;
      if(args[0]===37445)return CFG.webgl.vendor;if(args[0]===37446)return CFG.webgl.renderer;return native;
    });});});
    installPart('canvas',CFG.noise.canvas,patchCanvas);
    installPart('audio',CFG.noise.audio,patchAudio);
    installPart('rects',CFG.noise.clientRects,patchRects);
    installPart('rtc',CFG.webrtc!=='proxy',patchRTC);
  }
  return {installFingerprint:installFingerprint};
};
