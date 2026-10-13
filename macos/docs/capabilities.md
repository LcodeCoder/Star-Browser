# 能力研究与实现状态

研究更新：2026-10-13。来源为官方功能页/帮助文档。以下为功能分类，商业厂商的检测保证不作为本项目结果。

| 分类 | 官方参考 | 本项目基线 | 待完善 |
| --- | --- | --- | --- |
| 环境隔离、稳定配置 | AdsPower、GoLogin | 独立 session/Chrome 数据目录、首脚本 JS/CDP、配置导入导出、带密码的加密数据备份与独立恢复 | 跨平台迁移、完整系统密钥数据 |
| 指纹参数 | Multilogin、BitBrowser | JS 参数、CDP UA/Client Hints/语言/原生时区/屏幕与像素比；页面、iframe、Dedicated/Shared/Service Worker 首脚本配置和实际检查 | 内置 OOPIF 原生 DPR/CSS、独立 Chrome OOPIF 屏幕尺寸 CSS、WebGPU 等边界 |
| 高频工作台 | GoLogin、Dolphin Anty | 搜索/分组/标签/详情、原子批量、置顶、归档、完整命令定位与一万环境分页 | 持续测量启动、后台资源与筛选性能 |
| 代理管理 | AdsPower、Octo Browser | HTTP/HTTPS/SOCKS5、鉴权网关、代理库/检测/分配/批量录入、真实协议和目标响应预检、取消与故障阻断 | 真实供应商与 IPv6 网络测试 |
| Cookie/书签/历史 | AdsPower、Octo | Cookie 备份导入清空、书签、每环境历史、标签恢复、真实下载控制与权限提示、Cookie/网页存储备份恢复 | 跨设备 Chrome 登录及系统密钥边界 |
| 自动化 | AdsPower、Kameleo | 独立 Chrome 的本地 CDP pipe、带密钥的本地 REST API、本地步骤编排/串行队列/取消/结果与截图 | 定时计划、复杂条件/循环和外部服务 |
| 同步操作 | AdsPower、Dolphin Anty、BitBrowser | 内置浏览器主控/跟随、可信点击/键盘/粘贴/滚动、地址跟随、暂停停止与窗口排列 | 系统输入法/对话框、文件选择和原生 Chrome 同步 |
| 扩展 | Octo、GoLogin | 用户扩展库、权限预览、每环境选择、自有副本与隔离存储 | Electron 仅支持扩展子集，任意扩展需单独验证 |
| 团队/云同步/权限 | AdsPower、GoLogin、Multilogin | 未提供远程服务 | 需要身份、服务端和加密同步；不得展示虚构团队 |
| 云浏览器/云手机/代理购买 | GoLogin、BitBrowser、Multilogin | 无此基础设施 | 需要外部服务，无法用本地 UI 替代 |
| TLS/DNS/字体/Worker/WebGPU 等内核信号 | 各厂商文档 | Electron/Chrome 原生内核；Dedicated/Shared/Service Worker 的配置一致性已验证，字体/插件/设备/语音使用真实对象 | WebGPU/TLS/DNS 保留内核信号；内核修改是独立研发范围 |

## 0.14.0 新增实现

- Cookie 工作台提供搜索、分页、数量读取队列、读取失败重试、导入、导出、确认清除和部分成功提示。
- 代理库提供批量文本导入、统一协议解析、归档环境过滤、分配失败重试和事务回滚；代理保存、检测结果与删除也保持内存、文件和活动记录一致。
- 编辑器共享未保存修改保护、错误关联、忙碌锁定和 Cmd/Ctrl+Enter 提交，窄窗下固定保存区保持可见；系统关窗和退出也保护工作台草稿。
- 批量标签可保留、追加、替换、清空；追加保留每个环境的原标签并去重，超限时整批不写入。
- 设置、任务和环境删除写盘失败时回滚；任务最终结果写盘失败时保留真实结果、暂停队列、支持重试并在退出前保护。
- 发行文件逐一核对安装程序/ZIP 内架构、版本及全部运行资源，过时包不能生成新的哈希清单。

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

