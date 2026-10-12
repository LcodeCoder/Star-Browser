import React, { useState, useEffect } from "react";
import { Network, Plus, Upload, Download, Play, Check, X, RefreshCw, MoreHorizontal, Cookie, Trash2, Pencil, ExternalLink, Bookmark, FolderOpen, ArrowDownToLine, Pause, Square, Settings2, Sun, Moon, Monitor, Keyboard, ShieldCheck, History, Globe2, Copy, ArrowUpRight } from "lucide-react";
import { Button, IconButton, Menu, Modal, Field, Empty, Badge, Logo } from "./components";
import { useWorkspace, proxyLabel, dateTime, timeAgo, messageOf } from "./context";
function ProxyPage() {
  const { snapshot, execute, confirm, refresh, notify } = useWorkspace();
  const [editor, setEditor] = useState(null), [batch, setBatch] = useState(false), [busy, setBusy] = useState(/* @__PURE__ */ new Set()), [query, setQuery] = useState(""), [assignment, setAssignment] = useState(null), [target, setTarget] = useState("");
  const check = async (proxy) => {
    setBusy((b) => /* @__PURE__ */ new Set([...b, proxy.id]));
    try {
      const start = performance.now(), result = await window.api.proxyCheck(proxy);
      await window.api.proxyResult(proxy.id, { ...result, latency: Math.round(performance.now() - start) });
      await refresh();
      notify(result.ok ? "代理检测完成" : result.error || "代理连接失败", result.ok ? "success" : "error");
    } catch (e) {
      notify(messageOf(e), "error");
    } finally {
      setBusy((b) => {
        const s = new Set(b);
        s.delete(proxy.id);
        return s;
      });
    }
  };
  const list = snapshot.proxies.filter((p) => (p.name + " " + p.host).toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-toolbar"><div className="search-box"><Network size={17} /><input aria-label="搜索代理" placeholder="搜索名称或地址" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span className="toolbar-spacer" /><Button icon={Upload} onClick={() => setBatch(true)}>批量导入</Button><Button icon={Plus} variant="primary" onClick={() => setEditor({})}>添加代理</Button></div>{list.length ? <div className="object-table"><table><thead><tr><th>名称与地址</th><th>协议</th><th>最近检测</th><th>出口 IP / 地区</th><th className="align-right">操作</th></tr></thead><tbody>{list.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{proxyLabel(p)}</small></td><td><span className="tag">{p.type.toUpperCase()}</span></td><td>{busy.has(p.id) ? <Badge status="busy">检测中…</Badge> : p.check ? <><Badge status={p.check.ok ? "success" : "error"}>{p.check.ok ? "可连接" : "连接失败"}</Badge><small>{p.check.ok ? p.check.latency + " ms" : p.check.error}</small></> : <span className="muted">尚未检测</span>}</td><td><span>{p.check?.ip || p.check?.exitIp || "—"}</span><small>{[p.check?.country, p.check?.city].filter(Boolean).join(" · ") || "未取得出口信息"}</small></td><td><div className="row-actions"><Button icon={RefreshCw} disabled={busy.has(p.id)} onClick={() => check(p)}>检测</Button><Menu items={[{ label: "编辑代理", icon: Pencil, action: () => setEditor(p) }, { label: "分配给环境", icon: ArrowUpRight, action: () => {
    setTarget("");
    setAssignment(p);
  } }, { separator: true }, { label: "删除代理", icon: Trash2, danger: true, action: () => confirm({ title: "删除代理配置？", description: "已分配到环境的连接配置会保留。", label: "删除配置", run: () => execute(() => window.api.proxyRemove(p.id), "代理已删除") }) }]} /></div></td></tr>)}</tbody></table></div> : <Empty icon={Network} title={query ? "没有找到这个代理" : "为工作准备网络连接"} description={query ? "试试其他名称或代理地址。" : "添加 HTTP、HTTPS 或 SOCKS5 代理，检测后分配到环境。"}><Button variant="primary" icon={Plus} onClick={() => setEditor({})}>添加代理</Button></Empty>}{editor && <ProxyEditor initial={editor} onClose={() => setEditor(null)} />} {batch && <TextImport onClose={() => setBatch(false)} title="批量导入代理" description="每行一个代理，支持 http://user:pass@host:port 和 host:port:user:pass。" run={(text) => window.api.proxyImport(text)} />}<Modal open={!!assignment} onOpenChange={(v) => !v && setAssignment(null)} title="分配代理" description={assignment ? `${assignment.name} · ${proxyLabel(assignment)}` : ""} footer={<><Button onClick={() => setAssignment(null)}>取消</Button><Button variant="primary" disabled={!target} onClick={async () => {
    await execute(() => window.api.update(target, { proxy: assignment }), "代理已分配，下次启动生效");
    setAssignment(null);
  }}>分配到环境</Button></>}><Field label="选择环境"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">请选择</option>{snapshot.profiles.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></Modal></>;
}
function ProxyEditor({ initial, onClose }) {
  const { refresh, notify } = useWorkspace();
  const [form, setForm] = useState({ name: "", type: "http", host: "", port: "", user: "", pass: "", ...initial }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const save = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await window.api.proxySave(form);
      await refresh();
      notify("代理已保存");
      onClose();
    } catch (e2) {
      setError(messageOf(e2));
    } finally {
      setBusy(false);
    }
  };
  return <Modal open onOpenChange={(v) => !v && !busy && onClose()} title={initial.id ? "编辑代理" : "添加代理"} description="配置会保存在这台设备上。" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" type="submit" form="proxy-form" disabled={busy}>{busy ? "保存中…" : "保存代理"}</Button></>}><form id="proxy-form" onSubmit={save} className="form-grid"><Field label="名称" className="span-2"><input autoFocus required value={form.name} placeholder="例如：日本工作网络" onChange={(e) => update("name", e.target.value)} /></Field><Field label="协议"><select value={form.type} onChange={(e) => update("type", e.target.value)}>{["http", "https", "socks5"].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></Field><Field label="端口"><input required inputMode="numeric" value={form.port} placeholder="8080" onChange={(e) => update("port", e.target.value)} /></Field><Field label="地址" className="span-2"><input required value={form.host} placeholder="proxy.example.com" onChange={(e) => update("host", e.target.value)} /></Field><Field label="账号"><input value={form.user} onChange={(e) => update("user", e.target.value)} /></Field><Field label="密码"><input type="password" autoComplete="new-password" value={form.pass} onChange={(e) => update("pass", e.target.value)} /></Field>{error && <div className="inline-error span-2" role="alert">{error}</div>}</form></Modal>;
}
function TextImport({ title, description, onClose, run }) {
  const { refresh, notify } = useWorkspace();
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal open onOpenChange={(v) => !v && !busy && onClose()} title={title} description={description} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!text.trim() || busy} onClick={async () => {
    setBusy(true);
    try {
      const r = await run(text);
      await refresh();
      notify(`已导入 ${r.count} 条记录`);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }}>{busy ? "导入中…" : "导入"}</Button></>}><textarea className="import-text" autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="http://username:password@host:8080" aria-label={title} />{error && <div className="inline-error" role="alert">{error}</div>}</Modal>;
}
function CookiePage() {
  const { snapshot, execute, confirm } = useWorkspace();
  const [counts, setCounts] = useState({}), [query, setQuery] = useState("");
  const profiles = snapshot.profiles.filter((p) => !p.archived && (p.name + " " + p.group).toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  useEffect(() => {
    let live = true;
    Promise.allSettled(profiles.map(async (p) => {
      const r = await window.api.cookieCount(p.id);
      if (live) setCounts((c) => ({ ...c, [p.id]: r.count }));
    }));
    return () => {
      live = false;
    };
  }, [snapshot.profiles.map((p) => p.id).join(",")]);
  const act = async (p, method) => {
    await execute(async () => {
      const r2 = await window.api[method](p.id);
      if (r2.ok === false) throw new Error(r2.error);
      return r2;
    }, (r2) => r2.canceled ? "操作已取消" : method === "cookieExport" ? "Cookie 已导出" : method === "cookieImport" ? "Cookie 已导入" : "Cookie 已清空");
    const r = await window.api.cookieCount(p.id);
    setCounts((c) => ({ ...c, [p.id]: r.count }));
  };
  return <><div className="page-toolbar"><div className="search-box"><Cookie size={17} /><input value={query} aria-label="搜索 Cookie 环境" onChange={(e) => setQuery(e.target.value)} placeholder="找到要管理的环境" /></div><span className="toolbar-spacer" /><span className="muted">每个环境独立保存登录状态</span></div>{profiles.length ? <div className="object-table"><table><thead><tr><th>环境</th><th>Cookie 数量</th><th>最近打开</th><th className="align-right">操作</th></tr></thead><tbody>{profiles.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.group}</small></td><td>{counts[p.id] === void 0 ? "读取中…" : counts[p.id] + " 条"}</td><td className="muted">{timeAgo(p.lastOpenedAt)}</td><td><div className="row-actions"><Button icon={Download} onClick={() => act(p, "cookieExport")}>导出</Button><Button icon={Upload} onClick={() => act(p, "cookieImport")}>导入</Button><IconButton icon={Trash2} label={`清空 ${p.name} Cookie`} onClick={() => confirm({ title: `清空 ${p.name} 的 Cookie？`, description: "登录状态可能会失效。可以先导出备份。", label: "清空 Cookie", run: () => act(p, "cookieClear") })} /></div></td></tr>)}</tbody></table></div> : <Empty icon={Cookie} title="没有可管理的 Cookie 环境" description="创建环境并浏览网页后，登录状态会保存在这里。" />}</>;
}
function BookmarksPage() {
  const { snapshot, execute, confirm } = useWorkspace();
  const [edit, setEdit] = useState(null), [query, setQuery] = useState("");
  const list = snapshot.bookmarks.filter((b) => (b.title + " " + b.url).toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-toolbar"><div className="search-box"><Bookmark size={17} /><input placeholder="搜索书签或网址" aria-label="搜索书签" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span className="toolbar-spacer" /><Button variant="primary" icon={Plus} onClick={() => setEdit({ title: "", url: "" })}>添加书签</Button></div>{list.length ? <div className="object-list">{list.map((b) => <div className="object-item" key={b.id}><div className="object-symbol"><Bookmark size={18} /></div><div className="object-text"><strong>{b.title}</strong><span>{b.url}</span></div><IconButton icon={ExternalLink} label={`打开 ${b.title}`} onClick={() => window.api.openExternal(b.url)} /><Menu items={[{ label: "编辑书签", icon: Pencil, action: () => setEdit(b) }, { label: "复制网址", icon: Copy, action: () => execute(() => window.api.copy(b.url), "网址已复制") }, { label: "删除书签", icon: Trash2, danger: true, action: () => confirm({ title: "删除这个书签？", description: b.title, label: "删除书签", run: () => execute(() => window.api.bookmarksRemove(b.id), "书签已删除") }) }]} /></div>)}</div> : <Empty icon={Bookmark} title={query ? "没有找到这个书签" : "把常用页面放在手边"} description="添加的书签也会显示在浏览器书签栏。" />}{edit && <BookmarkEditor item={edit} onClose={() => setEdit(null)} />}</>;
}
function BookmarkEditor({ item, onClose }) {
  const { refresh, notify } = useWorkspace();
  const [form, setForm] = useState({ ...item }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const url = new URL(form.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入 http:// 或 https:// 网址");
      if (item.id) await window.api.bookmarksUpdate(item.id, form);
      else await window.api.bookmarksAdd(form);
      await refresh();
      notify("书签已保存");
      onClose();
    } catch (e2) {
      setError(messageOf(e2));
    } finally {
      setBusy(false);
    }
  };
  return <Modal open onOpenChange={(v) => !v && !busy && onClose()} title={item.id ? "编辑书签" : "添加书签"} description="常用书签在所有环境中可见。" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" form="bookmark-form" type="submit" disabled={busy}>保存书签</Button></>}><form id="bookmark-form" onSubmit={save} className="form-grid"><Field label="名称" className="span-2"><input autoFocus required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field><Field label="网址" className="span-2"><input required type="url" value={form.url} placeholder="https://" onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} /></Field>{error && <div role="alert" className="inline-error span-2">{error}</div>}</form></Modal>;
}
const bytes = (n) => n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
function DownloadsPage() {
  const { snapshot, execute } = useWorkspace();
  const labels = { progressing: "下载中", completed: "已完成", cancelled: "已取消", interrupted: "下载中断", paused: "已暂停" };
  return snapshot.downloads.length ? <div className="object-list download-list">{snapshot.downloads.map((d) => <div className="object-item" key={d.id}><div className="object-symbol"><ArrowDownToLine size={20} /></div><div className="object-text"><strong>{d.name}</strong><span>{d.profileName} · {bytes(d.received)}{d.total ? " / " + bytes(d.total) : ""} · {labels[d.state] || d.state}</span>{["progressing", "paused"].includes(d.state) && <progress value={d.total ? d.received : void 0} max={d.total || 1} />}</div>{d.state === "completed" ? <Button icon={FolderOpen} onClick={() => execute(() => window.api.downloadAction(d.id, "reveal"))}>在访达中显示</Button> : ["progressing", "paused"].includes(d.state) ? <><IconButton icon={d.state === "paused" ? Play : Pause} label={d.state === "paused" ? "继续下载" : "暂停下载"} onClick={() => execute(() => window.api.downloadAction(d.id, d.state === "paused" ? "resume" : "pause"))} /><IconButton icon={X} label="取消下载" onClick={() => execute(() => window.api.downloadAction(d.id, "cancel"))} /></> : <Badge status="muted">{labels[d.state] || d.state}</Badge>}</div>)}</div> : <Empty icon={Download} title="下载的文件会出现在这里" description="在任意浏览环境中下载文件后，查看进度、暂停下载或打开文件位置。" />;
}
function ActivityPage() {
  const { snapshot } = useWorkspace();
  return snapshot.activity.length ? <div className="object-list activity-list">{snapshot.activity.slice(0, 200).map((a) => <div className="object-item" key={a.id}><div className="activity-dot" /><div className="object-text"><strong>{a.action}<span className="activity-name">{a.name}</span></strong>{a.detail && <span>{a.detail}</span>}</div><time>{dateTime(a.time)}</time></div>)}</div> : <Empty icon={History} title="工作记录从这里开始" description="环境启动、配置更改、代理检测和文件导入会留下本地记录。" />;
}
function SettingsPage() {
  const { snapshot, execute } = useWorkspace();
  const [autostart, setAuto] = useState(null);
  useEffect(() => {
    window.api.getAutoStart().then((v) => setAuto(typeof v === "boolean" ? v : !!v?.openAtLogin)).catch(() => {
    });
  }, []);
  const prefs = snapshot.preferences;
  const choose = (key, value) => execute(() => window.api.preferences({ [key]: value }), "设置已保存");
  return <div className="settings-page"><section><div className="settings-heading"><h2>外观</h2><p>让工作台适合你的日常节奏。</p></div><div className="settings-row"><div><strong>主题</strong><p>工作台与浏览器使用同一套外观。</p></div><div className="segmented" aria-label="主题">{[["system", "跟随系统", Monitor], ["light", "浅色", Sun], ["dark", "深色", Moon]].map(([v, label, Icon]) => <button key={v} data-theme-choice={v} className={prefs.theme === v ? "selected" : ""} aria-pressed={prefs.theme === v} onClick={() => choose("theme", v)}><Icon size={15} />{label}</button>)}</div></div><div className="settings-row"><div><strong>列表密度</strong><p>控制环境列表的行间距。</p></div><select aria-label="列表密度" value={prefs.density || "comfortable"} onChange={(e) => choose("density", e.target.value)}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div><div className="settings-row"><div><strong>默认搜索引擎</strong><p>在浏览器地址栏输入关键词时使用。</p></div><select aria-label="默认搜索引擎" value={prefs.searchEngine || "google"} onChange={(e) => choose("searchEngine", e.target.value)}><option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option></select></div></section><section><div className="settings-heading"><h2>启动与数据</h2></div><div className="settings-row"><div><strong>登录 macOS 后启动</strong><p>自动打开 Star Browser 工作台。</p></div><button className={"switch " + (autostart ? "on" : "")} role="switch" aria-label="登录 macOS 后启动" aria-checked={!!autostart} disabled={autostart === null} onClick={() => execute(async () => {
    const v = await window.api.setAutoStart(!autostart);
    setAuto(typeof v === "boolean" ? v : !autostart);
  }, "启动设置已更新")}><span /></button></div><div className="settings-row"><div><strong>独立环境数据</strong><p>Cookie、localStorage、缓存保存在各自的本地会话中。</p></div><Badge status="success">本地保存</Badge></div></section><section><div className="settings-heading"><h2>键盘操作</h2></div>{[["新建环境", "⌘ N"], ["搜索环境", "⌘ F"], ["命令与快速切换", "⌘ K"], ["新建浏览器标签", "⌘ T"], ["关闭当前标签", "⌘ W"], ["地址栏", "⌘ L"], ["页面查找", "⌘ F"], ["恢复关闭标签", "⌘ ⇧ T"]].map(([label, keys]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</section><section><div className="about-brand"><Logo /><div><h2>Star Browser</h2><p>版本 {snapshot.engine.version} · macOS {snapshot.engine.arch}</p></div></div><dl className="detail-definitions"><div><dt>内置 Chromium</dt><dd>{snapshot.engine.chromium}</dd></div><div><dt>本机 Chrome</dt><dd>{snapshot.engine.chrome ? "已检测到" : "尚未安装"}</dd></div></dl><p className="muted">网络出口信息依赖检测服务与代理本身。当前指纹配置使用页面脚本和浏览器协议；不同内核与网站的检测结果可能不同。</p></section></div>;
}
export {
  ActivityPage,
  BookmarksPage,
  CookiePage,
  DownloadsPage,
  ProxyPage,
  SettingsPage,
  TextImport
};
