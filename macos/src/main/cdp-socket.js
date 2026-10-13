'use strict';
const {EventEmitter}=require('node:events');

// Only connects to Electron's random loopback endpoint. Never accepts remote hosts.
class CdpSocket extends EventEmitter {
  constructor(url) {
    super();
    const endpoint=new URL(url);
    if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1')throw new Error('浏览器配置通道必须使用本机回环地址');
    this.pending=new Map();this.nextId=0;this.closed=false;
    this.socket=new WebSocket(url);
    this.ready=new Promise((resolve,reject)=>{
      this.socket.addEventListener('open',resolve,{once:true});
      this.socket.addEventListener('error',()=>reject(new Error('无法连接内置浏览器配置通道')),{once:true});
    });
    this.socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(!message.id){this.emit('message',message);return;}
      const item=this.pending.get(message.id);if(!item)return;
      clearTimeout(item.timer);this.pending.delete(message.id);
      if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);
    });
    this.socket.addEventListener('close',()=>this.close());
    this.socket.addEventListener('error',()=>this.close());
  }
  async send(method,params={},sessionId,timeout=5000) {
    await this.ready;
    if(this.closed)throw new Error('内置浏览器配置通道已关闭');
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('浏览器配置超时：'+method));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      const message={id,method,params};if(sessionId)message.sessionId=sessionId;
      try{this.socket.send(JSON.stringify(message));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close() {
    if(this.closed)return;this.closed=true;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('内置浏览器配置通道已关闭'));}
    this.pending.clear();this.socket.close();this.emit('closed');
  }
}
module.exports={CdpSocket};
