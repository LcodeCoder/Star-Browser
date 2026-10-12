import React,{useEffect,useState} from "react";
import {ArchiveRestore,LockKeyhole,Download,Upload,LoaderCircle,Search,Check} from "lucide-react";
import {Button,Modal,Field,Badge,Empty} from "./components";
import {useWorkspace,messageOf,dateTime} from "./context";
const phaseNames={collecting:"整理环境数据…",encrypting:"加密并保存…",decrypting:"校验并读取备份…",restoring:"恢复环境数据…"};
export function BackupSettings(){
 const {snapshot,refresh,notify}=useWorkspace();
 const [mode,setMode]=useState(null),[password,setPassword]=useState(""),[repeat,setRepeat]=useState(""),[selected,setSelected]=useState(new Set()),[query,setQuery]=useState(""),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState(null);
 const running=new Set(snapshot.runtime.map(row=>row.id)),profiles=snapshot.profiles.filter(p=>[p.name,p.group,...p.tags].join(" ").toLowerCase().includes(query.toLowerCase()));
 useEffect(()=>{if(!busy)return;let mounted=true;const load=async()=>{try{const value=await window.api.backupStatus();if(mounted)setProgress(value);}catch{}};load();const timer=setInterval(load,500);return()=>{mounted=false;clearInterval(timer);};},[busy]);
 const begin=value=>{setMode(value);setPassword("");setRepeat("");setError("");setPreview(null);setProgress(null);setQuery("");setSelected(new Set());};
 const close=()=>{if(busy)return;if(preview)window.api.backupDiscard(preview.token).catch(()=>{});setMode(null);setPreview(null);setPassword("");setRepeat("");setError("");};
 const submit=async()=>{
  if(password.length<8&&!preview){setError("请输入至少 8 个字符的备份密码");return;}
  if(mode==="export"&&password!==repeat){setError("两次输入的密码不同");return;}
  if(mode==="export"&&!selected.size){setError("请选择至少一个已停止的环境");return;}
  setBusy(true);setError("");
  try{
   if(mode==="export"){
    const result=await window.api.backupExport([...selected],password);if(result.canceled)return;
    notify(`已保存 ${result.count} 个环境的加密备份`);setMode(null);setPassword("");setRepeat("");await refresh();
   }else if(!preview){
    const result=await window.api.backupPreview(password);if(!result.canceled){setPreview(result);setPassword("");}
   }else{
    const result=await window.api.backupRestore(preview.token);notify(`已恢复 ${result.count} 个独立环境`);setPreview(null);setMode(null);await refresh();
   }
  }catch(e){setError(messageOf(e));if(mode==="restore"&&preview)setPreview(null);}finally{setBusy(false);}
 };
 return <section><div className="settings-heading"><h2>备份与恢复</h2><p>用加密文件保存环境配置与浏览数据。</p></div>
  <div className="settings-row"><div><strong>加密环境备份</strong><p>包含 Cookie、网页存储、会话、历史和已分配的扩展。</p></div><Button icon={Download} onClick={()=>begin("export")} disabled={!snapshot.profiles.length}>保存备份</Button></div>
  <div className="settings-row"><div><strong>从备份恢复</strong><p>创建独立副本，保留备份中的指纹配置。</p></div><Button icon={Upload} onClick={()=>begin("restore")}>恢复备份</Button></div>
  <p className="backup-footnote"><LockKeyhole size={14}/>请妥善保存密码，Star Browser 无法找回备份密码。浏览缓存和下载文件不包含在备份中。</p>
  <Modal dismissible={!busy} open={!!mode} onOpenChange={open=>!open&&close()} wide title={mode==="export"?"保存加密环境备份":preview?"确认恢复环境":"打开加密环境备份"} description={mode==="export"?"选择已停止的环境并设置备份密码。":preview?"恢复后会在环境列表中添加独立副本。":"输入备份密码，然后选择 .starbackup 文件。"} footer={<><span className="footer-note">{mode==="export"?`已选择 ${selected.size} 个环境`:preview?`${preview.count} 个环境 · ${(preview.bytes/1024/1024).toFixed(1)} MB`:"密码只用于解密所选备份"}</span><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" icon={busy?LoaderCircle:preview?ArchiveRestore:mode==="export"?Download:Upload} disabled={busy} onClick={submit}>{busy?"处理中…":preview?"恢复独立副本":mode==="export"?"选择保存位置":"选择备份并预览"}</Button></>}>
   {mode==="export"&&<><div className="backup-list-toolbar"><div className="search-box"><Search size={16}/><input aria-label="搜索备份环境" placeholder="搜索名称、分组或标签" value={query} onChange={e=>setQuery(e.target.value)} disabled={busy}/></div><Button disabled={busy} onClick={()=>setSelected(new Set(profiles.filter(p=>!running.has(p.id)).slice(0,500).map(p=>p.id)))}>选择当前结果</Button></div><div className="backup-environments">{profiles.slice(0,500).map(p=><label className="backup-environment" key={p.id}><input type="checkbox" aria-label={"备份 "+p.name} checked={selected.has(p.id)} disabled={busy||running.has(p.id)||selected.size>=500&&!selected.has(p.id)} onChange={e=>setSelected(current=>{const next=new Set(current);e.target.checked?next.add(p.id):next.delete(p.id);return next;})}/><span><strong>{p.name}</strong><small>{p.group}</small></span>{running.has(p.id)?<Badge status="warning">请先停止</Badge>:p.archived?<Badge>已归档</Badge>:null}</label>)}</div>{profiles.length>500&&<p className="muted">当前显示前 500 个环境。请通过搜索缩小范围，每份备份最多 500 个环境。</p>}{!profiles.length&&<Empty icon={Search} title="没有找到环境" description="试试其他名称或清空搜索。"/>}</>}
   {!preview&&<div className="form-grid backup-passwords"><Field label="备份密码"><input type="password" autoComplete="new-password" aria-label="备份密码" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} maxLength={1024} disabled={busy}/></Field>{mode==="export"&&<Field label="再次输入密码"><input type="password" autoComplete="new-password" aria-label="再次输入备份密码" value={repeat} onChange={e=>setRepeat(e.target.value)} disabled={busy}/></Field>}</div>}
   {preview&&<><div className="backup-summary"><Check size={18}/><div><strong>备份已解密并通过完整性校验</strong><p>{dateTime(preview.createdAt)} · Star Browser {preview.version} · {preview.files} 个文件</p></div></div><div className="backup-environments">{preview.profiles.map((p,index)=><div className="backup-environment" key={index}><ArchiveRestore size={18}/><span><strong>{p.name}</strong><small>{p.group} · {p.cookieCount} 个 Cookie</small></span>{p.hasChrome&&<Badge>含本机 Chrome 数据</Badge>}</div>)}</div>{preview.extensions.length>0&&<p className="muted">包含扩展：{preview.extensions.map(e=>e.name).join("、")}</p>}{preview.profiles.some(p=>p.hasChrome)&&<p className="backup-footnote">本机 Chrome 的登录与密码数据受 macOS 保护，换设备恢复后可能需要重新登录。</p>}</>}
   {busy&&<div className="backup-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={17}/><span>{phaseNames[progress?.phase]||"正在准备…"}{progress?.total>0&&` ${Math.min(100,Math.round(progress.completed/progress.total*100))}%`}</span></div>}
   {error&&<p className="inline-error" role="alert">{error}</p>}
  </Modal>
 </section>;
}
