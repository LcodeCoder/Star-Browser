"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
  session,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { Store } = require("./store");
const { launchProfile, findChrome, getLaunchedBrowser } = require("./launcher");
const {
  generateFingerprint,
  resolveGeo,
  offsetToTz,
  TIMEZONES,
  LOCALES,
} = require("./fingerprint");
const crypto = require("crypto");

// 开发与自动化测试可使用独立数据目录；正式运行沿用 Electron 的 macOS userData。
if (process.env.TFB_USER_DATA_DIR) {
  const userDataDir = path.resolve(process.env.TFB_USER_DATA_DIR);
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath("userData", userDataDir);
}
const TEST_MODE = process.env.TFB_TEST_MODE === "1";
app.setName("Star Browser");

function bindProxyRequestAuthentication(request, ses) {
  let attempted = false;
  request.on("login", (authInfo, callback) => {
    const credentials = ses && ses.__tfbProxyCreds;
    if (attempted || !authInfo.isProxy || !credentials ||
        credentials.host !== authInfo.host || credentials.port !== authInfo.port) {
      callback();
      return;
    }
    attempted = true;
    callback(credentials.user, credentials.pass);
  });
  return request;
}


let win; // 控制台（管理）窗口
let liteWin; // 历史 Lite 单开窗口（仅在 Lite 模式下使用）
let store;
const profileCommands=new Map(),startupJobs=new Map();
function registerProfileCommand(name,handler){
  const run=(event,...args)=>{
    if(["browse","launch","update","remove"].includes(name))require("./profile-backups").assertProfileUnlocked(args[0]);
    if(!["browse","launch"].includes(name))return handler(event,...args);
    const key=name+":"+args[0];if(startupJobs.has(key))return startupJobs.get(key);
    const job=Promise.resolve().then(()=>handler(event,...args));startupJobs.set(key,job);
    return job.finally(()=>startupJobs.delete(key));
  };
  profileCommands.set(name,run);ipcMain.handle("profiles:"+name,run);
}
let MODE; // 'lite' | 'pro' | 'changyi'，由打包时注入的 tfbMode 决定（无竞态，无需共享文件）

// 指纹核心源码（一次性读取）
const { applyProtocol, metadata: fingerprintMetadata } = require("./fingerprint-protocol");
const FP_CORE_SRC = fs.readFileSync(
  path.join(__dirname, "../extension/fp-core.js"),
  "utf-8",
);

  function bindLangHeader(wc, lang) {
    try {
      if (!wc || wc.isDestroyed()) return;
      const ses = wc.session;
      if (!ses) return;
      if (lang) ses.__tfbLang = String(lang);
      if (ses.__tfbHeaderBound) return;
      ses.__tfbHeaderBound = true;
      // 先捕获 session 引用：webContents 销毁后访问 wc.session getter 会抛
      // "Object has been destroyed"（main.js:431 崩溃根因），回调内只用 _sess 即可避开。
      const _sess = ses;
      _sess.webRequest.onBeforeSendHeaders((details, callback) => {
        try {
          const L = _sess.__tfbLang || "en-US";
          const hdrs = details.requestHeaders || {};
          hdrs["Accept-Language"] = L + "," + L.split("-")[0] + ";q=0.9";
          const fp=_sess.__tfbFp;
          if(fp){const meta=fingerprintMetadata(fp);hdrs["User-Agent"]=fp.userAgent;for(const key of Object.keys(hdrs)){const lower=key.toLowerCase();if(lower==='sec-ch-ua')hdrs[key]=meta.brands.map(b=>`"${b.brand}";v="${b.version}"`).join(', ');if(lower==='sec-ch-ua-platform')hdrs[key]=JSON.stringify(meta.platform);if(lower==='sec-ch-ua-mobile')hdrs[key]=meta.mobile?'?1':'?0';}}

          callback({ requestHeaders: hdrs });
        } catch (_) {
          try {
            callback({ requestHeaders: details.requestHeaders || {} });
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

// Prepare each guest once, after its initial local document has a renderer.
// Navigation waits for this promise so the first remote script uses native CDP settings.
function prepareGuestFingerprint(wc, fingerprint) {
  if (wc.__tfbFpInjected) return Promise.resolve(true);
  if (wc.__starFingerprintPreparing) return wc.__starFingerprintPreparing;
  const source=FP_CORE_SRC+"\n;try{if(window.installFingerprint)window.installFingerprint("+JSON.stringify(fingerprint)+");}catch(e){}";
  const job=(async()=>{
    const api=wc.debugger;if(!api.isAttached())api.attach("1.3");
    const send=(method,params)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("浏览器配置超时："+method)),5000);
      api.sendCommand(method,params).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
    await send("Page.enable",{});
    await applyProtocol(send,fingerprint);
    await require("./fingerprint-targets").bindElectronTargets(wc,fingerprint,source);
    await send("Page.addScriptToEvaluateOnNewDocument",{source});
    wc.__tfbFingerprint=fingerprint;wc.__tfbFpInjected=true;
    bindLangHeader(wc,fingerprint.language);
    dbg("GUEST-FP-READY id="+wc.id+" tz="+fingerprint.timezone+" lang="+fingerprint.language);
    return true;
  })();
  wc.__starFingerprintPreparing=job;
  job.finally(()=>{if(wc.__starFingerprintPreparing===job)delete wc.__starFingerprintPreparing;}).catch(()=>{});
  return job;
}

// 离线本地起始页（保证一打开就有内容，不会白屏；被墙站点 whoer/google 不再作为默认页）
// 关键：用 data: URL 加载主页，避免打包后 webview(persist 分区) 加载 asar 内 file:// 可能失败导致白屏
const HOME_HTML = fs.readFileSync(
  path.join(__dirname, "../renderer/home.html"),
  "utf-8",
);
const HOME_URL =
  "data:text/html;charset=utf-8," + encodeURIComponent(HOME_HTML);
// 快捷启动台「在线配置」地址：把 JSON 放到你自己的服务器上，即可随时增删站点/广告而无需重新发版。
// 读取失败（离线或地址不可用）时自动回落应用内置默认配置。
// ⚠️ 必须用 www 完整域名：裸域 chuhailiqi.com 会 301 跳 www，
// 而 Electron 的 net.request 默认【不自动跟随】重定向，会导致拉取配置静默失败。
const LAUNCHER_CONFIG_URL = "https://www.chuhailiqi.com/cy/launcher.json";
// 构建版本标记（UI 可见，便于确认用户跑的是不是最新包）
const BUILD_TAG = "star-2026-10-12";
// 诊断日志：写到 userData/tfb-debug.log，供排查"打不开网页"用
function dbg(msg) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "tfb-debug.log"),
      "[" + new Date().toISOString() + "] " + msg + "\n",
      "utf-8",
    );
  } catch (e) {}
}
// 关闭主进程未捕获异常的「原生错误弹窗」：仅写日志，不让 Electron 弹出中断用户的对话框
process.on("uncaughtException", (e) => {
  try {
    dbg("UNCAUGHT " + ((e && e.stack) || e));
  } catch (_) {}
});
process.on("unhandledRejection", (r) => {
  try {
    dbg("UNHANDLED " + (r && (r.stack || r)));
  } catch (_) {}
});

// ---------------- 匿名使用统计（telemetry） ----------------
// 仅收集：随机 install_id（无 PII）+ 版本/平台/架构/语言 + 事件(download/install/open/daily)。
// fire-and-forget：任何异常或网络失败都静默忽略，绝不阻塞主流程。
// 路径延迟到函数内求值（app.getPath 需 app ready 后才能调用）。
// 同 LAUNCHER_CONFIG_URL：必须用 www，避免 301 导致上报被 net.request 丢弃。
const STATS_URL = "https://www.chuhailiqi.com/cy/api";
function ud() {
  try {
    return app.getPath("userData");
  } catch (_) {
    return require("os").tmpdir();
  }
}
function getInstallId() {
  const f = path.join(ud(), "tfb-install.json");
  try {
    if (fs.existsSync(f)) {
      const d = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (d && d.id) return d.id;
    }
  } catch (e) {}
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  try {
    fs.writeFileSync(f, JSON.stringify({ id }), "utf-8");
  } catch (e) {}
  return id;
}
function loadTelemetry() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(ud(), "tfb-telemetry.json"), "utf-8"),
    );
  } catch (e) {
    return {};
  }
}
function saveTelemetry(on) {
  try {
    fs.writeFileSync(
      path.join(ud(), "tfb-telemetry.json"),
      JSON.stringify({ telemetry: !!on }),
      "utf-8",
    );
  } catch (e) {}
}
function telemetryEnabled() {
  if (TEST_MODE || process.env.TFB_DISABLE_TELEMETRY === "1") return false;
  const t = loadTelemetry();
  return false;
} // 默认开启
function sendStats(event, payload) {
  if (!telemetryEnabled()) return;
  if (!event) return;
  try {
    const body = JSON.stringify(
      Object.assign(
        {
          event,
          install_id: getInstallId(),
          version: BUILD_TAG,
          platform: process.platform,
          arch: process.arch,
          locale: app.getLocale ? app.getLocale() : "",
          ts: Date.now(),
        },
        payload || {},
      ),
    );
    const req = net.request({
      method: "POST",
      url: STATS_URL + "/stats",
      headers: { "Content-Type": "application/json" },
    });
    req.on("error", () => {});
    // 双保险：万一将来域名调整出现 30x，net.request 默认不跟随，这里手动跟随一次
    req.on("redirect", (status, method, url) => {
      try {
        if (status === 307 || status === 308) {
          req.setHeader("Content-Type", "application/json");
          req.write(body);
        }
        req.followRedirect();
      } catch (_) {}
    });
    req.write(body);
    req.end();
  } catch (e) {}
}
function trackLaunch() {
  try {
    sendStats("open", {});
    const installedFlag = path.join(ud(), "tfb-installed.flag");
    if (!fs.existsSync(installedFlag)) {
      try {
        fs.writeFileSync(installedFlag, String(Date.now()), "utf-8");
      } catch (e) {}
      sendStats("install", {}); // 首次运行 = 安装后首次打开
    }
    // 每日使用：累计每日启动次数，跨自然日上报昨日的 daily
    const usageFile = path.join(ud(), "tfb-usage.json");
    const today = new Date().toISOString().slice(0, 10);
    let usage = {};
    try {
      usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"));
    } catch (e) {}
    usage[today] = (usage[today] || 0) + 1;
    const lastDay = usage.lastDay || "";
    usage.lastDay = today;
    try {
      fs.writeFileSync(usageFile, JSON.stringify(usage), "utf-8");
    } catch (e) {}
    if (lastDay && lastDay !== today)
      sendStats("daily", { day: lastDay, launches: usage[lastDay] || 0 });
  } catch (e) {}
}
// 解析默认起始页：被墙/旧默认/占位符 => 离线主页；用户自定义可访问站点保持不变
function resolveStartUrl(u) {
  if (
    !u ||
    u === "about:home"
  )
    return HOME_URL;
  return u;
}

// 为每个环境生成独立的 webview 预加载文件：把 fp-core 源码(FP_SRC) 与该环境指纹配置(CFG) 内联，
// 在 document_start 直接注入 MAIN world。CFG 定义为变量，注入脚本引用它，避免引号/字面量冲突。
function writeWebviewPreload(profile, fingerprint) {
  const dir = path.join(app.getPath("userData"), "webview-preloads");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, (profile.id || "lite") + ".js");
  // ⚠️ 关键修复：fp-core 源码必须作为「代码」注入主世界执行。
  // 旧实现把 FP_SRC 用 JSON.stringify 包成字符串字面量，再 webFrame.executeJavaScript(FP_SRC+'...')，
  // 结果 executeJavaScript 收到的整段被当成「字符串字面量」而非「源码」——installFingerprint 永远不被定义，
  // 整套指纹伪装（时区/语言/UA/canvas…）从未真正注入，浏览器一直跑真实宿主机（中文/东八区）。
  // 正确做法：把「源码 + 调用」拼成一个完整代码字符串，整体 JSON.stringify 成单一参数传给 executeJavaScript。
  const call =
    "\n;try{ if(window.installFingerprint) window.installFingerprint(" +
    JSON.stringify(fingerprint) +
    "); }catch(e){}";
  const code = FP_CORE_SRC + call;
  const content = [
    "'use strict';",
    "const CFG = " + JSON.stringify(fingerprint) + ";",
    "const { webFrame, ipcRenderer } = require('electron');",
    "document.addEventListener('input',event=>{if(event.isTrusted)ipcRenderer.send('star:pageEdited',true);},true);",
    "document.addEventListener('submit',event=>setTimeout(()=>{if(!event.defaultPrevented)ipcRenderer.send('star:pageEdited',false);},0),true);",
    "document.addEventListener('reset',event=>setTimeout(()=>{if(!event.defaultPrevented)ipcRenderer.send('star:pageEdited',false);},0),true);",
    "document.addEventListener('paste',event=>{if(event.isTrusted)ipcRenderer.send('star:syncPaste',String(event.clipboardData?.getData('text/plain')||'').slice(0,1000000));},true);",
    "document.addEventListener('wheel',event=>{if(event.isTrusted&&!event.ctrlKey)ipcRenderer.send('star:syncWheel',{x:event.clientX,y:event.clientY,deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode});},{passive:true,capture:true});",
    "// 用 webFrame.executeJavaScript 在主世界执行，避免在 document_start 用 appendChild(<script>) 破坏页面加载（百度等会变空白）",
    "webFrame.executeJavaScript(" + JSON.stringify(code) + ");",
  ].join("\n");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

