import {useWindowCloseGuard} from './editor-state';
import React, {useState, useEffect, useRef} from "react";
import {Settings2, ShieldCheck, ChevronDown} from "lucide-react";
import {Button, Modal, Field} from "./components";
import {useWorkspace, osName, messageOf, proxyLabel} from "./context";
import {COUNTRIES, LANGUAGES, TIMEZONES} from "./profile-options";
import {validateProfile, ProfileValidationError} from "../src/main/profile-validation";
import {parseProxyInput} from "../src/main/proxy-parse";
import {submitShortcut} from "./editor-state";
const SECTIONS = [["basic", "基本信息"], ["network", "网络连接"], ["locale", "语言与时区"], ["extensions", "扩展"], ["advanced", "指纹与权限"]];
const FIELD_IDS = {"name": "f_name", "os": "f_os", "country": "f_country", "startUrl": "f_url", "proxy.type": "f_proxy_type", "proxy.host": "f_proxy_host", "proxy.port": "f_proxy_port", "proxy.user": "f_proxy_user", "proxy.pass": "f_proxy_pass", "language": "f_language", "timezone": "f_timezone", "fingerprint.hardwareConcurrency": "f_cpu", "fingerprint.deviceMemory": "f_memory", "fingerprint.devicePixelRatio": "f_dpr", "fingerprint.screen.width": "f_screen_width", "fingerprint.screen.height": "f_screen_height", "fingerprint.webgl.renderer": "f_webgl_renderer", "fingerprint.webgl.vendor": "f_webgl_vendor"};
const blankProfile = { name: "", group: "", note: "", tags: [], os: window.api?.platform === "win32" ? "win" : "mac", country: "US", language: "", timezone: "", startUrl: "about:home", proxy: null, restoreSession: true, webrtc: "disable", fingerprint: {}, permissions: {}, extensions: [] };
export function ProfileEditor({ profile, onClose }) {
  const { snapshot, refresh, notify } = useWorkspace();
  const [form, setForm] = useState(() => ({
    ...blankProfile,
    ...(profile || {}),
    tags: (profile?.tags || []).join(", "),
    proxy: {
      type: "http",
      host: "",
      port: "",
      user: "",
      pass: "",
      ...profile?.proxy,
    },
    fingerprint: { ...profile?.fingerprint },
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const initial = useRef(JSON.stringify(form));
  const formRef = useRef(null);
  const [discard, setDiscard] = useState(false);
  const [activeSection, setActiveSection] = useState("basic");
  const [summaryExpanded, setSummaryExpanded] = useState(() => window.innerWidth > 800);
  const [proxyNotice, setProxyNotice] = useState("");
  const dirty = JSON.stringify(form) !== initial.current;
  useWindowCloseGuard(dirty, busy);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const resize = () => setSummaryExpanded(!media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const changed = () => { setError(null); setDiscard(false); };
  const set = (key, value) => { changed(); setForm(f => ({...f, [key]: value})); };
  const proxySet = (key, value) => { changed(); setProxyNotice(""); setForm(f => ({...f, proxy: {...f.proxy, [key]: value}})); };
  const fpSet = (key, value) => { changed(); setForm(f => ({...f, fingerprint: {...f.fingerprint, [key]: value}})); };
  const fieldError = key => error?.field === key ? error.message : undefined;
  const requestClose = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  const sectionTo = key => {
    const section = formRef.current?.querySelector("#profile-" + key);
    if (!section) return;
    if (section.tagName === "DETAILS") section.open = true;
    setActiveSection(key);
    section.scrollIntoView({block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
    section.focus({preventScroll: true});
  };
  const trackSection = () => {
    const root = formRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 85;
    let current = "basic";
    for (const [key] of SECTIONS) if (root.querySelector("#profile-" + key)?.getBoundingClientRect().top <= top) current = key;
    setActiveSection(current);
  };
  const locateError = field => {
    const target = formRef.current?.querySelector('[data-profile-field="' + field + '"] input, [data-profile-field="' + field + '"] select');
    const fallback = document.getElementById(FIELD_IDS[field]);
    const control = target || fallback;
    if (!control) return;
    const details = control.closest("details");
    if (details) details.open = true;
    requestAnimationFrame(() => { control.focus({preventScroll: true}); control.scrollIntoView({block: "center", behavior: "instant"}); trackSection(); });
  };
  const pasteProxy = event => {
    const text = event.clipboardData.getData("text/plain").trim();
    if (!text.includes(":") || !text || /\n/.test(text)) return;
    const proxy = parseProxyInput(text, form.proxy.type);
    if (!proxy) return;
    event.preventDefault();
    set("proxy", proxy);
    setProxyNotice("已解析完整代理地址，请核对协议、端口和账号。");
  };
  const noise = {
    canvas: false,
    audio: false,
    webgl: false,
    clientRects: false,
    ...form.fingerprint.noise,
  };
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setError(null); setDiscard(false);
    try {
      if (!form.name.trim()) throw new ProfileValidationError("给环境起个名称，方便下次找到", "name");
      const data = validateProfile({...form, name: form.name.trim(), tags: form.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), timezoneManual: !!form.timezone, langManual: !!form.language, proxy: form.proxy});
      setBusy(true);
      if (profile) await window.api.update(profile.id, data);
      else await window.api.create(data);
      await refresh(); notify(profile ? "环境已更新" : "环境已创建"); onClose();
    } catch (failure) {
      setError({message: messageOf(failure), field: failure.field});
      locateError(failure.field);
    } finally { setBusy(false); }
  };
  const rows = [
    ["操作系统", osName(form.os)],
    ["国家 / 地区", COUNTRIES.find(([code]) => code === form.country)?.[1] || form.country],
    ["网络", form.proxy.host.trim() ? `${form.proxy.type.toUpperCase()} · ${proxyLabel({...form.proxy, port: form.proxy.port || "未填端口"})}` : "使用本机网络"],
    ["语言", form.language || "随网络出口"],
    ["时区", form.timezone || "随网络出口"],
    ["处理器", form.fingerprint.hardwareConcurrency ? form.fingerprint.hardwareConcurrency + " 核心" : "按种子生成"],
    ["内存", form.fingerprint.deviceMemory ? form.fingerprint.deviceMemory + " GB" : "按种子生成"],
    ["屏幕", form.fingerprint.screen?.width || form.fingerprint.screen?.height ? `${form.fingerprint.screen.width || "未填宽度"} × ${form.fingerprint.screen.height || "未填高度"}` : "按种子生成"],
    ["像素比", form.fingerprint.devicePixelRatio || "按种子生成"],
    ["WebRTC", form.webrtc === "disable" ? "关闭" : "启用受限连接"],
    ["扩展", `${form.extensions.length} 个已选择`],
  ];
  const crossPlatform = form.os !== (snapshot.engine.platform === "win32" ? "win" : "mac");
  return (
    <Modal
      open
      onOpenChange={open => !open && requestClose()}
      wide
      dismissible={!busy}
      className="profile-editor-modal" onKeyDown={event=>submitShortcut(event,busy,formRef.current)}
      bodyClassName="profile-editor-body"
      title={profile ? "编辑环境" : "新建环境"}
      description="为这次工作准备独立的浏览空间。"
      id="modal"
      footer={<div className="profile-editor-footer">
        {error && <div className="inline-error" role="alert" id="profile-editor-error">{error.message}</div>}
        {discard ? <div className="profile-discard" role="alert">
          <span><strong>修改尚未保存</strong><small>继续编辑，或放弃这次修改后关闭。</small></span>
          <Button autoFocus data-continue-editing onClick={() => setDiscard(false)}>继续编辑</Button>
          <Button variant="danger" onClick={onClose}>放弃更改</Button>
        </div> : <div className="profile-save-actions">
          <span className="footer-note">{busy ? "正在保存配置…" : dirty ? "有未保存的修改" : "配置在下次启动时生效"}</span>
          <Button onClick={requestClose} disabled={busy}>取消</Button>
          <Button variant="primary" id="btnSave" type="submit" form="profile-form" disabled={busy}>{busy ? "保存中…" : profile ? "保存更改" : "创建环境"}</Button>
        </div>}
      </div>}
    >
      <nav className="profile-section-nav" aria-label="环境配置分区">{SECTIONS.map(([key, label]) => <button type="button" key={key} aria-current={activeSection === key ? "location" : undefined} aria-controls={"profile-" + key} onClick={() => sectionTo(key)}>{label}</button>)}</nav>
      <div className="profile-editor-layout">
      <form id="profile-form" ref={formRef} className="profile-editor-form" noValidate onScroll={trackSection} onSubmit={submit}>
        <fieldset disabled={busy}>
        <section className="form-section" id="profile-basic" tabIndex={-1}>
          <h3>基本信息</h3>
          <div className="form-grid">
            <Field label="环境名称" id="f_name" error={fieldError("name")}>
              <input
                id="f_name"
                autoFocus
                required
                maxLength={120}
                placeholder="例如：日本内容工作室"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="分组" id="f_group">
              <input
                id="f_group"
                list="groups"
                placeholder="默认分组"
                value={form.group}
                onChange={(e) => set("group", e.target.value)}
              />
              <datalist id="groups">
                {[...new Set(snapshot.profiles.map((p) => p.group))].map(
                  (g) => (
                    <option key={g}>{g}</option>
                  ),
                )}
              </datalist>
            </Field>
            <Field label="操作系统" id="f_os" error={fieldError("os")}>
              <select
                id="f_os"
                value={form.os}
                onChange={(e) => set("os", e.target.value)}
              >
                <option value="mac">macOS</option>
                <option value="win">Windows</option>
                <option value="android">Android</option>
              </select>
            </Field>
            <Field label="国家 / 地区" id="f_country" error={fieldError("country")}>
              <select
                id="f_country"
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
              >
                {[...COUNTRIES, ...(!COUNTRIES.some(([code]) => code === form.country) ? [[form.country, form.country]] : [])].map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} {code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="标签" id="f_tags" className="span-2">
              <input
                id="f_tags"
                placeholder="用逗号分隔，例如：内容, QA"
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
              />
            </Field>
            <Field label="起始页" id="f_url" error={fieldError("startUrl")} className="span-2">
              <input
                id="f_url"
                value={form.startUrl}
                placeholder="https:// 或 about:home"
                onChange={(e) => set("startUrl", e.target.value)}
              />
            </Field>
            <Field label="备注" id="f_note" className="span-2">
              <textarea
                id="f_note"
                rows={2}
                placeholder="记下用途、工作进度或下次要做的事"
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </div>
        </section>
        <section className="form-section" id="profile-network" tabIndex={-1}>
          <div className="section-heading">
            <h3>网络连接</h3>
            <select
              aria-label="选择已保存代理"
              value=""
              onChange={(e) => {
                const p = snapshot.proxies.find(
                  (p2) => p2.id === e.target.value,
                );
                if (p) set("proxy", { ...p });
              }}
            >
              <option value="">从代理库选择</option>
              {snapshot.proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {proxyLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-grid proxy-form">
            <Field label="协议" id="f_proxy_type" error={fieldError("proxy.type")}>
              <select
                value={form.proxy.type}
                onChange={(e) => proxySet("type", e.target.value)}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </Field>
            <Field label="代理地址" id="f_proxy_host" error={fieldError("proxy.host")}>
              <input
                placeholder="主机名、IP 或粘贴完整代理地址"
                onPaste={pasteProxy}
                value={form.proxy.host}
                onChange={(e) => proxySet("host", e.target.value)}
              />
            </Field>
            <Field label="端口" id="f_proxy_port" error={fieldError("proxy.port")}>
              <input
                inputMode="numeric"
                placeholder="8080"
                value={form.proxy.port}
                onChange={(e) => proxySet("port", e.target.value)}
              />
            </Field>
            <Field label="账号" id="f_proxy_user" error={fieldError("proxy.user")}>
              <input
                autoComplete="off"
                value={form.proxy.user}
                onChange={(e) => proxySet("user", e.target.value)}
              />
            </Field>
            <Field label="密码" id="f_proxy_pass" error={fieldError("proxy.pass")}>
              <input
                type="password"
                autoComplete="new-password"
                value={form.proxy.pass}
                onChange={(e) => proxySet("pass", e.target.value)}
              />
            </Field>
          </div>
          <p className="field-hint">
            <ShieldCheck size={14} />
            {proxyNotice || "配置代理后，连接失败会阻止启动。"}
          </p>
        </section>
        <section className="form-section" id="profile-locale" tabIndex={-1}>
          <h3>语言与时区</h3>
          <div className="form-grid">
            <Field label="浏览器语言" id="f_language" error={fieldError("language")}>
              <select
                id="f_language"
                value={form.language}
                onChange={(e) => set("language", e.target.value)}
              >
                <option value="">跟随网络出口</option>
                {[...LANGUAGES, ...(form.language && !LANGUAGES.some(([code]) => code === form.language) ? [[form.language, form.language]] : [])].map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="时区" id="f_timezone" error={fieldError("timezone")}>
              <select
                id="f_timezone"
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                <option value="">跟随网络出口</option>
                {[...new Set([...TIMEZONES, form.timezone].filter(Boolean))].map(
                  (zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
        </section>
        <section className="form-section" id="profile-extensions" tabIndex={-1}>
          <h3>扩展</h3>
          {snapshot.extensions?.length ? (
            <div className="extension-selection">
              {snapshot.extensions.map((extension) => (
                <label className="check-line" key={extension.id}>
                  <input
                    type="checkbox"
                    aria-label={"启用 " + extension.name}
                    checked={form.extensions.includes(extension.id)}
                    onChange={(e) =>
                      set(
                        "extensions",
                        e.target.checked
                          ? [...form.extensions, extension.id]
                          : form.extensions.filter((id) => id !== extension.id),
                      )
                    }
                  />
                  <span>
                    {extension.name}
                    <small>版本 {extension.version}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">先在扩展库添加常用工具，再为这个环境启用。</p>
          )}
          {form.extensions.some(
            (id) => !snapshot.extensions?.some((e) => e.id === id),
          ) && (
            <p className="inline-error">
              有引用的扩展已缺失。
              <Button
                onClick={() =>
                  set(
                    "extensions",
                    form.extensions.filter((id) =>
                      snapshot.extensions?.some((e) => e.id === id),
                    ),
                  )
                }
              >
                清除失效配置
              </Button>
            </p>
          )}
        </section>
        <details className="form-section" id="profile-advanced" tabIndex={-1}>
          <summary>
            指纹、硬件与网站权限
            <Settings2 size={15} />
          </summary>
          <div className="form-grid advanced-fields">
            {form.os !==
              (snapshot.engine.platform === "win32" ? "win" : "mac") && (
              <p className="span-2 inline-notice">
                当前选择与本机系统不同。系统标识可以模拟，原生显卡、字体和系统渲染仍来自这台设备。
              </p>
            )}
            <Field label="处理器核心" id="f_cpu" error={fieldError("fingerprint.hardwareConcurrency")}>
              <select
                value={form.fingerprint.hardwareConcurrency || ""}
                onChange={(e) => fpSet("hardwareConcurrency", e.target.value)}
              >
                <option value="">由稳定种子生成</option>
                {[2, 4, 8, 12, 16, 24, 32].map((n) => (
                  <option key={n} value={n}>
                    {n} 核心
                  </option>
                ))}
              </select>
            </Field>
            <Field label="设备内存" id="f_memory" error={fieldError("fingerprint.deviceMemory")}>
              <select
                value={form.fingerprint.deviceMemory || ""}
                onChange={(e) => fpSet("deviceMemory", e.target.value)}
              >
                <option value="">由稳定种子生成</option>
                {[2, 4, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} GB
                  </option>
                ))}
              </select>
            </Field>
            <Field label="像素比" id="f_dpr" error={fieldError("fingerprint.devicePixelRatio")}>
              <select
                value={form.fingerprint.devicePixelRatio || ""}
                onChange={(e) => fpSet("devicePixelRatio", e.target.value)}
              >
                <option value="">由稳定种子生成</option>
                {[1, 1.25, 1.5, 2, 2.5, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="屏幕宽度" id="f_screen_width" error={fieldError("fingerprint.screen.width")}>
              <input
                aria-label="屏幕宽度"
                type="number"
                min={320}
                max={7680}
                placeholder="稳定生成"
                value={form.fingerprint.screen?.width || ""}
                onChange={(e) =>
                  fpSet("screen", {
                    ...form.fingerprint.screen,
                    width: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="屏幕高度" id="f_screen_height" error={fieldError("fingerprint.screen.height")}>
              <input
                aria-label="屏幕高度"
                type="number"
                min={320}
                max={4320}
                placeholder="稳定生成"
                value={form.fingerprint.screen?.height || ""}
                onChange={(e) =>
                  fpSet("screen", {
                    ...form.fingerprint.screen,
                    height: e.target.value,
                  })
                }
              />
            </Field>
            {[
              ["canvas", "Canvas 读值"],
              ["audio", "音频读值"],
              ["webgl", "WebGL 标识"],
              ["clientRects", "页面几何"],
            ].map(([key, label]) => (
              <Field
                key={key}
                label={label}
                hint={
                  key === "clientRects"
                    ? "默认保留原生位置，适合日常网页。"
                    : "默认使用原生值；稳定覆盖可能产生跨接口差异并被检测。"
                }
              >
                <select
                  aria-label={label + "策略"}
                  value={noise[key] ? "stable" : "native"}
                  onChange={(e) =>
                    fpSet("noise", {
                      ...noise,
                      [key]: e.target.value === "stable",
                    })
                  }
                >
                  <option value="stable">稳定覆盖</option>
                  <option value="native">使用原生值</option>
                </select>
              </Field>
            ))}
            {noise.webgl && (
              <>
                <Field
                  label="WebGL 厂商"
                  id="f_webgl_vendor" error={fieldError("fingerprint.webgl.vendor")}
                  hint="留空时使用环境生成值；填写时需同时指定渲染器。"
                >
                  <input
                    value={form.fingerprint.webgl?.vendor || ""}
                    maxLength={240}
                    placeholder="例如 Google Inc. (Intel)"
                    onChange={(e) =>
                      fpSet("webgl", {
                        ...form.fingerprint.webgl,
                        vendor: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="WebGL 渲染器" id="f_webgl_renderer" error={fieldError("fingerprint.webgl.renderer")}>
                  <input
                    value={form.fingerprint.webgl?.renderer || ""}
                    maxLength={500}
                    placeholder="填入完整渲染器标识"
                    onChange={(e) =>
                      fpSet("webgl", {
                        ...form.fingerprint.webgl,
                        renderer: e.target.value,
                      })
                    }
                  />
                </Field>
              </>
            )}
            <Field label="WebRTC">
              <select
                value={form.webrtc}
                onChange={(e) => set("webrtc", e.target.value)}
              >
                <option value="disable">关闭</option>
                <option value="proxy">启用受限连接</option>
              </select>
            </Field>
            {[
              ["geolocation", "位置"],
              ["notifications", "通知"],
              ["media", "摄像头与麦克风"],
              ["clipboard-read", "读取剪贴板"],
              ["display-capture", "屏幕共享"],
              ["local-fonts", "本机字体"],
              ["window-management", "屏幕信息"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <select
                  value={form.permissions[key] || "ask"}
                  onChange={(e) =>
                    set("permissions", {
                      ...form.permissions,
                      [key]: e.target.value,
                    })
                  }
                >
                  <option value="ask">每次询问</option>
                  <option value="block">始终拒绝</option>
                  <option value="allow">允许</option>
                </select>
              </Field>
            ))}
          </div>
        </details>
        <label className="check-line">
          <input
            type="checkbox"
            checked={form.restoreSession !== false}
            onChange={(e) => set("restoreSession", e.target.checked)}
          />
          下次启动恢复上次标签页
        </label>
      </fieldset>
      </form>
      <aside className="profile-editor-summary" aria-label="当前配置摘要"><details open={summaryExpanded} onToggle={event => setSummaryExpanded(event.currentTarget.open)}>
        <summary>配置摘要<span>{osName(form.os)} · {form.country}</span><ChevronDown size={15} /></summary>
        <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="profile-summary-policy">{Object.entries(noise).filter(([, enabled]) => enabled).length ? "已启用稳定覆盖；启动后可在环境详情检查网页实际值。" : "图形与音频保留原生值，适合日常网页使用。"}</p>
        {crossPlatform && <p className="inline-notice">系统标识与本机不同，字体、显卡和系统渲染仍来自本机。</p>}
        <p className="profile-summary-note">自动语言和时区在启动时根据网络出口解析。出口未知时，代理环境使用所选地区，直连环境使用本机设置。</p>
      </details></aside>
      </div>
    </Modal>
  );
}
