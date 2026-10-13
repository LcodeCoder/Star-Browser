'use strict';
const LAUNCH_STAGES = Object.freeze({
  checking: '检查环境', proxy: '检查代理连接', locale: '对齐语言与时区',
  extensions: '准备扩展', kernel: '检查浏览器内核', protocol: '应用环境配置',
  opening: '打开浏览器窗口', ready: '窗口已打开',
});
class LaunchState {
  constructor({clock = Date.now, changed = () => {}, limit = 100, ttl = 30 * 60 * 1000} = {}) {
    Object.assign(this, {clock, changed, limit, ttl});
    this.records = new Map();
    this.sequence = 0;
  }
  key(method, id) { return method + ':' + id; }
  begin(method, id) {
    if (!['browse', 'launch'].includes(method)) throw new Error('Unsupported launch method');
    const now = this.clock();
    const record = {id, method, engine: method === 'browse' ? 'electron' : 'chrome', attempt: ++this.sequence,
      status: 'starting', stage: 'checking', startedAt: now, updatedAt: now};
    this.records.set(this.key(method, id), record);
    this.trim(); this.changed();
    return record.attempt;
  }
  stage(method, id, stage) {
    if (!Object.hasOwn(LAUNCH_STAGES, stage) || stage === 'ready') throw new Error('Unsupported launch stage');
    const record = this.records.get(this.key(method, id));
    if (!record || record.status !== 'starting' || record.stage === stage) return;
    Object.assign(record, {stage, updatedAt: this.clock()}); this.changed();
  }
  finish(method, id, error) {
    const record = this.records.get(this.key(method, id));
    if (!record || record.status !== 'starting') return;
    const now = this.clock();
    Object.assign(record, {status: error ? 'failed' : 'ready', stage: error ? record.stage : 'ready',
      finishedAt: now, updatedAt: now, durationMs: Math.max(0, now - record.startedAt)});
    if (error) record.error = String(error?.message || '浏览器未能打开，请检查环境配置后重试').slice(0, 600);
    this.trim(); this.changed();
  }
  trim() {
    const now = this.clock();
    for (const [key, record] of this.records) if (record.status !== 'starting' && now - record.updatedAt >= this.ttl) this.records.delete(key);
    const finished = [...this.records.entries()].filter(([, value]) => value.status !== 'starting').sort((a,b) => a[1].updatedAt - b[1].updatedAt || a[1].attempt - b[1].attempt);
    for (const [key] of finished) { if (this.records.size <= this.limit) break; this.records.delete(key); }
  }
  snapshot() {
    this.trim();
    return [...this.records.values()].sort((a,b) => b.attempt - a.attempt).map(record => ({...record}));
  }
}
module.exports = {LaunchState, LAUNCH_STAGES};
