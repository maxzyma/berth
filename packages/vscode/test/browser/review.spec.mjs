import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });

test('whole journey: list, empty entry, recovery and stopped session', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto(`${server.url}/frame?width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await page.locator('iframe').screenshot({ path: info.outputPath('01-list.png') });
  await frame.locator('body').evaluate(() => window.sendModel({ groups: [], unmanaged: [], waiting: 0 }, false));
  const start = frame.getByRole('button', { name: 'New Session' });
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press('Enter');
  expect(await frame.locator('body').evaluate(() => messages.some(m => m.type === 'new'))).toBe(true);
  await page.locator('iframe').screenshot({ path: info.outputPath('02-empty.png') });
  await frame.locator('body').evaluate(() => {
    sendModel(fixture);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'tmux could not be reached.' } }));
  });
  await expect(frame.getByRole('alert')).toContainText('last available session list');
  await frame.getByRole('button', { name: 'Retry' }).click();
  expect(await frame.locator('body').evaluate(() => messages.some(m => m.type === 'retry'))).toBe(true);
  await page.locator('iframe').screenshot({ path: info.outputPath('03-recovery.png') });
  await frame.locator('body').evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: '' } }));
    sendModel(variants.stopped);
  });
  await expect(frame.getByRole('alert')).toHaveCount(0);
  const row = frame.locator('[id="s:03-session"]');
  // A keyboard user reaches the row: details follow keyboard focus, not focus a click leaves.
  await row.focus();
  await page.keyboard.press('ArrowRight'); // No effect on a session row; marks keyboard use.
  await row.evaluate((el) => { el.blur(); el.focus(); });
  await page.clock.runFor(100);
  await expect(frame.getByRole('dialog')).toContainText('Stopped');
  await page.locator('iframe').screenshot({ path: info.outputPath('04-stopped.png') });
  expect(errors).toEqual([]);
});
