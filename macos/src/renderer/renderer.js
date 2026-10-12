"use strict";
const $ = (s) => document.querySelector(s);
const rowsEl = $("#rows");
const modal = $("#modal");
const drawer = $("#drawer");
let editingId = null;
let cache = [];
const selected = new Set(); // 批量操作选中的环境 id

function parseProxyStr(s) {
  const m = (s || "").trim().match(/^(https?|socks5):\/\/(.+)$/i);
  if (!m) return null;
  const type = m[1].toLowerCase() === "socks5" ? "socks5" : "http";
  const i = m[2].lastIndexOf(":");
  return {
    type,
    host: (i > 0 ? m[2].slice(0, i) : m[2]).trim(),
    port: (i > 0 ? m[2].slice(i + 1) : "").trim(),
  };
}

// 代理粘贴自动解析（与内置浏览器同款规则）：host:port:user:pass / scheme:// / user:pass@host:port
function applyProxyPasteToModal() {
  const box = $("#p_paste");
  if (!box) return;
  let s = box.value.trim();
  if (!s) {
    toast("请先粘贴代理文本");
    return;
  }
  let type = "socks5";
  const m = s.match(/^([a-zA-Z0-9]+):\/\//);
  if (m) {
    const sch = m[1].toLowerCase();
    type = sch === "socks5" || sch === "socks" ? "socks5" : "http";
    s = s.slice(m[0].length);
  }
  s = s.replace(/^\[/, "").replace(/\]$/, "");
  let user = "",
    pass = "";
  const at = s.indexOf("@");
  if (at >= 0) {
    const cred = s.slice(0, at);
    s = s.slice(at + 1);
    const ci = cred.indexOf(":");
    if (ci >= 0) {
      user = cred.slice(0, ci);
      pass = cred.slice(ci + 1);
    } else {
      user = cred;
    }
  }
  const parts = s.split(":");
  let host = "",
    port = "";
  if (parts.length >= 2) {
    if (parts.length >= 4) {
      host = parts[0];
      port = parts[1];
      user = parts.slice(2, -1).join(":");
      pass = parts[parts.length - 1];
    } else if (parts.length === 3) {
      host = parts[0];
      port = parts[1];
      if (at < 0) user = parts[2];
    } else {
      host = parts[0];
      port = parts[1];
    }
  }
  if (!host) {
    toast("无法解析该代理文本");
    return;
  }
  $("#f_proxy_on").checked = true;
  $("#p_type").value = type;
  $("#p_host").value = host;
  $("#p_port").value = port;
  $("#p_user").value = user || "";
  $("#p_pass").value = pass || "";
  box.value = "";
  toast("已自动填入代理：" + host + (port ? ":" + port : ""));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 2200);
}
function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const COUNTRY_TZ = {
  US: "America/New_York",
  UK: "Europe/London",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  SE: "Europe/Stockholm",
  PL: "Europe/Warsaw",
  RU: "Europe/Moscow",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  SG: "Asia/Singapore",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  IN: "Asia/Kolkata",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  MY: "Asia/Kuala_Lumpur",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  TR: "Europe/Istanbul",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  ZA: "Africa/Johannesburg",
};

async function refresh() {
  cache = await window.api.list();
  render(cache);
}

