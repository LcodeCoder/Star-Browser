'use strict';
const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../src/main/store');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'star-environment-workspace-'));
const out = path.resolve('test-results/environment-workspace');
fs.mkdirSync(out, {recursive: true});
const results = [], errors = [];
let app, manager;
async function api(method, ...args) {
  return manager.evaluate(({method, args}) => window.api[method](...args), {method, args});
}
async function check(name, test) {
  const detail = await test();
  results.push({name, status: 'passed', ...detail});
  console.log('PASS', name);
}
async function waitForRows(count) {
  await manager.waitForFunction(count => document.querySelectorAll('#rows tr').length === count, count);
}
async function waitForCount(count) {
  await manager.waitForFunction(count => document.querySelector('#batchCount')?.textContent === `已选 ${count} 个`, count);
}
async function firstSelected() {
  return manager.locator('#rows tr input[type=checkbox]').first();
}
async function size(width) {
  await app.evaluate(({BrowserWindow}, width) => {
    const window = BrowserWindow.getAllWindows().find(window => !window._profile);
    window.setMinimumSize(400, 500);
    window.setContentSize(width, 768);
  }, width);
  await manager.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

(async () => {
  try {
    const store = new Store(path.join(data, 'data'));
    store.transaction(() => {
      for (let index = 1; index <= 81; index++) store.create({
        name: '环境 ' + String(index).padStart(3, '0') + (index === 1 ? ' · 多地区产品测试与资料整理 · 长名称保留完整提示' : ''),
        tags: [index <= 3 ? '研究' : '日常'],
        os: index % 2 ? 'mac' : 'win', country: index % 2 ? 'US' : 'JP',
        proxy: index === 1 ? {type: 'socks5', host: 'proxy.research.example.test', port: '1080'} : null
      });
    });
    app = await _electron.launch({args: ['.'], cwd: process.cwd(),
      env: {...process.env, TFB_TEST_MODE: '1', TFB_USER_DATA_DIR: data}, timeout: 30000});
    manager = await app.firstWindow();
    manager.on('pageerror', error => errors.push(error.message));
    await manager.locator('#btnNew').waitFor();
    await manager.getByLabel('排序方式').selectOption('name');
    await waitForRows(75);

    await check('部分选中显示原生半选状态，行状态与批量选择一致', async () => {
      await (await firstSelected()).check();
      await waitForCount(1);
      assert.equal(await manager.locator('#selAll').evaluate(input => input.indeterminate), true);
      assert.equal(await manager.locator('#rows tr').first().getAttribute('aria-selected'), 'true');
      await manager.locator('.profile-name').first().click();
      assert.equal(await manager.locator('#rows tr[aria-selected=true]').count(), 1);
      await manager.locator('#drawerClose').click();
      await manager.locator('#batchClear').click();
      assert.equal(await manager.locator('#selAll').evaluate(input => input.indeterminate), false);
    });

    await check('跨页全选累加，取消本页选择保留其他页', async () => {
      await manager.locator('#selAll').check();
      await waitForCount(75);
      await manager.getByRole('button', {name: '下一页', exact: true}).click();
      await waitForRows(6);
      assert.equal(await manager.locator('#selAll').isChecked(), false);
      await manager.locator('#selAll').check();
      await waitForCount(81);
      await manager.locator('#selAll').uncheck();
      await waitForCount(75);
      await manager.getByRole('button', {name: '上一页', exact: true}).click();
      await waitForRows(75);
      assert.equal(await manager.locator('#selAll').isChecked(), true);
      await manager.locator('#batchClear').click();
    });

    await check('翻页重置列表滚动，排序保留已选环境', async () => {
      await (await firstSelected()).check();
      const selected = await manager.locator('#rows tr').first().getAttribute('data-profile-id');
      await manager.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await manager.locator('.environment-table').evaluate(element => element.scrollTo({top: element.scrollHeight, behavior: 'instant'}));
      await manager.waitForFunction(() => document.querySelector('.environment-table').scrollTop > 0);
      await manager.getByRole('button', {name: '下一页', exact: true}).click();
      await waitForRows(6);
      assert.equal(await manager.locator('.environment-table').evaluate(element => element.scrollTop), 0);
      await manager.getByLabel('排序方式').selectOption('created');
      await waitForRows(75);
      await waitForCount(1);
      assert.equal(await manager.locator('#batchCount').innerText(), '已选 1 个');
      await manager.getByLabel('排序方式').selectOption('name');
      await manager.locator(`[data-profile-id="${selected}"] input[type=checkbox]`).waitFor();
      assert.equal(await manager.locator(`[data-profile-id="${selected}"] input[type=checkbox]`).isChecked(), true);
      await manager.locator('#batchClear').click();
    });

    await check('搜索和标签改变后清除旧选择，清空搜索回到第一页', async () => {
      await (await firstSelected()).check();
      await manager.locator('#search').fill('环境 080');
      await waitForRows(1);
      assert.equal(await manager.locator('#batchBar').count(), 0);
      await (await firstSelected()).check();
      await manager.getByRole('button', {name: '清除搜索', exact: true}).click();
      await waitForRows(75);
      assert.equal(await manager.locator('#batchBar').count(), 0);
      await (await firstSelected()).check();
      await manager.getByLabel('筛选标签').selectOption('研究');
      await waitForRows(3);
      assert.equal(await manager.locator('#batchBar').count(), 0);
      await manager.getByLabel('筛选标签').selectOption('');
      await waitForRows(75);
    });

    await check('删除当前页全部环境后自动回到有效页并清除失效选择', async () => {
      await manager.getByRole('button', {name: '下一页', exact: true}).click();
      await waitForRows(6);
      const ids = await manager.locator('#rows tr').evaluateAll(rows => rows.map(row => row.dataset.profileId));
      await manager.locator('#selAll').check();
      await waitForCount(6);
      for (const id of ids) await api('remove', id);
      await waitForRows(75);
      await manager.waitForFunction(() => !document.querySelector('#batchBar'));
      assert.match(await manager.locator('.list-footer').innerText(), /1–75，共 75 个环境/);
      assert.equal(await manager.getByRole('button', {name: '上一页', exact: true}).count(), 0);
      assert.equal(await manager.locator('#selAll').isChecked(), false);
      assert.equal(await manager.locator('#selAll').evaluate(input => input.indeterminate), false);
    });

    await check('等宽字段、长名称和操作在宽窄窗口及详情栏中不溢出', async () => {
      const measurements = [];
      async function measure(width, detail, theme) {
        await size(width);
        const result = await manager.evaluate(() => {
          const table = document.querySelector('.environment-table');
          const headers = Array.from(table.querySelectorAll('th')).filter(cell => getComputedStyle(cell).display !== 'none');
          const cells = Array.from(table.querySelector('tbody tr').cells).filter(cell => getComputedStyle(cell).display !== 'none');
          return {
            columns: headers.slice(1).map(cell => cell.getBoundingClientRect().width),
            cellOverflow: Math.max(...cells.map(cell => cell.scrollWidth - cell.clientWidth)),
            actionOverflow: Math.max(...Array.from(table.querySelectorAll('.row-actions')).map(element => element.scrollWidth - element.clientWidth)),
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
            name: table.querySelector('.profile-name').title
          };
        });
        assert.ok(Math.max(...result.columns) - Math.min(...result.columns) <= 1);
        assert.equal(result.cellOverflow, 0);
        assert.equal(result.actionOverflow, 0);
        assert.equal(result.pageOverflow, 0);
        assert.match(result.name, /长名称保留完整提示/);
        measurements.push({width, detail, theme, ...result});
        if ([1440, 780, 500].includes(width) || detail || theme === 'dark') {
          await manager.screenshot({path: path.join(out, `environment-${theme}-${detail ? 'detail-' : ''}${width}.png`)});
        }
      }
      await api('preferences', {theme: 'light'});
      await manager.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      for (const width of [1440, 1280, 1100, 930, 780, 640, 500]) await measure(width, false, 'light');
      await size(1280);
      await manager.locator('.profile-name').first().click();
      for (const width of [1280, 1100, 780]) await measure(width, true, 'light');
      await manager.locator('#drawerClose').click();
      await api('preferences', {theme: 'dark', density: 'compact'});
      await manager.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await measure(1280, false, 'dark');
      return {measurements};
    });
    await check('工作台没有未处理的脚本错误', async () => assert.deepEqual(errors, []));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    results.push({name: '环境工作区验证', status: 'failed', error: error.stack});
    if (manager && !manager.isClosed()) await manager.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
  } finally {
    if (app) await app.close().catch(() => {});
    fs.writeFileSync(path.join(out, 'environment-workspace.json'), JSON.stringify({
      status: process.exitCode ? 'failed' : 'passed', testedAt: new Date().toISOString(), results
    }, null, 2) + '\n');
    fs.rmSync(data, {recursive: true, force: true, maxRetries: 6, retryDelay: 200});
  }
})();
