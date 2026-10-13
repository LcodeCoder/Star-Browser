"use strict";
// 多标签指纹浏览器外壳：标签管理 + 工具栏 + 设置面板 + 诊断日志
const $ = (id) => document.getElementById(id);
const tabsEl = $("tabs"),
  wrap = $("wrap");
const addr = $("addr"),
  spinner = $("spinner"),
  badge = $("badge");
const panel = $("settings");

let profile = null; // 当前环境 {id,name,mode,fingerprint,proxy,startUrl,homeUrl,preloadURL,...}
let homeUrl = "about:blank";
let navTimer = null; // 当前活动标签的加载超时
let langEdited = false; // 用户在设置里手动改过语言下拉（true=手动锁定语言，不再被代理IP覆盖）
let tzEdited = false; // 用户在设置里手动指定过时区（true=锁定时区，不再被出口IP地理覆盖）

// 诊断日志：转发到主进程写文件
function dbg(msg) {
  try {
    if (window.api && window.api.dbgLog) window.api.dbgLog(msg);
  } catch (e) {}
}
dbg("shell.js loaded, window.api=" + typeof window.api);

// ---------------- 标签数据 ----------------
const tabs = []; // {id, title, web, url}
let activeId = null;
let nextId = 1;
function activeTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

// ---------------- 导航 + 超时保护 ----------------
function disarmNav() {
  if (navTimer) {
    clearTimeout(navTimer);
    navTimer = null;
  }
}
function armNav(u) {
  disarmNav();
  navTimer = setTimeout(() => {
    let disp = u || "";
    try {
      if (disp.startsWith("data:")) disp = "离线起始页";
      else {
        const uu = new URL(disp);
        disp = uu.host || disp;
      }
    } catch (e) {}
    showFatal(
      "连接用时较长，请检查网络或代理后重试。当前地址：" +
        disp,
    );
  }, 30000);
}
function go(u) {
  hideNtp();
  hideFatal();
  const t = activeTab();
  if (!t) return;
  try {
    if(t.web.__starReady){t.web.src=u||"about:blank";}else{t.web.__starPendingURL=u||"about:blank";setupGuestInjection(t.web,t.id);}
    t.url = u || "";
    addr.value=t.url;
    armNav(u);
    updateNavButtons();
  } catch (err) {
    showFatal("导航失败：" + (err.message || err));
  }
}

// ---------------- 致命错误覆盖层 ----------------
function showFatal(msg) {
  const f = $("fatal");
  $("fatalMessage").textContent = msg;
  f.hidden = false;
  dbg("FATAL-SHOWN: " + msg);
}
function hideFatal() {
  $("fatal").hidden = true;
}

// ---------------- toast ----------------
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2000);
}

// ---------------- 设置面板 ----------------
const COUNTRIES = [
  { code: "US", name: "美国 (en-US)" },
  { code: "UK", name: "英国 (en-GB)" },
  { code: "CA", name: "加拿大 (en-CA)" },
  { code: "AU", name: "澳大利亚 (en-AU)" },
  { code: "DE", name: "德国 (de-DE)" },
  { code: "FR", name: "法国 (fr-FR)" },
  { code: "NL", name: "荷兰 (nl-NL)" },
  { code: "ES", name: "西班牙 (es-ES)" },
  { code: "IT", name: "意大利 (it-IT)" },
  { code: "SE", name: "瑞典 (sv-SE)" },
  { code: "PL", name: "波兰 (pl-PL)" },
  { code: "RU", name: "俄罗斯 (ru-RU)" },
  { code: "JP", name: "日本 (ja-JP)" },
  { code: "KR", name: "韩国 (ko-KR)" },
  { code: "SG", name: "新加坡 (en-SG)" },
  { code: "HK", name: "中国香港 (zh-HK)" },
  { code: "TW", name: "中国台湾 (zh-TW)" },
  { code: "IN", name: "印度 (en-IN)" },
  { code: "TH", name: "泰国 (th-TH)" },
  { code: "VN", name: "越南 (vi-VN)" },
  { code: "MY", name: "马来西亚 (ms-MY)" },
  { code: "PH", name: "菲律宾 (en-PH)" },
  { code: "ID", name: "印度尼西亚 (id-ID)" },
  { code: "AE", name: "阿联酋 (ar-AE)" },
  { code: "SA", name: "沙特阿拉伯 (ar-SA)" },
  { code: "TR", name: "土耳其 (tr-TR)" },
  { code: "BR", name: "巴西 (pt-BR)" },
  { code: "MX", name: "墨西哥 (es-MX)" },
  { code: "ZA", name: "南非 (en-ZA)" },
];
function fillCountries() {
  const sel = $("s-country");
  sel.innerHTML = "";
  COUNTRIES.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.code;
    o.textContent = c.name;
    sel.appendChild(o);
  });
}
// 浏览器语言选项（用户可在设置里手动切换；默认跟随代理 IP 所在地语言）
const LANGUAGES = [
  { code: "en-US", name: "英语 (美国)" },
  { code: "en-GB", name: "英语 (英国)" },
  { code: "en-CA", name: "英语 (加拿大)" },
  { code: "en-AU", name: "英语 (澳大利亚)" },
  { code: "de-DE", name: "德语" },
  { code: "fr-FR", name: "法语" },
  { code: "es-ES", name: "西班牙语 (西班牙)" },
  { code: "es-MX", name: "西班牙语 (墨西哥)" },
  { code: "it-IT", name: "意大利语" },
  { code: "pt-BR", name: "葡萄牙语 (巴西)" },
  { code: "nl-NL", name: "荷兰语" },
  { code: "ru-RU", name: "俄语" },
  { code: "ja-JP", name: "日语" },
  { code: "ko-KR", name: "韩语" },
  { code: "zh-CN", name: "中文 (简体)" },
  { code: "zh-TW", name: "中文 (繁体)" },
  { code: "zh-HK", name: "中文 (香港)" },
  { code: "ar-AE", name: "阿拉伯语 (阿联酋)" },
  { code: "ar-SA", name: "阿拉伯语 (沙特)" },
  { code: "tr-TR", name: "土耳其语" },
  { code: "th-TH", name: "泰语" },
  { code: "vi-VN", name: "越南语" },
  { code: "id-ID", name: "印尼语" },
  { code: "ms-MY", name: "马来语" },
  { code: "en-IN", name: "英语 (印度)" },
  { code: "en-SG", name: "英语 (新加坡)" },
  { code: "en-PH", name: "英语 (菲律宾)" },
  { code: "en-ZA", name: "英语 (南非)" },
  { code: "pl-PL", name: "波兰语" },
  { code: "sv-SE", name: "瑞典语" },
];
function fillLanguages() {
  const sel = $("s-language");
  if (!sel) return;
  sel.innerHTML = "";
  LANGUAGES.forEach((l) => {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = l.name;
    sel.appendChild(o);
  });
}
// 时区选项：用于各检测站 GeoIP 库互相冲突时「手动指定」。
// 实测证据（2026-09-08）：同一出口 IP 207.97.174.21，whoer.com 判「新泽西→America/New_York」、
// yalala.com 判「加州→America/Los_Angeles」，二者差 3 个时区，单一时区无法同时满足，只能按目标站点二选一。
const TIMEZONES = [
  // ---- 美国：东部 / 中部 / 山地 / 太平洋 / 阿拉斯加 / 夏威夷 + 无夏令时特区 ----
  { tz: "America/New_York", name: "美国 · 纽约 NY（东部 -04:00）" },
  { tz: "America/Detroit", name: "美国 · 底特律 MI（东部 -04:00）" },
  {
    tz: "America/Indiana/Indianapolis",
    name: "美国 · 印第安纳波利斯 IN（东部 -04:00）",
  },
  {
    tz: "America/Indiana/Marengo",
    name: "美国 · 印第安纳 Marengo（东部 -04:00）",
  },
  {
    tz: "America/Indiana/Vincennes",
    name: "美国 · 印第安纳 Vincennes（东部 -04:00）",
  },
  {
    tz: "America/Indiana/Winamac",
    name: "美国 · 印第安纳 Winamac（东部 -04:00）",
  },
  { tz: "America/Indiana/Knox", name: "美国 · 印第安纳 Knox（中部 -05:00）" },
  {
    tz: "America/Kentucky/Louisville",
    name: "美国 · 路易维尔 KY（东部 -04:00）",
  },
  {
    tz: "America/Kentucky/Monticello",
    name: "美国 · 肯塔基 Monticello（东部 -04:00）",
  },
  { tz: "America/Chicago", name: "美国 · 芝加哥 IL（中部 -05:00）" },
  { tz: "America/Menominee", name: "美国 · Menominee MI（中部 -05:00）" },
  {
    tz: "America/North_Dakota/Center",
    name: "美国 · 北达科他 Center（中部 -05:00）",
  },
  {
    tz: "America/North_Dakota/Beulah",
    name: "美国 · 北达科他 Beulah（中部 -05:00）",
  },
  {
    tz: "America/North_Dakota/New_Salem",
    name: "美国 · 北达科他 New Salem（中部 -05:00）",
  },
  { tz: "America/Denver", name: "美国 · 丹佛 CO（山地 -06:00）" },
  { tz: "America/Boise", name: "美国 · 博伊西 ID（山地 -06:00）" },
  { tz: "America/Phoenix", name: "美国 · 凤凰城 AZ（无夏令时 -07:00）" },
  { tz: "America/Los_Angeles", name: "美国 · 洛杉矶 CA（太平洋 -07:00）" },
  { tz: "America/Anchorage", name: "美国 · 安克雷奇 AK（阿拉斯加 -08:00）" },
  { tz: "Pacific/Honolulu", name: "美国 · 檀香山 HI（夏威夷 -10:00）" },
  { tz: "America/Toronto", name: "加拿大 · 多伦多" },
  { tz: "Europe/London", name: "英国 · 伦敦" },
  { tz: "Europe/Berlin", name: "德国 · 柏林" },
  { tz: "Europe/Paris", name: "法国 · 巴黎" },
  { tz: "Europe/Madrid", name: "西班牙 · 马德里" },
  { tz: "Europe/Rome", name: "意大利 · 罗马" },
  { tz: "Europe/Amsterdam", name: "荷兰 · 阿姆斯特丹" },
  { tz: "Europe/Stockholm", name: "瑞典 · 斯德哥尔摩" },
  { tz: "Europe/Warsaw", name: "波兰 · 华沙" },
  { tz: "Europe/Moscow", name: "俄罗斯 · 莫斯科" },
  { tz: "Europe/Istanbul", name: "土耳其 · 伊斯坦布尔" },
  { tz: "Asia/Tokyo", name: "日本 · 东京" },
  { tz: "Asia/Seoul", name: "韩国 · 首尔" },
  { tz: "Asia/Singapore", name: "新加坡" },
  { tz: "Asia/Hong_Kong", name: "中国香港" },
  { tz: "Asia/Taipei", name: "中国台湾" },
  { tz: "Asia/Shanghai", name: "中国 · 上海" },
  { tz: "Asia/Bangkok", name: "泰国 · 曼谷" },
  { tz: "Asia/Ho_Chi_Minh", name: "越南 · 胡志明" },
  { tz: "Asia/Kuala_Lumpur", name: "马来西亚 · 吉隆坡" },
  { tz: "Asia/Jakarta", name: "印尼 · 雅加达" },
  { tz: "Asia/Manila", name: "菲律宾 · 马尼拉" },
  { tz: "Asia/Kolkata", name: "印度" },
  { tz: "Asia/Dubai", name: "阿联酋 · 迪拜" },
  { tz: "Asia/Riyadh", name: "沙特 · 利雅得" },
  { tz: "Australia/Sydney", name: "澳大利亚 · 悉尼" },
  { tz: "America/Sao_Paulo", name: "巴西 · 圣保罗" },
  { tz: "America/Mexico_City", name: "墨西哥" },
  { tz: "Africa/Johannesburg", name: "南非" },
];
function fillTimezones() {
  const sel = $("s-timezone");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "自动（跟随出口 IP）";
  sel.appendChild(auto);
  TIMEZONES.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.tz;
    o.textContent = t.name;
    sel.appendChild(o);
  });
}
function parseProxy(v) {
  const i = (v || "").lastIndexOf(":");
  return i <= 0
    ? { host: (v || "").trim(), port: "" }
    : { host: v.slice(0, i).trim(), port: v.slice(i + 1).trim() };
}