function render(list) {
  const kw = $("#search").value.trim().toLowerCase();
  const data = kw
    ? list.filter((p) =>
        (
          p.name +
          " " +
          p.group +
          " " +
          (p.tags || []).join(" ") +
          " " +
          (p.note || "")
        )
          .toLowerCase()
          .includes(kw),
      )
    : list;
  rowsEl.innerHTML = "";
  $("#empty").hidden = data.length > 0;
  for (const p of data) {
    const tr = document.createElement("tr");
    const proxyOn = p.proxy && p.proxy.host;
    const sel = selected.has(p.id) ? "checked" : "";
    const tags =
      p.tags && p.tags.length
        ? '<div class="tags">' +
          p.tags
            .map((t) => '<span class="tag-chip">' + esc(t) + "</span>")
            .join("") +
          "</div>"
        : "";
    const note = p.note
      ? '<div class="tags"><span class="tag-chip" style="background:#fff7e6;color:#92600b">' +
        esc(p.note) +
        "</span></div>"
      : "";
    tr.innerHTML = `
      <td class="col-sel"><input type="checkbox" class="row-sel" data-id="${p.id}" ${sel} /></td>
      <td class="name-cell"><b>${esc(p.name)}</b>${tags}${note}</td>
      <td><span class="chip">${esc(p.group)}</span></td>
      <td>${p.os === "mac" ? "macOS" : p.os === "android" ? "Android" : "Windows"}</td>
      <td>${p.country} · ${COUNTRY_TZ[p.country] || ""}</td>
      <td><span class="dot ${proxyOn ? "on" : "off"}"></span>${proxyOn ? esc(p.proxy.type + " " + p.proxy.host) : "直连"}</td>
      <td>${fmtTime(p.lastOpenedAt)}</td>
      <td><div class="row-actions">
        <button class="btn sm primary" data-act="browse" data-id="${p.id}">应用内打开</button>
        <button class="btn sm" data-act="launch" data-id="${p.id}">本机Chrome</button>
        <button class="btn sm" data-act="check" data-id="${p.id}">检测IP</button>
        <button class="btn sm" data-act="cookieout" data-id="${p.id}">Cookie备</button>
        <button class="btn sm" data-act="cookiein" data-id="${p.id}">Cookie恢</button>
        <button class="btn sm" data-act="fp" data-id="${p.id}">指纹</button>
        <button class="btn sm" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="btn sm danger" data-act="del" data-id="${p.id}">删除</button>
      </div></td>`;
    rowsEl.appendChild(tr);
  }
}

function updateBatchBar() {
  const bar = $("#batchBar");
  if (selected.size === 0) {
    bar.hidden = true;
    $("#selAll").checked = false;
    return;
  }
  bar.hidden = false;
  $("#batchCount").textContent = "已选 " + selected.size + " 个";
}
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

rowsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id,
    act = btn.dataset.act;
  if (act === "launch") {
    btn.textContent = "启动中…";
    btn.disabled = true;
    try {
      const r = await window.api.launch(id);
      toast("已启动 · PID " + r.pid);
    } catch (err) {
      toast("启动失败：" + err.message);
    } finally {
      btn.textContent = "本机Chrome";
      btn.disabled = false;
      refresh();
    }
  } else if (act === "browse") {
    btn.textContent = "打开中…";
    btn.disabled = true;
    try {
      await window.api.browse(id);
      toast("已在内置内核打开");
    } catch (err) {
      toast("打开失败：" + err.message);
    } finally {
      btn.textContent = "应用内打开";
      btn.disabled = false;
    }
  } else if (act === "edit") {
    openModal(cache.find((p) => p.id === id));
  } else if (act === "del") {
    if (confirm("确认删除该环境？其独立数据目录将保留在磁盘。")) {
      await window.api.remove(id);
      refresh();
      toast("已删除");
    }
  } else if (act === "fp") {
    try {
      const fp = await window.api.preview(id);
      showFingerprint(fp);
    } catch (err) {
      toast("读取指纹失败：" + err.message);
    }
  } else if (act === "check") {
    const p = cache.find((x) => x.id === id);
    if (!p || !p.proxy || !p.proxy.host) {
      toast("该环境未配置代理");
      return;
    }
    btn.textContent = "检测中…";
    btn.disabled = true;
    try {
      const info = await window.api.proxyCheck(p.proxy);
      if (info && info.error) toast("检测失败：" + info.error);
      else {
        const cc = (info.country || "").toUpperCase();
        const expect = (p.country || "").toUpperCase();
        const match = cc && expect && cc === expect;
        toast(
          "出口 " +
            (info.ip || "?") +
            " · " +
            cc +
            (match ? " ✓ 与指纹一致" : " ✗ 应为 " + cc),
        );
      }
    } catch (err) {
      toast("检测异常：" + err.message);
    } finally {
      btn.textContent = "检测IP";
      btn.disabled = false;
    }
  } else if (act === "cookieout") {
    try {
      const r = await window.api.cookieExport(id);
      if (r && r.canceled) return;
      if (r && r.ok) toast("已备份 " + r.count + " 条 Cookie");
      else toast("备份失败：" + ((r && r.error) || "未知"));
    } catch (err) {
      toast("备份异常：" + err.message);
    }
  } else if (act === "cookiein") {
    try {
      const r = await window.api.cookieImport(id);
      if (r && r.canceled) return;
      if (r && r.ok)
        toast(
          "已恢复 " +
            r.okCount +
            " 条" +
            (r.failCount ? "，" + r.failCount + " 失败" : ""),
        );
      else toast("恢复失败：" + ((r && r.error) || "未知"));
    } catch (err) {
      toast("恢复异常：" + err.message);
    }
  }
});

