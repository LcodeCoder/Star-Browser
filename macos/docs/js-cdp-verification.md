# JS/CDP 指纹配置与验证记录

验证日期：2026-10-13。范围是现有 JavaScript 与 Chrome DevTools Protocol（CDP）实现；本轮没有通过运行验收的定制 Chromium 二进制。受验收报告保护的原生硬件启动入口已接入，未验收配置会明确失败。

## 验证环境

| 项目 | 本轮实际环境 |
| --- | --- |
| 主机 | macOS 26.1（25B78），Apple Silicon / arm64 |
| Star Browser 源码版本 | 0.15.1，原生一致显示与真实 CSS 检查 |
| 内置浏览器 | Electron 44.7.0 / Chromium 152.0.7977.130 |
| 本机 Chrome | 155.0.8059.40 |
| 驱动 | Playwright 1.64.0；严格上下文测试独立启动 Electron，通过显式 CDP 会话读取 |

JS/CDP 专项证据来自本机源码运行。发行包通过 `verify:artifacts` 单独核对对应源码，并在对应平台上用 `test:package` 检查，详见验证记录；Windows 用户设备、其他硬件和任意外部网站不在本地专项通过范围内。

## 已实现并验证的范围

| 范围 | 实现与验证 |
| --- | --- |
| 页面与 frame 身份 | UA、platform、语言与语言列表、Intl 日期/数字区域、时区、CPU 核心数、设备内存；页面首次脚本、同源 frame、srcdoc、同步 about:blank 与跨进程 iframe 均读取配置。跨进程 iframe 的设备模拟限制见下文。 |
| Dedicated Worker | 经典、模块、Blob 与嵌套 Worker；覆盖首次脚本与模块依赖，保留原生 Worker 构造与消息通道。 |
| Shared Worker | 经典与模块 Worker；首次脚本、请求头、跨标签共享实例和连接、关闭后重新打开保持配置。 |
| Service Worker | 注册、激活、接管、fetch 与消息；停止后重新启动、模块重新注册以及完整应用重启后重新配置，保留原生生命周期。 |
| UA Client Hints | 页面与各类 Worker 的低熵及高熵字段、toJSON、版本与平台声明；HTTP UA、Accept-Language 和已请求的 Client Hints 一起验证。 |
| 屏幕与输入 | 原生一致模式在顶层、同源、OOPIF、srcdoc、嵌套及同步 about:blank 中保留真实 screen/DPR 与 CSS 查询；自定义模式的跨进程限制见下文。跨系统或移动设备声明仍不等于完整设备模拟。 |
| 可选稳定策略 | 2D Canvas/OffscreenCanvas 按绝对像素位置分配确定性低位，重复读回、裁剪、导出/解码保持一致；AudioBuffer 直接读取与 copyFromChannel 一致，静音保持静音；几何 API 保留原生类型和接收者校验。 |
| WebGL 与 WebRTC | 默认图形/音频保持原生；可选 WebGL 策略只改 vendor/renderer 声明。WebRTC 关闭时明确拒绝连接，包括 prototype.constructor 路径；保留时仍是原生连接、构造器身份、事件与 RTCStatsReport。 |
| 生命周期与隔离 | 双环境并行、页面导航、标签销毁与重建、休眠/唤醒、DevTools 打开/关闭以及后台执行上下文重建均有回归。 |
| 工作台检查 | 读取当前页面、临时 Dedicated Worker、同来源运行中的 Shared/Service Worker 和属于当前页面的跨进程 iframe；展示真实差异、未读取状态和协议配置错误。 |

协议支持的字段优先使用原生设置。部分 Electron Worker agent 虽接受 UA 命令却没有实际改变 WorkerNavigator，因此首次配置会读取并核对原生值，再为未覆盖的值使用 JS；同一 target 的首次判定会保留，避免把之前的 JS 结果误认成原生支持。原生 UA/platform/语言 getter 已与目标一致时保留真实函数，不安装转发包装；高熵 Client Hints 仅在原生协议未实际管理时使用 JS fallback。默认图形、音频和几何模式不安装覆盖，真正需要包装时才安装 Function.prototype.toString 支持。

JS getter 与方法使用原生函数作为 Proxy 目标，继续执行原生接收者和参数校验。严格测试包括错误接收者、Client Hints 的省略/null/数字参数、函数名称与长度、非构造函数的 prototype 属性、语言数组与独立原生对照相同的身份/冻结行为和品牌数组的冻结状态。重新安装同一配置不叠加覆盖或扰动。这些测试证明已检查的 API 行为保持一致，不证明所有反射或检测路径都无法区分注入代码。

内置浏览器用 browserContextId 区分环境，浏览器连接处理 Shared/Service Worker，页面连接处理 Dedicated/嵌套 Worker 与 iframe。Worker 启动暂停后配置，再恢复执行。严格测试不使用第二个浏览器级 autoattach，以免另一个调试客户端提前恢复 Worker，影响首次脚本验证。

