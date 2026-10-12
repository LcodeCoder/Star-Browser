"use strict";
// Supports URL credentials, host:port:user:pass and bracketed IPv6.
function parseProxyInput(raw) {
 let value=String(raw||'').trim(),type='socks5';if(!value)return null;
 const prefix=value.match(/^([a-z][a-z\d+.-]*):\/\//i);
 if(prefix){const protocol=prefix[1].toLowerCase();if(!['http','https','socks5','socks'].includes(protocol))return null;type=protocol==='socks'?'socks5':protocol;value=value.slice(prefix[0].length);}
 let user='',pass='';const at=value.lastIndexOf('@');
 if(at>=0){const credentials=value.slice(0,at),colon=credentials.indexOf(':');try{user=decodeURIComponent(colon<0?credentials:credentials.slice(0,colon));pass=colon<0?'':decodeURIComponent(credentials.slice(colon+1));}catch{return null;}value=value.slice(at+1);}
 let host,parts;
 if(value.startsWith('[')){const close=value.indexOf(']');if(close<0||value[close+1]!==':')return null;host=value.slice(1,close);parts=value.slice(close+2).split(':');}
 else {parts=value.split(':');host=parts.shift();}
 const port=parts.shift();if(at<0&&parts.length){user=parts.shift();pass=parts.join(':');}else if(parts.length)return null;
 if(!host||!/^\d+$/.test(port||'')||Number(port)<1||Number(port)>65535||/[\s/?#@]/.test(host))return null;
 return {type,host,port,user,pass};
}
function buildProxyRules(proxy) {
 if(!proxy?.host)return '';
 const scheme=proxy.type==='socks5'?'socks5':proxy.type==='https'?'https':'http';
 const host=String(proxy.host).trim().replace(/^\[|\]$/g,'');
 return `${scheme}://${host.includes(':')?'['+host+']':host}:${String(proxy.port|| (scheme==='socks5'?'1080':'8080')).trim()}`;
}
module.exports={parseProxyInput,buildProxyRules};
