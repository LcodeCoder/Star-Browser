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
 return {brands:[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major},{brand:'Not-A.Brand',version:'99'}],fullVersionList:[{brand:'Chromium',version},{brand:'Google Chrome',version},{brand:'Not-A.Brand',version:'99.0.0.0'}],fullVersion:version,platform,platformVersion,architecture,model:fp.os==='android'?'SM-S918B':'',mobile:fp.os==='android',bitness:hints?.bitness||'64',wow64:hints?.wow64||false};
}
async function applyProtocol(send,fp,{metrics=true}={}) {
 await send('Emulation.setUserAgentOverride',{userAgent:fp.userAgent,acceptLanguage:(fp.languages||[fp.language]).join(','),platform:fp.platform,userAgentMetadata:metadata(fp)});
 if(metrics)await send('Emulation.setDeviceMetricsOverride',{width:0,height:0,deviceScaleFactor:fp.devicePixelRatio||1,mobile:fp.os==='android',screenWidth:fp.screen.width,screenHeight:fp.screen.height,dontSetVisibleSize:true});
 await send('Emulation.setTimezoneOverride',{timezoneId:fp.timezone});
 await send('Emulation.setLocaleOverride',{locale:fp.language}).catch(()=>{});
 await send('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:fp.hardwareConcurrency}).catch(()=>{});
}
module.exports={metadata,applyProtocol,captureNativeHints};
