"use strict";
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("api", {
  list: () => ipcRenderer.invoke("profiles:list"),
  create: (partial) => ipcRenderer.invoke("profiles:create", partial),
  update: (id, patch) => ipcRenderer.invoke("profiles:update", id, patch),
  remove: (id) => ipcRenderer.invoke("profiles:remove", id),
  preview: (id) => ipcRenderer.invoke("profiles:preview", id),
  launch: (id) => ipcRenderer.invoke("profiles:launch", id),
  browse: (id) => ipcRenderer.invoke("profiles:browse", id),
  chrome: () => ipcRenderer.invoke("env:chrome"),
  // Lite 单环境 / Pro 应用内打开：设置持久化（国家、代理、重新生成指纹等）
  browseSave: (patch) => ipcRenderer.invoke("browse:saveProfile", patch),
  // 应用内浏览器（webview）控制
  ready: () => ipcRenderer.send("browse:ready"),
  onInit: (cb) => subscribe("browse:init", cb),
  close: () => ipcRenderer.send("browse:close"),
  onMenuNew: (cb) => subscribe("menu:new", cb),
  onMenuNewTab: (cb) => subscribe("menu:new-tab", cb),
  onMenuCloseTab: (cb) => subscribe("menu:close-tab", cb),
  // 为 webview guest 设置代理（Electron 31 移除了 webview.getWebContents，改由主进程设置）
  setGuestProxy: (id, proxy, lang) =>
    ipcRenderer.invoke("guest:setProxy", id, proxy, lang),
  // 指纹注入（CDP 主世界同步）：把指纹配置下发主进程，由其用 Page.addScriptToEvaluateOnNewDocument 注入
  injectFingerprint: (id, fingerprint) =>
    ipcRenderer.invoke("guest:injectFingerprint", id, fingerprint),
  guestReady: (guestId) => ipcRenderer.invoke("star:guestReady", guestId),
  suspendTab: (guestId) => ipcRenderer.invoke("star:tabSuspend", guestId),
  // 为主进程 setWindowOpenHandler 暴露入口：拦截弹窗，把 URL 发回渲染端开新标签
  setGuestPopHandler: (id) => ipcRenderer.invoke("guest:setPopHandler", id),
  // 清除指定 guest webview 的 Cookie/缓存（主进程经会话 session 清除，避开渲染端 webview 的 dom-ready 守卫）
  clearGuestStorage: (id) => ipcRenderer.invoke("guest:clearStorage", id),
  // 快捷启动台在线配置（主进程抓取远端 JSON，避免 file:// 页面 fetch 的 CORS 限制）
  launcherConfig: () => ipcRenderer.invoke("launcher:config"),
  // 收藏夹（全局共享）：列表 / 新增 / 删除 / 改名
  bookmarksList: () => ipcRenderer.invoke("bookmarks:list"),
  bookmarksAdd: (bm) => ipcRenderer.invoke("bookmarks:add", bm),
  bookmarksRemove: (id) => ipcRenderer.invoke("bookmarks:remove", id),
  bookmarksUpdate: (id, patch) =>
    ipcRenderer.invoke("bookmarks:update", id, patch),
  // 云端托管收藏合并（以 id 为键，不覆盖用户自加）
  bookmarksMergeCloud: (list) =>
    ipcRenderer.invoke("bookmarks:mergeCloud", list),
  // 最常访问（New Tab 快捷入口）：记录访问 / 取 Top-N
  visitsRecord: (url, title) => ipcRenderer.invoke("visits:record", url, title),
  visitsTop: (n) => ipcRenderer.invoke("visits:top", n),
  // 接收主进程转发的「需要在新标签打开的 URL」
  onNewTab: (cb) => subscribe("browse:newtab", cb),
  // 每环境 Cookie 备份/恢复（按环境分区持久化）
  cookieExport: (envId) => ipcRenderer.invoke("cookies:export", envId),
  cookieImport: (envId) => ipcRenderer.invoke("cookies:import", envId),
  cookieCount: (envId) => ipcRenderer.invoke("cookies:count", envId),
  cookieClear: (envId) => ipcRenderer.invoke("cookies:clear", envId),
  // 代理出口 IP 自检（主进程用独立 session 走该环境代理请求检测服务）
  proxyCheck: (proxy) => ipcRenderer.invoke("proxy:check", proxy),
  // 批量代理检测：传入代理文本数组，逐条返回连通性/延迟/出口IP/所在地/时区/IP类型/风控
  proxyBatchCheck: (list) => ipcRenderer.invoke("proxy:batchCheck", list),
  // 根据代理出口 IP 自动对齐指纹时区/语言，返回新 payload（overrideLang=false 时仅同步时区）
  syncGeo: (opts) => ipcRenderer.invoke("browse:syncGeo", opts),
  // 主进程后台对齐完成后回推已对齐指纹（不阻塞窗口打开），渲染端据此重建注入
  onAlign: (cb) => subscribe("browse:align", cb),
  // 接收主进程推送的轻量提示（如代理不可达），渲染端以 toast 展示
  onToast: (cb) => subscribe("tfb:toast", cb),
  // 当前构建版本号（客户端用于辨认是否为最新包）
  version: () => "star-2026-10-12",
  snapshot: (token) => ipcRenderer.invoke("star:snapshot", token),
  action: (action, ids, patch) => ipcRenderer.invoke("star:action", action, ids, patch),
  exportProfiles: ids => ipcRenderer.invoke("star:export", ids),
  importPreview: () => ipcRenderer.invoke("star:importPreview"),
  importApply: token => ipcRenderer.invoke("star:importApply", token),
  fingerprintPages: id => ipcRenderer.invoke('star:fingerprintPages',id),
  fingerprintAudit: (id,targetId) => ipcRenderer.invoke('star:fingerprintAudit',id,targetId),
  taskSave: input => ipcRenderer.invoke("star:taskSave",input),
  taskRemove: id => ipcRenderer.invoke("star:taskRemove",id),
  taskStart: (id,profiles) => ipcRenderer.invoke("star:taskStart",id,profiles),
  taskCancel: id => ipcRenderer.invoke("star:taskCancel",id),
  taskOutput: (id,index) => ipcRenderer.invoke("star:taskOutput",id,index),
  syncActive: (id,guestId,size) => ipcRenderer.invoke("star:syncActive",id,guestId,size),
  syncStatus: () => ipcRenderer.invoke("star:syncStatus"),
  syncStart: config => ipcRenderer.invoke("star:syncStart",config),
  syncPause: value => ipcRenderer.invoke("star:syncPause",value),
  syncStop: () => ipcRenderer.invoke("star:syncStop"),
  syncTile: () => ipcRenderer.invoke("star:syncTile"),
  onSyncState: cb => subscribe("star:syncState",cb),
  onSyncNavigate: cb => subscribe("star:syncNavigate",cb),
  backupStatus: () => ipcRenderer.invoke("star:backupStatus"),
  backupExport: (ids,password) => ipcRenderer.invoke("star:backupExport",ids,password),
  backupPreview: password => ipcRenderer.invoke("star:backupPreview",password),
  backupRestore: token => ipcRenderer.invoke("star:backupRestore",token),
  backupDiscard: token => ipcRenderer.invoke("star:backupDiscard",token),
  localApiStatus: () => ipcRenderer.invoke("star:apiStatus"),
  localApiConfigure: patch => ipcRenderer.invoke("star:apiConfigure",patch),
  localApiCopyToken: () => ipcRenderer.invoke("star:apiCopyToken"),
  localApiRotateToken: () => ipcRenderer.invoke("star:apiRotateToken"),
  localApiDocs: () => ipcRenderer.invoke("star:apiDocs"),
  extensionPreview: () => ipcRenderer.invoke("star:extensionPreview"),
  extensionApply: token => ipcRenderer.invoke("star:extensionApply",token),
  extensionRemove: id => ipcRenderer.invoke("star:extensionRemove",id),
  proxySave: input => ipcRenderer.invoke("star:proxySave", input),
  proxyRemove: id => ipcRenderer.invoke("star:proxyRemove", id),
  proxyImport: text => ipcRenderer.invoke("star:proxyImport", text),
  proxyResult: (id, result) => ipcRenderer.invoke("star:proxyResult", id, result),
  preferences: patch => ipcRenderer.invoke("star:preferences", patch),
  onBrowserCommand: cb => subscribe("star:browserCommand", cb),
  onPreferences: cb => subscribe("star:preferencesChanged", cb),
  onNavigate: cb => subscribe("star:navigate", cb),
  onWorkspaceChanged: cb => subscribe("star:invalidate", cb),
  openWorkbench: page => ipcRenderer.invoke("star:openWorkbench", page),
  historyRecord: (id,url,title) => ipcRenderer.invoke("star:historyRecord",id,url,title),
  historyList: id => ipcRenderer.invoke("star:historyList",id),
  historyTop: (id,n) => ipcRenderer.invoke("star:historyTop",id,n),
  historyClear: id => ipcRenderer.invoke("star:historyClear",id),
  saveSessionNow: (id,tabs,active) => ipcRenderer.send("star:sessionNow",id,tabs,active),
  saveSession: (id, tabs, active) => ipcRenderer.invoke("star:session", id, tabs, active),
  downloadAction: (id, action) => ipcRenderer.invoke("star:download", id, action),
  copy: value => ipcRenderer.invoke("star:copy", value),
  // 开机自启开关（设置面板）：安装包勾选后首次启动自动应用
  getAutoStart: () => ipcRenderer.invoke("app:getAutoStart"),
  setAutoStart: (on) => ipcRenderer.invoke("app:setAutoStart", on),
  // 匿名使用统计开关（设置面板）：默认开启，仅随机 ID + 版本/平台，无任何 PII
  getTelemetry: () => ipcRenderer.invoke("app:getTelemetry"),
  setTelemetry: (on) => ipcRenderer.invoke("app:setTelemetry", on),
  // 打开外部链接（广告位：客服/进群/购买IP）
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  // 诊断日志转发
  dbgLog: (msg) => ipcRenderer.send("dbg:log", String(msg)),
});
