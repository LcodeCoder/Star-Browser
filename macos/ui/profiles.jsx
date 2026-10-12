import React, { useState, useEffect } from "react";
import { Plus, Play, Square, ArrowUpRight, Fingerprint, Settings2, Copy, Archive, ArchiveRestore, Pin, PinOff, X, RefreshCw, Download, Upload, Cookie, ShieldCheck, Globe2, ChevronLeft, Check, Network } from "lucide-react";
import { Button, IconButton, Menu, Modal, Field, Tabs, Badge, Empty, Logo } from "./components";
import { useWorkspace, osName, proxyLabel, timeAgo, dateTime, messageOf } from "./context";
const COUNTRIES = [["US", "美国"], ["UK", "英国"], ["CA", "加拿大"], ["AU", "澳大利亚"], ["DE", "德国"], ["FR", "法国"], ["NL", "荷兰"], ["ES", "西班牙"], ["IT", "意大利"], ["SE", "瑞典"], ["PL", "波兰"], ["RU", "俄罗斯"], ["JP", "日本"], ["KR", "韩国"], ["SG", "新加坡"], ["HK", "中国香港"], ["TW", "中国台湾"], ["IN", "印度"], ["TH", "泰国"], ["VN", "越南"], ["MY", "马来西亚"], ["PH", "菲律宾"], ["ID", "印度尼西亚"], ["AE", "阿联酋"], ["SA", "沙特阿拉伯"], ["TR", "土耳其"], ["BR", "巴西"], ["MX", "墨西哥"], ["ZA", "南非"]];
const LANGUAGES = [["en-US", "英语（美国）"], ["en-GB", "英语（英国）"], ["en-CA", "英语（加拿大）"], ["en-AU", "英语（澳大利亚）"], ["de-DE", "德语"], ["fr-FR", "法语"], ["nl-NL", "荷兰语"], ["es-ES", "西班牙语"], ["it-IT", "意大利语"], ["ja-JP", "日语"], ["ko-KR", "韩语"], ["zh-CN", "简体中文"], ["zh-TW", "繁体中文"], ["en-SG", "英语（新加坡）"], ["pt-BR", "葡萄牙语"], ["ru-RU", "俄语"], ["th-TH", "泰语"], ["vi-VN", "越南语"]];
const zones = ["America/New_York", "America/Los_Angeles", "America/Chicago", "America/Toronto", "America/Mexico_City", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Madrid", "Europe/Rome", "Europe/Moscow", "Asia/Tokyo", "Asia/Seoul", "Asia/Singapore", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Kolkata", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Jakarta", "Asia/Dubai", "Australia/Sydney", "Africa/Johannesburg"];
const blankProfile = { name: "", group: "", note: "", tags: [], os: "mac", country: "US", language: "", timezone: "", startUrl: "about:home", proxy: null, restoreSession: true, webrtc: "disable", fingerprint: {}, permissions: {}, extensions: [] };
function ProfileEditor({ profile, onClose }) {
  const { snapshot, refresh, notify } = useWorkspace();
  const [form, setForm] = useState(() => ({ ...blankProfile, ...profile || {}, tags: (profile?.tags || []).join(", "), proxy: { type: "http", host: "", port: "", user: "", pass: "", ...profile?.proxy }, fingerprint: { ...profile?.fingerprint } }));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const proxySet = (key, value) => setForm((f) => ({ ...f, proxy: { ...f.proxy, [key]: value } }));
  const fpSet = (key, value) => setForm((f) => ({ ...f, fingerprint: { ...f.fingerprint, [key]: value } }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = { ...form, name: form.name.trim(), tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), timezoneManual: !!form.timezone, langManual: !!form.language, proxy: form.proxy.host ? form.proxy : null };
      if (!data.name) throw new Error("给环境起个名称，方便下次找到");
      if (profile) await window.api.update(profile.id, data);
      else await window.api.create(data);
      await refresh();
      notify(profile ? "环境已更新" : "环境已创建");
      onClose();
    } catch (e2) {
      setError(messageOf(e2));
    } finally {
      setBusy(false);
    }
  };
  return <Modal open onOpenChange={(v) => !v && !busy && onClose()} wide title={profile ? "编辑环境" : "新建环境"} description="为这次工作准备独立的浏览空间。" id="modal" footer={<><span className="footer-note">配置修改在下次启动时生效</span><Button onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" id="btnSave" type="submit" form="profile-form" disabled={busy}>{busy ? "保存中…" : profile ? "保存更改" : "创建环境"}</Button></>}><form id="profile-form" onSubmit={submit}>
 <section className="form-section"><h3>基本信息</h3><div className="form-grid"><Field label="环境名称" id="f_name"><input id="f_name" autoFocus required maxLength={120} placeholder="例如：日本内容工作室" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field><Field label="分组" id="f_group"><input id="f_group" list="groups" placeholder="默认分组" value={form.group} onChange={(e) => set("group", e.target.value)} /><datalist id="groups">{[...new Set(snapshot.profiles.map((p) => p.group))].map((g) => <option key={g}>{g}</option>)}</datalist></Field><Field label="操作系统" id="f_os"><select id="f_os" value={form.os} onChange={(e) => set("os", e.target.value)}><option value="mac">macOS</option><option value="win">Windows</option><option value="android">Android</option></select></Field><Field label="国家 / 地区" id="f_country"><select id="f_country" value={form.country} onChange={(e) => set("country", e.target.value)}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name} {code}</option>)}</select></Field><Field label="标签" id="f_tags" className="span-2"><input id="f_tags" placeholder="用逗号分隔，例如：内容, QA" value={form.tags} onChange={(e) => set("tags", e.target.value)} /></Field><Field label="起始页" id="f_url" className="span-2"><input id="f_url" value={form.startUrl} placeholder="https:// 或 about:home" onChange={(e) => set("startUrl", e.target.value)} /></Field><Field label="备注" id="f_note" className="span-2"><textarea id="f_note" rows={2} placeholder="记下用途、工作进度或下次要做的事" value={form.note} onChange={(e) => set("note", e.target.value)} /></Field></div></section>
 <section className="form-section"><div className="section-heading"><h3>网络连接</h3><select aria-label="选择已保存代理" value="" onChange={(e) => {
    const p = snapshot.proxies.find((p2) => p2.id === e.target.value);
    if (p) set("proxy", { ...p });
  }}><option value="">从代理库选择</option>{snapshot.proxies.map((p) => <option key={p.id} value={p.id}>{p.name} · {proxyLabel(p)}</option>)}</select></div><div className="form-grid proxy-form"><Field label="协议"><select value={form.proxy.type} onChange={(e) => proxySet("type", e.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></Field><Field label="代理地址"><input placeholder="不填则使用本机网络" value={form.proxy.host} onChange={(e) => proxySet("host", e.target.value)} /></Field><Field label="端口"><input inputMode="numeric" placeholder="8080" value={form.proxy.port} onChange={(e) => proxySet("port", e.target.value)} /></Field><Field label="账号"><input autoComplete="off" value={form.proxy.user} onChange={(e) => proxySet("user", e.target.value)} /></Field><Field label="密码"><input type="password" autoComplete="new-password" value={form.proxy.pass} onChange={(e) => proxySet("pass", e.target.value)} /></Field></div><p className="field-hint"><ShieldCheck size={14} />配置代理后，连接失败会阻止启动。</p></section>
 <section className="form-section"><h3>语言与时区</h3><div className="form-grid"><Field label="浏览器语言" id="f_language"><select id="f_language" value={form.language} onChange={(e) => set("language", e.target.value)}><option value="">跟随网络出口</option>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></Field><Field label="时区" id="f_timezone"><select id="f_timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}><option value="">跟随网络出口</option>{[...new Set([...zones, form.timezone].filter(Boolean))].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></Field></div></section>
 <section className="form-section"><h3>扩展</h3>{snapshot.extensions?.length?<div className="extension-selection">{snapshot.extensions.map(extension=><label className="check-line" key={extension.id}><input type="checkbox" aria-label={"启用 "+extension.name} checked={form.extensions.includes(extension.id)} onChange={e=>set("extensions",e.target.checked?[...form.extensions,extension.id]:form.extensions.filter(id=>id!==extension.id))}/><span>{extension.name}<small>版本 {extension.version}</small></span></label>)}</div>:<p className="muted">先在扩展库添加常用工具，再为这个环境启用。</p>}{form.extensions.some(id=>!snapshot.extensions?.some(e=>e.id===id))&&<p className="inline-error">有引用的扩展已缺失。<Button onClick={()=>set("extensions",form.extensions.filter(id=>snapshot.extensions?.some(e=>e.id===id)))}>清除失效配置</Button></p>}</section>
 <details className="form-section"><summary>指纹、硬件与网站权限<Settings2 size={15} /></summary><div className="form-grid advanced-fields"><Field label="处理器核心"><select value={form.fingerprint.hardwareConcurrency || ""} onChange={(e) => fpSet("hardwareConcurrency", e.target.value)}><option value="">由稳定种子生成</option>{[2, 4, 8, 12, 16, 24, 32].map((n) => <option key={n} value={n}>{n} 核心</option>)}</select></Field><Field label="设备内存"><select value={form.fingerprint.deviceMemory || ""} onChange={(e) => fpSet("deviceMemory", e.target.value)}><option value="">由稳定种子生成</option>{[2, 4, 8].map((n) => <option key={n} value={n}>{n} GB</option>)}</select></Field><Field label="像素比"><select value={form.fingerprint.devicePixelRatio || ""} onChange={(e) => fpSet("devicePixelRatio", e.target.value)}><option value="">由稳定种子生成</option>{[1, 1.25, 1.5, 2, 2.5, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field><Field label="WebRTC"><select value={form.webrtc} onChange={(e) => set("webrtc", e.target.value)}><option value="disable">关闭</option><option value="proxy">启用受限连接</option></select></Field>{[["geolocation", "位置"], ["notifications", "通知"], ["media", "摄像头与麦克风"], ["clipboard-read", "读取剪贴板"], ["display-capture", "屏幕共享"], ["local-fonts", "本机字体"], ["window-management", "屏幕信息"]].map(([key, label]) => <Field key={key} label={label}><select value={form.permissions[key] || "ask"} onChange={(e) => set("permissions", { ...form.permissions, [key]: e.target.value })}><option value="ask">每次询问</option><option value="block">始终拒绝</option><option value="allow">允许</option></select></Field>)}</div></details>
 <label className="check-line"><input type="checkbox" checked={form.restoreSession !== false} onChange={(e) => set("restoreSession", e.target.checked)} />下次启动恢复上次标签页</label>{error && <div className="inline-error" role="alert">{error}</div>}</form></Modal>;
}
function ProfileMenu({ profile, onDetail, onEdit }) {
  const { execute, refresh, confirm, openProfile, notify } = useWorkspace();
  return <Menu label={`${profile.name} 更多操作`} items={[
    { label: "环境详情", icon: Fingerprint, action: () => onDetail(profile.id) },
    { label: "编辑配置", icon: Settings2, action: () => onEdit(profile) },
    { label: "在本机 Chrome 中打开", icon: ArrowUpRight, disabled: profile.archived, action: () => openProfile(profile.id, "launch") },
    { separator: true },
    { label: profile.pinned ? "取消置顶" : "置顶环境", icon: profile.pinned ? PinOff : Pin, action: () => execute(() => window.api.update(profile.id, { pinned: !profile.pinned }), "置顶状态已更新") },
    { label: "复制为新环境", icon: Copy, action: () => execute(() => window.api.action("clone", [profile.id]), "已复制配置并生成独立环境") },
    { label: "导出配置", icon: Download, action: () => execute(() => window.api.exportProfiles([profile.id]), (r) => r.canceled ? "已取消导出" : "环境配置已导出") },
    { separator: true },
    { label: profile.archived ? "恢复环境" : "移入归档", icon: profile.archived ? ArchiveRestore : Archive, action: () => execute(() => window.api.action(profile.archived ? "restore" : "archive", [profile.id]), profile.archived ? "环境已恢复" : "环境已归档") },
    { label: "重新生成指纹", icon: RefreshCw, action: () => confirm({ title: "重新生成稳定指纹？", description: "已有网站可能会把它识别为新设备。环境内的 Cookie 和存储会保留。", label: "重新生成", run: () => execute(() => window.api.action("regenerate", [profile.id]), "已生成新的稳定指纹") }) }
  ]} />;
}
function ProfileDetail({ profile, onClose, onEdit }) {
  const { snapshot, execute, openProfile, confirm } = useWorkspace();
  const [tab, setTab] = useState("overview"), [fp, setFp] = useState(null), [error, setError] = useState(""), [cookieCount, setCookieCount] = useState(null);
  const running = snapshot.runtime.find((r) => r.id === profile.id)?.running;
  useEffect(() => {
    let live = true;
    setFp(null);
    setError("");
    setCookieCount(null);
    window.api.preview(profile.id).then((v) => live && setFp(v)).catch((e) => live && setError(messageOf(e)));
    window.api.cookieCount(profile.id).then((v) => live && setCookieCount(v.count)).catch(() => {
    });
    return () => {
      live = false;
    };
  }, [profile.id, profile.updatedAt]);
  const cookie = async (method) => {
    await execute(async () => {
      const r2 = await window.api[method](profile.id);
      if (r2?.ok === false) throw new Error(r2.error);
      return r2;
    }, (r2) => r2.canceled ? "已取消" : method === "cookieExport" ? "Cookie 已导出" : method === "cookieImport" ? "Cookie 已导入" : "Cookie 已清空");
    const r = await window.api.cookieCount(profile.id);
    setCookieCount(r.count);
  };
  const pairs = [["操作系统", osName(profile.os)], ["国家 / 地区", COUNTRIES.find((c) => c[0] === profile.country)?.[1] || profile.country], ["网络连接", proxyLabel(profile.proxy)], ["语言", profile.langManual ? profile.language : "跟随网络出口"], ["时区", profile.timezoneManual ? profile.timezone : "跟随网络出口"], ["上次打开", timeAgo(profile.lastOpenedAt)], ["创建时间", dateTime(profile.createdAt)]];
  return <aside className="detail-panel" id="drawer" aria-label="环境详情"><div className="detail-top"><Button variant="text detail-back" icon={ChevronLeft} onClick={onClose}>返回环境</Button><span className="muted">环境详情</span><IconButton icon={X} label="关闭详情" id="drawerClose" onClick={onClose} /></div><div className="detail-identity"><div className={"environment-avatar avatar-" + (profile.os || "mac")}><Logo /></div><h2>{profile.name}</h2><p>{profile.group || "默认分组"}</p><div className="tag-list">{(profile.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}</div><div className="detail-actions"><Button variant="primary" icon={running ? ArrowUpRight : Play} onClick={() => openProfile(profile.id)} disabled={profile.archived}>{running ? "切回浏览器" : "启动环境"}</Button><IconButton icon={Settings2} label="编辑环境" data-act="edit" data-id={profile.id} onClick={() => onEdit(profile)} />{running && <IconButton icon={Square} label="停止环境" onClick={() => execute(() => window.api.action("stop", [profile.id]), "浏览器已停止")} />}</div></div>
 <Tabs value={tab} onValueChange={setTab} items={[
    { value: "overview", label: "概览", content: <><dl className="detail-definitions">{pairs.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{profile.note && <section className="detail-section"><h3>备注</h3><p className="note-content">{profile.note}</p></section>}<section className="detail-section"><h3>环境标识</h3><button className="copy-id" title="复制环境 ID" onClick={() => execute(() => window.api.copy(profile.id), "环境 ID 已复制")}>{profile.id}<Copy size={13} /></button></section></> },
    { value: "fingerprint", label: "指纹", content: <section className="detail-section fingerprint-section">{error ? <div role="alert" className="inline-error">{error}</div> : !fp ? <div className="loading-state"><RefreshCw className="spin" size={18} />正在读取配置…</div> : <><div className="section-heading"><h3>当前配置</h3><IconButton icon={Copy} label="复制指纹 JSON" onClick={() => execute(() => window.api.copy(JSON.stringify(fp, null, 2)), "指纹 JSON 已复制")} /></div><dl className="detail-definitions">{[["平台", fp.platform], ["内核版本", fp.chromeVersion], ["语言", fp.language], ["时区", fp.timezone], ["屏幕", `${fp.screen.width} × ${fp.screen.height}`], ["核心 / 内存", `${fp.hardwareConcurrency} 核心 / ${fp.deviceMemory} GB`], ["像素比", fp.devicePixelRatio], ["WebRTC", profile.webrtc === "proxy" ? "受限连接" : "关闭"], ["WebGL 厂商", fp.webgl.vendor], ["渲染器", fp.webgl.renderer]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><details className="raw-json"><summary>查看完整 JSON</summary><pre>{JSON.stringify(fp, null, 2)}</pre></details></>}</section> },
    { value: "data", label: "数据", content: <section className="detail-section"><div className="section-heading"><h3>Cookie</h3><span className="muted">{cookieCount === null ? "读取中…" : `${cookieCount} 条`}</span></div><p className="muted">此环境的登录状态与其他环境独立保存。</p><div className="stack-actions"><Button icon={Download} onClick={() => cookie("cookieExport")}>导出 Cookie</Button><Button icon={Upload} onClick={() => cookie("cookieImport")}>导入 Cookie</Button><Button variant="danger" icon={Cookie} onClick={() => confirm({ title: "清空这个环境的 Cookie？", description: "登录状态可能会失效。可以先导出备份。", label: "清空 Cookie", run: () => cookie("cookieClear") })}>清空 Cookie</Button></div><hr /><h3>标签页恢复</h3><p className="muted">{profile.restoreSession !== false ? `已开启 · 已保存 ${profile.sessionTabs?.length || 0} 个标签` : "已关闭"}</p></section> }
  ]} /></aside>;
}
export {
  COUNTRIES,
  LANGUAGES,
  ProfileDetail,
  ProfileEditor,
  ProfileMenu
};
