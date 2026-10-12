'use strict';
const {app,ipcMain,BrowserWindow,dialog,shell,session,clipboard}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateProfile,validateProxy,importProfiles}=require('./profile-validation');
const {getLaunchedBrowser,findChrome}=require('./launcher');
const {parseProxyInput}=require('./proxy-parse');
const pendingImports=new Map(), downloadItems=new Map();
function registerWorkbench(store) {
  const runtime=()=>store.list().map(p=>{
    const windows=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w._profile?.id===p.id);
    const chrome=getLaunchedBrowser(p.id);
    return {id:p.id,running:windows.length>0||!!(chrome&&!chrome.pipe.closed),engine:windows.length?'内置 Chromium':chrome&&!chrome.pipe.closed?'本机 Chrome':'',windows:windows.length};
  });
  ipcMain.handle('star:snapshot',()=>({profiles:store.list(),proxies:store.listProxies(),bookmarks:store.listBookmarks(),activity:store.activities(),downloads:store.downloads(),preferences:store.preferences(),runtime:runtime(),engine:{electron:process.versions.electron,chromium:process.versions.chrome,chrome:findChrome(),version:app.getVersion(),platform:process.platform,arch:process.arch}}));
  ipcMain.handle('star:action',async(e,action,ids=[],patch={})=>{
    const unique=[...new Set(ids)].slice(0,500);
    if (!unique.every(id=>store.get(id))) throw new Error('部分环境已不存在，请刷新列表');
    const results=[];
    for(const id of unique){
      const p=store.get(id);
      if(action==='clone'){const copy=store.clone(id);store.activity('复制环境',copy.name,'复制配置并生成新的稳定指纹');results.push(copy);}
      else if(action==='update'){const result=store.update(id,validateProfile(patch));store.activity('更新环境',p.name);results.push(result);}
      else if(action==='archive'||action==='restore'){
        if(runtime().find(r=>r.id===id)?.running) throw new Error('请先停止该环境，再移入归档');
        store.update(id,{archived:action==='archive'});store.activity(action==='archive'?'归档环境':'恢复环境',p.name);
      }
      else if(action==='stop'){
        for(const w of BrowserWindow.getAllWindows())if(w._profile?.id===id)w.close();
        const running=getLaunchedBrowser(id);if(running&&!running.pipe.closed)await running.pipe.send('Browser.close').catch(()=>running.child.kill());
        store.activity('停止浏览器',p.name);
      }
      else if(action==='focus'){
        const w=BrowserWindow.getAllWindows().find(w=>w._profile?.id===id);
        if(w){if(w.isMinimized())w.restore();w.show();w.focus();}
        else {const r=getLaunchedBrowser(id);if(r&&!r.pipe.closed){const {targetInfos}=await r.pipe.send('Target.getTargets');const t=targetInfos.find(t=>t.type==='page');if(t)await r.pipe.send('Target.activateTarget',{targetId:t.targetId});}}
      }
      else if(action==='regenerate'){
        if(runtime().find(r=>r.id===id)?.running)throw new Error('请先停止浏览器，再重新生成指纹');
        store.update(id,{seed:crypto.randomUUID()});store.activity('重新生成指纹',p.name);
      }
      else throw new Error('未知操作');
    }
    return {ok:true,results};
  });
  ipcMain.handle('star:export',async(e,ids=[])=>{
    const list=store.list().filter(p=>!ids.length||ids.includes(p.id));
    const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender),{title:'导出环境配置',defaultPath:'Star-Browser-profiles.json',filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled)return {canceled:true};
    const profiles=list.map(p=>validateProfile(p,true));
    fs.writeFileSync(result.filePath,JSON.stringify({format:'star-browser-profiles',version:1,exportedAt:new Date().toISOString(),profiles},null,2),{mode:0o600});
    store.activity('导出环境',`${profiles.length} 个环境`);return {ok:true,count:profiles.length,path:result.filePath};
  });
  ipcMain.handle('star:importPreview',async(e)=>{
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'选择环境配置',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled)return {canceled:true};
    if(fs.statSync(result.filePaths[0]).size>10*1024*1024)throw new Error('导入文件不能超过 10 MB');
    const profiles=importProfiles(JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'))),token=crypto.randomUUID();
    pendingImports.set(token,{profiles,time:Date.now(),sender:e.sender.id});
    return {token,count:profiles.length,profiles:profiles.map(p=>({name:p.name,group:p.group,os:p.os,tags:p.tags}))};
  });
  ipcMain.handle('star:importApply',(e,token)=>{
    const item=pendingImports.get(token);pendingImports.delete(token);
    if(!item||item.sender!==e.sender.id||Date.now()-item.time>10*60*1000)throw new Error('导入预览已过期，请重新选择文件');
    const results=item.profiles.map(p=>store.create(p));store.activity('导入环境',`${results.length} 个环境`);return {ok:true,count:results.length};
  });
  ipcMain.handle('star:proxySave',(e,input)=>{const item=store.saveProxy(input);store.activity('保存代理',item.name);return item;});
  ipcMain.handle('star:proxyRemove',(e,id)=>{store.removeProxy(id);store.activity('删除代理配置');return {ok:true};});
  ipcMain.handle('star:proxyImport',(e,text)=>{
    const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(lines.length>500)throw new Error('每次最多导入 500 条代理');
    const proxies=lines.map((line,i)=>{const parsed=parseProxyInput(line);if(!parsed)throw new Error(`第 ${i+1} 行代理格式无效`);return validateProxy(parsed);});
    for(const proxy of proxies)store.saveProxy(proxy);
    store.activity('批量导入代理',`${proxies.length} 条代理`);return {ok:true,count:proxies.length};
  });
  ipcMain.handle('star:proxyResult',(e,id,result)=>{store.setProxyResult(id,result);return {ok:true};});
  ipcMain.handle('star:preferences',(e,patch)=>store.preferences(patch));
  ipcMain.handle('star:session',(e,id,tabs,index)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id!==id)return false;store.sessionTabs(id,tabs,index);return true;});
  ipcMain.handle('star:download',(e,id,action)=>{
    const item=downloadItems.get(id),record=store.downloads().find(d=>d.id===id);
    if(action==='pause')item?.pause();else if(action==='resume')item?.resume();else if(action==='cancel')item?.cancel();
    else if(action==='reveal'&&record?.path)shell.showItemInFolder(record.path);
    return !!record;
  });
  ipcMain.handle('star:copy',(e,value)=>{clipboard.writeText(String(value).slice(0,100000));return true;});
  app.on('before-quit',()=>store.flush());

  function bindSession(ses){
    if(ses.__starBound)return;ses.__starBound=true;
    ses.on('will-download',(e,item,wc)=>{
      const id=crypto.randomUUID(),profileId=ses.__tfbEnvId||'',p=store.get(profileId);
      const record={id,profileId,profileName:p?.name||'浏览器',name:item.getFilename(),url:item.getURL(),total:item.getTotalBytes(),received:0,state:'progressing',time:Date.now(),path:''};
      downloadItems.set(id,item);store.saveDownload(record);
      let last=0;
      item.on('updated',(event,state)=>{record.state=item.isPaused()?'paused':state;record.received=item.getReceivedBytes();record.total=item.getTotalBytes();if(Date.now()-last>800){last=Date.now();store.saveDownload({...record});}});
      item.once('done',(event,state)=>{record.state=state;record.received=item.getReceivedBytes();record.path=item.getSavePath();store.saveDownload({...record});downloadItems.delete(id);store.activity(state==='completed'?'下载完成':'下载中断',record.name);});
    });
    ses.setPermissionCheckHandler((wc,permission)=>store.get(ses.__tfbEnvId)?.permissions?.[permission]!=='block');
    ses.setPermissionRequestHandler(async(wc,permission,callback,details)=>{
      const p=store.get(ses.__tfbEnvId),setting=p?.permissions?.[permission]||'ask';
      if(setting!=='ask')return callback(setting==='allow');
      if(process.env.TFB_TEST_MODE==='1')return callback(false);
      const labels={geolocation:'位置信息',notifications:'通知',media:'摄像头或麦克风','clipboard-read':'读取剪贴板',midi:'MIDI 设备','display-capture':'屏幕共享'};
      const label=labels[permission];if(!label)return callback(false);
      let host='此网站';try{host=new URL(details.requestingUrl||wc.getURL()).host;}catch{}
      try{const result=await dialog.showMessageBox(BrowserWindow.fromWebContents(wc),{type:'question',title:`${p?.name||'Star Browser'} · 网站权限`,message:`${host} 想访问${label}`,buttons:['拒绝','本次允许'],defaultId:0,cancelId:0});callback(result.response===1);}catch{callback(false);}
    });
  }
  app.on('session-created',bindSession);bindSession(session.defaultSession);
}
module.exports={registerWorkbench};
