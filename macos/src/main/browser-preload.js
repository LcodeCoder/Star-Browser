"use strict";
/**
 * Electron 内置浏览器（Lite 模式）的预加载脚本
 * 在 BrowserView 的 MAIN world 中运行（主进程创建时 contextIsolation:false），
 * 读取主进程写入的指纹配置并调用共享内核 fp-core.js 完成伪装。
 *
 * 配置路径由主进程通过 process.env.FP_CONFIG_PATH 传入。
 */
const fs = require("fs");
try {
  const createRuntime = require("../extension/fp-core.js");
  const p = process.env.FP_CONFIG_PATH;
  if (p && fs.existsSync(p)) {
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (cfg && cfg.fingerprint) {
      const { metadata } = require("./fingerprint-protocol");
      createRuntime(globalThis).installFingerprint({...cfg.fingerprint,userAgentMetadata:metadata(cfg.fingerprint)});
    }
  }
} catch (e) {
  // 预加载失败不应阻塞页面
}