// 行内复选框 -> 批量选择
rowsEl.addEventListener("change", (e) => {
  const cb = e.target.closest(".row-sel");
  if (!cb) return;
  const id = cb.dataset.id;
  if (cb.checked) selected.add(id);
  else selected.delete(id);
  updateBatchBar();
});
// 全选
$("#selAll").addEventListener("change", () => {
  const on = $("#selAll").checked;
  rowsEl.querySelectorAll(".row-sel").forEach((r) => {
    r.checked = on;
    if (on) selected.add(r.dataset.id);
    else selected.delete(r.dataset.id);
  });
  updateBatchBar();
});
// 批量：打开
$("#batchOpen").addEventListener("click", async () => {
  if (selected.size === 0) return;
  let n = 0;
  for (const id of selected) {
    try {
      await window.api.browse(id);
      n++;
    } catch (err) {
      toast("打开失败：" + err.message);
    }
  }
  toast("已打开 " + n + " 个环境");
});
// 批量：改代理
$("#batchProxy").addEventListener("click", async () => {
  if (selected.size === 0) return;
  const s = prompt(
    "批量设置代理（支持：socks5://1.2.3.4:1080、http://1.2.3.4:8080、或 host:port:user:pass）\n留空则清除代理（直连）",
    "socks5://",
  );
  if (s === null) return;
  let proxy = null;
  if (s.trim()) {
    const pr = parseProxyStr(s);
    if (!pr) {
      toast("格式错误，已取消");
      return;
    }
    proxy = { type: pr.type, host: pr.host, port: pr.port, user: "", pass: "" };
  }
  let n = 0;
  for (const id of selected) {
    await window.api.update(id, { proxy });
    n++;
  }
  refresh();
  toast("已为 " + n + " 个环境设置代理");
});
// 批量：打标签（与现有标签合并）
$("#batchTag").addEventListener("click", async () => {
  if (selected.size === 0) return;
  const s = prompt("批量打标签（逗号分隔，将与现有标签合并）", "");
  if (s === null) return;
  const newTags = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!newTags.length) return;
  let n = 0;
  for (const id of selected) {
    const p = cache.find((x) => x.id === id);
    const merged = Array.from(new Set([...(p.tags || []), ...newTags]));
    await window.api.update(id, { tags: merged });
    n++;
  }
  refresh();
  toast("已为 " + n + " 个环境打标签");
});
// 批量：取消选择
$("#batchClear").addEventListener("click", () => {
  selected.clear();
  render(cache);
  updateBatchBar();
});

