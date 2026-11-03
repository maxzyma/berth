import { test, expect } from '@playwright/test';
import { serveFixture } from './fixture.mjs';

let server;
test.beforeAll(async () => { server = await serveFixture(); });
test.afterAll(async () => { await server.close(); });

async function load(page, query = '') {
  await page.clock.install();
  await page.goto(`${server.url}/frame?${query}`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('tree')).toBeVisible();
  await page.clock.runFor(20);
  return frame;
}
async function open(page, frame, name = '03-session') {
  const row = frame.locator(`[id="s:${name}"]`);
  await row.hover();
  await page.clock.runFor(100);
  await expect(frame.getByRole('dialog')).toBeVisible();
  return row;
}
async function enter(page, frame, row) {
  const r = await row.boundingBox();
  const h = await frame.getByRole('dialog').boundingBox();
  const below = h.y >= r.y + r.height;
  const x = Math.max(h.x + 16, r.x + r.width / 2);
  await page.mouse.move(x, below ? r.y + r.height - 1 : r.y + 1);
  await page.mouse.move(x, below ? r.y + r.height + 4 : r.y - 4);
  await page.clock.runFor(1000); // A slow user can pause in the transition gap.
  await expect(frame.getByRole('dialog')).toBeVisible();
  await page.mouse.move(x, below ? h.y + 35 : h.y + h.height - 15);
  await page.clock.runFor(1000);
  await expect(frame.getByRole('dialog')).toBeVisible();
}

for (const theme of ['dark', 'light', 'hc']) {
  for (const width of [240, 300, 420]) {
    test(`visual ${theme} ${width}: enter, read and close`, async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const f = await load(page, `theme=${theme}&width=${width}`);
      const row = await open(page, f);
      await enter(page, f, row);
      const box = await f.getByRole('dialog').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
      expect(box.y + box.height).toBeLessThanOrEqual(553);
      await page.locator('iframe').screenshot({ path: info.outputPath('details.png') });
      const close = f.getByRole('button', { name: 'Close details' });
      const closeBox = await close.boundingBox();
      await close.click();
      // Removing an overlay exposes a different row without moving the pointer.
      await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
      await page.clock.runFor(500);
      await expect(f.getByRole('dialog')).toBeHidden();
      expect(errors).toEqual([]);
      expect(await f.locator('body').evaluate(() => messages.filter(m => m.type === 'show'))).toEqual([]);
    });
  }
}

test('pointer lifecycle: delay cancellation, gap, selection, Escape and no ghost reopen', async ({ page }, info) => {
  const f = await load(page);
  const row = f.locator('[id="s:03-session"]');
  await row.hover();
  await page.mouse.move(850,600);
  await page.clock.runFor(1000);
  await expect(f.getByRole('dialog')).toBeHidden();
  await open(page, f);
  await enter(page, f, row);
  const text = f.getByRole('dialog').locator('.hover-line.path .text');
  await text.dblclick();
  expect(await text.evaluate(() => getSelection().toString().length)).toBeGreaterThan(0);
  await page.locator('iframe').screenshot({ path: info.outputPath('selection.png') });
  await text.dispatchEvent('contextmenu');
  await expect(f.getByRole('dialog')).toBeVisible();
  expect(JSON.parse(await f.getByRole('dialog').getAttribute('data-vscode-context')).preventDefaultContextMenuItems).toBe(false);
  await page.keyboard.press('Escape');
  await expect(f.getByRole('dialog')).toBeHidden();
  await row.hover();
  await page.clock.runFor(1000);
  // Returning from the card crosses out of the dismissed trigger, so it may reopen.
  await page.keyboard.press('Escape');
  await page.mouse.move((await row.boundingBox()).x + 40, (await row.boundingBox()).y + 10);
  await page.clock.runFor(1000);
  await expect(f.getByRole('dialog')).toBeHidden();
});

