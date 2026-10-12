# 实际验证

2026-10-12：macOS arm64 基线通过。

- 8 项单元测试：存储 CRUD、持久化、手动语言时区、书签访问、确定性指纹、代理解析、SOCKS 分片握手和错误密码。
- 17 项 Electron/本机 Chrome 端到端检查：原界面创建编辑搜索、首脚本指纹、Cookie/localStorage 隔离和持久化、Cookie 导入导出、书签、弹窗标签与 Command 快捷键、HTTP 与 HTTP/SOCKS5 鉴权转发、模拟出口 IP 国家/时区与批量检测、外部 Chrome 扩展、Dock 恢复、运行无页面异常。
- 4 项实际打包检查：完整 codesign 校验、isPackaged 启动、asar 资源与动态 preload、Cookie/IPC。

基线证据保存于 test-results/baseline-macos/。新的 Star 改动需重新验证，不能沿用旧截图宣称通过。

本地测试验证特定可观察行为；未验证公众检测站评分、真实代理供应商、内核级反检测、Developer ID 公证、远程团队服务。ad hoc 签名不是 Apple Developer ID 签名。

## Star 工作台第一轮

2026-10-13 02:52（东八区）：React 工作台构建通过，8 项单元测试与 17 项真实 Electron/Chrome 回归全部通过。测试涵盖新界面创建、编辑、搜索、指纹详情以及原有隔离、代理、Cookie、原生快捷键。修复悬停操作按钮的点击阻断与菜单监听器重复注册。

证据：test-results/e2e.json、management.png、runtime.log。旧基线保存在 baseline-macos/。工作台新增批量、归档、代理库等闭环正在补充专项验证；此记录不将尚未测试的功能算作通过。Star 新安装包尚待本轮浏览器改进后重建。
