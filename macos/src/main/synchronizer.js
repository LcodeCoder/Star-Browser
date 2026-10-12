'use strict';
const {EventEmitter}=require('node:events');
const {app,BrowserWindow,webContents,screen}=require('electron');
class Synchronizer extends EventEmitter{
 constructor(store){
  super();this.store=store;this.active=new Map();this.bound=new WeakSet();this.session=null;this.queues=new Map();this.layouts=new Map();this.generation=0;this.lastMove=0;
  app.on('web-contents-created',(_,wc)=>this.bind(wc));for(const wc of webContents.getAllWebContents())this.bind(wc);
 }
 status(){return this.session?{...this.session,followers:[...this.session.followers]}:{active:false,paused:false,master:'',followers:[]};}
 changed(){this.emit('changed',this.status());}
 window(id){return BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w._starClosing&&w._profile?.id===id);}
 activeGuest(id){const row=this.active.get(id),wc=row&&webContents.fromId(row.guestId);return wc&&!wc.isDestroyed()?{...row,wc}:null;}
 setActive(event,id,guestId,size){
  const parent=BrowserWindow.fromWebContents(event.sender),wc=webContents.fromId(guestId);
  if(!parent||parent._profile?.id!==id||!wc||wc.getType()!=='webview'||wc.hostWebContents?.id!==event.sender.id||wc.session.__tfbEnvId!==id)return false;
  const changed=this.active.get(id)?.guestId!==guestId;
  this.active.set(id,{guestId,width:Math.max(1,Math.min(20000,Number(size?.width)||1)),height:Math.max(1,Math.min(20000,Number(size?.height)||1))});
  if(changed&&this.session?.master===id){this.generation++;this.queues.clear();if(!this.session.paused&&this.session.navigation)this.navigate(wc.getURL());}return true;
 }
 start({master,followers,navigation=true}){
  if(this.session)throw new Error('请先停止当前同步');
  if(!Array.isArray(followers)||followers.length<1||followers.length>9||new Set([master,...followers]).size!==followers.length+1)throw new Error('同步需要 2–10 个不同环境');
  for(const id of [master,...followers]){
   if(!this.store.get(id)||!this.window(id)||!this.activeGuest(id)?.wc.__starDocumentReady||this.activeGuest(id).wc.isLoading())throw new Error('请先启动所选环境的内置浏览器，并等待页面就绪');
   require('./profile-backups').assertProfileUnlocked(id);
  }
  this.generation++;this.session={active:true,paused:false,master,followers:[...followers],navigation:!!navigation,startedAt:Date.now(),error:''};this.changed();
  if(navigation)this.navigate(this.activeGuest(master).wc.getURL());
  this.store.activity('开始窗口同步',this.store.get(master).name,`${followers.length} 个跟随环境`);
  for(const id of [master,...followers]){const window=this.window(id);window.once('closed',()=>{if(this.session?.master===id||this.session?.followers.includes(id))this.stop('参与同步的环境已关闭');});}
  return this.status();
 }
 pause(value){if(!this.session)throw new Error('当前没有进行中的同步');this.generation++;this.session.paused=!!value;this.session.error='';this.queues.clear();this.changed();if(!value&&this.session.navigation)this.navigate(this.activeGuest(this.session.master)?.wc.getURL());return this.status();}
 stop(reason=''){
  const previous=this.session;if(!previous)return this.status();this.generation++;this.session=null;this.queues.clear();
  for(const [id,layout]of this.layouts){const window=this.window(id);if(window){window.setMinimumSize(...layout.minimum);window.setBounds(layout.bounds);}}
  this.layouts.clear();this.store.activity('停止窗口同步',this.store.get(previous.master)?.name||'',reason);this.changed();return this.status();
 }
 tile(){
  if(!this.session)throw new Error('请先开始同步');const ids=[this.session.master,...this.session.followers],master=this.window(ids[0]),area=screen.getDisplayMatching(master.getBounds()).workArea;
  const columns=Math.ceil(Math.sqrt(ids.length)),rows=Math.ceil(ids.length/columns),width=Math.floor(area.width/columns),height=Math.floor(area.height/rows);
  if(width<440||height<420)throw new Error('当前屏幕无法完整排列这些窗口，请减少跟随环境或使用更大屏幕');
  ids.forEach((id,index)=>{const window=this.window(id);if(!this.layouts.has(id))this.layouts.set(id,{bounds:window.getBounds(),minimum:window.getMinimumSize()});if(window.isMaximized())window.unmaximize();window.setMinimumSize(440,420);window.setBounds({x:area.x+index%columns*width,y:area.y+Math.floor(index/columns)*height,width,height});window.show();});master.focus();return true;
 }
 bind(wc){
  if(this.bound.has(wc))return;this.bound.add(wc);
  wc.on('before-mouse-event',(_,input)=>this.mouse(wc,input));
  wc.on('before-input-event',(_,input)=>this.keyboard(wc,input));
  wc.on('did-navigate',(_,url)=>{if(this.isMaster(wc)&&this.session.navigation)this.navigate(url);});
  wc.on('did-navigate-in-page',(_,url,isMainFrame)=>{if(isMainFrame&&this.isMaster(wc)&&this.session.navigation)this.navigate(url);});
 }
 isMaster(wc){return !!this.session&&!this.session.paused&&wc.session.__tfbEnvId===this.session.master&&this.active.get(this.session.master)?.guestId===wc.id;}
 navigate(url){
  if(!this.session||this.session.paused||!/^https?:\/\//i.test(url||''))return;
  this.generation++;this.queues.clear();
  for(const id of this.session.followers){const window=this.window(id);if(window)window.webContents.send('star:syncNavigate',url);}
 }
 enqueue(id,method,params){
  const version=this.generation,queue=this.queues.get(id)||{promise:Promise.resolve(),pending:0};
  if(queue.pending>=200){this.session.paused=true;this.session.error='跟随页面响应过慢，已暂停同步。检查页面后可继续。';this.generation++;this.queues.clear();this.changed();return;}
  queue.pending++;queue.promise=queue.promise.then(async()=>{
   if(!this.session||this.session.paused||this.generation!==version)return;
   const guest=this.activeGuest(id);if(!guest||guest.wc.isLoading()||!guest.wc.__starDocumentReady)return;
   if(!guest.wc.debugger.isAttached())guest.wc.debugger.attach('1.3');
   const values=typeof params==='function'?await params(guest):params;await guest.wc.debugger.sendCommand(method,values);
  }).catch(error=>{if(this.session&&this.generation===version){this.session.paused=true;this.session.error='跟随环境无法接收操作：'+error.message;this.generation++;this.queues.clear();this.changed();}}).finally(()=>{queue.pending--;});this.queues.set(id,queue);
 }
 mouse(wc,input){
  if(!this.isMaster(wc)||!['mouseDown','mouseUp','mouseMove'].includes(input.type))return;
  if(input.type==='mouseMove'&&Date.now()-this.lastMove<16)return;if(input.type==='mouseMove')this.lastMove=Date.now();
  const source=this.active.get(this.session.master),modifiers=input.modifiers||[],flags=(modifiers.includes('alt')?1:0)|(modifiers.includes('control')?2:0)|(modifiers.includes('meta')?4:0)|(modifiers.includes('shift')?8:0);
  for(const id of this.session.followers)this.enqueue(id,'Input.dispatchMouseEvent',target=>{
   const values={type:{mouseDown:'mousePressed',mouseUp:'mouseReleased',mouseMove:'mouseMoved',mouseWheel:'mouseWheel'}[input.type],x:Math.max(0,Math.min(target.width-1,input.x/source.width*target.width)),y:Math.max(0,Math.min(target.height-1,input.y/source.height*target.height)),modifiers:flags,button:input.button||'none',buttons:(modifiers.includes('leftbuttondown')?1:0)|(modifiers.includes('rightbuttondown')?2:0)|(modifiers.includes('middlebuttondown')?4:0)};
   if(['mouseDown','mouseUp'].includes(input.type))values.clickCount=input.clickCount||1;
   if(input.type==='mouseWheel'){values.deltaX=-(input.deltaX||0);values.deltaY=-(input.deltaY||0);}
   return values;
  });
 }
 wheel(wc,input){
  if(!this.isMaster(wc)||!input||!['x','y','deltaX','deltaY'].every(key=>Number.isFinite(input[key])))return;
  const source=this.active.get(this.session.master),factor=input.deltaMode===1?20:input.deltaMode===2?source.height:1;
  for(const id of this.session.followers)this.enqueue(id,'Input.dispatchMouseEvent',target=>({type:'mouseWheel',x:Math.max(0,Math.min(target.width-1,input.x/source.width*target.width)),y:Math.max(0,Math.min(target.height-1,input.y/source.height*target.height)),deltaX:Math.max(-10000,Math.min(10000,input.deltaX*factor)),deltaY:Math.max(-10000,Math.min(10000,input.deltaY*factor))}));
 }
 paste(wc,text){if(!this.isMaster(wc)||typeof text!=="string"||text.length>1000000)return;for(const id of this.session.followers)this.enqueue(id,"Input.insertText",{text});}
 keyboard(wc,input){
  if(!this.isMaster(wc)||input.isComposing||!['keyDown','keyUp'].includes(input.type))return;
  const key=input.key||'',mod=input.control||input.meta,lower=key.toLowerCase();
  if(mod&&['t','w','l','f','y','k','r','+','=','-','0','tab','c','v','x','a'].includes(lower)){
   if(input.type==='keyDown'&&['x','a'].includes(lower))for(const id of this.session.followers)this.enqueue(id,'Input.dispatchKeyEvent',{type:'keyDown',key:lower,code:input.code,modifiers:(input.meta?4:0)|(input.control?2:0),commands:[lower==='a'?'selectAll':'deleteBackward']});
   return;
  }
  const modifiers=(input.alt?1:0)|(input.control?2:0)|(input.meta?4:0)|(input.shift?8:0),codes={Backspace:8,Tab:9,Enter:13,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Delete:46,Home:36,End:35,PageUp:33,PageDown:34};
  const values={type:input.type,key,code:input.code||'',modifiers,autoRepeat:!!input.isAutoRepeat,windowsVirtualKeyCode:codes[key]||(key.length===1?key.toUpperCase().charCodeAt(0):0)};
  if(input.type==='keyDown'&&!mod){if(key.length===1&&!input.alt)values.text=key;else if(key==='Enter')values.text='\r';}
  for(const id of this.session.followers)this.enqueue(id,'Input.dispatchKeyEvent',values);
 }
}
module.exports={Synchronizer};
