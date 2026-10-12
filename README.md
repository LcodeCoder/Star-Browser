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

Star Browser 0.10.0 本轮通过 27 项单元测试、8 项任务导入导出专项、10 项本地任务、24 项 Electron/Chrome 回归、8 项同步、8 项备份和 11 项实际打包检查。新增任务选定导出、真实文件预览与独立导入、100 个任务/32 MB 范围校验、0600 文件权限、键盘取消返回焦点，以及网页截图暂时不可用时的受控重试。环境、代理、指纹检查、标签休眠、权限、扩展、本地 API 等既有能力及分轮证据见验证记录。

指纹处理包含页面 JavaScript 和 CDP 配置；此工程尚不提供内核级反检测保证、远程团队服务、云浏览器或代理购买服务。

安装包采用 ad hoc 签名；公开分发时仍需项目自己的 Apple Developer ID 和公证。
