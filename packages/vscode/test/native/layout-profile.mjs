/** Isolated native-editor interaction check; run under a private display on Linux. */
import { _electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
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
if (!vsix) throw new Error('Native profile acceptance requires an installed VSIX.');
installCandidate();
const sourceProfile = process.env.BERTH_TEST_SOURCE_PROFILE || 'Default';
const launch = (profile) => _electron.launch({ executablePath, args: [workspace, '--user-data-dir', join(root, 'user'),
  '--extensions-dir', join(root, 'ext'), '--profile', profile, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'], env, timeout: 40000 });
let sourceSettings = join(root, 'user/User/settings.json');
writeFileSync(sourceSettings, JSON.stringify({ 'workbench.startupEditor': 'none',
  'workbench.settings.applyToAllProfiles': ['terminal.integrated.tabs.title'],
  'terminal.integrated.tabs.title': '${process}', 'workbench.sideBar.location': 'left' }));
const applicationSettings = readFileSync(sourceSettings, 'utf8');
if (sourceProfile !== 'Default') {
  const bootstrap = await launch(sourceProfile);
  try {
    await bootstrap.firstWindow();
    await expect.poll(() => existsSync(join(root, 'user/User/profiles')) ? readdirSync(join(root, 'user/User/profiles')).length : 0,
      { timeout: 30000 }).toBe(1);
  } finally { await bootstrap.close(); }
  execFileSync(cliPath, ['--user-data-dir', join(root, 'user'), '--extensions-dir', join(root, 'ext'),
    '--install-extension', vsix, '--profile', sourceProfile], { env, timeout: 60000, stdio: 'pipe' });
  const profiles = join(root, 'user/User/profiles');
  const names = readdirSync(profiles);
  expect(names).toHaveLength(1);
  sourceSettings = join(profiles, names[0], 'settings.json');
  writeFileSync(sourceSettings, JSON.stringify({ 'workbench.sideBar.location': 'left', 'editor.fontSize': 19 }));
}
const legacyFile = join(root, 'user/User/globalStorage/berthdev.berth/layout.json');
mkdirSync(join(root, 'user/User/globalStorage/berthdev.berth'), { recursive: true });
const legacy = JSON.stringify({ schema: 1, backup: { 'workbench.sideBar.location': 'left' }, applied: { 'workbench.sideBar.location': 'right' }, version: 7 });
writeFileSync(legacyFile, legacy);
let app;
try {
  app = await launch(sourceProfile);
  let page = await app.firstWindow();
  const showView = async () => {
    await page.keyboard.press('F1');
    const picker = page.locator('.quick-input-widget');
    await picker.locator('input.input').fill('>View: Show Berth');
    await picker.getByRole('option', { name: /^View: Show Berth/ }).click();
  };
  const waitView = () => expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.getByRole('tree', { name: 'Agent sessions' }).count()) return true;
    return false;
  }, { timeout: 40000 }).toBe(true);
  await showView();
  await waitView();
  await expect(page.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0);
  const [width, height] = viewport.split('x').map(Number);
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  const before = readFileSync(sourceSettings, 'utf8');
  const command = async (name) => {
    await page.keyboard.press('F1');
    const picker = page.locator('.quick-input-widget');
    await expect(picker.locator('input.input')).toBeVisible();
    await picker.locator('input.input').fill('>' + name);
    await picker.getByRole('option', { name: new RegExp('^' + name) }).click();
  };
  const assertPreserved = () => {
    expect(readFileSync(sourceSettings, 'utf8')).toBe(before);
    expect(readFileSync(join(root, 'user/User/settings.json'), 'utf8')).toBe(applicationSettings);
    expect(readFileSync(legacyFile, 'utf8')).toBe(legacy);
  };
  await command('Berth: Create Agent Layout Profile…');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible({ timeout: 20000 });
  await page.locator('.monaco-button').filter({ hasText: /^Cancel$/ }).click();
  assertPreserved();
  await command('Berth: Create Agent Layout Profile…');
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible({ timeout: 20000 });
  // Native inheritance reuses the exact installed candidate without a Marketplace download.
  await page.locator('.new-profile-resource-type-container').filter({ hasText: 'Extensions' }).getByText('Default', { exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeHidden({ timeout: 20000 });
  assertPreserved();
  const profileSettings = () => Object.fromEntries(readdirSync(join(root, 'user/User/profiles')).map((name) =>
    [name, readFileSync(join(root, 'user/User/profiles', name, 'settings.json'), 'utf8')]));
  const createdProfiles = profileSettings();
  await command('Berth: Switch Layout Profile…');
  await page.locator('.quick-input-widget').getByRole('option', { name: /^Berth(?:,|$)/ }).click();
  await expect.poll(async () => (await page.locator('.part.sidebar').boundingBox())?.x, { timeout: 30000 }).toBeGreaterThan(width / 2);
  assertPreserved();
  await expect(page.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0);
  await command('Berth: Switch Layout Profile…');
  await page.locator('.quick-input-widget').getByRole('option', { name: new RegExp('^' + sourceProfile + '(?:,|$)') }).click();
  await expect.poll(async () => (await page.locator('.part.sidebar').boundingBox())?.x, { timeout: 30000 }).toBeLessThan(width / 2);
  assertPreserved();
  await command('Berth: Create Agent Layout Profile…');
  await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
  await page.locator('.monaco-button').filter({ hasText: /^Cancel$/ }).click();
  assertPreserved();
  expect(profileSettings()).toEqual(createdProfiles);
  await app.close();
  app = await launch('Berth');
  page = await app.firstWindow();
  await showView();
  await waitView();
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await expect.poll(async () => (await page.locator('.part.sidebar').boundingBox())?.x, { timeout: 30000 }).toBeGreaterThan(width / 2);
  await command('Berth: Switch Layout Profile…');
  await page.locator('.quick-input-widget').getByRole('option', { name: new RegExp('^' + sourceProfile + '(?:,|$)') }).click();
  await expect.poll(async () => (await page.locator('.part.sidebar').boundingBox())?.x, { timeout: 30000 }).toBeLessThan(width / 2);
  assertPreserved();
  await page.screenshot({ path: join(root, 'returned-profile.png') });
  process.stdout.write(JSON.stringify({ root, width, height, sourceProfile, cancelled: true, created: true, replacementReviewCancelled: true, restarted: true, switchedAndReturned: true, originalAndSharedSettingsPreserved: true, legacyPreserved: true }) + '\n');
} catch (error) {
  if (app?.windows()[0]) await app.windows()[0].screenshot({ path: join(root, 'failure.png') }).catch(() => {});
  process.stderr.write(`Native profile evidence: ${root}\n`);
  throw error;
} finally { if (app) await app.close(); }