## 0.15.1 原生一致显示与真实 CSS 验证

新建环境默认选择“原生一致”，已有屏幕尺寸或 DPR 的配置继续使用“自定义”。原生一致模式清除设备指标模拟，保留浏览器真实 screen getter、devicePixelRatio、matchMedia 与样式引擎；独立 Chrome 不添加 force-device-scale-factor。运行时读取当前浏览器显示信息，失败时不提交部分数据。自定义参数作为备用保留，切换模式后可以继续编辑使用。

原生一致模式会使用真实显示器参数；它解决已测试上下文的显示一致性，不承诺任意自定义屏幕 / DPR 的伪装，也不改变语言、时区及环境隔离配置。物理多显示器切换与操作系统睡眠没有在这次本机验收中测试。

`npm run test:display` 使用独立、没有项目预加载或指纹注入的 stock Electron 对照；站点隔离保持开启。9 项检查覆盖六类 frame 的首段脚本、screen 六项、原生 getter 语义、120 × 30 CSS px 布局，以及 19 种 resolution 查询的 matchMedia 与真实 @media 样式。页面缩放 1.25 / 复原、MQL change 事件、跨站导航、重载、DevTools 开闭、双环境隔离、标签休眠唤醒、环境关闭重开和完整应用重启均通过。

独立原生对照在测量前后读取实际 workArea，避免把 macOS Dock 引起的原生可用高度变化误判成配置漂移；当前页面和各框架仍须匹配独立原生对照。测试不会通过伪造 DPR getter、替换 matchMedia 或关闭站点隔离使结果通过。

网页诊断分别读取 JS 媒体查询和真实 CSS @media 的 computed style。原生显示值标为“原生信号”，没有自填期望值冒充匹配；frame 与当前顶层仍作一致性检查。CSP 阻止临时样式时标为“未读取”。测量元素和样式读完即移除。

## 明确保留的限制

### 自定义模式：跨进程 iframe 的原生 DPR 与 CSS 设备模拟

0.15.1 严格上下文回归继续使用自定义屏幕 1600 × 900、DPR 1.5，观测如下：

| 读取位置 | DPR | CSS 设备尺寸与分辨率查询 |
| --- | --- | --- |
| 顶层页面、同进程 frame | 1.5 | 与配置一致 |
| 跨进程 iframe（OOPIF） | 2（本轮设备的原生值） | 配置对应的查询均为 false |

跨进程 iframe 的 UA、语言、时区、CPU 和设备内存仍通过身份一致性检查。问题在于当前 Chromium 的设备模拟没有把自定义设备指标传入跨进程 iframe widget：对子 frame 发送设备模拟命令会被拒绝，给父页面重新应用设备指标也没有解决。

此项在 `fingerprint-contexts.json` 的 `limitations` 中保留实际读值，所属测试以及整份报告的状态为 `partial`。测试进程退出 0 表示已支持的字段没有出现新增回归，**不表示此限制通过**。实现没有关闭站点隔离，也没有单独改 JS 的 DPR 来掩盖原生 CSS 差异。

### 独立 Chrome 的原生缩放

独立 Chrome 155 使用已有 `--force-device-scale-factor`。配置 1.5 / 1.25 后，顶层和真实 OOPIF 的 DPR、CSS resolution 一致，getter 保持原生；两个进程与完整关闭后重开通过原有四项检查。0.15.1 另增加原生一致显示的六类 frame、首段脚本、真实 CSS、getter、重载 / 重启与实际诊断三项检查，7 项检查通过，整份报告仍保留自定义屏幕限制为 partial。120 CSS px 的布局宽度保持不变。

自定义屏幕尺寸的 OOPIF CSS 查询仍有差异：JS 屏幕尺寸符合 1600 × 900，原生设备尺寸查询未全部符合。`external-display.json` 的整体状态仍为 `partial`。这个改善只属于独立 Chrome，不代表内置 Electron 的 DPR 限制已经解决。

### 原生与未覆盖信号

字体及字体渲染、媒体能力、语音列表、WebGPU、GPU 扩展/能力、HDR 与宽色域读回，以及 TLS、DNS 和真实网络出口继续来自原生系统或网络。可选 WebGL 标识不模拟另一块完整 GPU；移动设备/跨操作系统声明不能证明物理设备特征完全一致。

保留 WebRTC 时，原生 UDP 网络路径可能不同于 HTTP 代理出口。页面或 Worker 没有启动、权限/策略不允许读取、后台 target 无响应时，检查应显示未运行或未读取，不得作为通过证据。

因此，本轮验证不宣称任意网站不可检测，也不使用历史 BrowserScan/BrowserLeaks 分数替代当前实现证据。

## 历史 CreepJS 本地观测与原生 Worker 对照

