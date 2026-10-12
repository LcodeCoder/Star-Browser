import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Command } from "cmdk";
import { Layers3, Network, Cookie, Bookmark, Download, History, Settings2, Search, Plus, ChevronDown, ChevronLeft, ChevronRight, ArrowUpRight, Play, Square, Pin, Archive, ArchiveRestore, Copy, Upload, RefreshCw, X, Check, AlertCircle, WifiOff, Command as CommandIcon, Folder, Globe2, Fingerprint, SlidersHorizontal, Monitor, CheckCircle2, ArrowDown, MoreHorizontal, LoaderCircle, Keyboard, Puzzle, PanelsTopLeft } from "lucide-react";
import { Logo, Button, IconButton, Menu, Modal, Field, Empty, Badge } from "./components";
import { WorkspaceContext, messageOf, osName, proxyLabel, timeAgo } from "./context";
import { ProfileEditor, ProfileDetail, ProfileMenu, COUNTRIES } from "./profiles";
import { ProxyPage, CookiePage, BookmarksPage, DownloadsPage, ActivityPage, SettingsPage } from "./pages";
import { SynchronizerPage } from "./synchronizer";
import { ExtensionsPage } from "./extensions";
const PAGE_SIZE = 75;
const pageMeta = { synchronizer: ["窗口同步", "在主控窗口操作，让选定环境跟随。"], extensions: ["扩展库", "为不同环境选择合适的浏览工具。"], environments: ["浏览环境", "找到要继续的工作，打开独立的浏览空间。"], proxies: ["代理库", "管理网络连接，检测后分配到浏览环境。"], cookies: ["Cookie", "备份、恢复和管理各环境的登录状态。"], bookmarks: ["书签", "把每天都会用到的页面留在手边。"], downloads: ["下载", "查看文件进度，回到下载的浏览环境。"], activity: ["工作记录", "查看这台设备上最近发生的操作。"], settings: ["设置", "调整外观、启动方式与日常使用偏好。"] };
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? <div className="crash-screen"><Logo /><h1>工作台遇到了问题</h1><p>{messageOf(this.state.error)}</p><Button variant="primary" onClick={() => location.reload()}>重新加载工作台</Button></div> : this.props.children;
  }
}
function App() {
  const [snapshot, setSnapshot] = useState(null), [loadError, setLoadError] = useState(""), [page, setPage] = useState("environments"), [filter, setFilter] = useState("all"), [group, setGroup] = useState(""), [query, setQuery] = useState(""), [tag, setTag] = useState(""), [sort, setSort] = useState("recent"), [selected, setSelected] = useState(/* @__PURE__ */ new Set()), [detail, setDetail] = useState(null), [editor, setEditor] = useState(void 0), [toast, setToast] = useState(null), [confirmState, setConfirm] = useState(null), [confirmBusy, setConfirmBusy] = useState(false), [commands, setCommands] = useState(false), [busy, setBusy] = useState(/* @__PURE__ */ new Set()), [batch, setBatch] = useState(null), [importState, setImport] = useState(null), [importBusy, setImportBusy] = useState(false), [offline, setOffline] = useState(!navigator.onLine), [offset, setOffset] = useState(0);
  const [commandQuery, setCommandQuery] = useState("");
  const snapshotRef = useRef(null), snapshotToken = useRef(null);
  const fetchId = useRef(0), toastTimer = useRef(null), searchRef = useRef(null), refreshing = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++fetchId.current;
    const result = await window.api.snapshot(snapshotToken.current);
    if (id === fetchId.current) {
      if (!result.unchanged) { snapshotToken.current = result.token; snapshotRef.current = result; setSnapshot(result); }
      setLoadError("");
    }
    return result.unchanged ? snapshotRef.current : result;
  }, []);
  const notify = useCallback((message, status = "success") => {
    if (!message) return;
    clearTimeout(toastTimer.current);
    setToast({ message, status });
    toastTimer.current = setTimeout(() => setToast(null), status === "error" ? 9e3 : 4500);
  }, []);
  const execute = useCallback(async (task, success) => {
    try {
      const result = await task();
      if (result?.ok === false) throw new Error(result.error || "操作未完成");
      await refresh();
      if (success) notify(typeof success === "function" ? success(result) : success);
      return result;
    } catch (e) {
      notify(messageOf(e), "error");
      return void 0;
    }
  }, [refresh, notify]);
  useEffect(() => {
    if (!window.api) {
      setLoadError("应用桥接尚未加载，请重新打开 Star Browser。");
      return;
    }
    refresh().catch((e) => setLoadError(messageOf(e)));
    const onChange = () => { if (!document.hidden) refresh().catch(e => setLoadError(messageOf(e))); };
    const offChanged = window.api.onWorkspaceChanged(onChange);
    document.addEventListener("visibilitychange", onChange);
    const timer = setInterval(() => {
      if (document.hidden || refreshing.current) return;
      refreshing.current = true;
      refresh().catch((e) => setLoadError(messageOf(e))).finally(() => refreshing.current = false);
    }, 5e3);
    return () => {
      clearInterval(timer);
      offChanged?.();
      document.removeEventListener("visibilitychange", onChange);
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const preference = snapshot.preferences.theme || "system", media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
      document.documentElement.dataset.density = snapshot.preferences.density || "comfortable";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snapshot?.preferences.theme, snapshot?.preferences.density]);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    const key = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommands((v) => !v);
      }
      if (mod && e.key.toLowerCase() === "f" && page === "environments") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        setDetail(null);
        setSelected(/* @__PURE__ */ new Set());
      }
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    const unsubscribe = window.api?.onMenuNew(() => setEditor(null));
    const offNavigate = window.api?.onNavigate((next) => {
      setPage(next);
      setDetail(null);
    });
    const offPreferences = window.api?.onPreferences(() => refresh().catch(() => {
    }));
    const offCommand = window.api?.onBrowserCommand((command) => {
      if (command === "palette") setCommands(true);
      if (command === "search") {
        setPage("environments");
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    });
    return () => {
      document.removeEventListener("keydown", key);
      unsubscribe?.();
      offNavigate?.();
      offCommand?.();
      offPreferences?.();
    };
  }, [page]);
  useEffect(() => setOffset(0), [query, filter, group, tag, sort]);
  const running = useMemo(() => new Map((snapshot?.runtime || []).map((r) => [r.id, r])), [snapshot?.runtime]);
  const navigate = (next, nextFilter = "all", nextGroup = "") => {
    setPage(next);
    setFilter(nextFilter);
    setGroup(nextGroup);
    setDetail(null);
    setSelected(/* @__PURE__ */ new Set());
    setQuery("");
    setTag("");
    setOffset(0);
  };
  const openProfile = async (id, engine = "browse") => {
    if (busy.has(id)) return;
    setBusy((b) => /* @__PURE__ */ new Set([...b, id]));
    try {
      if (running.get(id)?.running && engine === "browse") await window.api.action("focus", [id]);
      else await window.api[engine](id);
      await refresh();
      notify("浏览器已就绪");
    } catch (e) {
      notify(messageOf(e), "error");
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  };
  const profiles = useMemo(() => {
    if (!snapshot) return [];
    const term = query.trim().toLowerCase();
    return snapshot.profiles.filter((p) => (filter === "archive" ? !!p.archived : !p.archived) && (filter !== "running" || running.get(p.id)?.running) && (filter !== "pinned" || p.pinned) && (!group || p.group === group) && (!tag || (p.tags || []).includes(tag)) && (!term || [p.name, p.group, p.note, p.id, proxyLabel(p.proxy), ...p.tags || []].join(" ").toLowerCase().includes(term))).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : sort === "created" ? b.createdAt - a.createdAt : (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt)));
  }, [snapshot?.profiles, filter, group, tag, query, sort, running]);
  const visible = profiles.slice(offset, offset + PAGE_SIZE);
  const selectedProfile = snapshot?.profiles.find((p) => p.id === detail);
  const select = (id) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const startBatch = async () => {
    const ids = [...selected];
    let completed = 0, failed = [];
    for (const id of ids) {
      setBusy((b) => /* @__PURE__ */ new Set([...b, id]));
      try {
        await window.api.browse(id);
        completed++;
      } catch (e) {
        failed.push(messageOf(e));
      } finally {
        setBusy((b) => {
          const s = new Set(b);
          s.delete(id);
          return s;
        });
      }
    }
    await refresh();
    notify(failed.length ? `已启动 ${completed} 个环境，${failed.length} 个失败：${failed[0]}` : `已启动 ${completed} 个环境`, failed.length ? "error" : "success");
  };
  const importPreview = async () => {
    setImportBusy(true);
    try {
      const result = await window.api.importPreview();
      if (!result.canceled) setImport(result);
    } catch (e) {
      notify(messageOf(e), "error");
    } finally {
      setImportBusy(false);
    }
  };
  useEffect(() => { if (commands) setCommandQuery(""); }, [commands]);
  const commandProfiles = useMemo(() => {
    const terms = commandQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (snapshot?.profiles || []).filter(p => !p.archived && terms.every(term => [p.name,p.group,p.id,p.note,...(p.tags || [])].join(" ").toLowerCase().includes(term))).slice(0,200);
  }, [snapshot?.profiles, commandQuery]);
  const context = { snapshot, refresh, notify, execute, openProfile, confirm: setConfirm };
  if (!snapshot) return <div className="startup"><Logo /><h1>Star Browser</h1>{loadError ? <><p className="inline-error" role="alert">{loadError}</p><Button onClick={() => refresh().catch((e) => setLoadError(messageOf(e)))} icon={RefreshCw}>重新加载</Button></> : <p><LoaderCircle className="spin" size={17} />正在准备你的工作台…</p>}</div>;
  const activeProfiles = snapshot.profiles.filter((p) => !p.archived);
  const groups = [...new Set(activeProfiles.map((p) => p.group || "默认分组"))].sort();
  const tags = [...new Set(activeProfiles.flatMap((p) => p.tags || []))];
  const [heading, description] = pageMeta[page];
  return <WorkspaceContext.Provider value={context}><div className="workspace"><aside className="sidebar"><button className="brand" onClick={() => navigate("environments")} aria-label="Star Browser 首页"><Logo /><div><strong>Star Browser</strong><span>你的独立浏览工作台</span></div></button><button className="workspace-picker" onClick={() => notify("当前工作空间保存在这台 Mac 上")}><div className="workspace-avatar">S</div><span>我的工作空间<small>此设备</small></span><ChevronDown size={15} /></button><nav aria-label="主导航"><div className="nav-label">工作台</div>{[["environments", "浏览环境", Layers3, "navEnv"], ["proxies", "代理库", Network, "navProxy"], ["cookies", "Cookie", Cookie, "navCookie"], ["bookmarks", "书签", Bookmark, "navBookmarks"], ["downloads", "下载", Download, "navDownloads"], ["extensions", "扩展库", Puzzle, "navExtensions"], ["synchronizer", "窗口同步", PanelsTopLeft, "navSynchronizer"], ["activity", "工作记录", History, "navActivity"]].map(([key, label, Icon, id]) => <button id={id} key={key} className={"nav-item" + (page === key ? " active" : "")} onClick={() => navigate(key)}><Icon size={18} /><span>{label}</span>{key === "environments" && <small>{activeProfiles.length}</small>}</button>)}<div className="nav-group-heading"><span className="nav-label">分组</span><IconButton icon={Plus} label="新建分组环境" onClick={() => setEditor(null)} /></div>{groups.length ? groups.slice(0, 15).map((name, index) => <button key={name} className={"group-item" + (page === "environments" && group === name ? " selected" : "")} onClick={() => navigate("environments", "all", name)}><span className={"group-dot color-" + index % 4} /><span>{name}</span><small>{activeProfiles.filter((p) => (p.group || "默认分组") === name).length}</small></button>) : <p className="sidebar-empty">新建环境时可添加分组</p>}</nav><div className="sidebar-bottom"><button className="command-launcher" onClick={() => setCommands(true)}><Search size={16} /><span>搜索与快速操作</span><kbd>⌘ K</kbd></button><button id="navSettings" className={"nav-item" + (page === "settings" ? " active" : "")} onClick={() => navigate("settings")}><Settings2 size={18} /><span>设置</span></button><div className="sidebar-status"><span className={"status-dot " + (offline ? "offline" : "")} /><span>{offline ? "离线 · 本地工作台" : "本地工作台已就绪"}</span><span className="version">{snapshot.engine.version}</span></div></div></aside>
 <main className="main"><header className="page-header"><div className="page-title"><div className="breadcrumb">我的工作空间 <ChevronRight size={12} /> {heading}</div><h1>{group || heading}{page === "environments" && <span className="title-count">{profiles.length}</span>}</h1><p>{description}</p></div><div className="header-actions">{page === "environments" && <><Menu items={[{ label: "导入环境", icon: Upload, disabled: importBusy, action: importPreview }, { label: "导出所有环境", icon: Download, action: () => execute(() => window.api.exportProfiles([]), (r) => r.canceled ? "已取消导出" : `已导出 ${r.count} 个环境`) }]}><Button icon={Upload}>导入 / 导出<ChevronDown size={13} /></Button></Menu><Button id="btnNew" variant="primary" icon={Plus} onClick={() => setEditor(null)}>新建环境</Button></>}<IconButton icon={RefreshCw} label="刷新工作台" onClick={() => execute(refresh, "已刷新")} /></div></header>
 {offline && <div className="network-banner"><WifiOff size={15} /><span>当前离线，本地环境与数据仍可管理。网页和网络检测需要连接网络。</span></div>}{loadError && <div className="error-banner" role="alert"><AlertCircle size={16} /><span>{loadError}</span><Button variant="text" onClick={() => execute(refresh)}>重试</Button></div>}
 {page === "environments" ? <div className={"environment-workspace" + (selectedProfile ? " with-detail" : "")}><section className="environment-main"><div className="view-tabs" aria-label="环境视图">{[["all", "全部环境", null], ["running", "运行中", running.size && snapshot.runtime.filter((r) => r.running).length], ["pinned", "已置顶", null], ["archive", "归档", null]].map(([value, label, count]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => {
    setFilter(value);
    setDetail(null);
    setSelected(/* @__PURE__ */ new Set());
  }}>{label}{count > 0 && <span>{count}</span>}</button>)}</div><div className="page-toolbar environment-toolbar"><div className="search-box"><Search size={17} /><input id="search" ref={searchRef} placeholder="搜索名称、标签或代理…" aria-label="搜索环境" value={query} onChange={(e) => setQuery(e.target.value)} />{query ? <IconButton icon={X} label="清除搜索" onClick={() => setQuery("")} /> : <kbd>⌘ F</kbd>}</div><div className="toolbar-filters"><select aria-label="筛选标签" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">所有标签</option>{tags.map((t) => <option key={t}>{t}</option>)}</select><select aria-label="排序方式" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">最近使用</option><option value="name">名称排序</option><option value="created">最新创建</option></select></div></div>
 {selected.size > 0 && <div className="batch-bar" id="batchBar"><span id="batchCount">已选 {selected.size} 个</span><Button id="batchOpen" icon={Play} variant="primary" disabled={busy.size > 0 || filter === "archive"} onClick={startBatch}>启动</Button><Button icon={Square} onClick={() => execute(() => window.api.action("stop", [...selected]), "选中浏览器已停止")}>停止</Button><Menu items={[{ label: "更改分组 / 标签 / 代理", icon: Settings2, action: () => setBatch({ group: "", tags: "", proxyId: "keep" }) }, { label: "复制所选环境", icon: Copy, action: () => execute(() => window.api.action("clone", [...selected]), "选中环境已复制") }, { label: "导出所选配置", icon: Download, action: () => execute(() => window.api.exportProfiles([...selected]), (r) => r.canceled ? "已取消" : "选中环境已导出") }, { label: filter === "archive" ? "恢复所选" : "移入归档", icon: Archive, action: async () => {
    const r = await execute(() => window.api.action(filter === "archive" ? "restore" : "archive", [...selected]), filter === "archive" ? "环境已恢复" : "环境已归档");
    if (r) setSelected(/* @__PURE__ */ new Set());
  } }]} /><span className="toolbar-spacer" /><IconButton icon={X} label="取消选择" id="batchClear" onClick={() => setSelected(/* @__PURE__ */ new Set())} /></div>}
 {profiles.length ? <><div className="environment-table object-table"><table><thead><tr><th className="select-cell"><input type="checkbox" id="selAll" aria-label="选择本页环境" checked={visible.length > 0 && visible.every((p) => selected.has(p.id))} onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((p) => p.id)) : /* @__PURE__ */ new Set())} /></th><th>环境名称</th><th className="network-column">网络 / 地区</th><th className="last-column">最近打开</th><th className="align-right">操作</th></tr></thead><tbody id="rows">{visible.map((p) => <tr key={p.id} data-profile-id={p.id} className={(detail === p.id ? "focused " : "") + (selected.has(p.id) ? "checked" : "")} onClick={() => setDetail(p.id)}><td className="select-cell" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`选择 ${p.name}`} checked={selected.has(p.id)} onChange={() => select(p.id)} /></td><td><div className="profile-name-cell"><div className={"environment-avatar avatar-" + p.os}><Monitor size={17} /></div><div className="profile-main-info"><button className="profile-name" onClick={() => setDetail(p.id)}>{p.name}{p.pinned && <Pin size={12} />}</button><div className="profile-secondary"><span>{osName(p.os)}</span>{(p.tags || []).slice(0, 2).map((t) => <span className="tag" key={t}>{t}</span>)}{busy.has(p.id) ? <Badge status="busy">启动中</Badge> : running.get(p.id)?.running && <Badge status="success">运行中</Badge>}</div></div></div></td><td className="network-column"><div className="network-cell"><Globe2 size={14} /><span title={proxyLabel(p.proxy)}>{p.proxy?.host ? proxyLabel(p.proxy) : "本机网络"}</span></div><small>{p.country} · {p.timezoneManual ? p.timezone : "自动时区"}</small></td><td className="last-column muted">{timeAgo(p.lastOpenedAt)}</td><td onClick={(e) => e.stopPropagation()}><div className="row-actions"><button className={"button launch-button" + (running.get(p.id)?.running ? " running" : "")} disabled={busy.has(p.id) || p.archived} onClick={() => openProfile(p.id)}>{busy.has(p.id) ? <LoaderCircle size={14} className="spin" /> : running.get(p.id)?.running ? <ArrowUpRight size={14} /> : <Play size={14} />}<span>{busy.has(p.id) ? "启动中" : running.get(p.id)?.running ? "打开" : "启动"}</span></button><button className="icon-button row-detail-button" data-act="fp" data-id={p.id} aria-label={`${p.name} 指纹详情`} onClick={() => setDetail(p.id)}><Fingerprint size={16} /></button><button className="icon-button row-detail-button" data-act="edit" data-id={p.id} aria-label={`编辑 ${p.name}`} onClick={() => setEditor(p)}><Settings2 size={16} /></button><ProfileMenu profile={p} onDetail={setDetail} onEdit={setEditor} /></div></td></tr>)}</tbody></table></div><footer className="list-footer"><span>{offset + 1}–{Math.min(offset + PAGE_SIZE, profiles.length)}，共 {profiles.length} 个环境</span><span className="toolbar-spacer" />{profiles.length > PAGE_SIZE && <><IconButton icon={ChevronLeft} label="上一页" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} /><IconButton icon={ChevronRight} label="下一页" disabled={offset + PAGE_SIZE >= profiles.length} onClick={() => setOffset(offset + PAGE_SIZE)} /></>}<span>配置与浏览数据保存在本机</span></footer></> : <Empty icon={filter === "archive" ? Archive : filter === "running" ? Play : Layers3} title={query || tag || group ? "没有找到匹配的环境" : filter === "running" ? "还没有运行中的环境" : filter === "pinned" ? "把常用环境置顶" : filter === "archive" ? "归档中没有环境" : "为下一段工作，新建一个环境"} description={query || tag || group ? "试试其他关键词，或清除筛选条件。" : filter === "running" ? "从全部环境启动浏览器，正在进行的工作会显示在这里。" : filter === "pinned" ? "在环境的更多操作中选择“置顶环境”，下次更快找到。" : filter === "archive" ? "暂时不用的环境可以归档，数据与配置都会保留。" : "不同账号的 Cookie、存储和浏览配置会各自独立保存。"}>{query || tag || group ? <Button onClick={() => {
    setQuery("");
    setTag("");
    setGroup("");
  }}>清除筛选</Button> : filter === "all" ? <Button variant="primary" icon={Plus} onClick={() => setEditor(null)}>新建第一个环境</Button> : filter === "running" ? <Button onClick={() => setFilter("all")}>查看全部环境</Button> : null}</Empty>}</section>{selectedProfile && <ProfileDetail profile={selectedProfile} onClose={() => setDetail(null)} onEdit={setEditor} />}</div> : <div className="page-content">{page === "synchronizer" ? <SynchronizerPage /> : page === "extensions" ? <ExtensionsPage /> : page === "proxies" ? <ProxyPage /> : page === "cookies" ? <CookiePage /> : page === "bookmarks" ? <BookmarksPage /> : page === "downloads" ? <DownloadsPage /> : page === "activity" ? <ActivityPage /> : <SettingsPage />}</div>}
 </main></div>
 {editor !== void 0 && <ProfileEditor key={editor?.id || "new"} profile={editor} onClose={() => setEditor(void 0)} />}
 <Modal open={!!confirmState} onOpenChange={(v) => !v && !confirmBusy && setConfirm(null)} title={confirmState?.title || ""} description={confirmState?.description || ""} footer={<><Button disabled={confirmBusy} onClick={() => setConfirm(null)}>取消</Button><Button variant="danger-solid" disabled={confirmBusy} onClick={async () => {
    setConfirmBusy(true);
    try {
      await confirmState.run();
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  }}>{confirmBusy ? "处理中…" : confirmState?.label || "确认"}</Button></>} />
 <Modal open={!!batch} onOpenChange={(v) => !v && setBatch(null)} title="批量更改配置" description={`更改选中的 ${selected.size} 个环境。留空的字段会保持原值。`} footer={<><Button onClick={() => setBatch(null)}>取消</Button><Button variant="primary" onClick={async () => {
    const patch = {};
    if (batch.group.trim()) patch.group = batch.group.trim();
    if (batch.tags.trim()) patch.tags = batch.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (batch.proxyId !== "keep") patch.proxy = batch.proxyId === "direct" ? null : snapshot.proxies.find((p) => p.id === batch.proxyId);
    const r = await execute(() => window.api.action("update", [...selected], patch), "选中环境已更新");
    if (r) setBatch(null);
  }}>保存更改</Button></>}><div className="form-grid"><Field label="分组" className="span-2"><input value={batch?.group || ""} onChange={(e) => setBatch((b) => ({ ...b, group: e.target.value }))} placeholder="保留当前分组" /></Field><Field label="替换标签" className="span-2"><input value={batch?.tags || ""} onChange={(e) => setBatch((b) => ({ ...b, tags: e.target.value }))} placeholder="逗号分隔；留空则保留" /></Field><Field label="代理配置" className="span-2"><select value={batch?.proxyId || "keep"} onChange={(e) => setBatch((b) => ({ ...b, proxyId: e.target.value }))}><option value="keep">保留当前代理</option><option value="direct">使用本机网络</option>{snapshot.proxies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div></Modal>
 <Modal open={!!importState} onOpenChange={(v) => !v && !importBusy && setImport(null)} title="确认导入环境" description={`文件已通过配置校验，包含 ${importState?.count || 0} 个环境。将建立新的独立环境，已有数据会保留。`} footer={<><Button disabled={importBusy} onClick={() => setImport(null)}>取消</Button><Button variant="primary" disabled={importBusy} onClick={async () => {
    setImportBusy(true);
    const r = await execute(() => window.api.importApply(importState.token), (r2) => `已导入 ${r2.count} 个环境`);
    if (r) setImport(null);
    setImportBusy(false);
  }}>导入 {importState?.count || 0} 个环境</Button></>}><div className="import-preview">{importState?.profiles.slice(0, 30).map((p, i) => <div key={i}><strong>{p.name}</strong><span>{osName(p.os || "mac")} · {p.group || "默认分组"}</span></div>)}{importState?.count > 30 && <p className="muted">另有 {importState.count - 30} 个环境</p>}</div></Modal>
 <Modal open={commands} onOpenChange={setCommands} title="搜索与快速操作" description="搜索环境名称，或选择常用操作。"><Command className="command-palette" label="快速操作" filter={(value, search) => search.toLowerCase().trim().split(/\s+/).every(term => value.toLowerCase().includes(term)) ? 1 : 0}><Command.Input autoFocus value={commandQuery} onValueChange={setCommandQuery} placeholder="输入环境名、标签或操作…" /><Command.List><Command.Empty>没有找到匹配的环境或操作。</Command.Empty><Command.Group heading="快速操作">{[["新建环境", Plus, () => setEditor(null)], ["代理库", Network, () => navigate("proxies")], ["设置", Settings2, () => navigate("settings")], ["导入环境", Upload, importPreview]].map(([label, Icon, action]) => <Command.Item key={label} onSelect={() => {
    setCommands(false);
    action();
  }}><Icon size={17} />{label}</Command.Item>)}</Command.Group><Command.Group heading="浏览环境">{commandProfiles.map((p) => <Command.Item value={[p.name,p.group,p.id,p.note,...(p.tags || [])].join(" ")} key={p.id} onSelect={() => {
    setCommands(false);
    navigate("environments");
    setDetail(p.id);
  }}><Monitor size={17} /><span>{p.name}</span><small>{p.group}</small></Command.Item>)}</Command.Group></Command.List></Command></Modal>
 {toast && <div className={"toast " + toast.status} role={toast.status === "error" ? "alert" : "status"}>{toast.status === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><IconButton icon={X} label="关闭提示" onClick={() => setToast(null)} /></div>}
 </WorkspaceContext.Provider>;
}
createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);
