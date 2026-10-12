# Star Browser for macOS

主工作台使用 React、Radix UI、cmdk 和 Lucide，界面资源在构建时打包，运行时不依赖在线组件服务。浏览器使用 Electron 内置 Chromium；也可启动独立的本机 Chrome。

```sh
npm ci
npm start
npm test
npm run test:e2e
npm run build:mac
npm run test:package
```

安装依赖遇到本机 npm 缓存权限问题时，可用 `npm ci --cache .test-data/npm-cache`。Apple Silicon 构建输出在 dist/。Intel 构建使用 build:mac:intel，需要 Intel 机器验证。

测试使用临时用户目录、本地 HTTP/SOCKS 服务与本地模拟地理接口。不会读取日常浏览数据。test-results/、dist/、node_modules/、.test-data/ 不提交到 Git。

源码来自用户提供的 Windows 安装包，使用项目内 baoyu-electron-extract 技能提取。`npm run verify:source` 需要本机保留的原始 asar 与 installer-verification.json，用于逐文件追溯；公开仓库不包含原安装包和提取证据。

功能与已知边界见 docs/capabilities.md；实际测试记录见 docs/verification.md。安装包当前采用 ad hoc 签名。

0.7.0 增加原生日期与屏幕一致性、Dedicated Worker 首脚本配置、稳定/原生策略，以及可复制的真实网页检查；详细边界见能力与验证文档。
