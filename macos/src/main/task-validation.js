'use strict';
const TYPES = new Set(['navigate', 'waitFor', 'click', 'fill', 'press', 'scroll', 'wait', 'screenshot']);
const KEYS = Object.freeze({Enter:13, Tab:9, Escape:27, Backspace:8, Delete:46, ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, Home:36, End:35});
class TaskValidationError extends Error {
  constructor(message, field) { super(message); this.name = 'TaskValidationError'; this.field = field; }
}
function validateTask(input) {
  const invalid = (message, field) => { throw new TaskValidationError(message, field); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 50) invalid('每个任务需要 1–50 个步骤', 'steps');
  const text = (value, max, field, label, trim = true) => {
    const result = trim ? String(value ?? '').trim() : String(value ?? '');
    if (result.length > max) invalid(label + '最多 ' + max + ' 个字符', field);
    return result;
  };
  const name = text(input.name, 120, 'name', '任务名称');
  if (!name) invalid('请输入任务名称', 'name');
  const steps = input.steps.map((step, index) => {
    const prefix = 'steps.' + index + '.';
    const fail = (message, key = 'type') => invalid('第 ' + (index + 1) + ' 步：' + message, prefix + key);
    if (!step || typeof step !== 'object' || !TYPES.has(step.type)) fail('请选择支持的操作');
    const out = {type: step.type};
    if (step.type === 'navigate') {
      out.url = text(step.url, 4096, prefix + 'url', '页面地址');
      let url;
      try { url = new URL(out.url); } catch { fail('请输入完整的 HTTP 或 HTTPS 地址', 'url'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('地址需使用不含账号密码的 HTTP 或 HTTPS', 'url');
    }
    if (['waitFor', 'click', 'fill', 'scroll'].includes(step.type)) {
      out.selector = text(step.selector, 1000, prefix + 'selector', 'CSS 元素定位');
      if (!out.selector && step.type !== 'scroll') fail('请输入 CSS 元素定位', 'selector');
    }
    if (step.type === 'fill') out.text = text(step.text, 100000, prefix + 'text', '填入的文本', false);
    if (step.type === 'press') {
      out.key = step.key;
      if (!Object.hasOwn(KEYS, out.key)) fail('请选择支持的按键', 'key');
    }
    if (step.type === 'scroll') {
      for (const key of ['x', 'y']) {
        out[key] = step[key] === '' || step[key] === undefined || step[key] === null ? 0 : Number(step[key]);
        if (!Number.isFinite(out[key]) || Math.abs(out[key]) > 10000) fail('滚动距离最多 10000 像素', key);
      }
    }
    if (step.type === 'wait') {
      out.duration = Number(step.duration);
      if (!Number.isInteger(out.duration) || out.duration < 100 || out.duration > 30000) fail('等待时间为 100–30000 毫秒', 'duration');
    }
    if (!['wait', 'press', 'screenshot'].includes(step.type)) {
      out.timeout = step.timeout === '' || step.timeout === undefined || step.timeout === null ? 15000 : Number(step.timeout);
      if (!Number.isInteger(out.timeout) || out.timeout < 1000 || out.timeout > 60000) fail('超时为 1000–60000 毫秒', 'timeout');
    }
    return out;
  });
  return {name, description: text(input.description, 1000, 'description', '用途备注'), steps};
}
module.exports = {validateTask, TaskValidationError, KEYS};
