import React, {useLayoutEffect, useRef, useState} from "react";
import {Button} from "./components";

export function useWindowCloseGuard(dirty, busy) {
  const id = useRef(null);
  if (!id.current) id.current = crypto.randomUUID();
  useLayoutEffect(() => {
    window.api.editorState?.({id:id.current, dirty, busy});
  }, [dirty, busy]);
  useLayoutEffect(() => () => window.api.editorState?.({id:id.current, dirty:false, busy:false}), []);
}

export function useEditorGuard(value, busy, onClose) {
  const initial = useRef(JSON.stringify(value));
  const [discard, setDiscard] = useState(false);
  const footerRef = useRef(null), previousFocus = useRef(null);
  const dirty = JSON.stringify(value) !== initial.current;
  useWindowCloseGuard(dirty, busy);
  useLayoutEffect(() => {
    if (discard) {
      footerRef.current?.querySelector('[data-continue-editing]')?.focus();
    } else if (previousFocus.current) {
      const {element, start, end, direction} = previousFocus.current;
      previousFocus.current = null;
      if (element?.isConnected) {
        element.focus();
        if (Number.isInteger(start)) element.setSelectionRange?.(start, end, direction);
      }
    }
  }, [discard]);
  const requestClose = () => {
    if (busy) return;
    if (!dirty) { onClose(); return; }
    if (!discard) {
      const element = document.activeElement;
      previousFocus.current = {element, start:element?.selectionStart, end:element?.selectionEnd, direction:element?.selectionDirection};
    }
    setDiscard(true);
  };
  const resume = () => setDiscard(false);
  return {dirty, discard, setDiscard, requestClose, resume, footerRef, onClose};
}

// Focus after React has committed the error and re-enabled controls. A delayed
// frame can otherwise lose the error selection or steal focus from a later click.
export function useEditorErrorFocus(error, busy, target) {
  useLayoutEffect(() => {
    if (!error || busy) return;
    const element = typeof target === 'string' ? document.getElementById(target) : target.current;
    if (!element?.isConnected) return;
    element.focus({preventScroll:true});
    if (Number.isInteger(error.start)) element.setSelectionRange?.(error.start, error.end);
    element.scrollIntoView({block:'nearest'});
  }, [error, busy, target]);
}

export function EditorFooter({guard, busy, error, note, saveLabel, formId, errorId}) {
  return <div className="editor-footer" ref={guard.footerRef}>
    {error && <p className="inline-error" role="alert" tabIndex={-1} id={errorId}>{error.message || error}</p>}
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
