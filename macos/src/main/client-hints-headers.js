'use strict';
const {metadata}=require('./fingerprint-protocol');
function secureOrigin(url){try{const u=new URL(url);return u.protocol==='https:'||(u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.hostname==='[::1]'))?u.origin:null;}catch{return null;}}
// Electron omits UA hints from some webview requests. Keep low-entropy hints
// consistent; disclose additional values only after that origin opts in.
function createClientHints(){
 const accepted=new Map();
 return {
  receive(url,headers){const origin=secureOrigin(url);if(!origin)return;const key=Object.keys(headers||{}).find(k=>k.toLowerCase()==='accept-ch');if(!key)return;const names=[headers[key]].flat().join(',').toLowerCase().split(',').map(s=>s.trim());accepted.delete(origin);accepted.set(origin,new Set(names));if(accepted.size>256)accepted.delete(accepted.keys().next().value);},
  apply(url,headers,fp){const origin=secureOrigin(url);if(!origin||!fp)return headers;const m=metadata(fp),quote=JSON.stringify,list=values=>values.map(b=>`${quote(b.brand)};v=${quote(b.version)}`).join(', ');
   const values={'sec-ch-ua':list(m.brands),'sec-ch-ua-platform':quote(m.platform),'sec-ch-ua-mobile':m.mobile?'?1':'?0','sec-ch-ua-full-version':quote(m.fullVersion),'sec-ch-ua-full-version-list':list(m.fullVersionList),'sec-ch-ua-platform-version':quote(m.platformVersion),'sec-ch-ua-arch':quote(m.architecture),'sec-ch-ua-bitness':quote(m.bitness),'sec-ch-ua-wow64':m.wow64?'?1':'?0','sec-ch-ua-model':quote(m.model),'sec-ch-ua-form-factors':quote(m.mobile?'Mobile':'Desktop')};
   const low=new Set(['sec-ch-ua','sec-ch-ua-platform','sec-ch-ua-mobile']);
   for(const key of Object.keys(headers)){const lower=key.toLowerCase();if(lower in values)headers[key]=values[lower];}
   for(const [key,value] of Object.entries(values))if(low.has(key)||accepted.get(origin)?.has(key)){const present=Object.keys(headers).find(k=>k.toLowerCase()===key);headers[present||key]=value;}
   return headers;
  }
 };
}
module.exports={createClientHints,secureOrigin};
