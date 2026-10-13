import React, {useState, useRef} from "react";
import {Modal, Field} from "./components";
import {useWorkspace, messageOf} from "./context";
import {useEditorGuard, EditorFooter, submitShortcut} from "./editor-state";
import {validateProxy, ProfileValidationError} from "../src/main/profile-validation";
import {parseProxyInput} from "../src/main/proxy-parse";

export function ProxyEditor({initial = {}, onClose}) {
  const {refresh, notify} = useWorkspace();
  const [form, setForm] = useState(() => ({name: "", type: "http", host: "", port: "", user: "", pass: "", ...initial}));
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const formRef = useRef(null), guard = useEditorGuard(form, busy, onClose);
  const update = (key, value) => { setForm(f => ({...f, [key]: value})); setError(null); guard.setDiscard(false); };
  const fieldError = key => error?.field === key ? error.message : undefined;
  const paste = event => {
    const parsed = parseProxyInput(event.clipboardData.getData('text'), form.type);
    if (!parsed) return;
    event.preventDefault();
    setForm(f => ({...f, ...parsed})); setError(null); guard.setDiscard(false);
    setNotice("已解析协议、地址、端口和账号，请核对后保存。");
  };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setError(null); guard.setDiscard(false);
    try {
      if (!form.name.trim()) throw new ProfileValidationError("给代理起个名称，方便分配给环境", "name");
      const proxy = validateProxy(form);
      if (!proxy) throw new ProfileValidationError("请填写代理地址", "proxy.host");
      setBusy(true);
      await window.api.proxySave({...proxy, id: form.id, name: form.name.trim()});
      await refresh(); notify("代理已保存"); onClose();
    } catch (failure) {
      setError({message: messageOf(failure), field: failure.field});
      const key = failure.field === 'name' ? 'name' : failure.field?.replace(/^proxy\./, '');
      requestAnimationFrame(() => formRef.current?.querySelector('#proxy-' + (key || 'name'))?.focus());
    } finally { setBusy(false); }
  };
  return <Modal open dismissible={!busy} onOpenChange={open => !open && guard.requestClose()}
    title={initial.id ? "编辑代理" : "添加代理"} description="配置保存在这台设备上，保存后可分配给多个环境。"
    className="proxy-editor-modal" onKeyDown={event=>submitShortcut(event,busy,formRef.current)} footer={<EditorFooter guard={guard} busy={busy} error={error}
      errorId="proxy-editor-error" note="支持 HTTP、HTTPS 和 SOCKS5" saveLabel="保存代理" formId="proxy-form" />}>
    <form id="proxy-form" ref={formRef} noValidate onSubmit={save}>
      <fieldset disabled={busy} className="editor-fieldset form-grid">
        <Field label="名称" id="proxy-name" error={fieldError('name')} className="span-2"><input autoFocus maxLength={120} value={form.name} placeholder="例如：日本工作网络" onChange={e => update('name', e.target.value)} /></Field>
        <Field label="协议" id="proxy-type" error={fieldError('proxy.type')}><select value={form.type} onChange={e => update('type', e.target.value)}>{['http','https','socks5'].map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></Field>
        <Field label="端口" id="proxy-port" error={fieldError('proxy.port')}><input inputMode="numeric" value={form.port} placeholder="8080" onChange={e => update('port', e.target.value)} /></Field>
        <Field label="地址" id="proxy-host" error={fieldError('proxy.host')} className="span-2" hint="输入主机名、IPv4、IPv6，或直接粘贴完整代理地址。"><input spellCheck={false} onPaste={paste} value={form.host} placeholder="proxy.example.com" onChange={e => {update('host', e.target.value); setNotice('');}} /></Field>
        <Field label="账号" id="proxy-user" error={fieldError('proxy.user')}><input autoComplete="off" spellCheck={false} value={form.user} onChange={e => update('user', e.target.value)} /></Field>
        <Field label="密码" id="proxy-pass" error={fieldError('proxy.pass')}><input type="password" autoComplete="new-password" value={form.pass} onChange={e => update('pass', e.target.value)} /></Field>
        {notice && <p className="field-hint span-2" role="status">{notice}</p>}
      </fieldset>
    </form>
  </Modal>;
}
