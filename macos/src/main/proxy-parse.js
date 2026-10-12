"use strict";
/**
 * 代理文本解析：把外贸常用的「一行代理」自动拆成结构化字段。
 * 支持格式（均兼容有无协议头、有无账号密码）：
 *   1) host:port:user:pass          例：103.13.214.244:45001:loU692a7efddea27:EpGsBrXL2YN6kQfTVs
 *   2) scheme://host:port:user:pass 例：socks5://103.13.214.244:45001:loU...:EpG...
 *   3) scheme://user:pass@host:port 例：socks5://user:pass@host:port
 *   4) user:pass@host:port
 *   5) host:port                     例：1.2.3.4:8080
 * 默认协议：socks5（与产品默认一致）。
 * @returns {{type:string,host:string,port:string,user:string,pass:string}|null}
 */
function parseProxyInput(raw) {
  let s = (raw || "").trim();
  if (!s) return null;

  let type = "socks5";

  // 1) 协议头：socks5:// / socks:// / http:// / https://（scheme 可能含数字，如 socks5）
  const m = s.match(/^([a-zA-Z0-9]+):\/\//);
  if (m) {
    const sch = m[1].toLowerCase();
    type = sch === "socks5" || sch === "socks" ? "socks5" : "http";
    s = s.slice(m[0].length);
  }

  // 2) 去掉 IPv6 方括号（代理多为 IPv4，这里兼容处理）
  s = s.replace(/^\[/, "").replace(/\]$/, "");

  let user = "";
  let pass = "";

  // 3) user:pass@host:port 形式
  const at = s.indexOf("@");
  if (at >= 0) {
    const cred = s.slice(0, at);
    s = s.slice(at + 1);
    const ci = cred.indexOf(":");
    if (ci >= 0) {
      user = cred.slice(0, ci);
      pass = cred.slice(ci + 1);
    } else {
      user = cred;
    }
  }

  // 4) 剩余部分：host:port[:user:pass] 或 host:port
  const parts = s.split(":");
  if (parts.length >= 4) {
    // host:port:user:pass（密码本身含 : 时，把中间部分都并给 user、最后一段给 pass）
    const host = parts[0];
    const port = parts[1];
    user = parts.slice(2, -1).join(":");
    pass = parts[parts.length - 1];
    return { type, host, port, user, pass };
  }
  if (parts.length === 3) {
    // 歧义：host:port:user（视为无密码）或 host:port:pass。无 @ 时按 host:port:user 处理
    if (at >= 0) return { type, host: parts[0], port: parts[1], user, pass };
    return { type, host: parts[0], port: parts[1], user: parts[2], pass: "" };
  }
  if (parts.length === 2) {
    return {
      type,
      host: parts[0],
      port: parts[1],
      user: user || "",
      pass: pass || "",
    };
  }
  return null;
}

/** Chromium proxy rules contain the address only. HTTP credentials use login;
 * authenticated SOCKS5 uses the local HTTP gateway. */
function buildProxyRules(proxy) {
  if (!proxy || !proxy.host) return "";
  const scheme = proxy.type === "socks5" ? "socks5" : proxy.type === "https" ? "https" : "http";
  const host = (proxy.host || "").trim();
  const port =
    (proxy.port || "").trim() || (scheme === "socks5" ? "1080" : "8080");
  // Chromium 的代理规则只接受地址；HTTP 凭据通过 login 事件提供，
  // 带鉴权 SOCKS5 则通过 local-proxy 网关提供。
  return `${scheme}://${host}:${port}`;
}

module.exports = { parseProxyInput, buildProxyRules };
