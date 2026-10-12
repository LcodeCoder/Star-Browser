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

Star Browser 0.9.0 本轮通过 24 项单元测试、8 项标签专项、15 项指纹一致性检查、24 项 Electron/Chrome 端到端检查和 10 项真实打包检查。新增本机 Chrome 多网页选择检查、准确运行配置、关闭网页的重试与空状态，以及等待实际 Chrome 进程退出的停止操作。已有环境管理、代理、权限、扩展、本地 API、加密备份、窗口同步、本地任务、标签固定/静音/手动休眠；各专项验证时间及实际边界见验证记录。

指纹处理包含页面 JavaScript 和 CDP 配置；此工程尚不提供内核级反检测保证、远程团队服务、云浏览器或代理购买服务。

安装包采用 ad hoc 签名；公开分发时仍需项目自己的 Apple Developer ID 和公证。
