'use strict';
const {EventEmitter}=require('events');

// Chrome 的本地调试管道（fd 3/4），不开放网络监听端口。
class CdpPipe extends EventEmitter {
  constructor(child) {
    super();
    this.child=child;
    this.nextId=0;
    this.pending=new Map();
    this.buffer='';
    this.closed=false;
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data',chunk=>{
      this.buffer+=chunk;
      let end;
      while((end=this.buffer.indexOf('\0'))>=0){
        const raw=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
        if(!raw)continue;
        let message;try{message=JSON.parse(raw);}catch{continue;}
        if(message.id){
          const pending=this.pending.get(message.id);
          if(!pending)continue;
          this.pending.delete(message.id);clearTimeout(pending.timer);
          if(message.error)pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }else this.emit('message',message);
      }
    });
    const close=()=>this.close();
    child.once('exit',close);child.once('error',close);
    child.stdio[3].on('error',close);child.stdio[4].on('error',close);child.stdio[4].once('end',close);
  }
  send(method,params={},sessionId,timeout=15000) {
    if(this.closed)return Promise.reject(new Error('Chrome 调试管道已关闭'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Chrome 命令超时：'+method));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      const message={id,method,params};if(sessionId)message.sessionId=sessionId;
      this.child.stdio[3].write(JSON.stringify(message)+'\0',error=>{
        if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
      });
    });
  }
  close() {
    if(this.closed)return;
    this.closed=true;
    for(const {reject,timer}of this.pending.values()){clearTimeout(timer);reject(new Error('Chrome 调试管道已关闭'));}
    this.pending.clear();this.emit('closed');
  }
}
module.exports={CdpPipe};
