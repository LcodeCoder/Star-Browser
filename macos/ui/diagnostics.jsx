import React, {useState, useEffect, useRef} from 'react';
import {ArrowUpRight, ShieldCheck, Search, RefreshCw} from 'lucide-react';
import {Button, Modal} from './components';
import {useWorkspace, messageOf} from './context';
import catalog from '../src/resources/diagnostics.json';

export function ExternalDiagnostics({profile}) {
  const {refresh, notify} = useWorkspace();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const errorRef=useRef(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => {window.removeEventListener('online', update); window.removeEventListener('offline', update);};
  }, []);
  useEffect(() => {setOpen(false);setQuery('');setError('');}, [profile.id]);
  const rows = catalog.filter(row => (row.name+' '+row.description+' '+row.group+' '+row.url).toLowerCase().includes(query.trim().toLowerCase()));
  async function launch(row) {
    setBusy(row.id);setError('');
    try {
      await window.api.diagnosticOpen(profile.id,row.id);
      setOpen(false);await refresh();notify(row.name+' 已在「'+profile.name+'」打开');
    } catch (error) {setError(messageOf(error));}
    finally {setBusy('');}
  }
  return <>
    <Button variant="text" icon={ShieldCheck} disabled={profile.archived} onClick={() => {setError('');setOpen(true);}}>外部检测</Button>
    <Modal open={open} onOpenChange={setOpen} title="检测此环境" description={'在「'+profile.name+'」的新标签打开；未启动时会先启动环境。'}>
      <div className="diagnostic-search"><Search size={16}/><input autoFocus type="search" aria-label="搜索检测项目" placeholder="搜索语言、网络或图形…" value={query} onChange={event=>setQuery(event.target.value)}/></div>
      {offline&&<p className="inline-warning" role="status">当前离线，连接网络后再检测。</p>}
      {error&&<div ref={errorRef} tabIndex={-1} className="inline-error" role="alert">{error}</div>}
      {!rows.length ? <div className="diagnostic-zero"><p>没有匹配的检测项目</p><Button variant="text" onClick={()=>setQuery('')}>清除搜索</Button></div> : <div className="diagnostic-options">
        {['综合','浏览器','网络','图形'].map(group => {
          const matches=rows.filter(row=>row.group===group);if(!matches.length)return null;
          return <section className="diagnostic-group-section" key={group}><h3>{group}</h3>{matches.map(row=><button className="diagnostic-option" key={row.id} aria-label={row.name} aria-describedby={'external-description-'+row.id} disabled={offline||!!busy} onClick={()=>launch(row)}><span><strong>{row.name}</strong><small id={'external-description-'+row.id}>{row.description}</small></span>{busy===row.id?<RefreshCw size={17} className="spin"/>:<ArrowUpRight size={17}/>}</button>)}</section>;
        })}
      </div>}
      <p className="diagnostic-footnote">结果以检测网站的实际读数为准。</p>
    </Modal>
  </>;
}
