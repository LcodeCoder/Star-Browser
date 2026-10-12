# 能力研究与实现状态

研究日期：2026-10-12。来源为官方功能页/帮助文档。以下为功能分类，商业厂商的检测保证不作为本项目结果。

| 分类 | 官方参考 | 本项目基线 | 待完善 |
| --- | --- | --- | --- |
| 环境隔离、稳定配置 | AdsPower、GoLogin | 独立 session/Chrome 数据目录、首脚本 JS/CDP、配置导入导出、带密码的加密数据备份与独立恢复 | 跨平台迁移、完整系统密钥数据 |
| 指纹参数 | Multilogin、BitBrowser | JS 参数、CDP UA/Client Hints/语言/原生时区/屏幕与像素比、Dedicated Worker 首脚本、网页检查报告与覆盖开关 | Shared/Service Worker、WebGPU 等原生边界 |
| 高频工作台 | GoLogin、Dolphin Anty | 搜索/分组/标签/详情、原子批量、置顶、归档、完整命令定位与一万环境分页 | 持续测量启动、后台资源与筛选性能 |
| 代理管理 | AdsPower、Octo Browser | HTTP/HTTPS/SOCKS5、鉴权网关、代理库/检测/分配/批量录入、故障阻断 | 真实供应商与 IPv6 网络测试 |
| Cookie/书签/历史 | AdsPower、Octo | Cookie 备份导入清空、书签、每环境历史、标签恢复、真实下载控制与权限提示、Cookie/网页存储备份恢复 | 跨设备 Chrome 登录及系统密钥边界 |
| 自动化 | AdsPower、Kameleo | 独立 Chrome 的本地 CDP pipe、带密钥的本地 REST API、本地步骤编排/串行队列/取消/结果与截图 | 定时计划、复杂条件/循环和外部服务 |
| 同步操作 | AdsPower、Dolphin Anty、BitBrowser | 内置浏览器主控/跟随、可信点击/键盘/粘贴/滚动、地址跟随、暂停停止与窗口排列 | 系统输入法/对话框、文件选择和原生 Chrome 同步 |
| 扩展 | Octo、GoLogin | 用户扩展库、权限预览、每环境选择、自有副本与隔离存储 | Electron 仅支持扩展子集，任意扩展需单独验证 |
| 团队/云同步/权限 | AdsPower、GoLogin、Multilogin | 未提供远程服务 | 需要身份、服务端和加密同步；不得展示虚构团队 |
| 云浏览器/云手机/代理购买 | GoLogin、BitBrowser、Multilogin | 无此基础设施 | 需要外部服务，无法用本地 UI 替代 |
| TLS/DNS/字体/Worker/WebGPU 等内核信号 | 各厂商文档 | Electron/Chrome 原生内核；Dedicated Worker 已验证，Shared/Service 保留边界，字体/插件/设备/语音使用真实对象 | WebGPU/TLS/DNS 保留内核信号；内核修改是独立研发范围 |

## 本轮实现

- 环境工作台：主从详情、搜索、分组/标签筛选、置顶、复制、批量、归档恢复、配置导入预览与导出。
- 代理库：HTTP/HTTPS/SOCKS5、文本导入、检测结果保存、分配；连接不可用时阻止环境启动。
- 浏览器：Star 图标与浅深主题、环境/网络标识、本地新标签页、页内查找、缩放、标签搜索、关闭恢复、会话恢复、每环境历史。
- 指纹一致性：使用实际 Chromium/Chrome 版本、CDP UA/Client Hints/时区/语言覆盖、硬件手动设置校验。JavaScript 覆盖仍有能力边界。
- 存储：原子写入、备份恢复、损坏文件保留、历史去重与延迟保存。

新增闭环以 verification.md 的对应测试记录为准。0.4.0 的加密环境备份、扩展管理、本地 API、网站权限和大规模性能已完成专项验证；主从同步已完成专项验证，更多指纹信号与本地任务继续迭代。

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


## 性能与下载补充

环境批量操作、环境/代理导入使用事务与一次保存；一万环境工作台、命令定位与短标记快照已通过实测。下载的暂停、继续、取消和重启中断状态已验证。浏览器图标完全本地生成。详见 verification.md。