历史观测（0.7.0，已由下方 JS/CDP 补齐记录更新）：Electron Shared/Service Worker 的 UA、语言、核心和内存保持原生，与页面配置可能不同；其时区继承环境设置。Chrome Shared Worker 本次所测字段一致，Service Worker 核心/内存保持真实硬件。未暂停或包装 Service Worker，避免拖慢网站注册；这些观测不代表所有后台上下文已覆盖。字体、插件、媒体设备、语音、音频采样率、WebGPU、TLS/DNS 均不能称为伪装后的内核信号。


## 标签管理与资源释放（0.8.0）

内置浏览器提供标签右键菜单、Shift+F10 与方向键操作，支持固定/取消固定、同组左右移动、静音、复制、关闭与恢复。标签固定、静音、休眠状态写入每环境会话；每窗口最多 50 个标签。手动休眠仅适用于后台 HTTP/HTTPS 标签，实际销毁网页 WebContents，保留地址、标题与环境存储；选择时重新创建网页，先准备环境配置再导航。

当前标签、加载中的网页、有可信输入标记、播放中的媒体、活动下载、任务/备份锁、窗口同步或 beforeunload 监听器的网页会保留并给出原因。保护基于可观察状态，不能保证所有网站的未保存状态。休眠会重新加载网页，不保证操作系统 RSS 立即下降；当前实现为手动休眠。

修复下载导航取消后的文档就绪状态，任务与同步不会使用尚未配置完成的初始空白页。


## 本机 Chrome 网页检查（0.9.0）

工作台读取所选环境 CDP 管道里的真实 HTTP/HTTPS 网页，显示标题与去掉查询/片段/账号信息的地址；多个网页时由用户选择，只有一个时自动选中。检查绑定实际 targetId，关闭/不可检查/加载/检查期间跳转给出错误；刷新列表可恢复，无网页显示空状态。环境详情优先读取正在运行的 Electron/Chrome 指纹，准确显示对应版本。已验证配置/网页与 Dedicated Worker 对照，Shared/Service Worker 的覆盖见下方 JS/CDP 补齐记录。

停止本机 Chrome 不再仅等待 CDP 通道关闭，还等待 Chrome 主进程实际退出；立即重开同环境已经本机验证。


## 本地任务定义备份与复用（0.10.0）

任务页提供搜索和选定导出，支持 1–100 个定义、最多 32 MB 的 Star Browser 格式版本 1 JSON。文件包含步骤及填入文本，原子替换并使用 0600 权限；界面明确文件包含范围。导入先读取真实文件并按步骤预览，确认后在一次事务里创建独立新 ID；不创建执行队列、不导入环境/旧 ID/执行记录。支持取消、错误文件、过期预览重新选择和重启持久。

预览令牌绑定发起窗口，10 分钟过期、关闭窗口或取消时释放；定义内容不进入执行/活动日志。导入文件不能代表其他商业浏览器的 RPA 格式兼容；当前支持 Star 自有定义。导出定义以明文 JSON 保存，环境数据的加密备份仍使用已有 .starbackup 流程。

任务截图最多重试 3 次暂时不可用的显示表面，保留取消/环境保护检查；持续失败给出准确提示，不生成代替真实页面的图像。


## 浏览器设置与反复休眠（0.11.0）

内置浏览器设置按页面与位置、网络连接、整理与备注、浏览数据与身份组织；设置正确回填原始起始页、国家、手动语言/时区、备注和标签。恢复自动只修改草稿，明确保存后重建当前标签；当前标签保留原网址，新的起始页配置用于后续启动。