// 指纹预览渲染：摘要表 + 折叠原始 JSON；点遮罩关闭；复制 JSON
let currentFp = null;
function showFingerprint(fp) {
  currentFp = fp;
  if (!fp || typeof fp !== "object") {
    $("#fpBody").innerHTML = '<p class="fp-empty">（该环境暂无指纹数据）</p>';
    drawer.hidden = false;
    return;
  }
  const rows = [
    [
      "操作系统",
      fp.os === "mac" ? "macOS" : fp.os === "android" ? "Android" : "Windows",
    ],
    ["User-Agent", fp.userAgent],
    ["平台 platform", fp.platform],
    ["语言", (fp.language || "") + "  /  " + (fp.languages || []).join(", ")],
    ["时区 timezone", fp.timezone],
    [
      "屏幕分辨率",
      `${fp.screen.width}×${fp.screen.height}（${fp.screen.colorDepth}bit）`,
    ],
    ["CPU 核心数", fp.hardwareConcurrency],
    ["内存(GB)", fp.deviceMemory],
    ["WebGL 厂商", fp.webgl && fp.webgl.vendor],
    ["WebGL 渲染器", fp.webgl && fp.webgl.renderer],
    ["Canvas 噪声种子", fp.canvasNoise],
    ["Audio 噪声", fp.audioNoise],
    ["WebRTC 策略", fp.webrtc],
    ["字体数量", (fp.fonts || []).length + " 个"],
    ["最大触点数", fp.maxTouchPoints],
  ];
  let html = '<table class="fp-tbl">';
  for (const [k, v] of rows) {
    html += `<tr><td class="k">${esc(k)}</td><td class="v">${esc(String(v == null ? "—" : v))}</td></tr>`;
  }
  html += "</table>";
  html += `<details class="fp-raw"><summary>原始 JSON</summary><pre class="fp-json">${esc(JSON.stringify(fp, null, 2))}</pre></details>`;
  $("#fpBody").innerHTML = html;
  drawer.hidden = false;
}

function openModal(p) {
  editingId = p ? p.id : null;
  $("#modalTitle").textContent = p ? "编辑环境" : "新建环境";
  $("#f_name").value = p ? p.name : "";
  $("#f_group").value = p ? p.group : "默认分组";
  $("#f_os").value = p ? p.os : "win";
  $("#f_country").value = p ? p.country : "US";
  $("#f_url").value = p ? p.startUrl : "https://www.chuhailiqi.com";
  // 新建环境时自动检测本机系统代理并填充（osdwan 等白名单代理常在本机开启）
  if (!p && window.api && window.api.detectSystemProxyGeo) {
    window.api
      .detectSystemProxyGeo()
      .then((sp) => {
        if (!sp) return;
        // 本机系统代理存在：填代理 + 按出口 IP 推荐国家
        if (sp.enabled && sp.host) {
          $("#f_proxy_on").checked = true;
          $("#p_type").value = sp.type || "http";
          $("#p_host").value = sp.host || "";
          $("#p_port").value = sp.port || "";
          $("#p_user").value = "";
          $("#p_pass").value = "";
          toast(
            "已自动检测到本机代理：" +
              (sp.host || "") +
              (sp.ip
                ? "（出口 " + sp.ip + " / " + (sp.country || "") + "）"
                : ""),
          );
        }
        // 按网络出口 IP 自动推荐国家 / 地区（有代理走代理出口，无代理走本机直连出口）
        if (sp.country) {
          const cc = String(sp.country).toUpperCase();
          const opt = Array.from($("#f_country").options).find(
            (o) => o.value === cc,
          );
          if (opt) $("#f_country").value = cc;
          if (!sp.enabled && !$("#f_name").value)
            $("#f_name").value = cc + " 环境";
        }
      })
      .catch(() => {});
  }
  $("#f_note").value = p ? p.note : "";
  $("#f_tags").value = p ? (p.tags || []).join(", ") : "";
  // 语言：仅当用户曾手动锁定时显示具体语言，否则显示「跟随 IP」（推荐）
  $("#f_language").value = p && p.langManual && p.language ? p.language : "";
  // 时区：仅当用户曾手动锁定时显示具体时区，否则显示「跟随 IP」（推荐）
  $("#f_timezone").value =
    p && p.timezoneManual && p.timezone ? p.timezone : "";
  const px = p && p.proxy ? p.proxy : {};
  $("#f_proxy_on").checked = !!(px && px.host);
  $("#p_type").value = px.type || "socks5";
  $("#p_host").value = px.host || "";
  $("#p_port").value = px.port || "";
  $("#p_user").value = px.user || "";
  $("#p_pass").value = px.pass || "";
  modal.hidden = false;
}