本地任务（0.6.0）：保存 1–50 步，打开 HTTP/HTTPS 网页、等待 CSS 元素、真实点击、填写文本、按键、滚动、等待与截图。选择 1–50 环境串行执行，总活动队列最多 100；环境修改与同步冲突受保护。取消、超时、窗口关闭、标签切换与重启中断均提供真实结果。文本仅在本机任务定义中保存，执行记录与活动日志不记录填入文本。截图文件权限 0600，结果记录保留最近 200 条并保护活动任务。当前不包含条件/循环、跨 iframe 定位、上传/系统对话框、云模板、调度、原生 Chrome 任务或团队权限。


指纹与网页兼容（0.7.0）：首次远程导航等待环境原生配置完成；并行不同环境、跨站导航首脚本时区已测。日期/Intl/Temporal 使用原生实现，明确传入的 UTC 与语言不会被覆盖；屏幕和像素比与 CSS 媒体查询同步。Dedicated Worker 的 UA、Client Hints、语言、核心和内存在首次脚本前配置。Canvas、音频、WebGL 可切换稳定覆盖/原生值，页面几何默认原生；重复安装不叠加，AudioBuffer 重复读取不累计噪声。实际网页检查按网页/CSS/Worker 分组，列出差异/未读取/原生项，并可复制报告，不提供检测分数。

本机此次观测：Electron Shared/Service Worker 的 UA、语言、核心和内存保持原生，与页面配置可能不同；其时区继承环境设置。Chrome Shared Worker 本次所测字段一致，Service Worker 核心/内存保持真实硬件。未暂停或包装 Service Worker，避免拖慢网站注册；这些观测不代表所有后台上下文已覆盖。字体、插件、媒体设备、语音、音频采样率、WebGPU、TLS/DNS 均不能称为伪装后的内核信号。


## 标签管理与资源释放（0.8.0）

内置浏览器提供标签右键菜单、Shift+F10 与方向键操作，支持固定/取消固定、同组左右移动、静音、复制、关闭与恢复。标签固定、静音、休眠状态写入每环境会话；每窗口最多 50 个标签。手动休眠仅适用于后台 HTTP/HTTPS 标签，实际销毁网页 WebContents，保留地址、标题与环境存储；选择时重新创建网页，先准备环境配置再导航。

当前标签、加载中的网页、有可信输入标记、播放中的媒体、活动下载、任务/备份锁、窗口同步或 beforeunload 监听器的网页会保留并给出原因。保护基于可观察状态，不能保证所有网站的未保存状态。休眠会重新加载网页，不保证操作系统 RSS 立即下降；当前实现为手动休眠。

修复下载导航取消后的文档就绪状态，任务与同步不会使用尚未配置完成的初始空白页。


## 本机 Chrome 网页检查（0.9.0）

工作台读取所选环境 CDP 管道里的真实 HTTP/HTTPS 网页，显示标题与去掉查询/片段/账号信息的地址；多个网页时由用户选择，只有一个时自动选中。检查绑定实际 targetId，关闭/不可检查/加载/检查期间跳转给出错误；刷新列表可恢复，无网页显示空状态。环境详情优先读取正在运行的 Electron/Chrome 指纹，准确显示对应版本。已验证配置/网页与 Dedicated Worker 对照，仍保留 Shared/Service Worker 等原生边界。

停止本机 Chrome 不再仅等待 CDP 通道关闭，还等待 Chrome 主进程实际退出；立即重开同环境已经本机验证。


## 本地任务定义备份与复用（0.10.0）

任务页提供搜索和选定导出，支持 1–100 个定义、最多 32 MB 的 Star Browser 格式版本 1 JSON。文件包含步骤及填入文本，原子替换并使用 0600 权限；界面明确文件包含范围。导入先读取真实文件并按步骤预览，确认后在一次事务里创建独立新 ID；不创建执行队列、不导入环境/旧 ID/执行记录。支持取消、错误文件、过期预览重新选择和重启持久。

预览令牌绑定发起窗口，10 分钟过期、关闭窗口或取消时释放；定义内容不进入执行/活动日志。导入文件不能代表其他商业浏览器的 RPA 格式兼容；当前支持 Star 自有定义。导出定义以明文 JSON 保存，环境数据的加密备份仍使用已有 .starbackup 流程。

任务截图最多重试 3 次暂时不可用的显示表面，保留取消/环境保护检查；持续失败给出准确提示，不生成代替真实页面的图像。
