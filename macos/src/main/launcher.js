"use strict";
/**
 * 浏览器启动器
 * 流程：
 *  1. 根据 profile.seed 生成稳定指纹
 *  2. 为该环境准备独立 user-data-dir（天然隔离 cookie/localStorage/cache）
 *  3. 生成该环境专属的「指纹伪装扩展」（把指纹参数 + 代理凭据写进 config.js）
 *  4. 用命令行参数启动本地 Chrome / 内置 Chromium 内核，加载扩展
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { applyProtocol } = require("./fingerprint-protocol");
const versionCache = new Map();
function chromeVersion(chrome) {
 const stamp=fs.statSync(chrome).mtimeMs;const cached=versionCache.get(chrome);if(cached?.stamp===stamp)return cached.version;
 const output=execFileSync(chrome,["--version"],{encoding:"utf8",timeout:5000});const version=output.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1];if(!version)throw new Error("无法读取本机 Chrome 内核版本");versionCache.set(chrome,{stamp,version});return version;
}
const { generateFingerprint } = require("./fingerprint");
const { getGateway, needsGateway } = require("./local-proxy");
const { buildProxyRules } = require("./proxy-parse");
const { CdpPipe } = require("./cdp-pipe");
const launchedBrowsers = new Map();

function findChrome() {
  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";
    candidates.push(
      path.join(pf, "Google/Chrome/Application/chrome.exe"),
      path.join(pf86, "Google/Chrome/Application/chrome.exe"),
      path.join(local, "Google/Chrome/Application/chrome.exe"),
      path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
      path.join(pf86, "Microsoft/Edge/Application/msedge.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      path.join(os.homedir(), "Applications/Chromium.app/Contents/MacOS/Chromium"),
      path.join(os.homedir(), "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  return (
    candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    }) || null
  );
}

/** 把指纹伪装扩展模板拷到该环境的独立扩展目录，并写入专属 config.js */
function prepareExtension(baseDir, extTemplateDir, fingerprint, proxy) {
  const extDir = path.join(baseDir, "fp-extension");
  fs.mkdirSync(extDir, { recursive: true });
  for (const f of fs.readdirSync(extTemplateDir)) {
    fs.copyFileSync(path.join(extTemplateDir, f), path.join(extDir, f));
  }
  const config = { fingerprint, proxy: proxy || null };
  const js = "window.__FP_CONFIG__ = " + JSON.stringify(config) + ";";
  fs.writeFileSync(path.join(extDir, "config.js"), js, "utf-8");
  // background 用（service worker 无法读 window，单独存一份 JSON 可 fetch）
  fs.writeFileSync(
    path.join(extDir, "config.json"),
    JSON.stringify(config),
    "utf-8",
  );
  return extDir;
}

/**
 * 启动一个环境
 * @param {object} profile     store 里的环境对象
 * @param {object} paths       { rootDir 存放各环境数据的根目录, extTemplateDir 扩展模板目录 }
 * @param {object} [fingerprint] 可选：已对齐（时区/语言跟随出口 IP 或手动指定）的指纹；缺省按国家默认生成
 */
