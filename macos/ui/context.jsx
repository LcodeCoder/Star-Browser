import {createContext,useContext} from 'react';
export const WorkspaceContext=createContext(null);
export const useWorkspace=()=>useContext(WorkspaceContext);
export const messageOf=error=>String(error?.message||error||'操作失败').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
export const osName=os=>({mac:'macOS',win:'Windows',android:'Android'})[os]||os;
export function timeAgo(value){if(!value)return '尚未打开';const ms=Date.now()-value;if(ms<60000)return '刚刚';if(ms<3600000)return `${Math.floor(ms/60000)} 分钟前`;if(ms<86400000)return `${Math.floor(ms/3600000)} 小时前`;return new Date(value).toLocaleDateString('zh-CN',{month:'short',day:'numeric'});}
export const dateTime=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
export function proxyLabel(proxy){return proxy?.host?`${proxy.host}:${proxy.port}`:'使用本机网络';}
