# Star Browser 0.11.1

2026-10-12（America/Los_Angeles），在本机 Apple M4 上，用用户原有 macOS 环境实际访问 BrowserScan。真实度从 75% 经中间验证 90% 提升到 100%；原先 WebGL 异常、厂商不同、Audio 异常、Canvas 篡改、浏览器版本不同的提示消失。

修复包括：默认保留 Canvas / Audio / WebGL / ClientRects 原生读值；保留明确选择的稳定覆盖；UA 使用真实 Chromium 主版本的缩减格式；Client Hints 使用真实完整版本、Apple Silicon 架构与宿主系统版本；避免重复重写 CDP 已管理的接口。

当轮验证：29 项单元、16 项指纹通过（另有 2 项观察到的边界）、9 项浏览器设置、24 项 E2E、12 项实际 macOS 包检查。证据在 test-results/star-0.11.1/。最终 100% 已在实时 UI 确认，截图曾在会话中展示；未保存为独立本地截图。

这只是特定机器、配置和当时网站的检测结果。原生图形保留真实硬件；改变系统字符串不等于改变实际系统、显卡或网络出口。后续 0.12.0 的 BrowserLeaks、交互和 Windows 工作见 release-0.12.0.md。
