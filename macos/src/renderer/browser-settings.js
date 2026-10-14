/* Browser settings share main-process validation and keep the draft until saved. */
var StarSettings = (() => {
  let saving = false, manualLanguage = false, requestVersion = 0, baseline = '', previousFocus = null, pendingFocus = null, returnFocus = null;
  const triggers = ['gear','profileIdentityBtn'].map(id => $(id)).filter(Boolean);
  const disabled = new Map();
  const draftIds = ['s-start','s-country','s-language','s-timezone','s-proxyOn','s-type','s-host','s-user','s-pass','s-webrtc','s-regen','s-note','s-tags','s-paste'];
  const fieldIds = {startUrl:'s-start',country:'s-country',language:'s-language',timezone:'s-timezone',webrtc:'s-webrtc','proxy.host':'s-host','proxy.port':'s-host','proxy.type':'s-type','proxy.user':'s-user','proxy.pass':'s-pass'};
  const fields = () => Array.from(panel.querySelectorAll('input,select,textarea,button'));
  const snapshot = () => JSON.stringify([manualLanguage,...draftIds.map(id => $(id).type === 'checkbox' ? $(id).checked : $(id).value)]);
  const dirty = () => snapshot() !== baseline;
  function focus(target) {
    if (!target || panel.hidden) return;
    const details = target.closest('details'); if (details) details.open = true;
    target.focus(); target.scrollIntoView({block:'nearest'});
  }
  function showDiscard(show) {
    $('settingsDiscard').hidden = !show; $('settingsSaveActions').hidden = show;
  }
  function error(message, field) {
    pendingFocus = null;
    for (const el of fields()) {
      el.removeAttribute('aria-invalid');
      const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'settingsError');
      if (ids.length) el.setAttribute('aria-describedby',ids.join(' ')); else el.removeAttribute('aria-describedby');
    }
    const box = $('settingsError'); box.textContent = String(message || ''); box.hidden = !message;
    if (!message) return;
    showDiscard(false);
    const target = $(fieldIds[field]) || box;
    if (target !== box) {
      target.setAttribute('aria-invalid','true');
      target.setAttribute('aria-describedby',[(target.getAttribute('aria-describedby') || ''),'settingsError'].filter(Boolean).join(' '));
    }
    if (saving) pendingFocus = target; else focus(target);
  }
  function updateLanguage() {
    $('settingsLanguageMode').textContent = manualLanguage ? '已固定语言' : '自动：跟随代理出口；直连使用本机语言';
  }
  function updateProxy() {
    const off = !$('s-proxyOn').checked;
    $('settingsProxyFields').querySelectorAll('input,select,button').forEach(el => { el.disabled = off || saving; });
    $('settingsProxyFields').classList.toggle('is-disabled',off);
  }
  function addOption(id,value) {
    const select = $(id);
    if (value && !Array.from(select.options).some(option => option.value === value)) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
    }
  }
  function open(trigger = $('gear')) {
    if (!profile || saving) return;
    returnFocus = triggers.includes(trigger) ? trigger : $('gear');
    fillCountries(); fillLanguages(); fillTimezones();
    addOption('s-language',profile.langManual ? profile.language : profile.fingerprint?.language || profile.language);
    addOption('s-timezone',profile.timezone); syncPanelFromProfile(); $('s-paste').value = '';
    manualLanguage = !!profile.langManual; updateLanguage(); updateProxy(); error(''); showDiscard(false);
    baseline = snapshot(); previousFocus = null; requestVersion++;
    $('s-check-result').textContent = ''; $('s-check-result').hidden = true;
    panel.hidden = false; $('settingsOverlay').hidden = false;
    triggers.forEach(button => button.setAttribute('aria-expanded','true')); $('s-start').focus();
  }
  function close(force = false) {
    if (panel.hidden) return true;
    if (saving && !force) return false;
    if (!force && dirty()) {
      if ($('settingsDiscard').hidden) previousFocus = panel.contains(document.activeElement) ? document.activeElement : $('s-start');
      showDiscard(true); $('s-continue').focus(); return false;
    }
    requestVersion++; pendingFocus = null; panel.hidden = true; $('settingsOverlay').hidden = true;
    showDiscard(false); triggers.forEach(button => button.setAttribute('aria-expanded','false'));
    (returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : $('gear')).focus(); return true;
  }
  function proxyDraft() {
    const hp = parseProxy($('s-host').value);
    return StarSettingsValidation.validateProxy({type:$('s-type').value,host:hp.host,port:hp.port,user:$('s-user').value,pass:$('s-pass').value});
  }
  function collect() {
    const value = StarSettingsValidation.validateProfile({
      country:$('s-country').value,startUrl:$('s-start').value,proxy:$('s-proxyOn').checked ? proxyDraft() : null,
      webrtc:$('s-webrtc').value,note:$('s-note').value,tags:$('s-tags').value,
      language:$('s-language').value,langManual:manualLanguage,timezone:$('s-timezone').value,timezoneManual:!!$('s-timezone').value,
    });
    return {...value,regen:$('s-regen').checked};
  }
  function beginSave() {
    if (saving || !$('settingsDiscard').hidden) return null;
    error(''); let value;
    try { value = collect(); } catch (err) { error(err.message,err.field); return null; }
    saving = true; requestVersion++;
    fields().forEach(el => { disabled.set(el,el.disabled); el.disabled = true; });
    panel.setAttribute('aria-busy','true'); $('s-save').textContent = '正在应用…'; return value;
  }
  function endSave() {
    saving = false; disabled.forEach((value,el) => { el.disabled = value; }); disabled.clear();
    panel.removeAttribute('aria-busy'); $('s-save').textContent = '保存并应用'; updateProxy();
    if (pendingFocus) { focus(pendingFocus); pendingFocus = null; }
  }
  function invalidate() {
    requestVersion++; $('s-check-result').hidden = true; showDiscard(false);
    if (!saving) updateProxy();
  }
  function resetLanguage() {
    manualLanguage = false; langEdited = false;
    addOption('s-language',profile.fingerprint?.language || profile.language);
    $('s-language').value = profile.fingerprint?.language || profile.language || 'en-US'; updateLanguage(); invalidate();
  }
  function resetTimezone() { $('s-timezone').value = ''; tzEdited = false; invalidate(); }
  function proxyPasted() { invalidate(); error(''); }
  async function checkProxy() {
    let proxy;
    try { proxy = proxyDraft(); if (!proxy) throw Object.assign(new Error('请填写有效的代理地址和端口'),{field:'proxy.host'}); }
    catch (err) { error(err.message,err.field); return; }
    const box = $('s-check-result'), version = ++requestVersion;
    $('s-check').disabled = true; box.hidden = false; box.textContent = '正在检测当前输入…'; error('');
    try {
      const result = await window.api.proxyCheck(proxy);
      if (version !== requestVersion || panel.hidden) return;
      box.textContent = result?.ok ? ['连接成功',result.ip && '出口 '+result.ip,result.country,result.timezone,'配置将在保存后应用'].filter(Boolean).join(' · ') : '连接失败：'+(result?.error || '未取得有效出口信息');
    } catch (err) { if (version === requestVersion && !panel.hidden) box.textContent = '检测失败：'+(err.message || String(err)); }
    finally { if (!saving) updateProxy(); }
  }
  $('s-language').addEventListener('change',() => { manualLanguage = true; updateLanguage(); });
  $('s-proxyOn').addEventListener('change',updateProxy);
  panel.addEventListener('input',invalidate);
  $('settingsOverlay').addEventListener('click',() => close());
  $('s-abandon').addEventListener('click',() => close(true));
  $('s-continue').addEventListener('click',() => { showDiscard(false); focus(previousFocus?.isConnected ? previousFocus : $('s-start')); });
  document.addEventListener('keydown',event => {
    if (panel.hidden || event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); if (!saving && $('settingsDiscard').hidden) $('s-save').click(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.key === 'Tab') {
      const visible = [...panel.querySelectorAll('input,select,textarea,button,summary')].filter(el => !el.disabled && el.getClientRects().length);
      const first = visible[0], last = visible[visible.length-1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  },true);
  triggers.forEach(button => { button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-controls','settings'); button.setAttribute('aria-expanded','false'); });
  return {open,close,beginSave,endSave,error,resetLanguage,resetTimezone,proxyPasted,dirty,languageManual:() => manualLanguage,checkProxy};
})();