以下 CreepJS 数值为 0.14.0 的自定义配置观测，没有作为 0.15.1 原生一致模式的检测评分。使用固定 CreepJS 提交 `10aa6724cd33a1015db1574211890518cd04f0cc` 的未修改脚本，本地提供静态资源，并阻断外部网络。三组对比都完成；这是本地 API 信号观测，不是云信任分数或任意网站通行保证。

| 配置 | 本轮观测 lies | 说明 |
| --- | --- | --- |
| 普通 Chrome | 0 | 原生对照 |
| Star 独立 Chrome | 21 | 同一显式 CPU/RAM/屏幕配置，修正前为 123 |
| Star 内置 Electron | 27 | 引擎版本与 Chrome 不同，不能只比较总数 |

剩余信号集中于必要 RAM fallback、屏幕可用尺寸/色深以及 Electron Worker UA/自动化字段覆盖。原生模式减少了无用包装；仍不把 JS fallback 描述为真实原生 API。

独立 Worker 对照进程不加载应用 main、preload、扩展或 fingerprint source，只应用相同原生协议设置。在 Dedicated/Shared/Service Worker 中，当前原生 `navigator.languages === navigator.languages` 为 false，数组仍被冻结。严格测试按原生对照核验，而非错误要求统一稳定对象身份。证据为 `native-worker-control.json`。

## 调试通道与配置边界

为了覆盖 Shared/Service Worker，内置 Electron 浏览器启用随机端口、监听地址为 **127.0.0.1** 的 CDP 接口。它是没有身份鉴权的本机调试接口，同一台电脑上的其他进程可以连接。应用退出时关闭连接；这项实现不能描述为完全没有调试端口。本机 Chrome 继续使用现有的本地 CDP 管道。

指纹安装器与配置保存在闭包中，页面和 Worker 不保留固定名称的安装函数、状态标记或配置全局变量。重复注入通过进程随机的事件名更新已有运行时，不叠加覆盖；代理凭据只在扩展后台配置中读取，不注入网页主世界。扩展与工作台自身的后台 Worker 不套用网站环境的指纹。

## 复现与结果

从 `macos/` 目录运行：

```sh
npm test
npm run test:fingerprint
npm run test:display
npm run test:external-display
npm run test:browser-settings
npm run test:tabs
npm run test:permissions
```

CreepJS 复现：`npm run test:creepjs:local -- /absolute/path/to/creepjs`（需要单独 clone，应用不包含其源码）。独立缩放复现：`npm run test:external-display`。原生硬件验收见仓库 `kernel/README.md`。

严格上下文测试可单独运行 `npm run test:fingerprint:contexts`。检测结果写入 `test-results/`；该目录是本地生成证据，不随 Git 提交，重新运行可生成当前机器的报告。

| 测试组 | 本轮结果 | 证据 |
| --- | --- | --- |
| 单元回归（包含显示模式与诊断状态） | 102 项通过 | `npm test` 输出 |
| 工作台与本机 Chrome 指纹回归 | 17 项通过 | `test-results/fingerprint.json` |
| 严格上下文、首次脚本、原生对照与生命周期 | 14 项通过，1 项部分通过 | `test-results/fingerprint-contexts.json`，包含逐项实际读值与 `limitations` |
| 原生一致显示、真实 CSS 与生命周期 | 9 项通过 | `test-results/display-consistency.json` |
| 独立 Chrome 自定义缩放与原生一致显示 | 7 项通过，整体部分 | `test-results/external-display.json` |
| 历史 CreepJS 本地观测（0.14.0） | 3 组观测完成，仍有差异 | `test-results/creepjs-local.json` |
| 原生内存请求头 | 5 项通过 | `test-results/hardware-headers.json` |
| 浏览器设置 | 12 项通过 | `test-results/browser-settings.json` |
| 标签与休眠恢复 | 8 项通过 | `test-results/tabs.json` |
| 权限隔离 | 3 项通过 | `test-results/permissions.json` |

工作台报告区分匹配、差异、原生信号、未读取与未运行；后台协议错误影响成功判定。UI 构建与 Git diff 空白检查已通过；当前 53 个运行时 JavaScript 文件通过语法检查；原始安装包及提取证据已从工作区清理，溯源脚本明确报告 `source-unavailable`，不再宣称原始文件证据仍存在。新增测试脚本另行通过语法检查。

## 官方接口依据

- [CDP Emulation 协议定义](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Emulation.pdl)：UA/Client Hints、区域、时区、CPU 和设备指标。
- [CDP Target 协议定义](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Target.pdl)：目标过滤、启动暂停和递归 autoattach。
- [Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger)：调试会话与 DevTools 导致的 debugger 分离。

具体可用性以本轮 Electron/Chrome 版本的真实响应和读值为准。官方接口描述本身不能证明跨上下文抗检测效果。
