import React, {useState} from "react";
import {Puzzle, Plus, Trash2, Search, ShieldCheck} from "lucide-react";
import {Button, IconButton, Modal, Empty, Badge} from "./components";
import {useWorkspace, dateTime} from "./context";
const permissionNames={storage:"保存扩展设置",tabs:"读取标签信息",scripting:"在页面运行脚本",activeTab:"访问当前标签",notifications:"发送通知",clipboardRead:"读取剪贴板",clipboardWrite:"写入剪贴板",webRequest:"读取网络请求",webRequestBlocking:"更改网络请求",cookies:"读取网站 Cookie",downloads:"管理下载"};
function Permissions({values=[]}){return values.length?<ul className="extension-permissions">{values.map(value=><li key={value}>{permissionNames[value]||value}</li>)}</ul>:<p className="muted">清单没有声明额外权限。</p>;}
export function ExtensionsPage(){
 const {snapshot,execute,confirm}=useWorkspace();
 const [query,setQuery]=useState(""),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false);
 const extensions=(snapshot.extensions||[]).filter(e=>[e.name,e.description].join(" ").toLowerCase().includes(query.toLowerCase()));
 const choose=async()=>{setBusy(true);try{const result=await execute(()=>window.api.extensionPreview());if(result&&!result.canceled)setPreview(result);}finally{setBusy(false);}};
 return <>
  <div className="page-toolbar"><div className="search-box"><Search size={17}/><input aria-label="搜索扩展" placeholder="搜索扩展名称或用途" value={query} onChange={e=>setQuery(e.target.value)}/></div><span className="toolbar-spacer"/><Button icon={Plus} variant="primary" disabled={busy} onClick={choose}>{busy?"正在读取…":"添加扩展"}</Button></div>
  <p className="page-note"><ShieldCheck size={15}/>添加已解压的扩展，再为需要的环境启用。内置浏览器的扩展支持范围有限，完整 Chrome 扩展建议使用本机 Chrome。</p>
  {extensions.length?<div className="object-list">{extensions.map(extension=>{
   const count=snapshot.profiles.filter(p=>p.extensions?.includes(extension.id)).length;
   return <div className="extension-row" data-extension-id={extension.id} key={extension.id}><div className="object-item"><div className="object-symbol"><Puzzle size={21}/></div><div className="object-text"><strong>{extension.name} <Badge status="muted">{extension.version}</Badge></strong><span>{extension.description||"本地扩展"}</span></div><span className="muted">{count?count+" 个环境已启用":"尚未分配"}</span><IconButton icon={Trash2} label={"移除 "+extension.name} onClick={()=>confirm({title:"移除 "+extension.name+"？",description:count?"这会同时取消相关环境的扩展配置。扩展文件将从库中移除。":"扩展文件将从库中移除。",label:"移除扩展",run:()=>execute(()=>window.api.extensionRemove(extension.id),"扩展已移除")})}/></div><details className="extension-details"><summary>查看权限与详情</summary><p className="muted">添加于 {dateTime(extension.createdAt)} · {(extension.bytes/1024).toFixed(1)} KB</p><Permissions values={extension.permissions}/></details></div>;
  })}</div>:<Empty icon={Puzzle} title={query?"没有找到这个扩展":"把常用工具带进独立环境"} description={query?"试试其他名称，或清空搜索。":"选择已解压的扩展目录，添加后在环境设置中启用。"} action={!query&&<Button icon={Plus} onClick={choose}>添加扩展</Button>}/>}
  <Modal open={!!preview} onOpenChange={v=>!v&&!busy&&setPreview(null)} title="添加到扩展库" description="确认扩展信息和它请求的权限。" footer={<><Button disabled={busy} onClick={()=>setPreview(null)}>取消</Button><Button variant="primary" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await execute(()=>window.api.extensionApply(preview.token),"扩展已添加，可以在环境设置中启用");if(result)setPreview(null);}finally{setBusy(false);}}}>{busy?"添加中…":"添加扩展"}</Button></>}>
   {preview&&<><h3>{preview.name} <Badge status="muted">{preview.version}</Badge></h3><p className="muted">{preview.description}</p><Permissions values={preview.permissions}/></>}
  </Modal>
 </>;
}
