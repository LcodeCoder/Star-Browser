'use strict';
function waitForBrowseReady(window, timeout = 15000) {
  if (window.isDestroyed()) return Promise.reject(new Error('浏览器窗口已关闭'));
  if (window._starBrowseReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {cleanup(); error ? reject(error) : resolve();};
    const ready = () => finish();
    const closed = () => finish(new Error('浏览器窗口在准备期间已关闭'));
    const failed = (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) finish(new Error('浏览器界面加载失败：' + String(description).slice(0, 200)));
    };
    const cleanup = () => {
      clearTimeout(timer); window.removeListener('star:browse-ready', ready); window.removeListener('closed', closed);
      window.webContents.removeListener('did-fail-load', failed);
    };
    const timer = setTimeout(() => finish(new Error('浏览器界面准备超时，请重试')), timeout);
    window.once('star:browse-ready', ready); window.once('closed', closed); window.webContents.on('did-fail-load', failed);
    if (window._starBrowseReady) ready();
  });
}
module.exports = {waitForBrowseReady};
