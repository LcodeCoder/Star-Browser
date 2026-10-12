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
