import React, {useEffect, useRef, useState} from "react";
import {Button} from "./components";

export function useEditorGuard(value, busy, onClose) {
  const initial = useRef(JSON.stringify(value));
  const [discard, setDiscard] = useState(false);
  const footerRef = useRef(null), previousFocus = useRef(null);
  const dirty = JSON.stringify(value) !== initial.current;
  useEffect(() => { if (discard) footerRef.current?.querySelector('[data-continue-editing]')?.focus(); }, [discard]);
  const requestClose = () => {
    if (busy) return;
    if (!dirty) { onClose(); return; }
    if (!discard) previousFocus.current = document.activeElement;
    setDiscard(true);
  };
  const resume = () => {
    setDiscard(false);
    requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); });
  };
  return {dirty, discard, setDiscard, requestClose, resume, footerRef, onClose};
}

export function EditorFooter({guard, busy, error, note, saveLabel, formId, errorId}) {
  return <div className="editor-footer" ref={guard.footerRef}>
    {error && <p className="inline-error" role="alert" id={errorId}>{error.message || error}</p>}
    {guard.discard ? <div className="editor-discard" role="alert">
      <span><strong>修改尚未保存</strong><small>继续编辑，或放弃这次修改后关闭。</small></span>
      <Button data-continue-editing onClick={guard.resume}>继续编辑</Button>
      <Button variant="danger" onClick={guard.onClose}>放弃更改</Button>
    </div> : <div className="editor-save-actions">
      <span className="footer-note">{busy ? "正在保存…" : guard.dirty ? "有未保存的修改" : note}</span>
      <Button disabled={busy} onClick={guard.requestClose}>取消</Button>
      <Button variant="primary" type="submit" form={formId} disabled={busy}>{busy ? "保存中…" : saveLabel}</Button>
    </div>}
  </div>;
}

export function submitShortcut(event, busy, form) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
    event.preventDefault();
    if (!busy) (form || event.currentTarget).requestSubmit();
  }
}