// 代理粘贴自动解析：把「103.13.214.244:45001:user:pass」等常见格式拆成 4 个字段自动填入
function applyProxyPaste() {
  const box = $("s-paste");
  if (!box) return;
  const raw = box.value.trim();
  if (!raw) {
    toast("请先粘贴代理文本");
    return;
  }
  const parsed=StarSettingsValidation.parseProxyInput(raw,$("s-type").value||"socks5");
  if(!parsed){StarSettings.error("无法解析代理，请使用完整地址和端口，例如 https://账号:密码@host:8080","proxy.host");return;}
  $("s-proxyOn").checked=true;$("s-type").value=parsed.type;
  $("s-host").value=(parsed.host.includes(":")?"["+parsed.host+"]":parsed.host)+":"+parsed.port;
  $("s-user").value=parsed.user;$("s-pass").value=parsed.pass;box.value="";
  StarSettings.proxyPasted();toast("已填入代理配置，保存后应用");
}

$("gear").addEventListener("click", () => panel.hidden ? StarSettings.open() : StarSettings.close());
$("s-close").addEventListener("click", () => StarSettings.close());
$("s-cancel").addEventListener("click", () => StarSettings.close());
$("s-paste-go").addEventListener("click", () => applyProxyPaste());
// 语言下拉：用户手动切换 -> 锁定为手动（不再被代理 IP 覆盖）
$("s-language").addEventListener("change", () => {
  langEdited = true;
});
// 「↺ 跟随代理 IP」：放弃手动语言，重新按出口 IP 对齐时区/语言
$("s-lang-reset").addEventListener("click",()=>StarSettings.resetLanguage());
// 时区下拉：手动选中某个时区 -> 锁定（不再被出口 IP 地理覆盖），用于对齐特定检测站的 GeoIP 库
const tzSel = $("s-timezone");
if (tzSel)
  tzSel.addEventListener("change", () => {
    tzEdited = !!tzSel.value;
  });
