"use strict";
// Serialized into generated config.js and CDP scripts. Keep all state in closures.
module.exports=function injectFingerprint(config,eventType,createRuntime){
  'use strict';
  const request={config,installed:false};
  const event=new Event(eventType);
  Object.defineProperty(event,'detail',{value:request});
  globalThis.dispatchEvent(event);
  if(request.installed)return true;
  const runtime=createRuntime(globalThis);
  runtime.installFingerprint(config);
  // A process-random event name allows repeated installation without window globals.
  globalThis.addEventListener(eventType,event=>{
    const request=event.detail;
    if(!request||!Object.hasOwn(request,'config'))return;
    runtime.installFingerprint(request.config);
    request.installed=true;
  });
  return true;
};