代理检测读取当前输入，展示真实检测结果但不保存、不重建标签。保存先校验，再事务写入；失败保留原配置与草稿。运行任务/备份锁阻止修改，出口对齐在异步返回后再次检查状态和保护锁，保留用户固定语言/时区。保存后更新持久分区的运行配置，首个网页脚本已验证。

支持取消、Escape、Tab/Shift+Tab、返回入口焦点、加载和就地错误；保存栏固定可达。已实际验证 780px、浅深主题与减少动画，浏览器允许缩至 640×500。HTTPS 代理类型可编辑，实际此次网络专项覆盖 HTTP 与带鉴权 HTTP/SOCKS5；不把选项显示称为供应商 HTTPS 实测。

20 次双环境交替休眠/唤醒中，旧 guest 实际销毁，数量反复从 4 降至 3、恢复为 4，各自存储与首脚本时区保持。保留原始进程 CPU/内存采样，不据此宣称固定内存节省率。WebRTC 提供限制与保留模式，页面如实说明通话影响和保留模式 UDP 的网络边界。匿名统计当前关闭。


## BrowserScan 兼容修复（0.11.1）

Canvas、Audio、WebGL 和页面几何默认保留原生值，避免不同读取接口返回矛盾数据。已有明确的稳定覆盖配置仍保留，编辑界面说明覆盖可能被检测。原生模式会暴露真实图形与音频特征，不提供跨环境硬件指纹隔离。

UA 使用实际内核主版本的缩减格式（例如 Chrome/152.0.0.0），Client Hints 提供实际完整版本。旧预览中的 UA/版本不能覆盖运行时版本；由 CDP 管理的 UA、语言与 Client Hints 不再重复用页面 JavaScript 修改。macOS 环境的 Client Hints 在 Mac 宿主上使用实际系统版本和 ARM/x86 架构。

2026-10-12（America/Los_Angeles），本机 Apple M4 的原有 macOS 环境在 BrowserScan 中文首页从 75% 提升至 100%。这是该环境、该时间与该站点的实测结果，不代表跨平台模拟、所有检测站或内核级反检测保证。Windows/Android 配置运行在 Mac 上时仍有系统和硬件能力边界。

### 0.12.0 交互、请求头与 Windows

当前网页 DevTools 可通过菜单/F12/平台快捷键开启；加载进度独占工具栏下沿，按标签维护停止/刷新状态。工作台可折叠侧栏、命令定位、相邻详情切换与保留上下文返回；手动 WebGL 厂商/渲染器成对校验。平台原生 Client Hints 与 HTTP 头保持一致，高熵头按安全来源 Accept-CH 声明发送。

Windows 新环境默认平台、快捷键、字体、启动文案与本机 Chrome 版本读取已适配，x64 NSIS/ZIP 已交叉构建；无 Windows 真机执行证据。macOS Intel / Windows ARM64 为构建入口，Linux 未验收。此轮实测仍发现当前本机网络 DNS/IPv6 路径不一致，不能称作全网络防泄露。具体证据见 release-0.12.0.md。


## JS/CDP 上下文补齐（2026-10-13）

页面和 Worker 共用配置逻辑，UA/Client Hints、语言列表、默认 Intl 区域、时区和 CPU 使用支持的原生协议设置；设备内存以及协议未实际改变的 WorkerNavigator 值使用保留原生接收者与参数校验的 JS 覆盖。首次原生 UA 验证结果在同一调试 target 上保留，避免重复配置把旧 JS 值误认为协议支持。 安装器与配置保存在闭包中，重复注入通过进程随机事件更新运行时，页面和 Worker 不留固定的安装函数、状态或配置全局变量；代理凭据只留在扩展后台。

Electron 使用按 browserContextId 隔离的浏览器级连接捕获 Shared/Service Worker，页面连接捕获 Dedicated Worker、嵌套 Worker 和跨进程 iframe。Worker 在启动暂停期间配置后释放；Service Worker 的执行上下文重建、页面销毁、重新打开与休眠唤醒会重新应用配置。本机 Chrome 使用原有本地 CDP 管道，扩展后台不套用网站指纹。

