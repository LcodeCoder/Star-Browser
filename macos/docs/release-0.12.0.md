# Star Browser 0.12.0

本轮日期：2026-10-12（America/Los_Angeles；测试 JSON 使用 UTC，部分为 2026-10-13）。基于真实 Electron 页面、打包应用与 BrowserLeaks / BrowserScan 实测完成。

## 浏览器与工作台

- 加载圈原来绝对定位在工具栏 left:150px，覆盖收藏夹。现在加载反馈独占工具栏下沿，不移动按钮；刷新切换为停止，每个标签维护自己的状态。加载初期地址栏立即显示当前目标，避免沿用上一标签地址；无标题网页优先显示域名。
- “更多浏览操作 → 开发者工具”、F12、macOS ⌘⌥I、Windows Ctrl+Shift+I 打开当前网页的 DevTools。菜单及快捷键覆盖外壳与 guest 焦点；关闭工具后恢复协议会话，清理旧目标监听和注入脚本。DevTools 获焦时关闭命令关闭工具窗口。
- 实测在 DevTools 开启时刷新网页，语言和时区仍一致，协议连接仍在。实际 CUA 打开 BrowserLeaks 的 Elements/Console/Network 面板；本地保存 devtools.png。
- 中性底色、星蓝强调色、统一浅深主题及系统字体。现有 Radix Dialog / Menu / Tabs 与 cmdk 适配 shadcn 风格的收起侧栏、命令搜索及主从详情，覆盖全部现有工作页。没有增加装饰卡片或自动播放动效。
- 侧栏收起偏好保存在本机；窄侧栏的按钮保留名称和提示。详情支持相邻对象切换，返回保留搜索与列表焦点；工作空间入口打开设置。640px 浏览器仍保留后退、前进、刷新与地址栏。
- 验证了搜索零结果、全部页面导航、详情返回、命令搜索、离线与恢复、加载/停止、网页错误/重试入口、浅深主题、窄窗口、减少动态效果和表单保存。

## 手动配置

入口：环境列表的编辑按钮 → “指纹、硬件与网站权限”。语言和时区可手动指定；高级区可设核心数、内存、像素比、屏幕宽高、Canvas/Audio/WebGL/页面几何策略、WebRTC 与网站权限。选择 WebGL 稳定覆盖后可手填厂商与渲染器，两者须一起填写；保存和重新读取均已验证。

浏览器版本绑定实际运行内核，不能任意改成一个不匹配的版本。图形与音频默认原生，保留用户主动选择的稳定覆盖。跨系统配置有就地提示：选择 Windows 只会调整模拟参数，Mac 的原生 GPU、字体和图形实现不会因此变成 Windows。

## BrowserLeaks 与 BrowserScan 实际结果

在本机 Apple M4、原有 macOS 环境、本机网络下：

| 检查 | 本次观察 |
|---|---|
| BrowserScan | 最终重新加载后 100%，原先五类警告未出现 |
| Client Hints JavaScript | macOS 26.1.0 / arm / Chromium 152.0.7977.130 |
| Client Hints HTTP | 原先显示未收到，修复后系统、架构、完整版本与 JS 一致 |
| WebGL | WebGL 1/2 可用，Google Inc. (Apple)，Apple M4 Metal Renderer |
| Canvas | 2D/Text/toDataURL 正常，实际生成图像与签名；唯一性数值不是“安全分数” |
| WebRTC | 页面显示 No Leak；不等于其他连接路径没有泄露 |
| IPv4 / IPv6 | 页面分别显示美国与中国的出口，当前网络路径不一致 |
| DNS | 一次完整结果为 67 个解析服务器、13 个 ISP、9 个地点，包含中国与美国；后续重测列表会变化 |

HTTP 修复为每个会话维护按安全来源隔离的 Accept-CH 声明：发送低熵 UA 信息，高熵 UA 信息只有网站声明后才补齐，重新声明可撤销。真实本地 HTTP 请求与外网 BrowserLeaks 都验证成功。不伪造网络带宽、RTT 等其他 Client Hints。

DNS 与 IPv6 是仍然存在的网络问题。当前环境未配置独立代理；修改国家、时区或图形标识不会改变网络路由。需要能够覆盖 DNS 与 IPv6 的实际代理/VPN 配置后再测，不能凭检测分数宣称匿名。未更改用户操作系统网络设置，未提供或购买代理服务。证据只保留必要结论，不保存用户公网 IP 到报告。

## Windows 与分发

- 新建环境在 Windows 默认选 Windows，在 macOS 默认选 macOS；旧环境保持其明确的系统选择。
- 原生平台的 Client Hints 从 Chromium 获取系统版本/架构，支持 x64 / ARM64 的元数据；macOS 使用实际版本和 ARM 架构。跨系统模拟值与原生值明确区分。
- 平台对应的快捷键、开机启动说明、设备文字和字体栈；Windows 本机 Chrome 版本通过可执行文件版本资源读取。
- Windows x64 NSIS 安装程序和 ZIP 已交叉构建，并核验 PE 架构、asar 版本与主要源文件一致；应用包含品牌图标。没有 Windows 主机，尚未安装或运行这些产物。
- 新增 Windows / macOS CI 配置，包含构建、单元与浏览器/工作台测试；本地没有触发远程 CI，不把配置文件存在称为 CI 已通过。
- Windows ARM64 和 macOS Intel 有构建入口，本轮没有为这两类硬件做真机测试。Linux 尚未作为本轮分发目标验收。

产物：

- `dist/Star-Browser-0.12.0-mac-arm64.dmg`、`.zip` 与 `dist/mac-arm64/Star Browser.app`
- `dist-win-release/Star-Browser-0.12.0-win-x64.exe`、`.zip`

Mac 使用 ad hoc 签名，尚未 Developer ID 公证；Windows 包未代码签名。SHA-256、字节数及源文件比对在 `test-results/star-0.12.0/artifacts.json`。

## 验证范围

- 32 项单元测试。
- 11 项新增工作台/浏览器专项：真实菜单、键盘、导航、HTTP 请求、加载/停止、DevTools、离线、手动保存。
- 16 项指纹通过，另 2 项观察边界；Shared/Service Worker、字体等原生边界继续保留。
- 24 项 Electron / 本机 Chrome E2E。
- 9 项浏览器设置、8 项标签专项。
- 12 项实际 macOS 安装包检查。
- 原始 21 文件追溯保留；项目 JavaScript 语法检查。

证据与截图在 `test-results/star-0.12.0/`。截图中的 Studio 环境是隔离测试数据，实际用户环境未被替换。主要界面实现见 `ui/`、`src/renderer/browser-*`，布局决策见 `docs/workbench-design.md`。