// 「↺ 恢复自动」：放弃手动时区，回到跟随出口 IP
$("s-tz-reset").addEventListener("click", () => {
  StarSettings.resetTimezone();
});
function syncPanelFromProfile() {
  if (!profile) return;
  $("s-country").value = profile.country || "US";
  $("s-language").value = profile.langManual?profile.language||"en-US":profile.fingerprint?.language||profile.language||"en-US";
  $("s-version").textContent =
    profile.buildTag || "—";
  langEdited = false;
  // 时区：仅当之前手动锁定过才回填，否则显示「自动」
  if ($("s-timezone"))
    $("s-timezone").value =
      profile.timezoneManual && profile.timezone ? profile.timezone : "";
  tzEdited = false;
  $("s-start").value = profile.configuredStartUrl || (/^https?:/.test(profile.startUrl||"")?profile.startUrl:"about:home");
  const proxy = profile.proxy || {};
  $("s-proxyOn").checked = !!proxy.host;
  $("s-type").value = proxy.type || "socks5";
  $("s-host").value = proxy.host
    ? (proxy.host.includes(":") ? "[" + proxy.host + "]" : proxy.host) + (proxy.port ? ":" + proxy.port : "")
    : "";
  $("s-user").value = proxy.user || "";
  $("s-pass").value = proxy.pass || "";
  $("s-webrtc").value = profile.webrtc || "proxy";
  $("s-regen").checked = false;
  $("s-note").value = profile.note || "";
  $("s-tags").value =
    profile.tags && profile.tags.length ? profile.tags.join(", ") : "";
}
$("s-clear").addEventListener("click", async () => {
  const t = activeTab();
  if (!t || !t.web) {
    toast("当前无可清除的页面");
    return;
  }
  let id = null;
  try {
    id = (t.web.getWebContentsId && t.web.getWebContentsId()) || null;
  } catch (e) {
    id = null;
  }
  if (!id) {
    toast("页面尚未就绪，请稍后再试");
    return;
  }
  try {
    const r = await window.api.clearGuestStorage(id);
    if (r && r.ok) toast("已清除 Cookie 与缓存");
    else toast("清除失败：" + ((r && r.error) || "未知错误"));
  } catch (e) {
    toast("清除失败：" + (e.message || e));
  }
});
$("s-save").addEventListener("click", async () => {
  const draft=StarSettings.beginSave();if(!draft)return;
  const {langManual}=draft;
  try {
    const np = await window.api.browseSave(draft);
    if (!np) throw new Error("环境已关闭，请重新打开后再保存");
    if (np) {
      profile = np;
      homeUrl = np.homeUrl || homeUrl;
      StarBrowser.init({...np,preferences:profile.preferences});
      rebuildAllTabs();
      StarSettings.close(true);
      langEdited = false;
      toast("已应用新配置到所有标签");
      // 配了代理：顺手把时区/语言对齐到出口 IP（用户已手动设语言则只对齐时区）
      if (np.proxy && np.proxy.host) {
        try {
          const r = await window.api.syncGeo({ overrideLang: !langManual });
          if (r && r.ok && r.changed && r.payload) {
            profile = r.payload;
            rebuildAllTabs();
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    StarSettings.error(err.message || String(err));
  }finally{StarSettings.endSave();}
});

// ---------------- 社媒快捷启动台 ----------------
const launcher = $("launcher");

// ---------------- 快捷启动台：在线配置 + 内置默认 ----------------
// 内容结构：{ groups:[{title, items:[{name,url}]}], ads:[{name,url}] }
// 优先取服务端 JSON（见 main.js 的 LAUNCHER_CONFIG_URL），取不到时回落下面的内置默认，
// 保证离线可用；上线后改 JSON 即可增删站点 / 广告，无需重新发版。
const DEFAULT_LAUNCHER = {groups:[{title:"检测与工具",items:[{name:"BrowserLeaks",url:"https://browserleaks.com"},{name:"Google",url:"https://www.google.com"}]}]};

function renderLauncher(cfg) {
  const body = $("launcher-body");
  if (!body) return;
  const c = cfg || DEFAULT_LAUNCHER;
  body.innerHTML = "";
  (c.groups || []).forEach((g) => {
    if (g.title) {
      const sep = document.createElement("div");
      sep.className = "launcher-sep";
      sep.innerHTML = "<span></span>";
      sep.querySelector("span").textContent = g.title;
      body.appendChild(sep);
    }
    const grid = document.createElement("div");
    grid.className = "plat-grid";
    (g.items || []).forEach((it) => {
      if (!it || !it.url) return;
      const b = document.createElement("button");
      b.className = "plat";
      b.dataset.url = it.url;
      b.textContent = it.name || it.url;
      grid.appendChild(b);
    });
    body.appendChild(grid);
  });
  // 广告位：同样由在线配置控制，可随时更换文案与链接
  if ((c.ads || []).length) {
    const sep = document.createElement("div");
    sep.className = "launcher-sep";
    sep.innerHTML = "<span>服务与支持</span>";
    body.appendChild(sep);
    const grid = document.createElement("div");
    grid.className = "plat-grid";
    (c.ads || []).forEach((ad) => {
      if (!ad || !ad.url) return;
      const b = document.createElement("button");
      b.className = "plat";
      b.dataset.url = ad.url;
      b.textContent = ad.name || ad.url;
      grid.appendChild(b);
    });
    body.appendChild(grid);
  }
}

// 统一云端清单加载：先渲染内置默认（保证立刻可用），再拉远端 manifest 应用，并每 5 分钟轮询一次。
// manifest 字段：groups(启动台分组) / ads(广告位) / bookmarks(官方收藏) / version(升级提醒)。
async function loadManifest() {
  renderLauncher(DEFAULT_LAUNCHER);
  try {
    if (!window.api || !window.api.launcherConfig) return;
    const r = await window.api.launcherConfig();
    const cfg = r && r.ok && r.config ? r.config : null;
    if (!cfg) {
      dbg(
        "manifest fallback to default (fromCache=" + (r && r.fromCache) + ")",
      );
      return;
    }
    renderLauncher(cfg);
    // 官方收藏夹（云端托管）：按 id 合并，不覆盖用户自加；随后刷新书签栏 / NTP
    if (Array.isArray(cfg.bookmarks) && window.api.bookmarksMergeCloud) {
      try {
        await window.api.bookmarksMergeCloud(cfg.bookmarks);
        await refreshBookmarks();
        await renderNtp();
      } catch (e) {
        dbg("mergeCloud err " + (e.message || e));
      }
    }
    // NTP / 工作台首页广告位
    renderAdsToNtp(cfg.ads);
    // 常用网址（commonUrls，云端改 JSON 即换，无需发版）
    renderCommonUrls(cfg.commonUrls);
    // 在线公告弹窗（announcements，按 id 不重复弹）
    if (Array.isArray(cfg.announcements)) {
      cfg.announcements.forEach((a) => {
        try {
          showAnnouncement(a);
        } catch (e) {
          dbg("announce err " + (e.message || e));
        }
      });
    }
    // 版本升级提醒
    checkVersion(cfg);
    dbg("manifest loaded fromCache=" + r.fromCache);
  } catch (e) {
    dbg("manifest error: " + (e.message || e));
  }
}
renderLauncher(DEFAULT_LAUNCHER);

// NTP / 工作台首页广告位（读 manifest.ads，云端改 JSON 即换，无需发版）
function renderAdsToNtp(ads) {
  const box = $("ntpAds");
  if (!box) return;
  box.innerHTML = "";
  if (!Array.isArray(ads) || !ads.length) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";
  const title = document.createElement("div");
  title.className = "ntp-section-title";
  title.textContent = "推荐服务";
  box.appendChild(title);
  const grid = document.createElement("div");
  grid.className = "ntp-tiles";
  ads.forEach((ad) => {
    if (!ad || !ad.url) return;
    const tile = document.createElement("div");
    tile.className = "ntp-tile";
    tile.title = ad.name || ad.url;
    const img = document.createElement("img");
    img.className = "ntp-fav";
    img.alt = "";
    img.src = ad.image || faviconFor(ad.url);
    img.addEventListener("error", () => {
      try {
        img.replaceWith(letterAvatar(ad.name || ad.url));
      } catch (_) {}
    });
    const span = document.createElement("span");
    span.className = "ntp-label";
    span.textContent = ad.name || ad.url;
    tile.appendChild(img);
    tile.appendChild(span);
    tile.addEventListener("click", () => {
      try {
        window.api.openExternal(ad.url);
      } catch (_) {}
    });
    grid.appendChild(tile);
  });
  if (grid.children.length) box.appendChild(grid);
}

// NTP 常用网址（读 manifest.commonUrls，云端改 JSON 即换，无需发版）
function renderCommonUrls(list) {
  const box = $("ntpCommon");
  if (!box) return;
  box.innerHTML = "";
  if (!Array.isArray(list) || !list.length) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";
  list.forEach((it) => {
    if (!it || !it.url) return;
    const tile = document.createElement("div");
    tile.className = "ntp-tile";
    tile.title = it.name || it.url;
    const img = document.createElement("img");
    img.className = "ntp-fav";
    img.alt = "";
    img.src = faviconFor(it.url);
    img.addEventListener("error", () => {
      try {
        img.replaceWith(letterAvatar(it.name || it.url));
      } catch (_) {}
    });
    const span = document.createElement("span");
    span.className = "ntp-label";
    span.textContent = it.name || it.url;
    tile.appendChild(img);
    tile.appendChild(span);
    tile.addEventListener("click", () => {
      try {
        window.api.openExternal(it.url);
      } catch (_) {}
    });
    box.appendChild(tile);
  });
}

// ---------------- 在线公告弹窗（announcements 配置驱动；本页 loadManifest 调用） ----------------
const announceModal = $("announceModal");
const announceSeenKey = "tfb_announce_seen";
function getSeenAnnounce() {
  try {
    return JSON.parse(localStorage.getItem(announceSeenKey) || "[]");
  } catch (_) {
    return [];
  }
}
function markAnnounceSeen(id) {
  try {
    const a = getSeenAnnounce();
    if (a.indexOf(id) < 0) {
      a.push(id);
      localStorage.setItem(announceSeenKey, JSON.stringify(a));
    }
  } catch (_) {}
}
function showAnnouncement(a) {
  if (!announceModal || !a || !a.id) return;
  const seen = getSeenAnnounce();
  if (seen.indexOf(a.id) >= 0) return; // 同一公告只弹一次
  const title = $("announceTitle");
  if (title) title.textContent = a.title || "公告";
  const body = $("announceBody");
  if (body) body.textContent = a.content || "";
  const link = $("announceLink");
  if (link) {
    if (a.url) {
      link.href = a.url;
      link.hidden = false;
      link.textContent = a.urlText || "查看详情";
    } else {
      link.hidden = true;
    }
  }
  announceModal.hidden = false;
  markAnnounceSeen(a.id); // 弹出即标记已读（关闭/点击都在 seen 列表，不再重复弹）
}
if (announceModal) {
  $("announceClose").onclick = () => {
    announceModal.hidden = true;
  };
  announceModal.addEventListener("click", (e) => {
    if (e.target === announceModal) announceModal.hidden = true;
  });
}

// 版本升级提醒：比对本机 BUILD_TAG 与 manifest.version；minRequired 高于本机则强制升级（无「稍后」）。
let _updateShownFor = null;
function checkVersion(cfg) {
  if (!cfg || !cfg.version) return;
  const local = window.api && window.api.version ? window.api.version() : "";
  if (!local || cfg.version === local) return; // 已是最新
  if (_updateShownFor === cfg.version) return; // 同一版本只提示一次
  const forced = !!cfg.minRequired && cfg.minRequired !== local;
  showUpdateBar(cfg, forced);
  _updateShownFor = cfg.version;
}
function showUpdateBar(cfg, forced) {
  const bar = $("updateBar");
  if (!bar) return;
  $("updateText").textContent =
    "发现新版本 " +
    cfg.version +
    (cfg.releaseNotes ? "：" + cfg.releaseNotes : "");
  $("updateDownload").onclick = () => {
    try {
      window.api.openExternal(cfg.downloadUrl || "https://osdwan.com/changyi/");
    } catch (_) {}
  };
  const closeBtn = $("updateClose");
  if (forced) {
    closeBtn.style.display = "none";
    bar.classList.add("forced");
  } else {
    closeBtn.style.display = "";
    bar.classList.remove("forced");
    closeBtn.onclick = () => {
      bar.hidden = true;
    };
  }
  bar.hidden = false;
}

// ---------------- 批量代理检测 ----------------
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
// 显示网络环境提示条（白名单代理回退直连、出口与预设地区不符时由主进程触发）
function showGeoWarn(info) {
  const el = $("geoWarn");
  const txt = $("geoWarnText");
  const x = $("geoWarnClose");
  if (!el || !txt) return;
  const exp = esc(info && info.expected ? info.expected : "?");
  const act = esc(info && info.actual ? info.actual : "?");
  txt.innerHTML =
    "⚠️ 网络环境提示：当前出口网络识别为 <b>" +
    act +
    "</b>，但本环境设定地区为 <b>" +
    exp +
    "</b>。" +
    "若为白名单代理（如 osdwan），可能是该站点未被代理覆盖而回退直连，建议确认代理是否生效，或在设置里「检测代理」重新对齐时区 / 语言。";
  el.hidden = false;
  if (x && !x._bound) {
    x._bound = true;
    x.addEventListener("click", () => {
      try {
        el.hidden = true;
      } catch (_) {}
    });
  }
}
$("launchBtn").addEventListener("click", () => {
  panel.hidden = true;
  launcher.hidden = !launcher.hidden;
});
$("launcher-close").addEventListener("click", () => {
  launcher.hidden = true;
});
launcher.addEventListener("click", (e) => {
  const btn = e.target.closest(".plat");
  if (!btn) return;
  const u = btn.dataset.url;
  if (!u) return;
  launcher.hidden = true;
  createTab(u); // 在新标签打开，多平台可同屏并排
  toast("已在新标签打开：" + btn.textContent);
});

// ---------------- 收藏夹 ----------------
$("bmBtn").addEventListener("click", () => {
  if (!panel.hidden && !StarSettings.close()) return;
  $("launcher").hidden = true;
  StarNetwork.close(false);
  const bp = $("bmPanel");
  bp.hidden = !bp.hidden;
  if (!bp.hidden) renderBookmarks();
});
$("bm-close").addEventListener("click", () => {
  $("bmPanel").hidden = true;
});
$("bm-add-current").addEventListener("click", async () => {
  const t = activeTab();
  let url = "",
    title = "";
  try {
    if (t && t.web) {
      url = t.web.getURL();
      title = t.web.getTitle();
    }
  } catch (e) {}
  if (!url || url === "about:blank" || url.startsWith("data:")) {
    toast("当前页面无可收藏地址");
    return;
  }
  const saved = await addPageBookmark(title, url);
  if (saved) { renderBookmarks(); openStarPop(saved); }
});

async function renderBookmarks() {
  const list = (await window.api.bookmarksList()) || [];
  const box = $("bm-list");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML =
      '<div class="hint">暂无收藏，点上方「＋ 收藏当前页」添加。</div>';
    return;
  }
  list.forEach((b) => {
    const row = document.createElement("div");
    row.className = "bm-item";
    const a = document.createElement("a");
    a.className = "bm-link";
    a.textContent = b.title || b.url;
    a.title = b.url;
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openBookmark(b.url);
    });
    const u = document.createElement("span");
    u.className = "bm-url";
    u.textContent = b.url;
    const del = document.createElement("button");
    del.className = "btn ghost bm-del";
    del.textContent = "✕";
    del.title = "删除";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await window.api.bookmarksRemove(b.id);
      if (ok) renderBookmarks();
    });
    row.appendChild(a);
    row.appendChild(u);
    row.appendChild(del);
    box.appendChild(row);
  });
}

