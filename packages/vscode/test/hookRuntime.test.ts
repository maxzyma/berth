import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBundledHooks, prepareHookRuntime } from '../src/hookRuntime.js';

const bundle = fileURLToPath(new URL('../../dist/cli.mjs', import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'berth-hooks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    env: { ...process.env, HOME: root, CODEX_HOME: join(root, '.codex'), PATH: '/usr/bin:/bin', BERTH_CONFIG: join(root, 'config.toml') },
    storage: join(root, 'storage with spaces'),
  };
}

test('V11 hook installation works without berth or node on PATH and preserves unrelated hooks', async (t) => {
  const f = fixture(t);
  const first = await installBundledHooks(bundle, f.storage, 'codex', f.env);
  assert.equal(first.ok, true, first.detail);
  const file = first.detail;
  const original = JSON.parse(readFileSync(file, 'utf8'));
  const userHook = { hooks: [{ type: 'command', command: 'user-hook' }] };
  writeFileSync(file, JSON.stringify({ ...original, hooks: { ...original.hooks, Stop: [...original.hooks.Stop, userHook] } }));
  assert.equal((await installBundledHooks(bundle, f.storage, 'codex', f.env)).ok, true);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert(data.hooks.Stop.some((group: { hooks: { command: string }[] }) => group.hooks.some(h => h.command === 'user-hook')));
  const command = data.hooks.SessionStart[0].hooks[0].command as string;
  assert(command.includes(join(f.storage, 'hooks', 'cli.mjs')));
  assert(command.includes('ELECTRON_RUN_AS_NODE=1'));
  assert(!command.includes('/dist/cli.mjs'));
  // Execute the recorded runtime without delivering an event to any real tmux server.
  const runtime = command.slice(0, command.indexOf(' hook '));
  const result = spawnSync('/bin/sh', ['-c', `${runtime} --help`], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('V11 extension updates refresh the runtime at the same path', (t) => {
  const f = fixture(t);
  const source = join(f.root, 'bundle.mjs');
  writeFileSync(source, 'first');
  const target = prepareHookRuntime(source, f.storage);
  writeFileSync(source, 'second');
  assert.equal(prepareHookRuntime(source, f.storage), target);
  assert.equal(readFileSync(target, 'utf8'), 'second');
});

test('V11 installer errors retain their real cause instead of claiming a missing PATH command', async (t) => {
  const f = fixture(t);
  const source = join(f.root, 'failure.mjs');
  writeFileSync(source, "process.stderr.write('cannot parse hook configuration'); process.exitCode = 1;");
  const result = await installBundledHooks(source, f.storage, 'codex', f.env);
  assert.deepEqual(result, { ok: false, detail: 'cannot parse hook configuration' });
});

test('V11 installed hook commands bind and update an isolated tmux session', async (t) => {
  const helpersPath = '../../../core/dist/test/helpers.js';
  const { sandbox } = await import(helpersPath);
  const sb = sandbox(t);
  sb.cli('new', 'codex', '--name', 'hook-target', '--cwd', sb.makeDir('project'));
  const pane = sb.tmux('display-message', '-p', '-t', '=hook-target:', '#{pane_id}').trim();
  const server = sb.tmux('display-message', '-p', '-t', '=hook-target:', '#{socket_path},#{pid},0').trim();
  const env = { ...sb.env, TMUX_PANE: pane, TMUX: server };
  const result = await installBundledHooks(bundle, join(sb.root, 'runtime'), 'codex', env);
  assert.equal(result.ok, true, result.detail);
  const data = JSON.parse(readFileSync(result.detail, 'utf8'));
  for (const event of ['SessionStart', 'Stop']) {
    const command = data.hooks[event][0].hooks[0].command;
    const run = spawnSync('/bin/sh', ['-c', command], {
      env, input: JSON.stringify({ session_id: 'test-conversation' }), encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
  }
  const meta = sb.ctx().tmux.listSessions()[0].meta;
  assert.equal(meta.conversation, 'test-conversation');
  assert.equal(meta.state, 'done');
});

test('CR56 slow hook installation leaves host events available and serializes runtime changes', async (t) => {
  const f = fixture(t), source = join(f.root, 'slow.mjs'), next = join(f.root, 'next.mjs');
  const record = join(f.root, 'order');
  const script = (name: string) => `import {appendFileSync} from 'node:fs';
    appendFileSync(${JSON.stringify(record)}, '${name}-start\\n');
    setTimeout(()=>{appendFileSync(${JSON.stringify(record)}, '${name}-end\\n');process.stdout.write('${name}');},200);`;
  writeFileSync(source, script('first'));
  writeFileSync(next, script('second'));
  const first = installBundledHooks(source, f.storage, 'codex', f.env);
  const second = installBundledHooks(next, f.storage, 'claude', f.env);
  const hostEvent = new Promise<string>((resolve) => setImmediate(() => resolve('host-event')));
  assert.equal(await Promise.race([first.then(() => 'installed'), hostEvent]), 'host-event');
  assert.deepEqual(await first, { ok: true, detail: 'first' });
  assert.deepEqual(await second, { ok: true, detail: 'second' });
  assert.equal(readFileSync(record, 'utf8'), 'first-start\nfirst-end\nsecond-start\nsecond-end\n');
});

test('CR56 a failed hook installer does not poison the queued request', async (t) => {
  const f = fixture(t), bad = join(f.root, 'bad.mjs'), good = join(f.root, 'good.mjs');
  writeFileSync(bad, "process.stderr.write('fixture failure');process.exitCode=1;");
  writeFileSync(good, "process.stdout.write('recovered');");
  const first = installBundledHooks(bad, f.storage, 'codex', f.env);
  const next = installBundledHooks(good, f.storage, 'codex', f.env);
  assert.deepEqual(await first, { ok: false, detail: 'fixture failure' });
  assert.deepEqual(await next, { ok: true, detail: 'recovered' });
});

test('legacy Codex upgrade preserves existing definitions and adds activity events once', async (t) => {
  const f = fixture(t);
  const installed = await installBundledHooks(bundle, f.storage, 'codex', f.env);
  assert.equal(installed.ok, true, installed.detail);
  const file = installed.detail;
  const full = JSON.parse(readFileSync(file, 'utf8'));
  const user = { matcher: 'Bash', hooks: [{ type: 'command', command: 'user-hook', timeout: 9 }] };
  const legacy = { description: 'keep', hooks: { SessionStart: full.hooks.SessionStart, Stop: full.hooks.Stop, PostToolUse: [user] } };
  writeFileSync(file, JSON.stringify(legacy));
  const upgraded = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
  assert.equal(upgraded.ok, true, upgraded.detail);
  assert.equal(JSON.parse(upgraded.detail).changed, true);
  const actual = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(actual.hooks.SessionStart, legacy.hooks.SessionStart);
  assert.deepEqual(actual.hooks.Stop, legacy.hooks.Stop);
  assert.deepEqual(actual.hooks.PostToolUse[0], user);
  for (const event of ['UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Interrupt']) assert.ok(actual.hooks[event]);
  const before = readFileSync(file, 'utf8');
  const again = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
  assert.equal(JSON.parse(again.detail).changed, false);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('Codex upgrade leaves absent, disabled, customized and malformed configurations untouched', async (t) => {
  const f = fixture(t);
  const absent = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
  assert.equal(JSON.parse(absent.detail).changed, false);
  const installed = await installBundledHooks(bundle, f.storage, 'codex', f.env);
  const file = installed.detail;
  const full = JSON.parse(readFileSync(file, 'utf8'));
  const legacy = { hooks: { SessionStart: full.hooks.SessionStart, Stop: full.hooks.Stop } };
  for (const data of [
    { ...legacy, disableAllHooks: true },
    { hooks: { ...legacy.hooks, SessionStart: [{ matcher: 'startup', hooks: full.hooks.SessionStart[0].hooks }] } },
    { hooks: { ...legacy.hooks, Stop: [{ hooks: [{ type: 'command', command: 'BERTH_HOOK=1 custom' }] }] } },
  ]) {
    const before = JSON.stringify(data); writeFileSync(file, before);
    const result = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
    assert.equal(result.ok, true, result.detail);
    assert.equal(JSON.parse(result.detail).changed, false);
    assert.equal(readFileSync(file, 'utf8'), before);
  }
  writeFileSync(file, JSON.stringify(legacy));
  writeFileSync(join(f.env.CODEX_HOME, 'config.toml'), '[features]\nhooks = false\n');
  const before = readFileSync(file, 'utf8');
  const disabled = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
  assert.equal(JSON.parse(disabled.detail).changed, false);
  assert.equal(readFileSync(file, 'utf8'), before);
  writeFileSync(file, '{invalid');
  const malformed = await installBundledHooks(bundle, f.storage, 'codex', f.env, 'upgrade');
  assert.equal(malformed.ok, false);
  assert.equal(readFileSync(file, 'utf8'), '{invalid');
});
