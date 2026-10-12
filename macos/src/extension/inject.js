"use strict";
/**
 * 扩展内容脚本入口（MAIN world / document_start）
 * 真正的伪装逻辑在 fp-core.js（与 Electron 内置浏览器共用同一份）。
 * 配置来自 config.js -> window.__FP_CONFIG__（由主程序按环境写入）。
 */
(function () {
  var CFG = window.__FP_CONFIG__ && window.__FP_CONFIG__.fingerprint;
  if (!CFG) return;
  if (typeof installFingerprint === "function") installFingerprint(CFG);
})();
