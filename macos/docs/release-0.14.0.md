# Star Browser 0.14.0

## 这次交付

- 工作台增加 Cookie 管理页：分页、搜索、数量读取并发限制、失败重试、导入、导出和按真实成功数清除。
- 代理库支持批量导入与分配到环境，统一解析 HTTP、HTTPS、SOCKS5、IPv6 和 URL 编码凭据。
- 批量导入、代理保存、检测结果、删除和环境分配使用原子存储事务；磁盘失败会回滚内存、磁盘文件和工作记录，失败弹窗保留草稿并支持重试。
- 设置、书签、任务、代理和批量导入编辑器统一未保存修改保护、错误定位、忙碌状态和 Cmd/Ctrl+Enter 提交。
- 窄窗口和浅色/深色界面调整了列表滚动、底部操作区、菜单键盘操作和 Cookie 操作按钮的可见性。
- 增加代理导入单元测试、Cookie 工作台专项测试和代理工作台故障恢复专项测试。
- README 增加 Star Browser logo、下载入口、能力边界和验证链接。

## 验证

本版本工作区已完成：

- 76 项 Node 单元测试；
- 代理导入、Cookie 工作台和代理工作台专项测试；
- 源码语法检查、工作台编辑器、浏览器设置和书签回归；
- Chromium 补丁策略检查工具与独立策略测试。

Mac arm64 和 Windows x64 安装包由 `npm run build:mac` 与 `npm run build:win` 生成。Windows 交叉构建不替代真实 Windows 设备上的安装验收；macOS 当前使用 ad hoc 签名，未进行 Developer ID 公证。

## 指纹和内核范围

JS/CDP 层覆盖页面、iframe、Dedicated Worker、Shared Worker 和 Service Worker 的可配置读值，并保留默认原生图形、音频和几何信号。CreepJS 本地观测仍存在内存、屏幕可用尺寸和 Electron Worker 等已记录差异，结果不代表所有检测网站通过。

仓库保留了固定 Chromium 版本的最小补丁、锁文件和独立验收工具。定制 Chromium 仍需完整 Chromium checkout、GN/autoninja、Xcode/Windows 构建环境以及实际运行验收；在这些条件完成前，不宣称内核 P0 已完成。
