'use strict';
function metadata(fp) {
 const version=fp.chromeVersion,major=version.split('.')[0];
 const platform=fp.os==='android'?'Android':fp.os==='mac'?'macOS':'Windows';
 return {brands:[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major},{brand:'Not-A.Brand',version:'99'}],fullVersionList:[{brand:'Chromium',version},{brand:'Google Chrome',version},{brand:'Not-A.Brand',version:'99.0.0.0'}],fullVersion:version,platform,platformVersion:fp.os==='android'?'13.0.0':fp.os==='mac'?'14.0.0':'10.0.0',architecture:fp.os==='android'?'arm':'x86',model:fp.os==='android'?'SM-S918B':'',mobile:fp.os==='android',bitness:'64',wow64:false};
}
async function applyProtocol(send,fp) {
 await send('Emulation.setUserAgentOverride',{userAgent:fp.userAgent,acceptLanguage:(fp.languages||[fp.language]).join(','),platform:fp.platform,userAgentMetadata:metadata(fp)});
 await send('Emulation.setTimezoneOverride',{timezoneId:fp.timezone});
 await send('Emulation.setLocaleOverride',{locale:fp.language}).catch(()=>{});
 await send('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:fp.hardwareConcurrency}).catch(()=>{});
}
module.exports={metadata,applyProtocol};
