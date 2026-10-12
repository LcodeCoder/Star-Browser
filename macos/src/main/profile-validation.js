'use strict';
const text = (value, limit = 200) => String(value ?? '').trim().slice(0, limit);
const HTTP_URL = /^(https?:\/\/|about:blank$|about:home$)/i;
function validateProfile(input = {}, creating = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('环境配置必须是对象');
  const out = {};
  for (const [key, limit] of Object.entries({ name: 120, group: 80, note: 2000, language: 60, country: 2, seed: 160 })) {
    if (input[key] !== undefined) out[key] = text(input[key], limit);
  }
  if (creating && !out.name) out.name = '新环境';
  if (input.os !== undefined) {
    if (!['mac', 'win', 'android'].includes(input.os)) throw new Error('请选择 macOS、Windows 或 Android');
    out.os = input.os;
  }
  if (input.timezone !== undefined) {
    out.timezone = text(input.timezone, 80);
    if (out.timezone) try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }); } catch { throw new Error('时区名称无效，例如 Asia/Tokyo'); }
  }
  if (input.startUrl !== undefined) {
    out.startUrl = text(input.startUrl, 4096) || 'about:home';
    if (!HTTP_URL.test(out.startUrl)) throw new Error('起始页需使用 http://、https:// 或 about:home');
    if (/^https?:/.test(out.startUrl)) try { new URL(out.startUrl); } catch { throw new Error('起始页网址不完整'); }
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
    for (const [key, values] of Object.entries({hardwareConcurrency:[2,4,8,12,16,24,32], deviceMemory:[2,4,8], devicePixelRatio:[1,1.25,1.5,2,2.5,3]})) {
      if (fp[key] !== undefined && fp[key] !== '') {
        if (!values.includes(Number(fp[key]))) throw new Error('硬件配置不在支持的范围内');
        out.fingerprint[key] = Number(fp[key]);
      }
    }
    if (fp.screen?.width || fp.screen?.height) {
      const width = Number(fp.screen.width), height = Number(fp.screen.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width<320 || width>7680 || height<320 || height>4320) throw new Error('屏幕尺寸无效');
      out.fingerprint.screen = {width,height,availWidth:width,availHeight:height-40,colorDepth:24,pixelDepth:24};
    }
  }
  if (input.permissions !== undefined) {
    out.permissions = {};
    for (const key of ['geolocation','notifications','media','clipboard-read','midi','display-capture']) {
      const value=input.permissions?.[key];
      if (['ask','allow','block'].includes(value)) out.permissions[key] = value;
    }
  }
  return out;
}
function validateProxy(input) {
  if (!input || !input.host) return null;
  const type = input.type || 'http', host = text(input.host, 255), port = Number(input.port);
  if (!['http','https','socks5'].includes(type)) throw new Error('代理支持 HTTP、HTTPS 和 SOCKS5');
  if (!host || /[\s/@]/.test(host) || !Number.isInteger(port) || port<1 || port>65535) throw new Error('请填写有效的代理地址和端口');
  return {type,host,port:String(port),user:text(input.user,255),pass:String(input.pass || '').slice(0,255)};
}
function importProfiles(payload) {
  const list = Array.isArray(payload) ? payload : payload?.profiles;
  if (!Array.isArray(list) || list.length>10000) throw new Error('导入文件需包含 profiles 数组，最多 10000 个环境');
  return list.map((item,index) => {
    try { return validateProfile(item,true); } catch(error) { throw new Error(`第 ${index+1} 个环境：${error.message}`); }
  });
}
module.exports = { validateProfile, validateProxy, importProfiles };
