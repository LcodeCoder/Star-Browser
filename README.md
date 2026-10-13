# Star-Browser

Star Browser 是一个面向日常多环境工作的 macOS 浏览器项目：独立浏览环境、本地代理配置、稳定指纹参数与工作台。

当前工程位于 `macos/`。原始 Windows 安装包的资源通过 baoyu-skills-main / baoyu-electron-extract 提取与校验；原始文件保留在本机，版本库维护可构建源码。

```sh
cd macos
npm ci
npm run build:ui
npm start
npm test
npm run test:e2e
npm run build:mac
npm run test:package
```

构建目标为 macOS Apple Silicon。Intel 构建使用 `npm run build:mac:intel`，需要对应机器验证。

- [迭代计划](macos/docs/iteration-plan.md)
- [能力研究与实际范围](macos/docs/capabilities.md)
- [验证记录](macos/docs/verification.md)

Star Browser 0.11.0 本轮通过 27 项单元测试、9 项浏览器设置专项、24 项 Electron/Chrome 回归、15 项指纹专项、8 项标签专项、10 项本地任务检查、3 项反复休眠生命周期检查（20 次双环境唤醒）和 12 项实际打包检查。新增完整设置回填、代理草稿检测与明确保存、保存失败原配置保护、任务锁保护、新标签首脚本配置更新、键盘返回与浅深主题。已有任务导入导出、同步、备份、权限、扩展和本地 API 的分轮证据见验证记录。最终交付说明见 [0.11.0 交付记录](macos/docs/release-0.11.0.md)。

指纹处理包含页面 JavaScript 和 CDP 配置；此工程尚不提供内核级反检测保证、远程团队服务、云浏览器或代理购买服务。

安装包采用 ad hoc 签名；公开分发时仍需项目自己的 Apple Developer ID 和公证。


0.11.1 已完成 BrowserScan 兼容修复，本机原 macOS 环境由 75% 提升至 100%。默认原生图形音频、真实 Apple Silicon Client Hints 和缩减 UA 的范围及验证见 [0.11.1 交付记录](macos/docs/release-0.11.1.md)。

0.12.0 完成浏览器加载/停止与当前网页 DevTools 修复，工作台侧栏、搜索与详情流程、浅深主题及窄窗优化，新增手动 WebGL 配置和 Windows x64 构建。BrowserLeaks 的 Client Hints 请求头与 JS 已对齐，BrowserScan 本机复测 100%；DNS/IPv6 网络问题与 Windows 尚未真机验收的边界见 [0.12.0 交付记录](macos/docs/release-0.12.0.md)。
