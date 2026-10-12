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

macOS 移植基线已通过 17 项 Electron/Chrome 端到端检查及 4 项真实打包检查。Star 品牌与新工作台正在连续实现，新改动以对应验证记录为准。

指纹处理包含页面 JavaScript 和 CDP 配置；此工程尚不提供内核级反检测保证、远程团队服务、云浏览器或代理购买服务。

安装包采用 ad hoc 签名；公开分发时仍需项目自己的 Apple Developer ID 和公证。
