"use strict";
/**
 * 环境数据存储（MVP：本地 JSON 文件；后期可平滑替换为 SQLite + 云端同步）
 * 数据结构：一个 profile（环境）= 一套指纹 + 代理 + 启动配置 + 备注/分组
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validateProfile, validateProxy } = require("./profile-validation");

// 默认收藏夹（首次运行时写入；之后用户可自由增删，不影响已存环境）
const DEFAULT_BOOKMARKS = [
  { title: "Google", url: "https://www.google.com" },
  { title: "BrowserLeaks", url: "https://browserleaks.com" },
];

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.file = path.join(userDataDir, "profiles.json");
    this._data = { profiles: [], updatedAt: 0 };
    this._load();
    this._data.proxies ||= [];
    this._data.activity ||= [];
    this._data.downloads ||= [];
    this._data.preferences ||= { theme: "system", density: "comfortable" };
    // 首次运行（无 bookmarks 字段）时写入默认收藏夹；已有数据则保留用户收藏。
    if (!Array.isArray(this._data.bookmarks)) {
      // 默认种子即「官方托管收藏」，标记为 cloud；用户后续自加的标记 user，互不覆盖。
      this._data.bookmarks = DEFAULT_BOOKMARKS.map((b) => ({
        id: crypto.randomUUID(),
        title: b.title,
        url: b.url,
        source: "cloud",
        createdAt: Date.now(),
      }));
      this._save();
    }
    // 最常访问记录（驱动 New Tab 快捷入口，自动适应用户习惯）
    if (!this._data.visits || typeof this._data.visits !== "object")
      this._data.visits = {};
  }

  _load() {
    if (!fs.existsSync(this.file)) return;
    const read = file => {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (!Array.isArray(data.profiles)) throw new Error("环境数据格式无效");
      return data;
    };
    try { this._data = read(this.file); }
    catch (error) {
      // Recover the last complete write; preserve the malformed file for diagnosis.
      const backup = this.file + ".bak";
      if (!fs.existsSync(backup)) throw new Error("环境数据无法读取：" + error.message);
      fs.copyFileSync(this.file, this.file + ".corrupt-" + Date.now());
      this._data = read(backup);
    }
  }

  _save() {
    clearTimeout(this._saveTimer);
    this._data.updatedAt = Date.now();
    fs.mkdirSync(this.dir, { recursive: true });
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(this._data, null, 2), { encoding: "utf-8", mode: 0o600 });
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak");
    fs.renameSync(temporary, this.file);
  }

  flush() { if (this._saveTimer) this._save(); }

  list() {
    return this._data.profiles;
  }

  get(id) {
    return this._data.profiles.find((p) => p.id === id);
  }

  create(partial) {
    partial = validateProfile(partial, true);
    const id = crypto.randomUUID();
    const now = Date.now();
    const profile = {
      id,
      name: partial.name || "新环境",
      group: partial.group || "默认分组",
      note: partial.note || "",
      tags: partial.tags || [],
      os: partial.os || "mac",
      country: partial.country || "US",
      timezone: partial.timezone || "", // 空 = 自动跟随出口 IP 地理时区
      timezoneManual: partial.timezoneManual || false, // true = 使用上面手动指定的 timezone
      language: partial.language || "",
      webrtc: partial.webrtc || "disable",
      langManual: partial.langManual || false, // true = 使用手动指定的 language
      proxy: partial.proxy || null, // { type:'http'|'socks5', host, port, user, pass }
      startUrl: partial.startUrl || "about:home",
      seed: partial.seed || id, // 用环境ID作为指纹种子，保证唯一且稳定
      pinned: !!partial.pinned,
      archived: !!partial.archived,
      restoreSession: partial.restoreSession !== false,
      fingerprint: partial.fingerprint || {},
      permissions: partial.permissions || {},
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: 0,
    };
    this._data.profiles.push(profile);
    this._save();
    return profile;
  }

  update(id, patch) {
    const p = this.get(id);
    if (!p) return null;
    Object.assign(p, validateProfile(patch), { updatedAt: Date.now() });
    this._save();
    return p;
  }

  remove(id) {
    const idx = this._data.profiles.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this._data.profiles.splice(idx, 1);
      this._save();
      return true;
    }
    return false;
  }

  touchOpened(id) {
    const p = this.get(id);
    if (p) {
      p.lastOpenedAt = Date.now();
      this._save();
    }
  }

  clone(id) {
    const original = this.get(id);
    if (!original) throw new Error("环境不存在");
    return this.create({ ...original, name: original.name + " 副本", seed: undefined, pinned: false, archived: false });
  }
  listProxies() { return this._data.proxies; }
  saveProxy(input) {
    const proxy = validateProxy(input);
    if (!proxy) throw new Error("请填写代理地址");
    const existing = this._data.proxies.find(p => p.id === input.id);
    if (existing) Object.assign(existing, proxy, { name: String(input.name || proxy.host).slice(0,120), updatedAt: Date.now() });
    else this._data.proxies.push({ ...proxy, id: crypto.randomUUID(), name: String(input.name || proxy.host).slice(0,120), createdAt: Date.now() });
    this._save(); return existing || this._data.proxies.at(-1);
  }
  removeProxy(id) { this._data.proxies = this._data.proxies.filter(p => p.id !== id); this._save(); }
  setProxyResult(id, result) {
    const proxy = this._data.proxies.find(p => p.id === id);
    if (proxy) { proxy.check = {...result, checkedAt:Date.now()}; this._save(); }
  }
  activity(action, name = "", detail = "") {
    this._data.activity.unshift({id:crypto.randomUUID(),action,name,detail,time:Date.now()});
    this._data.activity = this._data.activity.slice(0,1000); this._save();
  }
  activities() { return this._data.activity; }
  preferences(patch) {
    if (patch) {
      for (const key of ["theme","density","searchEngine"]) if (typeof patch[key] === "string") this._data.preferences[key]=patch[key];
      this._save();
    }
    return this._data.preferences;
  }
  sessionTabs(id, tabs, activeIndex) {
    const p=this.get(id); if (!p) return;
    p.sessionTabs=(Array.isArray(tabs)?tabs:[]).filter(t=>/^https?:\/\//i.test(t.url||"")).slice(0,50).map(t=>({url:String(t.url).slice(0,4096),title:String(t.title||"").slice(0,120)}));
    p.sessionActive=Number(activeIndex)||0; this._save();
  }
  saveDownload(download) {
    const index=this._data.downloads.findIndex(d=>d.id===download.id);
    if (index>=0) this._data.downloads[index]=download; else this._data.downloads.unshift(download);
    this._data.downloads=this._data.downloads.slice(0,300); this._save();
  }
  downloads() { return this._data.downloads; }

  // ---------------- 收藏夹（全局共享，跨环境） ----------------
  listBookmarks() {
    // 隐藏的官方书签（用户主动隐藏）不展示
    return (this._data.bookmarks || []).filter((b) => !b.hidden);
  }

  addBookmark(bm) {
    if (!this._data.bookmarks) this._data.bookmarks = [];
    const url = (bm && bm.url) || "";
    if (!url) return null;
    const item = {
      id: crypto.randomUUID(),
      title: (bm && bm.title) || url,
      url,
      source: "user",
      createdAt: Date.now(),
    };
    this._data.bookmarks.push(item);
    this._save();
    return item;
  }

  // 合并云端托管收藏（source=cloud）：以 id 为键整体替换为云端列表，用户自加(source=user)不受影响。
  // 云端未提供 bookmarks 时不改动（保留现有官方/用户收藏）。
  mergeCloudBookmarks(cloudList) {
    if (!Array.isArray(cloudList) || !cloudList.length) return;
    const userBms = (this._data.bookmarks || []).filter(
      (b) => b.source === "user",
    );
    const hidden = new Set(
      (this._data.bookmarks || [])
        .filter((b) => b.source === "cloud" && b.hidden)
        .map((b) => b.id),
    );
    const cloud = cloudList.map((b) => {
      const id = b.id || "cloud-" + this._normUrl(b.url || "");
      const item = {
        id,
        title: b.title || b.url || id,
        url: b.url,
        source: "cloud",
        createdAt: Date.now(),
      };
      if (hidden.has(id)) item.hidden = true;
      return item;
    });
    this._data.bookmarks = [...userBms, ...cloud];
    this._save();
  }

  removeBookmark(id) {
    if (!this._data.bookmarks) return false;
    const idx = this._data.bookmarks.findIndex((b) => b.id === id);
    if (idx >= 0) {
      this._data.bookmarks.splice(idx, 1);
      this._save();
      return true;
    }
    return false;
  }

  updateBookmark(id, patch) {
    if (!this._data.bookmarks) return null;
    const b = this._data.bookmarks.find((x) => x.id === id);
    if (!b) return null;
    if (patch && patch.title !== undefined) b.title = patch.title;
    if (patch && patch.url !== undefined) b.url = patch.url;
    b.updatedAt = Date.now();
    this._save();
    return b;
  }

  // ---------------- 最常访问（适应用户习惯，驱动 New Tab 快捷入口） ----------------
  // 以「规范化 URL」为键累计访问次数；New Tab 取 Top-N 展示。
  _normUrl(u) {
    try {
      const x = new URL(u);
      return (x.origin + x.pathname).replace(/\/$/, "");
    } catch (e) {
      return u;
    }
  }
  recordVisit(url, title) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (!this._data.visits) this._data.visits = {};
    const key = this._normUrl(url);
    const cur = this._data.visits[key] || {
      url,
      title: title || url,
      count: 0,
      last: 0,
    };
    cur.count = (cur.count || 0) + 1;
    cur.last = Date.now();
    if (title) cur.title = title;
    this._data.visits[key] = cur;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 500);
    this._saveTimer.unref?.();
  }
  topVisits(n) {
    const v = this._data.visits || {};
    return Object.values(v)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, n || 8);
  }
}

module.exports = { Store };
