'use strict';
const text = (value, limit = 200) => String(value ?? '').trim().slice(0, limit);
const HTTP_URL = /^(https?:\/\/|about:blank$|about:home$)/i;
class ProfileValidationError extends Error {
  constructor(message, field) { super(message); this.name = 'ProfileValidationError'; this.field = field; }
}
const invalid = (message, field) => { throw new ProfileValidationError(message, field); };
function validateProfile(input = {}, creating = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('环境配置必须是对象');
  const out = {};
  for (const [key, limit] of Object.entries({ name: 120, group: 80, note: 2000, language: 60, country: 2, seed: 160 })) {
    if (input[key] !== undefined) out[key] = text(input[key], limit);
  }
  if (out.country !== undefined) {
    if (!/^[a-z]{2}$/i.test(String(input.country ?? '').trim())) invalid('国家 / 地区需使用两位代码，例如 US 或 JP', 'country');
    out.country = out.country.toUpperCase();
  }
  if (out.language) {
    try { out.language = Intl.getCanonicalLocales(out.language)[0]; }
    catch { invalid('浏览器语言无效，例如 en-US 或 ja-JP', 'language'); }
  }
  if (creating && !out.name) out.name = '新环境';
  if (input.os !== undefined) {
    if (!['mac', 'win', 'android'].includes(input.os)) invalid('请选择 macOS、Windows 或 Android', 'os');
    out.os = input.os;
  }
  if (input.timezone !== undefined) {
    out.timezone = text(input.timezone, 80);
    if (out.timezone) try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }); } catch { invalid('时区名称无效，例如 Asia/Tokyo', 'timezone'); }
  }
  if (input.startUrl !== undefined) {
    out.startUrl = text(input.startUrl, 4096) || 'about:home';
    if (!HTTP_URL.test(out.startUrl)) invalid('起始页需使用 http://、https:// 或 about:home', 'startUrl');
    if (/^https?:/i.test(out.startUrl)) try { new URL(out.startUrl); } catch { invalid('起始页网址不完整', 'startUrl'); }
  }
  for (const key of ['timezoneManual', 'langManual', 'pinned', 'archived', 'restoreSession']) if (input[key] !== undefined) out[key] = !!input[key];
  if (input.tags !== undefined) out.tags = [...new Set((Array.isArray(input.tags) ? input.tags : String(input.tags).split(/[,，]/)).map(v => text(v, 40)).filter(Boolean))].slice(0, 20);
  if (input.webrtc !== undefined) {
    if (!['disable', 'proxy'].includes(input.webrtc)) throw new Error('WebRTC 设置无效');
    out.webrtc = input.webrtc;
  }
  if (input.proxy !== undefined) out.proxy = validateProxy(input.proxy);
  if (input.fingerprint !== undefined) {
    const fp = input.fingerprint || {};
    out.fingerprint = {};
    if (fp.displayMode !== undefined) {
      if (!['native', 'custom'].includes(fp.displayMode)) invalid('显示策略无效', 'fingerprint.displayMode');
      out.fingerprint.displayMode = fp.displayMode;
    }
    for (const [key, values] of Object.entries({hardwareConcurrency:[2,4,8,12,16,24,32], deviceMemory:[2,4,8], devicePixelRatio:[1,1.25,1.5,2,2.5,3]})) {
      if (fp[key] !== undefined && fp[key] !== '') {
        if (!values.includes(Number(fp[key]))) invalid('硬件配置不在支持的范围内', 'fingerprint.' + key);
        out.fingerprint[key] = Number(fp[key]);
      }
    }
    if(fp.noise!==undefined){out.fingerprint.noise={};for(const key of ['canvas','audio','webgl','clientRects']){if(fp.noise[key]!==undefined){if(typeof fp.noise[key]!=='boolean')throw new Error('指纹策略需选择开启或关闭');out.fingerprint.noise[key]=fp.noise[key];}}}
    if(fp.webgl?.vendor || fp.webgl?.renderer){
      const vendor=text(fp.webgl.vendor,240),renderer=text(fp.webgl.renderer,500);
      if(!vendor||!renderer)invalid('请同时填写 WebGL 厂商与渲染器', 'fingerprint.webgl.' + (!vendor ? 'vendor' : 'renderer'));
      out.fingerprint.webgl={vendor,renderer};
    }
    if (fp.screen?.width || fp.screen?.height) {
      const width = Number(fp.screen.width), height = Number(fp.screen.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width<320 || width>7680 || height<320 || height>4320) invalid('请填写完整的屏幕宽高：宽度 320–7680，高度 320–4320', 'fingerprint.screen.' + (!Number.isInteger(width) || width < 320 || width > 7680 ? 'width' : 'height'));
      out.fingerprint.screen = {width,height,availWidth:width,availHeight:height-40,colorDepth:24,pixelDepth:24};
    }
  }
  if (input.extensions !== undefined) {
    if (!Array.isArray(input.extensions) || input.extensions.length>20 || input.extensions.some(id=>typeof id!=='string'||!/^[a-f\d-]{36}$/i.test(id))) throw new Error('每个环境最多选择 20 个有效扩展');
    out.extensions=[...new Set(input.extensions)];
  }
  if (input.permissions !== undefined) {
    out.permissions = {};
    for (const key of ['geolocation','notifications','media','clipboard-read','midi','display-capture','local-fonts','window-management','fileSystem','local-network','loopback-network']) {
      const value=input.permissions?.[key];
      if (['ask','allow','block'].includes(value)) out.permissions[key] = value;
    }
  }
  return out;
}
function validateProxy(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) invalid('代理配置必须是对象', 'proxy.host');
  const rawHost = String(input.host ?? '').trim();
  if (!rawHost) {
    if (String(input.port ?? '').trim() || String(input.user ?? '') || String(input.pass ?? '')) invalid('填写代理地址，或清空端口与账号后使用本机网络', 'proxy.host');
    return null;
  }
  const type = input.type || 'http';
  if (!['http', 'https', 'socks5'].includes(type)) invalid('代理支持 HTTP、HTTPS 和 SOCKS5', 'proxy.type');
  const hostError = () => invalid('代理地址只需填写主机名或 IP，不包含协议与端口', 'proxy.host');
  if (/[\s/\\@?#%]/u.test(rawHost) || /[\u0000-\u001f\u007f]/u.test(rawHost)) hostError();
  let host;
  try {
    const authority = rawHost.includes(':') && !rawHost.startsWith('[') ? '[' + rawHost + ']' : rawHost;
    const url = new URL('http://' + authority + '/');
    if (!url.hostname || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) hostError();
    host = url.hostname.replace(/^\[|\]$/g, '');
    if (host.length > 253 || (!host.includes(':') && (!/^[a-z0-9_.-]+$/i.test(host) || host.split('.').some(label => label.length > 63)))) hostError();
  } catch { hostError(); }
  const rawPort = String(input.port ?? '').trim();
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) invalid('代理端口需为 1–65535 的整数', 'proxy.port');
  const user = String(input.user ?? ''), pass = String(input.pass ?? '');
  if (type !== 'socks5' && user.includes(':')) invalid('HTTP 代理账号不能包含冒号', 'proxy.user');
  const limit = type === 'socks5' ? 255 : 4096;
  for (const [key, value] of [['user', user], ['pass', pass]]) {
    if (new TextEncoder().encode(value).length > limit) invalid(type === 'socks5' ? 'SOCKS5 账号和密码分别最多 255 个 UTF-8 字节' : '代理账号和密码分别最多 4096 个 UTF-8 字节', 'proxy.' + key);
  }
  return {type, host, port: String(Number(rawPort)), user, pass};
}
function importProfiles(payload) {
  const list = Array.isArray(payload) ? payload : payload?.profiles;
  if (!Array.isArray(list) || list.length>10000) throw new Error('导入文件需包含 profiles 数组，最多 10000 个环境');
  return list.map((item,index) => {
    try { return validateProfile(item,true); } catch(error) { throw new Error(`第 ${index+1} 个环境：${error.message}`); }
  });
}
module.exports = { validateProfile, validateProxy, importProfiles, ProfileValidationError };
