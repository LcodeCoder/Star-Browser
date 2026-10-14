# Star Chromium 原生策略与验收

这是原生内核的准备和验收入口。当前固定 Chromium **155.0.8059.40**（提交 `cfaadc5a132d78e1828635aa8405a499f3e14864`）。硬件补丁作用于 `hardwareConcurrency`、`deviceMemory` 及原生 Device-Memory / Sec-CH-Device-Memory 请求头；屏幕补丁准备尺寸、可用尺寸、色深和方向；不代表字体、GPU、媒体、屏幕、网络或完整内核反检测已经完成。锁文件和所有报告保留 `p0Complete: false`。

硬件策略放在三个新增文件中，修改五个上游文件用于读取策略、传递启动参数和注册构建/测试。屏幕策略放在另外三个新增文件中，修改一个上游实现和两个构建清单。参数为 `--star-fingerprint-hardware=4,4`（CPU 核心数、内存 GB）；无参数或完整参数校验失败时，保留原生实现。一个环境使用一个浏览器进程和独立数据目录，禁止把不同硬件策略放进同一个进程。

屏幕参数为 `--star-fingerprint-display=1600,900,1600,860,24`。它在真实 ScreenInfos 副本上设置尺寸、可用尺寸、depth 与方向，保留监视器身份、原点、拓扑、色域和缩放。DPR 使用现有 `--force-device-scale-factor`。没有完整多显示器、HDR 或完整设备模拟保证。

`macos/src/main/native-kernel.js` 已接入独立浏览器启动：同时设置 `STAR_NATIVE_KERNEL_EXECUTABLE` 与 `STAR_NATIVE_KERNEL_ACCEPTANCE` 才能使用通过硬件验收的发行包。验收不合格明确失败，不回退本机 Chrome；原生硬件模式不发送 CPU Emulation，也不用 RAM JS fallback 掩盖差异。屏幕策略尚未原生运行验收，不发送其参数，不扩充硬件 ABI。原生 Chromium 尚未在本机完整编译或运行验收，现有 Star 安装包仍使用 Electron 或本机 Chrome。

跨进程 iframe 的屏幕/DPR 候选补丁使用独立 `emulated_screen_infos` 传递网页屏幕信息，保留物理 widget 信息用于合成和输入。它尚未通过完整编译或候选运行验收。初始化、原生 CSS、像素、点击、动态更新、清除与重启检查见 [OOPIF 验证说明](docs/oopif-validation.md)。

## 不需要完整源码的检查

在仓库根目录执行：

```sh
python3 kernel/scripts/kernel.py verify-patches \
  --output macos/test-results/native-kernel-patches.json
python3 kernel/scripts/kernel.py test-policy
python3 -m unittest discover -s kernel/tests -p 'test_*.py' -v
```

`verify-patches` 只下载三十二个固定上游文件，核对 SHA-256，在临时目录检查并应用补丁，再编译独立 C++ 策略测试与 OOPIF 方法接口桩。接口桩检查包含 52 项实际源码方法行为和 17 项 IPC 连接；它不是完整 Chromium 编译或运行验收。`test-policy` 验证硬件及屏幕参数解析、无效输入和回退规则；当前 54 个硬件、69 个屏幕独立 C++ 检查通过。

## 升级前检查冲突

```sh
python3 kernel/scripts/kernel.py check-compatibility \
  --ref refs/heads/main \
  --output macos/test-results/native-kernel-main-compatibility.json
python3 kernel/scripts/kernel.py check-compatibility \
  --source /absolute/path/to/chromium/src \
  --output macos/test-results/native-kernel-local-compatibility.json
```

远程分支/标签先解析为一个不可变提交，再读取该提交的受影响文件。报告记录真实版本、提交、变化文件、覆盖文件冲突和 `git apply --check` 输出。检查只读取源码，在临时目录中运行；不会修改本地 checkout 或固定锁文件。缺文件、下载失败、补丁冲突分别报告。使用 `--source` 时检查实际工作目录，并明确是否包含本地改动。

返回码 `0` 表示本次源码检查可应用；`2` 表示有冲突或资料不可用；`1` 表示锁文件、工具或检查自身失败。源码可应用不能证明新版本可编译，也不能证明运行语义一致。升级仍需要重审上游逻辑、更新版本锁、完整构建和真实验收。

2026-10-13 实测：原补丁在主线提交 `a7a39438107ea6753993b2a6519d25c1b809b3d1`（158.0.8104.0）遇到测试清单上下文冲突；缩小清单补丁上下文后，固定版本和该主线提交都可应用。此结果只对应记录的提交。

## 完整构建

