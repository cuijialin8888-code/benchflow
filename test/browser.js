import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from '../server.js';
import { validateWorkspace } from '../src/model.js';

const require = createRequire(import.meta.url);
const { chromium } = process.env.BENCHFLOW_PLAYWRIGHT
  ? require(path.join(process.env.BENCHFLOW_PLAYWRIGHT, 'index.js'))
  : await import('playwright');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results', { recursive: true });
let browser;
const errors = [];
let checks = 0;
async function step(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BENCHFLOW_BROWSER ? { executablePath: process.env.BENCHFLOW_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const modal = page.locator('#modal');
  const save = async label => { await modal.getByRole('button', { name: label, exact: true }).click(); await modal.waitFor({ state: 'hidden' }); };

  await step('create project and experiment through real forms', async () => {
    await page.getByRole('button', { name: 'Create a project', exact: true }).click();
    await modal.getByLabel('Project name', { exact: true }).fill('Regression Lab');
    await modal.getByLabel('Description', { exact: true }).fill('Synthetic browser test.');
    await save('Save');
    await page.getByRole('button', { name: 'New experiment', exact: true }).click();
    await modal.getByLabel('Experiment name', { exact: true }).fill('Curve comparison');
    await modal.getByLabel('Y axis label', { exact: true }).fill('Mass');
    await modal.getByLabel('Y unit', { exact: true }).fill('g');
    await save('Save experiment');
    assert.equal(await page.locator('.experiment-tab.active').textContent(), 'Curve comparison');
  });
  await step('create and update run status', async () => {
    await page.getByRole('button', { name: 'New run', exact: true }).click();
    await modal.getByLabel('Run name', { exact: true }).fill('Pilot run');
    await modal.getByLabel('Sample ID', { exact: true }).fill('S-001');
    await save('Save run');
    await page.getByLabel('Status: Pilot run', { exact: true }).selectOption('running');
    await page.locator('.column').filter({ has: page.locator('.column-head.running') }).getByRole('heading', { name: 'Pilot run', exact: true }).waitFor();
  });
  await step('preview CSV, reject duplicate X, then import valid points', async () => {
    await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'replicate.csv', mimeType: 'text/csv', buffer: Buffer.from('time,value\n0,1\n0,2') });
    await page.locator('.form-error').filter({ hasText: 'unique' }).waitFor();
    await modal.getByRole('button', { name: 'Import run', exact: true }).click();
    assert.equal(await modal.isVisible(), true);
    await page.locator('#csv-file').setInputFiles({ name: 'replicate.csv', mimeType: 'text/csv', buffer: Buffer.from('time,value\n0,1\n10,3\n20,5') });
    await page.locator('#point-preview').filter({ hasText: '3 points' }).waitFor();
    await save('Import run');
    await page.getByRole('heading', { name: 'replicate', exact: true }).waitFor();
    assert.match(await page.locator('.run-card').filter({ has: page.getByRole('heading', { name: 'replicate', exact: true }) }).textContent(), /3 points/);
  });
  await step('persistent data survives reload', async () => {
    await page.reload();
    await page.locator('[data-view=runs]').click();
    await page.getByRole('heading', { name: 'replicate', exact: true }).waitFor();
  });
  await step('duplicating setup never duplicates measurements', async () => {
    await page.getByRole('button', { name: 'Duplicate setup: replicate', exact: true }).click();
    const card = page.locator('.run-card').filter({ has: page.getByRole('heading', { name: 'replicate · copy', exact: true }) });
    await card.waitFor(); assert.match(await card.textContent(), /0 points/);
  });
  await step('search filters runs and notebook safely', async () => {
    await page.getByLabel('Search runs and notes', { exact: true }).fill('S-001');
    assert.equal(await page.locator('.run-card').count(), 1);
    await page.locator('[data-view=notebook]').click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await modal.getByLabel('Note title', { exact: true }).fill('Observations');
    await modal.getByLabel('Observations and context', { exact: true }).fill('<img src=x onerror=alert(1)>\nPreserve this literally.');
    await save('Save note');
    assert.equal(await page.locator('.note-body img').count(), 0);
    assert.match(await page.locator('.note-body').textContent(), /<img/);
  });
  await step('selected-run statistics and standalone SVG download work', async () => {
    await page.locator('[data-view=analysis]').click();
    await page.getByRole('button', { name: 'Mean ± SD', exact: true }).click();
    await page.getByRole('heading', { name: 'Group summary', exact: true }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 3);
    assert.match(await page.locator('tbody tr').first().textContent(), /Control/);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
    const download = await pending;
    await download.saveAs('test-results/chart.svg');
    assert.match(await readFile('test-results/chart.svg', 'utf8'), /<svg/);
    await page.getByLabel('replicate', { exact: true }).uncheck();
    await page.getByRole('heading', { name: 'Your next discovery starts with data.', exact: true }).waitFor();
  });
  let savedBackup;
  await step('backup download contains all projects, runs and notes', async () => {
    await page.locator('[data-view=settings]').click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup', exact: true }).click();
    const download = await pending; await download.saveAs('test-results/backup.json');
    savedBackup = await readFile('test-results/backup.json', 'utf8');
    const data = validateWorkspace(JSON.parse(savedBackup));
    assert.equal(data.runs.length, 3); assert.equal(data.notes.length, 1);
  });
  await step('delete and undo restore the previous complete workspace', async () => {
    await page.getByRole('button', { name: 'Delete project: Regression Lab', exact: true }).click();
    await save('Delete project');
    await page.getByRole('button', { name: 'Restore previous save', exact: true }).click();
    await save('Restore previous save');
    await page.getByRole('button', { name: 'Edit project: Regression Lab', exact: true }).waitFor();
  });
  await step('invalid backup does not replace data; valid backup requires confirmation', async () => {
    await page.locator('#backup-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
    await page.locator('#toast').filter({ hasText: 'Unsupported backup' }).waitFor();
    await page.getByRole('button', { name: 'Edit project: Regression Lab', exact: true }).waitFor();
    await page.locator('#backup-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(savedBackup) });
    await modal.getByRole('heading', { name: 'Restore this backup?', exact: true }).waitFor();
    await save('Replace workspace');
  });
  await step('concurrent tabs cannot overwrite a newer saved revision', async () => {
    const second = await context.newPage(); await second.goto(base);
    await second.getByRole('button', { name: 'Edit project', exact: true }).click();
    await second.locator('#modal').getByLabel('Project name', { exact: true }).fill('Stale edit');
    await page.getByRole('button', { name: 'Edit project: Regression Lab', exact: true }).click();
    await modal.getByLabel('Project name', { exact: true }).fill('Fresh edit'); await save('Save');
    await second.locator('#modal').getByRole('button', { name: 'Save', exact: true }).click();
    await second.locator('.form-error').filter({ hasText: 'Another tab saved changes' }).waitFor();
    await second.close();
    assert.equal(await page.getByRole('button', { name: 'Edit project: Fresh edit', exact: true }).count(), 1);
  });
  await step('demo, desktop layout and mobile layout render without overflow', async () => {
    await page.getByRole('button', { name: 'Load synthetic demo', exact: true }).click();
    await save('Replace with demo');
    await page.getByRole('heading', { name: 'Workspace overview', exact: true }).waitFor();
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.locator('[data-view=analysis]').click();
    await page.getByRole('button', { name: 'Mean ± SD', exact: true }).click();
    await page.screenshot({ path: 'test-results/analysis.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ['overview', 'runs', 'analysis', 'notebook', 'settings']) {
      await page.locator(`[data-view=${view}]`).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Mobile overflow on ${view}`);
    }
    await page.locator('[data-view=runs]').click();
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  });
  await step('cached app reloads offline and retains local data', async () => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: 'Workspace overview', exact: true }).waitFor();
    assert.equal(await page.locator('.metric-value').nth(1).textContent(), '9');
    await context.setOffline(false);
  });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`Browser acceptance passed: ${checks} scenarios, zero uncaught errors.`);
} catch (error) {
  console.error(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: 'test-results/failure.png', fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText().catch(() => '')).slice(-2200));
    break;
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