// ---------------- Chrome 式收藏体验：书签栏 + 星标 + 新标签页 NTP ----------------

// Render a local site monogram; the browser shell never sends visited hosts
// to an external favicon service outside the profile's network session.
function faviconFor(url) {
  let host='';try{host=new URL(url).hostname.replace(/^www\./,'');}catch{}
  const initial=(host.replace(/[^a-z0-9]/gi,'').charAt(0)||'S').toUpperCase();
  let hash=0;for(const ch of host)hash=(hash*31+ch.charCodeAt(0))>>>0;
  const colors=[['#e8f0fe','#1967d2'],['#e6f4ea','#137333'],['#fef7e0','#8d6500'],['#fce8e6','#b3261e'],['#f3e8fd','#762bb5']];
  const [bg,fg]=colors[hash%colors.length];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="'+bg+'"/><text x="20" y="27" text-anchor="middle" fill="'+fg+'" font-family="Arial,sans-serif" font-size="21" font-weight="600">'+initial+'</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
function letterAvatar(text) {
  const s = document.createElement("span");
  s.className = "bm-fav bm-letter";
  s.textContent = (text || "?").trim().charAt(0).toUpperCase();
  return s;
}
function normHost(u) {
  try {
    return new URL(u).host;
  } catch (e) {
    return u || "";
  }
}
function sameUrl(a, b) {
  try {
    const ca = new URL(a),
      cb = new URL(b);
    return (
      (ca.origin + ca.pathname).replace(/\/$/, "") ===
      (cb.origin + cb.pathname).replace(/\/$/, "")
    );
  } catch (e) {
    return a === b;
  }
}

let bmCache = [];
async function refreshBookmarks() {
  try {
    bmCache = (await window.api.bookmarksList()) || [];
  } catch (e) {
    bmCache = [];
  }
  renderBookmarkBar();
  updateStarState();
}

// ---- 书签栏（常驻地址栏下方） ----
function renderBookmarkBar() {
  const box = $("bmBarItems");
  if (!box) return;
  box.innerHTML = "";
  bmCache.forEach((b) => {
    const item = document.createElement("div");
    item.className = "bm-bar-item";
    item.title = (b.title || b.url) + "\n" + b.url;
    item.dataset.url = b.url;
    const img = document.createElement("img");
    img.className = "bm-fav";
    img.alt = "";
    img.src = faviconFor(b.url);
    img.addEventListener("error", () => {
      try {
        img.replaceWith(letterAvatar(b.title || b.url));
      } catch (_) {}
    });
    const label = document.createElement("span");
    label.className = "bm-bar-label";
    label.textContent = b.title || b.url;
    item.appendChild(img);
    item.appendChild(label);
    item.addEventListener("click", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        openBookmarkUrl(b.url, true);
      } else openBookmarkUrl(b.url, false);
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showBmContextMenu(e, b);
    });
    box.appendChild(item);
  });
}
function openBookmarkUrl(url, newTab) {
  $("bmPanel").hidden = true;
  if (newTab) createTab(url);
  else {
    hideNtp();
    go(url);
  }
}
function showBmContextMenu(e, b) {
  removeCtxMenu();
  const m = document.createElement("div");
  m.className = "ctx-menu";
  m.innerHTML =
    '<div class="ctx-item" data-act="open">打开</div>' +
    '<div class="ctx-item" data-act="newtab">在新标签页打开</div>' +
    '<div class="ctx-item danger" data-act="delete">删除</div>';
  m.style.left = e.clientX + "px";
  m.style.top = e.clientY + "px";
  document.body.appendChild(m);
  m.addEventListener("click", async (ev) => {
    const act = ev.target.dataset.act;
    if (act === "open") openBookmarkUrl(b.url, false);
    else if (act === "newtab") openBookmarkUrl(b.url, true);
    else if (act === "delete") {
      await window.api.bookmarksRemove(b.id);
      await refreshBookmarks();
    }
    removeCtxMenu();
  });
  setTimeout(
    () => document.addEventListener("click", removeCtxMenu, { once: true }),
    0,
  );
}
function removeCtxMenu() {
  const m = document.querySelector(".ctx-menu");
  if (m) m.remove();
}

