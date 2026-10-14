import React,{useRef,useState} from 'react';
import {Modal,Field} from './components';
import {useWorkspace,messageOf} from './context';
import {useEditorGuard,useEditorErrorFocus,EditorFooter,submitShortcut} from './editor-state';
import {validateProfile} from '../src/main/profile-validation';

export function BatchProfileEditor({ids,onClose}){
 const {snapshot,refresh,notify}=useWorkspace();
 const [value,setValue]=useState({group:'',tagsMode:'keep',tags:'',proxyId:'keep'}),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const form=useRef(null),guard=useEditorGuard(value,busy,onClose);
 const fieldIds={group:'batch-group',tags:'batch-tags',tagsMode:'batch-tags-mode',proxy:'batch-proxy'};
 useEditorErrorFocus(error,busy,fieldIds[error?.field]||'batch-editor-error');
 const set=(key,next)=>{setError(null);guard.setDiscard(false);setValue(current=>({...current,[key]:next}));};
 const submit=async event=>{
  event.preventDefault();if(busy||guard.discard)return;setError(null);
  try{
   const fail=(message,field)=>{const issue=new Error(message);issue.field=field;throw issue;};
   if(!ids.length||ids.length>500)fail('每次请选择 1–500 个环境。关闭编辑器后调整选择，再重试。');
   if(ids.some(id=>!snapshot.profiles.some(profile=>profile.id===id)))fail('部分环境已不存在。关闭编辑器，刷新列表后重新选择。');
   const patch={};
   if(value.group.trim()){
    if(value.group.trim().length>80)fail('分组名称最多 80 个字符','group');
    patch.group=value.group.trim();
   }
   if(['replace','append'].includes(value.tagsMode)){
    const tags=[...new Set(value.tags.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean))];
    if(!tags.length)fail(value.tagsMode==='append'?'填写要添加的标签':'填写要替换的标签，或选择“清空标签”','tags');
    if(tags.length>20||tags.some(tag=>tag.length>40))fail('最多 20 个标签，每个标签最多 40 个字符','tags');
    if(value.tagsMode==='append')for(const id of ids){
     const profile=snapshot.profiles.find(item=>item.id===id);
     if(new Set([...(profile.tags||[]),...tags]).size>20)fail(`“${profile.name}”添加后超过 20 个标签，请减少新增标签`,'tags');
    }
    patch.tags=tags;
   }else if(value.tagsMode==='clear')patch.tags=[];
   if(value.proxyId!=='keep'){
    if(value.proxyId==='direct')patch.proxy=null;
    else{const proxy=snapshot.proxies.find(item=>item.id===value.proxyId);if(!proxy)fail('所选代理已不存在，请重新选择','proxy');patch.proxy=proxy;}
   }
   if(!Object.keys(patch).length)fail('先选择至少一项要更改的配置','group');
   const validated=validateProfile(patch);setBusy(true);
   const result=await window.api.action('update',ids,validated,{tagsMode:value.tagsMode==='append'?'append':'replace'});
   if(!result||result.ok===false)throw new Error(result?.error||'批量更改没有完成，请重试');
   await refresh();notify(`${ids.length} 个环境的配置已更新，下次启动生效`);onClose();
  }catch(failure){setError({message:messageOf(failure),field:failure.field?.startsWith('proxy.')?'proxy':failure.field||(value.tagsMode==='append'&&/标签/.test(failure.message)?'tags':undefined)});}
  finally{setBusy(false);}
 };
 return <Modal open className="batch-profile-editor-modal" dismissible={!busy} onOpenChange={open=>!open&&guard.requestClose()} onKeyDown={event=>submitShortcut(event,busy,form.current)} title="批量更改配置" description={`更改选中的 ${ids.length} 个环境。保留未指定的配置，现有浏览数据继续保存。`} footer={<EditorFooter guard={guard} busy={busy} error={error} note="配置在下次启动时生效" saveLabel="保存更改" formId="batch-profile-form" errorId="batch-editor-error"/>}>
  <form id="batch-profile-form" ref={form} onSubmit={submit} noValidate>
   <fieldset className="editor-fieldset" disabled={busy}><div className="form-grid">
    <Field label="分组" id="batch-group" className="span-2" hint="留空保留各环境的当前分组。" error={error?.field==='group'?error.message:undefined}><input id="batch-group" maxLength={80} value={value.group} onChange={event=>set('group',event.target.value)} placeholder="保留当前分组"/></Field>
    <Field label="标签操作" id="batch-tags-mode" className="span-2"><select id="batch-tags-mode" value={value.tagsMode} onChange={event=>set('tagsMode',event.target.value)}><option value="keep">保留当前标签</option><option value="append">添加到现有标签</option><option value="replace">替换为指定标签</option><option value="clear">清空标签</option></select></Field>
    {['replace','append'].includes(value.tagsMode)&&<Field label={value.tagsMode==='append'?'新增标签':'替换标签'} id="batch-tags" className="span-2" hint={value.tagsMode==='append'?'保留各环境的现有标签，自动去重。添加后每个环境最多 20 个标签。':'使用逗号分隔。最多 20 个标签，每个最多 40 个字符。'} error={error?.field==='tags'?error.message:undefined}><input id="batch-tags" value={value.tags} onChange={event=>set('tags',event.target.value)} placeholder="例如：工作, 日常"/></Field>}
    <Field label="代理配置" id="batch-proxy" className="span-2" error={error?.field==='proxy'?error.message:undefined}><select id="batch-proxy" value={value.proxyId} onChange={event=>set('proxyId',event.target.value)}><option value="keep">保留当前代理</option><option value="direct">使用本机网络</option>{snapshot.proxies.map(proxy=><option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></Field>
   </div></fieldset>
  </form>
 </Modal>;
}
