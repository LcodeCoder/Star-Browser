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


## Star 工作台与浏览器 0.2.0

2026-10-13 03:23（东八区）：14 项单元测试、23 项真实 Electron/本机 Chrome 回归和 4 项打包应用检查全部通过。安装包为 Star-Browser-0.2.0-mac-arm64.dmg，实际应用为 dist/mac-arm64/Star Browser.app。

- 工作台专项：环境详情、置顶、独立复制、归档恢复、JSON 导入预览与确认、代理添加检测分配、命令搜索、浅深主题、离线提示和窄窗口返回。
- 浏览器专项：标签与活动页恢复、关闭标签恢复、真实页内查找与缩放、每环境历史、浏览器主题。
- 指纹专项：首文档覆盖、真实 Electron/Chrome 内核版本与 User-Agent 对齐、Client Hints 原型及完整版本一致性；本机 Chrome 安全上下文单独核验。
- 网络与数据：HTTP、账号密码 HTTP/SOCKS5 实际转发、故障代理阻止启动、环境 Cookie/localStorage 隔离与重启持久化、存储损坏恢复和输入校验。代理地理检测使用本地模拟服务。
- 打包专项：codesign --deep --strict、实际 isPackaged 启动、asar 内资源及动态 preload、Cookie/IPC；签名为 ad hoc。

本轮证据独立保存于 test-results/star-0.2.0/，含 e2e.json、package-smoke.json、工作台/浏览器浅深与窄窗口截图。实际 E2E 完成时间为 UTC 2026-10-12 19:19:14，打包检查为 UTC 19:23:19。

23 项回归不覆盖所有新增功能：下载真实文件、站点权限流程、大规模性能、用户扩展与本地 API 将单独实现和验证。
