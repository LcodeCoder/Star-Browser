'use strict';
const StarNetwork = (() => {
  const dialog = $('batchPanel'), overlay = $('batchOverlay');
  let results = [], jobId = null, busy = false, stopping = false, total = 0, completed = 0, cancelled = false;
  let returnFocus = null;
  const background = new Map();
  const lines = () => $('batch-input').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const controls = () => Array.from(dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]')).filter(el => !el.disabled && el.getClientRects().length);
  const address = row => row.host ? `${row.host}:${row.port}` : `条目 ${row.index + 1}`;
  function error(message = '') { $('batch-error').textContent = message; $('batch-error').hidden = !message; }
  function inputsChanged() {
    const count = lines().length;
    $('batch-input-count').textContent = count ? `${count} 条代理` : '每行一条';
    $('batch-run').disabled = busy || !count || count > 500;
    $('batch-clear').disabled = busy || (!count && !results.length);
    $('batch-input').disabled = busy;
    $('batch-cancel').hidden = !busy;
    $('batch-cancel').disabled = stopping;
    if (count > 500) error('最多检测 500 条，请分批粘贴。');
  }
  function open(trigger) {
    if (!dialog.hidden) { close(); return; }
    returnFocus = trigger || document.activeElement;
    if (!panel.hidden) StarSettings.close();
    for (const id of ['launcher','bmPanel','historyPanel','tabSearchPanel','browserMenu']) $(id).hidden = true;
    dialog.hidden = false; overlay.hidden = false;
    for (const el of document.querySelectorAll('.tabs-bar,.toolbar,.bookmark-bar,.webviews,.ntp')) { background.set(el,el.inert); el.inert = true; }
    $('batchBtn').setAttribute('aria-expanded','true');
    inputsChanged(); render(); $('batch-input').focus();
  }
  function close(restore = true) {
    if (dialog.hidden) return;
    dialog.hidden = true; overlay.hidden = true;
    for (const [el,inert] of background) el.inert = inert;
    background.clear(); $('batchBtn').setAttribute('aria-expanded','false');
    if (restore) {
      const target = [returnFocus, $('batchBtn'), $('browserMenuBtn')].find(el => el?.isConnected && !el.disabled && el.getClientRects().length && !el.closest('[hidden],[inert]'));
      target?.focus();
    }
  }
  function status() {
    const good = results.filter(row => row.ok).length;
    $('batch-status').textContent = busy
      ? (stopping ? `正在停止，已完成 ${completed} / ${total}；等待已发出的连接检查结束…` : `已检测 ${completed} / ${total}，连接通过 ${good} 条`)
      : total ? `${cancelled ? '已停止 · ' : ''}已检测 ${completed} / ${total}，通过 ${good} 条，失败 ${completed-good} 条` : '还没有检测结果';
    $('batch-progress').hidden = !total;
    $('batch-progress').max = total || 1; $('batch-progress').value = completed;
    dialog.setAttribute('aria-busy',String(busy));
    $('batch-run').textContent = busy ? '正在检测…' : total ? '重新检测' : '开始检测';
  }
  function render() {
    const search = $('batch-search').value.trim().toLowerCase(), filter = $('batch-filter').value;
    const rows = results.filter(row => (filter === 'all' || (filter === 'ok') === !!row.ok) && [address(row),row.exitIp,row.country,row.region,row.city,row.timezone,row.error,row.isp,row.asn].join(' ').toLowerCase().includes(search));
    const body = $('batch-body'), fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const values = [row.ok ? '连接通过' : row.error || '连接失败', row.latency ? `${row.latency} ms` : '—', row.exitIp || (row.ok ? '尚未取得' : '—'), [row.country,row.region,row.city].filter(Boolean).join(' / ') || '—', row.timezone || '—', row.ipType || '未取得', row.risk || '未取得', row.isp || row.asn || '—', address(row)];
      values.forEach((text,index) => { const td = document.createElement('td'); td.textContent = text; td.title = text; if (!index) td.className = row.ok ? 'st-ok' : 'st-fail'; if (index === 8) td.className = 'proxy-address'; tr.append(td); });
      fragment.append(tr);
    }
    body.replaceChildren(fragment);
    const empty = !rows.length; $('batch-empty').hidden = !empty;
    const title = $('batch-empty-title'), description = $('batch-empty-description');
    if (search || filter !== 'all') { title.textContent = '没有符合条件的结果'; description.textContent = '换个关键词，或选择全部结果。'; }
    else if (busy) { title.textContent = '正在检查连接'; description.textContent = '结果会逐条显示；停止检测将保留已完成的结果。'; }
    else if (cancelled) { title.textContent = '本次检测已停止'; description.textContent = '可以调整列表后重新检测。'; }
    else { title.textContent = '检查一组代理，选出可用连接'; description.textContent = '粘贴代理列表后开始检测，连接失败的原因会保留在这里。'; }
    $('batch-export').disabled = !results.length;
    status(); inputsChanged();
  }
  async function run() {
    if (busy) return;
    const input = lines(); if (!input.length || input.length > 500) return;
    busy = true; stopping = false; cancelled = false; total = input.length; completed = 0; results = []; jobId = crypto.randomUUID();
    error(); render(); $('batch-cancel').focus();
    try {
      const response = await window.api.proxyBatchCheck(input,jobId);
      if (!response?.ok) throw new Error(response?.error || '检测未完成');
      results = response.results || []; completed = response.completed; cancelled = response.cancelled;
    } catch (err) { error(err.message || '检测未完成，请重试。'); }
    finally { busy = false; stopping = false; jobId = null; render(); if (!dialog.hidden && !dialog.contains(document.activeElement)) $('batch-run').focus(); }
  }
  async function cancel() {
    if (!busy || stopping) return;
    stopping = true; status(); inputsChanged();
    try { const response = await window.api.proxyBatchCancel(jobId); if (!response?.ok && busy) throw new Error(response?.error || '停止失败，请重试'); }
    catch (err) { stopping = false; error(err.message); status(); inputsChanged(); }
  }
  window.api.onProxyBatchProgress(update => {
    if (!busy || update.jobId !== jobId) return;
    completed = update.completed;
    if (update.result) results = [...results.filter(row => row.index !== update.result.index), update.result].sort((a,b) => a.index-b.index);
    render();
  });
  // Retain order by input index even when concurrent requests finish out of order.
  function exportCSV() {
    if (!results.length) return;
    const head = ['连接状态','延迟(ms)','出口IP','国家','城市','时区','类型','来源标记','运营商/ASN','代理地址'];
    const rows = results.map(row => [row.ok ? '连接通过' : row.error || '连接失败',row.latency || '',row.exitIp || '',row.country || '',row.city || '',row.timezone || '',row.ipType || '',row.risk || '',row.isp || row.asn || '',row.host ? address(row) : '']);
    const cell = value => { const text = String(value ?? ''), safe = /^[=+@\-\t\r]/.test(text) ? "'"+text : text; return '"'+safe.replace(/"/g,'""')+'"'; };
    const blob = new Blob(['\ufeff'+[head,...rows].map(row => row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'proxy-check-'+new Date().toISOString().slice(0,10)+'.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),2000); toast('检测结果已导出');
  }
  $('batchBtn').setAttribute('aria-haspopup','dialog'); $('batchBtn').setAttribute('aria-expanded','false');
  $('batchBtn').addEventListener('click',event => open(event.currentTarget));
  $('openProxyChecks').addEventListener('click',event => open(event.currentTarget));
  $('batch-close').addEventListener('click',() => close()); overlay.addEventListener('click',() => close());
  $('batch-input').addEventListener('input',() => { if (!busy) error(); inputsChanged(); });
  $('batch-search').addEventListener('input',render); $('batch-filter').addEventListener('change',render);
  $('batch-run').addEventListener('click',run); $('batch-cancel').addEventListener('click',cancel);
  $('batch-clear').addEventListener('click',() => { if (busy) return; $('batch-input').value = ''; $('batch-search').value = ''; $('batch-filter').value = 'all'; results = []; total = 0; completed = 0; cancelled = false; error(); render(); $('batch-input').focus(); });
  $('batch-export').addEventListener('click',exportCSV);
  document.addEventListener('keydown',event => {
    if (dialog.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run(); }
    if (event.key === 'Tab') {
      const visible = controls();
      event.preventDefault();
      if (!visible.length) return;
      // macOS can skip buttons in the native Tab order. A modal must keep every
      // enabled action reachable, including its keyboard-scrollable result list.
      const current = visible.indexOf(document.activeElement);
      const next = current < 0 ? (event.shiftKey ? visible.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + visible.length) % visible.length;
      visible[next].focus();
    }
  },true);
  return {open,close};
})();
