import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS } from '../src/agents/registry.js';
import { hookStatus, hookTarget, hooksInstalled, installHooks } from '../src/agents/hooks.js';
import { create, stamp, bellRang, list } from '../src/registry/sessions.js';
import { doctor } from '../src/registry/doctor.js';
import { sandbox, CLI } from './helpers.js';

test('CR30 complete installed hooks require accessible runtime targets across formats', (t) => {
  const sb = sandbox(t);
  const env = { HOME: sb.env.HOME };
  const cli = join(sb.root, 'hook cli.mjs');
  writeFileSync(cli, '// synthetic runtime fixture\n');
  for (const adapter of ADAPTERS.filter((adapter) => adapter.hookTarget)) {
    assert.equal(hookStatus(adapter.id, env), 'missing', adapter.id);
    const file = installHooks(adapter.id, cli, env);
    assert.equal(hookStatus(adapter.id, env), 'installed', adapter.id);
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replaceAll(process.execPath, '/missing/berth-node'));
    assert.equal(hookStatus(adapter.id, env), 'broken', `${adapter.id}: runtime absent`);
    writeFileSync(file, text);
  }
  rmSync(cli);
  for (const adapter of ADAPTERS.filter((adapter) => adapter.hookTarget)) {
    assert.equal(hookStatus(adapter.id, env), 'broken', `${adapter.id}: script absent`);
    assert.equal(hooksInstalled(adapter.id, env), false);
  }
});

test('CR30 partial events and malformed config offer repair and retain other hooks', (t) => {
  const sb = sandbox(t), env = { HOME: sb.env.HOME };
  const file = installHooks('claude', CLI, env);
  const installed = JSON.parse(readFileSync(file, 'utf8'));
  const foreign = { hooks: [{ type: 'command', command: "echo 'user-owned shell text" }] };
  writeFileSync(file, JSON.stringify({ other: 'keep', hooks: { SessionStart: installed.hooks.SessionStart, Stop: [foreign] } }));
  assert.equal(hookStatus('claude', env), 'broken');
  installHooks('claude', CLI, env);
  const repaired = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(repaired.other, 'keep');
  assert.deepEqual(repaired.hooks.Stop[0], foreign);
  assert.equal(hookStatus('claude', env), 'installed');
  writeFileSync(file, JSON.stringify({ ...repaired, disableAllHooks: true }));
  assert.equal(hookStatus('claude', env), 'broken');
  assert.throws(() => installHooks('claude', CLI, env), /remains incomplete, disabled/);
  writeFileSync(file, '{"BERTH_HOOK=1":');
  assert.equal(hookStatus('claude', env), 'broken');
  assert.throws(() => installHooks('claude', CLI, env), /cannot parse/);
  assert.equal(readFileSync(file, 'utf8'), '{"BERTH_HOOK=1":', 'invalid config is not overwritten');
});

test('CR30 broken waiting hooks cannot suppress the bell fallback', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'claude', cwd: sb.root, name: 'bell-health' });
  stamp(ctx, 'bell-health', { conversation: 'exact' });
  const file = installHooks('claude', CLI, sb.env);
  assert.equal(bellRang(ctx, 'bell-health', sb.env), false, 'complete waiting integration owns notifications');
  const full = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ hooks: { SessionStart: full.hooks.SessionStart } }));
  assert.equal(list(ctx)[0].hooks, 'broken');
  assert.ok(doctor(ctx, sb.env).some((finding) => finding.code === 'hooks' && finding.installHooksFor === 'claude' && /incomplete/.test(finding.problem)));
  assert.equal(bellRang(ctx, 'bell-health', sb.env), true);
  assert.equal(list(ctx)[0].state, 'waiting');
});

test('CR32 Codex installation explains native trust without changing it', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const result = sb.cli('hooks', 'install', 'codex');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /\/hooks.*Review new or changed/);
  const content = readFileSync(result.stdout.trim(), 'utf8');
  assert.doesNotMatch(content, /dangerously-bypass-hook-trust|trustStatus/);
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'codex-trust' });
  stamp(ctx, 'codex-trust', { conversation: 'exact' });
  const row = list(ctx)[0];
  assert.equal(row.hooks, 'installed', 'file health remains distinct from native trust');
  assert.match(row.hookSetup!, /Codex manages hook trust in \/hooks/);
});


test('CR33 configured Codex waiting hooks retain bell fallback until native trust', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'codex-bell' });
  stamp(ctx, 'codex-bell', { conversation: 'exact' });
  const file = installHooks('codex', CLI, sb.env);
  assert.equal(list(ctx)[0].hooks, 'installed');
  assert.equal(bellRang(ctx, 'codex-bell', sb.env), true, 'file presence cannot establish runtime trust');
  stamp(ctx, 'codex-bell', { state: 'waiting', note: 'Approve requested access' });
  assert.equal(bellRang(ctx, 'codex-bell', sb.env), false);
  assert.equal(list(ctx)[0].note, 'Approve requested access');
  const full = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ hooks: { SessionStart: full.hooks.SessionStart, Stop: full.hooks.Stop } }));
  assert.equal(hookStatus('codex', sb.env), 'broken', 'legacy two-event installation offers repair');
});

test('installed hooks report the runtime and CLI they run, in every format', (t) => {
  const sb = sandbox(t);
  const env = { HOME: sb.env.HOME };
  const cli = join(sb.root, 'hook cli.mjs');
  writeFileSync(cli, '// synthetic runtime fixture\n');
  for (const adapter of ADAPTERS.filter((adapter) => adapter.hookTarget)) {
    assert.equal(hookTarget(adapter.id, env), undefined, `${adapter.id}: nothing installed`);
    installHooks(adapter.id, cli, env);
    assert.deepEqual(hookTarget(adapter.id, env), { runtime: process.execPath, cli }, adapter.id);
  }
  assert.equal(hookTarget('shell', env), undefined);
});
