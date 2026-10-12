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