function openBookmark(u) {
  $("bmPanel").hidden = true;
  openBookmarkUrl(u, false);
}

// ---- 星标按钮（收藏 / 取消当前页） ----
async function updateStarState() {
  const star = $("starBtn");
  if (!star) return;
  const t = activeTab();
  if (!t) return;
  let url = "";
  try {
    if (t.web) url = t.web.getURL();
  } catch (e) {}
  if (!url || url === "about:blank" || url.startsWith("data:")) {
    star.textContent = "☆";
    star.classList.remove("on");
    star.dataset.url = "";
    return;
  }
  const inBm = bmCache.some((b) => sameUrl(b.url, url));
  star.textContent = inBm ? "★" : "☆";
  star.classList.toggle("on", inBm);
  star.dataset.url = url;
}
$("starBtn").addEventListener("click", async () => {
  const t = activeTab();
  if (!t) return;
  let url = "",
    title = "";
  try {
    if (t.web) {
      url = t.web.getURL();
      title = t.web.getTitle();
    }
  } catch (e) {}
  if (!url || url === "about:blank" || url.startsWith("data:")) {
    toast("当前页面无可收藏地址");
    return;
  }
  const existing = bmCache.find((b) => sameUrl(b.url, url));
  if (existing) {
    openStarPop(existing);
  } else {
    const saved = await addPageBookmark(title, url);
    if (saved) openStarPop(saved);
  }
});
function bookmarkError(error) {
  return String(error?.message || error || "书签操作失败").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
let bookmarkCreatePending = null;
async function addPageBookmark(title, url) {
  if (bookmarkCreatePending) return bookmarkCreatePending;
  const name = String(title || url).trim().slice(0, 512).replace(/[\uD800-\uDBFF]$/, "") || url;
  $("starBtn").disabled = true;
  bookmarkCreatePending = (async () => {
    try {
      const saved = await window.api.bookmarksAdd({ title: name, url });
      if (!saved?.id) throw new Error("书签保存失败，请重试");
      await refreshBookmarks(); toast("书签已添加"); return saved;
    } catch (error) { toast(bookmarkError(error)); return null; }
  })();
  try { return await bookmarkCreatePending; }
  finally { bookmarkCreatePending = null; $("starBtn").disabled = false; }
}
let starInitial = null, starBusy = false, starPreviousFocus = null;
function setStarError(error) {
  const message = $("starError"); message.textContent = error ? bookmarkError(error) : ""; message.hidden = !error;
  for (const [field, id] of [["title", "starTitle"], ["url", "starUrl"]]) {
    const input = $(id); input.removeAttribute("aria-invalid"); input.removeAttribute("aria-describedby");
    if (error?.field === field) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", "starError"); input.focus(); }
  }
}
function setStarBusy(busy) {
  starBusy = busy; $("starFields").disabled = busy;
  for (const id of ["starDone", "starCancel", "starRemove", "starContinue", "starAbandon"]) $(id).disabled = busy;
  $("starDone").textContent = busy ? "保存中…" : "保存";
  $("starPop").setAttribute("aria-busy", String(busy));
}
function showStarDiscard(show) { $("starDiscard").hidden = !show; $("starActions").hidden = show; }
function requestStarClose(force = false, restoreFocus = true) {
  if (starBusy || $("starPop").hidden) return;
  if (!force && starInitial && (starInitial.title !== $("starTitle").value || starInitial.url !== $("starUrl").value)) {
    starPreviousFocus = document.activeElement; showStarDiscard(true); $("starContinue").focus(); return;
  }
  $("starPop").hidden = true; if (restoreFocus) $("starBtn").focus();
}
function positionStarPopover() {
  const pop = $("starPop"); if (pop.hidden) return;
  const anchor = $("starBtn").getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(anchor.left, innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(anchor.bottom + 4, innerHeight - pop.offsetHeight - 8)) + "px";
}
window.addEventListener("resize", () => requestAnimationFrame(positionStarPopover));
function openStarPop(b) {
  const pop = $("starPop"); if (!pop || starBusy) return;
  if (!pop.hidden && starInitial && (starInitial.title !== $("starTitle").value || starInitial.url !== $("starUrl").value)) { requestStarClose(); return; }
  $("starTitle").value = b.title || ""; $("starUrl").value = b.url || ""; $("starRemove").dataset.id = b.id;
  starInitial = {title: $("starTitle").value, url: $("starUrl").value};
  setStarError(null); setStarBusy(false); showStarDiscard(false); pop.hidden = false;
  positionStarPopover();
  $("starTitle").focus(); $("starTitle").select();
}
$("starForm").addEventListener("submit", async event => {
  event.preventDefault(); if (starBusy) return;
  const id = $("starRemove").dataset.id; if (!id) return;
  showStarDiscard(false); setStarError(null);
  let value;
  try { value = StarBookmarkValidation.validateBookmark({title: $("starTitle").value, url: $("starUrl").value}); }
  catch (error) { setStarError(error); return; }
  setStarBusy(true);
  try {
    const saved = await window.api.bookmarksUpdate(id, value);
    if (!saved) throw new Error("这个书签已被删除，请重新添加");
    await refreshBookmarks(); setStarBusy(false); requestStarClose(true); toast("书签已保存");
  } catch (error) { setStarError(error); }
  finally { setStarBusy(false); }
});
$("starRemove").addEventListener("click", async () => {
  if (starBusy) return;
  const id = $("starRemove").dataset.id; if (!id) return;
  setStarError(null); setStarBusy(true);
  try { await window.api.bookmarksRemove(id); await refreshBookmarks(); setStarBusy(false); requestStarClose(true); toast("书签已删除"); }
  catch (error) { setStarError(error); }
  finally { setStarBusy(false); }
});
$("starCancel").addEventListener("click", () => requestStarClose());
$("starAbandon").addEventListener("click", () => requestStarClose(true));
$("starContinue").addEventListener("click", () => { showStarDiscard(false); if (starPreviousFocus?.isConnected && $("starPop").contains(starPreviousFocus)) starPreviousFocus.focus(); else $("starTitle").focus(); });
for (const id of ["starTitle", "starUrl"]) $(id).addEventListener("input", () => { setStarError(null); showStarDiscard(false); });
$("starPop").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestStarClose(); }
  else if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.isComposing) { event.preventDefault(); if (!starBusy) $("starForm").requestSubmit(); }
});
document.addEventListener("click", event => { const pop = $("starPop"); if (!pop.hidden && !pop.contains(event.target) && !$("starBtn").contains(event.target)) requestStarClose(false, false); });