test('keyboard: focus description, Tab entry, selection, Shift+Tab return and Escape', async ({ page }, info) => {
  const f = await load(page);
  await page.mouse.move(850,600);
  const row = f.locator('[id="s:03-session"]');
  await row.focus();
  await page.clock.runFor(100);
  await expect(row).toHaveAttribute('aria-describedby','berth-hover');
  await page.keyboard.press('Tab');
  await expect(f.locator('.hover-content')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await f.locator('body').evaluate(() => getSelection().toString())).toContain('/workspace/product');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('ControlOrMeta+c');
  expect(await f.locator('body').evaluate(() => navigator.clipboard.readText())).toContain('/workspace/product');
  await page.locator('iframe').screenshot({ path: info.outputPath('keyboard.png') });
  await page.keyboard.press('Shift+Tab');
  await expect(row).toBeFocused();
  await expect(f.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await page.clock.runFor(100);
  await expect(f.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.clock.runFor(500);
  await expect(f.getByRole('dialog')).toBeHidden();
});

test('long content: full path, wrapping, internal scrolling, narrow width and resize', async ({ page }, info) => {
  const f = await load(page, 'width=240&height=320');
  await f.locator('body').evaluate(() => {
    const m = structuredClone(fixture), row = m.groups[0].rows.find(r => r.name === '03-session');
    row.hover[0].text = 'long-session-name-without-breaks-'.repeat(4);
    row.hover.splice(1,0,{icon:'comment',kind:'quote',text:'Long notification details. '.repeat(200)});
    row.hover.find(l => l.kind === 'path').full = '/workspace/product/packages/very-long-directory-name/another-directory/file.ts';
    sendModel(m);
  });
  const row = await open(page,f);
  await enter(page,f,row);
  const overflow = await f.getByRole('dialog').evaluate(el => ({width:el.clientWidth,scrollWidth:el.scrollWidth,bottom:el.getBoundingClientRect().bottom}));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width);
  expect(overflow.bottom).toBeLessThanOrEqual(313);
  await f.locator('.hover-content').evaluate(el => {el.scrollTop=el.scrollHeight;});
  await page.clock.runFor(250);
  await expect(f.getByRole('dialog')).toBeVisible();
  // Recovery controls follow the path; scrolling to the bottom no longer targets it.
  await f.locator('.hover-line.path .text').scrollIntoViewIfNeeded();
  await expect(f.locator('.hover-line.path .text')).toBeInViewport();
  await page.locator('iframe').screenshot({path:info.outputPath('long-content.png')});
  await page.locator('iframe').evaluate(el => {el.style.width='160px';el.style.height='220px';});
  await page.clock.runFor(100);
  await expect.poll(async () => { const box = await f.getByRole('dialog').boundingBox(); return box.x + box.width; }).toBeLessThanOrEqual(153);
  await expect.poll(async () => { const box = await f.getByRole('dialog').boundingBox(); return box.y + box.height; }).toBeLessThanOrEqual(213);
  expect(await f.locator('.hover-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const overlap = await f.getByRole('dialog').evaluate(el => {const close = el.querySelector('.hover-close').getBoundingClientRect();return [...el.querySelectorAll('.text')].some(text => text.getBoundingClientRect().right > close.left);});
  expect(overlap).toBe(false);
  await page.locator('iframe').screenshot({path:info.outputPath('narrow.png')});
});

test('refresh: unrelated changes preserve selection, source changes update, removal closes', async ({ page }) => {
  const f=await load(page);const row=await open(page,f);await enter(page,f,row);
  const text=f.locator('.hover-line.path .text');await text.dblclick();
  const selection=await text.evaluate(()=>getSelection().toString());
  await f.locator('body').evaluate(()=>{const m=structuredClone(fixture);m.groups[0].rows[10].subtitle='Changed elsewhere';sendModel(m);});
  await expect(text).toBeVisible();
  expect(await text.evaluate(()=>getSelection().toString())).toBe(selection);
  await f.locator('body').evaluate(()=>{const m=structuredClone(fixture);m.groups[0].rows.find(r=>r.name==='03-session').hover[1].text='Updated topic';sendModel(m);});
  await expect(f.getByRole('dialog')).toContainText('Updated topic');
  await f.locator('body').evaluate(()=>{const m=structuredClone(fixture);m.groups[0].rows=m.groups[0].rows.filter(r=>r.name!=='03-session');sendModel(m);});
  await expect(f.getByRole('dialog')).toBeHidden();
});

test('environment: upward opening, list scroll, window blur and context menu close', async ({ page }, info) => {
  const f=await load(page);const row=await open(page,f,'14-session');
  await expect(f.getByRole('dialog')).toHaveAttribute('data-side','above');
  await enter(page,f,row);
  await page.locator('iframe').screenshot({path:info.outputPath('above.png')});
  await f.locator('body').evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(f.getByRole('dialog')).toBeHidden();
  await page.mouse.move(850,600);await open(page,f,'14-session');
  await f.locator('body').evaluate(()=>window.scrollTo(0,0));
  await expect(f.getByRole('dialog')).toBeHidden();
  await open(page,f);await f.locator('[id="s:03-session"]').click({button:'right'});
  await expect(f.getByRole('dialog')).toBeHidden();
});

test('host dismissal: Escape route works without focusing the webview', async ({ page }) => {
  const f=await load(page);await open(page,f);
  expect(await f.locator('body').evaluate(()=>messages.at(-1))).toEqual({type:'detailsVisibility',visible:true});
  await f.locator('body').evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'dismissDetails'}})));
  await expect(f.getByRole('dialog')).toBeHidden();
  expect(await f.locator('body').evaluate(()=>messages.at(-1))).toEqual({type:'detailsVisibility',visible:false});
  await f.locator('[id="s:04-session"]').focus();
  await page.clock.runFor(100);
  await page.keyboard.press('Tab');
  await expect(f.locator('.hover-content')).toBeFocused();
  await f.locator('body').evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'dismissDetails'}})));
  await expect(f.locator('[id="s:04-session"]')).toBeFocused();
});

