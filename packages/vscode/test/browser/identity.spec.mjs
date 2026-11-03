import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });
for (const theme of ['dark', 'light']) {
  test(`identity ${theme}: current window, multiple clients, title and exact ID`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(`${server.url}/frame?theme=${theme}&width=300`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('tree')).toBeVisible();
    await frame.locator('body').evaluate(() => window.sendModel(window.identityFixture));
    const row = frame.locator('[id="s:job-2"]');
    await expect(row.locator('.details')).toHaveAttribute('aria-label', 'VS Code · This window +1');
    await expect(row.locator('.details')).toHaveText('+1');
    await expect(row.locator('.host-mark.current-window')).toHaveCount(1);
    await expect(frame.locator('[id="s:job-3"] .details')).toHaveAttribute('aria-label', 'detached');
    await expect(frame.locator('[id="s:job-3"] .details')).toHaveText('');
    await expect(frame.locator('[id="s:job-13"] .details')).toHaveAttribute('aria-label', 'iTerm2');
    await expect(frame.locator('[id="s:job-13"] .details')).toHaveText('');
    await row.hover();
    await page.clock.runFor(100);
    const dialog = frame.getByRole('dialog');
    await expect(dialog).toContainText('Repair saved search');
    await expect(dialog).toContainText('iTerm2');
    await expect(dialog).toContainText('11111111-2222-3333-4444-555555555555');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator('iframe').screenshot({ path: info.outputPath('identity.png') });
    expect(errors).toEqual([]);
  });
}


test('unknown saved profile has an explicit recovery instruction', async ({ page }) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => window.sendModel(window.variants.unknownProfile));
  await frame.locator('[id="s:03-session"]').hover();
  await page.clock.runFor(100);
  await expect(frame.getByRole('dialog')).toContainText('Choose Recovery Profile before resuming this conversation.');
});


test('legacy launch options show a review action before recovery', async ({ page }, info) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => window.sendModel(window.variants.legacyOptions));
  await frame.locator('[id="s:03-session"]').hover();
  await page.clock.runFor(100);
  await expect(frame.getByRole('dialog')).toContainText('Review Recovery Options before resuming');
  await page.locator('iframe').screenshot({ path: info.outputPath('legacy-options.png') });
});


test('window membership is not selection and recovery readiness stays in details', async ({ page }, info) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => {
    const model = structuredClone(window.identityFixture);
    model.groups = model.groups.map(group => ({ ...group, rows: group.rows.map((row, i) => ({
      ...row, active: i === 0,
      contextValue: row.contextValue + ' attached-here',
    })) }));
    window.sendModel(model);
  });
  await expect(frame.locator('.binding-warning')).toHaveCount(0);
  await expect(frame.locator('.row.selected')).toHaveCount(0);
  await expect(frame.locator('.row.terminal-active')).toHaveCount(1);
  const second = frame.locator('[id="s:job-3"]');
  await second.click();
  await expect(frame.locator('.row.selected')).toHaveCount(1);
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(frame.locator('[id="s:job-2"]')).toHaveAttribute('aria-selected', 'false');
  await expect(frame.locator('.row.terminal-active')).toHaveCount(1);
  await page.locator('iframe').screenshot({ path: info.outputPath('state-separation.png') });
});


test('stopped-session details exposes recovery check for the exact session', async ({ page }) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => window.sendModel(window.variants.stopped));
  await frame.locator('[id="s:03-session"]').hover();
  await page.clock.runFor(100);
  await frame.getByRole('button', { name: 'Check Recovery Readiness' }).click();
  await expect(frame.getByRole('dialog')).toBeHidden();
  expect(await frame.locator('body').evaluate(() => window.messages.filter(m => m.type === 'checkRecovery'))).toEqual([{ type: 'checkRecovery', session: '03-session' }]);
});

test('live unbound session does not delegate internal diagnosis to the user', async ({ page }, info) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => window.sendModel(window.variants.unboundLive));
  await frame.locator('[id="s:03-session"]').hover();
  await page.clock.runFor(100);
  const dialog = frame.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('producer changed');
  await expect(dialog).not.toContainText('not bound');
  await expect(dialog).not.toContainText('profile is not verified');
  await expect(dialog.getByRole('button', { name: 'Check Recovery Readiness' })).toHaveCount(0);
  await page.locator('iframe').screenshot({ path: info.outputPath('live-details.png') });
});

for (const width of [180, 300]) {
  test(`two-line rows preserve task priority and connection details at ${width}px`, async ({ page }, info) => {
    await page.goto(`${server.url}/frame?theme=dark&width=${width}`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('tree')).toBeVisible();
    await frame.locator('body').evaluate(() => window.sendModel({
      ...window.identityFixture,
      groups: window.identityFixture.groups.map(group => ({ ...group, rows: group.rows.map((row, i) => ({
        ...row, subtitle: i === 2 ? '检查会话列表的状态显示、恢复逻辑以及兼容性问题' : i === 1 ? '' : row.subtitle,
      })) })),
    }));
    const rows = frame.locator('.card');
    expect(await rows.evaluateAll(elements => elements.every(row =>
      row.querySelectorAll(':scope > .line').length <= 2 && row.scrollWidth <= row.clientWidth
    ))).toBe(true);
    const row = frame.locator('[id="s:job-13"]');
    const task = await row.locator('.subtitle').boundingBox();
    const location = await row.locator('.details').boundingBox();
    expect(task.width).toBeGreaterThan(location.width);
    expect(task.y).toBeGreaterThan(location.y);
    await expect(frame.locator('[id="s:job-3"] > .line')).toHaveCount(1);
    const before = await row.locator('.details').boundingBox();
    await row.evaluate(() => window.sendModel({
      ...window.identityFixture,
      groups: window.identityFixture.groups.map(group => ({ ...group, rows: group.rows.map(item => ({ ...item, subtitle: '' })) })),
    }));
    const after = await row.locator('.details').boundingBox();
    expect(after.x).toBe(before.x);
    await row.evaluate(() => window.sendModel({
      ...window.identityFixture,
      groups: window.identityFixture.groups.map(group => ({ ...group, rows: group.rows.map(item => ({ ...item, subtitle: '', icon: 'waiting', badge: '!' })) })),
    }));
    expect((await row.locator('.details').boundingBox()).x).toBe(before.x);
    await expect(row.locator('.details')).toHaveText('');
    await expect(row.locator('.supporting')).toHaveCount(0);
    await row.evaluate(() => window.sendModel({
      ...window.identityFixture,
      groups: window.identityFixture.groups.map(group => ({ ...group, rows: group.rows.map(item => ({
        ...item, subtitle: item.name === 'job-13' ? '检查会话列表的状态显示、恢复逻辑以及兼容性问题' : '',
      })) })),
    }));
    await page.locator('iframe').screenshot({ path: info.outputPath(`two-lines-${width}.png`) });
    await frame.locator('body').evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'settings', settings: { indent: 8, indentGuides: 'always', details: false, hoverDelay: 80, agentIcons: '/agents' } },
    })));
    await expect(frame.locator('.card .details')).toHaveCount(0);
    await expect(row.locator('.subtitle')).toContainText('检查会话列表的状态显示');
    await expect(frame.locator('[id="s:job-3"] > .line')).toHaveCount(1);
  });
}
