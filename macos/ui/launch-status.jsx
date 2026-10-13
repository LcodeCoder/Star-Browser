import React, {useEffect, useState} from "react";
import {LoaderCircle, AlertCircle} from "lucide-react";
import {Badge, Button} from "./components";
import {useWorkspace} from "./context";
import {LAUNCH_STAGES} from "../src/main/launch-state";

export function latestStartup(records = [], id) {
  const candidates = records.filter(record => record.id === id);
  return candidates.find(record => record.status === 'starting') || candidates[0];
}
export function LaunchBadge({record, busy, running}) {
  if (record?.status === 'starting' || busy) return <Badge status="busy">{LAUNCH_STAGES[record?.stage] || '启动中'}</Badge>;
  if (running) return <Badge status="success">运行中</Badge>;
  if (record?.status === 'failed') return <span title={record.error}><Badge status="error">启动失败</Badge></span>;
  return null;
}
export function LaunchFeedback({record, profile, onEdit}) {
  const {openProfile} = useWorkspace();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (record?.status !== 'starting') return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [record?.attempt, record?.status]);
  if (!record || !['starting','failed'].includes(record.status)) return null;
  const pending = record.status === 'starting';
  return <section className={'launch-feedback ' + (pending ? 'pending' : 'failed')} aria-label="环境启动状态">
    <div className="launch-feedback-title">{pending ? <LoaderCircle size={16} className="spin" /> : <AlertCircle size={16} />}
      <strong role="status">{pending ? LAUNCH_STAGES[record.stage] : (record.engine === 'chrome' ? '本机浏览器未能打开' : '浏览器未能打开')}</strong>
      {pending && <small aria-hidden="true">{Math.max(0, Math.floor((now - record.startedAt) / 1000))} 秒</small>}
    </div>
    {pending ? <p>完成准备后自动打开窗口。</p> : <>
      <p>{record.error}</p>
      <div className="launch-feedback-actions"><Button onClick={() => onEdit(profile)}>{record.stage === 'proxy' ? '检查代理配置' : '检查环境配置'}</Button><Button variant="primary" onClick={() => openProfile(profile.id, record.method)}>重新启动</Button></div>
    </>}
  </section>;
}
