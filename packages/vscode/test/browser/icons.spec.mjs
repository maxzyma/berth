import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveFixture } from './fixture.mjs';

let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });

for (const theme of ['dark', 'light', 'hc', 'hclight']) {
  test(`icons ${theme}: all products, fallbacks and shared details`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
    await page.clock.install();
    await page.goto(`${server.url}/frame?theme=${theme}&width=420&height=780`);
    const f = page.frameLocator('iframe');
    await expect(f.getByRole('tree')).toBeVisible();
    await f.locator('body').evaluate(() => window.sendModel(window.iconFixture));
    const names = ['claude', 'codex', 'gemini', 'cursor', 'copilot', 'kimi', 'opencode', 'qoder'];
    for (const name of names) {
      const row = f.locator(`[id="s:${name}"]`);
      const icon = row.locator('.icon.agent');
      await expect(icon).toHaveCSS('width', '16px');
      await expect(icon).toHaveCSS('height', '16px');
      const resource = await icon.evaluate(el => { const style = getComputedStyle(el); return style.maskImage !== 'none' ? style.maskImage : style.backgroundImage; });
      const asset = new URL(resource.slice(5, -2)).pathname;
      expect(asset).toMatch(new RegExp(`/agents/${name}(?:-light)?\\.(svg|png)$`));
      // Verify the actual URL loaded by the browser, not just the declaration.
      const response = await page.request.get(`${server.url}${asset}`);
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(await readFile(new URL(`../../media${asset}`, import.meta.url)));
      const label = await row.getAttribute('aria-label');
      expect(label.split(', ').length).toBeGreaterThanOrEqual(3);
      await row.hover();
      await page.clock.runFor(100);
      const details = f.getByRole('dialog');
      await expect(details).toBeVisible();
      expect(await details.locator('.icon.agent').evaluate(el => { const style = getComputedStyle(el); return style.maskImage !== 'none' ? style.maskImage : style.backgroundImage; })).toBe(resource);
      await f.getByRole('button', { name: 'Close details' }).click();
      await expect(f.getByRole('dialog')).not.toBeVisible();
    }
    for (const name of ['shell', 'custom-agent']) {
      const row = f.locator(`[id="s:${name}"]`);
      await expect(row.locator('.icon.codicon-terminal')).toBeVisible();
      await row.hover();
      await page.clock.runFor(100);
      await expect(f.getByRole('dialog').locator('.hover-head > .codicon-terminal')).toBeVisible();
      await f.getByRole('button', { name: 'Close details' }).click();
      await expect(f.getByRole('dialog')).not.toBeVisible();
    }
    await f.getByRole('treeitem', { name: 'Other tmux sessions', exact: true }).click();
    await expect(f.locator('[id="s:unmanaged"] .icon.codicon-terminal')).toBeVisible();
    await page.mouse.move(700, 500);
    await page.clock.runFor(250);
    await page.locator('iframe').screenshot({ path: info.outputPath('icons.png') });
    expect(errors).toEqual([]);
  });
}

test('functional icons: font glyphs, spinning work and reduced motion', async ({ page }, info) => {
  await page.clock.install();
  await page.goto(`${server.url}/frame`);
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('tree')).toBeVisible();
  await f.locator('body').evaluate(() => window.sendModel(window.variants.working));
  await expect(f.locator('[id="s:03-session"] .badge .codicon-loading')).toBeVisible();
  await expect(f.locator('[id="s:03-session"] .badge .codicon-loading')).toHaveCSS('font-size', '12px');
  await expect(f.locator('[id="s:03-session"] .activity-slot')).toHaveCSS('width', '16px');
  await expect(f.locator('[id="s:03-session"] .badge')).not.toHaveText('⋯');
  await f.locator('[id="s:03-session"]').hover();
  await page.clock.runFor(100);
  const spin = f.getByRole('dialog').locator('.codicon-loading.codicon-modifier-spin');
  await expect(spin).toBeVisible();
  await expect(spin).toHaveCSS('font-size', '12px');
  expect(await spin.evaluate(el => getComputedStyle(el, '::before').content)).not.toBe('none');
  await expect(spin).toHaveCSS('animation-name', 'none');
  await f.locator('body').evaluate(el => el.classList.remove('vscode-reduce-motion'));
  await expect(spin).toHaveCSS('animation-name', 'codicon-spin');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(spin).toHaveCSS('animation-name', 'none');
  await expect(f.locator('[id="s:03-session"] .badge .codicon-loading')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(spin).toHaveCSS('animation-name', 'codicon-spin');
  await f.locator('body').evaluate(el => el.classList.add('vscode-reduce-motion'));
  const glyphs = await f.locator('.codicon').evaluateAll(els => els.map(el => ({ classes: el.className, content: getComputedStyle(el, '::before').content })));
  expect(glyphs.filter(glyph => glyph.content === 'none' || glyph.content === 'normal')).toEqual([]);
  await page.locator('iframe').screenshot({ path: info.outputPath('working.png') });
});

const functions = {
  add: 'New session', bell: 'Next attention', 'bell-dot': 'Waiting', check: 'Finished / mark read',
  'chevron-down': 'Expanded group', 'chevron-right': 'Collapsed group', 'circle-outline': 'Idle',
  close: 'Close details', comment: 'Notification', 'comment-discussion': 'Topic',
  'debug-disconnect': 'Detached', 'debug-stop': 'Stopped state', eye: 'Shown here',
  'file-directory': 'Inside workspace', folder: 'Directory path', 'folder-library': 'Outside workspace',
  'folder-opened': 'Choose folder', 'git-branch': 'Git branch', history: 'Stopped connection',
  info: 'Conversation information', 'link-external': 'Other terminal', refresh: 'Refresh sessions',
  'root-folder': 'Workspace root', sync: 'Working', terminal: 'Shell / unknown', warning: 'Missing hooks',
};

for (const theme of ['dark', 'light', 'hc', 'hclight']) {
  test(`functional catalog ${theme}: every glyph resolves`, async ({ page }, info) => {
    await page.goto(`${server.url}/frame?theme=${theme}&width=420&height=580`);
    const f = page.frameLocator('iframe');
    await expect(f.getByRole('tree')).toBeVisible();
    await f.locator('body').evaluate((body, entries) => {
      const catalog = document.createElement('div');
      catalog.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px 8px;padding:16px';
      for (const [name, meaning] of entries) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:center;gap:8px';
        const icon = document.createElement('span');
        icon.className = `codicon codicon-${name}`;
        const label = document.createElement('span');
        label.textContent = meaning;
        line.append(icon, label);
        catalog.append(line);
      }
      body.replaceChildren(catalog);
    }, Object.entries(functions));
    await f.locator('body').evaluate(() => document.fonts.ready);
    const missing = await f.locator('.codicon').evaluateAll(els => els.filter(el => ['none', 'normal', ''].includes(getComputedStyle(el, '::before').content)).map(el => el.className));
    expect(missing).toEqual([]);
    await page.locator('iframe').screenshot({ path: info.outputPath('functions.png') });
  });
}
