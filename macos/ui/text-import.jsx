import React,{useRef,useState} from 'react';
import {Modal} from './components';
import {useWorkspace,messageOf} from './context';
import {useEditorGuard,useEditorErrorFocus,EditorFooter,submitShortcut} from './editor-state';
import {validateProxyImport} from '../src/main/proxy-import-validation';
export function TextImport({title,description,onClose,run}){
 const {refresh,notify}=useWorkspace();
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
 const form=useRef(null),input=useRef(null),guard=useEditorGuard(text,busy,onClose);
 useEditorErrorFocus(error,busy,input);
 const count=text.split(/\r?\n/).filter(line=>line.trim()).length;
 const submit=async event=>{
  event.preventDefault();if(busy||guard.discard)return;setError(null);
  try{
   validateProxyImport(text);setBusy(true);const result=await run(text);if(!result||result.ok===false)throw new Error(result?.error||'导入未完成');
   await refresh();notify(`已导入 ${result.count} 条记录`);onClose();
  }catch(failure){setError({message:messageOf(failure),start:failure.start,end:failure.end});}
  finally{setBusy(false);}
 };
 return <Modal open className="text-import-modal" dismissible={!busy} onOpenChange={open=>!open&&guard.requestClose()} onKeyDown={event=>submitShortcut(event,busy,form.current)} title={title} description={description} footer={<EditorFooter guard={guard} busy={busy} error={error} note={`${count} 条待导入 · 最多 500 条`} saveLabel="导入" formId="text-import-form" errorId="text-import-error"/>}>
  <form id="text-import-form" ref={form} onSubmit={submit} noValidate><textarea ref={input} className="import-text" autoFocus rows={10} value={text} disabled={busy} onChange={event=>setText(event.target.value)} placeholder="http://username:password@host:8080" aria-label={title} aria-invalid={!!error} aria-describedby={error?'text-import-error':undefined}/><p className="import-count" aria-live="polite">{count} 条配置 · 空行会忽略 · 保存前可继续修改</p></form>
 </Modal>;
}
