import { createContext, useContext } from "react";
const WorkspaceContext = createContext(null);
const useWorkspace = () => useContext(WorkspaceContext);
const messageOf = (error) => String(error?.message || error || "操作失败").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const osName = (os) => ({ mac: "macOS", win: "Windows", android: "Android" })[os] || os;
function timeAgo(value) {
  if (!value) return "尚未打开";
  const ms = Date.now() - value;
  if (ms < 6e4) return "刚刚";
  if (ms < 36e5) return `${Math.floor(ms / 6e4)} 分钟前`;
  if (ms < 864e5) return `${Math.floor(ms / 36e5)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
const dateTime = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
function proxyLabel(proxy) {
  return proxy?.host ? `${proxy.host.includes(":") ? "[" + proxy.host.replace(/^\[|\]$/g, "") + "]" : proxy.host}:${proxy.port}` : "使用本机网络";
}
export {
  WorkspaceContext,
  dateTime,
  messageOf,
  osName,
  proxyLabel,
  timeAgo,
  useWorkspace
};
