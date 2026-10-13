# Star Browser 0.13.0

改善每天反复使用的操作：批量代理检测的输入与结果排版、连续标签栏、新建标签的位置、深色工作面、键盘焦点与主题切换。

批量检测现在逐条显示进度，支持停止、搜索/状态筛选和重开后继续查看结果。连接通过、出口未读取及来源标记分开呈现；检测结果不代表目标网站的账号安全结论。

浏览器加载使用工具栏底部进度和停止/刷新状态，开发者工具针对当前标签打开。工作台保留搜索与详情上下文，浅深模式共享语义色，系统减少动态效果偏好覆盖动画和定位滚动。

运行内核版本、Client Hints、默认日期/数字区域语言及手动 WebGL 设置一起校验。Shared/Service Worker、字体、WebGPU、TLS/DNS 保留明确的原生能力边界。

验证命令：`npm test`、`npm run test:experience`、`npm run test:workbench-browser`、`npm run test:fingerprint`、`npm run test:e2e`、`npm run verify:source`。具体已完成结果见 verification.md；远程站点与 Windows 实机结果单独记录，不以本机结果替代。
