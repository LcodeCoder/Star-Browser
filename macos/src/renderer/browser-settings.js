/* Browser settings: a draft until the explicit save action. */
var StarSettings = (() => {
  let saving = false, manualLanguage = false, requestVersion = 0;
  const disabled = new Map();
  const fields = () => Array.from(panel.querySelectorAll('input,select,textarea,button'));
  function error(message) {
    const box = $('settingsError');
    box.textContent = String(message || '');
    box.hidden = !message;
    if (message) box.scrollIntoView({block: 'nearest'});
  }
  function updateLanguage() {
    $('settingsLanguageMode').textContent = manualLanguage ? '已固定语言' : '自动：跟随代理出口；直连使用本机语言';
  }
  function updateProxy() {
    const off = !$('s-proxyOn').checked;
    $('settingsProxyFields').querySelectorAll('input,select,button').forEach(el => { el.disabled = off || saving; });
    $('settingsProxyFields').classList.toggle('is-disabled', off);
  }
  function addOption(id, value) {
    const select = $(id);
    if (value && !Array.from(select.options).some(option => option.value === value)) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
    }
  }
  function open() {
    if (!profile || saving) return;
    fillCountries(); fillLanguages(); fillTimezones();
    addOption('s-language', profile.langManual ? profile.language : profile.fingerprint?.language || profile.language);
    addOption('s-timezone', profile.timezone);
    syncPanelFromProfile();
    manualLanguage = !!profile.langManual; updateLanguage(); updateProxy(); error('');
    requestVersion++; $('s-check-result').textContent = ''; $('s-check-result').hidden = true;
    panel.hidden = false; $('settingsOverlay').hidden = false;
    $('gear').setAttribute('aria-expanded', 'true'); $('s-start').focus();
  }
  function close(force = false) {
    if (saving && !force) return;
    requestVersion++; panel.hidden = true; $('settingsOverlay').hidden = true;
    $('gear').setAttribute('aria-expanded', 'false'); $('gear').focus();
  }
  function beginSave() {
    if (saving) return false;
    error('');
    if ($('s-proxyOn').checked) {
      const proxy = parseProxy($('s-host').value);
      if (!proxy.host || !Number.isInteger(Number(proxy.port)) || Number(proxy.port) < 1 || Number(proxy.port) > 65535) {
        error('请填写有效的代理地址和端口'); $('s-host').focus(); return false;
      }
    }
    saving = true; requestVersion++;
    fields().forEach(el => { disabled.set(el, el.disabled); el.disabled = true; });
    panel.setAttribute('aria-busy', 'true'); $('s-save').textContent = '正在应用…';
    return true;
  }
  function endSave() {
    saving = false;
    disabled.forEach((value, el) => { el.disabled = value; }); disabled.clear();
    panel.removeAttribute('aria-busy'); $('s-save').textContent = '保存并应用'; updateProxy();
  }
  function resetLanguage() {
    manualLanguage = false; langEdited = false;
    addOption('s-language', profile.fingerprint?.language || profile.language);
    $('s-language').value = profile.fingerprint?.language || profile.language || 'en-US'; updateLanguage();
  }
  function resetTimezone() { $('s-timezone').value = ''; tzEdited = false; }
  async function checkProxy() {
    const box = $('s-check-result'), hp = parseProxy($('s-host').value);
    if (!hp.host || !Number.isInteger(Number(hp.port)) || Number(hp.port) < 1 || Number(hp.port) > 65535) { error('请填写有效的代理地址和端口'); $('s-host').focus(); return; }
    const version = ++requestVersion;
    const proxy = {type: $('s-type').value, host: hp.host, port: hp.port, user: $('s-user').value.trim(), pass: $('s-pass').value};
    $('s-check').disabled = true; box.hidden = false; box.textContent = '正在检测当前输入…'; error('');
    try {
      const result = await window.api.proxyCheck(proxy);
      if (version !== requestVersion || panel.hidden) return;
      box.textContent = result?.ok ? ['连接成功', result.ip && '出口 ' + result.ip, result.country, result.timezone, '配置将在保存后应用'].filter(Boolean).join(' · ') : '连接失败：' + (result?.error || '未取得有效出口信息');
    } catch (err) {
      if (version === requestVersion && !panel.hidden) box.textContent = '检测失败：' + (err.message || String(err));
    } finally { if (!saving) updateProxy(); }
  }
  $('s-language').addEventListener('change', () => { manualLanguage = true; updateLanguage(); });
  $('s-proxyOn').addEventListener('change', updateProxy);
  panel.addEventListener('input', () => { requestVersion++; $('s-check-result').hidden = true; if (!saving) updateProxy(); });
  $('settingsOverlay').addEventListener('click', () => close());
  document.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.key === 'Tab') {
      const visible = fields().filter(el => !el.disabled && el.getClientRects().length);
      const first = visible[0], last = visible[visible.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }, true);
  $('gear').setAttribute('aria-haspopup', 'dialog'); $('gear').setAttribute('aria-expanded', 'false');
  return {open, close, beginSave, endSave, error, resetLanguage, resetTimezone, languageManual: () => manualLanguage, checkProxy};
})();
