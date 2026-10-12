# 能力研究与实现状态

研究日期：2026-10-12。来源为官方功能页/帮助文档。以下为功能分类，商业厂商的检测保证不作为本项目结果。

| 分类 | 官方参考 | 本项目基线 | 待完善 |
| --- | --- | --- | --- |
| 环境隔离、稳定配置 | AdsPower、GoLogin | 独立 session/Chrome 数据目录、首脚本 JS/CDP、配置导入导出与 Cookie 备份 | 完整数据迁移、存储加密 |
| 指纹参数 | Multilogin、BitBrowser | JS 参数与 CDP UA/Client Hints/语言/时区，实际内核版本，硬件校验 | Worker/WebGPU 等逐项验证、内核边界 |
| 高频工作台 | GoLogin、Dolphin Anty | 搜索/分组/标签/详情、批量、置顶、归档与快捷键 | 大规模列表性能和完整命令定位 |
| 代理管理 | AdsPower、Octo Browser | HTTP/HTTPS/SOCKS5、鉴权网关、代理库/检测/分配/批量录入、故障阻断 | 真实供应商与 IPv6 网络测试 |
| Cookie/书签/历史 | AdsPower、Octo | Cookie 备份导入清空、书签、每环境历史、标签恢复 | 下载与权限专项闭环 |
| 自动化 | AdsPower、Kameleo | 独立 Chrome 的本地 CDP pipe | 本地 API、可验证的任务闭环 |
| 同步操作 | AdsPower、Dolphin Anty、BitBrowser | 未实现 | 明确的主从控制与退出流程 |
| 扩展 | Octo、GoLogin | 专属指纹扩展 | 用户扩展库与配置 |
| 团队/云同步/权限 | AdsPower、GoLogin、Multilogin | 未提供远程服务 | 需要身份、服务端和加密同步；不得展示虚构团队 |
| 云浏览器/云手机/代理购买 | GoLogin、BitBrowser、Multilogin | 无此基础设施 | 需要外部服务，无法用本地 UI 替代 |
| TLS/DNS/字体/Worker/WebGPU 等内核信号 | 各厂商文档 | Electron/Chrome 原生内核，部分 JS 表面覆盖 | 需逐项测试；内核修改是独立研发范围 |

## 本轮实现

- 环境工作台：主从详情、搜索、分组/标签筛选、置顶、复制、批量、归档恢复、配置导入预览与导出。
- 代理库：HTTP/HTTPS/SOCKS5、文本导入、检测结果保存、分配；连接不可用时阻止环境启动。
- 浏览器：Star 图标与浅深主题、环境/网络标识、本地新标签页、页内查找、缩放、标签搜索、关闭恢复、会话恢复、每环境历史。
- 指纹一致性：使用实际 Chromium/Chrome 版本、CDP UA/Client Hints/时区/语言覆盖、硬件手动设置校验。JavaScript 覆盖仍有能力边界。
- 存储：原子写入、备份恢复、损坏文件保留、历史去重与延迟保存。

新增闭环以 verification.md 的对应测试记录为准。扩展管理、本地 API、同步操作和大规模性能继续迭代。

本轮可读官方研究见 [official-research.md](official-research.md)。

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
