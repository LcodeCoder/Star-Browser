import React,{useRef,useState} from 'react';
import {Modal,Field} from './components';
import {useWorkspace,messageOf} from './context';
import {useEditorGuard,useEditorErrorFocus,EditorFooter,submitShortcut} from './editor-state';
import validation from '../src/main/bookmark-validation';
const {validateBookmark}=validation;
export function BookmarkEditor({item,onClose}){
 const {refresh,notify}=useWorkspace();
 const [form,setForm]=useState({title:item.title||'',url:item.url||''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(null);const formRef=useRef(null);
 const guard=useEditorGuard(form,busy,onClose);
 useEditorErrorFocus(error,busy,error?.field?'bookmark-'+error.field:'bookmark-editor-error');
 function update(key,value){setForm(current=>({...current,[key]:value}));if(error?.field===key)setError(null);guard.setDiscard(false);}
 async function save(event){
  event.preventDefault();if(busy)return;guard.setDiscard(false);setError(null);
  let value;try{value=validateBookmark(form);}catch(error){setError({message:error.message,field:error.field});return;}
  setBusy(true);
  try{if(item.id)await window.api.bookmarksUpdate(item.id,value);else await window.api.bookmarksAdd(value);await refresh();notify('书签已保存');onClose();}
  catch(error){setError({message:messageOf(error)});}finally{setBusy(false);}
 }
 return <Modal open onOpenChange={open=>!open&&guard.requestClose()} dismissible={!busy} title={item.id?'编辑书签':'添加书签'} description="保存后显示在工作台和各环境的书签栏。" className="bookmark-editor-modal" onKeyDown={event=>submitShortcut(event,busy,formRef.current)} footer={<EditorFooter guard={guard} busy={busy} error={error} note="书签保存在这台设备上" saveLabel="保存书签" formId="bookmark-form" errorId="bookmark-editor-error"/>}>
  <form id="bookmark-form" ref={formRef} noValidate onSubmit={save}>
   <fieldset className="editor-fieldset form-grid" disabled={busy}>
    <Field id="bookmark-title" label="名称" className="span-2" error={error?.field==='title'?error.message:undefined}><input autoFocus maxLength={512} value={form.title} onChange={event=>update('title',event.target.value)} /></Field>
    <Field id="bookmark-url" label="网址" className="span-2" hint="输入完整的 HTTP 或 HTTPS 网址。" error={error?.field==='url'?error.message:undefined}><input spellCheck={false} type="url" maxLength={4096} value={form.url} placeholder="https://example.com" onChange={event=>update('url',event.target.value)} /></Field>
   </fieldset>
  </form>
 </Modal>;
}
