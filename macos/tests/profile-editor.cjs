'use strict';
const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-profile-editor-'));
const out = path.resolve('test-results/profile-editor');
fs.mkdirSync(out, {recursive: true});
const results = [], errors = [];
let app, manager, initialProfileCount;
async function api(method, ...args) { return manager.evaluate(({method,args}) => window.api[method](...args), {method,args}); }
async function check(name, run) {
  const start = Date.now();
  try { const detail = await run(); results.push({name,status:'passed',durationMs:Date.now()-start,detail}); console.log('PASS', name); }
  catch (error) { results.push({name,status:'failed',error:error.stack}); throw error; }
}
async function layout() {
  return manager.locator('#modal').evaluate(el => {
    const rect = el.getBoundingClientRect();
    const form = el.querySelector('#profile-form');
    const footer = el.querySelector('.dialog-footer').getBoundingClientRect();
    const bounds = form.getBoundingClientRect();
    return {width:rect.width,height:rect.height,viewport:innerWidth,horizontalOverflow:form.scrollWidth-form.clientWidth,formHeight:bounds.height,footerVisible:footer.bottom <= innerHeight && footer.top >= 0};
  });
}
(async () => {
  try {
    app = await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,TFB_TEST_MODE:'1',TFB_USER_DATA_DIR:dir}});
    manager = await app.firstWindow(); manager.on('pageerror', error => errors.push(error.message));
    await manager.locator('#btnNew').waitFor();
    initialProfileCount = (await api('list')).length;
    await app.evaluate(({BrowserWindow}) => { const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Star Browser'); win.setMinimumSize(480,600); win.setSize(1180,800); });
    await check('环境编辑分区、实时摘要与宽窗固定保存区', async () => {
      await manager.locator('#btnNew').click();
      await manager.locator('#modal').waitFor();
      assert.equal(await manager.locator('.profile-section-nav button').count(), 5);
      await manager.locator('#f_name').fill('编辑流程验证');
      await manager.locator('#f_country').selectOption('JP');
      assert.match(await manager.locator('.profile-editor-summary').innerText(), /日本/);
      assert.match(await manager.locator('.profile-editor-summary').innerText(), /随网络出口/);
      const value = await layout(); assert.ok(value.formHeight > 250, JSON.stringify(value)); assert.ok(value.footerVisible); assert.ok(value.horizontalOverflow <= 1);
      await manager.screenshot({animations:'disabled',path:path.join(out,'editor-light-wide.png')});
      return value;
    });
    await check('完整代理粘贴解析保留协议、端口和编码凭据', async () => {
      await manager.getByRole('button', {name:'网络连接',exact:true}).click();
      const field = manager.locator('#f_proxy_host'); await field.focus();
      await app.evaluate(async ({clipboard}, value) => { await clipboard.writeText(value); }, 'https://qa%40star:p%3Aa%24%24@127.0.0.1:8080');
      await manager.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      await manager.waitForFunction(() => document.getElementById('f_proxy_host').value === '127.0.0.1');
      assert.equal(await manager.locator('#f_proxy_type').inputValue(),'https');
      assert.equal(await manager.locator('#f_proxy_port').inputValue(),'8080');
      assert.equal(await manager.getByLabel('账号',{exact:true}).inputValue(),'qa@star');
      assert.equal(await manager.getByLabel('密码',{exact:true}).inputValue(),'p:a$$');
      assert.match(await manager.locator('.profile-editor-form .field-hint').innerText(),/已解析/);
      return {protocol:'https',port:8080,credentialsPreserved:true};
    });
    await check('保存前端口错误定位字段，不写入半成品环境', async () => {
      await manager.locator('#f_proxy_port').fill('70000');
      await manager.locator('#btnSave').click();
      assert.match(await manager.locator('#profile-editor-error').innerText(),/1–65535/);
      assert.equal(await manager.locator('#f_proxy_port').getAttribute('aria-invalid'),'true');
      await manager.waitForFunction(() => document.activeElement.id === 'f_proxy_port');
      assert.equal((await api('list')).length,initialProfileCount);
      await manager.locator('#f_proxy_port').fill('8080');
    });
    await check('屏幕配置缺一项会展开高级设置并定位缺失高度', async () => {
      await manager.getByRole('button',{name:'指纹与权限',exact:true}).click();
      await manager.locator('#f_display_mode').selectOption('custom');
      await manager.locator('#f_screen_width').fill('1600');
      await manager.locator('#btnSave').click();
      assert.match(await manager.locator('#profile-editor-error').innerText(),/完整的屏幕宽高/);
      await manager.waitForFunction(() => document.activeElement.id === 'f_screen_height');
      await manager.locator('#f_screen_height').fill('900');
      assert.match(await manager.locator('.profile-editor-summary').innerText(),/1600 × 900/);
    });
    await check('原生/自定义切换保留备用参数，半填备用尺寸仍可定位并修复', async () => {
      await manager.locator('#f_dpr').selectOption('1.5');
      await manager.locator('#f_display_mode').selectOption('native');
      assert.equal(await manager.locator('#f_screen_width').isDisabled(),true);
      assert.equal(await manager.locator('#f_dpr').inputValue(),'1.5');
      assert.equal(await manager.locator('#f_screen_width').inputValue(),'1600');
      await manager.locator('#f_display_mode').selectOption('custom');
      assert.equal(await manager.locator('#f_screen_height').inputValue(),'900');
      await manager.locator('#f_screen_height').fill('');
      await manager.locator('#f_display_mode').selectOption('native');
      await manager.locator('#btnSave').click();
      await manager.waitForFunction(() => document.activeElement.id === 'f_screen_height');
      assert.equal(await manager.locator('#f_display_mode').inputValue(),'native');
      assert.equal(await manager.locator('#f_screen_height').isEnabled(),true);
      assert.equal((await api('list')).length,initialProfileCount);
      await manager.locator('#f_screen_height').fill('900');
      await manager.getByRole('button',{name:'收起备用自定义参数',exact:true}).click();
      assert.equal(await manager.locator('#f_screen_height').isDisabled(),true);
      assert.match(await manager.locator('.profile-editor-summary').innerText(),/原生一致/);
      return {mode:'native',customWidth:1600,customHeight:900,customDpr:1.5,errorFocusUsable:true};
    });
    await check('起始页错误与关闭保护保留所有已输入配置', async () => {
      await manager.getByRole('button',{name:'基本信息',exact:true}).click();
      await manager.locator('#f_url').fill('file:///tmp/private');
      await manager.locator('#btnSave').click();
      await manager.waitForFunction(() => document.activeElement.id === 'f_url');
      assert.match(await manager.locator('#profile-editor-error').innerText(),/起始页需使用/);
      await manager.keyboard.press('Escape');
      await manager.getByRole('button',{name:'继续编辑',exact:true}).waitFor();
      assert.ok(await manager.locator('#modal').isVisible());
      await manager.getByRole('button',{name:'继续编辑',exact:true}).click();
      assert.equal(await manager.locator('#f_name').inputValue(),'编辑流程验证');
      assert.equal(await manager.locator('#f_proxy_port').inputValue(),'8080');
      await manager.locator('#f_url').fill('https://example.com/');
    });
    await check('窄窗浅深主题与减少动画保留可用编辑高度和保存入口', async () => {
      const measurements = [];
      for (const width of [780,500]) {
        await app.evaluate(({BrowserWindow},width) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Star Browser').setSize(width,720),width);
        for (const theme of ['light','dark']) {
          await api('preferences',{theme});
          await manager.waitForFunction(theme => document.documentElement.dataset.theme === theme,theme);
          await manager.emulateMedia({reducedMotion:'reduce'});
          await manager.waitForFunction(() => !document.querySelector('.profile-editor-summary details').open);
          const value = await layout();
          assert.ok(value.formHeight > 220,JSON.stringify(value)); assert.ok(value.footerVisible); assert.ok(value.width <= value.viewport); assert.ok(value.horizontalOverflow <= 1,JSON.stringify(value));
          assert.equal(await manager.locator('#profile-form').evaluate(el => getComputedStyle(el).scrollBehavior),'auto');
          measurements.push({width,theme,...value});
          await manager.screenshot({animations:'disabled',path:path.join(out,`editor-${theme}-${width}.png`)});
        }
      }
      return measurements;
    });
    let profile;
    await check('底部按钮焦点下快捷键经过校验，正确持久化并返回创建入口', async () => {
      await manager.locator('#btnSave').focus();
      await manager.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await manager.locator('#modal').waitFor({state:'hidden'});
      profile = (await api('list')).find(p => p.name === '编辑流程验证');
      assert.ok(profile); assert.equal(profile.country,'JP'); assert.equal(profile.proxy.type,'https'); assert.equal(profile.proxy.port,'8080');
      assert.equal(profile.fingerprint.screen.width,1600); assert.equal(profile.fingerprint.screen.height,900);
      assert.equal(profile.fingerprint.displayMode,'native'); assert.equal(profile.fingerprint.devicePixelRatio,1.5);
      assert.equal(profile.timezoneManual,false); assert.equal(profile.langManual,false);
      await manager.waitForFunction(() => document.activeElement.id === 'btnNew');
      return {saved:true,screen:profile.fingerprint.screen,manualTimezone:false};
    });
    await check('放弃修改不影响已保存环境，重新打开没有残留草稿', async () => {
      await manager.locator('#btnNew').click(); await manager.locator('#f_name').fill('不会保存的草稿');
      await manager.keyboard.press('Escape'); await manager.getByRole('button',{name:'放弃更改',exact:true}).click();
      await manager.locator('#modal').waitFor({state:'hidden'});
      assert.equal((await api('list')).length,initialProfileCount+1);
      await manager.locator('#btnNew').click(); assert.equal(await manager.locator('#f_name').inputValue(),'');
      await manager.keyboard.press('Escape'); await manager.locator('#modal').waitFor({state:'hidden'});
    });
    await check('编辑流程没有未捕获页面错误', async () => assert.deepEqual(errors,[]));
  } catch (error) {
    console.error(error); process.exitCode=1;
    if (manager) await manager.screenshot({animations:'disabled',path:path.join(out,'failure.png')}).catch(()=>{});
  } finally {
    if (app) await app.close().catch(()=>{});
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:process.exitCode?'failed':'passed',testedAt:new Date().toISOString(),results,errors},null,2)+'\n');
    fs.rmSync(dir,{recursive:true,force:true});
  }
})();