$("#btnNew").onclick = () => openModal(null);
$("#btnCancel").onclick = () => (modal.hidden = true);
$("#p_paste_go").onclick = () => applyProxyPasteToModal();
$("#p_test").onclick = async () => {
  const box = $("#proxyTest");
  const on = $("#f_proxy_on").checked;
  const type = $("#p_type").value;
  const host = $("#p_host").value.trim();
  const port = $("#p_port").value.trim();
  if (!on || !host) {
    box.hidden = false;
    box.className = "proxy-test bad";
    box.textContent = "请先勾选「启用代理」并填写主机";
    return;
  }
  box.hidden = false;
  box.className = "proxy-test";
  box.textContent = "正在检测出口 IP…";
  try {
    const proxy = {
      type,
      host,
      port,
      user: $("#p_user").value.trim(),
      pass: $("#p_pass").value,
    };
    const info = await window.api.proxyCheck(proxy);
    if (info && info.error) {
      box.className = "proxy-test bad";
      box.textContent = "检测失败：" + info.error;
      return;
    }
    const ip = info.ip || "?";
    const cc = (info.country || "").toUpperCase();
    const tz = info.timezone || "";
    const locale = info.locale || "";
    box.className = "proxy-test ok";
    box.textContent =
      "出口 IP：" +
      ip +
      "\n国家：" +
      (cc || "未知") +
      "\n时区：" +
      tz +
      "　语言：" +
      locale;
  } catch (err) {
    box.className = "proxy-test bad";
    box.textContent = "检测异常：" + (err.message || err);
  }
};
$("#drawerClose").onclick = () => (drawer.hidden = true);
$("#search").oninput = () => render(cache);

// 指纹预览：复制 JSON / 点遮罩关闭
$("#fpCopy").onclick = async () => {
  if (!currentFp) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentFp, null, 2));
    toast("已复制指纹 JSON");
  } catch (e) {
    toast("复制失败，请手动选择");
  }
};
drawer.addEventListener("click", (e) => {
  if (e.target === drawer) drawer.hidden = true;
});

// ---------------- 功能规划 · 路线图 ----------------
function renderRoadmap() {
  const grid = $("#roadmapGrid");
  if (!grid) return;
  grid.innerHTML = "";
  ROADMAP.forEach((m) => {
    const card = document.createElement("div");
    card.className = "rm-card";
    const done = m.status === "已上线" ? " done" : "";
    card.innerHTML = `<h4>${esc(m.name)}<span class="rm-status${done}">${esc(m.status)}</span></h4><p>${esc(m.desc)}</p>`;
    grid.appendChild(card);
  });
}
const TUTORIAL_URL = ""; // 留空=使用内置教程；将来可填外部链接（如 https://...）改为外链打开
const roadmap = $("#roadmap");
$("#navRoadmap").onclick = () => {
  renderRoadmap();
  roadmap.hidden = false;
};
$("#roadmapClose").onclick = () => (roadmap.hidden = true);
roadmap.addEventListener("click", (e) => {
  if (e.target === roadmap) roadmap.hidden = true;
});

// ---------------- 使用教程弹窗 ----------------
const tutorial = $("#tutorialModal");
$("#navTutorial").onclick = () => {
  if (TUTORIAL_URL && window.api && window.api.openExternal) {
    window.api.openExternal(TUTORIAL_URL);
    return;
  }
  tutorial.hidden = false;
};
$("#tutorialClose").onclick = () => (tutorial.hidden = true);
tutorial.addEventListener("click", (e) => {
  if (e.target === tutorial) tutorial.hidden = true;
});

// ---------------- 设置弹窗：开机自启开关 ----------------
const settingsModal = $("#settingsModal");
const sAuto = $("#s_autostart");
$("#navSettings").onclick = () => {
  if (window.api && window.api.getAutoStart) {
    window.api
      .getAutoStart()
      .then((on) => {
        if (sAuto) sAuto.checked = !!on;
      })
      .catch(() => {});
  }
  if (settingsModal) settingsModal.hidden = false;
};
$("#settingsClose").onclick = () => (settingsModal.hidden = true);
if (settingsModal)
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) settingsModal.hidden = true;
  });
