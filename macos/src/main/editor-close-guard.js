'use strict';

class EditorCloseGuard {
  constructor({app, dialog, BrowserWindow}) {
    Object.assign(this, {app, dialog, BrowserWindow});
    this.owners = new Map();
    this.prompting = new Set();
    this.allowedWindows = new Set();
    this.allowQuit = false;
    app.prependListener('before-quit', event => {
      if (event.defaultPrevented || this.allowQuit) return;
      const window = BrowserWindow.getAllWindows().find(candidate => this.state(candidate).blocked);
      if (window) this.protect(event, window, true);
    });
    app.on('before-quit', event => { if (event.defaultPrevented) this.allowQuit = false; });
  }

  state(window) {
    const states = [...(this.owners.get(window.webContents.id)?.values() || [])];
    return {blocked:states.some(state => state.dirty || state.busy), busy:states.some(state => state.busy)};
  }

  update(sender, input) {
    if (!input || typeof input.id !== 'string' || input.id.length > 80 || typeof input.dirty !== 'boolean' || typeof input.busy !== 'boolean') return;
    const window = this.BrowserWindow.fromWebContents(sender);
    if (!window || window._profile || window.isDestroyed()) return;
    let states = this.owners.get(sender.id);
    if (!states) {
      states = new Map();
      this.owners.set(sender.id, states);
      window.on('close', event => {
        const approved=this.allowedWindows.delete(window.id);
        if (!this.allowQuit && !approved) this.protect(event, window, false);
      });
      sender.once('destroyed', () => {
        this.owners.delete(sender.id);
        this.prompting.delete(window.id);
        this.allowedWindows.delete(window.id);
      });
    }
    if (!input.dirty && !input.busy) states.delete(input.id);
    else if (states.has(input.id) || states.size < 32) states.set(input.id, {dirty:input.dirty, busy:input.busy});
  }

  show(window) {
    if (!window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  }

  protect(event, window, quitting) {
    const state = this.state(window);
    if (!state.blocked) return;
    event.preventDefault();
    if (this.prompting.has(window.id)) return;
    this.prompting.add(window.id);
    Promise.resolve().then(async () => {
      const saving = this.state(window).busy;
      const result = await this.dialog.showMessageBox(window, {
        type:'warning', title:saving?'正在保存':'修改尚未保存',
        message:saving?'请等待保存完成':'当前编辑内容尚未保存',
        detail:saving?'保存完成后再关闭窗口或退出应用，以保留这次更改。':'继续编辑并保存，或放弃这次修改。',
        buttons:saving?['继续等待']:['继续编辑',quitting?'放弃更改并退出':'放弃更改并关闭'],
        defaultId:0, cancelId:0, noLink:true,
      });
      if (saving || result.response !== 1 || this.state(window).busy) { this.show(window); return; }
      if (window.isDestroyed()) return;
      if (quitting) { this.allowQuit = true; this.app.quit(); }
      else { this.allowedWindows.add(window.id); window.close(); }
    }).catch(() => this.show(window)).finally(() => { this.prompting.delete(window.id); });
  }
}

module.exports = {EditorCloseGuard};
