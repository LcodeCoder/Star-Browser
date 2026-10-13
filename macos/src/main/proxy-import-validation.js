'use strict';
const {parseProxyInput}=require('./proxy-parse');
class ProxyImportError extends Error {
  constructor(message,line,start,end){super(message);this.name='ProxyImportError';this.line=line;this.start=start;this.end=end;}
}
function validateProxyImport(input){
 const text=String(input??''),lines=[];let offset=0;
 for(const [index,raw] of text.split(/\r?\n/).entries()){
  if(raw.trim())lines.push({raw:raw.trim(),line:index+1,start:offset,end:offset+raw.length});
  offset+=raw.length+(text[offset+raw.length]==='\r'?2:1);
 }
 if(!lines.length)throw new ProxyImportError('请粘贴至少一条代理配置',0,0,0);
 if(lines.length>500)throw new ProxyImportError('每次最多导入 500 条代理',lines[500].line,lines[500].start,lines[500].end);
 return lines.map(line=>{const proxy=parseProxyInput(line.raw);if(!proxy)throw new ProxyImportError(`第 ${line.line} 行代理格式无效`,line.line,line.start,line.end);return proxy;});
}
module.exports={validateProxyImport,ProxyImportError};