// ---- 书签栏显隐（Ctrl+Shift+B，记忆到 localStorage） ----
function applyBmBarVisibility() {
  const bar = $("bmBar");
  if (!bar) return;
  const show = localStorage.getItem("tfb_bmbar") !== "0";
  bar.style.display = show ? "flex" : "none";
}
function toggleBmBar() {
  const bar = $("bmBar");
  if (!bar) return;
  const show = bar.style.display !== "none";
  localStorage.setItem("tfb_bmbar", show ? "0" : "1");
  applyBmBarVisibility();
  toast(show ? "已隐藏书签栏（Ctrl+Shift+B 恢复）" : "已显示书签栏");
}

// ---- 新标签页 NTP（常用收藏 + 最常访问，自动适应用户习惯） ----
function showNtp() {
  const t = activeTab();
  if (!t) return;
  $("ntp").hidden = false;
  t.ntp = true;
  addr.value = "";
  try {
    $("ntpSearch").value = "";
  } catch (_) {}
  renderNtp();
}
function hideNtp() {
  $("ntp").hidden = true;
  const t = activeTab();
  if (t) t.ntp = false;
}
async function renderNtp() {
  const bmBox = $("ntpBookmarks");
  if (bmBox) bmBox.innerHTML = "";
  const used = new Set();
  bmCache.slice(0, 12).forEach((b) => {
    used.add(normHost(b.url));
    if (bmBox)
      bmBox.appendChild(
        ntpTile(b.title || b.url, b.url, () => openBookmarkUrl(b.url, false)),
      );
  });
  if (!bmCache.length && bmBox)
    bmBox.innerHTML =
      '<div class="ntp-empty">还没有收藏，点地址栏 ☆ 即可收藏常用网站</div>';
  try {
    const visits = profile ? (await window.api.historyTop(profile.id,8)) || [] : [];
    const vBox = $("ntpVisits");
    if (vBox) vBox.innerHTML = "";
    visits
      .filter((v) => !used.has(normHost(v.url)))
      .forEach((v) => {
        if (vBox)
          vBox.appendChild(
            ntpTile(v.title || v.url, v.url, () => {
              hideNtp();
              go(v.url);
              recordVisitFromUrl(v.url, v.title);
            }),
          );
      });
    if (vBox && !vBox.children.length)
      vBox.innerHTML =
        '<div class="ntp-empty">还没有访问记录，多用浏览器就会自动出现在这里</div>';
  } catch (e) {}
}
function ntpTile(title, url, onClick) {
  const tile = document.createElement("button");
  tile.className = "ntp-tile";
  tile.title = url;
  const img = document.createElement("img");
  img.className = "ntp-fav";
  img.alt = "";
  img.src = faviconFor(url);
  img.addEventListener("error", () => {
    try {
      img.replaceWith(letterAvatar(title));
    } catch (_) {}
  });
  const span = document.createElement("span");
  span.className = "ntp-label";
  span.textContent = title;
  tile.appendChild(img);
  tile.appendChild(span);
  tile.addEventListener("click", onClick);
  return tile;
}
async function recordVisitFromUrl(url, title) {
  if (!/^https?:\/\//i.test(url || "")) return;
  try {
    await window.api.visitsRecord(url, title || "");
  } catch (e) {}
}
// 页面稳定后：刷新星标状态 + 记录「最常访问」（驱动 New Tab 快捷入口）
function onPageSettled(tabId, w) {
  if (activeId !== tabId) return;
  try {
    updateStarState();
  } catch (e) {}
  try {
    const u = w && w.getURL ? w.getURL() : "";
    if (/^https?:\/\//i.test(u)) {
      const t = tabs.find((x) => x.id === tabId);
      recordVisitFromUrl(u, t ? t.title : "");
    }
  } catch (e) {}
}
if ($("ntpSearch"))
  $("ntpSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    StarBrowser.navigate($("ntpSearch").value);
  });

// ---------------- 代理出口 IP 自检 ----------------
$("s-check").addEventListener("click", () => StarSettings.checkProxy());

// ---------------- Cookie 备份 / 恢复 ----------------
$("s-cookie-out").addEventListener("click", async () => {
  if (!profile) return;
  try {
    const r = await window.api.cookieExport(profile.id || "lite");
    if (r && r.canceled) return;
    if (r && r.ok) toast("已备份 " + r.count + " 条 Cookie");
    else toast("备份失败：" + ((r && r.error) || "未知"));
  } catch (err) {
    toast("备份异常：" + (err.message || err));
  }
});
$("s-cookie-in").addEventListener("click", async () => {
  if (!profile) return;
  try {
    const r = await window.api.cookieImport(profile.id || "lite");
    if (r && r.canceled) return;
    if (r && r.ok)
      toast(
        "已恢复 " +
          r.okCount +
          " 条 Cookie" +
          (r.failCount ? "，" + r.failCount + " 条失败" : ""),
      );
    else toast("恢复失败：" + ((r && r.error) || "未知"));
  } catch (err) {
    toast("恢复异常：" + (err.message || err));
  }
});

// ---------------- 构建单个 webview（每个标签一个） ----------------
// 在 webview 上挂代理 / 注入指纹 / 注册弹窗拦截。did-attach 时 getWebContentsId() 可能因
// webview 尚未 dom-ready 而抛 "The WebView must be attached to the DOM and the dom-ready event
// emitted before this method can be called" —— 包进 try/catch 并在 dom-ready 后重试，彻底消除该报错。
// （早期「文档开头」注入由主进程 web-contents-created 路径完成，这里只是 late 兜底，晚一点也安全。）
async function setupGuestInjection(w, tabId) {
  if(w.__starSetupPending||w.__tfbGuestSet)return;
  let id;
  try{id=w.getWebContentsId();}catch{}
  if(!id)return; // The initial local document's dom-ready event retries this.
  w.__starSetupPending=true;
  try{
    const config=w.__starProfile;
    if(config?.fingerprint)await window.api.injectFingerprint(id,config.fingerprint);
    if(config)await window.api.setGuestProxy(id,config.proxy||{},config.fingerprint?.language);
    await window.api.setGuestPopHandler(id);
    if(!w.isConnected)return;
    w.__tfbGuestSet=true;w.__starReady=true;StarTabs.ready(w,tabId);
    if(w.__starPendingURL){const url=w.__starPendingURL;delete w.__starPendingURL;w.src=url;}else await window.api.guestReady(id);
  }catch(error){
    if(w.isConnected&&activeId===tabId)showFatal("环境准备失败："+(error.message||error)+"。请重新打开此环境。");
    dbg("guest setup failed tab="+tabId+" "+(error.message||error));
  }finally{w.__starSetupPending=false;}
}
function makeWebview(tabId) {
  const w = document.createElement("webview");
  w.__starProfile=profile;w.__starReady=!profile?.fingerprint;
  w.src="about:blank";
  w.addEventListener("dom-ready",()=>setupGuestInjection(w,tabId));
  StarBrowser.guest(w,tabId);
  // 允许 guest 页发起新窗口（target=_blank / window.open），否则链接会被静默拦截、既不弹窗也不触发 new-window。
  // 真正「新标签页而非新窗口」的效果由下方 new-window 处理器 e.preventDefault() + createTab 实现。
  w.setAttribute("allowpopups", "");
  // 分区：同一环境的所有标签共享 Cookie/缓存（登录态跨标签、跨重开保留）
  w.setAttribute(
    "partition",
    "persist:tfb-env-" + (profile && profile.id ? profile.id : "lite"),
  );
  // CDP sets UA and Client Hints together before the first remote navigation.
  // A webview useragent attribute suppresses Chromium Client Hints request headers.
  if (profile && profile.preloadURL)
    w.setAttribute("preload", profile.preloadURL);

  w.addEventListener("did-attach", () => {
    dbg("webview did-attach tab=" + tabId);
    setupGuestInjection(w, tabId);
  });
  w.addEventListener("did-start-loading", () => {
    setTabLoading(tabId,true);
  });
  // 服务器一回包（主文档响应开始）即取消超时——这是最早可靠的「站点可达」信号，
  // 彻底避免对慢加载但可访问的站点（如 osdwan）误报超时。
  w.addEventListener("did-get-response-details", () => {
    disarmNav();
  });
  // 主文档加载完成（必触发，早于 did-stop-loading）即取消超时，避免对可访问站点误报
  w.addEventListener("did-finish-load", () => {
    setTabLoading(tabId,false);
    disarmNav();
    updateNavButtons();
    refreshTitle(tabId);
    onPageSettled(tabId, w);
    StarBrowser.settled(tabId,w);
  });
  w.addEventListener("did-stop-loading", () => {
    setTabLoading(tabId,false);
    disarmNav();
    updateNavButtons();
    refreshTitle(tabId);
  });
  w.addEventListener("did-fail-load", (e) => {
    dbg(
      "did-fail-load tab=" +
        tabId +
        " main=" +
        e.isMainFrame +
        " code=" +
        e.errorCode +
        " desc=" +
        e.errorDescription +
        " url=" +
        e.validatedURL,
    );
    // 只对「主框架（主文档）」加载失败才弹错误页；子资源/iframe/第三方追踪像素（如 whoer.com 加载的
    // csync.loopme.me / id5-sync.com cookie-sync gif）被上游代理丢弃属正常现象，静默忽略，
    // 否则会被误报成「页面加载失败」。这类像素失败反而更隐私友好。
    if (activeId === tabId && e.isMainFrame && e.errorCode !== -3) {
      const desc = e.errorDescription || "错误码 " + e.errorCode;
      // 直连下部分检测站(如 whoer.com)被网络限制 → 连接被关闭/重置：提示改用代理，而非单纯报错
      const hint =
        /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_TIMED_OUT|连接|CONNECTION/i.test(
          desc,
        )
          ? "（该站点在当前网络下可能无法直连，建议为环境配置代理后再访问）"
          : "";
      showFatal(
        "页面加载失败：" +
          desc +
          (e.validatedURL ? " @ " + e.validatedURL : "") +
          hint,
      );
    }
  });
  w.addEventListener("did-navigate", () => {
    if (activeId === tabId) {
      updateAddrFromActive();
      disarmNav();
      refreshTitle(tabId);
      onPageSettled(tabId, w);
    }
  });
  w.addEventListener("did-navigate-in-page", () => {
    if (activeId === tabId) {
      updateAddrFromActive();
      refreshTitle(tabId);
      StarBrowser.settled(tabId,w);
    }
  });
  w.addEventListener("page-title-updated", () => {
    refreshTitle(tabId);
  });
  // 弹窗拦截改由主进程 setWindowOpenHandler 处理（guest:setPopHandler）：deny 建窗 + 发 URL 回渲染端开新标签。
  // 不再用 DOM new-window 事件（Electron 31 该事件 preventDefault 不可靠，仍会弹独立窗口）。
  return w;
}