async function launchProfile(profile, paths, fingerprint) {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      "未找到本地 Chrome/Edge，请先安装（Pro 正式版会内置 Chromium 内核）",
    );
  }
  const version = chromeVersion(chrome);
  const fp = generateFingerprint(profile.seed,{os:profile.os,country:profile.country,fingerprint:profile.fingerprint,chromeVersion:version,timezone:fingerprint?.timezone||profile.timezone,language:fingerprint?.language||profile.language});
  fp.webrtc = profile.webrtc || 'disable';
  const startUrl=profile.startUrl==='about:home'?'chrome://newtab':profile.startUrl||'about:blank';

  const baseDir = path.join(paths.rootDir, profile.id);
  const userDataDir = path.join(baseDir, "user-data");
  fs.mkdirSync(userDataDir, { recursive: true });

  const extDir = prepareExtension(
    baseDir,
    paths.extTemplateDir,
    fp,
    profile.proxy,
  );

  const args = [
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--lang=${fp.language}`,
    `--user-agent=${fp.userAgent}`,
    `--window-size=${fp.screen.width},${fp.screen.height - 100}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,MediaRouter",
    "--force-webrtc-ip-handling-policy=default_public_interface_only",
  ];

  // 代理：Chromium 不支持「带账号密码的 SOCKS5」，凭据会被静默丢弃 -> 走本地无鉴权 HTTP 网关（与内置浏览器同套方案）；
  // HTTP 代理可直接在 --proxy-server 里带凭据；无代理则不传。
  if (profile.proxy && profile.proxy.host) {
    let proxyArg;
    if (needsGateway(profile.proxy)) {
      const port = await getGateway(profile.proxy);
      proxyArg = `http://127.0.0.1:${port}`;
    } else {
      proxyArg = buildProxyRules(profile.proxy);
    }
    args.push(`--proxy-server=${proxyArg}`);
  }

  if (process.env.TFB_TEST_MODE === "1") {
    args.push("--disable-background-networking", "--host-resolver-rules=MAP qa.local 127.0.0.1");
  }
  // macOS 上 --lang 不一定控制 HTTP 请求语言，写入独立环境的语言首选项。
  const preferencesFile = path.join(userDataDir, "Default", "Preferences");
  let preferences = {};
  if (fs.existsSync(preferencesFile)) preferences = JSON.parse(fs.readFileSync(preferencesFile, "utf8"));
  preferences.intl = { ...preferences.intl, accept_languages: fp.languages.join(",") };
  fs.mkdirSync(path.dirname(preferencesFile), { recursive: true });
  fs.writeFileSync(preferencesFile, JSON.stringify(preferences), "utf8");

  const existing = launchedBrowsers.get(profile.id);
  if (existing && !existing.pipe.closed) {
    await existing.pipe.send("Target.createTarget", { url: startUrl });
    return { pid: existing.child.pid, chrome, fingerprint: existing.fingerprint, userDataDir, extensionId: existing.extensionId };
  }
  args.push("about:blank");
  const child = spawn(chrome, args, { detached: true, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
  const pipe = new CdpPipe(child);
  const running = { child, pipe, fingerprint: fp, userDataDir };
  launchedBrowsers.set(profile.id, running);
  child.once("exit", () => { if (launchedBrowsers.get(profile.id) === running) launchedBrowsers.delete(profile.id); });
  try {
    const pageSessions=new Map();running.pageSessions=pageSessions;
    pipe.on('message',message=>{
      if(message.method==='Target.attachedToTarget'&&message.params.targetInfo.type==='page'){
        const {sessionId,targetInfo}=message.params;
        const ready=applyProtocol((method,params)=>pipe.send(method,params,sessionId),fp).then(()=>pipe.send('Runtime.runIfWaitingForDebugger',{},sessionId));
        ready.catch(()=>{});pageSessions.set(targetInfo.targetId,{sessionId,ready});
      }
      if(message.method==='Target.detachedFromTarget')for(const [id,item] of pageSessions)if(item.sessionId===message.params.sessionId)pageSessions.delete(id);
    });
    await pipe.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page'},{exclude:true}]});
    const runtimeVersion=await pipe.send("Browser.getVersion");
    if(!runtimeVersion.product.endsWith("/"+version))throw new Error("本机 Chrome 版本在启动时发生变化，请重试");
    // Chrome 137 起不再接受正式版的 --load-extension；使用官方本地管道 API。
    const extension = await pipe.send("Extensions.loadUnpacked", { path: extDir });
    running.extensionId = extension.id;
    // loadUnpacked 返回时后台 service worker 尚可能未完成启动。
    // 首次代理挑战必须等待监听器注册与凭据读取完成，避免直接进入认证错误页。
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      const info = await pipe.send("Target.getTargets");
      const worker = info.targetInfos.find(target => target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://" + extension.id + "/"));
      if (worker) {
        const attached = await pipe.send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
        const response = await pipe.send("Runtime.evaluate", {
          expression: "typeof configReady === 'undefined' ? false : configReady.then(() => true)",
          awaitPromise: true, returnByValue: true,
        }, attached.sessionId);
        await pipe.send("Target.detachFromTarget", { sessionId: attached.sessionId });
        ready = response.result && response.result.value === true;
      }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error("指纹扩展的代理认证配置未就绪");
    const library=require('./extensions').getExtensionLibrary();
    running.userExtensions=[];
    for(const item of library?.resolve(profile)||[]){
      try{const extension=await pipe.send('Extensions.loadUnpacked',{path:item.directory});running.userExtensions.push({id:item.id,name:item.name,runtimeId:extension.id});}
      catch(error){throw new Error('无法加载 '+item.name+'：'+error.message);}
    }
    const { targetInfos } = await pipe.send("Target.getTargets");
    const target = targetInfos.find(target => target.type === "page");
    if (target) {
      const attached=pageSessions.get(target.targetId);
      if(!attached)throw new Error('浏览标签的配置通道尚未就绪');
      await attached.ready;
      await pipe.send("Page.navigate", { url: startUrl }, attached.sessionId);
    } else await pipe.send("Target.createTarget", { url: startUrl });
    child.unref();
    for (const stream of [child.stderr, child.stdio[3], child.stdio[4]]) if (stream.unref) stream.unref();
    return { pid: child.pid, chrome, fingerprint: fp, userDataDir, extensionId: extension.id };
  } catch (error) {
    child.kill();
    launchedBrowsers.delete(profile.id);
    throw new Error("本机 Chrome 启动或指纹扩展加载失败：" + error.message + (stderr ? "\n" + stderr : ""));
  }

}

module.exports = { launchProfile, findChrome, getLaunchedBrowser: id => launchedBrowsers.get(id), getLaunchedBrowsers: () => [...launchedBrowsers.entries()] };
