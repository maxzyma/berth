/** Isolated native-editor interaction check; run under a private display on Linux. */
import { _electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { integrationEnvironment } from '../integration/environment.mjs';

const executablePath = process.env.BERTH_TEST_VSCODE_PATH;
if (!executablePath || !isAbsolute(executablePath)) throw new Error('Set BERTH_TEST_VSCODE_PATH to the isolated editor executable.');
const viewport = process.env.BERTH_TEST_VIEWPORT;
if (!['1440x900', '1280x800'].includes(viewport)) throw new Error('Set BERTH_TEST_VIEWPORT to 1440x900 or 1280x800.');
const extension = fileURLToPath(new URL('../..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'berth-test-native-ui-'));
const workspace = join(root, 'workspace');
for (const dir of [workspace, join(root, 'user/User')]) mkdirSync(dir, { recursive: true });
writeFileSync(join(root, 'user/User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.zoomLevel': 0 }));
const env = Object.fromEntries(Object.entries(integrationEnvironment(root)).filter(([, value]) => typeof value === 'string'));
const vsix = process.env.BERTH_TEST_VSIX;
const cliPath = process.env.BERTH_TEST_VSCODE_CLI_PATH;
if (vsix && (!isAbsolute(vsix) || !cliPath || !isAbsolute(cliPath))) throw new Error('Installed mode requires absolute VSIX and editor CLI paths.');
function installCandidate() {
  execFileSync(cliPath, ['--user-data-dir', join(root, 'user'), '--extensions-dir', join(root, 'ext'), '--install-extension', vsix], { env, timeout: 60000, stdio: 'pipe' });
  const matches = readdirSync(join(root, 'ext')).filter(name => name.startsWith('berthdev.berth-'));
  if (matches.length !== 1) throw new Error('Expected one isolated installed Berth extension.');
  return join(root, 'ext', matches[0]);
}
const runtimeExtension = vsix ? installCandidate() : extension;
let app;
try {
  execFileSync(process.execPath, [join(runtimeExtension, 'dist/cli.mjs'), 'new', 'shell', '--name', 'ui-copy', '--cwd', workspace], { env });
  app = await _electron.launch({ executablePath, args: [workspace, '--user-data-dir', join(root, 'user'),
    '--extensions-dir', join(root, 'ext'), ...(vsix ? [] : [`--extensionDevelopmentPath=${extension}`]),
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'], env, timeout: 40000 });
  const page = await app.firstWindow();
  let frame;
  await expect.poll(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.getByRole('tree', { name: 'Agent sessions' }).count()) { frame = candidate; return true; }
    }
    return false;
  }, { timeout: 40000 }).toBe(true);
  for (const [width, height] of [viewport.split('x').map(Number)]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
    await page.mouse.move(0, 0);
    const row = frame.locator('[id="s:ui-copy"]');
    await expect(row).toBeVisible();
    await row.hover();
    const dialog = frame.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameCopy = dialog.getByRole('button', { name: 'Copy session name', exact: true });
    await nameCopy.click();
    await expect(dialog.getByRole('status')).toHaveText('Copied session name.');
    await expect(nameCopy).toBeFocused();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('ui-copy');
    const folderCopy = dialog.getByRole('button', { name: 'Copy folder path', exact: true });
    await folderCopy.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('status')).toHaveText('Copied folder path.');
    await expect(folderCopy).toBeFocused();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(workspace);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
    for (const close of ['Close details', 'Escape']) {
      await page.mouse.move(0, 0);
      await row.hover();
      await expect(dialog).toBeVisible();
      if (close === 'Close details') await dialog.getByRole('button', { name: close, exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(row).toBeFocused();
    }
    const picker = page.locator('.quick-input-widget');
    const input = picker.locator('input.input');
    const openFind = async () => {
      await page.keyboard.press('F1');
      await expect(input).toBeVisible();
      await input.fill('>Berth: Find a Session');
      await page.keyboard.press('Enter');
      await expect(input).toHaveAttribute('placeholder', 'Search name, conversation or folder');
      await expect(picker.locator('.monaco-list-row:visible')).toContainText('ui-copy');
    };
    const clients = () => execFileSync('tmux', ['-L', env.BERTH_TMUX_SOCKET, 'list-clients', '-t', '=ui-copy', '-F', '#{client_pid}'], { env, encoding: 'utf8' }).trim();
    await openFind();
    await input.fill('no-matching-session-fixture');
    await expect(picker.locator('.monaco-list-row:visible')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(clients()).toBe('');
    await openFind();
    await input.fill('ui-copy');
    await expect(picker.locator('.monaco-list-row:visible')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect.poll(clients).not.toBe('');
    const scratch = join(workspace, 'clipboard.txt');
    writeFileSync(scratch, '');
    await page.getByText('clipboard.txt', { exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: /clipboard\.txt/ })).toBeVisible();
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+s');
    await expect.poll(() => readFileSync(scratch, 'utf8')).toBe(workspace);

    process.stdout.write(JSON.stringify({ width, height, clipboard: true, keyboardCopy: true, escapeFocus: true, pointerReentry: true, findCancel: true, findNoMatch: true, findOpen: true, pasteAndSave: true, installed: Boolean(vsix) }) + '\n');
  }
} catch (error) {
  if (app?.windows()[0]) await app.windows()[0].screenshot({ path: join(root, 'failure.png') }).catch(() => {});
  process.stderr.write(`Native interaction evidence: ${root}\n`);
  throw error;
} finally {
  try { if (app) await app.close(); }
  finally {
    if (!env.BERTH_TMUX_SOCKET.startsWith('berth-test-')) throw new Error('Refusing non-test server cleanup.');
    try { execFileSync('tmux', ['-L', env.BERTH_TMUX_SOCKET, 'kill-server'], { env, stdio: 'ignore' }); }
    catch { /* The last test session may already have ended. */ }
  }
}
