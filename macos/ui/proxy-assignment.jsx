import React,{useEffect,useRef,useState} from 'react';
import {Modal,Field} from './components';
import {useWorkspace,messageOf,proxyLabel} from './context';
import {useEditorGuard,EditorFooter,submitShortcut} from './editor-state';
export function ProxyAssignment({proxy,onClose}){
 const {snapshot,refresh,notify}=useWorkspace();
 const [target,setTarget]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null),[invalidTarget,setInvalidTarget]=useState(false);
 const form=useRef(null),input=useRef(null),guard=useEditorGuard(target,busy,onClose);
 useEffect(()=>{if(error){const focus=()=>input.current?.focus();requestAnimationFrame(focus);setTimeout(focus,0);}},[error]);
 const submit=async event=>{
  event.preventDefault();if(busy||guard.discard)return;setError(null);setInvalidTarget(false);
  try{
   if(!snapshot.profiles.some(profile=>profile.id===target&&!profile.archived)){setInvalidTarget(true);throw new Error(target?'所选环境已不存在或已归档，请重新选择':'请选择需要分配代理的环境');}
   setBusy(true);const result=await window.api.update(target,{proxy});if(!result||result.ok===false)throw new Error(result?.error||'环境已不存在，请刷新后重试');
   await refresh();notify('代理已分配，下次启动生效');onClose();
  }catch(failure){setError(messageOf(failure));}
  finally{setBusy(false);}
 };
 return <Modal open className="proxy-assignment-modal" dismissible={!busy} onOpenChange={open=>!open&&guard.requestClose()} onKeyDown={event=>submitShortcut(event,busy,form.current)} title="分配代理" description={`${proxy.name} · ${proxyLabel(proxy)}`} footer={<EditorFooter guard={guard} busy={busy} error={error} note="配置在下次启动时生效" saveLabel="分配到环境" formId="proxy-assignment-form" errorId="proxy-assignment-error"/>}>
  <form id="proxy-assignment-form" ref={form} onSubmit={submit} noValidate><Field label="选择环境" id="proxy-assignment-target"><select id="proxy-assignment-target" ref={input} value={target} disabled={busy} aria-invalid={invalidTarget} aria-describedby={error?'proxy-assignment-error':undefined} onChange={event=>setTarget(event.target.value)}><option value="">请选择</option>{snapshot.profiles.filter(profile=>!profile.archived).map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.group}</option>)}</select></Field></form>
 </Modal>;
}
