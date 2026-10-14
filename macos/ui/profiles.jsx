import {LaunchFeedback, latestStartup} from "./launch-status";
import React, { useState, useEffect, useRef } from "react";
import { Plus, Play, Square, ArrowUpRight, Fingerprint, Settings2, Copy, Archive, ArchiveRestore, Pin, PinOff, X, RefreshCw, Download, Upload, Cookie, ShieldCheck, Globe2, ChevronLeft, ChevronRight, Check, Network } from "lucide-react";
import { Button, IconButton, Menu, Modal, Field, Tabs, Badge, Empty, Logo } from "./components";
import { ExternalDiagnostics } from "./diagnostics";
import { useWorkspace, osName, proxyLabel, timeAgo, dateTime, messageOf } from "./context";
import { COUNTRIES, LANGUAGES } from "./profile-options";
import { ProfileEditor } from "./profile-editor";
function ProfileMenu({ profile, onDetail, onEdit }) {
  const { snapshot, execute, refresh, confirm, openProfile, notify } = useWorkspace();
  const starting = latestStartup(snapshot.startups, profile.id)?.status === "starting";
  return <Menu label={`${profile.name} 更多操作`} items={[
    { label: "环境详情", icon: Fingerprint, action: () => onDetail(profile.id) },
    { label: "编辑配置", icon: Settings2, disabled: starting, action: () => onEdit(profile) },
    { label: "在本机 Chrome 中打开", icon: ArrowUpRight, disabled: profile.archived || starting, action: () => openProfile(profile.id, "launch") },
    { separator: true },
    { label: profile.pinned ? "取消置顶" : "置顶环境", icon: profile.pinned ? PinOff : Pin, action: () => execute(() => window.api.update(profile.id, { pinned: !profile.pinned }), "置顶状态已更新") },
    { label: "复制为新环境", icon: Copy, action: () => execute(() => window.api.action("clone", [profile.id]), "已复制配置并生成独立环境") },
    { label: "导出配置", icon: Download, action: () => execute(() => window.api.exportProfiles([profile.id]), (r) => r.canceled ? "已取消导出" : "环境配置已导出") },
    { separator: true },
    { label: profile.archived ? "恢复环境" : "移入归档", icon: profile.archived ? ArchiveRestore : Archive, disabled: starting, action: () => execute(() => window.api.action(profile.archived ? "restore" : "archive", [profile.id]), profile.archived ? "环境已恢复" : "环境已归档") },
    { label: "重新生成指纹", icon: RefreshCw, disabled: starting, action: () => confirm({ title: "重新生成稳定指纹？", description: "已有网站可能会把它识别为新设备。环境内的 Cookie 和存储会保留。", label: "重新生成", run: () => execute(() => window.api.action("regenerate", [profile.id]), "已生成新的稳定指纹") }) }
  ]} />;
}
function FingerprintAudit({ profile, audit, busy, error, onCheck, onCopy, native, pages, selectedPage, pageLoading, onSelectPage, onRefreshPages }) {
  const value=(input)=>Array.isArray(input)?input.join(', '):String(input??'未读取');
  return <div className="fingerprint-audit">
    <div className="section-heading"><h3>实际网页检查</h3><div className="inline-actions"><ExternalDiagnostics profile={profile}/>{audit&&<IconButton icon={Copy} label="复制网页检查结果" onClick={onCopy}/>}<Button icon={busy?RefreshCw:ShieldCheck} disabled={busy||(native&&(pageLoading||!selectedPage))} onClick={onCheck}>{busy?'检查中…':audit?'重新检查':native?'检查所选网页':'检查当前网页'}</Button></div></div>
    <p className="muted">读取{native?'所选':'当前'}网页、iframe、Dedicated Worker，以及这个来源正在运行的 Shared/Service Worker，列出实际差异。</p>
    {native&&<div className="audit-page-picker"><label htmlFor="auditPage">检查网页</label><div className="audit-page-controls"><select id="auditPage" value={selectedPage} disabled={busy||pageLoading} onChange={event=>onSelectPage(event.target.value)}><option value="">{pageLoading?'正在读取网页…':pages.length?'请选择网页':'没有可检查的网页'}</option>{pages.map(page=><option key={page.id} value={page.id}>{page.title} · {page.url}</option>)}</select><IconButton icon={RefreshCw} label="刷新网页列表" disabled={busy||pageLoading} onClick={onRefreshPages}/></div>{!pageLoading&&!pages.length&&<p className="muted">在此环境的本机 Chrome 打开 HTTP 或 HTTPS 网页，再刷新列表。</p>}</div>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {audit&&<><div className="audit-meta" role="status"><Badge status={audit.differences||audit.unknown||audit.workerError||audit.targetErrors.length?'warning':'success'}>{audit.differences?audit.differences+' 项不同':audit.unknown||audit.workerError?'部分项目未读取':audit.targetErrors.length?'后台配置异常':'已检查项目一致'}</Badge><span>{dateTime(audit.checkedAt)}</span></div>
    {audit.advice?.length>0&&<div className="audit-advice">{audit.advice.map(item=><section key={item.title}><h4>{item.title}</h4><p>{item.text}</p></section>)}</div>}
    <p className="muted audit-url">{audit.engine} · {audit.url}</p>
    <div className="audit-rows">{[...new Set(audit.rows.map(row=>row.context))].map(context=>{
      const rows=audit.rows.filter(row=>row.context===context);if(!rows.length)return null;
      const issues=rows.filter(row=>row.state==='different'||row.state==='unknown').length;
      const unread=rows.every(row=>row.state==='not-observed');
      return <details key={context} className="audit-group" open={issues>0||context==='CSS'}><summary><strong>{context==='Worker'?'Dedicated Worker':context}</strong><span>{rows.length} 项</span><Badge status={issues?'warning':unread?'muted':'success'}>{issues?issues+' 项需检查':unread?'未观测':'一致'}</Badge></summary>
        {rows.map((row,index)=><div className="audit-row" key={index}><span>{row.label}</span><strong>{value(row.actual)}</strong><Badge status={row.state==='match'?'success':row.state==='different'?'warning':'muted'}>{row.state==='match'?'一致':row.state==='different'?'不同':row.state==='native'?'原生':row.state==='not-observed'?'未观测':'未读取'}</Badge>{row.state==='different'&&<small>配置：{value(row.expected)}</small>}</div>)}
      </details>;
    })}</div>
    {audit.workerError&&<p className="inline-warning">{audit.workerError}</p>}{audit.targetErrors.length>0&&<p className="inline-warning">部分后台上下文无法配置，请重新加载后检查。</p>}
    <details className="audit-boundary"><summary>内核与后台上下文</summary><p>此检查覆盖网页、跨进程 iframe、Dedicated Worker 和当前来源正在运行的 Shared/Service Worker；未运行的上下文未验收。原生一致模式让页面与框架使用原生显示参数；自定义模式的跨进程 iframe 仍可能出现设备像素比/CSS 差异。WebGPU、字体、媒体、TLS 与 DNS 仍受原生系统和网络影响，一致结果仅针对已检查项目。本机 Chrome 的内存请求头来自本次导航后已观察的请求，检查本身不发送额外网络探测。</p><p>{audit.contexts?.map(item=>item.context+"："+(item.status==="read"?"已读取":item.status==="not-running"?"未运行": "未读取")).join("；")}</p><p>WebGPU：{audit.webgpu.available?(audit.webgpu.info?.description||audit.webgpu.info?.vendor||'原生适配器'):'当前页面不可用'}</p></details>
    </>}
  </div>;
}
function ProfileDetail({ profile, onClose, onEdit, position=0, total=1, onStep }) {
  const { snapshot, execute, openProfile, confirm } = useWorkspace();
  const [tab, setTab] = useState("overview"), [fp, setFp] = useState(null), [error, setError] = useState(""), [cookieCount, setCookieCount] = useState(null),[audit,setAudit]=useState(null),[auditBusy,setAuditBusy]=useState(false),[auditError,setAuditError]=useState('');
  const runtime=snapshot.runtime.find(r=>r.id===profile.id),running=runtime?.running,native=runtime?.engine==='本机 Chrome';
  const launch=latestStartup(snapshot.startups,profile.id),starting=launch?.status==='starting';
  const auditKey=profile.id+":"+profile.updatedAt+":"+(runtime?.engine||'stopped'),auditRef=useRef(auditKey);auditRef.current=auditKey;
  const [pages,setPages]=useState([]),[selectedPage,setSelectedPage]=useState(''),[pageLoading,setPageLoading]=useState(false);const pageRequest=useRef(0);
  const refreshPages=async()=>{const key=auditKey,request=++pageRequest.current;setPageLoading(true);setAuditError('');try{const list=await window.api.fingerprintPages(profile.id);if(auditRef.current===key&&pageRequest.current===request){setPages(list.pages);setSelectedPage(current=>list.pages.some(page=>page.id===current)?current:list.pages.length===1?list.pages[0].id:'');setAudit(null);}}catch(error){if(auditRef.current===key&&pageRequest.current===request){setPages([]);setSelectedPage('');setAuditError(messageOf(error));}}finally{if(auditRef.current===key&&pageRequest.current===request)setPageLoading(false);}};
  useEffect(() => {
    let live = true;
    setFp(null);
    setError("");
    setCookieCount(null);setAudit(null);setAuditError('');setAuditBusy(false);setPages([]);setSelectedPage('');setPageLoading(false);pageRequest.current++;
    if(native)refreshPages();
    window.api.preview(profile.id).then((v) => live && setFp(v)).catch((e) => live && setError(messageOf(e)));
    window.api.cookieCount(profile.id).then((v) => live && setCookieCount(v.count)).catch(() => {
    });
    return () => {
      live = false;
    };
  }, [profile.id, profile.updatedAt, runtime?.engine, running]);
  const checkFingerprint=async()=>{const key=auditKey;setAuditBusy(true);setAuditError('');try{const current=await window.api.preview(profile.id);const result=await window.api.fingerprintAudit(profile.id,native?selectedPage:undefined);if(auditRef.current===key){setFp(current);setAudit(result);}}catch(error){if(auditRef.current===key)setAuditError(messageOf(error));}finally{if(auditRef.current===key)setAuditBusy(false);}};
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
  return <aside className="detail-panel" id="drawer" aria-label="环境详情"><div className="detail-top"><Button variant="text detail-back" icon={ChevronLeft} onClick={onClose}>返回环境</Button><span className="muted">环境详情</span><div className="detail-pager"><IconButton icon={ChevronLeft} label="上一个环境" disabled={position<=0} onClick={()=>onStep?.(-1)} /><span>{position+1} / {total}</span><IconButton icon={ChevronRight} label="下一个环境" disabled={position>=total-1} onClick={()=>onStep?.(1)} /></div><IconButton icon={X} label="关闭详情" id="drawerClose" onClick={onClose} /></div><div className="detail-identity"><div className={"environment-avatar avatar-" + (profile.os || "mac")}><Logo /></div><h2>{profile.name}</h2><p>{profile.group || "默认分组"}</p><div className="tag-list">{(profile.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}</div><div className="detail-actions"><Button variant="primary" icon={running ? ArrowUpRight : Play} onClick={() => openProfile(profile.id)} disabled={profile.archived || starting}>{starting ? "启动中…" : running ? "切回浏览器" : "启动环境"}</Button><IconButton icon={Settings2} label="编辑环境" disabled={starting} data-act="edit" data-id={profile.id} onClick={() => onEdit(profile)} />{running && <IconButton icon={Square} label="停止环境" onClick={() => execute(() => window.api.action("stop", [profile.id]), "浏览器已停止")} />}</div></div>
 <LaunchFeedback record={launch} profile={profile} onEdit={onEdit} />
 <Tabs value={tab} onValueChange={setTab} items={[
    { value: "overview", label: "概览", content: <><dl className="detail-definitions">{pairs.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{profile.note && <section className="detail-section"><h3>备注</h3><p className="note-content">{profile.note}</p></section>}<section className="detail-section"><h3>环境标识</h3><button className="copy-id" title="复制环境 ID" onClick={() => execute(() => window.api.copy(profile.id), "环境 ID 已复制")}>{profile.id}<Copy size={13} /></button></section></> },
    { value: "fingerprint", label: "指纹", content: <section className="detail-section fingerprint-section">{error ? <div role="alert" className="inline-error">{error}</div> : !fp ? <div className="loading-state"><RefreshCw className="spin" size={18} />正在读取配置…</div> : <><details className="fingerprint-config" open={!audit}><summary>当前配置</summary><div className="section-heading"><span className="muted">{running?'运行中的环境参数':'保存的环境参数'}</span><IconButton icon={Copy} label="复制指纹 JSON" onClick={() => execute(() => window.api.copy(JSON.stringify(fp, null, 2)), "指纹 JSON 已复制")} /></div><dl className="detail-definitions">{[["显示策略", fp.displayMode === "native" ? "原生一致" : "自定义"], ["平台", fp.platform], ["内核版本", fp.chromeVersion], ["语言", fp.language], ["时区", fp.timezone], ["屏幕", `${fp.screen.width} × ${fp.screen.height}`], ["核心 / 内存", `${fp.hardwareConcurrency} 核心 / ${fp.deviceMemory} GB`], ["像素比", fp.devicePixelRatio], ["WebRTC", profile.webrtc === "proxy" ? "受限连接" : "关闭"], ["WebGL 厂商", fp.noise?.webgl===false?"原生 · 通过网页检查读取":fp.webgl.vendor], ["渲染器", fp.noise?.webgl===false?"原生 · 通过网页检查读取":fp.webgl.renderer]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details><FingerprintAudit profile={profile} audit={audit} busy={auditBusy} error={auditError} native={native} pages={pages} selectedPage={selectedPage} pageLoading={pageLoading} onRefreshPages={refreshPages} onSelectPage={id=>{setSelectedPage(id);setAudit(null);setAuditError('');}} onCheck={checkFingerprint} onCopy={()=>execute(()=>window.api.copy(JSON.stringify(audit,null,2)),"网页检查结果已复制")} /><details className="raw-json"><summary>查看完整 JSON</summary><pre>{JSON.stringify(fp, null, 2)}</pre></details></>}</section> },
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