if (sAuto)
  sAuto.addEventListener("change", () => {
    if (window.api && window.api.setAutoStart) {
      window.api
        .setAutoStart(sAuto.checked)
        .then(() =>
          toast(sAuto.checked ? "已开启开机自动启动" : "已关闭开机自动启动"),
        )
        .catch(() => {});
    }
  });

// ---------------- 左侧底部广告位：打开外部链接 / 社群二维码 ----------------
const qrModal = $("#qrModal");
function openQr() {
  if (qrModal) qrModal.hidden = false;
}
if ($("#qrClose")) $("#qrClose").onclick = () => (qrModal.hidden = true);
if (qrModal)
  qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) qrModal.hidden = true;
  });

document.querySelectorAll(".ad-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.getAttribute("data-reserved") === "qr") {
      openQr();
      return;
    }
    const url = btn.getAttribute("data-ext");
    if (!url) {
      toast("该入口暂未开放");
      return;
    }
    if (window.api && window.api.openExternal) {
      window.api.openExternal(url);
    }
  });
});

// ---------------- 代理管理面板 ----------------
const proxyPanel = $("#proxyPanel");
$("#navProxy").onclick = () => {
  renderProxyPanel();
  proxyPanel.hidden = false;
};
$("#proxyPanelClose").onclick = () => (proxyPanel.hidden = true);
proxyPanel.addEventListener("click", (e) => {
  if (e.target === proxyPanel) proxyPanel.hidden = true;
});

function uniqueProxies() {
  const map = new Map();
  for (const p of cache) {
    if (!p.proxy || !p.proxy.host) continue;
    const key = [
      p.proxy.type,
      p.proxy.host,
      p.proxy.port,
      p.proxy.user || "",
    ].join("|");
    if (!map.has(key)) map.set(key, { proxy: p.proxy, envs: [] });
    map.get(key).envs.push(p.name);
  }
  return Array.from(map.values());
}
function renderProxyPanel() {
  const list = uniqueProxies();
  const box = $("#proxyList");
  box.innerHTML = "";
  $("#proxySummary").textContent = list.length
    ? "共 " + list.length + " 个代理"
    : "暂无可管理的代理（请先在环境中配置代理）";
  if (!list.length) return;
  list.forEach((item, i) => {
    const pr = item.proxy;
    const card = document.createElement("div");
    card.className = "proxy-card";
    card.innerHTML = `
      <div class="pc-head">
        <span class="pc-addr">${esc(pr.type + "://" + pr.host + ":" + pr.port + (pr.user ? " (带账号)" : ""))}</span>
        <span class="pc-tag" data-i="${i}">未检测</span>
      </div>
      <div class="pc-meta">关联环境：${esc(item.envs.join("、"))}</div>
      <div class="pc-actions" style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn sm" data-test="${i}">检测出口</button>
      </div>`;
    box.appendChild(card);
    card
      .querySelector("[data-test]")
      .addEventListener("click", () => testOneProxy(item, card));
  });
}
async function testOneProxy(item, card) {
  const tag = card.querySelector(".pc-tag");
  const meta = card.querySelector(".pc-meta");
  tag.textContent = "检测中…";
  tag.className = "pc-tag";
  try {
    const info = await window.api.proxyCheck(item.proxy);
    if (info && info.error) {
      tag.textContent = "检测失败";
      tag.className = "pc-tag bad";
      meta.textContent =
        "关联环境：" + item.envs.join("、") + "\n" + info.error;
      return;
    }
    tag.textContent = "可用";
    tag.className = "pc-tag ok";
    meta.textContent =
      "关联环境：" +
      item.envs.join("、") +
      "\n出口 IP：" +
      (info.ip || "?") +
      "　国家：" +
      (info.country || "?") +
      "\n时区：" +
      (info.timezone || "?") +
      "　语言：" +
      (info.locale || "?");
  } catch (err) {
    tag.textContent = "异常";
    tag.className = "pc-tag bad";
    meta.textContent =
      "关联环境：" + item.envs.join("、") + "\n" + (err.message || err);
  }
}
$("#proxyTestAll").onclick = async () => {
  const list = uniqueProxies();
  if (!list.length) {
    toast("暂无可检测的代理");
    return;
  }
  $("#proxySummary").textContent = "正在检测 " + list.length + " 个代理…";
  let ok = 0,
    bad = 0;
  const cards = $("#proxyList").querySelectorAll(".proxy-card");
  for (let i = 0; i < list.length; i++) {
    await testOneProxy(list[i], cards[i]);
  }
  $("#proxyList")
    .querySelectorAll(".pc-tag")
    .forEach((t) => {
      if (t.classList.contains("ok")) ok++;
      else if (t.classList.contains("bad")) bad++;
    });
  $("#proxySummary").textContent = "检测完成：可用 " + ok + " · 失败 " + bad;
};

