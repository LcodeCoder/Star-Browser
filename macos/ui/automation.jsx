import React,{useState,useEffect} from "react";
import {Copy,KeyRound,RefreshCw,BookOpen,LoaderCircle} from "lucide-react";
import {Button,Modal,Badge} from "./components";
import {useWorkspace,messageOf} from "./context";
export function LocalApiSettings(){
 const {execute,confirm}=useWorkspace();
 const [status,setStatus]=useState(null),[port,setPort]=useState("0"),[error,setError]=useState(""),[busy,setBusy]=useState(false),[docs,setDocs]=useState("");
 const load=async()=>{try{const next=await window.api.localApiStatus();setStatus(next);setPort(String(next.configuredPort));setError("");}catch(e){setError(messageOf(e));}};
 useEffect(()=>{load();},[]);
 const configure=async(enabled)=>{setBusy(true);try{await execute(async()=>{const next=await window.api.localApiConfigure({enabled,port});setStatus(next);return next;},enabled?"本地 API 已启用":"本地 API 已关闭");}finally{setBusy(false);}};
 return <section><div className="settings-heading"><h2>本地自动化</h2><p>让这台 Mac 上的脚本管理环境与启动浏览器。</p></div>
  {error?<p className="inline-error" role="alert">{error} <Button onClick={load}>重新加载</Button></p>:!status?<p className="loading-state"><LoaderCircle className="spin" size={16}/>正在读取设置…</p>:<>
   <div className="settings-row"><div><strong>本地自动化 API</strong><p>仅在本机接受持有密钥的请求。</p></div><button className={"switch "+(status.enabled?"on":"")} role="switch" aria-label="本地自动化 API" aria-checked={status.enabled} disabled={busy} onClick={()=>configure(!status.enabled)}><span/></button></div>
   <div className="settings-row"><div><strong>监听端口</strong><p>0 自动选择；固定端口方便脚本重复连接。</p></div><div className="inline-controls"><input className="port-input" aria-label="API 监听端口" inputMode="numeric" value={port} onChange={e=>setPort(e.target.value)} disabled={busy}/><Button disabled={busy||String(status.configuredPort)===port} onClick={()=>configure(status.enabled)}>保存端口</Button></div></div>
   {status.error&&<p className="inline-error" role="alert">{status.error}</p>}
   <div className="settings-row"><div><strong>{status.listening?"已就绪":"已关闭"}</strong><p className="api-address">{status.url||"启用后显示连接地址"}</p></div><Badge status={status.listening?"success":"muted"}>{status.listening?"本机服务运行中":"未监听"}</Badge></div>
   <div className="api-tools"><Button icon={Copy} disabled={!status.listening} onClick={()=>execute(()=>window.api.copy(status.url),"API 地址已复制")}>复制地址</Button><Button icon={KeyRound} onClick={()=>execute(()=>window.api.localApiCopyToken(),"API 密钥已复制")}>复制密钥</Button><Button icon={RefreshCw} onClick={()=>confirm({title:"重新生成 API 密钥？",description:"使用旧密钥的脚本需要更新配置。",label:"重新生成密钥",run:()=>execute(async()=>{const next=await window.api.localApiRotateToken();setStatus(next);return next;},"新密钥已生成，旧密钥已失效")})}>更新密钥</Button><Button icon={BookOpen} onClick={()=>execute(async()=>{const text=await window.api.localApiDocs();setDocs(text);})}>接口说明</Button></div>
  </>}
  <Modal open={!!docs} onOpenChange={v=>!v&&setDocs("")} wide title="本地 API 接口说明" description="用本机脚本连接 Star Browser。" footer={<><Button onClick={()=>execute(()=>window.api.copy(docs),"接口说明已复制")}>复制说明</Button><Button onClick={()=>setDocs("")}>关闭</Button></>}><pre className="api-docs">{docs}</pre></Modal>
 </section>;
}
