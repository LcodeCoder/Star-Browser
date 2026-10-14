'use strict';
const {EventEmitter}=require('node:events');

function detachedSessionError(sessionId) {
  const error = new Error('浏览器页面已切换，调试会话已断开：' + sessionId);
  error.code = 'CDP_SESSION_DETACHED';
  return error;
}

// Only connects to Electron's random loopback endpoint. Never accepts remote hosts.
class CdpSocket extends EventEmitter {
  constructor(url) {
    super();
    const endpoint=new URL(url);
    if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1')throw new Error('浏览器配置通道必须使用本机回环地址');
    this.pending=new Map();this.detachedSessions=new Set();this.nextId=0;this.closed=false;
    const traceFile = process.env.TFB_TEST_MODE === '1' && process.env.TFB_TEST_FP_TRACE;
    this.trace = traceFile ? (event, detail = {}) => {
      try { require('node:fs').appendFileSync(traceFile, JSON.stringify({at:new Date().toISOString(),event,...detail})+'\n'); } catch {}
    } : () => {};
    this.socket=new WebSocket(url);
    this.ready=new Promise((resolve,reject)=>{
      this.socket.addEventListener('open',resolve,{once:true});
      this.socket.addEventListener('error',()=>reject(new Error('无法连接内置浏览器配置通道')),{once:true});
    });
    this.socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(!message.id){
        if(message.method==='Target.attachedToTarget')this.detachedSessions.delete(message.params?.sessionId);
        if(message.method==='Target.detachedFromTarget'){
          const sessionId=message.params?.sessionId;
          if(sessionId){
            this.detachedSessions.add(sessionId);
            if(this.detachedSessions.size>1024)this.detachedSessions.delete(this.detachedSessions.values().next().value);
            // Chromium may never reply to a command for a target that was replaced.
            // Reject only that target's work; other environments keep their requests.
            for(const [id,item] of this.pending){
              if(item.sessionId!==sessionId)continue;
              clearTimeout(item.timer);this.pending.delete(id);
              this.trace('session-detached',{id,method:item.method,sessionId});
              item.reject(detachedSessionError(sessionId));
            }
          }
        }
        if(/^(Target\.|Runtime\.executionContext|Debugger\.)/.test(message.method||'')) {
          const params=message.params||{};
          this.trace(message.method,{sessionId:message.sessionId,childSessionId:params.sessionId,
            type:params.targetInfo?.type,targetId:params.targetInfo?.targetId||params.targetId,
            waitingForDebugger:params.waitingForDebugger,reason:params.reason});
        }
        this.emit('message',message);return;
      }
      const item=this.pending.get(message.id);if(!item)return;
      clearTimeout(item.timer);this.pending.delete(message.id);
      this.trace('response',{id:message.id,method:item.method,sessionId:item.sessionId,error:message.error?.message});
      if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);
    });
    this.socket.addEventListener('close',()=>this.close());
    this.socket.addEventListener('error',()=>this.close());
  }
  async send(method,params={},sessionId,timeout=5000) {
    await this.ready;
    if(this.closed)throw new Error('内置浏览器配置通道已关闭');
    if(sessionId&&this.detachedSessions.has(sessionId))throw detachedSessionError(sessionId);
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.trace('timeout',{id,method,sessionId});reject(new Error('浏览器配置超时：'+method));},timeout);
      this.pending.set(id,{resolve,reject,timer,method,sessionId});
      this.trace('send',{id,method,sessionId});
      const message={id,method,params};if(sessionId)message.sessionId=sessionId;
      try{this.socket.send(JSON.stringify(message));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close() {
    if(this.closed)return;this.closed=true;this.trace('closed',{pending:this.pending.size});
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('内置浏览器配置通道已关闭'));}
    this.pending.clear();this.socket.close();this.emit('closed');
  }
}
module.exports={CdpSocket};
