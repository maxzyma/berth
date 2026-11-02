import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });
for (const theme of ['dark', 'light']) {
  test(`copy ${theme}: raw values, host acknowledgement, keyboard and failure`, async ({ page }, info) => {
    await page.clock.install();
    await page.goto(`${server.url}/frame?theme=${theme}&width=300`);
    const f = page.frameLocator('iframe');
    await expect(f.getByRole('tree')).toBeVisible();
    await f.locator('body').evaluate(() => sendModel(identityFixture));
    await f.locator('[id="s:job-2"]').hover();
    await page.clock.runFor(100);
    const dialog = f.getByRole('dialog');
    for (const [label, value] of [
      ['session name', 'job-2'], ['agent name', 'Codex CLI'],
      ['task text', 'Review changes before merging'], ['folder path', '/workspace/product'],
      ['agent profile', '/workspace/home/.codex'],
      ['conversation title', 'Repair saved search'], ['conversation ID', '11111111-2222-3333-4444-555555555555'],
    ]) {
      const button = dialog.getByRole('button', { name: `Copy ${label}`, exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('status')).toHaveText(`Copied ${label}.`);
      expect(await f.locator('body').evaluate(() => messages.filter(m => m.type === 'copy').at(-1).value)).toBe(value);
      await expect(dialog).toBeVisible();
    }
    await f.locator('body').evaluate(() => { window.copyFailure = true; });
    await dialog.getByRole('button', { name: 'Copy folder path', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Could not copy. Try again.');
    await f.locator('body').evaluate(() => { window.copyFailure = false; });
    await dialog.getByRole('button', { name: 'Copy folder path', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Copied folder path.');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(553);
    expect(await f.locator('body').evaluate(() => messages.some(m => m.type === 'show'))).toBe(false);
    await page.locator('iframe').screenshot({ path: info.outputPath('copy.png') });
  });
}


test('live details update preserves copy focus and falls back when the action disappears', async ({ page }) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?width=300`);
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('tree')).toBeVisible();
  await page.mouse.move(850, 600);
  await f.locator('[id="s:03-session"]').focus();
  await page.clock.runFor(100);
  const copy = f.getByRole('button', { name: 'Copy session name', exact: true });
  await copy.focus();
  await f.locator('body').evaluate(() => sendModel(variants.working));
  await page.clock.runFor(50);
  await expect(copy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(f.getByRole('status')).toHaveText('Copied session name.');
  await f.getByRole('button', { name: 'Copy conversation ID', exact: true }).focus();
  await f.locator('body').evaluate(() => sendModel(variants.shell));
  await page.clock.runFor(50);
  await expect(f.locator('.hover-content')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(f.locator('[id="s:03-session"]')).toBeFocused();
});

test('connection copies retain the same value when several actions share a label', async ({ page }) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame?width=300`);
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('tree')).toBeVisible();
  await f.locator('body').evaluate(() => sendModel(identityFixture));
  await page.mouse.move(850, 600);
  await f.locator('[id="s:job-2"]').focus();
  await page.clock.runFor(100);
  const copies = f.getByRole('button', { name: 'Copy connection', exact: true });
  await expect(copies).toHaveCount(2);
  const value = await copies.nth(1).getAttribute('data-copy-value');
  await copies.nth(1).focus();
  await f.locator('body').evaluate(() => {
    const changed = structuredClone(identityFixture);
    const change = (item) => {
      if (!item || typeof item !== 'object') return;
      if (item.copyLabel === 'task text') item.text = item.full = item.copyValue = 'Updated task';
      for (const value of Object.values(item)) {
        if (Array.isArray(value)) value.forEach(change);
        else if (value && typeof value === 'object') change(value);
      }
    };
    change(changed);
    sendModel(changed);
  });
  await page.clock.runFor(50);
  await expect(copies.nth(1)).toBeFocused();
  expect(await copies.nth(1).getAttribute('data-copy-value')).toBe(value);
});


test('pending clipboard acknowledgement preserves focus and suppresses duplicate activation', async ({ page }) => {
  await page.goto(`${server.url}/frame?width=300`);
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('tree')).toBeVisible();
  await f.locator('body').evaluate(() => { window.deferCopy = true; });
  const row = f.locator('[id="s:03-session"]');
  await row.focus();
  const button = f.getByRole('button', { name: 'Copy session name', exact: true });
  await expect(button).toBeVisible();
  await button.focus();
  for (const success of [true, false]) {
    await page.keyboard.press('Enter');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await f.locator('body').evaluate(() => messages.filter(m => m.type === 'copy').length)).toBe(success ? 1 : 2);
    await f.locator('body').evaluate((_body, ok) => {
      const request = messages.filter(m => m.type === 'copy').at(-1);
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'copyResult', id: request.id, success: ok } }));
    }, success);
    await expect(f.getByRole('status')).toHaveText(success ? 'Copied session name.' : 'Could not copy. Try again.');
    await expect(button).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
});
