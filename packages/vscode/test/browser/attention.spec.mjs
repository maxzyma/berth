import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });
for (const theme of ['dark', 'light', 'hc', 'hclight']) {
  test(`attention hierarchy ${theme}`, async ({ page }, info) => {
    await page.goto(`${server.url}/frame?theme=${theme}&width=300`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('tree')).toBeVisible();
    await frame.locator('body').evaluate(() => {
      const source = window.variants.unread;
      const rows = ['waiting', 'unread', 'working', 'literal'].map(key => ({
        ...window.variants[key].groups[0].rows[0], name: key, label: key,
      }));
      window.sendModel({ ...source, groups: [{ ...source.groups[0], rows }] });
    });
    const unread = frame.locator('[id="s:unread"]');
    const waiting = frame.locator('[id="s:waiting"]');
    const working = frame.locator('[id="s:working"]');
    await expect(unread.locator('.badge')).toHaveAttribute('aria-label', 'finished, unread');
    await expect(unread.locator('.codicon-pass-filled')).toHaveCSS('font-size', '12px');
    await expect(unread.locator('.badge')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const colors = await unread.evaluate(el => ({
      name: getComputedStyle(el.querySelector('.name')).color,
      row: getComputedStyle(el).color,
    }));
    expect(colors.name).not.toBe(colors.row);
    expect(colors.name).toBe(await unread.locator('.badge').evaluate(el => getComputedStyle(el).color));
    await expect(unread.locator('.name')).toHaveCSS('font-weight', '400');
    await expect(waiting.locator('.subtitle')).toContainText('Allow the export command');
    expect(await waiting.locator('.badge').evaluate(el => getComputedStyle(el).color))
      .toBe(await waiting.locator('.subtitle').evaluate(el => getComputedStyle(el).color));
    await expect(working.locator('.codicon-loading')).toHaveCSS('font-size', '12px');
    const hostBefore = await unread.locator('.details').boundingBox();
    await page.locator('iframe').screenshot({ path: info.outputPath('attention.png') });
    await unread.evaluate(el => el.classList.add('selected'));
    await unread.focus();
    await expect(unread.locator('.subtitle')).toHaveCSS('opacity', '1');
    expect(await unread.locator('.name').evaluate(el => getComputedStyle(el).color))
      .toBe(await unread.evaluate(el => getComputedStyle(el).color));
    await expect(working.locator('.badge')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect((await unread.locator('.details').boundingBox()).x).toBe(hostBefore.x);
    await page.locator('iframe').screenshot({ path: info.outputPath('attention-selected.png') });
  });
}
