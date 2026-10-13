import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Cookie,Search,Download,Upload,Trash2,RefreshCw,ChevronLeft,ChevronRight,LoaderCircle} from 'lucide-react';
import {Button,IconButton,Empty} from './components';
import {useWorkspace,messageOf,timeAgo} from './context';
const PAGE_SIZE=50;
export function CookiePage(){
 const {snapshot,confirm,notify}=useWorkspace();
 const [counts,setCounts]=useState({}),[query,setQuery]=useState(''),[page,setPage]=useState(0),[epoch,setEpoch]=useState(0),[busy,setBusy]=useState(new Set()),[actionErrors,setActionErrors]=useState({});
 const cache=useRef(new Map()),tokens=useRef(new Map()),sequence=useRef(0),mounted=useRef(true),operations=useRef(new Set()),pool=useRef({active:0,queue:[]}),previousEpoch=useRef(0);
 const profiles=snapshot.profiles.filter(p=>!p.archived&&[p.name,p.group,...p.tags].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const pages=Math.max(1,Math.ceil(profiles.length/PAGE_SIZE)),current=Math.min(page,pages-1),visible=profiles.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE),key=visible.map(p=>p.id).join(',');
 const drain=useCallback(()=>{
  const reader=pool.current;
  while(reader.active<4&&reader.queue.length){
   const job=reader.queue.shift();if(!job.valid()){job.resolve();continue;}
   reader.active++;
   Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{reader.active--;drain();});
  }
 },[]);
 const readCount=useCallback((id,{force=false,valid=()=>true}={})=>{
  if(!mounted.current||!valid()||!force&&cache.current.get(id)?.state==='ready')return Promise.resolve();
  const token=++sequence.current;tokens.current.set(id,token);
  const update=value=>{if(mounted.current&&valid()&&tokens.current.get(id)===token){cache.current.set(id,value);setCounts(current=>({...current,[id]:value}));}};
  update({state:'loading'});
  return new Promise((resolve,reject)=>{
   pool.current.queue.push({resolve,reject,valid:()=>mounted.current&&valid()&&tokens.current.get(id)===token,run:async()=>{
    try{const result=await window.api.cookieCount(id);if(!result||result.ok===false||!Number.isInteger(result.count)||result.count<0)throw new Error(result?.error||'Cookie 数量未能读取');update({state:'ready',count:result.count});}
    catch(error){update({state:'failed',error:messageOf(error)});}
   }});drain();
  });
 },[drain]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;for(const job of pool.current.queue.splice(0))job.resolve();};},[]);
 useEffect(()=>{
  let live=true;const force=previousEpoch.current!==epoch;previousEpoch.current=epoch;
  for(const id of key.split(',').filter(Boolean))readCount(id,{force,valid:()=>live});
  return()=>{live=false;};
 },[key,epoch,readCount]);
 const act=async(profile,method,propagate=false)=>{
  if(operations.current.has(profile.id))return;
  operations.current.add(profile.id);setBusy(new Set(operations.current));setActionErrors(current=>({...current,[profile.id]:''}));
  try{
   const result=await window.api[method](profile.id);
   if(result?.canceled){notify('操作已取消');return;}
   if(!result||result.ok===false)throw new Error(result?.error||'Cookie 操作未完成');
   const message=method==='cookieImport'?`已导入 ${result.okCount??result.count??0} 条 Cookie${result.failCount?`，${result.failCount} 条未导入`:''}`:method==='cookieClear'?`已清空 ${result.cleared??0} 条 Cookie`:`已导出 ${result.count??0} 条 Cookie`;
   notify(message,result.failCount?'error':'success');
  }catch(error){if(mounted.current)setActionErrors(current=>({...current,[profile.id]:messageOf(error)}));if(propagate)throw error;notify(messageOf(error),'error');}
  finally{await readCount(profile.id,{force:true});operations.current.delete(profile.id);if(mounted.current)setBusy(new Set(operations.current));}
 };
 return <div className="cookie-workspace">
  <div className="page-toolbar"><div className="search-box"><Cookie size={17}/><input value={query} aria-label="搜索 Cookie 环境" placeholder="搜索环境、分组或标签" onChange={event=>{setQuery(event.target.value);setPage(0);}}/></div><span className="toolbar-spacer"/><Button icon={RefreshCw} onClick={()=>setEpoch(value=>value+1)} disabled={!profiles.length}>刷新数量</Button></div>
  {visible.length?<>
   <div className="object-table cookie-table"><table><thead><tr><th>环境</th><th>Cookie 数量</th><th>最近打开</th><th className="align-right">操作</th></tr></thead><tbody>{visible.map(profile=>{
    const count=counts[profile.id],active=busy.has(profile.id);
    return <tr key={profile.id} data-cookie-profile={profile.id}><td><strong>{profile.name}</strong><small>{profile.group}</small>{actionErrors[profile.id]&&<small className="cookie-row-error" role="alert">{actionErrors[profile.id]}</small>}</td><td><div className="cookie-count" aria-live="polite">{count?.state==='ready'?`${count.count} 条`:count?.state==='failed'?<><span title={count.error}>读取失败</span><IconButton icon={RefreshCw} label={'重试读取 '+profile.name} onClick={()=>readCount(profile.id,{force:true})}/></>:<><LoaderCircle size={14} className="spin"/><span>读取中…</span></>}</div></td><td className="muted">{timeAgo(profile.lastOpenedAt)}</td><td><div className="row-actions"><Button icon={Download} title="导出 Cookie" disabled={active} onClick={()=>act(profile,'cookieExport')}>导出</Button><Button icon={Upload} title="导入 Cookie" disabled={active} onClick={()=>act(profile,'cookieImport')}>导入</Button><IconButton icon={Trash2} disabled={active} label={`清空 ${profile.name} Cookie`} onClick={()=>confirm({title:`清空 ${profile.name} 的 Cookie？`,description:'登录状态可能会失效。可以先导出备份。',label:'清空 Cookie',run:()=>act(profile,'cookieClear',true)})}/></div></td></tr>;
   })}</tbody></table></div>
   <div className="list-footer cookie-footer"><span aria-live="polite">{current*PAGE_SIZE+1}–{Math.min((current+1)*PAGE_SIZE,profiles.length)} / {profiles.length} 个环境</span><span className="toolbar-spacer"/><nav className="cookie-pagination" aria-label="Cookie 环境分页"><Button icon={ChevronLeft} disabled={current===0} onClick={()=>setPage(current-1)}>上一页</Button><Button icon={ChevronRight} disabled={current>=pages-1} onClick={()=>setPage(current+1)}>下一页</Button></nav></div>
  </>:<Empty icon={query?Search:Cookie} title={query?'没有找到这个 Cookie 环境':'还没有可管理的 Cookie 环境'} description={query?'试试其他名称、分组或标签。':'创建环境并浏览网页后，登录状态会保存在这里。'}>{query&&<Button onClick={()=>{setQuery('');setPage(0);}}>清空搜索</Button>}</Empty>}
 </div>;
}