```sh
python3 kernel/scripts/kernel.py preflight \
  --source /absolute/path/to/chromium/src --arch arm64
python3 kernel/scripts/kernel.py apply \
  --source /absolute/path/to/chromium/src
python3 kernel/scripts/kernel.py build \
  --source /absolute/path/to/chromium/src --arch arm64 --jobs 4
```

`apply` 是明确修改完整 checkout 的操作：必须处于固定提交，并在修改前核对所有上游文件和覆盖文件的哈希。`build` 复核已应用补丁及覆盖文件，使用 GN / autoninja 构建 Chrome、Blink 测试与 content_unittests，再运行硬件和屏幕原生策略单测。Windows x64 应在对应原生主机和 Visual Studio / Windows SDK 环境执行；Mac 需要完整 Xcode、SDK 和 gclient 依赖。

本机预检实际缺少完整 Xcode、GN、autoninja 和完整 Chromium checkout。当前使用 Command Line Tools 的独立 C++ 测试不替代完整构建。这些阻塞记录在 `macos/test-results/native-kernel-preflight.json`。

## 运行验收要求

编译后必须用完整发行包进行真实测试，哈希同时覆盖启动程序和 Framework / DLL 等运行文件。验收应包括首段脚本、同源与跨源 iframe、各类 Worker、内存请求头、原生 getter、重复读取、新标签、完整重启、环境隔离和无效参数回退。对照普通 Chrome 应证明其不识别 Star 参数；测试不得注入 JS 指纹覆盖来制造“原生通过”。

目前本机 Chrome 对照在未注入指纹覆盖时实际读到 CPU 10、内存 16 GB，并在站点声明后发送两类 16 GB 内存头；Star 页面 JS 设置为 2 GB 时，本机 Chrome 原生头仍为 16 GB。这个差异由工作台的被动网络观察准确列出。Electron 本轮没有原生发出这两类头，测试未把未发送记成原生覆盖成功。

可复现的硬件验收入口（在 `macos/` 下）：

```sh
npm run test:native-kernel:controls
node tests/native-kernel.cjs --executable /absolute/path/to/Chromium --output test-results/native-kernel-acceptance.json
```

普通 Chrome controls 只验证对照，不生成 accepted 报告。必需 18 项全部通过才产生 `hardware-accepted`，报告绑定完整发行包、实际版本和源码提交；仍保持 `p0Complete:false`。启动接入需要这个报告与同一发行包。屏幕补丁的独立策略检查与源码兼容检查均不等于屏幕原生运行验收。

## 屏幕的独立运行验收

屏幕验收使用独立 ABI `star-display-v1`，不冒用硬件报告。在 `macos/` 下运行：

```sh
npm run test:native-display:controls
node tests/native-display.cjs --executable /absolute/path/to/Chromium --output test-results/native-display-acceptance.json
```

必需 21 项包括首段脚本、页面、同源与真实跨站 iframe、srcdoc、同步 about:blank、屏幕/DPR 的原生 getter 和非法 receiver、CSS 屏幕尺寸/比例/色深/方向/分辨率、120 CSS px 布局、重复读取、新标签、导航、重启、双进程隔离，以及无参数和非法参数回退。测量进程只读 CDP，不使用 Emulation、扩展或 preload。全部必需项通过才生成 `display-accepted`，并绑定完整发行包哈希、版本与源码提交；仍保留 `p0Complete:false`。

2026-10-13 本机普通 Chrome：5 项屏幕原生对照通过；把它当候选会产生 `display-rejected`（12 项失败、9 项通过）。硬件负面对照为 14 项失败、4 项通过，正确产生 `hardware-rejected`。这是验证检查能识别未实现的策略，不是定制 Chromium 已通过运行验收。日常启动仍不发送屏幕参数。

GitHub Actions 的独立 `kernel-policy` 作业检查固定上游补丁、独立策略、OOPIF 方法接口桩和 Python 工具回归，并上传报告；它不编译或验收完整 Chromium。另有手动 `Native Chromium build and acceptance` 工作流执行真正的 Windows/macOS 原生构建与逐项运行验收，上传实际阶段、日志、报告和已整理的运行包。只有对应报告通过才能认定其范围验收完成。

## 上游与许可

固定源码来自 Chromium 官方仓库及其镜像：

- https://chromium.googlesource.com/chromium/src.git
- https://github.com/chromium/chromium
- https://chromium.googlesource.com/chromium/src/+/main/docs/mac_build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md

Star 新增 C++ 文件使用 BSD-3-Clause；Chromium 的许可和依赖声明应随实际发行包保留。补丁准备不包含 Chromium 完整源码或第三方浏览器的专有实现。
