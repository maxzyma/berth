import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnvironment, environmentProbe, type EnvironmentProbe } from '../src/registry/environment.js';
import { dependencyInstall } from '../src/registry/dependency-install.js';
import { sandbox } from './helpers.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function probe(overrides: Partial<EnvironmentProbe> = {}): EnvironmentProbe {
  return { platform: 'linux', nodeVersion: '22.0.0', executable: '/fixture/editor-runtime',
    find: name => ['tmux', '/bin/sh'].includes(name) ? `/fixture/${name}` : undefined,
    version: () => 'tmux 3.4', writable: () => true, ...overrides };
}

test('editor does not require a separate PATH Node or npm and works without sessions', t => {
  const ctx = sandbox(t).ctx();
  const report = checkEnvironment(ctx, { editor: true }, probe());
  assert.equal(report.ready, true);
  assert.equal(report.checks.some(c => c.id === 'external-node'), false);
  assert.match(report.checks.find(c => c.id === 'runtime')!.detail, /No separate Node/);
  for (const id of ['lsof', 'sqlite3']) {
    const check = report.checks.find(c => c.id === id)!;
    assert.equal(check.ok, false);
    assert.equal(check.required, false);
    assert.match(check.detail, /basic session use remains available/);
  }
});

test('missing tmux yields a repairable finding rather than throwing', t => {
  const report = checkEnvironment(sandbox(t).ctx(), {}, probe({ find: () => undefined }));
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(c => c.id === 'tmux')?.repair, 'tmux');
});

test('unsupported or non-running tmux and Node are not accepted', t => {
  const ctx = sandbox(t).ctx();
  for (const version of ['tmux 2.9', 'unexpected', undefined]) {
    assert.equal(checkEnvironment(ctx, {}, probe({ version: () => version })).ready, false);
  }
  assert.equal(checkEnvironment(ctx, {}, probe({ nodeVersion: '18.20.0' })).ready, false);
});

test('standalone checks require real PATH Node and npm without affecting editor checks', t => {
  const ctx = sandbox(t).ctx();
  const missing = checkEnvironment(ctx, { externalNode: true }, probe());
  assert.equal(missing.ready, false);
  assert.equal(missing.checks.find(c => c.id === 'external-node')?.repair, 'node');
  const available = probe({ find: name => `/fixture/${name}`, version: file => file.endsWith('tmux') ? 'tmux 3.4' : 'v22.0.0' });
  assert.equal(checkEnvironment(ctx, { externalNode: true }, available).ready, true);
});

test('invalid platform and unavailable storage block readiness without treating Perl as mandatory', t => {
  const ctx = sandbox(t).ctx();
  assert.equal(checkEnvironment(ctx, {}, probe({ platform: 'win32' })).ready, false);
  assert.equal(checkEnvironment(ctx, {}, probe({ writable: () => false })).ready, false);
  const mac = checkEnvironment(ctx, {}, probe({ platform: 'darwin' }));
  assert.equal(mac.ready, true);
  assert.equal(mac.checks.find(c => c.id === 'perl')?.ok, false);
});

test('custom terminal launchers do not require the chosen agent on extension PATH', t => {
  const ctx = sandbox(t).ctx();
  const result = checkEnvironment(ctx, { agent: 'codex', launcher: 'MODEL=x my_shell_function {agent}' }, probe());
  assert.equal(result.ready, true);
  const builtIn = { ...ctx, config: { ...ctx.config, agents: {} } };
  assert.equal(checkEnvironment(builtIn, { agent: 'codex' }, probe()).ready, false);
});

test('the built-in Shell delegates to tmux instead of requiring an empty executable', t => {
  const base = sandbox(t).ctx();
  const ctx = { ...base, config: { ...base.config, agents: {} } };
  const report = checkEnvironment(ctx, { agent: 'shell' }, probe());
  assert.equal(report.ready, true);
  assert.match(report.checks.find(c => c.id === 'launcher')!.detail, /default shell configured in tmux/);
  const custom = { ...ctx, config: { ...ctx.config, agents: { shell: { launch: 'missing-shell' } } } };
  assert.equal(checkEnvironment(custom, { agent: 'shell' }, probe()).ready, false);
});