// 模式解析：① 开发可用 TFB_MODE 环境变量覆盖；② 读打包后 package.json 的 tfbMode（构建期注入，无竞态）
function resolveMode() {
  if (
    process.env.TFB_MODE === "lite" ||
    process.env.TFB_MODE === "pro" ||
    process.env.TFB_MODE === "changyi"
  )
    return process.env.TFB_MODE;
  try {
    const pkg = require(path.join(__dirname, "..", "..", "package.json"));
    if (
      pkg.tfbMode === "lite" ||
      pkg.tfbMode === "pro" ||
      pkg.tfbMode === "changyi"
    )
      return pkg.tfbMode;
  } catch (e) {}
  return "changyi"; // 默认统一为「Star Browser」单产品形态
}

// ---------------- 中文应用菜单（替代 Electron 默认英文菜单）----------------
function sendBrowserCommand(command, fallback) {
  const focused=BrowserWindow.getFocusedWindow();
  if(focused?._profile)focused.webContents.send('star:browserCommand',command);
  else if(focused&&fallback)fallback(focused);
}
function setAppMenu(mode) {
  const isPro = mode !== "lite";
  const brand = "Star Browser";
  const tpl = [
    ...(process.platform === "darwin"
      ? [{
          label: brand,
          submenu: [
            { label: "关于Star Browser", role: "about" },
            { type: "separator" },
            { label: "服务", role: "services" },
            { type: "separator" },
            { label: "隐藏Star Browser", role: "hide" },
            { label: "隐藏其他", role: "hideOthers" },
            { label: "显示全部", role: "unhide" },
            { type: "separator" },
            { label: "退出Star Browser", role: "quit" },
          ],
        }]
      : []),
    {
      label: "文件",
      submenu: [
        ...(isPro
          ? [
              {
                label: "新建环境",
                accelerator: "CmdOrCtrl+N",
                click: () => {
                  if (win && !win.isDestroyed()) {
                    win.show();
                    win.webContents.send("menu:new");
                  }
                },
              },
            ]
          : []),
        { type: "separator" },
        {
          label: "新建标签页", accelerator: "CmdOrCtrl+T",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && focused._profile) focused.webContents.send("menu:new-tab");
          },
        },
        {
          label: "关闭标签页", accelerator: "CmdOrCtrl+W",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (!focused) return;
            if (focused._profile) focused.webContents.send("menu:close-tab");
            else focused.close();
          },
        },
        { label: "恢复关闭的标签页", accelerator:"CmdOrCtrl+Shift+T", click:()=>sendBrowserCommand("restore-tab") },
        { label: "关闭窗口", role: "close", accelerator: "CmdOrCtrl+Shift+W" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
        { type:"separator" },
        { label:"在页面中查找",accelerator:"CmdOrCtrl+F",click:()=>sendBrowserCommand("find",w=>w.webContents.send("star:browserCommand","search")) },
        { label:"搜索或输入网址",accelerator:"CmdOrCtrl+L",click:()=>sendBrowserCommand("address") },
        { label:"历史记录",accelerator:"CmdOrCtrl+Y",click:()=>sendBrowserCommand("history") },
        { label:"工作台快速操作",accelerator:"CmdOrCtrl+K",click:()=>{if(win&&!win.isDestroyed()){win.show();win.focus();win.webContents.send("star:browserCommand","palette");}} },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载",accelerator:"CmdOrCtrl+R",click:()=>sendBrowserCommand("reload",w=>w.webContents.reload()) },
        { label: "强制刷新",accelerator:"CmdOrCtrl+Shift+R",click:()=>sendBrowserCommand("force-reload",w=>w.webContents.reloadIgnoringCache()) },
        { type: "separator" },
        { label: "实际大小",accelerator:"CmdOrCtrl+0",click:()=>sendBrowserCommand("zoom-reset",w=>w.webContents.setZoomFactor(1)) },
        { label: "放大",accelerator:"CmdOrCtrl+Plus",click:()=>sendBrowserCommand("zoom-in",w=>w.webContents.setZoomFactor(Math.min(2,w.webContents.getZoomFactor()+.1))) },
        { label: "缩小",accelerator:"CmdOrCtrl+-",click:()=>sendBrowserCommand("zoom-out",w=>w.webContents.setZoomFactor(Math.max(.5,w.webContents.getZoomFactor()-.1))) },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "指纹检测网站",
          click: () => shell.openExternal("https://ipchacha.cn/fp.html"),
        },
        {
          label: "关于",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "关于",
              message:
                brand +
                " · 独立浏览环境与本地工作台\n" +
                "Chromium " + process.versions.chrome +
                "\n构建版本：" +
                BUILD_TAG,
              buttons: ["确定"],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// 全局：限制 WebRTC 只暴露公网（代理）IP，降低真实 IP 泄露风险
app.commandLine.appendSwitch(
  "force-webrtc-ip-handling-policy",
  "default_public_interface_only",
);

// ---------------- 共享：应用内浏览器（内置 Chromium 内核 + webview + 指纹注入）----------------
// 创建浏览窗口（Lite 主窗口 / Pro 应用内打开共用），通过 browse:init 下发指纹配置。
function createBrowseWindow(profile, fingerprint) {
  const fp =
    fingerprint ||
    generateFingerprint(profile.seed, {
      os: profile.os, fingerprint: profile.fingerprint,
      country: profile.country,
      timezone: profile.timezone,
      language: profile.language,
    });
  fp.webrtc = profile.webrtc || "disable";
  const browserWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title:
      "Star Browser · " + (profile.name || "浏览环境"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 关键：否则 <webview> 不会实例化为真实浏览器，页面永远打不开
    },
  });
  const init = {
    id: profile.id,
    name: profile.name,
    mode: MODE,
    openCheckPage: false,
    buildTag: BUILD_TAG,
    fingerprint: fp,
    preferences: store?.preferences() || {},
    proxy: profile.proxy || null,
    webrtc: profile.webrtc || "disable",
    fpSrc: FP_CORE_SRC,
    preloadURL: pathToFileURL(
      writeWebviewPreload(profile, fp),
    ).toString(),
    startUrl: resolveStartUrl(profile.startUrl),
    homeUrl: HOME_URL,
    savedTabs: profile.restoreSession !== false ? profile.sessionTabs || [] : [],
    savedActive: profile.sessionActive || 0,
  };
  browserWin._profile = Object.assign({}, profile, {
    proxy: profile.proxy || null,
  });
  browserWin._init = init;
  browserWin.on("close",()=>{browserWin._starClosing=true;});
  dbg(
    "createBrowseWindow mode=" +
      MODE +
      " startUrl=" +
      init.startUrl.slice(0, 60) +
      " preloadURL=" +
      init.preloadURL.slice(0, 60),
  );
  browserWin.loadFile(path.join(__dirname, "../renderer/browser-shell.html"));
  // 诊断：捕获宿主页与子页面(webview)报错
  browserWin.webContents.on("console-message", (e, level, message) => {
    dbg("HOST-CONSOLE L" + level + ": " + message);
  });
  browserWin.webContents.on("did-fail-load", (e) => {
    dbg(
      "HOST-FAIL " +
        e.errorCode +
        " " +
        e.errorDescription +
        " " +
        e.validatedURL,
    );
  });
  // F12 切换 DevTools
  browserWin.webContents.on("before-input-event", (event, input) => {
    if (
      input.key === "F12" ||
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i")
    ) {
      browserWin.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  browserWin.on("closed", () => {});
  return browserWin;
}

// ---------------- Lite 单环境持久化 ----------------
const LITE_COUNTRIES = [
  "US",
  "UK",
  "CA",
  "AU",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
  "SE",
  "PL",
  "RU",
  "JP",
  "KR",
  "SG",
  "HK",
  "TW",
  "IN",
  "TH",
  "VN",
  "MY",
  "PH",
  "ID",
  "AE",
  "SA",
  "TR",
  "BR",
  "MX",
  "ZA",
];
function getLiteProfile() {
  const p = path.join(app.getPath("userData"), "lite-profile.json");
  if (fs.existsSync(p)) {
    try {
      const existing = JSON.parse(fs.readFileSync(p, "utf-8"));
      // 迁移旧默认（被墙/离线占位/旧 data: 主页）到可访问的业务首页
      if (
        !existing.startUrl ||
        existing.startUrl === "about:home" ||
        existing.startUrl.startsWith("data:") ||
        /^https?:\/\/(www\.)?(whoer\.com|google\.com)/i.test(
          existing.startUrl || "",
        )
      ) {
        existing.startUrl = "https://www.chuhailiqi.com";
        try {
          fs.writeFileSync(p, JSON.stringify(existing, null, 2), "utf-8");
        } catch (e) {}
      }
      // 迁移旧 WebRTC 默认 'proxy'（UDP STUN 会穿透 HTTP 代理暴露真实 IPv6/公网 IP）到 'disable'，彻底杜绝 WebRTC 泄漏
      if (existing.webrtc === "proxy") {
        existing.webrtc = "disable";
        try {
          fs.writeFileSync(p, JSON.stringify(existing, null, 2), "utf-8");
        } catch (e) {}
      }
      return existing;
    } catch (e) {}
  }
  const seed = Math.floor(Math.random() * 1e9).toString(36);
  const country =
    LITE_COUNTRIES[Math.floor(Math.random() * LITE_COUNTRIES.length)];
  const profile = {
    id: "lite",
    name: "我的指纹环境",
    seed,
    os: "win",
    country,
    startUrl: "https://www.chuhailiqi.com",
    webrtc: "disable",
    proxy: { type: "socks5", host: "", port: "", user: "", pass: "" },
  };
  fs.writeFileSync(p, JSON.stringify(profile, null, 2), "utf-8");
  return profile;
}
function writeLiteProfile(profile) {
  const p = path.join(app.getPath("userData"), "lite-profile.json");
  fs.writeFileSync(p, JSON.stringify(profile, null, 2), "utf-8");
}

// ---------------- 控制台 / 管理端（多环境管理 + 内置浏览器）----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 740,
    minHeight: 600,
    title: "Star Browser",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  // 诊断：捕获管理页 console/报错，并读取页面内容判断是否空白
  win.webContents.on("console-message", (e, level, message) => {
    dbg("PRO-MGT-CONSOLE L" + level + ": " + message);
  });
  win.webContents.on("did-fail-load", (e) =>
    dbg(
      "PRO-MGT-FAIL " +
        e.errorCode +
        " " +
        e.errorDescription +
        " " +
        e.validatedURL,
    ),
  );
  win.webContents.on("did-finish-load", () => {
    dbg("PRO-MGT did-finish-load");
    setTimeout(() => {
      win.webContents
        .executeJavaScript(
          "JSON.stringify({title:document.title, bodyLen:(document.body&&document.body.innerHTML||'').length, rows:document.querySelectorAll('#rows tr').length, envStatus:(document.getElementById('envStatus')||{}).textContent||'', api:typeof window.api})",
        )
        .then((r) => dbg("PRO-MGT content: " + r))
        .catch((er) => dbg("PRO-MGT read err " + (er.message || er)));
    }, 3000);
  });
}

function startPro() {
  registerIpc();
  require("./workbench").registerWorkbench(store,{starting:()=>[...startupJobs.keys()].map(key=>key.slice(key.indexOf(":")+1)),commands:(name,args)=>{const handler=profileCommands.get(name);if(!handler)throw new Error("操作不存在");return handler(null,...args);}});
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------------- Lite 单开版（不多开，单窗口，历史形态保留）----------------
function startLite() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (liteWin && !liteWin.isDestroyed()) {
      if (liteWin.isMinimized()) liteWin.restore();
      liteWin.focus();
    }
  });
  registerIpc();
  liteWin = createBrowseWindow(getLiteProfile());
  app.on("activate", () => {
    if (!liteWin || liteWin.isDestroyed())
      liteWin = createBrowseWindow(getLiteProfile());
  });
}

