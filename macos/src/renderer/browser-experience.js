"use strict";
// Browser shell interaction layer. Guest pages have their own isolated session.
const StarBrowser = (() => {
  let preferences = {}, saveTimer = null, restoring = false, historyRows = [];
  const closedTabs = [], media = matchMedia('(prefers-color-scheme: dark)');
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
  const buttonIcons = {back:'ArrowLeft',forward:'ArrowRight',reload:'RotateCw',home:'House',bmBtn:'Bookmarks',starBtn:'Star',launchBtn:'LayoutGrid',batchBtn:'Network',gear:'Settings2',closeWin:'X',newTab:'Plus',historyBtn:'History',tabSearchBtn:'ChevronDown',browserMenuBtn:'EllipsisVertical',findPrev:'ChevronUp',findNext:'ChevronDown',findClose:'X',historyClose:'X',tabSearchClose:'X',fatalClose:'X'};
  function theme() {
    document.documentElement.dataset.theme = preferences.theme === 'dark' || (preferences.theme !== 'light' && media.matches) ? 'dark' : 'light';
    document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
  }
  media.addEventListener('change', theme);
  function init(payload) {
    preferences = payload.preferences || {}; theme();
    for (const [id,name] of Object.entries(buttonIcons)) { const el=document.getElementById(id); if(el){el.innerHTML=icon(name);el.setAttribute('aria-label',el.title||el.textContent||id);} }
    $('badge').textContent = payload.name || '浏览环境';
    $('badge').title = `环境 ${payload.id}`;
    $('connectionIdentity').textContent = payload.proxy?.host ? `${payload.proxy.host}:${payload.proxy.port}` : '本机网络';
    $('connectionIdentity').title = payload.proxy?.host ? '此环境使用已配置代理' : '此环境使用本机网络';
    $('ntpEnvironment').textContent = payload.name || '你的独立浏览空间';
    $('ntpRegion').textContent = `${payload.fingerprint?.language || ''} · ${payload.fingerprint?.timezone || ''}`;
  }
  function snapshot() {
    return tabs.map(t=>({url:t.ntp?'about:home':safeUrl(t),title:t.title||'新标签',pinned:!!t.pinned,muted:!!t.muted,sleeping:!!t.sleeping}));
  }
  function safeUrl(t) {if(t.web?.__starPendingURL)return t.web.__starPendingURL;try{const url=t.web.getURL();return url&&url!=='about:blank'?url:t.url||'about:home';}catch{return t.url||'about:home';}}
  function persist(immediate=false) {
    if(!profile || restoring) return;
    clearTimeout(saveTimer);
    const save=()=>{saveTimer=null;window.api.saveSession(profile.id,snapshot(),Math.max(0,tabs.findIndex(t=>t.id===activeId))).catch(()=>{});};
    if(immediate)save();else saveTimer=setTimeout(save,300);
  }
  function beginRestore(){restoring=true;}
  function endRestore(){restoring=false;persist();}
  function tabClosed(tab) {closedTabs.push({url:tab.ntp?'about:home':safeUrl(tab),ntp:tab.ntp,pinned:!!tab.pinned,muted:!!tab.muted,title:tab.title});if(closedTabs.length>30)closedTabs.shift();}
  function restoreClosed() {const item=closedTabs.pop();if(item)createTab(item.url,item);else toast('没有最近关闭的标签页');}
  function normalize(value) {
    const q=String(value||'').trim(); if(!q)return 'about:home';
    if(q==='about:blank'||q==='about:home')return q;
    if(/^https?:\/\//i.test(q))return q;
    if(/^[a-z][a-z\d+.-]*:/i.test(q)&&!/^localhost:\d/i.test(q)&&!/^\d+(?:\.\d+){3}:\d/.test(q))throw new Error('地址支持 HTTP 或 HTTPS 网站');
    if(/^(localhost|\[[a-f\d:]+\]|[a-z\d-]+(?:\.[a-z\d-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(q)&&! /\s/.test(q))return (/^(localhost|127\.)/.test(q)?'http://':'https://')+q;
    return ({bing:'https://www.bing.com/search?q=',duckduckgo:'https://duckduckgo.com/?q='}[preferences.searchEngine]||'https://www.google.com/search?q=')+encodeURIComponent(q);
  }
  function navigate(value) {try{const url=normalize(value);if(url==='about:home'){showNtp();persist();}else go(url);}catch(error){toast(error.message);}}
  async function settled(tabId,w) {
    const t=tabs.find(t=>t.id===tabId);if(!t)return;
    if(w.__starPendingURL||(!w.__starReady&&profile?.fingerprint))return;
    let url='';try{url=w.getURL();if(url==='about:blank'&&!t.ntp&&/^https?:/.test(t.url))return;t.url=url;}catch{}
    persist();
    if(!/^https?:\/\//i.test(url))return;
    if(t.historyUrl===url&&Date.now()-(t.historyAt||0)<2000)return;
    t.historyUrl=url;t.historyAt=Date.now();
    try{await window.api.historyRecord(profile.id,url,t.title);}catch{}
  }
  function guest(w,tabId) {
    w.addEventListener("dom-ready",()=>{if(activeId===tabId)syncActive();});
    w.addEventListener('found-in-page',event=>{if(activeId===tabId)$('findResult').textContent=event.result.matches?`${event.result.activeMatchOrdinal} / ${event.result.matches}`:'没有匹配';});
  }
  function find(forward=true,next=false) {const t=activeTab(),q=$('findInput').value;if(!t||t.ntp||!q){$('findResult').textContent='';return;}try{t.web.findInPage(q,next?{forward,findNext:true}:{forward});}catch{}}
  function closeFind() { const wasOpen=!$('findBar').hidden;$('findBar').hidden=true;try{activeTab()?.web.stopFindInPage('clearSelection');if(wasOpen)activeTab()?.web.focus();}catch{} }
  function openFind() {$('findBar').hidden=false;$('findInput').focus();$('findInput').select();}
  function zoom(direction) {const t=activeTab();if(!t)return;try{const current=t.web.getZoomFactor();const factor=direction===0?1:Math.max(.25,Math.min(3,Math.round((current+direction*.1)*100)/100));t.web.setZoomFactor(factor);$('zoomValue').textContent=`${Math.round(factor*100)}%`;}catch{}}
  function syncActive() {try{const t=activeTab();if(profile&&t){const bounds=t.web.getBoundingClientRect();window.api.syncActive(profile.id,t.web.getWebContentsId(),{width:bounds.width,height:bounds.height}).catch(()=>{});}}catch{}}
  function tabChanged() {syncActive();closeFind();persist();try{$('zoomValue').textContent=`${Math.round(activeTab().web.getZoomFactor()*100)}%`;}catch{}}
  function togglePanel(id) {const el=$(id),opening=el.hidden;for(const other of ['historyPanel','tabSearchPanel','browserMenu'])$(other).hidden=true;el.hidden=!opening;if(opening&&id==='historyPanel')loadHistory();if(opening&&id==='tabSearchPanel'){renderTabSearch();$('tabSearchInput').focus();}}
  async function loadHistory() {try{historyRows=await window.api.historyList(profile.id);renderHistory();}catch(error){$('historyList').textContent=error.message;}}
  function renderHistory() {
    const q=$('historySearch').value.trim().toLowerCase(),box=$('historyList');box.replaceChildren();
    const rows=historyRows.filter(r=>(r.title+' '+r.url).toLowerCase().includes(q)).slice(0,200);
    if(!rows.length){box.textContent=q?'没有匹配的访问记录':'访问过的网站会保存在这里。';return;}
    for(const row of rows){const b=document.createElement('button');b.className='history-item';const title=document.createElement('strong'),url=document.createElement('span'),time=document.createElement('time');title.textContent=row.title||new URL(row.url).host;url.textContent=row.url;time.textContent=new Date(row.time).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});b.append(title,url,time);b.addEventListener('click',()=>{createTab(row.url);$('historyPanel').hidden=true;});box.append(b);}
  }
  function renderTabSearch() {
    const q=$('tabSearchInput').value.trim().toLowerCase(),box=$('tabSearchList');box.replaceChildren();
    for(const t of tabs.filter(t=>(t.title+' '+t.url).toLowerCase().includes(q))){const b=document.createElement('button');b.className='tab-search-item'+(t.id===activeId?' current':'');b.textContent=t.title||'新标签';b.title=t.url;b.addEventListener('click',()=>{activateTab(t.id);$('tabSearchPanel').hidden=true;});box.append(b);}
    if(!box.children.length)box.textContent='没有找到标签页';
  }
  function command(name) {
    if(name==='find')openFind();else if(name==='address'){addr.focus();addr.select();}
    else if(name==='restore-tab')restoreClosed();else if(name==='history')togglePanel('historyPanel');
    else if(name==='zoom-in')zoom(1);else if(name==='zoom-out')zoom(-1);else if(name==='zoom-reset')zoom(0);
    else if(name==='reload'){try{activeTab()?.web.reload();}catch{}}
    else if(name==='force-reload'){try{activeTab()?.web.reloadIgnoringCache();}catch{}}
    else if(name==='next-tab'||name==='previous-tab'){const index=tabs.findIndex(t=>t.id===activeId);activateTab(tabs[(index+(name==='next-tab'?1:-1)+tabs.length)%tabs.length].id);}
  }
  function setup() {
    StarTabs.setup();
    $('historyBtn').onclick=()=>togglePanel('historyPanel');$('historyClose').onclick=()=>$('historyPanel').hidden=true;
    $('historySearch').oninput=renderHistory;$('historyClear').onclick=async()=>{try{if(await window.api.historyClear(profile.id))loadHistory();}catch(error){toast(error.message);}};
    $('tabSearchBtn').onclick=()=>togglePanel('tabSearchPanel');$('tabSearchClose').onclick=()=>$('tabSearchPanel').hidden=true;$('tabSearchInput').oninput=renderTabSearch;
    $('browserMenuBtn').onclick=()=>togglePanel('browserMenu');
    $('browserMenu').addEventListener('click',e=>{const b=e.target.closest('[data-command]');if(b){command(b.dataset.command);if(!b.dataset.command.startsWith('zoom'))$('browserMenu').hidden=true;}});
    $('openDownloads').onclick=()=>window.api.openWorkbench('downloads');$('openWorkspace').onclick=()=>window.api.openWorkbench('environments');
    $('themeToggle').onclick=async()=>{preferences.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';theme();await window.api.preferences({theme:preferences.theme});};
    $('findInput').oninput=()=>find();$('findInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();find(!e.shiftKey,true);}else if(e.key==='Escape')closeFind();};
    $('findPrev').onclick=()=>find(false,true);$('findNext').onclick=()=>find(true,true);$('findClose').onclick=closeFind;
    $('fatalRetry').onclick=()=>{hideFatal();const t=activeTab();if(t?.web&&!t.web.__starReady){setupGuestInjection(t.web,t.id);}else try{t?.web.reload();}catch{}};$('fatalClose').onclick=hideFatal;
    document.addEventListener('keydown',e=>{const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase();if(mod&&['f','l','y','+','=','-','0'].includes(k)){e.preventDefault();command({f:'find',l:'address',y:'history','+':'zoom-in','=':'zoom-in','-':'zoom-out','0':'zoom-reset'}[k]);}if(e.key==='Escape'){closeFind();for(const id of ['historyPanel','tabSearchPanel','browserMenu'])$(id).hidden=true;}if((e.metaKey||e.ctrlKey)&&e.key==='Tab'){e.preventDefault();command(e.shiftKey?'previous-tab':'next-tab');}if((e.metaKey||e.ctrlKey)&&/^[1-9]$/.test(e.key)){e.preventDefault();const t=e.key==='9'?tabs.at(-1):tabs[Number(e.key)-1];if(t)activateTab(t.id);}});
    document.addEventListener('pointerdown',e=>{for(const [id,trigger] of [['browserMenu','browserMenuBtn'],['tabSearchPanel','tabSearchBtn'],['historyPanel','historyBtn']])if(!$(id).hidden&&!$(id).contains(e.target)&&!$(trigger).contains(e.target))$(id).hidden=true;});
    window.addEventListener('beforeunload',()=>{if(profile)window.api.saveSessionNow(profile.id,snapshot(),tabs.findIndex(t=>t.id===activeId));});
    const syncBanner=document.createElement('div');syncBanner.className='browser-sync-banner';syncBanner.hidden=true;syncBanner.setAttribute('role','status');document.getElementById('toolbar').insertAdjacentElement('afterend',syncBanner);
    const syncState=status=>{const included=profile&&[status.master,...status.followers].includes(profile.id);syncBanner.hidden=!status.active||!included;if(!included)return;syncBanner.replaceChildren();const label=document.createElement('span');label.textContent=status.paused?'窗口同步已暂停':status.master===profile.id?'主控窗口 · 操作将同步到 '+status.followers.length+' 个环境':'跟随窗口 · 接收主控页面操作';syncBanner.append(label);const pause=document.createElement('button');pause.textContent=status.paused?'继续':'暂停';pause.onclick=()=>window.api.syncPause(!status.paused);const stop=document.createElement('button');stop.textContent='停止同步';stop.onclick=()=>window.api.syncStop();syncBanner.append(pause,stop);syncActive();};
    window.api.onSyncState(syncState);window.api.syncStatus().then(syncState);window.api.onSyncNavigate(url=>{if(/^https?:\/\//i.test(url))go(url);});
    new ResizeObserver(()=>syncActive()).observe(document.getElementById('wrap'));
    window.api.onBrowserCommand(command);window.api.onPreferences(next=>{preferences=next;theme();});
  }
  return {init,persist,beginRestore,endRestore,tabClosed,restoreClosed,navigate,settled,guest,tabChanged,command,setup,icon};
})();