// ---------------- Cookie 管理面板 ----------------
const cookiePanel = $("#cookiePanel");
$("#navCookie").onclick = () => {
  renderCookiePanel();
  cookiePanel.hidden = false;
};
$("#cookiePanelClose").onclick = () => (cookiePanel.hidden = true);
cookiePanel.addEventListener("click", (e) => {
  if (e.target === cookiePanel) cookiePanel.hidden = true;
});

async function renderCookiePanel() {
  const box = $("#cookieList");
  box.innerHTML = "";
  if (!cache.length) {
    box.innerHTML = '<div class="empty">还没有环境</div>';
    return;
  }
  for (const p of cache) {
    const row = document.createElement("div");
    row.className = "cookie-row";
    row.innerHTML = `
      <div class="ck-name"><b>${esc(p.name)}</b><span>${esc(p.group || "")} · ${p.proxy && p.proxy.host ? esc(p.proxy.type + " " + p.proxy.host) : "直连"}</span></div>
      <div class="ck-count" data-count="${p.id}">统计中…</div>
      <div class="row-actions">
        <button class="btn sm" data-exp="${p.id}">导出</button>
        <button class="btn sm" data-imp="${p.id}">导入</button>
        <button class="btn sm danger" data-clr="${p.id}">清空</button>
      </div>`;
    box.appendChild(row);
    try {
      const r = await window.api.cookieCount(p.id);
      row.querySelector("[data-count]").textContent =
        r && r.ok ? r.count + " 条" : "—";
    } catch (_) {
      row.querySelector("[data-count]").textContent = "—";
    }
    row.querySelector("[data-exp]").addEventListener("click", async (e) => {
      const b = e.target;
      b.disabled = true;
      try {
        const r = await window.api.cookieExport(p.id);
        if (r && r.canceled) return;
        if (r && r.ok) toast("已备份 " + r.count + " 条");
        else toast("备份失败：" + ((r && r.error) || "未知"));
      } catch (err) {
        toast("备份异常：" + err.message);
      } finally {
        b.disabled = false;
      }
    });
    row.querySelector("[data-imp]").addEventListener("click", async (e) => {
      const b = e.target;
      b.disabled = true;
      try {
        const r = await window.api.cookieImport(p.id);
        if (r && r.canceled) return;
        if (r && r.ok) {
          toast(
            "已恢复 " +
              r.okCount +
              " 条" +
              (r.failCount ? "，" + r.failCount + " 失败" : ""),
          );
          renderCookiePanel();
        } else toast("恢复失败：" + ((r && r.error) || "未知"));
      } catch (err) {
        toast("恢复异常：" + err.message);
      } finally {
        b.disabled = false;
      }
    });
    row.querySelector("[data-clr]").addEventListener("click", async (e) => {
      if (!confirm("确认清空「" + p.name + "」的全部 Cookie？该操作不可恢复。"))
        return;
      const b = e.target;
      b.disabled = true;
      try {
        const r = await window.api.cookieClear(p.id);
        if (r && r.ok) {
          toast("已清空 " + r.cleared + " 条");
          renderCookiePanel();
        } else toast("清空失败：" + ((r && r.error) || "未知"));
      } catch (err) {
        toast("清空异常：" + err.message);
      } finally {
        b.disabled = false;
      }
    });
  }
}