// ---------------- Star Browser：统一单产品（控制台 + 内置浏览器）----------------
// 形态与 Pro 一致（多环境管理控制台 + 应用内/本机浏览器），但去掉「Lite/Pro」二元分裂的品牌与提示，
// 让用户在同个产品里既能单开也能多开，无需纠结选哪个包。
function startChangyi() {
  startPro(); // 复用控制台 + 内置浏览器全部能力
}

// ---------------- IPC ----------------
// 判断代理是否「真正可用」：不仅 TCP 通，还要能完成握手拿到出口。
// - 带鉴权的 SOCKS5（走网关逻辑）：用 connectSocks5 做一次真实 SOCKS5 握手（含鉴权 + connect 测试目标），
//   成功才算可用；否则上游虽 TCP 可达但鉴权失败/握手拒绝（如示例环境·US 的 st02 返回 REP=0x4/0x5），
//   设进去仍会 502 打不开网站。这是「端口通但代理不可用」的关键防护。
// - 其它类型（无鉴权 SOCKS5 / HTTP 代理）：TCP 层探测兜底。
async function isProxyUsable(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return false;
  try {
    if (proxy.type === "socks5" && (proxy.user || proxy.pass)) {
      const { connectSocks5 } = require("./local-proxy");
      const withTimeout = (p, ms) =>
        Promise.race([
          p,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("probe-timeout")), ms),
          ),
        ]);
      try {
        // 关键：不能只验证 SOCKS5 握手成功——「端口通但不转发真实流量」的坏代理(如示例环境·US 的 st02)
        // 握手能过，但转发任何网站都失败(Host unreachable)。必须建隧道后真正发一次 HTTP GET，
        // 能拿到 2xx/3xx 响应才算可用，否则判定不可用 → 触发回退直连 + 提示。
        const s = await withTimeout(
          connectSocks5(proxy, TEST_MODE ? "127.0.0.1" : "example.com",
            TEST_MODE ? Number(process.env.TFB_TEST_ORIGIN_PORT) : 80),
          8000,
        );
        const ok = await withTimeout(
          new Promise((res) => {
            let buf = "";
            const onData = (c) => {
              buf += c.toString("latin1");
              if (buf.indexOf("\r\n") >= 0) {
                try {
                  s.destroy();
                } catch (_) {}
                const line = buf.split("\r\n")[0];
                res(/^HTTP\/\d\.\d [23]\d\d/.test(line));
              }
            };
            s.on("data", onData);
            s.on("error", () => res(false));
            try {
              s.write(
                "GET / HTTP/1.1\r\nHost: " + (TEST_MODE ? "127.0.0.1" : "example.com") + "\r\nConnection: close\r\n\r\n",
              );
            } catch (_) {
              res(false);
            }
          }),
          8000,
        );
        return ok === true;
      } catch (_) {
        return false;
      }
    }
  } catch (_) {
    return false;
  }
  // 其它类型（无鉴权 SOCKS5 / HTTP 代理）：TCP 层探测兜底
  return new Promise((resolve) => {
    let s;
    try {
      s = require("net").connect(Number(proxy.port), String(proxy.host));
    } catch (_) {
      return resolve(false);
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try {
        s.destroy();
      } catch (_) {}
      resolve(ok);
    };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    s.setTimeout(3000, () => done(false));
  });
}

