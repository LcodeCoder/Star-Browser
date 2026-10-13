# Star Browser 0.13.1

自动地域使用当前环境的真实网络会话，网络查询有明确期限。完整语言列表贯穿首次 HTTP、网页、Dedicated Worker 与本机 Chrome；已完成文档不再受后台框架持续加载阻挡。

环境指纹详情和浏览器菜单新增“检测此环境”，提供 BrowserScan 与 BrowserLeaks 七项入口，支持搜索、空结果、离线、失败重试和键盘返回。未启动环境会先启动，已有内置或本机 Chrome 会沿用原环境打开新标签。

Windows 的加密备份同步以可写句柄执行，解决真实 GitHub runner 的 EPERM。macOS 与 Windows 界面回归和 Windows x64 安装包构建由实际 Actions 校验；新的检测专项已加入工作流。

公网临时环境 BrowserScan 本次显示 100%，时区与完整语言列表一致；BrowserLeaks 记录 JavaScript、Client Hints、WebRTC、Canvas、WebGL、TLS 实际读数。这个分数只代表该次观测。原生字体、Shared/Service Worker、WebGPU、TLS、DNS 和网络供应商仍按真实能力判断，不承诺全部网站检测结果。

实际安装包、完整签名、配置隔离和界面专项的结果追加到 verification.md。Mac 使用 ad hoc 签名，Windows 安装包未签名；Intel/Windows 用户设备上的安装验收仍需对应设备。
