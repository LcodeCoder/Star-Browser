'use strict';
const {app,ipcMain,BrowserWindow,dialog,shell,session,clipboard}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateProfile,validateProxy,importProfiles}=require('./profile-validation');
const {getLaunchedBrowser,getLaunchedBrowsers,findChrome}=require('./launcher');
const {parseProxyInput}=require('./proxy-parse');
const pendingImports=new Map(), downloadItems=new Map();
function registerWorkbench(store,{commands,starting,launches=()=>[]}={}) {
  const extensions=require('./extensions').initExtensionLibrary(app.getPath('userData'),store),pendingExtensions=new Map();
  ipcMain.handle('star:extensionPreview',async(e)=>{
    const choice=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'选择已解压扩展',properties:['openDirectory']});if(choice.canceled)return {canceled:true};
    const inspected=await require('./extensions').inspectExtension(choice.filePaths[0]),token=crypto.randomUUID();
    pendingExtensions.set(token,{directory:inspected.root,hash:inspected.manifestHash,time:Date.now(),sender:e.sender.id});
    return {token,...inspected.metadata};
  });
  ipcMain.handle('star:extensionApply',async(e,token)=>{
    const item=pendingExtensions.get(token);pendingExtensions.delete(token);
    if(!item||item.sender!==e.sender.id||Date.now()-item.time>10*60*1000)throw new Error('扩展预览已过期，请重新选择目录');
    return extensions.import(item.directory,item.hash);
  });
  ipcMain.handle('star:extensionRemove',async(e,id)=>{
    const assigned=new Set(store.list().filter(p=>p.extensions?.includes(id)).map(p=>p.id));
    const loaded=BrowserWindow.getAllWindows().some(w=>!w.isDestroyed()&&w._profile?.extensions?.includes(id))||getLaunchedBrowsers().some(([,browser])=>!browser.pipe.closed&&browser.userExtensions?.some(item=>item.id===id));
    for(const profileId of assigned)require('./profile-backups').assertProfileUnlocked(profileId);
    if(loaded||runtime().some(row=>assigned.has(row.id)))throw new Error('请先停止使用该扩展的环境，再移除');
    await extensions.remove(id);return true;
  });
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
    for(const [id,chrome] of getLaunchedBrowsers())if(!chrome.pipe.closed&&!active.has(id))active.set(id,{id,running:true,engine:chrome.nativeKernel?'Star Chromium（原生硬件）':'本机 Chrome',windows:0});
    return [...active.values()].sort((a,b)=>a.id.localeCompare(b.id));
  };
  const synchronizer=new (require('./synchronizer').Synchronizer)(store);
  synchronizer.on('changed',status=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()){w.webContents.send('star:syncState',status);if(!w._profile)w.webContents.send('star:invalidate');}});
  ipcMain.on('star:syncWheel',(e,input)=>synchronizer.wheel(e.sender,input));
  ipcMain.on('star:syncPaste',(e,text)=>synchronizer.paste(e.sender,text));
  ipcMain.handle('star:syncActive',(e,id,guestId,size)=>synchronizer.setActive(e,id,guestId,size));
  ipcMain.handle('star:syncStatus',()=>synchronizer.status());
  ipcMain.handle('star:syncStart',(e,config)=>{managerOnly(e);return synchronizer.start(config);});
  ipcMain.handle('star:syncPause',(e,value)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile&&!([synchronizer.status().master,...synchronizer.status().followers].includes(w._profile.id)))throw new Error('此环境未参与同步');return synchronizer.pause(value);});
  ipcMain.handle('star:syncStop',()=>synchronizer.stop());
  ipcMain.handle('star:syncTile',e=>{managerOnly(e);return synchronizer.tile();});
  const diagnosticCatalog=require('../resources/diagnostics.json');
  ipcMain.handle('star:diagnosticCatalog',()=>diagnosticCatalog);
  ipcMain.handle('star:diagnosticOpen',async(e,id,checkId)=>{
    const caller=BrowserWindow.fromWebContents(e.sender);
    if(caller?._profile){if(caller._profile.id!==id||!e.senderFrame?.url.startsWith('file:'))throw new Error('只能检测当前环境');}
    else managerOnly(e);
    const selected=diagnosticCatalog.find(item=>item.id===checkId);
    if(!selected)throw new Error('检测项目不存在，请重新选择');
    const profile=store.get(id);if(!profile)throw new Error('环境不存在');
    if(profile.archived)throw new Error('请先恢复归档环境');
    require('./profile-backups').assertProfileUnlocked(id);
    let window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w._starClosing&&w._profile?.id===id);
    const chrome=getLaunchedBrowser(id);
    if(!window&&chrome&&!chrome.pipe.closed){
      const {targetId}=await chrome.pipe.send('Target.createTarget',{url:selected.url});
      await chrome.pipe.send('Target.activateTarget',{targetId});
      return {ok:true,engine:'chrome',name:selected.name};
    }
    if(!window){await commands('browse',[id]);window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w._starClosing&&w._profile?.id===id);}
    if(!window)throw new Error('浏览器尚未就绪，请重试');
    if(window._starBrowseReady)window.webContents.send('browse:newtab',selected.url);
    else window._init.diagnosticUrls=[...(window._init.diagnosticUrls||[]),selected.url];
    window.show();window.focus();return {ok:true,engine:'electron',name:selected.name};
  });
  ipcMain.handle('star:fingerprintPages',async(e,id)=>{managerOnly(e);const current=synchronizer.activeGuest(id);if(current)return {engine:'electron',pages:[]};const chrome=getLaunchedBrowser(id);if(chrome&&!chrome.pipe.closed)return {engine:'chrome',pages:await require('./fingerprint-audit').chromePages(chrome)};throw new Error('请先启动这个环境并打开网页');});
  ipcMain.handle('star:fingerprintAudit',async(e,id,targetId)=>{managerOnly(e);const current=synchronizer.activeGuest(id);if(current){if(targetId)throw new Error('浏览器已切换，请刷新后重新检查');return require('./fingerprint-audit').auditElectron(current.wc);}const chrome=getLaunchedBrowser(id);if(chrome&&!chrome.pipe.closed)return require('./fingerprint-audit').auditChrome(chrome,targetId);throw new Error('请先启动这个环境并打开网页');});
  const tasks=new (require('./automation-tasks').AutomationTasks)({app,store,commands,synchronizer});
  const taskTransfers=new (require('./task-transfer').TaskTransfers)(store),transferOwners=new Set();
  app.once('before-quit',()=>taskTransfers.dispose());
  ipcMain.handle('star:taskExport',async(e,ids)=>{managerOnly(e);const document=taskTransfers.document(ids),choice=await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender),{title:'导出任务定义',defaultPath:'Star-Browser-tasks-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'任务 JSON',extensions:['json']}]});if(choice.canceled)return {canceled:true};return taskTransfers.write(choice.filePath,document);});
  ipcMain.handle('star:taskImportPreview',async e=>{managerOnly(e);const choice=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'导入任务定义',filters:[{name:'任务 JSON',extensions:['json']}],properties:['openFile']});if(choice.canceled)return {canceled:true};const owner=e.sender.id;if(!transferOwners.has(owner)){transferOwners.add(owner);e.sender.once('destroyed',()=>{taskTransfers.cancelOwner(owner);transferOwners.delete(owner);});}const preview=await taskTransfers.preview(choice.filePaths[0],owner);if(e.sender.isDestroyed()){taskTransfers.cancel(preview.token,owner);throw new Error('工作台已关闭');}return preview;});
  ipcMain.handle('star:taskImportApply',(e,token)=>{managerOnly(e);return taskTransfers.apply(token,e.sender.id);});
  ipcMain.handle('star:taskImportCancel',(e,token)=>{managerOnly(e);return taskTransfers.cancel(token,e.sender.id);});
  ipcMain.handle('star:taskSave',(e,input)=>{managerOnly(e);return tasks.save(input);});
  ipcMain.handle('star:taskRemove',(e,id)=>{managerOnly(e);return tasks.remove(id);});
  ipcMain.handle('star:taskStart',(e,id,profiles)=>{managerOnly(e);return tasks.start(id,profiles);});
  ipcMain.handle('star:taskCancel',(e,id)=>{managerOnly(e);return tasks.cancel(id);});
  ipcMain.handle('star:taskOutput',(e,id,index)=>{managerOnly(e);shell.showItemInFolder(tasks.outputFile(id,index));return true;});
  ipcMain.handle('star:snapshot',(e,knownToken)=>{
    const running=runtime(),startup=launches(),token=JSON.stringify(startup)+":"+store.revision()+':'+JSON.stringify(running)+(synchronizer.session?':'+JSON.stringify(synchronizer.status()):'');
    if(knownToken===token)return {unchanged:true,token};
    return {token,tasks:store.tasks(),taskRuns:store.taskRuns(),synchronizer:synchronizer.status(),profiles:store.list(),extensions:extensions.list(),proxies:store.listProxies(),bookmarks:store.listBookmarks(),activity:store.activities(),downloads:store.downloads(),preferences:store.preferences(),runtime:running,startups:startup,engine:{electron:process.versions.electron,chromium:process.versions.chrome,chrome:findChrome(),version:app.getVersion(),platform:process.platform,arch:process.arch}};
  });
  const profileAction=async(e,action,ids=[],patch={})=>{
    if(!Array.isArray(ids)||ids.length>500)throw new Error('每次最多操作 500 个环境');
    const unique=[...new Set(ids)];
    for(const id of unique)require('./profile-backups').assertProfileUnlocked(id);
    if(!unique.every(id=>store.get(id)))throw new Error('部分环境已不存在，请刷新列表');
    if(['clone','update','archive','restore','regenerate'].includes(action)){
      if(['update','archive','restore','regenerate'].includes(action)&&unique.some(id=>(starting?.()||[]).includes(id)))throw new Error('环境正在启动，请等待窗口打开后再修改');
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
        const chromeClosing=()=>running&&running.child.exitCode===null&&running.child.signalCode===null;
        const deadline=Date.now()+5000;
        while(Date.now()<deadline&&(BrowserWindow.getAllWindows().some(w=>!w.isDestroyed()&&w._profile?.id===id)||chromeClosing()))await new Promise(resolve=>setTimeout(resolve,30));
        if(BrowserWindow.getAllWindows().some(w=>!w.isDestroyed()&&w._profile?.id===id)||chromeClosing())throw new Error('浏览器仍在关闭，请稍后重试');
      }else{
        const w=BrowserWindow.getAllWindows().find(w=>!w._starClosing&&w._profile?.id===id);
        if(w){if(w.isMinimized())w.restore();w.show();w.focus();}
        else {const r=getLaunchedBrowser(id);if(r&&!r.pipe.closed){const {targetInfos}=await r.pipe.send('Target.getTargets');const t=targetInfos.find(t=>t.type==='page');if(t)await r.pipe.send('Target.activateTarget',{targetId:t.targetId});}}
      }
    }
    if(action==='stop')store.transaction(()=>{for(const id of unique)store.activity('停止浏览器',store.get(id).name);});
    return {ok:true,results:[]};
  };
  ipcMain.handle('star:action',profileAction);
  const localApi=new (require('./local-api').LocalApi)(app.getPath('userData'),{store,runtime,version:app.getVersion(),commands:(name,args)=>name==='stop'?profileAction(null,'stop',[args[0]]):commands(name,args)});
  const managerOnly=e=>{const w=BrowserWindow.fromWebContents(e.sender);if(!w||w._profile||!e.senderFrame?.url.startsWith('file:'))throw new Error('此操作需要在工作台中执行');};
  const backups=new (require('./profile-backups').ProfileBackups)({app,session,store,extensions,runtime:()=>[...runtime(),...BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w._profile).map(w=>({id:w._profile.id})),...getLaunchedBrowsers().filter(([,browser])=>browser.child.exitCode===null&&browser.child.signalCode===null).map(([id])=>({id}))],starting});
  ipcMain.handle('star:backupStatus',e=>{managerOnly(e);return backups.status();});
  ipcMain.handle('star:backupExport',async(e,ids,password)=>{
    managerOnly(e);require('./encrypted-archive').checkPassword(password);
    const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender),{title:'保存加密环境备份',defaultPath:'Star-Browser-'+new Date().toISOString().slice(0,10)+'.starbackup',filters:[{name:'Star Browser 备份',extensions:['starbackup']}]});
    if(result.canceled)return {canceled:true};return backups.export(result.filePath,password,ids);
  });
  ipcMain.handle('star:backupPreview',async(e,password)=>{
    managerOnly(e);require('./encrypted-archive').checkPassword(password);
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'选择加密环境备份',properties:['openFile'],filters:[{name:'Star Browser 备份',extensions:['starbackup']}]});
    if(result.canceled)return {canceled:true};return backups.preview(result.filePaths[0],password,e.sender.id);
  });
  ipcMain.handle('star:backupRestore',async(e,token)=>{managerOnly(e);return backups.restore(token,e.sender.id);});
  ipcMain.handle('star:backupDiscard',async(e,token)=>{managerOnly(e);return backups.discard(token,e.sender.id);});
  ipcMain.handle('star:apiStatus',e=>{managerOnly(e);return localApi.status();});
  ipcMain.handle('star:apiConfigure',async(e,patch)=>{managerOnly(e);return localApi.configure(patch);});
  ipcMain.handle('star:apiCopyToken',async e=>{managerOnly(e);await clipboard.writeText(localApi.token());return true;});
  ipcMain.handle('star:apiRotateToken',e=>{managerOnly(e);return localApi.rotateToken();});
  ipcMain.handle('star:apiDocs',e=>{managerOnly(e);return fs.readFileSync(path.join(__dirname,'../resources/local-api.md'),'utf8');});
  if(localApi.config.enabled)localApi.start().catch(()=>{});
  app.on('before-quit',()=>{localApi.stop().catch(()=>{});});
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
  ipcMain.handle('star:proxySave',(e,input)=>store.transaction(()=>{const item=store.saveProxy(input);store.activity('保存代理',item.name);return item;}));
  ipcMain.handle('star:proxyRemove',(e,id)=>store.transaction(()=>{store.removeProxy(id);store.activity('删除代理配置');return {ok:true};}));
  ipcMain.handle('star:proxyImport',(e,text)=>{
    const proxies=require('./proxy-import-validation').validateProxyImport(text);
    return store.transaction(()=>{for(const proxy of proxies)store.saveProxy(proxy);store.activity('批量导入代理',`${proxies.length} 条代理`);return {ok:true,count:proxies.length};});
  });
  ipcMain.handle('star:proxyResult',(e,id,result)=>store.transaction(()=>{store.setProxyResult(id,result);return {ok:true};}));
  ipcMain.handle('star:preferences',(e,patch)=>{const next=store.preferences(patch);for(const w of BrowserWindow.getAllWindows())w.webContents.send('star:preferencesChanged',next);return next;});
  ipcMain.on('star:sessionNow',(e,id,tabs,index)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id===id)store.sessionTabs(id,tabs,index);});
  ipcMain.handle('star:historyRecord',(e,id,url,title)=>{const w=BrowserWindow.fromWebContents(e.sender);if(w?._profile?.id!==id)return false;return store.recordHistory(id,url,title);});
  const permitted=(e,id)=>{const w=BrowserWindow.fromWebContents(e.sender);return !!w&&(!w._profile||w._profile.id===id);};
  ipcMain.handle('star:historyList',(e,id)=>permitted(e,id)?store.history(id):[]);
  ipcMain.handle('star:historyTop',(e,id,n)=>permitted(e,id)?store.historyTop(id,n):[]);
  ipcMain.handle('star:historyClear',async(e,id)=>{if(!permitted(e,id))return false;const choice=await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender),{type:'question',title:'清除历史记录',message:'清除此环境保存的访问记录？',detail:'Cookie 和登录状态会保留。',buttons:['取消','清除记录'],defaultId:0,cancelId:0});if(choice.response!==1)return false;store.clearHistory(id);return true;});
  ipcMain.handle('star:openWorkbench',(e,page)=>{const manager=BrowserWindow.getAllWindows().find(w=>!w._profile&&!w.isDestroyed());if(!manager)return false;manager.show();manager.focus();manager.webContents.send('star:navigate',['environments','downloads','proxies','bookmarks'].includes(page)?page:'environments');return true;});
  ipcMain.handle('star:tabSuspend',async(e,guestId)=>{
    const {webContents}=require('electron'),wc=webContents.fromId(Number(guestId)),parent=BrowserWindow.fromWebContents(e.sender);
    if(!wc||wc.isDestroyed()||wc.getType()!=='webview'||wc.hostWebContents!==e.sender||parent?._profile?.id!==wc.session.__tfbEnvId)throw new Error('无法休眠此标签');
    const id=parent._profile.id;
    const check=()=>{
      if(wc.isDestroyed())throw new Error('标签已经关闭');
      require('./profile-backups').assertProfileUnlocked(id);
      const sync=synchronizer.status();if(sync.active&&[sync.master,...sync.followers].includes(id))throw new Error('请先停止窗口同步，再休眠标签');
      if(synchronizer.activeGuest(id)?.wc.id===wc.id)throw new Error('请先切换到其他标签，再休眠此页面');
      if(wc.isLoading()||!wc.__starDocumentReady)throw new Error('页面尚未就绪，请完成加载后再休眠');
      if(wc.isCurrentlyAudible())throw new Error('此页面正在播放声音，请暂停后再休眠');
      if(wc.__starPageEdited)throw new Error('页面有未提交输入，请保存或重新加载后再休眠');
      if(store.downloads().some(row=>row.profileId===id&&['progressing','paused'].includes(row.state)))throw new Error('此环境有未完成下载，请完成后再休眠标签');
    };
    check();
    const result=await wc.debugger.sendCommand('Runtime.evaluate',{expression:"(()=>{const fields=Array.from(document.querySelectorAll('input,textarea,select'));const dirty=fields.some(el=>el.tagName==='SELECT'?Array.from(el.options).some(option=>option.selected!==option.defaultSelected):['checkbox','radio'].includes(el.type)?el.checked!==el.defaultChecked:el.value!==el.defaultValue);const media=Array.from(document.querySelectorAll('audio,video')).some(el=>!el.paused&&!el.ended);return {dirty,media};})()",returnByValue:true,timeout:2000});
    if(result.exceptionDetails||!result.result?.value)throw new Error('无法确认页面状态，请稍后重试');
    if(result.result.value.dirty)throw new Error('页面有未提交输入，请保存或重新加载后再休眠');
    if(result.result.value.media)throw new Error('此页面正在播放媒体，请暂停后再休眠');
    // Embedded guest close does not reliably cancel after will-prevent-unload.
    // Inspect native listeners before closing, and leave pages requesting exit confirmation intact.
    const global=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'window',returnByValue:false,timeout:2000});
    if(!global.result?.objectId)throw new Error('无法确认页面离开状态，请稍后重试');
    try{const {listeners}=await wc.debugger.sendCommand('DOMDebugger.getEventListeners',{objectId:global.result.objectId});if(listeners.some(listener=>listener.type==='beforeunload'))throw new Error('页面设置了离开确认，请先保存工作');}
    finally{await wc.debugger.sendCommand('Runtime.releaseObject',{objectId:global.result.objectId}).catch(()=>{});}

    check();
    await new Promise((resolve,reject)=>{
      const finish=(error)=>{clearTimeout(timer);wc.removeListener('destroyed',closed);wc.removeListener('will-prevent-unload',blocked);error?reject(error):resolve();};
      const closed=()=>finish(),blocked=()=>finish(new Error('页面阻止离开，请先保存工作'));
      const timer=setTimeout(()=>finish(new Error('页面暂时无法休眠，请稍后重试')),3000);
      wc.once('destroyed',closed);wc.once('will-prevent-unload',blocked);
      try{wc.close({waitForBeforeUnload:true});}catch(error){finish(error);}
    });
    return {ok:true};
  });
  ipcMain.handle('star:guestReady',(e,id)=>{const wc=require('electron').webContents.fromId(Number(id));if(!wc||wc.isDestroyed()||wc.hostWebContents!==e.sender||!wc.__tfbFpInjected)return false;if(!wc.isLoading())wc.__starDocumentReady=true;return true;});
  ipcMain.on('star:pageEdited',(e,dirty)=>{if(e.sender.getType()==='webview')e.sender.__starPageEdited=!!dirty;});
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
  ipcMain.handle('star:copy',async(e,value)=>{await clipboard.writeText(String(value).slice(0,100000));return true;});
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
    require('./site-permissions').bindSitePermissions(ses,store,{dialog,BrowserWindow});
  }
  app.on('session-created',bindSession);bindSession(session.defaultSession);
}
module.exports={registerWorkbench};
