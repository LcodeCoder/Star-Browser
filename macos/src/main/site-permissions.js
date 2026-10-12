'use strict';
const labels={
  geolocation:'位置信息',notifications:'通知',media:'摄像头或麦克风',
  'clipboard-read':'读取剪贴板',midi:'MIDI 设备','display-capture':'屏幕共享',
  'local-fonts':'本机字体','window-management':'屏幕信息',fileSystem:'文件与文件夹',
  'local-network':'本地网络设备','loopback-network':'本机网络服务',
};
const aliases={'geolocation-approximate':'geolocation','midiSysex':'midi','speaker-selection':'media','local-network-access':'local-network'};
const ordinary=new Set(['fullscreen','pointerLock','clipboard-sanitized-write','screen-wake-lock','mediaKeySystem','background-sync']);
function bindSitePermissions(ses,store,{dialog,BrowserWindow}){
  const pending=new Map();
  const setting=permission=>store.get(ses.__tfbEnvId)?.permissions?.[aliases[permission]||permission]||'ask';
  ses.setPermissionCheckHandler((wc,permission)=>ordinary.has(permission)||setting(permission)==='allow');
  ses.setPermissionRequestHandler(async(wc,permission,callback,details={})=>{
    const key=aliases[permission]||permission,state=setting(key);
    if(ordinary.has(permission))return callback(true);
    if(state!=='ask')return callback(state==='allow');
    if(!labels[key]||!wc||wc.isDestroyed())return callback(false);
    const url=details.requestingUrl||details.securityOrigin||wc.getURL();
    let host,origin;try{const parsed=new URL(url);host=parsed.host;origin=parsed.origin;}catch{return callback(false);}
    if(!host)return callback(false);
    const scope=wc.id+':'+origin+':'+key;
    try{
      let choice=pending.get(scope);
      if(!choice){
        const p=store.get(ses.__tfbEnvId),parent=BrowserWindow.fromWebContents(wc.hostWebContents||wc);
        const media=key==='media'&&details.mediaTypes?.length?'（'+details.mediaTypes.map(t=>t==='video'?'摄像头':t==='audio'?'麦克风':t).join('、')+'）':'';
        choice=dialog.showMessageBox(parent,{type:'question',title:(p?.name||'Star Browser')+' · 网站权限',message:host+' 想访问'+labels[key]+media,detail:'这次选择只用于当前请求。可以在环境设置中更改默认权限。',buttons:['拒绝','本次允许'],defaultId:0,cancelId:0}).then(result=>result.response===1);
        pending.set(scope,choice);choice.finally(()=>pending.delete(scope)).catch(()=>{});
      }
      const granted=await choice;
      const allowed=granted&&!wc.isDestroyed();
      store.activity(allowed?'允许网站权限':'拒绝网站权限',host,labels[key]);
      callback(allowed);
    }catch{callback(false);}
  });
}
module.exports={bindSitePermissions};
