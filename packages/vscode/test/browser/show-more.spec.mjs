import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });

// spec §6, Show more: five rows per group, ten more per activation, reset on collapse.
test('a group shows five sessions; Show more adds ten; collapsing resets it', async ({ page }, info) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => {
    const source = window.fixture;
    const group = source.groups[0];
    const plain = { ...group.rows[0], icon: 'idle', badge: '', attention: '', unread: false };
    const rows = Array.from({ length: 23 }, (_, i) => ({ ...plain, name: `s-${i + 1}`, label: `s-${i + 1}` }));
    rows[20] = { ...rows[20], icon: 'waiting', attention: 'waiting', badge: '!' };
    window.sendModel({ ...source, groups: [{ ...group, cwd: '/a', label: 'a', rows }, { ...group, cwd: '/b', label: 'b', rows: rows.slice(0, 2).map((r) => ({ ...r, name: `b-${r.name}` })) }], unmanaged: [] }, false);
  });
  const cards = frame.locator('.row.card[id^="s:s-"]');
  const more = frame.locator('[id="m:/a"]');
  await expect(cards).toHaveCount(5);
  await expect(more).toHaveText(/Show more/);
  await expect(more).toHaveClass(/attention-waiting/);
  await expect(frame.locator('[id="m:/b"]')).toHaveCount(0);
  await page.locator('iframe').screenshot({ path: info.outputPath('show-more.png') });

  await more.click();
  await expect(cards).toHaveCount(15);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(23);
  await expect(more).toHaveCount(0);

  const header = frame.locator('[id="g:/a"]');
  await header.click();
  await expect(cards).toHaveCount(0);
  await header.click();
  await expect(cards).toHaveCount(5);
  await expect(more).toBeVisible();
});

test('the flattened top level shows five sessions and Show more', async ({ page }) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await expect(frame.locator('.row.card')).toHaveCount(5);
  await frame.getByRole('treeitem', { name: /Show more/ }).click();
  await expect(frame.locator('.row.card')).toHaveCount(14);
});

test('a pinned session leads its group with a pin mark and stays outside the limit', async ({ page }, info) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => {
    const source = window.fixture;
    const group = source.groups[0];
    const plain = { ...group.rows[0], icon: 'idle', badge: '', attention: '', unread: false, pinned: false };
    const rows = Array.from({ length: 8 }, (_, i) => ({ ...plain, name: `s-${i + 1}`, label: `s-${i + 1}` }));
    rows.unshift({ ...plain, name: 'pinned', label: 'pinned', pinned: true });
    window.sendModel({ ...source, groups: [{ ...group, cwd: '/a', label: 'a', rows }], unmanaged: [] }, false);
  });
  await expect(frame.locator('.row.card').first()).toHaveId('s:pinned');
  await expect(frame.locator('[id="s:pinned"] .pin-mark')).toBeVisible();
  await expect(frame.locator('[id="s:s-1"] .pin-mark')).toHaveCount(0);
  await expect(frame.locator('.row.card[id^="s:s-"]')).toHaveCount(5);
  await page.locator('iframe').screenshot({ path: info.outputPath('pinned.png') });
});
