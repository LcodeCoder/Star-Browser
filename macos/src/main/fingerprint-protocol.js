'use strict';
let nativeHints=null;
const hintReads=new WeakMap();
async function captureNativeHints(hostContents){
 if(nativeHints||!hostContents||hostContents.isDestroyed())return;
 if(!hintReads.has(hostContents))hintReads.set(hostContents,hostContents.executeJavaScript("navigator.userAgentData?.getHighEntropyValues(['architecture','bitness','platformVersion','model','wow64'])").then(value=>{if(value?.platformVersion)nativeHints=value;}).catch(()=>{}));
 await hintReads.get(hostContents);
}
function metadata(fp,host={platform:process.platform,arch:process.arch,systemVersion:process.getSystemVersion?.()}) {
 const version=fp.chromeVersion,major=version.split('.')[0];
 const platform=fp.os==='android'?'Android':fp.os==='mac'?'macOS':'Windows';
 const nativeMac=fp.os==='mac'&&host.platform==='darwin';
 const nativePlatform=(fp.os==='mac'&&host.platform==='darwin')||(fp.os==='win'&&host.platform==='win32');
 const hints=nativePlatform?(host.hints||nativeHints):null;
 const architecture=hints?.architecture||(fp.os==='android'||(nativePlatform&&host.arch==='arm64')?'arm':'x86');
 const platformVersion=hints?.platformVersion||(nativeMac&&host.systemVersion?host.systemVersion.split('.').concat(['0','0']).slice(0,3).join('.'):fp.os==='android'?'13.0.0':fp.os==='mac'?'14.0.0':'10.0.0');
 return {brands:[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major},{brand:'Not-A.Brand',version:'99'}],fullVersionList:[{brand:'Chromium',version},{brand:'Google Chrome',version},{brand:'Not-A.Brand',version:'99.0.0.0'}],fullVersion:version,platform,platformVersion,architecture,model:fp.os==='android'?'SM-S918B':'',mobile:fp.os==='android',bitness:hints?.bitness||'64',wow64:hints?.wow64||false,formFactors:[fp.os==='android'?'Mobile':'Desktop']};
}
async function applyDeviceMetrics(send,fp){
 if(fp.displayMode==='native'){
  await send('Emulation.clearDeviceMetricsOverride',{});
  return;
 }
 await send('Emulation.setDeviceMetricsOverride',{width:0,height:0,deviceScaleFactor:fp.devicePixelRatio||1,mobile:fp.os==='android',screenWidth:fp.screen.width,screenHeight:fp.screen.height,screenOrientation:{type:fp.screen.width>=fp.screen.height?'landscapePrimary':'portraitPrimary',angle:fp.screen.width>=fp.screen.height?0:90},dontSetVisibleSize:true});
}
async function applyProtocol(send,fp,{metrics=true,worker=false}={}) {
 await send('Emulation.setUserAgentOverride',{userAgent:fp.userAgent,acceptLanguage:require('./language-settings').languages(fp).join(','),platform:fp.platform,userAgentMetadata:metadata(fp)});
 if(metrics)await applyDeviceMetrics(send,fp);
 await send('Emulation.setTimezoneOverride',{timezoneId:fp.timezone});
 try{await send('Emulation.setLocaleOverride',{locale:fp.language});}catch(error){
  // A page and its Workers can share an ICU locale override. Verify it before accepting it.
  if(!/Another locale override is already in effect/.test(error.message))throw error;
  const current=await send('Runtime.evaluate',{expression:'Intl.DateTimeFormat().resolvedOptions().locale',returnByValue:true});
  const canonical=Intl.getCanonicalLocales(fp.language)[0];
  if(current.result?.value!==canonical)throw new Error('浏览器语言配置冲突：'+current.result?.value+' / '+canonical);
 }
 if(fp.nativeHardware){
  const native=await send('Runtime.evaluate',{expression:'({cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory,secure:isSecureContext})',returnByValue:true});
  const value=native.result?.value;
  if(native.exceptionDetails||!value||value.cpu!==fp.hardwareConcurrency||(value.secure&&value.memory!==fp.deviceMemory))throw new Error('原生硬件策略未生效：CPU/RAM 与环境配置不一致');
 }else await send('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:fp.hardwareConcurrency});
 if(!worker)await send('Emulation.setTouchEmulationEnabled',{enabled:!!fp.maxTouchPoints,...(fp.maxTouchPoints?{maxTouchPoints:fp.maxTouchPoints}:{})});
}
module.exports={metadata,applyProtocol,applyDeviceMetrics,captureNativeHints};