function updateNavButtons() {
  const t = activeTab();
  if (!t) return;
  try {
    $("back").disabled = !t.web.canGoBack();
  } catch (e) {
    $("back").disabled = true;
  }
  try {
    $("forward").disabled = !t.web.canGoForward();
  } catch (e) {
    $("forward").disabled = true;
  }
}
function updateAddrFromActive(force=false) {
  const t = activeTab();
  if (!t) return;
  try {
    if (force || document.activeElement !== addr) {let url="";try{url=t.web?.getURL()||"";}catch{}addr.value=t.ntp?"":t.web?.__starPendingURL||(!url||url==="about:blank"?t.url:url);}
  } catch (e) {}
  updateNavButtons();
}
// 窗口顶部标题：优先展示环境名称，便于多环境并行时区分彼此；再拼接当前网页标题。
function envName() {
  return profile && profile.name ? String(profile.name) : "";
}
function winTitle(pageTitle) {
  var base = envName() ? envName() + " · " : "";
  var page = pageTitle && pageTitle !== "新标签" ? pageTitle : "Star Browser";
  return base + page;
}
// 从 webview 主动读取标题（page-title-updated 对 data:/about:blank 不触发，故在加载完成时兜底读取）
function refreshTitle(tabId) {
  const t = tabs.find((x) => x.id === tabId);
  if (!t) return;
  let title = t.ntp ? "新标签" : "";
  try {
    if (!t.ntp) title = (t.web.getTitle && t.web.getTitle()) || "";
  } catch (e) {}
  title = (title || "").trim();
  t.title = !t.ntp && (!title||title==="about:blank") && /^https?:/.test(t.url) ? new URL(t.url).hostname : title || "新标签";
  renderTabs();
  if (activeId === tabId) {
    document.title = winTitle(t.title);
  }
}

// 重建所有标签（用当前 profile 的最新指纹重新注入，应用新的时区/语言等）
function rebuildAllTabs() {
  const urls=tabs.map(t=>({url:t.ntp?'about:home':t.url||homeUrl,ntp:t.ntp,pinned:t.pinned,muted:t.muted,sleeping:t.sleeping,title:t.title})),index=tabs.findIndex(t=>t.id===activeId);
  StarBrowser.beginRestore();tabs.forEach(t=>t.web?.remove());tabs.length=0;
  urls.forEach(t=>createTab(t.url,{...t,background:true}));if(tabs.length)activateTab(tabs[Math.max(0,index)].id);StarBrowser.endRestore();
}

// ---------------- 标签管理 ----------------
function syncLoading() {
  const t=activeTab(),loading=!!t?.loading&&!t.ntp;
  spinner.style.display=loading?"block":"none";
  const reload=$("reload");reload.innerHTML=StarBrowser.icon(loading?"X":"RotateCw");
  reload.title=loading?"停止加载":"刷新";reload.setAttribute("aria-label",reload.title);
  $("addr").setAttribute("aria-busy",String(loading));
  for(const tab of tabs)tabsEl.querySelector(`[data-tab-id="${tab.id}"]`)?.classList.toggle("loading",!!tab.loading&&!tab.ntp);
}
function setTabLoading(id,loading){const t=tabs.find(t=>t.id===id);if(t)t.loading=loading;syncLoading();}
function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "") + (t.loading&&!t.ntp?" loading":"");
    el.title = t.url || t.title;
    el.setAttribute("role","tab");el.setAttribute("aria-selected",String(t.id===activeId));el.tabIndex=t.id===activeId?0:-1;
    el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activateTab(t.id);}if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();StarBrowser.command(e.key==="ArrowRight"?"next-tab":"previous-tab");tabsEl.querySelector('[aria-selected="true"]')?.focus();}});
    el.innerHTML =
      '<span class="title"></span><button class="close" title="关闭标签">×</button>';
    el.querySelector(".title").textContent = t.title === "about:blank" && !t.ntp ? "正在打开…" : t.title || "新标签";
    el.querySelector(".close").setAttribute("aria-label","关闭 "+(t.title||"新标签"));
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("close")) return;
      activateTab(t.id);
    });
    el.querySelector(".close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.id);
    });
    StarTabs.decorate(t,el);
    tabsEl.appendChild(el);
  });
}

