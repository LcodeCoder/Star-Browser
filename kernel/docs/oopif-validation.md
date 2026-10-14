# 跨进程 iframe：原生屏幕与 DPR 验证

状态：源码候选已准备，**尚未通过完整 Chromium 编译和候选运行验收**。`oopifPropagationRuntimeAccepted` 与 `p0Complete` 保持 `false`。现有安装包没有包含这个原生补丁。

## 数据传递

`0003-oopif-effective-screen.patch` 为 `FrameVisualProperties` 与 `VisualProperties` 增加可选的 `emulated_screen_infos`，经过对应 Mojo schema、traits、反序列化、RemoteFrame、CrossProcessFrameConnector、RenderWidgetHost 与 FrameWidget 传递。

原有 `screen_infos` 保留真实 widget 的信息，继续用于合成、surface、布局尺寸和输入路由。新增字段供网页暴露的 Screen API、原生 device media queries 与 DPR 使用。接收端先更新继承状态，再执行尺寸更新；变化比较包括模拟数据，清除时继续向嵌套远程框架传播。

`ChromeClientImpl` 从网页屏幕视图读取 ScreenInfos，`LocalFrame::DevicePixelRatio` 使用网页 DSF 与 widget DSF 的比例修正原生 DPR。主页面已有模拟器时比例为 1；OOPIF 使用该比例改变网页查询结果，合成器仍使用原有物理比例。这里没有替换 `window.devicePixelRatio`、`matchMedia` 或 `getComputedStyle`。

这需要跨越原生进程与接口边界，补丁修改 20 个上游文件。仅修改 getter 或关闭 Site Isolation 无法证明同样的初始化与 CSS 行为。

## 源码检查的边界

固定 Chromium 155.0.8059.40，提交 `cfaadc5a132d78e1828635aa8405a499f3e14864`。锁文件包含 32 个上游文件的哈希、6 个新增文件和 3 个补丁。

`verify-patches` 检查固定文件、实际应用补丁，并执行 54 个硬件与 69 个屏幕独立策略检查。OOPIF 检查从补丁后的实际源码提取方法，使用接口桩编译执行 52 项检查，并检查 17 项 IPC/调用路径连接。

接口桩不能证明真正的 Mojo 排序、renderer 初始化、合成器输出或输入命中。报告保留 `compiledChromium:false`；完整编译与运行结果单独报告。

## 真实运行入口

在 `macos/` 目录执行：

```sh
npm run test:native-oopif:controls
node tests/oopif-device-metrics.cjs \
  --executable /absolute/path/to/staged/Chromium \
  --output test-results/native-oopif-acceptance.json
```

macOS 必须提供完整 `.app` 内的启动文件。Windows 必须提供从 `out/` 整理出来、包含实际 DLL 和资源的运行目录。验收对完整运行包计算哈希，并读取实际版本与源码提交。

测试启动参数包含 `--site-per-process`；三个站点分别为 `localhost`、`127.0.0.1` 和 `nested.star.test`，并要求真正的 iframe DevTools targets。每个窗口使用独立实例标识，父子关系通过 Chromium frame metadata 核对，避免两个同策略窗口测到同一个 iframe。

允许的模拟指令只有 `Emulation.setDeviceMetricsOverride` 和 `Emulation.clearDeviceMetricsOverride`。页面脚本只测量浏览器和记录点击；不注入 preload、不加载扩展、不替换浏览器 API。

运行检查覆盖：

- 页面、同源框架、真实 OOPIF、嵌套 OOPIF、srcdoc、同步 about:blank 的首段脚本和当前值。
- 原生 getter、`matchMedia` 和真正 `@media` 驱动的 computed CSS，包含屏幕宽、高与 DPR。
- 120 × 30 CSS px 矩形截图的宽高，包含跨进程和嵌套 surface，以及从主页面路由的真实点击。
- 两个窗口分别使用 1600 × 900 / DPR 1.5 和 1800 × 1000 / DPR 1.25。
- 手动改变窗口宽度；现有 OOPIF 与嵌套框架动态更新；原生 media-query change 事件。
- 清除模拟后恢复该窗口独立测得的原生基线，另一个窗口保持自己的设置。
- 清除、窗口变化、导航与完整重启后的像素/点击；重启后重新设置策略前先检查无残留的原生基线。

四个普通 Chrome 对照通过后，候选的十五项必需检查必须全部通过才产生 `oopif-accepted`。普通 Chrome 负面对照产生 `oopif-rejected`，不能作为候选通过证据。截图使用主 surface 实际颜色比较子 surface，兼容 macOS 色彩管理。

## 完整构建工作流

GitHub Actions 的 `Native Chromium build and acceptance` 工作流可手动选择 Windows、Mac 或两者。它使用固定源码提交和实际 gclient 依赖，分别记录准备、checkout、GN、Chrome 编译、运行包整理、运行验收和原生单测。失败保留实际阶段、日志和报告，不把源码检查记作编译通过。

构建使用非官方 release 配置，关闭调试符号、remote execution 与 ThinLTO。Windows 原生 x64 使用系统 Visual Studio C++ 工具链，准备脚本在可丢弃的托管 runner 上补齐 Windows SDK 10.0.28000.2270（工具目录 10.0.28000.0）与 x64 调试工具。固定 Microsoft 安装程序 URL 和 SHA-256，并要求有效的 Microsoft Authenticode 签名；保留安装日志，核实实际头文件、库、rc.exe 与 cdb.exe 后才继续 checkout。Mac 原生 arm64 使用系统完整 Xcode。只在可丢弃的 GitHub-hosted Mac 上清理未使用的 Xcode，保留当前选择的 bundle 及指向它的别名。脚本拒绝本机和 self-hosted runner 的这类准备操作。

标准托管构建机的 CPU、RAM 和作业期限仍可能限制完整构建。启动工作流不等于完成编译；运行包、原生单测与每项验收报告才是结果。

## 参考与差异

- Simprint 桌面与 `simprint/m144` 内核：观察了 renderer 初始化前分发配置的方式；未复制 AGPL 源码。仅凭 getter 策略不能证明原生 CSS。
- Simprint/schromix，提交 `c3790fe987af8c949d67d60879b15631ac0df7d6`：参考了 0125–0128 的跨进程屏幕问题与验证说明。其说明也保留了分数 DPR 下合成和输入尚未完成原生验收的限制。
- Chromium 官方回退提交 `33ce7de78d85aacdb69bc5e122b9e86e53e1a696`：记录过把模拟屏幕作为物理 widget 屏幕传递导致双重缩放的问题。本项目因此使用独立的网页屏幕字段。

相关许可与参考作者声明保留在 `kernel/THIRD_PARTY_NOTICES.md`；实际 Chromium 发行包应保留 Chromium 自身的许可和依赖声明。
