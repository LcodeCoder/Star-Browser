"use strict";
// 配置就绪后才回复代理鉴权，避免首次请求早于配置读取。
let PROXY = null;
const configReady = fetch(chrome.runtime.getURL("config.json"))
  .then(response => response.json())
  .then(config => { PROXY = config && config.proxy ? config.proxy : null; })
  .catch(() => {});

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!details.isProxy) { callback({}); return; }
    configReady.then(() => {
      if (PROXY && PROXY.user) callback({ authCredentials: { username: PROXY.user, password: PROXY.pass || "" } });
      else callback({});
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"],
);
