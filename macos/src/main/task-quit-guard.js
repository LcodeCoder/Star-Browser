'use strict';

function installTaskQuitGuard({app, dialog, tasks, showWorkspace=()=>{}}) {
  let prompting = false, discard = false;
  const protect = event => {
    if (event.defaultPrevented || discard || !tasks.pendingResults.size) return;
    event.preventDefault();
    if (prompting) return;
    prompting = true;
    Promise.resolve().then(async () => {
      const {response} = await dialog.showMessageBox({
        type: 'warning',
        title: '执行结果尚未保存',
        message: `${tasks.pendingResults.size} 条执行结果等待保存`,
        detail: '磁盘写入失败后，结果仍保留在本次会话中。继续使用应用并恢复磁盘写入，或重试保存后退出。',
        buttons: ['重试保存并退出', '继续使用', '退出并放弃未保存结果'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        try { tasks.retryResults({resume:false}); }
        catch {
          await dialog.showMessageBox({
            type: 'error', title: '结果仍未保存', message: '无法保存执行结果',
            detail: '应用继续保持打开。请检查磁盘空间、连接和写入权限，再使用任务页的“重试保存结果”。',
            buttons: ['继续使用'], noLink: true,
          });
          showWorkspace();
          return;
        }
        app.quit();
      } else if (response === 2) {
        discard = true;
        app.quit();
      } else {
        showWorkspace();
      }
    }).catch(() => { showWorkspace(); }).finally(() => { prompting = false; });
  };
  app.prependListener('before-quit', protect);
  return () => app.removeListener('before-quit', protect);
}

module.exports = {installTaskQuitGuard};
