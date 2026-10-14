import React, {useRef, useState} from "react";
import {Plus, ArrowUp, ArrowDown, Trash2} from "lucide-react";
import {Button, IconButton, Modal, Field} from "./components";
import {useWorkspace, messageOf} from "./context";
import {useEditorGuard, useEditorErrorFocus, EditorFooter, submitShortcut} from "./editor-state";
import {TASK_NAMES, freshStep} from "./task-options";
import {validateTask, KEYS} from "../src/main/task-validation";

export function TaskEditor({task, close}) {
  const {refresh, notify} = useWorkspace();
  const [form, setForm] = useState(() => task ? structuredClone(task) : {name: '', description: '', steps: [freshStep()]});
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const formRef = useRef(null), guard = useEditorGuard(form, busy, close);
  const update = patch => { setForm(current => ({...current, ...patch})); setError(null); guard.setDiscard(false); };
  const set = (index, patch) => { setForm(current => ({...current, steps: current.steps.map((step, i) => i === index ? {...step, ...patch} : step)})); setError(null); guard.setDiscard(false); };
  const move = (index, offset) => {
    setForm(current => { const steps = [...current.steps]; [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]]; return {...current, steps}; });
    setError(null); guard.setDiscard(false);
  };
  const fieldError = field => error?.field === field ? error.message : undefined;
  const fieldId = field => 'task-' + field.replaceAll('.', '-');
  useEditorErrorFocus(error, busy, fieldId(error?.field || 'name'));
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setError(null); guard.setDiscard(false);
    try {
      const data = validateTask(form);
      setBusy(true);
      await window.api.taskSave({...data, id: task?.id});
      await refresh(); notify('任务已保存'); close();
    } catch (failure) {
      setError({message: messageOf(failure), field: failure.field});
    } finally { setBusy(false); }
  };
  const stepField = (index, key, label, control, hint) => <Field label={label} hint={hint} id={fieldId('steps.' + index + '.' + key)} error={fieldError('steps.' + index + '.' + key)}>{control}</Field>;
  return <Modal open dismissible={!busy} wide className="task-editor-modal" onKeyDown={event=>submitShortcut(event,busy,formRef.current)} onOpenChange={open => !open && guard.requestClose()}
    title={task ? '编辑任务' : '新建任务'} description="把重复的网页操作整理为步骤，下次直接运行。"
    footer={<EditorFooter guard={guard} busy={busy} error={error} errorId="task-editor-error"
      note={form.steps.length + '/50 步 · 保存在本机'} saveLabel="保存任务" formId="task-form" />}>
    <form id="task-form" ref={formRef} noValidate onSubmit={save}>
      <fieldset disabled={busy} className="editor-fieldset">
        <div className="form-grid">
          <Field label="任务名称" id="task-name" error={fieldError('name')}><input autoFocus aria-label="任务名称" value={form.name} onChange={e => update({name: e.target.value})} maxLength={120} placeholder="例如：检查工作页面" /></Field>
          <Field label="用途备注" id="task-description" error={fieldError('description')}><input aria-label="任务用途" value={form.description} maxLength={1000} onChange={e => update({description: e.target.value})} placeholder="帮助下次找到合适的任务" /></Field>
        </div>
        <div className="task-editor-hint"><span>按顺序执行</span><small>每一步完成后继续，失败时停止并保留进度。</small></div>
        <div className="task-steps">{form.steps.map((step, index) => <div className="task-step" key={index}>
          <div className="task-step-title"><span className="task-step-index">{index + 1}</span>
            <select id={fieldId('steps.' + index + '.type')} aria-label={'第 ' + (index + 1) + ' 步操作'} aria-invalid={!!fieldError('steps.' + index + '.type')} value={step.type} onChange={e => set(index, freshStep(e.target.value))}>{Object.entries(TASK_NAMES).map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select>
            <span className="toolbar-spacer" />
            <IconButton icon={ArrowUp} label={'上移第 ' + (index + 1) + ' 步'} disabled={!index} onClick={() => move(index, -1)} />
            <IconButton icon={ArrowDown} label={'下移第 ' + (index + 1) + ' 步'} disabled={index === form.steps.length - 1} onClick={() => move(index, 1)} />
            <IconButton icon={Trash2} label={'移除第 ' + (index + 1) + ' 步'} disabled={form.steps.length === 1} onClick={() => update({steps: form.steps.filter((_, i) => i !== index)})} />
          </div>
          <div className="task-step-fields">
            {step.type === 'navigate' && stepField(index, 'url', '页面地址', <input aria-label={'第 ' + (index + 1) + ' 步地址'} value={step.url ?? ''} placeholder="https://example.com" onChange={e => set(index, {url: e.target.value})} />)}
            {['waitFor', 'click', 'fill', 'scroll'].includes(step.type) && stepField(index, 'selector', 'CSS 元素定位', <input aria-label={'第 ' + (index + 1) + ' 步元素'} value={step.selector ?? ''} placeholder="#search" onChange={e => set(index, {selector: e.target.value})} />, step.type === 'scroll' ? '留空时滚动页面。' : '例如 #search 或 input[name="email"]。')}
            {step.type === 'fill' && stepField(index, 'text', '填入的文本', <textarea aria-label={'第 ' + (index + 1) + ' 步文本'} value={step.text ?? ''} onChange={e => set(index, {text: e.target.value})} />, '内容保存在本机任务中，执行记录不会包含文本。')}
            {step.type === 'press' && stepField(index, 'key', '按键', <select aria-label={'第 ' + (index + 1) + ' 步按键'} value={step.key || 'Enter'} onChange={e => set(index, {key: e.target.value})}>{Object.keys(KEYS).map(key => <option key={key}>{key}</option>)}</select>)}
            {step.type === 'wait' && stepField(index, 'duration', '等待时间（毫秒）', <input type="number" min={100} max={30000} value={step.duration ?? 1000} onChange={e => set(index, {duration: e.target.value})} />)}
            {step.type === 'scroll' && <div className="form-grid">{['x', 'y'].map(key => <React.Fragment key={key}>{stepField(index, key, key === 'x' ? '水平距离（像素）' : '垂直距离（像素）', <input type="number" min={-10000} max={10000} value={step[key] ?? 0} onChange={e => set(index, {[key]: e.target.value})} />)}</React.Fragment>)}</div>}
            {step.type === 'screenshot' && <p className="muted">截图保存在本机，完成后可在执行结果中打开文件位置。</p>}
            {!['wait', 'press', 'screenshot'].includes(step.type) && stepField(index, 'timeout', '最长等待（毫秒）', <input type="number" min={1000} max={60000} value={step.timeout ?? 15000} onChange={e => set(index, {timeout: e.target.value})} />)}
          </div>
        </div>)}</div>
        <Button icon={Plus} disabled={form.steps.length >= 50} onClick={() => update({steps: [...form.steps, freshStep('click')]})}>添加步骤</Button>
      </fieldset>
    </form>
  </Modal>;
}
