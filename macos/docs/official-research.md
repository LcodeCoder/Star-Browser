# 官方功能研究与实现选择

研究时间：2026-10-13（东八区）。实际获取官方页面，读取产品功能、帮助目录和组件/API 文档。抓取结果保存在本机 test-results/official-research.json；广告描述与检测保证不作为 Star 的测试结论。

| 官方来源 | 可确认的功能分类 | Star 的实现方向 |
| --- | --- | --- |
| [GoLogin Features](https://gologin.com/features/) | 环境创建启动、复制重命名、批量操作、代理、标签/分组、导入导出、同步操作、Cookie、扩展、API/自动化，以及远程团队/云启动 | 本地环境管理、可验证的数据操作、代理库、自动化入口优先；云能力需要独立服务 |
| [Octo Browser 文档](https://docs.octobrowser.net/en/) | 环境设置和启动、代理类型/代理管理器、Cookie 导入导出、API、Puppeteer、一次性环境 | 在应用内形成配置→启动→浏览→保存/恢复的完整路径，并补本地 API |
| [shadcn/ui Dialog](https://ui.shadcn.com/docs/components/radix/dialog) | Radix Dialog 的组合、焦点、标题和说明 | 采用 Radix Dialog/Dropdown/Tabs、cmdk 命令搜索，统一 Star 的紧凑样式 |
| [Magic UI Animated Theme Toggler](https://magicui.design/docs/components/animated-theme-toggler) | View Transitions API、主题切换来源与形状 | 评估主题反馈；当前优先即时切换与 reduced-motion，避免大面积动画阻挡高频操作 |
| [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents) | findInPage/found-in-page、缩放、导航、页面事件、WebRTC 策略 | 用真实浏览内容执行查找、缩放、页面恢复和错误反馈 |
| [Chrome DevTools Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/) | UA/Client Hints、语言/时区和硬件协议覆盖 | 版本与真实运行内核对齐；同时验证页面首脚本和网络请求 |

AdsPower features 页面此次返回的内容不足以读取功能细节，不能把该抓取算作成功研究。初始能力分类还参考了产品帮助页的既有记录；本表只列此次实际取得可读内容的来源。

完整功能的依赖不同：本地桌面可以实现环境隔离、代理接入、数据管理、扩展、批量操作和本地自动化；团队身份/权限、云同步、云浏览器、代理销售需要真实的远程基础设施。TLS/DNS、字体栈、Worker、WebGPU 等信号不能用页面 JavaScript 一次性替代。每一项以具体实现和实际测试为准。


## 权限、下载与工作台组件补充

2026-10-13 03:30（东八区）实际读取：

- Electron Session：https://www.electronjs.org/docs/latest/api/session 。权限检查与请求处理需要一起设置；检查中返回允许会直接授予权限。用于修正“询问”流程。
- Electron DownloadItem：https://www.electronjs.org/docs/latest/api/download-item 。读取暂停/继续、已接收字节与完成事件，用真实文件验证下载。
- Aceternity Sidebar：https://ui.aceternity.com/components/sidebar 。评估其侧栏交互；Star 保持稳定宽度与显式操作，避免高频工作时悬停扩展推挤内容。
- Origin UI：https://originui.com/ 。此次官方页面已转向 coss ui / Base UI；作为组件交互参考，当前继续使用已验证的 Radix 组件。
- Octo 的 /en/extensions/ 返回 404，不能作为扩展功能的可读依据；后续通过官方目录查找有效页面。

抓取与失败结果保存在 test-results/privacy-performance-research.json。


## 扩展与自动化 API 补充

2026-10-13 04:05（东八区）读取官方来源：

- GoLogin 扩展说明：https://support.gologin.com/en/articles/14403048-browser-extensions-overview 。扩展按环境配置，扩展设置独立；Star 的扩展库以自有副本、环境选择与实际存储隔离实现。
- GoLogin API：https://api.gologin.com/docs 。包含环境 CRUD、批量、扩展、书签和 Cookie 资源；Star 先提供本机环境 CRUD/启动/停止/复制 API，不借用厂商云服务。
- Octo 官方目录：https://docs.octobrowser.net/llms.txt 。成功找到 Profiles、Proxies、Teams、Fingerprint 与 Local Client API 文档入口；先前失效扩展路径不作为依据。
- Electron 扩展支持：https://www.electronjs.org/docs/latest/api/extensions 。只支持 Chrome 扩展子集且只加载已解压扩展；每次启动需重新加载。Star 内置模式明确此边界，测试扩展已在 Electron 与本机 Chrome 实际运行。
- Electron Session：https://www.electronjs.org/docs/latest/api/session 。权限 check/request 联合处理；请求来源用于提示，明确拒绝或允许。

完整云同步和团队身份依然需要服务端，当前未提供。下一轮优先本地任务与可恢复数据工作流，不能以本地占位界面称为云服务。


## 备份恢复与同步研究

2026-10-13 04:27（东八区）成功取得并阅读 Node crypto https://nodejs.org/api/crypto.html 、Electron Session https://www.electronjs.org/docs/latest/api/session 、Chrome Manifest key https://developer.chrome.com/docs/extensions/reference/manifest/key 、AdsPower Synchronizer https://help.adspower.com/docs/synchronizer 与 Octo 官方目录 https://docs.octobrowser.net/llms.txt 。抓取证据：test-results/backups-research.json。

备份使用 scrypt、AES-GCM、随机 salt/nonce 与认证头，流式压缩，解密完整验证后才恢复；已测试错误密码、篡改、路径越界、重复与超限。Chrome key 用于稳定扩展身份，自有扩展副本缺 key 时生成独立 RSA 公钥，不上传开发者后台。AdsPower 的主窗口/受控窗口模型用于下一轮同步交互参考，功能状态仍以实际实现和测试为准。


同步实现参考 AdsPower Synchronizer 的主控/受控模型，读取 Electron WebContents https://www.electronjs.org/docs/latest/api/web-contents 、CDP Input https://chromedevtools.github.io/devtools-protocol/tot/Input/ 和 Electron Clipboard https://www.electronjs.org/docs/latest/api/clipboard 。实际以 before-mouse-event/before-input-event、可信粘贴/滚轮 preload 与 CDP Input 转发，保护仅选定环境、当前网页范围。剪贴板按最新官方 Promise API 等待完成。证据在 test-results/sync-research.json。


## 本地任务与配置一致性研究

2026-10-13 05:03（东八区）通过在线搜索读取 AdsPower RPA https://help.adspower.com/docs/rpa 与 Octo Browser 设置 https://docs.octobrowser.net/en/profiles/browser-profile-settings/ 。RPA 文档包含流程编排、搜索、立即执行与任务日志；Star 当前实现本地步骤、环境选择、串行队列、取消、错误与截图，不包含云模板分享、团队权限和定时任务。Octo 文档分别提供 Canvas、Audio、Client Rects 等开关，并提示页面几何修改可能影响网站；下一轮逐项验证真实值与稳定性，优先避免干扰页面功能。


## 0.7.0 原生语义与后台上下文

2026-10-13 05:38（东八区）：通过在线检索读取 Chrome DevTools Protocol 的 Emulation/Target/Runtime、Electron Debugger，以及 Octo Browser 的环境设置文档。参考链接：

- https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- https://chromedevtools.github.io/devtools-protocol/tot/Target/
- https://www.electronjs.org/docs/latest/api/debugger
- https://docs.octobrowser.net/en/profiles/browser-profile-settings/

采用 CDP 原生时区和屏幕/像素比配置，保留日期/Intl 明确参数的原生行为；通过 flatten sessionId 在 Dedicated Worker 脚本执行前配置。Worker 配置有有限超时且 finally 恢复执行。当前 Electron Shared/Service Worker 无法通过此 guest 路径完整配置；Chrome Service Worker 暂停后 Runtime 求值超时，因此保留原生实现并记录真实差异，未把它算作一致能力。Octo 的分项开关用于配置工作流参考，Star 的稳定覆盖范围仍由实际测试界定。


## 后台标签与资源管理（0.8.0）

- Google Chrome 性能设置：https://support.google.com/chrome/answer/12929150?hl=en — 官方列出后台标签停用、访问时重新加载，以及媒体、下载、部分填写表单等保护情形。Star 使用手动休眠并提供真实网页对象释放和可观察状态保护，不将 Chrome 完整 Memory Saver 或内核能力列为本项目已实现。
- Electron WebContents：https://www.electronjs.org/docs/latest/api/web-contents — close/destroyed 用于验证实际网页生命周期；文档说明 BrowserView 的 beforeunload 生命周期有特殊限制。实际内嵌 guest 测试据此采取关闭前原生监听器检查，不能仅依赖 will-prevent-unload 来保护网页。did-stop-loading 用于下载导航取消后恢复就绪。

访问日期：2026-10-12。具体实现及 8 项标签专项、9 项安装包证据见 verification.md。


## 多标签真实检查（0.9.0）

CDP Target/Runtime 官方协议：https://chromedevtools.github.io/devtools-protocol/tot/Target/ 、https://chromedevtools.github.io/devtools-protocol/tot/Runtime/ 。使用 Target.getTargets/getTargetInfo 与已有页面 sessionId 读取指定网页，不推测哪个 Chrome 窗口处于前台。检查使用 Runtime.evaluate 读取当前网页。访问日期：2026-10-12；本机协议与真实 Chrome 测试共同确认行为。


## 任务复用与真实截图（0.10.0）

本地任务定义复用参考此前 AdsPower RPA 与官方自动化功能分类；当前 JSON 为 Star 自有版本 1，不声称外部厂商格式兼容。Electron capturePage 官方实现：https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_web_contents.cc ，API：https://www.electronjs.org/docs/latest/api/web-contents 。截图依赖真实显示表面，使用 stayAwake 选项和受控短暂失败重试；不能将加载完成当作任何显示表面必定可捕获的保证。访问日期：2026-10-12。


## Simprint、GoLogin 与原生硬件一致性（2026-10-13）

- 用户指定 https://github.com/Simprint/simprint ，研究提交 d2dc939bfae8efda8e4e4d791587d7a364ca4dd8。查看连续环境列表、创建页分区导航、配置摘要、内核校验与配置映射。选取信息组织和交互思路，在 Star 独立实现；其 AGPL 代码未复制进本项目。配置列表不证明对应内核运行行为。
- GoLogin 官方下载页 https://gologin.com/download/ ，arm64 DMG SHA-256 f681f9b0921ad7e841dd193b8025a86ffda5aed699a6f8e8febdf89918a5a138。使用项目中的 baoyu-electron-extract skill 提取 153 个来源文件，阅读启动准备检查与错误分类；仅用于研究，未运行厂商应用或复制专有实现。公开 SDK 提交 40329508d12965409a5539f8e7b1f6a2492d30bb。研究挂载已经卸载。
- https://github.com/abrahamjuliot/creepjs ，研究提交 10aa6724cd33a1015db1574211890518cd04f0cc 的 Worker API 和跨上下文校验结构。尚未将外站分数当作完整能力证明。
- Chromium 固定提交 cfaadc5a132d78e1828635aa8405a499f3e14864 的 content/browser/client_hints/client_hints.cc：两类内存头读取 ApproximatedDeviceMemory::GetApproximatedDeviceMemory()，因此原生策略选取共用读取点。实际普通 Chrome 155 对照读到并发送 16 GB，页面层配置 2 GB 无法改变该网络值。
- Chromium 主线解析为 a7a39438107ea6753993b2a6519d25c1b809b3d1（158.0.8104.0），只读检查发现第三方 Blink common BUILD.gn 的测试清单上下文冲突；缩小依赖上下文后可应用。仍须完整编译和原生运行验收。

研究文件位于 /tmp/star-research-20261013，不进入发行包。当前实际设计、测试和限制以本项目专项报告为准。