function activateTab(id) {
  activeId = id;
  const selected=tabs.find(t=>t.id===id);if(selected)StarTabs.wake(selected);
  tabs.forEach((t) => {
    if(!t.web)return;
    if (t.id === id) {
      t.web.classList.add("active");
      t.web.style.display = "flex";
    } else {
      t.web.classList.remove("active");
      t.web.style.display = "none";
    }
  });
  hideFatal();
  disarmNav();
  updateAddrFromActive(true);
  const at = tabs.find((x) => x.id === id);
  if (at && at.ntp) showNtp();
  else {
    $("ntp").hidden = true;
  }
  renderTabs();
  requestAnimationFrame(() => {
    const selected = tabsEl.querySelector(`[data-tab-id="${activeId}"]`);
    if (!selected) return;
    const item = selected.getBoundingClientRect(), viewport = tabsEl.getBoundingClientRect();
    const delta = item.left < viewport.left ? item.left-viewport.left : item.right > viewport.right ? item.right-viewport.right : 0;
    if (delta) tabsEl.scrollBy({left:delta,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  const t = activeTab();
  if (t) document.title = winTitle(t.title);
  syncLoading();
  StarBrowser.tabChanged();
}

function createTab(url, opts) {
  opts = opts || {};
  if(tabs.length>=50){toast("每个窗口最多打开 50 个标签");return null;}
  if(url===homeUrl || url==="about:home")opts.ntp=true;
  const id = nextId++;
  const sleeping=!!opts.sleeping&&!opts.ntp&&!!opts.background;
  const w=sleeping?null:makeWebview(id);
  if(w)wrap.appendChild(w);
  const tab={id,title:opts.title||"新标签",web:w,url:url||"about:home",ntp:!!opts.ntp,pinned:!!opts.pinned,muted:!!opts.muted,sleeping};
  const boundary=tabs.findIndex(t=>!t.pinned);
  if(tab.pinned&&boundary>=0)tabs.splice(boundary,0,tab);else tabs.push(tab);
  if(!opts.background)activateTab(id);
  renderTabs();
  if(sleeping){StarBrowser.persist();return id;}
  if (opts.ntp) {
    w.src="about:blank"; StarBrowser.persist();
  } else {w.__starPendingURL=url||homeUrl;if(w.__starReady){delete w.__starPendingURL;w.src=url||homeUrl;}else setupGuestInjection(w,id);}
  return id;
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const wasActive = activeId === id;
  StarBrowser.tabClosed(tabs[idx]);
  try {
    tabs[idx].web?.remove();
  } catch (e) {}
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    createTab("about:blank",{ntp:true});
    return;
  }
  if (wasActive) {
    const next = tabs[idx] || tabs[idx - 1];
    activateTab(next.id);
  } else {
    renderTabs();
  }
  StarBrowser.persist();
}

// ---------------- 工具栏事件 ----------------
addr.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    StarBrowser.navigate(addr.value);
  }
});
$("back").addEventListener("click", () => {
  const t = activeTab();
  if (t)
    try {
      t.web.goBack();
    } catch (e) {}
});
$("forward").addEventListener("click", () => {
  const t = activeTab();
  if (t)
    try {
      t.web.goForward();
    } catch (e) {}
});
$("reload").addEventListener("click", () => {
  const t = activeTab();
  if (t)
    try {
      if(t.loading){t.web.stop();setTabLoading(t.id,false);disarmNav();}
      else {t.web.reload();armNav(t.web.getURL());}
    } catch (e) {}
});
$("home").addEventListener("click", () => {
  showNtp();StarBrowser.persist();
});
$("newTab").addEventListener("click", () => {
  createTab("about:blank", { ntp: true });
});
// 书签栏「»」：打开完整收藏夹面板
if ($("bmBarMore"))
  $("bmBarMore").addEventListener("click", () => {
    if (!panel.hidden && !StarSettings.close()) return;
    $("launcher").hidden = true;
    StarNetwork.close(false);
    const bp = $("bmPanel");
    bp.hidden = !bp.hidden;
    if (!bp.hidden) renderBookmarks();
  });
$("closeWin").addEventListener("click", () => {
  try {
    if (window.api && window.api.close) window.api.close();
    else window.close();
  } catch (e) {
    try {
      window.close();
    } catch (_) {}
  }
});

// 关闭当前标签（Ctrl+W）/ 新标签页（Ctrl+T）/ 切换书签栏（Ctrl+Shift+B）
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "w") {
    e.preventDefault();
    if (activeId) closeTab(activeId);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
    e.preventDefault();
    if(e.shiftKey)StarBrowser.restoreClosed();else createTab("about:blank", { ntp: true });
  } else if (
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    e.key.toLowerCase() === "b"
  ) {
    e.preventDefault();
    toggleBmBar();
  }
});

// 原生菜单快捷键在网页内容获得焦点时也能触发。
if (window.api && window.api.onMenuNewTab) {
  window.api.onMenuNewTab(() => createTab("about:blank", { ntp: true }));
  window.api.onMenuCloseTab(() => { if (activeId) closeTab(activeId); });
}

// 全局兜底
window.addEventListener("error", (e) => {
  console.error("[shell]", e.message);
});

// ---------------- 初始化 ----------------
function bootstrap() {
  // 引导阶段：先开一个空标签（新标签页样式），握手后再开
  applyBmBarVisibility();
  refreshBookmarks();
  createTab("about:blank", { ntp: true });
}
if (window.api) {
  window.api.onInit((payload) => {
    try {
      profile = payload;
      homeUrl = payload.homeUrl || homeUrl;
      document.title = winTitle(""); // 进入环境即显示环境名，避免标题栏空白/默认名
      dbg(
        "onInit mode=" +
          payload.mode +
          " buildTag=" +
          payload.buildTag +
          " preload=" +
          (payload.preloadURL ? "yes" : "no"),
      );
      StarBrowser.init(payload);
      $("s-version").textContent =
        payload.buildTag || (window.api.version ? window.api.version() : "");
      // 用真实配置重建当前标签（注入指纹），导航到真实起始页（不用 cur.url，那是引导时的 about:blank）
      const cur = activeTab();
      if (cur) {
        try {
          cur.web.remove();
        } catch (e) {}
      }
      StarBrowser.beginRestore();
      tabs.forEach(t=>t.web.remove());tabs.length = 0;
      const saved=Array.isArray(payload.savedTabs)?payload.savedTabs:[];
      if(saved.length){saved.forEach(t=>createTab(t.url,{...t,ntp:t.url==='about:home',background:true}));activateTab(tabs[Math.min(payload.savedActive||0,tabs.length-1)].id);}
      else createTab(payload.startUrl || homeUrl);
      StarBrowser.endRestore();
      for(const url of payload.diagnosticUrls||[]) createTab(url);
      // 默认同时打开检测站，便于一眼确认 IP 环境是否正常（参考 AdsPower：开环境即带检测页）
      try {
        if (payload.openCheckPage !== false) createTab("https://ipchacha.cn");
      } catch (_) {}
      // 初始化收藏夹栏 / 星标状态（异步，不阻塞首屏）
      refreshBookmarks();
      // 指纹时区/语言对齐已由主进程在后台完成并通过 browse:align 回推（见下方 onAlign 监听），
      // 首屏注入使用本地即时生成的指纹（国家默认），对齐结果到达后重建一次注入，避免阻塞窗口打开。
    } catch (e) {
      dbg("onInit ERROR " + (e.message || e));
      showFatal("加载环境配置失败：" + (e.message || e));
    }
  });
  try {
    window.api.ready();
  } catch (e) {}
  // 监听主进程推送的轻量提示（如代理不可达时改用直连的告警）
  try {
    window.api.onToast &&
      window.api.onToast((msg) => {
        try {
          toast(msg);
        } catch (_) {}
      });
  } catch (e) {}
  // 接收主进程下发的「网络环境提示」（白名单代理回退直连、出口与预设地区不符时）
  try {
    window.api.onGeoWarn &&
      window.api.onGeoWarn((info) => {
        try {
          showGeoWarn(info);
        } catch (_) {}
      });
  } catch (e) {}
  // 接收主进程转发的「需在新标签打开的 URL」（来自 setWindowOpenHandler 拦截的弹窗）
  if (window.api.onNewTab) {
    window.api.onNewTab((url) => {
      if (url) {
        createTab(url);
        toast("已在新标签页打开");
      }
    });
  }
  // 主菜单「新建标签页」→ 打开新标签页（NTP 样式）
  if (window.api.onMenuNew) {
    window.api.onMenuNew(() => {
      createTab("about:blank", { ntp: true });
    });
  }
  // 主进程后台对齐出口 IP 地理完成后回推已对齐指纹：仅时区/语言变化才重建标签重新注入（通常一次）
  if (window.api.onAlign) {
    window.api.onAlign((fp) => {
      if (!profile || !fp) return;
      const t0 = profile.fingerprint && profile.fingerprint.timezone;
      const l0 = profile.fingerprint && profile.fingerprint.language;
      profile.fingerprint = fp;
      if (t0 !== fp.timezone || l0 !== fp.language) {
        rebuildAllTabs();
        toast("已根据出口 IP 自动同步时区/语言");
      }
    });
  }
  bootstrap();
  StarBrowser.setup();
} else {
  showFatal("桥接脚本未加载(window.api 缺失)：地址栏仍可浏览。");
  bootstrap();
}