// 检测本机系统代理（Windows：注册表 Internet Settings）。返回 {enabled,type,host,port}。
// 非 Windows 或读取失败返回 {enabled:false}。osdwan 等白名单代理常在系统层开启，故创建环境时优先探测它。
function detectSystemProxy() {
  if (process.platform !== "win32") return { enabled: false };
  try {
    const { execFileSync } = require("child_process");
    const key =
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    let enableRaw = "";
    try {
      enableRaw = execFileSync("reg", ["query", key, "/v", "ProxyEnable"], {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch (_) {}
    const enabled = /ProxyEnable[\s\S]*?(0x1\b|\b1\b)/i.test(enableRaw);
    if (!enabled) return { enabled: false };
    let serverRaw = "";
    try {
      serverRaw = execFileSync("reg", ["query", key, "/v", "ProxyServer"], {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch (_) {}
    const m = serverRaw.match(/ProxyServer\s+REG_SZ\s+(.+)/);
    let server = m ? m[1].trim() : "";
    let type = "http",
      host = "",
      port = "";
    if (server) {
      let s = server;
      if (s.includes("=")) {
        const parts = s.split(";");
        const pick = parts.find((p) => /^https?=/i.test(p)) || parts[0];
        s = (pick.split("=")[1] || "").trim();
      }
      const hm = s.match(/^(.+?):(\d+)\s*$/);
      if (hm) {
        host = hm[1].trim();
        port = hm[2].trim();
      } else {
        host = s.trim();
      }
    }
    return { enabled: !!host, type, host, port };
  } catch (e) {
    return { enabled: false, error: String((e && e.message) || e) };
  }
}

// ---- 开机自启：安装包勾选框写注册表标记 → 首次启动应用；之后以本地设置文件为准 ----
const TFB_INSTALL_KEY = "HKCU\\Software\\TradeFingerprintBrowser";
const autoStartStateFile = () =>
  path.join(app.getPath("userData"), "tfb-autostart.json");
function readInstallAutoStartFlag() {
  if (process.platform !== "win32") return false;
  try {
    const { execFileSync } = require("child_process");
    const raw = execFileSync(
      "reg",
      ["query", TFB_INSTALL_KEY, "/v", "AutoStart"],
      { encoding: "utf8", windowsHide: true },
    );
    return /AutoStart[\s\S]*?\b1\b/i.test(raw);
  } catch (_) {
    return false;
  }
}
function loadAutoStart() {
  try {
    return JSON.parse(fs.readFileSync(autoStartStateFile(), "utf8"));
  } catch (_) {
    return null;
  }
}
function saveAutoStart(v) {
  try {
    fs.writeFileSync(autoStartStateFile(), JSON.stringify({ autoStart: !!v }));
  } catch (_) {}
}
function applyAutoStart() {
  if (TEST_MODE) return;
  try {
    let st = loadAutoStart();
    if (st === null) {
      const seed = readInstallAutoStartFlag(); // 安装包默认勾选时写下的标记
      st = { autoStart: seed };
      saveAutoStart(seed);
    }
    try {
      app.setLoginItemSettings({
        openAtLogin: !!st.autoStart,
        path: process.execPath,
      });
    } catch (_) {}
  } catch (_) {}
}

function registerIpc() {
  const paths = {
    rootDir: path.join(app.getPath("userData"), "profiles"),
    extTemplateDir: path.join(__dirname, "../extension"),
  };

  registerProfileCommand("list", () => store.list());
  registerProfileCommand("create", (e, partial) => {
    return store.transaction(()=>{const profile=store.create(partial||{});store.activity("创建环境",profile.name);return profile;});
  });
  registerProfileCommand("update", (e, id, patch) => {
    return store.transaction(()=>{const profile=store.update(id,patch);if(profile)store.activity("更新环境",profile.name);return profile;});
  });
  registerProfileCommand("remove", (e, id) => store.remove(id));
  registerProfileCommand("preview", async (e, id) => {
    const p = store.get(id);
    if (!p) return null;
    const internal=BrowserWindow.getAllWindows().some(w=>!w.isDestroyed()&&!w._starClosing&&w._profile?.id===id);
    if(internal&&fpCache.has(id))return fpCache.get(id);
    const chrome=getLaunchedBrowser(id);if(chrome&&!chrome.pipe.closed)return chrome.fingerprint;
    try {
      const r = await resolveAlignedFingerprint(p);
      return r.fingerprint;
    } catch (_) {
      return generateFingerprint(p.seed, {
        os: p.os, fingerprint: p.fingerprint,
        country: p.country,
        timezone: p.timezone,
        language: p.language,
      });
    }
  });

  // Pro：调用本机 Chrome/Edge 多开（适合对 Electron 内核敏感的高级站点）
  // 先对齐指纹（时区/语言跟随出口 IP，或用户手动指定），再传给 launcher；代理鉴权由 launcher 走本地网关处理。
  registerProfileCommand("launch", async (e, id) => {
    const p = store.get(id);
    if (!p) throw new Error("环境不存在");
    if (p.archived) throw new Error("请先恢复归档环境");
    if (p.proxy?.host && !(await isProxyUsable(p.proxy))) throw new Error("代理不可达，启动已阻止。请检查地址、端口和账号密码。");
    let fp;
    try {
      const r = await resolveAlignedFingerprint(p);
      fp = r.fingerprint;
    } catch (_) {
      fp = generateFingerprint(p.seed, {
        os: p.os, fingerprint: p.fingerprint,
        country: p.country,
        timezone: p.timezone,
        language: p.language,
      });
      fp.webrtc = p.webrtc || "disable";
    }
    const res = await launchProfile(p, paths, fp);
    store.touchOpened(id);
    store.activity("启动浏览器", p.name, "本机 Chrome");
    return { pid: res.pid, chrome: res.chrome, ua: res.fingerprint.userAgent, extensionId: res.extensionId };
  });

  // Pro：应用内自带 Chromium 内核打开（装完即用，无需外机 Chrome）
  // 打开时先把指纹时区/语言对齐到出口 IP 真实地理（有代理走代理、无代理走本机直连），
  // 写入 fpCache 供首屏同步注入，根治 whoer/browserscan 的「时区/语言与 IP 不一致」。
  registerProfileCommand("browse", async (e, id) => {
    const p = store.get(id);
    if (!p) throw new Error("环境不存在");
    if (p.archived) throw new Error("请先恢复归档环境");
    const existing = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w._starClosing && w._profile?.id === id);
    if (existing) { existing.show(); existing.focus(); return { ok: true, reused: true }; }
    if (p.proxy?.host && !(await isProxyUsable(p.proxy))) throw new Error("代理不可达，启动已阻止。请检查地址、端口和账号密码。");
    // 预创建环境分区会话（与后续 webview 同一 partition），让 geo 探测与网页加载走「同一个出口 IP」。
    // 这是根治轮换代理下「geo 时区 ≠ 检测站所见时区」(Timezone Mismatch) 的关键：探测与浏览同源同出口。
    const envSes = session.fromPartition("persist:tfb-env-" + p.id);
    await require("./extensions").getExtensionLibrary()?.loadForSession(envSes,p);
    // 首屏即对齐出口 IP 真实地理：先拿到 geo 再生成 fp0，确保检测站在「文档开头」抢读到的第一值
    // 就是与 IP 一致的时区/语言，从根上消除系统时差（首屏用错时区、align 滞后补救仍会被抢读）。
    const hasProxy = !!(p.proxy && p.proxy.host);
    let fp0;
    let geo = null;
    try {
      geo = await withTimeout(resolveExitGeo(p, envSes, 9000), 16000); // 代理探测 9s 上限，整体 16s 兜底
      const _opts = { os: p.os, fingerprint: p.fingerprint, country: p.country };
      // 时区：手动 > geo(真实出口) > 实际走代理→代理国家默认 > 实际直连→本机 OS 时区
      if (p.timezoneManual && p.timezone) _opts.timezone = p.timezone;
      else if (geo && geo.timezone)
        _opts.timezone = geo.timezone; // geo 成功：直接用出口 IP 真实时区
      else if (geo && geo.viaProxy)
        _opts.timezone =
          offsetToTz(p.country, geo.utcOffset) || TIMEZONES[p.country] || "";
      else _opts.timezone = hostTimeZone(); // 实际直连且 geo 失败：OS≈出口（中国直连用户即正确）
      // 语言：必须与「时区」来自同一个出口，绝不混搭。
      // 现场证据：日志曾打出 tz=America/New_York + lang=zh-CN（时区美国、语言中文），检测站必报语言不一致。
      if (p.langManual && p.language) _opts.language = p.language;
      else if (geo && geo.locale) _opts.language = geo.locale;
      else if (geo && geo.viaProxy)
        _opts.language = LOCALES[p.country] || "en-US"; // 走代理：语言跟代理国家，不能取本机中文
      else _opts.language = hostLocale();
      if (geo && geo.utcOffset != null) _opts.utcOffset = geo.utcOffset;
      fp0 = generateFingerprint(p.seed, _opts);
      dbg(
        "FINGERPRINT tz=" +
          _opts.timezone +
          " lang=" +
          _opts.language +
          " via=" +
          (geo && geo.viaProxy
            ? "proxy"
            : geo && geo.timezone
              ? "geo"
              : "host") +
          " geoCC=" +
          (geo && geo.country ? geo.country : "-") +
          " utcOffset=" +
          (geo && geo.utcOffset) +
          " proxy=" +
          (p.proxy && p.proxy.host
            ? p.proxy.host + ":" + p.proxy.port
            : "none"),
      );
    } catch (_) {
      // geo 全失败（极度异常）：按「是否真走代理」二选一兜底，语言与时区保持同一出口
      const _opts = { os: p.os, fingerprint: p.fingerprint, country: p.country };
      if (p.timezoneManual && p.timezone) _opts.timezone = p.timezone;
      else
        _opts.timezone = hasProxy ? TIMEZONES[p.country] || "" : hostTimeZone();
      if (p.langManual && p.language) _opts.language = p.language;
      else
        _opts.language = hasProxy
          ? LOCALES[p.country] || "en-US"
          : hostLocale();
      fp0 = generateFingerprint(p.seed, _opts);
    }
    fp0.webrtc = p.webrtc || "disable";
    fpCache.set(p.id, fp0);
    // ⚠️ 关键：把指纹直接挂在「分区会话对象」上。webview 与 envSes 是同一份缓存 session，
    // 这样 web-contents-created 早期注入无需依赖 partition 字符串同步（Electron 内部有延迟，
    // 旧实现靠 envIdFromPartition 反推 envId 常取不到 -> 重试 3 秒放弃 -> IPC 兜底晚 21 秒 ->
    // whoer 抢读真实宿主机时区）。直接从 wc.session.__tfbFp 读，开篇即注入。
    try {
      envSes.__tfbFp = fp0;
      envSes.__tfbEnvId = p.id;
    } catch (_) {}
    const win = createBrowseWindow(p, fp0);
    // 网络环境提示：白名单代理（如 osdwan）可能只放行部分站点，其余回退直连 → 检测出国内网络；
    // 当真实出口地理与预设地区不符时，给浏览器侧一个醒目提示，便于用户发现代理未生效。
    try {
      if (
        geo &&
        geo.country &&
        p.country &&
        geo.country.toUpperCase() !== p.country.toUpperCase()
      ) {
        win.webContents.send("browse:geo-warn", {
          expected: p.country,
          actual: geo.country,
          viaProxy: !!geo.viaProxy,
        });
      }
    } catch (_) {}
    store.touchOpened(id);
    store.activity("启动浏览器", p.name, "内置 Chromium");
    // 后台再完整对齐一次（代理场景首次 4s 内未出结果时，这里不限时补查；成功则与 fp0 一致，不闪）
    resolveAlignedFingerprint(p, envSes)
      .then((r) => {
        if (!r || !r.fingerprint) return;
        fpCache.set(p.id, r.fingerprint);
        try {
          envSes.__tfbFp = r.fingerprint;
        } catch (_) {}
        try {
          if (win && !win.isDestroyed())
            win.webContents.send("browse:align", r.fingerprint);
        } catch (_) {}
      })
      .catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("env:chrome", () => findChrome());

  // 浏览窗口就绪 -> 下发指纹配置
  ipcMain.on("browse:ready", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w._init) w.webContents.send("browse:init", w._init);
  });

  // 浏览窗口保存设置（Lite / Pro 应用内打开共用）：持久化 + 重生成指纹，返回新配置
  ipcMain.handle("browse:saveProfile", (e, patch) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const cur = w && w._profile ? w._profile : null;
    if (!cur) return null;
    if (patch && patch.country) cur.country = patch.country;
    if (patch && patch.timezone) cur.timezone = patch.timezone;
    if (patch && patch.timezoneManual !== undefined)
      cur.timezoneManual = !!patch.timezoneManual;
    if (patch && patch.language) cur.language = patch.language;
    if (patch && patch.langManual !== undefined)
      cur.langManual = !!patch.langManual;
    if (patch && patch.startUrl) cur.startUrl = patch.startUrl;
    if (patch && patch.proxy)
      cur.proxy = Object.assign(cur.proxy || {}, patch.proxy);
    if (patch && patch.webrtc)
      cur.webrtc = patch.webrtc === "disable" ? "disable" : "proxy";
    if (patch && patch.regen)
      cur.seed = Math.floor(Math.random() * 1e9).toString(36);
    if (patch && patch.note !== undefined) cur.note = patch.note;
    if (patch && patch.tags !== undefined) cur.tags = patch.tags;

    if (MODE === "lite") {
      writeLiteProfile(cur);
    } else if (cur.id && store.get(cur.id)) {
      store.update(cur.id, {
        country: cur.country,
        startUrl: cur.startUrl,
        proxy: cur.proxy,
        webrtc: cur.webrtc,
        seed: cur.seed,
        note: cur.note,
        tags: cur.tags,
        timezone: cur.timezone,
        timezoneManual: cur.timezoneManual,
        language: cur.language,
        langManual: cur.langManual,
      });
    }

    // 时区：手动锁定时用用户指定值；否则沿用「已对齐到出口 IP」的时区（fpCache）。
    // ⚠️ 旧实现直接把 cur.timezone 传进去，而自动模式下它通常为空 → generateFingerprint 退化成
    // 国家默认值（US→America/New_York）＝「每次保存设置都把时区打回纽约」，直接破坏地理对齐。
    let effTz = cur.timezoneManual && cur.timezone ? cur.timezone : "";
    if (!effTz && cur.id) {
      const cached = fpCache.get(cur.id);
      if (cached && cached.timezone) effTz = cached.timezone;
    }
    const fp = generateFingerprint(cur.seed, {
      os: cur.os, fingerprint: cur.fingerprint,
      country: cur.country,
      timezone: effTz,
      language: cur.language,
    });
    fp.webrtc = cur.webrtc || "disable";
    const payload = {
      id: cur.id,
      name: cur.name,
      mode: MODE,
      buildTag: BUILD_TAG,
      fingerprint: fp,
      proxy: cur.proxy,
      webrtc: cur.webrtc || "disable",
      fpSrc: FP_CORE_SRC,
      // ⚠️ 必须回传国家/时区/语言及其「手动锁定」标志：渲染端设置面板靠这些字段回填下拉框。
      // 缺了它们就会出现「保存后重开面板，时区又变回自动跟随」（profile 读不到 timezoneManual）。
      country: cur.country,
      timezone: cur.timezone,
      timezoneManual: !!cur.timezoneManual,
      language: cur.language,
      langManual: !!cur.langManual,
      preloadURL: pathToFileURL(writeWebviewPreload(cur, fp)).toString(),
      startUrl: resolveStartUrl(cur.startUrl),
      homeUrl: HOME_URL,
    };
    w._profile = cur;
    w._init = payload;
    if (cur.id) fpCache.set(cur.id, fp);
    return payload;
  });

  // 浏览窗口：关闭本窗口
  ipcMain.on("browse:close", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.close();
  });

  // 诊断：渲染端日志转发到文件
  ipcMain.on("dbg:log", (e, msg) => {
    dbg("RENDERER: " + msg);
  });

  // 把 Accept-Language 请求头重写为伪装语言，并保证 handler 只绑定一次。
  // whoer 等服务端会比对 HTTP 头与 JS navigator.language，不一致即报「语言不一致」；
  // Electron 默认发宿主机语言(zh-CN)，必须显式改写。
  // ⚠️ 必须在「首次导航之前」完成绑定：否则第一个文档请求的头仍是本机 zh-CN，
  // whoer 会据此把站点重定向到中文版 /zh/，并留下语言偏好（实测现象：whoer.com/zh/）。
  // 故早期注入路径(web-contents-created)与 guest:setProxy 都要调用它。


  // 为 webview guest 设置代理（Electron 31 移除了 webview.getWebContents，改由主进程用 webContentsId 设置）
  // 关键：Chromium 不支持「带账号密码的 SOCKS5」——凭据会被静默丢弃、login 事件对 SOCKS5 也不触发。
  // 故带鉴权的 SOCKS5 一律改为「本地无鉴权 HTTP 网关(http://127.0.0.1:<port>)」，由网关向上游 SOCKS5 鉴权转发。
  ipcMain.handle("guest:setProxy", async (e, id, proxy, lang) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(Number(id));
      if (!wc || wc.isDestroyed()) return false;
      // 放行 HTTPS 证书错误（目标站点证书异常 / 上游代理做 TLS 拦截），避免 ERR_CERT_AUTHORITY_INVALID 打不开网页
      try {
        wc.session.setCertificateVerifyProc(null);
      } catch (_) {}
      // 见 bindLangHeader 说明：须在首次导航前把 Accept-Language 改成伪装语言，
      // 否则 whoer 会按本机 zh-CN 头重定向到中文版 /zh/。
      bindLangHeader(wc, lang || "en-US");
      const { buildProxyRules } = require("./proxy-parse");
      const { getGateway, needsGateway } = require("./local-proxy");
      if (proxy && proxy.host) {
        // 代理可达性前置检查：死代理（连 TCP 都连不上）直接设进 Chromium 会让所有网站返回 502、全站打不开。
        // 保留代理规则并阻断失败，避免意外暴露本机出口。
        const reachable = await isProxyUsable(proxy);
        if (!reachable) {
          await wc.session
            .setProxy({ proxyRules: buildProxyRules(proxy), proxyBypassRules: "<-loopback>" });
          try {
            wc.session.__tfbProxyDead = true;
          } catch (_) {}
          try {
            const win =
              (wc.getOwnerBrowserWindow && wc.getOwnerBrowserWindow()) || null;
            if (win && win.webContents)
              win.webContents.send(
                "tfb:toast",
                "⚠ 代理 " +
                  proxy.host +
                  ":" +
                  proxy.port +
                  " 不可达，连接已阻断。请检查或更换代理后重试。",
              );
          } catch (_) {}
          return { ok: false, proxyDead: true, error: "代理不可达，连接已阻断" };
        }
        if (needsGateway(proxy)) {
          const port = await getGateway(proxy);
          // 所有目标（含 loopback）都经网关；<-loopback> 取消 Chromium 隐式绕过。
          await wc.session
            .setProxy({
              proxyRules: `http://127.0.0.1:${port}`,
              proxyBypassRules: "<-loopback>",
            })
            .catch(() => {});
        } else {
          const rules = buildProxyRules(proxy);
          await wc.session
            .setProxy({ proxyRules: rules, proxyBypassRules: "<-loopback>" })
            .catch(() => {});
          // HTTP 代理带鉴权：Chromium 支持 HTTP 代理 login 事件，保留兜底
          const user = (proxy.user || "").toString().trim();
          if (user && proxy.type !== "socks5") {
            wc.session.__tfbProxyCreds = {
              user,
              pass: (proxy.pass || "").toString(),
              host: proxy.host, port: Number(proxy.port),
            };

          }
        }
      } else {
        await wc.session
          .setProxy({ proxyRules: "", proxyBypassRules: "<-loopback>" })
          .catch(() => {});
      }
      return { ok: true };
    } catch (err) {
      return { ok: false };
    }
  });

  ipcMain.handle("guest:injectFingerprint", async (e, id) => {
    const wc=require("electron").webContents.fromId(Number(id));
    if(!wc||wc.isDestroyed()||wc.getType()!=="webview"||wc.hostWebContents!==e.sender)throw new Error("无法配置此浏览器标签");
    const fingerprint=wc.session.__tfbFp;
    if(!fingerprint)throw new Error("环境配置尚未准备好，请重试");
    return prepareGuestFingerprint(wc,fingerprint);
  });

  // 拦截 webview guest 的弹窗（target=_blank / window.open）：拒绝建独立窗口，把 URL 发回宿主渲染端开新标签。
  // 注意：渲染端 webview 的 `new-window` 事件 preventDefault 在 Electron 31 不可靠（该事件已被 setWindowOpenHandler 取代），
  // 故用主进程 setWindowOpenHandler 才是稳妥做法。
  ipcMain.handle("guest:setPopHandler", (e, id) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(Number(id));
      if (!wc || wc.isDestroyed()) return false;
      wc.setWindowOpenHandler(({ url }) => {
        try {
          const host = wc.hostWebContents;
          if (host && !host.isDestroyed()) host.send("browse:newtab", url);
        } catch (e2) {}
        return { action: "deny" };
      });
      return true;
    } catch (err) {
      return false;
    }
  });

  // 清除指定 guest webview 的 Cookie/缓存：经主进程会话 session 清除，不受渲染端 webview
  // 「必须 attached+dom-ready」守卫限制（直接调 t.web.clearStorageData 在页面未就绪时会抛
  // "The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called" 错误）。
  ipcMain.handle("guest:clearStorage", async (e, wcId) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(Number(wcId));
      if (!wc || wc.isDestroyed()) return { ok: false, error: "页面已销毁" };
      const ses = wc.session;
      if (ses && typeof ses.clearStorageData === "function") {
        await ses.clearStorageData();
        return { ok: true };
      }
      return { ok: false, error: "会话不可用" };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // 统一「云端清单（manifest）」：从远端 JSON 读取 分组站点 + 广告位 + 官方收藏夹 + 版本号，
  // 便于随时更新而不重新发版。走主进程 net 请求（渲染端 file:// 直接 fetch 会被 CORS 拦截）。
  // 断网或云端异常时回落到上次成功写入本地的缓存文件（manifest-cache.json），保证离线可用。
  function _manifestCacheFile() {
    try {
      return path.join(app.getPath("userData"), "manifest-cache.json");
    } catch (_) {
      return "";
    }
  }
  function _readManifestCache() {
    try {
      const f = _manifestCacheFile();
      if (f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (_) {}
    return null;
  }
  function _writeManifestCache(cfg) {
    try {
      const f = _manifestCacheFile();
      if (f) fs.writeFileSync(f, JSON.stringify(cfg));
    } catch (_) {}
  }
  async function fetchManifestRemote() {
    return new Promise((resolve) => {
      let d = "",
        done = false;
      const finish = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      let req;
      try {
        req = net.request({ url: LAUNCHER_CONFIG_URL });
      } catch (_) {
        finish(null);
        return;
      }
      req.on("response", (r) => {
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            finish(JSON.parse(d || "null"));
          } catch (_) {
            finish(null);
          }
        });
      });
      req.on("error", () => finish(null));
      // 万一出现 30x：net.request 默认不跟随，这里手动跟随一次（主域名已用 www 避免 301）
      req.on("redirect", () => {
        try {
          req.followRedirect();
        } catch (_) {
          finish(null);
        }
      });
      if (req.setTimeout)
        req.setTimeout(6000, () => {
          try {
            req.abort();
          } catch (_) {}
          finish(null);
        });
      req.end();
    });
  }
  ipcMain.handle("launcher:config", async () => ({ok:true,config:{groups:[],ads:[],bookmarks:[]},fromCache:true}));

  // ---------------- 匿名使用统计开关（设置面板） ----------------
  ipcMain.handle("app:getTelemetry", () => telemetryEnabled());
  ipcMain.handle("app:setTelemetry", (e, on) => {
    saveTelemetry(!!on);
    return telemetryEnabled();
  });

  // ---------------- 收藏夹（全局共享，跨环境） ----------------
  ipcMain.handle("bookmarks:list", () => store.listBookmarks());
  ipcMain.handle("bookmarks:add", (e, bm) => store.addBookmark(bm || {}));
  ipcMain.handle("bookmarks:remove", (e, id) => store.removeBookmark(id));
  ipcMain.handle("bookmarks:update", (e, id, patch) =>
    store.updateBookmark(id, patch || {}),
  );
  // 云端托管收藏夹合并：以 id 为键，官方条目覆盖同 id 官方条目；用户自加(source=user)永不被动。
  ipcMain.handle("bookmarks:mergeCloud", (e, list) => {
    try {
      store.mergeCloudBookmarks(list || []);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // ---------------- 最常访问（New Tab 快捷入口，自动适应用户习惯） ----------------
  ipcMain.handle("visits:record", (e, url, title) => {
    try {
      store.recordVisit(url, title);
    } catch (_) {}
    return { ok: true };
  });
  ipcMain.handle("visits:top", (e, n) => {
    try {
      return store.topVisits(n);
    } catch (_) {
      return [];
    }
  });

  // ---------------- 批量代理检测 ----------------
  // 逐条输出：连通性+延迟、出口 IP、国家/州/城市、时区、运营商/ASN、IP 类型（住宅/机房/移动）、风控标记。
  // 并发执行，单条全程超时保护，避免某一条卡死拖垮整批。
  const BATCH_CONCURRENCY = 25;

  // 查询 IP 情报：运营商/ASN、是否机房/代理/移动（风控相关）。
  // 主用 ip-api.com（免费版即含 proxy/hosting/mobile 字段），ipinfo.io 补 org 与 privacy（VPN/代理/机房/中继）。
  async function fetchIpIntel(ip) {
    const out = {
      isp: "",
      asn: "",
      mobile: false,
      proxy: false,
      hosting: false,
      privacy: "",
    };
    if (!ip) return out;
    const grab = (url) =>
      new Promise((res) => {
        let d = "",
          done = false;
        const finish = (v) => {
          if (!done) {
            done = true;
            res(v);
          }
        };
        let req;
        try {
          req = net.request({ url });
        } catch (_) {
          finish("");
          return;
        }
        req.on("response", (r) => {
          r.on("data", (c) => (d += c));
          r.on("end", () => finish(d));
        });
        req.on("error", () => finish(""));
        if (req.setTimeout)
          req.setTimeout(6000, () => {
            try {
              req.abort();
            } catch (_) {}
            finish("");
          });
        req.end();
      });
    try {
      const o = JSON.parse(
        (await grab(
          "http://ip-api.com/json/" +
            ip +
            "?fields=status,message,isp,org,as,proxy,hosting,mobile",
        )) || "null",
      );
      if (o && o.status === "success") {
        out.isp = o.isp || "";
        out.asn = o.as || o.org || "";
        out.mobile = !!o.mobile;
        out.proxy = !!o.proxy;
        out.hosting = !!o.hosting;
      }
    } catch (_) {}
    try {
      const o2 = JSON.parse(
        (await grab("https://ipinfo.io/" + ip + "/json")) || "null",
      );
      if (o2) {
        if (!out.asn && o2.org) out.asn = o2.org;
        if (o2.privacy) {
          const p = o2.privacy,
            flags = [];
          if (p.vpn) flags.push("VPN");
          if (p.proxy) flags.push("代理");
          if (p.tor) flags.push("TOR");
          if (p.hosting) flags.push("机房");
          if (p.relay) flags.push("中继");
          out.privacy = flags.join("/");
          if (p.hosting) out.hosting = true;
          if (p.vpn || p.proxy) out.proxy = true;
        }
      }
    } catch (_) {}
    return out;
  }

  async function checkOneProxy(raw) {
    const { parseProxyInput } = require("./proxy-parse");
    const t0 = Date.now();
    const out = {
      raw: String(raw || "").trim(),
      host: "",
      port: "",
      type: "",
      ok: false,
      error: "",
      latency: 0,
      exitIp: "",
      country: "",
      region: "",
      city: "",
      timezone: "",
      isp: "",
      asn: "",
      org: "",
      ipType: "",
      risk: "",
      privacy: "",
    };
    let proxy = null;
    try {
      proxy = parseProxyInput(out.raw);
    } catch (_) {
      proxy = null;
    }
    if (!proxy || !proxy.host || !proxy.port) {
      out.error = "格式无法解析";
      return out;
    }
    out.host = proxy.host;
    out.port = String(proxy.port);
    out.type = proxy.type;
    // ① 连通性：SOCKS5 走真实握手+转发测试，能识别「握手过但不转发」的坏代理
    let usable = false;
    try {
      usable = await withTimeout(isProxyUsable(proxy), 10000);
    } catch (_) {
      usable = false;
    }
    out.latency = Date.now() - t0;
    if (!usable) {
      out.error = "连接失败或超时";
      return out;
    }
    // ② 出口 IP：用该代理建会话，走纯文本回显站点取真实出口（discoverProxyExitIp 已过滤 127.0.0.1 等私网地址）
    try {
      const ses = session.fromPartition(
        "tfb-batch-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
      );
      try {
        ses.setCertificateVerifyProc(null);
      } catch (_) {}
      const applied = await applyProxyToSession(ses, proxy);
      if (applied && applied.proxyDead) {
        out.error = "代理不可用（握手/转发失败）";
        return out;
      }
      let exitIp = null;
      try {
        exitIp = await withTimeout(discoverProxyExitIp(ses), 12000);
      } catch (_) {}
      if (!exitIp) {
        out.ok = true;
        out.error = "可用，但未取得出口IP";
        return out;
      }
      out.exitIp = exitIp;
      // ③ 地理：5 源投票拿国家/城市/时区/运营商
      try {
        const dses = session.fromPartition(
          "tfb-direct-geo-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 1e6),
        );
        try {
          dses.setCertificateVerifyProc(null);
        } catch (_) {}
        const g = await withTimeout(
          _fetchGeoThrough(dses, 8000, exitIp),
          12000,
        );
        if (g && g.ok) {
          out.country = g.country || "";
          out.city = g.city || "";
          out.region = g.region || "";
          out.timezone = g.timezone || "";
          out.org = g.org || "";
        }
      } catch (_) {}
      // ④ IP 类型 / 风控
      try {
        const it = await withTimeout(fetchIpIntel(exitIp), 9000);
        if (it) {
          out.isp = it.isp || "";
          out.asn = it.asn || out.asn || out.org;
          out.privacy = it.privacy || "";
          if (it.mobile) {
            out.ipType = "移动";
            out.risk = "中";
          } else if (it.hosting) {
            out.ipType = "机房";
            out.risk = "高";
          } else if (it.proxy) {
            out.ipType = "代理/VPN";
            out.risk = "高";
          } else {
            out.ipType = "住宅";
            out.risk = "低";
          }
          if (it.privacy) out.risk += " · " + it.privacy;
        }
      } catch (_) {}
      out.ok = true;
    } catch (err) {
      out.error = "检测异常：" + ((err && err.message) || "");
    }
    return out;
  }

  ipcMain.handle("proxy:batchCheck", async (e, list) => {
    const arr = (Array.isArray(list) ? list : [])
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const results = [];
    for (let i = 0; i < arr.length; i += BATCH_CONCURRENCY) {
      const chunk = arr.slice(i, i + BATCH_CONCURRENCY);
      const part = await Promise.all(
        chunk.map((r) =>
          checkOneProxy(r).catch(() => ({
            raw: r,
            ok: false,
            error: "检测异常",
          })),
        ),
      );
      results.push(...part);
    }
    return { ok: true, results };
  });

  // Pro：菜单「新建环境」-> 通知渲染端打开弹窗
  ipcMain.on("menu:new", () => {
    if (win && !win.isDestroyed()) win.webContents.send("menu:new");
  });

  // ---------------- 每环境 Cookie 备份 / 恢复 ----------------
  // 备份：导出该环境分区(session)下的全部 Cookie 为 JSON 文件
  ipcMain.handle("cookies:export", async (e, envId) => {
    const part = "persist:tfb-env-" + (envId || "lite");
    const ses = session.fromPartition(part);
    let cookies = [];
    try {
      cookies = await ses.cookies.get({});
    } catch (err) {
      return { ok: false, error: "读取 Cookie 失败：" + err.message };
    }
    const { canceled, filePath } = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(e.sender) || null,
      {
        title: "备份 Cookie（环境 " + (envId || "lite") + "）",
        defaultPath:
          "cookies-" +
          (envId || "lite") +
          "-" +
          new Date().toISOString().slice(0, 10) +
          ".json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      },
    );
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), "utf-8");
    } catch (err) {
      return { ok: false, error: "写入文件失败：" + err.message };
    }
    return { ok: true, count: cookies.length, filePath };
  });

  // 恢复：从 JSON 文件读回 Cookie 写入该环境分区(session)
  ipcMain.handle("cookies:import", async (e, envId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(e.sender) || null,
      {
        title: "恢复 Cookie（环境 " + (envId || "lite") + "）",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      },
    );
    if (canceled || !filePaths || !filePaths[0])
      return { ok: false, canceled: true };
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePaths[0], "utf-8"));
    } catch (err) {
      return { ok: false, error: "文件解析失败：" + err.message };
    }
    if (!Array.isArray(raw))
      return { ok: false, error: "文件格式不正确（应为 Cookie 数组）" };
    const part = "persist:tfb-env-" + (envId || "lite");
    const ses = session.fromPartition(part);
    let okCount = 0,
      failCount = 0;
    for (const c of raw) {
      try {
        if (!c || !c.name) {
          failCount++;
          continue;
        }
        const cookie = {
          url:
            (c.secure ? "https://" : "http://") +
            (c.domain || "localhost").replace(/^\./, "") +
            (c.path || "/"),
          name: c.name,
          value: c.value,
        };
        if (c.domain) cookie.domain = c.domain;
        if (c.path) cookie.path = c.path;
        if (typeof c.secure === "boolean") cookie.secure = c.secure;
        if (typeof c.httpOnly === "boolean") cookie.httpOnly = c.httpOnly;
        if (typeof c.sameSite === "string") cookie.sameSite = c.sameSite;
        if (typeof c.expirationDate === "number")
          cookie.expirationDate = c.expirationDate;
        await ses.cookies.set(cookie);
        okCount++;
      } catch (err) {
        failCount++;
      }
    }
    return { ok: true, okCount, failCount };
  });

  // 统计某环境分区下的 Cookie 数量（供 Cookie 管理面板展示）
  ipcMain.handle("cookies:count", async (e, envId) => {
    const part = "persist:tfb-env-" + (envId || "lite");
    const ses = session.fromPartition(part);
    try {
      const cs = await ses.cookies.get({});
      return { ok: true, count: cs.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 清空某环境分区下的全部 Cookie
  ipcMain.handle("cookies:clear", async (e, envId) => {
    const part = "persist:tfb-env-" + (envId || "lite");
    const ses = session.fromPartition(part);
    try {
      const cs = await ses.cookies.get({});
      for (const c of cs) {
        const url =
          (c.secure ? "https://" : "http://") +
          (c.domain || "").replace(/^\./, "") +
          (c.path || "/");
        try {
          await ses.cookies.remove(url, c.name);
        } catch (_) {}
      }
      return { ok: true, cleared: cs.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 广告位 / 帮助入口：打开外部链接（客服、进群、购买 IP）
  ipcMain.handle("open:external", async (e, url) => {
    if (!url || typeof url !== "string") return { ok: false };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---------------- 代理出口 IP 自检 ----------------
  // 用独立 session 走该环境代理请求出口 IP 检测服务，回传真实出口 IP / 国家，供渲染端与指纹国家比对。
  // 带鉴权的 SOCKS5 同样走本地网关（否则 Chromium 拿不到凭据，自检必失败）。
  ipcMain.handle("proxy:check", async (e, proxy) => {
    const r = await checkProxyGeo(proxy);
    if (!r.ok) return r;
    return {
      ok: true,
      ip: r.ip,
      country: r.country,
      timezone: r.timezone,
      locale: r.locale,
      city: r.city,
      region: r.region,
      org: r.org,
    };
  });

  // 根据代理出口 IP 自动对齐指纹「时区/语言/国家」，返回新 payload（与 browse:saveProfile 同形状）。
  // 用途：创建环境/打开网页时，让指纹默认跟随代理 IP 所在地，检测站（whoer/yalala）不再报时区/语言不一致。
  // overrideLang=false 时仅同步时区（用于用户已手动指定语言、不希望被覆盖的情形）。
  // 自动检测本机系统代理（Windows 注册表 Internet Settings），并读取其出口网络信息。
  // 用于「创建环境」时自动填充代理 / 国家 / 名称，省去手动配置。
  ipcMain.handle("system:detectProxyGeo", async () => {
    const sp = detectSystemProxy();
    if (sp.enabled && sp.host) {
      try {
        const proxy = {
          type: sp.type || "http",
          host: sp.host,
          port: sp.port || "",
          user: "",
          pass: "",
        };
        const ses = session.fromPartition(
          "tfb-sysproxy-geo-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 1e6),
        );
        try {
          ses.setCertificateVerifyProc(null);
        } catch (_) {}
        const r = await withTimeout(checkProxyGeo(proxy, ses), 12000);
        return {
          enabled: true,
          type: sp.type,
          host: sp.host,
          port: sp.port,
          country: r && r.country,
          ip: r && r.ip,
          timezone: r && r.timezone,
          locale: r && r.locale,
          city: r && r.city,
          region: r && r.region,
          org: r && r.org,
        };
      } catch (err) {
        return {
          enabled: true,
          type: sp.type,
          host: sp.host,
          port: sp.port,
          error: String((err && err.message) || err),
        };
      }
    }
    // 无本机系统代理：探测本机直连出口地理，用于「创建环境」时按网络自动推荐国家 / 时区 / 语言
    try {
      const r = await withTimeout(checkLocalGeo(), 12000);
      if (!r || !r.ok) return { enabled: false };
      return {
        enabled: false,
        country: r.country,
        ip: r.ip,
        timezone: r.timezone,
        locale: r.locale,
        city: r.city,
        region: r.region,
        org: r.org,
      };
    } catch (_) {
      return { enabled: false };
    }
  });

  // 开机自启：读取 / 设置（设置面板开关调用）
  ipcMain.handle("app:getAutoStart", () => {
    const st = loadAutoStart();
    return st ? !!st.autoStart : false;
  });
  ipcMain.handle("app:setAutoStart", (e, on) => {
    if (TEST_MODE) return false;
    const v = !!on;
    saveAutoStart(v);
    try {
      app.setLoginItemSettings({ openAtLogin: v, path: process.execPath });
    } catch (_) {}
    return v;
  });

  ipcMain.handle("browse:syncGeo", async (e, opts) => {
    opts = opts || {};
    const w = BrowserWindow.fromWebContents(e.sender);
    const cur = w && w._profile ? w._profile : null;
    if (!cur) return { ok: false, error: "无环境上下文" };
    // 有代理走代理出口；无代理走本机直连出口（让直连环境的指纹也跟随真实网络地理位置）
    let r;
    if (cur.proxy && cur.proxy.host) r = await checkProxyGeo(cur.proxy);
    else r = await checkLocalGeo();
    if (!r.ok) {
      // 直连且 geo 探测失败：用国家默认时区兜底（不再回退本机 OS 时区，避免与真实出口 IP 地理不符）。
      // timezone 留空 -> 下游 generateFingerprint 自动套用 TIMEZONES[country] 国家默认。
      if (!cur.proxy || !cur.proxy.host) {
        r = {
          ok: true,
          ip: "(本地直连)",
          country: cur.country,
          timezone: null,
          locale: hostLocale(),
          city: "",
          region: "",
          org: "",
        };
      }
      if (!r.ok) return { ok: false, error: r.error };
    }
    const overrideLang = opts.overrideLang !== false;
    const newTz = r.timezone;
    const newLang = overrideLang ? r.locale : cur.language || r.locale;
    const newCountry = r.country || cur.country;
    const changed =
      cur.timezone !== newTz ||
      cur.language !== newLang ||
      cur.country !== newCountry;
    cur.timezone = newTz;
    cur.language = newLang;
    cur.country = newCountry;
    if (overrideLang) cur.langManual = false;
    if (MODE === "lite") {
      writeLiteProfile(cur);
    } else if (cur.id && store.get(cur.id)) {
      store.update(cur.id, {
        timezone: cur.timezone,
        language: cur.language,
        country: cur.country,
        langManual: cur.langManual,
      });
    }
    const fp = generateFingerprint(cur.seed, {
      os: cur.os, fingerprint: cur.fingerprint,
      country: cur.country,
      timezone: cur.timezone,
      language: cur.language,
    });
    fp.webrtc = cur.webrtc || "disable";
    const payload = {
      id: cur.id,
      name: cur.name,
      mode: MODE,
      buildTag: BUILD_TAG,
      fingerprint: fp,
      proxy: cur.proxy,
      webrtc: cur.webrtc || "disable",
      fpSrc: FP_CORE_SRC,
      // ⚠️ 必须回传国家/时区/语言及其「手动锁定」标志：渲染端设置面板靠这些字段回填下拉框。
      // 缺了它们就会出现「保存后重开面板，时区又变回自动跟随」（profile 读不到 timezoneManual）。
      country: cur.country,
      timezone: cur.timezone,
      timezoneManual: !!cur.timezoneManual,
      language: cur.language,
      langManual: !!cur.langManual,
      preloadURL: pathToFileURL(writeWebviewPreload(cur, fp)).toString(),
      startUrl: resolveStartUrl(cur.startUrl),
      homeUrl: HOME_URL,
    };
    w._profile = cur;
    w._init = payload;
    if (cur.id) fpCache.set(cur.id, fp);
    return { ok: true, changed, payload };
  });
}

// 用独立 session 走代理请求出口 IP 检测服务，解析出「国家 / 时区 / 语言」供指纹对齐。
// 带鉴权 SOCKS5 走本地网关；HTTP 代理走 login 兜底。
// checkProxyGeo(proxy, ses?)：探测代理出口地理。若传入 ses（= 环境分区会话），则在该会话内同源探测，
// 使注入时区 = 网页加载走的实际出口 IP 地理，彻底消除轮换代理下 geo 时区与检测站所见不一致。
async function checkProxyGeo(proxy, ses) {
  if (!proxy || !proxy.host) return { ok: false, error: "未配置代理" };
  const _pkey =
    "p:" +
    (proxy.host || "") +
    ":" +
    (proxy.port || "") +
    ":" +
    (proxy.user || "");
  // 仅「未指定会话(非同源探测)」时走缓存；同源探测每次按真实出口重新对齐
  if (!ses) {
    const _pck = geoCacheGet(_pkey);
    if (_pck) return _pck;
  }
  let own = false;
  if (!ses) {
    ses = session.fromPartition(
      "tfb-check-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
    );
    own = true;
  }
  let applied;
  try {
    applied = await applyProxyToSession(ses, proxy);
  } catch (err) {
    return { ok: false, error: "代理设置失败：" + err.message };
  }
  // ⚠️ 关键：applyProxyToSession 在网关/转发失败时返回 {proxyDead:true}（且已把会话重置为直连）。
  // 若不在此拦截，下面 _fetchGeoThrough 会在「直连」下跑出本机出口地理，伪装成「代理出口」→ 时区与真实代理 IP 不符 → 报时差。
  if (applied && applied.proxyDead)
    return { ok: false, error: "代理不可用（网关/转发失败）" };
  const r = await _fetchGeoThrough(ses, 8000);
  if (r.ok && !ses) geoCacheSet(_pkey, r); // 同源探测结果不缓存（轮换代理每次出口可能不同）
  return r;
}

// 探出「代理真实出口 IP」：代理下 geo-api 常被墙，但 whoer/ipchacha 等站点通常可达。
// 用代理会话请求这些可达站点，从响应里抠出出口 IP。拿到 IP 后即可用主进程「直连」反查其真实地理时区，
// 与 whoer 服务端所见是同一 IP —— 这是根治「代理配了美国 IP 仍报时区差异」的关键：
// 时区必须对齐「代理出口 IP」，而非退化成直连/国家默认。
// 判定是否为「公网 IPv4」：过滤本机/私有/保留地址。
// ⚠️ 关键（2026-09-07 实测根因）：SOCKS5 走本地无鉴权 HTTP 网关时，会话代理是 http://127.0.0.1:<port>，
// 从 ipchacha/whoer 的 HTML 正文里正则抠出的「第一个 IP」常常就是 127.0.0.1（本地网关地址），
// 误当出口 IP 会让 geo 反查拿到空时区 → 只能盲兜底国家默认 → 检测站报时差。故必须过滤。
function isPublicIp(ip) {
  if (!ip) return false;
  const p = String(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return false;
  if (p[0] === 0 || p[0] === 127 || p[0] === 10) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 169 && p[1] === 254) return false;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return false;
  if (p[0] >= 224) return false;
  return true;
}

async function discoverProxyExitIp(ses) {
  // 端点顺序：纯文本回显 IP 的站点优先（响应体只有出口 IP，不会混入 127.0.0.1/CDN IP），
  // HTML 站点（ipchacha/whoer）排后面作兜底，且同样要过 isPublicIp 校验。
  const eps = [
    { url: "https://api.ipify.org?format=text" },
    { url: "https://icanhazip.com" },
    { url: "https://ifconfig.me/ip" },
    { url: "https://ipchacha.cn" },
    { url: "https://whoer.com" },
  ];
  const re = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
  const found = [];
  for (const ep of eps) {
    try {
      const txt = await new Promise((res) => {
        let d = "",
          done = false;
        const finish = (v) => {
          if (!done) {
            done = true;
            res(v);
          }
        };
        let req;
        try {
          req = bindProxyRequestAuthentication(net.request({ url: ep.url, session: ses }), ses);
        } catch (_) {
          finish("");
          return;
        }
        req.on("response", (r) => {
          r.on("data", (c) => (d += c));
          r.on("end", () => finish(d));
        });
        req.on("error", () => finish(""));
        if (req.setTimeout)
          req.setTimeout(6000, () => {
            try {
              req.abort();
            } catch (_) {}
            finish("");
          });
        req.end();
      });
      const m = (txt || "").trim().match(re);
      const ip = m ? m[1] : "";
      if (isPublicIp(ip)) {
        found.push(ip);
        if (found.length >= 2) break; // 两个独立来源都给出公网 IP 即可信
      } else if (ip) {
        dbg("GEO proxy-exit 忽略非公网IP " + ip + " (from " + ep.url + ")");
      }
    } catch (_) {}
  }
  if (!found.length) return null;
  // 众数优先（两源一致最可信）；无一致则取首个公网 IP
  const tally = {};
  found.forEach((ip) => {
    tally[ip] = (tally[ip] || 0) + 1;
  });
  let best = "",
    bestN = 0;
  Object.keys(tally).forEach((ip) => {
    if (tally[ip] > bestN) {
      bestN = tally[ip];
      best = ip;
    }
  });
  return best || found[0];
}

// ---------------- 指纹与出口 IP 对齐（根治「时区/语言与 IP 不一致」）----------------
// 关键：whoer/browserscan 等检测站把「浏览器时区/语言」与「出口 IP 的地理时区/语言」做比对，
// 不一致即报红。旧实现用「国家默认值」(如美国=America/New_York) 填入指纹，但代理出口 IP 真实所在时区
// 往往不是该默认值（或被墙网络直连时国家也对不上），导致永远报时差。
// 故在「打开环境」时先解析出口 IP 真实地理，把指纹时区/语言对齐到它，从根上消除不一致。
const fpCache = new Map(); // envId -> 已对齐指纹（供 web-contents-created 同步注入首屏）

// GeoIP 检测结果缓存：开环境/同步指纹时同一出口 IP 反复请求会被网络阻塞（慢加载根因之一），
// 缓存 10 分钟可让重复打开 / 同步瞬时完成，仅首次（或缓存过期）走网络。
const _geoCache = new Map(); // key -> { ts, result }
const _GEO_TTL = 2 * 60 * 1000; // 缩短到 2 分钟：轮换代理下减少缓存时区过期导致的 mismatch
function geoCacheKey(useProxy, proxy) {
  return useProxy
    ? "p:" +
        (proxy.host || "") +
        ":" +
        (proxy.port || "") +
        ":" +
        (proxy.user || "")
    : "local";
}
function geoCacheGet(key) {
  const v = _geoCache.get(key);
  if (v && Date.now() - v.ts < _GEO_TTL) return v.result;
  if (v) _geoCache.delete(key);
  return null;
}
function geoCacheSet(key, result) {
  _geoCache.set(key, { ts: Date.now(), result });
}

// 读取「本机真实时区 / 语言」：直连（无代理）时，本机时区 == 出口 IP 时区，二者天然一致。
// 当 geo 探测被网络拦截/失败时，用本机真实时区回填指纹，可 100% 保证浏览器时区与 IP 地理时区相符，
// 彻底消除直连场景下的「系统时差」误报（此前退化成国家默认值 US/New_York，与直连中国 IP 不符）。
function hostTimeZone() {
  try {
    const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return t && typeof t === "string" ? t : "";
  } catch (_) {
    return "";
  }
}
function hostLocale() {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale;
    if (l && l.length >= 2) return l;
  } catch (_) {}
  return "en-US";
}

// Promise 超时包装：到时 reject，避免 geo 探测卡死拖垮「打开环境」。
function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([promise, timer]).finally(() => {
    try {
      clearTimeout(t);
    } catch (_) {}
  });
}

// 解析「出口 IP 真实地理」：代理且可达 -> 代理出口 geo；代理不可用/无代理 -> 本机直连出口 geo。
// 二者皆失败返回 null（上层交由 generateFingerprint 用国家默认兜底）。
// 严禁回退「本机 OS 时区」(hostTimeZone)：本机 OS 时区(如上海)可能 ≠ 真实出口 IP 地理(如洛杉矶)，
// 一旦回退它，JS 时区与检测站所见出口 IP 地理对不上 -> 必报系统时差。
async function resolveExitGeo(profile, ses, proxyMs) {
  if (TEST_MODE) {
    if (ses) await applyProxyToSession(ses, profile.proxy);
    return { viaProxy: !!(profile.proxy && profile.proxy.host) };
  }
  const hasProxy = !!(profile.proxy && profile.proxy.host);
  if (hasProxy) {
    // 先判「代理是否真正可用」：不可用(死代理/网关不通)则浏览器会回退直连，
    // 此时指纹必须按「直连出口」对齐 —— 否则中国用户配了死代理、浏览器直连中国出口，
    // 指纹却设成纽约/洛杉矶 → whoer 看到「中国 IP + 美国时区」→ 必报时差。
    let reachable = false;
    try {
      reachable = await withTimeout(isProxyUsable(profile.proxy), 5000);
    } catch (_) {
      reachable = false;
    }
    if (!reachable) {
      dbg("GEO 代理不可用(死代理) -> 按直连出口对齐");
      try {
        const r = await checkLocalGeo();
        if (r.ok)
          return {
            country: r.country,
            timezone: r.timezone,
            locale: r.locale,
            utcOffset: r.utcOffset,
            viaProxy: false,
          };
      } catch (_) {}
      return { viaProxy: false };
    }
    // ① 走代理直接探测出口地理（geo-api 在代理下可达时最准）
    try {
      const r = await withTimeout(
        checkProxyGeo(profile.proxy, ses),
        proxyMs || 9000,
      );
      if (r && r.ok) {
        dbg(
          "GEO ok via=proxy ip=" +
            r.ip +
            " tz=" +
            r.timezone +
            " cc=" +
            r.country,
        );
        return {
          country: r.country,
          timezone: r.timezone,
          locale: r.locale,
          utcOffset: r.utcOffset,
          viaProxy: true,
        };
      }
    } catch (_) {}
    // ② geo-api 被代理墙：探出代理真实出口 IP（whoer/ipchacha 等代理下通常可达），再用主进程「直连」反查其地理时区。
    //    whoer 服务端也是按同一出口 IP 反查，故二者时区必然一致 —— 这是根治「代理配了美国 IP 仍报时区差异」的关键。
    try {
      const exitIp = await discoverProxyExitIp(ses);
      if (exitIp) {
        const dses = session.fromPartition(
          "tfb-direct-geo-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 1e6),
        );
        try {
          dses.setCertificateVerifyProc(null);
        } catch (_) {}
        dbg("GEO proxy-exit ip=" + exitIp + " -> 主进程直连反查时区");
        const g = await withTimeout(_fetchGeoThrough(dses, 8000, exitIp), 9000);
        // ⚠️ 必须要求 timezone 非空：反查一个错误 IP（如 127.0.0.1）会返回 ok 但时区为空，
        // 若在此直接返回，上层会因为「有 viaProxy 但无时区」而盲兜底国家默认，检测站照旧报时差。
        if (g && g.ok && g.timezone) {
          dbg(
            "GEO ok via=proxy-exit ip=" +
              exitIp +
              " tz=" +
              g.timezone +
              " cc=" +
              g.country,
          );
          return {
            country: g.country,
            timezone: g.timezone,
            locale: g.locale,
            utcOffset: g.utcOffset,
            viaProxy: true,
          };
        }
        dbg(
          "GEO proxy-exit 反查无时区 ip=" +
            exitIp +
            " ok=" +
            !!(g && g.ok) +
            " tz=" +
            (g && g.timezone),
        );
      }
    } catch (_) {}
    // ①/② 均失败但代理确实可用：出口地理未知 → 用「代理国家默认时区」兜底（US→纽约）。
    // 严禁回退直连 geo（直连 IP≠代理出口，会再次造成「浏览器走代理、指纹用直连时区」的错位）。
    dbg("GEO 代理出口地理未知 -> 代理国家默认兜底");
    return { viaProxy: true };
  }
  try {
    const r = await checkLocalGeo();
    if (r.ok)
      return {
        country: r.country,
        timezone: r.timezone,
        locale: r.locale,
        utcOffset: r.utcOffset,
        viaProxy: false,
      };
  } catch (_) {}
  // 直连 geo 也失败（如国内封禁 geo 源）：viaProxy=false，上层回退 hostTimeZone/hostLocale（OS≈出口）
  return { viaProxy: false };
}

// 把代理配置应用到指定会话（与 guest:setProxy 同逻辑，供 geo 探测复用，确保探测出口 = 网页出口）
async function applyProxyToSession(ses, proxy) {
  try {
    ses.setCertificateVerifyProc(null);
  } catch (_) {}
  const { buildProxyRules } = require("./proxy-parse");
  const { getGateway, needsGateway } = require("./local-proxy");
  if (proxy && proxy.host) {
    // 代理不可达时仍保留其规则，检测不会回退到本机出口。
    const reachable = await isProxyUsable(proxy);
    if (!reachable) {
      await ses
        .setProxy({ proxyRules: buildProxyRules(proxy), proxyBypassRules: "<-loopback>" });
      return { proxyDead: true };
    }
    if (needsGateway(proxy)) {
      const port = await getGateway(proxy);
      await ses
        .setProxy({
          proxyRules: `http://127.0.0.1:${port}`,
          proxyBypassRules: "<-loopback>",
        })
        .catch(() => {});
    } else {
      const rules = buildProxyRules(proxy);
      await ses
        .setProxy({ proxyRules: rules, proxyBypassRules: "<-loopback>" })
        .catch(() => {});
      const user = (proxy.user || "").toString().trim();
      if (user && proxy.type !== "socks5") {
        ses.__tfbProxyCreds = { user, pass: (proxy.pass || "").toString(), host: proxy.host, port: Number(proxy.port) };

      }
    }
  } else {
    await ses
      .setProxy({ proxyRules: "", proxyBypassRules: "<-loopback>" })
      .catch(() => {});
  }
}

// 在指定会话里探测出口 IP 地理（时区/语言）。多端点取「MaxMind 源优先」的时区，
// 与 yalala/whoer 等检测站 GeoIP 同源，避免不同 GeoIP 库对同 IP 时区判定差异导致 Timezone Mismatch。
// 关键：探测走与网页加载「同一个会话(同出口 IP)」，轮换代理下也能让注入时区 = 检测站所见时区。
async function _fetchGeoThrough(ses, timeoutMs, forIp) {
  timeoutMs = timeoutMs || 4000;
  // 仅用 MaxMind-backed 源（whoer/yalala/browserscan 等检测站同源），并行查询后众数投票，
  // 消除单源抖动：此前顺序取「首个成功源」，ip.sb 超时即回落 ipinfo 兜底，致时区在 LA/NY 间横跳 → yalala 报 mismatch。
  // 注意：ipapi.co/json 已被 Cloudflare 拦截(403)、ipwho.is/json 与 api.ip.sb/json 路径失效。
  // 2026-09 实测补充：ip-api.com 免费版「不支持 https」——https 会返回 {"status":"fail","message":"SSL unavailable"}，
  // 必须走 http:// 才有数据；且它的 IP 字段是 query、国家码是 countryCode（camelCase），解析处已做归一。
  // 加它是为了多一个在中国大陆可达的源（前三源在国内常被墙，geo 全失败时才有 hostTimeZone 兜底）。
  // forIp 非空时，把各源 URL 拼上该 IP（用于「代理出口 IP 反查」：用主进程直连查代理真实出口 IP 的地理，
  // 与 whoer 服务端所见是同一 IP，从而时区必然一致）。
  const endpoints = forIp
    ? [
        { url: "https://ipinfo.io/" + forIp + "/json", json: true },
        { url: "https://ipwho.is/" + forIp, json: true },
        { url: "https://api.ip.sb/geoip/" + forIp, json: true },
        { url: "http://ip-api.com/json/" + forIp, json: true },
        { url: "https://www.iplocate.io/api/lookup/" + forIp, json: true },
      ]
    : [
        { url: "https://ipinfo.io/json", json: true },
        { url: "https://ipwho.is/", json: true },
        { url: "https://api.ip.sb/geoip", json: true },
        { url: "http://ip-api.com/json", json: true },
        { url: "https://www.iplocate.io/api/lookup/", json: true }, // 第5源：MaxMind-backed，代理下多一个可达兜底
      ];
  const results = await Promise.all(
    endpoints.map(
      (ep) =>
        new Promise((resolve) => {
          try {
            const req = bindProxyRequestAuthentication(net.request({ url: ep.url, session: ses }), ses);
            let data = "";
            req.on("response", (resp) => {
              resp.on("data", (c) => (data += c));
              resp.on("end", () => {
                try {
                  resolve(ep.json ? JSON.parse(data) : { __raw: data });
                } catch (_) {
                  resolve({ __raw: data });
                }
              });
            });
            req.on("error", (err) => resolve({ error: err.message }));
            if (req.setTimeout)
              req.setTimeout(timeoutMs, () => {
                try {
                  req.abort();
                } catch (_) {}
                resolve({ error: "检测超时（" + timeoutMs + "ms）" });
              });
            req.end();
          } catch (err) {
            resolve({ error: err.message });
          }
        }),
    ),
  );
  const cands = [];
  for (let i = 0; i < results.length; i++) {
    const info = results[i];
    if (info && info.error) continue;
    // ip-api.com 失败时返回 {"status":"fail","message":"..."}（https 免费版即如此），无 IP 数据，须丢弃而非当有效源
    if (info && info.status && info.status !== "success") continue;
    // iplocate.io 用 time_zone 字段（如 "America/Los_Angeles"），归一为通用 timezone 供 resolveGeo 使用
    if (info && info.time_zone && !info.timezone)
      info.timezone = info.time_zone;
    // 各源 IP 字段名不同：ipinfo.io / ipwho.is / ip.sb 用 "ip"，ip-api.com 用 "query"
    let ip = forIp || info.ip || info.query || "";
    if (!ip && info.__raw) {
      const m = (info.__raw || "").match(
        /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/,
      );
      if (m) ip = m[1];
    }
    if (!ip) continue;
    // ⚠️ 实测：所有源的 offset 单位一律是「秒」（ipwho.is timezone.offset=-25200、ip.sb offset=-28800），
    // 统一 /60 转分钟。曾误把 ipwho.is 当「小时」做 *60 → 算出 -1512000 分钟，偏移推导时区彻底失效。
    let offsetMin = null;
    try {
      const t = info.timezone;
      if (/ipwho\.is/.test(endpoints[i].url)) {
        if (t && typeof t === "object" && typeof t.offset === "number")
          offsetMin = Math.round(t.offset / 60);
      } else if (typeof info.offset === "number")
        offsetMin = Math.round(info.offset / 60);
    } catch (_) {}
    // ip-api.com 用 camelCase 的 countryCode（ipinfo/ipwho/ip.sb 用 country_code），统一归一后再交给 resolveGeo
    const geo = resolveGeo(
      Object.assign({}, info, {
        offset: offsetMin,
        country_code: info.country_code || info.countryCode || "",
      }),
    );
    cands.push({
      ip,
      tz: geo.timezone,
      locale: geo.locale,
      country: geo.country,
      utcOffset: geo.utcOffset,
      city: info.city || "",
      region: info.region || "",
      org: info.org || "",
    });
  }
  if (!cands.length)
    return { ok: false, error: "所有检测端点均不可用（可能被网络拦截）" };
  // 众数投票：取出现最多的时区（MaxMind 同源应一致）；无共识则取首个有时区的，优于国家默认 fallback
  const tally = {};
  cands.forEach((c) => {
    if (c.tz) tally[c.tz] = (tally[c.tz] || 0) + 1;
  });
  let bestTz = "",
    bestCnt = 0;
  Object.keys(tally).forEach((t) => {
    if (tally[t] > bestCnt) {
      bestCnt = tally[t];
      bestTz = t;
    }
  });
  const pickC = bestTz
    ? cands.find((c) => c.tz === bestTz)
    : cands.find((c) => c.tz) || cands[0];
  return {
    ok: true,
    ip: pickC.ip,
    country: pickC.country || "",
    timezone: pickC.tz || "",
    utcOffset: pickC.utcOffset,
    locale: pickC.locale,
    city: pickC.city,
    region: pickC.region,
    org: pickC.org,
  };
}

// 从 webview guest 的 partition 反推环境 id（partition 形如 persist:tfb-env-<id>）
function envIdFromPartition(wc) {
  try {
    const part = (wc.session && wc.session.partition) || "";
    const m = part.match(/persist:tfb-env-(.+)$/);
    if (m) return m[1];
  } catch (e) {}
  return null;
}

// 直连（无代理）时检测本机出口 IP 的地理位置，使指纹跟随真实网络所在（如新加坡网络→新加坡时区）
async function checkLocalGeo() {
  const ses = session.fromPartition(
    "tfb-local-geo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
  );
  // 直连探测同样放行证书错误：本机网络若存在 TLS 拦截/证书异常，否则 geo 请求会失败、退化成国家默认时区 → 直连也报时差
  try {
    ses.setCertificateVerifyProc(null);
  } catch (_) {}
  const _pkey = "local";
  const _ck = geoCacheGet(_pkey);
  if (_ck) return _ck;
  const r = await _fetchGeoThrough(ses);
  if (r.ok) geoCacheSet(_pkey, r);
  return r;
}

// 把环境指纹对齐到「出口 IP 真实地理」：有代理走代理出口，无代理走本机直连出口。
// 用户手动指定了 timezone（timezoneManual=true）时优先使用，确保浏览器时区 100% 匹配 whoer 判定的 IP 时区；
// 否则自动对齐到出口 IP 地理时区（地理解析失败则回退国家默认值）。
// 语言：langManual=true 保留用户设定；否则跟随 IP 地理语言。
async function resolveAlignedFingerprint(profile, ses) {
  // 与首屏 fp0 复用同一套「实际出口」判定：代理 geo 失败时若代理本身不可用，
  // 说明会话已回退直连，必须按直连出口对齐，否则两条链路会算出不同时区（首屏 vs 重对齐打架）。
  const geo = await resolveExitGeo(profile, ses, 9000).catch(() => null);
  const hasProxy = !!(profile.proxy && profile.proxy.host);
  const opts = { os: profile.os, fingerprint: profile.fingerprint, country: profile.country };
  // 时区：手动 > geo(真实出口) > 实际走代理→代理国家默认 > 实际直连→本机 OS 时区
  // ⚠️ 关键：配了代理但 geo 未知时，绝不能回退 hostTimeZone()（OS 时区，中国用户=上海），
  // 否则指纹=上海、浏览器走美国代理出口 → whoer 报时差。必须落到「代理国家默认时区」。
  if (profile.timezoneManual && profile.timezone)
    opts.timezone = profile.timezone;
  else if (geo && geo.timezone) opts.timezone = geo.timezone;
  else if (hasProxy)
    opts.timezone =
      TIMEZONES[profile.country] || offsetToTz(profile.country, null) || "";
  else opts.timezone = hostTimeZone();
  // 语言与时区必须来自同一出口（曾有 tz=America/New_York + lang=zh-CN 的矛盾组合）
  if (profile.langManual && profile.language) opts.language = profile.language;
  else if (geo && geo.locale) opts.language = geo.locale;
  else if (hasProxy) opts.language = LOCALES[profile.country] || "en-US";
  else opts.language = hostLocale();
  // ⚠️ 日志必须在语言赋值「之后」打印，否则 lang 恒为 undefined，排查时会被误导
  dbg(
    "ALIGN tz=" +
      opts.timezone +
      " lang=" +
      opts.language +
      " via=" +
      (geo && geo.viaProxy ? "proxy" : geo && geo.timezone ? "geo" : "host") +
      " geoCC=" +
      (geo && geo.country ? geo.country : "-") +
      " hasProxy=" +
      hasProxy,
  );
  if (geo && geo.utcOffset != null) opts.utcOffset = geo.utcOffset;
  const fp = generateFingerprint(profile.seed, opts);
  fp.webrtc = profile.webrtc || "disable";
  return { fingerprint: fp, geo };
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath("userData"), "data"));
  MODE = resolveMode();
  dbg(
    "APP READY mode=" +
      MODE +
      " buildTag=" +
      BUILD_TAG +
      " electron=" +
      process.versions.electron +
      " userData=" +
      app.getPath("userData"),
  );
  applyAutoStart(); // 应用开机自启（首次运行读取安装包勾选标记，之后以本地设置为准）
  trackLaunch(); // 上报 open / 首跑 install / 跨天 daily（fire-and-forget）
  // 诊断：捕获所有 webview guest 的事件
  app.on("web-contents-created", (e, wc) => {
    let t = "";
    try {
      t = wc.getType();
    } catch (_) {}
    if (t === "webview") {
      wc.on("before-input-event",(event,input)=>{
        if(input.type!=="keyDown"||!(input.meta||input.control))return;
        const key=input.key.toLowerCase(),host=wc.hostWebContents;if(!host||host.isDestroyed())return;
        const commands={f:"find",l:"address",y:"history","+":"zoom-in","=":"zoom-in","-":"zoom-out","0":"zoom-reset"};
        if(commands[key]){event.preventDefault();host.send("star:browserCommand",commands[key]);}
        else if(key==="t"){event.preventDefault();host.send(input.shift?"star:browserCommand":"menu:new-tab",input.shift?"restore-tab":undefined);}
        else if(key==="w"&&!input.shift){event.preventDefault();host.send("menu:close-tab");}
      });
      // Use Chromium's certificate validation; failed TLS stays visible in the browser.
      wc.on("did-start-navigation",(details,_url,isInPlace,isMainFrame)=>{if((details.isMainFrame??isMainFrame)&&!(details.isSameDocument??isInPlace)){wc.__starDocumentReady=false;}});
      wc.on("did-navigate",()=>{wc.__starPageEdited=false;});
      wc.on("did-stop-loading",()=>{wc.__starDocumentReady=!!wc.__tfbFpInjected;});
      wc.once("dom-ready",()=>{
        const fingerprint=wc.session.__tfbFp;
        if(fingerprint)prepareGuestFingerprint(wc,fingerprint).catch(error=>dbg("GUEST-FP-READY FAIL id="+wc.id+" "+error.message));
      });
      wc.on("did-finish-load", () => {
        wc.__starDocumentReady=!!wc.__tfbFpInjected;
        try {
          dbg("GUEST-FINISH " + (wc.getURL ? wc.getURL() : ""));
        } catch (_) {}
      });
      wc.on("did-fail-load", (ev) => {
        try {
          dbg(
            "GUEST-FAIL " +
              ev.errorCode +
              " " +
              ev.errorDescription +
              " " +
              ev.validatedURL,
          );
        } catch (_) {}
      });
      wc.on("crashed", () => {
        try {
          dbg("GUEST-CRASH");
        } catch (_) {}
      });
    }
  });
  setAppMenu(MODE);
  if (MODE === "lite") startLite();
  else if (MODE === "changyi") startChangyi();
  else startPro();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 代理鉴权由 app / webContents 的 login 事件触发，Session 没有该事件。
app.on("login", (event, contents, details, authInfo, callback) => {
  if (!authInfo.isProxy || !contents) return;
  const credentials = contents.session.__tfbProxyCreds;
  if (!credentials || credentials.host !== authInfo.host || credentials.port !== authInfo.port) return;
  event.preventDefault();
  if (details.firstAuthAttempt === false) callback();
  else callback(credentials.user, credentials.pass);
});