test('rapid switching, folder details and outside click keep the correct owner', async ({ page }, info) => {
  const f=await load(page);
  await f.locator('[id="s:03-session"]').hover();
  await f.locator('[id="s:04-session"]').hover();
  await page.clock.runFor(100);
  await expect(f.getByRole('dialog')).toContainText('04-session');
  await expect(f.getByRole('dialog')).toContainText('Allow the export command');
  await f.locator('[id="s:01-session"]').click();
  await expect(f.getByRole('dialog')).toBeHidden();
  const messages=await f.locator('body').evaluate(()=>window.messages.filter(m=>m.type==='show'));
  expect(messages).toEqual([{type:'show',session:'01-session'}]);
  await f.locator('body').evaluate(()=>sendModel(fixture,false));
  const group=f.locator('.group').first();
  await expect(group.locator('.codicon-git-branch')).toHaveCount(1);
  await expect(group.locator('.group-branch')).toHaveAttribute('aria-label', 'Current worktree branch: feature/session-preview');
  await page.locator('iframe').screenshot({ path: info.outputPath('branch-heading.png') });
  await group.hover();await page.clock.runFor(100);
  await expect(f.getByRole('dialog')).toContainText('/workspace/product');
  await expect(f.getByRole('dialog')).toContainText('Current worktree branch: feature/session-preview');
  await group.click();
  await expect(f.getByRole('dialog')).toBeHidden();
});

test('selection remains on its session across insertion and reordering', async ({ page }) => {
  const f=await load(page);const row=await open(page,f);await enter(page,f,row);
  await f.locator('.hover-line.path .text').dblclick();
  await f.locator('body').evaluate(()=>{const m=structuredClone(fixture);m.groups[0].rows=m.groups[0].rows.toReversed();sendModel(m);});
  await expect(f.getByRole('dialog')).toContainText('03-session');
  expect(await row.getAttribute('aria-controls')).toBe('berth-hover');
});

test('content variants show relevant state and warnings, with literal untrusted text', async ({page},info) => {
  const f=await load(page);
  for(const variant of ['waiting','unread','stopped','missing','broken','codexTrust','shell','literal']) {
    await page.mouse.move(850,600);
    await f.locator('body').evaluate((element,name)=>sendModel(variants[name]),variant);
    await open(page,f);
    const dialog=f.getByRole('dialog');
    if(variant==='shell') await expect(dialog).not.toContainText('Conversation not bound');
    if(variant==='missing') await expect(dialog).toContainText('hooks are not installed');
    if(variant==='codexTrust') await expect(dialog).toContainText('Codex manages hook trust in /hooks');
    if(variant==='broken') await expect(dialog).toContainText('hooks are incomplete');
    if(variant==='waiting') await expect(dialog).toContainText('Allow the export command');
    if(variant==='literal') {await expect(dialog).toContainText('<img src=x');expect(await dialog.locator('img[src="x"]').count()).toBe(0);}
    if(variant==='waiting'||variant==='missing'||variant==='broken'||variant==='codexTrust') await page.locator('iframe').screenshot({path:info.outputPath(`${variant}.png`)});
  }
});


test('natural order: restored sessions retain numeric placement after becoming live', async ({ page }, info) => {
  const f = await load(page);
  for (const index of [0, 1]) {
    await f.locator('body').evaluate((_, i) => window.sendModel(window.orderFixture[i]), index);
    await expect(f.locator('.row.card .name')).toHaveText(['job-2', 'job-3', 'job-13']);
  }
  await page.locator('iframe').screenshot({ path: info.outputPath('natural-order.png') });
});


for (const close of ['Escape', 'Close details']) {
  test(`CR78 first pointer re-entry opens details after ${close} from inside`, async ({ page }) => {
    const f = await load(page);
    const row = await open(page, f);
    const copy = f.getByRole('button', { name: 'Copy session name', exact: true });
    await copy.click();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await f.getByRole('button', { name: close, exact: true }).click();
    await expect(f.getByRole('dialog')).toBeHidden();
    await expect(row).toBeFocused();
    await page.clock.runFor(1000);
    await expect(f.getByRole('dialog')).toBeHidden();
    await page.mouse.move(850, 600);
    await row.hover();
    await page.clock.runFor(100);
    await expect(f.getByRole('dialog')).toBeVisible();
  });
}