test('custom tmux paths are never repaired by installing an unrelated default binary', t => {
  const ctx = sandbox(t).ctx();
  const report = checkEnvironment({ ...ctx, config: { ...ctx.config, tmuxBin: '/custom/tmux' } }, {}, probe());
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(c => c.id === 'tmux')?.repair, undefined);
});

test('installation plans use detected managers, preserve privilege boundaries and never execute', () => {
  const brew = probe({ platform: 'darwin', find: name => name === 'brew' ? '/fixture/brew' : undefined });
  assert.deepEqual(dependencyInstall('node', {}, brew), { executable: '/fixture/brew', args: ['install', 'node'], display: '/fixture/brew install node' });
  const apt = probe({ find: name => ['apt-get', 'sudo'].includes(name) ? `/fixture/${name}` : undefined });
  assert.deepEqual(dependencyInstall('tmux', {}, apt, 1000)?.args, ['/fixture/apt-get', 'install', '-y', 'tmux']);
  assert.equal(dependencyInstall('node', {}, apt, 0)?.executable, '/fixture/apt-get');
  assert.equal(dependencyInstall('tmux', {}, probe()), undefined);
  assert.equal(dependencyInstall('tmux', {}, { ...brew, platform: 'win32' }), undefined);
  const userNode = { ...brew, find: (name: string) => name === 'node' ? '/user/version-manager/node' : name === 'brew' ? '/system/bin/brew' : undefined };
  assert.equal(dependencyInstall('node', {}, userNode), undefined);
});

test('environment and doctor CLI return structured failures when tmux is absent', t => {
  const box = sandbox(t);
  const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
  const env = { ...box.env, BERTH_TMUX: `${box.root}/missing-tmux` };
  for (const command of ['environment', 'doctor']) {
    const result = spawnSync(process.execPath, [cli, command, '--json'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    if (command === 'environment') assert.equal(report.ready, false);
    else assert.ok(report.some((f: { problem: string }) => f.problem.includes('tmux')));
  }
});

test('dependency version probes terminate executables that ignore SIGTERM', t => {
  const box = sandbox(t);
  const script = join(box.root, 'stubborn-version');
  writeFileSync(script, `#!${process.execPath}\nprocess.on('SIGTERM', () => {});setInterval(() => {}, 1000);`, { mode: 0o755 });
  const started = Date.now();
  assert.equal(environmentProbe(box.env).version(script, ['--version']), undefined);
  assert.ok(Date.now() - started < 6000, 'the dependency probe must not hang');
});

test('new --require-ready inspects the launcher first and creates nothing when it is not ready', t => {
  const box = sandbox(t);
  const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
  const created = (name: string) => spawnSync('tmux', ['-L', box.socket, 'has-session', '-t', `=${name}`], { env: box.env }).status === 0;
  const blocked = spawnSync(process.execPath, [cli, 'new', 'claude', '--require-ready', '--editor', '--cwd', box.root, '--name', 'blocked'],
    { env: { ...box.env, SHELL: `${box.root}/missing-sh` }, encoding: 'utf8', timeout: 10000 });
  assert.equal(blocked.status, 5, blocked.stderr);
  const report = JSON.parse(blocked.stdout);
  assert.equal(report.ready, false);
  assert.ok(report.checks.some((check: { id: string; ok: boolean }) => check.id === 'launcher' && !check.ok));
  assert.equal(created('blocked'), false, 'nothing is created');
  const ready = spawnSync(process.execPath, [cli, 'new', 'claude', '--require-ready', '--editor', '--cwd', box.root, '--name', 'ready'],
    { env: box.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.stdout.trim(), 'ready');
  assert.equal(created('ready'), true);
});
