import {TextImport} from "./text-import";
import {ProxyAssignment} from "./proxy-assignment";
import {CookiePage} from "./cookie-page";
import {BookmarkEditor} from "./bookmark-editor";
import { ProxyEditor } from "./proxy-editor";
import { BackupSettings } from "./backups";
import { LocalApiSettings } from "./automation";
import React, { useState, useEffect } from "react";
import { Network, Plus, Upload, Download, Play, Check, X, RefreshCw, MoreHorizontal, Cookie, Trash2, Pencil, ExternalLink, Bookmark, FolderOpen, ArrowDownToLine, Pause, Square, Settings2, Sun, Moon, Monitor, Keyboard, ShieldCheck, History, Globe2, Copy, ArrowUpRight } from "lucide-react";
import { Button, IconButton, Menu, Modal, Field, Empty, Badge, Logo } from "./components";
import { useWorkspace, proxyLabel, dateTime, timeAgo, messageOf } from "./context";
function ProxyPage() {
  const { snapshot, execute, confirm, refresh, notify } = useWorkspace();
  const [editor, setEditor] = useState(null), [batch, setBatch] = useState(false), [busy, setBusy] = useState(/* @__PURE__ */ new Set()), [query, setQuery] = useState(""), [assignment, setAssignment] = useState(null);
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
    setAssignment(p);
  } }, { separator: true }, { label: "删除代理", icon: Trash2, danger: true, action: () => confirm({ title: "删除代理配置？", description: "已分配到环境的连接配置会保留。", label: "删除配置", run: () => execute(() => window.api.proxyRemove(p.id), "代理已删除", true) }) }]} /></div></td></tr>)}</tbody></table></div> : <Empty icon={Network} title={query ? "没有找到这个代理" : "为工作准备网络连接"} description={query ? "试试其他名称或代理地址。" : "添加 HTTP、HTTPS 或 SOCKS5 代理，检测后分配到环境。"}><Button variant="primary" icon={Plus} onClick={() => setEditor({})}>添加代理</Button></Empty>}{editor && <ProxyEditor initial={editor} onClose={() => setEditor(null)} />} {batch && <TextImport onClose={() => setBatch(false)} title="批量导入代理" description="每行一个代理，支持 http://user:pass@host:port 和 host:port:user:pass。" run={(text) => window.api.proxyImport(text)} />}{assignment&&<ProxyAssignment proxy={assignment} onClose={()=>setAssignment(null)}/>}</>;
}
function BookmarksPage() {
  const { snapshot, execute, confirm } = useWorkspace();
  const [edit, setEdit] = useState(null), [query, setQuery] = useState("");
  const list = snapshot.bookmarks.filter((b) => (b.title + " " + b.url).toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-toolbar"><div className="search-box"><Bookmark size={17} /><input placeholder="搜索书签或网址" aria-label="搜索书签" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span className="toolbar-spacer" /><Button variant="primary" icon={Plus} onClick={() => setEdit({ title: "", url: "" })}>添加书签</Button></div>{list.length ? <div className="object-list">{list.map((b) => <div className="object-item" key={b.id}><div className="object-symbol"><Bookmark size={18} /></div><div className="object-text"><strong>{b.title}</strong><span>{b.url}</span></div><IconButton icon={ExternalLink} label={`打开 ${b.title}`} onClick={() => window.api.openExternal(b.url)} /><Menu items={[{ label: "编辑书签", icon: Pencil, action: () => setEdit(b) }, { label: "复制网址", icon: Copy, action: () => execute(() => window.api.copy(b.url), "网址已复制") }, { label: "删除书签", icon: Trash2, danger: true, action: () => confirm({ title: "删除这个书签？", description: b.title, label: "删除书签", run: () => execute(() => window.api.bookmarksRemove(b.id), "书签已删除") }) }]} /></div>)}</div> : <Empty icon={Bookmark} title={query ? "没有找到这个书签" : "把常用页面放在手边"} description="添加的书签也会显示在浏览器书签栏。" />}{edit && <BookmarkEditor item={edit} onClose={() => setEdit(null)} />}</>;
}
const bytes = (n) => n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
function DownloadsPage() {
  const { snapshot, execute } = useWorkspace();
  const labels = { progressing: "下载中", completed: "已完成", cancelled: "已取消", interrupted: "下载中断", paused: "已暂停" };
  return snapshot.downloads.length ? <div className="object-list download-list">{snapshot.downloads.map((d) => <div className="object-item" data-download-id={d.id} key={d.id}><div className="object-symbol"><ArrowDownToLine size={20} /></div><div className="object-text"><strong>{d.name}</strong><span>{d.profileName} · {bytes(d.received)}{d.total ? " / " + bytes(d.total) : ""} · {labels[d.state] || d.state}</span>{["progressing", "paused"].includes(d.state) && <progress value={d.total ? d.received : void 0} max={d.total || 1} />}</div>{d.state === "completed" ? <Button icon={FolderOpen} onClick={() => execute(() => window.api.downloadAction(d.id, "reveal"))}>在访达中显示</Button> : ["progressing", "paused"].includes(d.state) ? <><IconButton icon={d.state === "paused" ? Play : Pause} label={d.state === "paused" ? "继续下载" : "暂停下载"} onClick={() => execute(() => window.api.downloadAction(d.id, d.state === "paused" ? "resume" : "pause"))} /><IconButton icon={X} label="取消下载" onClick={() => execute(() => window.api.downloadAction(d.id, "cancel"))} /></> : <Badge status="muted">{labels[d.state] || d.state}</Badge>}</div>)}</div> : <Empty icon={Download} title="下载的文件会出现在这里" description="在任意浏览环境中下载文件后，查看进度、暂停下载或打开文件位置。" />;
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
  return <div className="settings-page"><section><div className="settings-heading"><h2>外观</h2><p>让工作台适合你的日常节奏。</p></div><div className="settings-row"><div><strong>主题</strong><p>工作台与浏览器使用同一套外观。</p></div><div className="segmented" aria-label="主题">{[["system", "跟随系统", Monitor], ["light", "浅色", Sun], ["dark", "深色", Moon]].map(([v, label, Icon]) => <button key={v} data-theme-choice={v} className={prefs.theme === v ? "selected" : ""} aria-pressed={prefs.theme === v} onClick={() => choose("theme", v)}><Icon size={15} />{label}</button>)}</div></div><div className="settings-row"><div><strong>列表密度</strong><p>控制环境列表的行间距。</p></div><select aria-label="列表密度" value={prefs.density || "comfortable"} onChange={(e) => choose("density", e.target.value)}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div><div className="settings-row"><div><strong>默认搜索引擎</strong><p>在浏览器地址栏输入关键词时使用。</p></div><select aria-label="默认搜索引擎" value={prefs.searchEngine || "google"} onChange={(e) => choose("searchEngine", e.target.value)}><option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option></select></div></section><section><div className="settings-heading"><h2>启动与数据</h2></div><div className="settings-row"><div><strong>登录系统后启动</strong><p>自动打开 Star Browser 工作台。</p></div><button className={"switch " + (autostart ? "on" : "")} role="switch" aria-label="登录系统后启动" aria-checked={!!autostart} disabled={autostart === null} onClick={() => execute(async () => {
    const v = await window.api.setAutoStart(!autostart);
    setAuto(typeof v === "boolean" ? v : !autostart);
  }, "启动设置已更新")}><span /></button></div><div className="settings-row"><div><strong>独立环境数据</strong><p>Cookie、localStorage、缓存保存在各自的本地会话中。</p></div><Badge status="success">本地保存</Badge></div></section><BackupSettings /><LocalApiSettings /><section><div className="settings-heading"><h2>键盘操作</h2></div>{[["新建环境", "⌘ N"], ["搜索环境", "⌘ F"], ["命令与快速切换", "⌘ K"], ["新建浏览器标签", "⌘ T"], ["关闭当前标签", "⌘ W"], ["地址栏", "⌘ L"], ["页面查找", "⌘ F"], ["恢复关闭标签", "⌘ ⇧ T"]].map(([label, keys]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{snapshot.engine.platform === "darwin" ? keys : keys.replace("⌘", "Ctrl").replace("⇧", "Shift")}</kbd></div>)}</section><section><div className="about-brand"><Logo /><div><h2>Star Browser</h2><p>版本 {snapshot.engine.version} · {snapshot.engine.platform === "darwin" ? "macOS" : snapshot.engine.platform === "win32" ? "Windows" : "Linux"} {snapshot.engine.arch}</p></div></div><dl className="detail-definitions"><div><dt>内置 Chromium</dt><dd>{snapshot.engine.chromium}</dd></div><div><dt>本机 Chrome</dt><dd>{snapshot.engine.chrome ? "已检测到" : "尚未安装"}</dd></div></dl><p className="muted">网络出口信息依赖检测服务与代理本身。当前指纹配置使用页面脚本和浏览器协议；不同内核与网站的检测结果可能不同。</p></section></div>;
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
