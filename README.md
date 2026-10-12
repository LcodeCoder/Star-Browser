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

Star Browser 0.8.0 本轮通过 24 项单元测试、8 项浏览器标签专项、11 项指纹一致性检查、24 项 Electron/Chrome 端到端检查、8 项加密备份恢复、8 项窗口同步、9 项本地任务和 9 项真实打包检查。新增标签固定、同组排序、静音、复制与手动后台休眠，唤醒保留环境存储，输入、媒体、下载、任务和同步操作有休眠保护。已有 Star 星形图标、浅深主题工作台、批量环境管理、代理库、会话恢复、下载控制、网站权限、独立扩展库、本地 API、加密备份、窗口同步、本地任务和可复制的真实网页检查；各专项验证时间及实际边界见验证记录。

指纹处理包含页面 JavaScript 和 CDP 配置；此工程尚不提供内核级反检测保证、远程团队服务、云浏览器或代理购买服务。

安装包采用 ad hoc 签名；公开分发时仍需项目自己的 Apple Developer ID 和公证。
