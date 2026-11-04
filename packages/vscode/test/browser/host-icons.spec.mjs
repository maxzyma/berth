import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });
for (const theme of ['dark', 'light']) {
  test(`host products ${theme}: shared artwork, window identity and fallback`, async ({ page }, info) => {
    const manifest = process.env.BERTH_HOST_ICON_MANIFEST;
    const assets = manifest ? JSON.parse(await readFile(manifest, 'utf8')) : {};
    await page.route('**/host-icons/*', async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      if (!assets[name]) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#55aaff"/></svg>' });
      return route.fulfill({ contentType: 'image/png', body: await readFile(join(dirname(manifest), 'host-icons', assets[name])) });
    });
    await page.clock.install();
    await page.goto(`${server.url}/frame?theme=${theme}&width=300`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('tree')).toBeVisible();
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', settings: {
        indent: 8, indentGuides: 'always', details: true, hoverDelay: 80, agentIcons: '/agents',
        hostIcons: { 'VS Code': '/hosts/vscode.svg', iTerm2: '/host-icons/iTerm2', Terminal: '/host-icons/Terminal' },
      } } }));
      const original = window.identityFixture.groups[0];
      const external = original.rows.find(row => row.name === 'job-13');
      window.sendModel({ ...window.identityFixture, groups: [{ ...original, rows: [
        original.rows[0], external,
        { ...external, name: 'terminal', label: 'terminal', details: 'Terminal', location: { ...external.location, hostApplication: 'Terminal' },
          hover: external.hover.map(line => line.hostApplication ? { ...line, hostApplication: 'Terminal', text: 'Terminal' } : line) },
        { ...external, name: 'unknown', label: 'unknown', location: { ...external.location, hostApplication: 'Unrecognised host' } },
      ] }] });
    });
    await expect(frame.locator('[id="s:job-2"] .details .host-mark.current-window')).toBeVisible();
    await expect(frame.locator('[id="s:job-2"] .host-icon')).toHaveAttribute('src', '/hosts/vscode.svg');
    await expect(frame.locator('[id="s:job-13"] .current-window')).toHaveCount(0);
    await expect(frame.locator('[id="s:job-13"] .host-icon')).toHaveAttribute('src', '/host-icons/iTerm2');
    await expect(frame.locator('[id="s:terminal"] .host-icon')).toHaveAttribute('src', '/host-icons/Terminal');
    await expect(frame.locator('[id="s:unknown"] .details .codicon-terminal')).toBeVisible();
    for (const id of ['job-2', 'job-13', 'terminal']) {
      const row = frame.locator(`[id="s:${id}"]`);
      await expect(row.locator('.details')).toHaveText('');
      await expect(row.locator('.multiple-connections')).toHaveCount(id === 'job-2' ? 1 : 0);
      await expect(row.locator('.host-icon')).toHaveCSS('width', id === 'job-2' ? '14px' : '16px');
      await expect(row.locator('.host-mark')).toHaveCSS('width', '16px');
      await expect.poll(() => row.locator('.host-icon').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await page.locator('iframe').screenshot({ path: info.outputPath('host-products.png') });
    const local = frame.locator('[id="s:job-2"]');
    await local.click();
    await expect(local).toHaveClass(/selected/);
    const dot = await local.locator('.host-mark').evaluate(el => {
      const style = getComputedStyle(el, '::after');
      return { width: style.width, right: style.right, bottom: style.bottom };
    });
    expect(dot).toEqual({ width: '4px', right: '0px', bottom: '0px' });
    await frame.getByRole('tree').focus();
    await page.locator('iframe').screenshot({ path: info.outputPath('host-selected.png') });

    await frame.locator('[id="s:job-13"]').hover();
    await page.clock.runFor(100);
    await expect(frame.getByRole('dialog').locator('.host-icon')).toHaveAttribute('src', '/host-icons/iTerm2');
    await expect(frame.getByRole('dialog')).toContainText('iTerm2');
    await frame.getByRole('button', { name: 'Close details' }).click();
    await frame.locator('[id="s:terminal"] .host-icon').evaluate(img => img.dispatchEvent(new Event('error')));
    await expect(frame.locator('[id="s:terminal"] .details .codicon-terminal')).toBeVisible();
  });
}
