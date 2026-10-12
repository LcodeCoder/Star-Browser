"use strict";
// Tab actions operate on real guest contents. Sleeping tabs keep URLs and session state.
const StarTabs = (() => {
  let menu, menuTabId = null, menuReturn = null;
  const get = id => tabs.find(tab => tab.id === id);
  function closeMenu(restore = false) {
    if (!menu) return;
    menu.hidden = true;
    if (restore && menuReturn?.isConnected) menuReturn.focus();
    menuTabId = null;
  }
  function pin(id) {
    const tab = get(id); if (!tab) return;
    tab.pinned = !tab.pinned;
    const index = tabs.indexOf(tab); tabs.splice(index, 1);
    const boundary = tabs.findIndex(item => !item.pinned);
    tabs.splice(boundary < 0 ? tabs.length : boundary, 0, tab);
    renderTabs(); StarBrowser.persist(true);
  }
  function mute(id) {
    const tab = get(id); if (!tab) return;
    tab.muted = !tab.muted;
    try { if (tab.web?.__starReady) tab.web.setAudioMuted(tab.muted); } catch {}
    renderTabs(); StarBrowser.persist(true);
  }
  function move(id, delta) {
    const tab = get(id), index = tabs.indexOf(tab), next = tabs[index + delta];
    if (!tab || !next || !!next.pinned !== !!tab.pinned) return;
    tabs.splice(index, 1); tabs.splice(index + delta, 0, tab);
    renderTabs(); StarBrowser.persist(true);
  }
  function ready(w, id) {
    const tab = get(id); if (!tab || tab.web !== w) return;
    try { w.setAudioMuted(!!tab.muted); } catch {}
  }
  function wake(tab) {
    if (!tab.sleeping) return;
    tab.sleeping = false;
    tab.web = makeWebview(tab.id);
    tab.web.__starPendingURL = tab.url;
    wrap.appendChild(tab.web);
  }
  async function sleep(id) {
    const tab = get(id);
    if (!tab || tab.sleeping || tab.suspending) return;
    if (activeId === id) { toast("请先切换到其他标签，再休眠此页面"); return; }
    if (tab.ntp || !/^https?:\/\//i.test(tab.url)) { toast("只有网站标签可以休眠"); return; }
    tab.suspending = true;
    try {
      const w = tab.web;
      let guestId, url; try { guestId = w.getWebContentsId(); url = w.getURL(); } catch { throw new Error("页面尚未就绪，请稍后重试"); }
      const result = await window.api.suspendTab(guestId);
      if (!result?.ok || !get(id) || get(id).web !== w) return;
      tab.url = url; tab.sleeping = true; w.remove(); tab.web = null;
      renderTabs(); StarBrowser.persist(true); toast("标签已休眠，打开时会重新载入");
    } catch (error) { toast(error.message || String(error)); }
    finally { if (get(id)) tab.suspending = false; }
  }
  function openMenu(id, x, y, returnElement) {
    const tab = get(id); if (!tab || !menu) return;
    closeMenu(); menuTabId = id; menuReturn = returnElement;
    menu.replaceChildren();
    const index = tabs.indexOf(tab);
    const items = [
      [tab.pinned ? "取消固定标签" : "固定标签", () => pin(id)],
      [tab.muted ? "取消标签静音" : "静音标签", () => mute(id)],
      ["复制标签", () => createTab(tab.ntp ? "about:home" : tab.url, { muted: tab.muted })],
      ["向左移动", () => move(id, -1), index === 0 || !!tabs[index - 1]?.pinned !== !!tab.pinned],
      ["向右移动", () => move(id, 1), index === tabs.length - 1 || !!tabs[index + 1]?.pinned !== !!tab.pinned],
      [tab.sleeping ? "打开休眠标签" : "休眠后台标签", () => tab.sleeping ? activateTab(id) : sleep(id), !tab.sleeping && (activeId === id || tab.ntp || tab.suspending)],
      ["关闭标签", () => closeTab(id)]
    ];
    for (const [label, action, disabled] of items) {
      const button = document.createElement("button"); button.className = "menu-action";
      button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = label; button.disabled = !!disabled;
      button.addEventListener("click", () => { closeMenu(); Promise.resolve(action()).then(()=>{if(document.activeElement===document.body||menu.contains(document.activeElement))tabsEl.querySelector(`[data-tab-id="${get(id)?id:activeId}"]`)?.focus();}).catch(error=>toast(error.message)); }); menu.appendChild(button);
    }
    const hint = document.createElement("p"); hint.className = "tab-menu-hint"; hint.textContent = "休眠释放网页资源，重开时刷新页面。"; menu.appendChild(hint);
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  }
  function decorate(tab, element) {
    element.dataset.tabId = tab.id;
    element.classList.toggle("pinned", !!tab.pinned); element.classList.toggle("sleeping", !!tab.sleeping);
    element.setAttribute("aria-label", (tab.title || "新标签") + (tab.pinned ? "，已固定" : "") + (tab.muted ? "，已静音" : "") + (tab.sleeping ? "，已休眠" : ""));
    if (tab.pinned) element.querySelector(".title").textContent = [...(tab.title || "新标签")][0];
    if (tab.muted || tab.sleeping) {
      const status = document.createElement("span"); status.className = "tab-state";
      status.innerHTML = StarBrowser.icon(tab.sleeping ? "Moon" : "VolumeX"); status.title = tab.sleeping ? "已休眠，打开时重新载入" : "已静音";
      element.querySelector(".close").before(status);
    }
    element.addEventListener("contextmenu", event => { event.preventDefault(); openMenu(tab.id, event.clientX, event.clientY, element); });
    element.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); const bounds = element.getBoundingClientRect(); openMenu(tab.id, bounds.left, bounds.bottom + 4, element);
      }
    });
  }
  function setup() {
    menu = document.createElement("div"); menu.id = "tabContextMenu"; menu.className = "tab-context-menu";
    menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "标签页操作"); menu.hidden = true; document.body.appendChild(menu);
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); return; }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    document.addEventListener("pointerdown", event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); });
    window.addEventListener("resize", () => closeMenu());
    $("tabActionsBtn").onclick = () => { const button = $("tabActionsBtn"), bounds = button.getBoundingClientRect(); $("browserMenu").hidden=true;openMenu(activeId, bounds.right - 205, bounds.bottom + 4, $("browserMenuBtn")); };
  }
  return { setup, decorate, ready, wake, pin, mute, move, sleep, closeMenu };
})();
