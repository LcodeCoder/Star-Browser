'use strict';
class BookmarkValidationError extends Error {
 constructor(message,field){super(message);this.name='BookmarkValidationError';this.field=field;}
}
function validateBookmark(input){
 const title=typeof input?.title==='string'?input.title.trim():'';
 const raw=typeof input?.url==='string'?input.url.trim():'';
 if(!title)throw new BookmarkValidationError('请填写书签名称','title');
 if(title.length>512)throw new BookmarkValidationError('书签名称不能超过 512 个字符','title');
 if(!raw||raw.length>4096)throw new BookmarkValidationError(raw?'书签网址不能超过 4096 个字符':'请填写书签网址','url');
 if(!/^https?:\/\//i.test(raw)||/[\u0000-\u001f\u007f]/.test(raw))throw new BookmarkValidationError('请输入完整的 http:// 或 https:// 网址','url');
 let url;try{url=new URL(raw);}catch{throw new BookmarkValidationError('请输入完整的 http:// 或 https:// 网址','url');}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw new BookmarkValidationError('请输入完整的 http:// 或 https:// 网址','url');
 if(url.username||url.password)throw new BookmarkValidationError('书签网址不能包含账号或密码','url');
 return {title,url:url.href};
}
module.exports={BookmarkValidationError,validateBookmark};
