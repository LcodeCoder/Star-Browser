'use strict';
const {app,ipcMain,BrowserWindow,dialog,shell,session,clipboard}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateProfile,validateProxy,importProfiles}=require('./profile-validation');
const {getLaunchedBrowser,getLaunchedBrowsers,findChrome}=require('./launcher');
const {parseProxyInput}=require('./proxy-parse');
const pendingImports=new Map(), downloadItems=new Map();
function registerWorkbench(store) {
  let invalidateTimer;
  store.on('changed',()=>{
    if(invalidateTimer)return;
    invalidateTimer=setTimeout(()=>{
      invalidateTimer=null;
      for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w._profile)w.webContents.send('star:invalidate');
    },60);
    invalidateTimer.unref?.();
  });
  const runtime=()=>{
    const active=new Map();
    for(const w of BrowserWindow.getAllWindows()){
      if(w.isDestroyed()||w._starClosing||!w._profile)continue;
      const id=w._profile.id,row=active.get(id)||{id,running:true,engine:'内置 Chromium',windows:0};
      row.windows++;active.set(id,row);
    }
    for(const [id,chrome] of getLaunchedBrowsers())if(!chrome.pipe.closed&&!active.has(id))active.set(id,{id,running:true,engine:'本机 Chrome',windows:0});
    return [...active.values()].sort((a,b)=>a.id.localeCompare(b.id));
  };
  ipcMain.handle('star:snapshot',(e,knownToken)=>{
    const running=runtime(),token=store.revision()+':'+JSON.stringify(running);
    if(knownToken===token)return {unchanged:true,token};
    return {token,profiles:store.list(),proxies:store.listProxies(),bookmarks:store.listBookmarks(),activity:store.activities(),downloads:store.downloads(),preferences:store.preferences(),runtime:running,engine:{electron:process.versions.electron,chromium:process.versions.chrome,chrome:findChrome(),version:app.getVersion(),platform:process.platform,arch:process.arch}};
  });
  ipcMain.handle('star:action',async(e,action,ids=[],patch={})=>{
    if(!Array.isArray(ids)||ids.length>500)throw new Error('每次最多操作 500 个环境');
    const unique=[...new Set(ids)];
    if(!unique.every(id=>store.get(id)))throw new Error('部分环境已不存在，请刷新列表');
    if(['clone','update','archive','restore','regenerate'].includes(action)){
      const activeIds=new Set(runtime().map(row=>row.id));
      if(['archive','regenerate'].includes(action)&&unique.some(id=>activeIds.has(id)))throw new Error('请先停止所选环境，再更改归档或指纹');
      const validated=action==='update'?validateProfile(patch):null;
      return store.transaction(()=>{
        const results=[];
        for(const id of unique){
          const p=store.get(id);
          if(action==='clone'){const copy=store.clone(id);store.activity('复制环境',copy.name,'复制配置并生成新的稳定指纹');results.push(copy);}
          else if(action==='update'){results.push(store.update(id,validated));store.activity('更新环境',p.name);}
          else if(action==='regenerate'){store.update(id,{seed:crypto.randomUUID()});store.activity('重新生成指纹',p.name);}
          else {store.update(id,{archived:action==='archive'});store.activity(action==='archive'?'归档环境':'恢复环境',p.name);}
        }
        return {ok:true,results};
      });
    }
    if(!['stop','focus'].includes(action))throw new Error('未知操作');
    for(const id of unique){
      if(action==='stop'){
        for(const w of BrowserWindow.getAllWindows())if(w._profile?.id===id)w.close();
        const running=getLaunchedBrowser(id);if(running&&!running.pipe.closed)await running.pipe.send('Browser.close').catch(()=>running.child.kill());
      }else{
        const w=BrowserWindow.getAllWindows().find(w=>!w._starClosing&&w._profile?.id===id);
        if(w){if(w.isMinimized())w.restore();w.show();w.focus();}
        else {const r=getLaunchedBrowser(id);if(r&&!r.pipe.closed){const {targetInfos}=await r.pipe.send('Target.getTargets');const t=targetInfos.find(t=>t.type==='page');if(t)await r.pipe.send('Target.activateTarget',{targetId:t.targetId});}}
      }
    }
    if(action==='stop')store.transaction(()=>{for(const id of unique)store.activity('停止浏览器',store.get(id).name);});
    return {ok:true,results:[]};
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
    return store.transaction(()=>{const results=item.profiles.map(p=>store.create(p));store.activity('导入环境',`${results.length} 个环境`);return {ok:true,count:results.length};});
  });
  ipcMain.handle('star:proxySave',(e,input)=>{const item=store.saveProxy(input);store.activity('保存代理',item.name);return item;});
  ipcMain.handle('star:proxyRemove',(e,id)=>{store.removeProxy(id);store.activity('删除代理配置');return {ok:true};});
  ipcMain.handle('star:proxyImport',(e,text)=>{
    const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(lines.length>500)throw new Error('每次最多导入 500 条代理');
    const proxies=lines.map((line,i)=>{const parsed=parseProxyInput(line);if(!parsed)throw new Error(`第 ${i+1} 行代理格式无效`);return validateProxy(parsed);});
    return store.transaction(()=>{for(const proxy of proxies)store.saveProxy(proxy);store.activity('批量导入代理',`${proxies.length} 条代理`);return {ok:true,count:proxies.length};});
  });
  ipcMain.handle('star:proxyResult',(e,id,result)=>{store.setProxyResult(id,result);return {ok:true};});
  ipcMain.handle('star:preferences',(e,patch)=>{const next=store.preferences(patch);for(const w of BrowserWindow.getAllWindows())w.webContents.send('star:preferencesChanged',next);return next;});
  ipcMain.on('star:sessionNow',(e,id,tabs,index)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id===id)store.sessionTabs(id,tabs,index);});
  ipcMain.handle('star:historyRecord',(e,id,url,title)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id!==id)return false;return store.recordHistory(id,url,title);});
  const permitted=(e,id)=>{const w=BrowserWindow.fromWebContents(e.sender);return !!w&&(!w._profile||w._profile.id===id);};
  ipcMain.handle('star:historyList',(e,id)=>permitted(e,id)?store.history(id):[]);
  ipcMain.handle('star:historyTop',(e,id,n)=>permitted(e,id)?store.historyTop(id,n):[]);
  ipcMain.handle('star:historyClear',async(e,id)=>{if(!permitted(e,id))return false;const choice=await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender),{type:'question',title:'清除历史记录',message:'清除此环境保存的访问记录？',detail:'Cookie 和登录状态会保留。',buttons:['取消','清除记录'],defaultId:0,cancelId:0});if(choice.response!==1)return false;store.clearHistory(id);return true;});
  ipcMain.handle('star:openWorkbench',(e,page)=>{const manager=BrowserWindow.getAllWindows().find(w=>!w._profile&&!w.isDestroyed());if(!manager)return false;manager.show();manager.focus();manager.webContents.send('star:navigate',['environments','downloads','proxies','bookmarks'].includes(page)?page:'environments');return true;});
  ipcMain.handle('star:session',(e,id,tabs,index)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id!==id)return false;store.sessionTabs(id,tabs,index);return true;});
  ipcMain.handle('star:download',(e,id,action)=>{
    const item=downloadItems.get(id),record=store.downloads().find(d=>d.id===id);
    if(!record)throw new Error('下载记录已不存在，请刷新列表');
    if(action==='reveal'){
      if(!record.path||!fs.existsSync(record.path))throw new Error('文件已移动或删除，请检查保存位置');
      shell.showItemInFolder(record.path);return true;
    }
    if(!item)throw new Error('此下载已结束，无法继续控制');
    if(action==='pause')item.pause();
    else if(action==='resume'){if(!item.canResume())throw new Error('服务器不支持继续下载，请重新下载');item.resume();}
    else if(action==='cancel')item.cancel();
    else throw new Error('未知下载操作');
    if(action!=='cancel')store.saveDownload({...record,state:item.isPaused()?'paused':'progressing',received:item.getReceivedBytes()});
    return true;
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
      item.on('updated',(event,state)=>{record.state=item.isPaused()?'paused':state;record.received=item.getReceivedBytes();record.total=item.getTotalBytes();record.path=item.getSavePath();if(Date.now()-last>800){last=Date.now();store.saveDownload({...record});}});
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
