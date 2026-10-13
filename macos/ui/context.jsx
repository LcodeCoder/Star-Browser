import { createContext, useContext } from "react";
const WorkspaceContext = createContext(null);
const useWorkspace = () => useContext(WorkspaceContext);
const messageOf = (error) => {
  const text = String(error?.message || error || "操作失败").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  const code = error?.code || text.match(/\b(ENOSPC|EACCES|EPERM|EROFS|EISDIR|ENOTDIR|EIO|EBUSY)\b/)?.[1];
  return ({
    ENOSPC: "磁盘空间不足，清理空间后重试。",
    EACCES: "无法访问本地数据，请检查文件权限或是否被其他程序占用后重试。",
    EPERM: "无法访问本地数据，请检查文件权限或是否被其他程序占用后重试。",
    EROFS: "数据所在磁盘为只读，请恢复写入权限后重试。",
    EISDIR: "本地数据路径发生冲突，请修复数据目录后重试。",
    ENOTDIR: "本地数据路径发生冲突，请修复数据目录后重试。",
    EIO: "磁盘读写失败，请确认磁盘连接正常后重试。",
    EBUSY: "文件正在使用，请稍候重试。",
  })[code] || text;
};
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
