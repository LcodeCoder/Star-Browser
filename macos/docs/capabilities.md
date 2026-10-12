# 能力研究与实现状态

研究日期：2026-10-12。来源为官方功能页/帮助文档。以下为功能分类，商业厂商的检测保证不作为本项目结果。

| 分类 | 官方参考 | 本项目基线 | 待完善 |
| --- | --- | --- | --- |
| 环境隔离、稳定配置 | AdsPower、GoLogin | 独立 session/Chrome 数据目录，首脚本 JS 注入 | 数据备份与导入闭环 |
| 指纹参数 | Multilogin、BitBrowser | UA/平台/语言/时区/屏幕/硬件/WebGL/Canvas/音频/WebRTC 等 JS 配置 | 配置一致性、内核版本、可调参数、明确内核边界 |
| 高频工作台 | GoLogin、Dolphin Anty | 原列表、搜索、创建编辑 | 分组/标签/状态/详情/批量/归档/快捷键 |
| 代理管理 | AdsPower、Octo Browser | HTTP/SOCKS5、鉴权、检测、网关 | 保存代理库、分配、失败阻断、批量导入 |
| Cookie/书签/历史 | AdsPower、Octo | Cookie 备份导入清空、全局书签、最常访问 | 每环境历史、下载、标签恢复 |
| 自动化 | AdsPower、Kameleo | 独立 Chrome 的本地 CDP pipe | 本地 API、可验证的任务闭环 |
| 同步操作 | AdsPower、Dolphin Anty、BitBrowser | 未实现 | 明确的主从控制与退出流程 |
| 扩展 | Octo、GoLogin | 专属指纹扩展 | 用户扩展库与配置 |
| 团队/云同步/权限 | AdsPower、GoLogin、Multilogin | 未提供远程服务 | 需要身份、服务端和加密同步；不得展示虚构团队 |
| 云浏览器/云手机/代理购买 | GoLogin、BitBrowser、Multilogin | 无此基础设施 | 需要外部服务，无法用本地 UI 替代 |
| TLS/DNS/字体/Worker/WebGPU 等内核信号 | 各厂商文档 | Electron/Chrome 原生内核，部分 JS 表面覆盖 | 需逐项测试；内核修改是独立研发范围 |

## 官方来源

- AdsPower 功能：https://www.adspower.com/
- AdsPower 配置：https://help.adspower.com/docs/creating_browser_profiles
- Multilogin 指纹：https://multilogin.com/help/en_US/profile-behavior-identity/profile-settings-fingerprint-section
- Multilogin 一致性：https://multilogin.com/help/browser-fingerprint-inconsistencies
- GoLogin 功能：https://gologin.com/features/
- Dolphin Anty 功能：https://dolphin-anty.com/
- Octo Browser 文档：https://docs.octobrowser.net/en/
- BitBrowser 功能：https://www.bitbrowser.net/
- Kameleo 开发引擎：https://kameleo.io/
- shadcn/ui 组件：https://ui.shadcn.com/docs/components/radix/dialog

核心顺序：先保证隔离、代理真实性与数据可靠，再扩充高频操作和自动化。实现与测试状态随每轮结果更新。