// ---------------- 功能规划 · 路线图（更新状态，代理/Cookie 已落地）----------------
const ROADMAP = [
  {
    name: "代理管理",
    status: "已上线",
    desc: "代理池集中管理：可用性检测、出口 IP/国家/时区查看。",
  },
  {
    name: "Cookie 全局管理",
    status: "已上线",
    desc: "跨环境 Cookie 导出/导入/清空，环境间完全隔离。",
  },
  {
    name: "分组 / 团队",
    status: "规划中",
    desc: "环境按业务分组，支持多成员协作与角色权限（查看 / 编辑 / 仅使用）。",
  },
  {
    name: "云端同步",
    status: "规划中",
    desc: "配置云端备份与多设备同步，换机不丢环境，团队共享模板。",
  },
  {
    name: "RPA 自动化",
    status: "规划中",
    desc: "内置流程编排：批量养号、定时发帖、表单自动填写，模拟真人节奏。",
  },
  {
    name: "数据看板",
    status: "规划中",
    desc: "环境使用率、代理消耗、检测评分统计，异常环境一键定位。",
  },
  {
    name: "账号仓库",
    status: "规划中",
    desc: "平台账号集中保管（FB / Google / TikTok 等），与指纹环境绑定。",
  },
  {
    name: "批量注册",
    status: "规划中",
    desc: "环境 + 代理 + 账号 + 指纹一键批量生成，对接注册流程。",
  },
];

// 菜单「新建环境」-> 打开弹窗
window.api &&
  window.api.onMenuNew &&
  window.api.onMenuNew(() => openModal(null));

// 控制台底部显示构建版本号，便于辨认是否最新包
try {
  const v = document.getElementById("version");
  if (v && window.api && window.api.version)
    v.textContent = window.api.version();
} catch (e) {}

// 全局错误兜底：仅记录到控制台（不再弹 toast/对话框，避免反复打扰用户）
window.addEventListener("error", (ev) => {
  try {
    console.error("[界面错误]", ev.message, ev.error);
  } catch (e) {}
});

$("#btnSave").onclick = async () => {
  const proxy = $("#f_proxy_on").checked
    ? {
        type: $("#p_type").value,
        host: $("#p_host").value.trim(),
        port: $("#p_port").value.trim(),
        user: $("#p_user").value.trim(),
        pass: $("#p_pass").value,
      }
    : { type: "socks5", host: "", port: "", user: "", pass: "" };
  const payload = {
    name: $("#f_name").value.trim() || "未命名环境",
    group: $("#f_group").value.trim() || "默认分组",
    os: $("#f_os").value,
    country: $("#f_country").value,
    startUrl: $("#f_url").value.trim() || "about:blank",
    note: $("#f_note").value.trim(),
    tags: $("#f_tags")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    proxy,
    // 语言：下拉为空 => 跟随出口 IP（langManual=false）；选中具体语言 => 手动锁定
    language: $("#f_language").value.trim(),
    langManual: !!$("#f_language").value.trim(),
    // 时区：下拉为空 => 自动跟随出口 IP 地理时区（根治 whoer 系统时差）；选中具体时区 => 手动锁定
    timezone: $("#f_timezone").value.trim(),
    timezoneManual: !!$("#f_timezone").value.trim(),
  };
  if (editingId) await window.api.update(editingId, payload);
  else await window.api.create(payload);
  modal.hidden = true;
  refresh();
  toast("已保存");
};

(async () => {
  refresh(); // 先渲染环境列表，避免 chrome() 异常/卡顿导致开屏空白
  try {
    const chrome = await window.api.chrome();
    // 该元素在部分版本 HTML 中不存在，必须先判空（否则 catch 里再次赋值会二次抛错）
    const el = $("#envStatus");
    if (el) {
      el.textContent = chrome
        ? "畅易浏览器内核就绪 ✓ " +
          chrome.split(/[\\/]/).pop() +
          " · 内置浏览器可用"
        : "未检测到 Chrome/Edge，可使用「应用内打开」（内置浏览器）";
    }
  } catch (e) {
    try {
      const el = $("#envStatus");
      if (el) el.textContent = "内置浏览器可用";
    } catch (_) {}
  }
})();
