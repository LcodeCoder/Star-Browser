'use strict';
const {randomUUID} = require('node:crypto');

// One bounded queue per requesting window. Cancellation stops queued work;
// already issued connections finish their current phase before being released.
class ProxyBatchRunner {
  constructor(check, {concurrency = 8} = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 25) throw new Error('并发数量无效');
    this.check = check;
    this.concurrency = concurrency;
    this.jobs = new Map();
  }
  async run(owner, input, requestId, onProgress = () => {}) {
    if (this.jobs.has(owner)) throw new Error('这个窗口已有检测，请停止或等待完成');
    if (!Array.isArray(input) || !input.length || input.length > 500) throw new Error('请提供 1–500 条代理');
    if (input.some(value => typeof value !== 'string' || value.length > 2048)) throw new Error('单条代理内容过长或格式无效');
    if (input.reduce((size, value) => size + Buffer.byteLength(value), 0) > 256 * 1024) throw new Error('代理列表过大，请分批检测');
    const list = input.map(value => value.trim());
    if (list.some(value => !value)) throw new Error('代理列表不能包含空行');
    const id = requestId || randomUUID();
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('检测标识无效');
    const job = {id, cancelled: false, next: 0, completed: 0, results: new Array(list.length)};
    this.jobs.set(owner, job);
    const emit = update => { try { onProgress({jobId:id, total:list.length, completed:job.completed, cancelled:job.cancelled, ...update}); } catch {} };
    emit({});
    const worker = async () => {
      while (!job.cancelled && job.next < list.length) {
        const index = job.next++, raw = list[index];
        let result;
        try { result = await this.check(raw, {isCancelled: () => job.cancelled}); }
        catch (error) { result = {raw, ok:false, error:error.message || '检测异常'}; }
        if (!result || result.cancelled) continue;
        job.results[index] = {...result, index};
        job.completed++;
        emit({result:job.results[index]});
      }
    };
    try {
      await Promise.all(Array.from({length:Math.min(this.concurrency,list.length)}, worker));
      const result = {ok:true, jobId:id, total:list.length, completed:job.completed, cancelled:job.cancelled, results:job.results.filter(Boolean)};
      emit({done:true});
      return result;
    } finally { if (this.jobs.get(owner) === job) this.jobs.delete(owner); }
  }
  cancel(owner, requestId) {
    const job = this.jobs.get(owner);
    if (!job || job.id !== requestId) return {ok:false, error:'这次检测已结束'};
    job.cancelled = true;
    return {ok:true};
  }
  close(owner) { const job = this.jobs.get(owner); if (job) job.cancelled = true; }
}
module.exports = {ProxyBatchRunner};
