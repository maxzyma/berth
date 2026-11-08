import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bootstrap as realBootstrap, savePreparation, cliEnvironment, type Preparation } from '../src/profileBootstrap.js';
import { nativeProfiles, nativeUserRoot, localProfileStorage, readProfileSettings } from '../src/profileFiles.js';

const bootstrap = (file: string, install: (state: Preparation) => Promise<void>) =>
  realBootstrap(file, install, async () => undefined);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'berth-test-profile-'));
  const userRoot = join(root, 'User');
  await mkdir(join(userRoot, 'globalStorage'), { recursive: true });
  await mkdir(join(userRoot, 'profiles/new-id'), { recursive: true });
  const registry = join(userRoot, 'globalStorage/storage.json');
  const original = JSON.stringify({ userDataProfiles: [{ name: 'Berth', location: 'new-id' }] });
  await writeFile(registry, original);
  const file = join(root, 'preparation.json');
  const state: Preparation = { schema: 1, token: 'synthetic-token', name: 'Berth', status: 'waiting',
    userRoot, cli: 'unused', executable: 'unused', extensionsRoot: 'unused', archive: 'unused',
    settings: { 'workbench.sideBar.location': 'right' } };
  await savePreparation(file, state);
  return { root, userRoot, registry, original, file, state,
    settings: join(userRoot, 'profiles/new-id/settings.json') };
}

test('preparation initializes only the destination and never writes the registry', async () => {
  const f = await fixture();
  try {
    let installs = 0;
    await bootstrap(f.file, async state => {
      installs++;
      assert.equal(state.id, 'new-id');
      assert.equal(JSON.parse(await readFile(f.settings, 'utf8'))['berth.layout.managedProfile'], f.state.token);
    });
    assert.equal(installs, 1);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).status, 'ready');
    assert.equal(await readFile(f.registry, 'utf8'), f.original);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('existing user settings are preserved and installation is not attempted', async () => {
  const f = await fixture();
  try {
    await writeFile(f.settings, '{"editor.fontSize":17}');
    await assert.rejects(bootstrap(f.file, async () => { assert.fail('must not install'); }), /already has settings/);
    assert.equal(await readFile(f.settings, 'utf8'), '{"editor.fontSize":17}');
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).status, 'failed');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('failed installation retries the same owned destination and preserves user edits', async () => {
  const f = await fixture();
  try {
    await assert.rejects(bootstrap(f.file, async () => { throw new Error('installer failed'); }), /installer failed/);
    const current = JSON.parse(await readFile(f.settings, 'utf8'));
    await writeFile(f.settings, JSON.stringify({ ...current, 'editor.fontSize': 18 }));
    await bootstrap(f.file, async state => { assert.equal(state.id, 'new-id'); });
    assert.equal(JSON.parse(await readFile(f.settings, 'utf8'))['editor.fontSize'], 18);
    assert.equal((await nativeProfiles(f.userRoot)).length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('native renamed profile is located by ID on retry', async () => {
  const f = await fixture();
  try {
    await savePreparation(f.file, { ...f.state, id: 'new-id' });
    await writeFile(f.registry, JSON.stringify({ userDataProfiles: [{ name: 'Renamed', location: 'new-id' }] }));
    await bootstrap(f.file, async state => { assert.equal(state.name, 'Renamed'); });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('symlink destination and shared settings flags fail closed', async () => {
  for (const shared of [true, false]) {
    const f = await fixture();
    try {
      if (shared) await writeFile(f.registry, JSON.stringify({ userDataProfiles: [{ name: 'Berth', location: 'new-id', useDefaultFlags: { settings: true } }] }));
      else {
        await rm(join(f.userRoot, 'profiles/new-id'), { recursive: true });
        await mkdir(join(f.root, 'other'));
        await symlink(join(f.root, 'other'), join(f.userRoot, 'profiles/new-id'));
      }
      await assert.rejects(bootstrap(f.file, async () => { assert.fail('must not install'); }), /independent/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('profile adapter rejects traversal and non-desktop storage layouts', async () => {
  const f = await fixture();
  try {
    await writeFile(f.registry, JSON.stringify({ userDataProfiles: [{ name: 'Berth', location: '../other' }] }));
    await assert.rejects(nativeProfiles(f.userRoot), /location/);
    assert.throws(() => nativeUserRoot('/unrelated/globalStorage/berthdev.berth'), /storage/);
    assert.equal(nativeUserRoot(join(f.userRoot, 'globalStorage/berthdev.berth')), f.userRoot);
    assert.deepEqual(cliEnvironment({ PATH: 'synthetic', VSCODE_IPC_HOOK_CLI: 'other-window' }),
      { PATH: 'synthetic', ELECTRON_RUN_AS_NODE: '1' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('local desktop storage accepts native user-data URIs without admitting remote hosts', () => {
  assert.equal(localProfileStorage('vscode-userdata'), true);
  assert.equal(localProfileStorage('file'), true);
  assert.equal(localProfileStorage('vscode-userdata', 'ssh-remote'), false);
  assert.equal(localProfileStorage('vscode-remote'), false);
});

test('owned JSONC settings survive retry; malformed settings fail without rewriting', async () => {
  const f = await fixture();
  try {
    const jsonc = '// Keep this comment.\n{ "berth.layout.managedProfile": "synthetic-token", "editor.fontSize": 19, }';
    await writeFile(f.settings, jsonc);
    await bootstrap(f.file, async () => undefined);
    assert.equal((await readProfileSettings(f.settings))['editor.fontSize'], 19);
    assert.equal(await readFile(f.settings, 'utf8'), jsonc);
    for (const malformed of ['{ "berth.layout.managedProfile": "synthetic-token", bad }', '[]', 'null']) {
      await writeFile(f.settings, malformed);
      await assert.rejects(bootstrap(f.file, async () => assert.fail('must not install')), /invalid JSONC/);
      assert.equal(await readFile(f.settings, 'utf8'), malformed);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('the packaged Profile helper loads without unresolved dependency internals', () => {
  const bundle = fileURLToPath(new URL('../../dist/profile-bootstrap.cjs', import.meta.url));
  const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', bundle], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});
