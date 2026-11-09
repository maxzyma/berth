import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';
let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });

test('folder groups reorder by dragging a header and by Alt+Arrow', async ({ page }) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await frame.locator('body').evaluate(() => {
    const source = window.fixture;
    const group = source.groups[0];
    const groups = ['/a', '/b', '/c'].map((cwd, index) => ({
      ...group, cwd, label: cwd.slice(1), rows: [{ ...group.rows[index], name: `job-${cwd.slice(1)}` }],
    }));
    window.sendModel({ ...source, groups, unmanaged: [] }, false);
  });
  const header = (cwd) => frame.locator(`[id="g:${cwd}"]`);
  await expect(header('/c')).toHaveAttribute('draggable', 'true');
  await header('/c').dragTo(header('/a'), { targetPosition: { x: 20, y: 3 } });
  const moves = await frame.locator('body').evaluate(() => window.messages.filter((m) => m.type === 'moveGroup'));
  expect(moves).toEqual([{ type: 'moveGroup', cwd: '/c', target: '/a', after: false }]);
  await header('/b').focus();
  await page.keyboard.press('Alt+ArrowDown');
  const shifts = await frame.locator('body').evaluate(() => window.messages.filter((m) => m.type === 'shiftGroup'));
  expect(shifts).toEqual([{ type: 'shiftGroup', cwd: '/b', delta: 1 }]);
});

test('the drop line sits above a header or below the last row of the target group', async ({ page }) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  const marks = await frame.locator('body').evaluate(async () => {
    const source = window.fixture;
    const group = source.groups[0];
    const groups = ['/a', '/b'].map((cwd) => ({
      ...group, cwd, label: cwd.slice(1), rows: group.rows.slice(0, 2).map((row) => ({ ...row, name: `${cwd.slice(1)}-${row.name}` })),
    }));
    window.sendModel({ ...source, groups, unmanaged: [] }, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const at = (id) => document.getElementById(id);
    const data = new DataTransfer();
    const fire = (el, type, top) => {
      const box = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 10, clientY: top ? box.top + 2 : box.bottom - 2 }));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
    const marked = () => [...document.querySelectorAll('.drop-before, .drop-after')].map((el) => `${el.id}:${el.classList.contains('drop-before') ? 'before' : 'after'}`);
    fire(at('g:/b'), 'dragstart', true);
    fire(at('g:/a'), 'dragover', true); await settle();
    const header = marked();
    fire(at(`s:a-${group.rows[0].name}`), 'dragover', true); await settle();
    const session = marked();
    fire(at('g:/b'), 'dragend', true); await settle();
    return { header, session, after: marked() };
  });
  expect(marks.header).toEqual(['g:/a:before']);
  expect(marks.session[0]).toMatch(/^s:a-.*:after$/);
  expect(marks.session[0]).not.toContain(':before');
  expect(marks.after).toEqual([]);
});


test('keyboard focus stays on a folder header when the new order moves it past an open group', async ({ page }) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  const send = (order) => frame.locator('body').evaluate((_, cwds) => {
    const group = window.fixture.groups[0];
    const groups = cwds.map((cwd) => ({
      ...group, cwd, label: cwd.slice(1), rows: group.rows.slice(0, 2).map((row) => ({ ...row, name: `${cwd.slice(1)}-${row.name}` })),
    }));
    window.sendModel({ ...window.fixture, groups, unmanaged: [] }, false);
  }, order);
  const header = (cwd) => frame.locator(`[id="g:${cwd}"]`);
  await send(['/a', '/b']);
  await header('/b').focus();
  await send(['/b', '/a']);
  await expect(header('/b')).toBeFocused();
});

test('Alt+Arrow on a session card still moves focus; dragging a header carries no plain text', async ({ page }) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  const cards = frame.locator('.row.card');
  await cards.first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cards.nth(1)).toBeFocused();
  await frame.locator('body').evaluate(() => {
    const group = window.fixture.groups[0];
    const groups = ['/a', '/b'].map((cwd, index) => ({ ...group, cwd, label: cwd.slice(1), rows: [{ ...group.rows[index], name: `job-${cwd.slice(1)}` }] }));
    window.sendModel({ ...window.fixture, groups, unmanaged: [] }, false);
  });
  const types = await frame.locator('[id="g:/a"]').evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }));
    return [...data.types];
  });
  expect(types).not.toContain('text/plain');
  expect(types).toEqual(['application/x-berth-group']);
});

test('the drop line and the active-terminal edge show together on one row', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/frame?theme=dark&width=300`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  const row = frame.locator('.row.card').first();
  const shadow = await row.evaluate((el) => {
    el.classList.add('terminal-active', 'drop-after');
    return getComputedStyle(el).boxShadow;
  });
  expect(shadow.match(/inset/g)).toHaveLength(2);
  await row.screenshot({ path: testInfo.outputPath('active-and-drop.png') });
});