内置浏览器为此启用随机端口的 **127.0.0.1 CDP**，应用退出关闭连接，不开放局域网监听。此端口属于浏览器调试接口，同一台电脑的其他进程仍可能连接；它不提供身份鉴权。DevTools 使用独立连接，关闭后恢复工作台检查连接。内置浏览器不能继续称为“完全不开放调试端口”。

Canvas 默认仍为原生；启用稳定策略时，2D Canvas/OffscreenCanvas 的 8 位读回按绝对像素位置分配确定性低位，重复读取、裁剪、导出和解码不会叠加扰动。音频直接读取和 copyFromChannel 对照一致，静音不引入信号。WebGL 只在启用选定标识时覆盖 vendor/renderer，保留原生参数校验；这不模拟完整 GPU。关闭 WebRTC 明确拒绝连接构造，保留模式返回真实连接与 RTCStatsReport；保留模式仍可能经 UDP 暴露真实公网出口。

工作台检查读取当前页面、临时 Dedicated Worker、同来源正在运行的 Shared/Service Worker，以及当前标签的跨进程 iframe。报告包含 Client Hints、上下文状态、协议错误和真实差异；未运行、读取失败和已观测的设备模拟限制不算通过。

**内置浏览器剩余限制：** 当前 Chromium 的设备模拟没有把自定义像素比传入跨进程 iframe widget。在本机 Electron 152 的 1.5 dppx 配置中，顶层页面和同进程 frame 为 1.5，跨进程 frame 仍为设备原生值（本轮为 2）；JS/CSS 分辨率读数保留在报告中，未用 JS 假装原生 CSS 已对齐。字体、媒体、语音、WebGPU、GPU 能力、HDR/宽色域读回、TLS/DNS/网络出口仍使用原生系统或网络信号。跨系统/移动设备声明不是完整设备模拟。

验证入口：`npm run test:fingerprint`（工作台与本机 Chrome 回归 + 无第二个浏览器 autoattach 的严格上下文测试）。证据与判定见 `docs/js-cdp-verification.md` 和 `test-results/fingerprint*.json`。本轮在 macOS Apple Silicon 执行；未宣称 Windows 真机验证或任意站点不可检测。


## 五小时窗口的新结果（2026-10-13）

环境编辑已完成连续分区与实时摘要，代理/任务/书签共用编辑保护；错误定位具体字段，保存失败保留草稿，整个对话框支持保存快捷键，浅深与窄窗经过真实交互检查。启动合并重复请求，进度和失败来自真实执行阶段；代理预检不再只看 TCP 端口。代理取消与网关退出不会遗留握手连接。

默认原生模式不安装无用的图形、音频、几何或已一致的 getter 包装。同一显式配置下，CreepJS 本地独立 Star Chrome lies 从 123 降为 21；普通 Chrome 为 0，内置 Electron 为 27。三组完成观测，仍有必要 JS fallback 和屏幕差异，不宣称全项检测通过。Worker 语义按独立原生进程对照验证。详细证据见 `js-cdp-verification.md`。

独立 Chrome 已用现有原生缩放参数解决 1.5 / 1.25 DPR 的 OOPIF CSS resolution 差异，双进程隔离和重启通过；OOPIF 自定义屏幕尺寸 CSS 仍为部分。内置 Electron 的 DPR 限制继续保留。

原生 CPU/RAM/内存头与屏幕策略已准备两组小范围补丁，固定版本与指定主线提交可应用，独立 C++ 策略测试通过。原生硬件启动入口要求完整发行包哈希及真实验收报告，未验收明确失败；屏幕策略尚不接入日常启动。**未完整编译或验收定制 Chromium，内核 P0 未完成。** 不将补丁准备计作运行能力，详见仓库 `kernel/README.md`。
