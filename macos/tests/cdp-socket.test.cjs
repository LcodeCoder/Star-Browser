'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CdpSocket}=require('../src/main/cdp-socket');

class FakeSocket extends EventTarget {
 constructor(){super();this.sent=[];queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
 send(text){this.sent.push(JSON.parse(text));}
 close(){this.dispatchEvent(new Event('close'));}
 message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}
async function connection(t){
 const original=globalThis.WebSocket;globalThis.WebSocket=FakeSocket;
 t.after(()=>{globalThis.WebSocket=original;});
 const pipe=new CdpSocket('ws://127.0.0.1:9222/devtools/browser/test');
 await pipe.ready;t.after(()=>pipe.close());return pipe;
}

test('目标被替换时立即终止旧会话命令，其他环境请求继续完成',async t=>{
 const pipe=await connection(t);
 const old=pipe.send('Runtime.evaluate',{},'old-page',30000);
 const other=pipe.send('Runtime.evaluate',{},'other-page',30000);
 const rejected=assert.rejects(old,{code:'CDP_SESSION_DETACHED'});
 await Promise.resolve();
 const otherId=pipe.socket.sent.find(x=>x.sessionId==='other-page').id;
 pipe.socket.message({method:'Target.detachedFromTarget',params:{sessionId:'old-page'}});
 await rejected;assert.equal(pipe.pending.size,1);
 pipe.socket.message({id:otherId,result:{value:42}});
 assert.deepEqual(await other,{value:42});assert.equal(pipe.pending.size,0);
});

test('断开后的旧会话拒绝新命令，重新附加的会话正常发送',async t=>{
 const pipe=await connection(t);
 pipe.socket.message({method:'Target.detachedFromTarget',params:{sessionId:'old-page'}});
 await assert.rejects(pipe.send('Runtime.evaluate',{},'old-page'),{code:'CDP_SESSION_DETACHED'});
 assert.equal(pipe.socket.sent.length,0);
 pipe.socket.message({method:'Target.attachedToTarget',params:{sessionId:'new-page'}});
 const request=pipe.send('Runtime.evaluate',{},'new-page');await Promise.resolve();
 pipe.socket.message({id:pipe.socket.sent[0].id,result:{ok:true}});
 assert.deepEqual(await request,{ok:true});
});

test('父会话收到子目标断开事件，仅取消子目标请求并忽略迟到响应',async t=>{
 const pipe=await connection(t);
 const child=pipe.send('Page.enable',{},'child-frame',30000);
 const parent=pipe.send('Runtime.evaluate',{},'parent-page',30000);
 const rejected=assert.rejects(child,{code:'CDP_SESSION_DETACHED'});await Promise.resolve();
 const [childMessage,parentMessage]=pipe.socket.sent;
 pipe.socket.message({sessionId:'parent-page',method:'Target.detachedFromTarget',params:{sessionId:'child-frame'}});
 await rejected;
 pipe.socket.message({id:childMessage.id,result:{}});
 assert.equal(pipe.pending.size,1);
 pipe.socket.message({id:parentMessage.id,result:{alive:true}});
 assert.deepEqual(await parent,{alive:true});assert.equal(pipe.pending.size,0);
});
