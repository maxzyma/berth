import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessCapability, versionInspector } from '../src/agents/capabilities.js';
import { getAdapter } from '../src/agents/registry.js';
import { captureProfile } from '../src/agents/profile.js';
import { doctor } from '../src/registry/doctor.js';
import { sandbox } from './helpers.js';

test('CR51 capability evidence never treats newer or opaque versions as verified', () => {
  assert.equal(assessCapability('cursor', '2025.09.12-4852336').severity, 'warning');
  for (const version of ['2026.01.16-abcdef', '2027.01.01-abcdef', '2.4.0', 'opaque', '2025.02.30-build']) {
    const result = assessCapability('cursor', version);
    assert.equal(result.severity, 'info', version);
    assert.match(result.detail, /no Berth native acceptance record/);
  }
  assert.match(assessCapability('claude', '2.1.310').detail, /tested.*macOS.*own acknowledgement/);
  assert.match(assessCapability('claude', '2.1.311').detail, /no Berth native acceptance record/);
  for (const version of ['0.162.1', '0.166.0']) assert.match(assessCapability('codex', version).detail, /tested.*macOS/);
  assert.match(assessCapability('codex', '0.162.2').detail, /no Berth native acceptance record/);
  assert.match(assessCapability('gemini', '0.66.0').detail, /tested.*macOS/);
  assert.match(assessCapability('gemini', '0.66.1').detail, /no Berth native acceptance record/);
  assert.match(assessCapability('copilot', '1.0.105').detail, /tested.*macOS/);
  assert.match(assessCapability('copilot', '1.0.106').detail, /no Berth native acceptance record/);
});

test('CR51 version inspection is bounded, deduplicated and rejects ambiguous output', (t) => {
  const sb = sandbox(t), bin = sb.makeDir('bin'), script = join(bin, 'claude');
  writeFileSync(script, '', { mode: 0o755 });
  const env = { ...sb.env, PATH: `${bin}:${sb.env.PATH}` }, adapter = getAdapter('claude')!;
  let calls = 0;
  const inspect = versionInspector(env, (executable) => {
    assert.equal(executable, script);
    calls += 1;
    return { status: 0, stdout: 'v2.1.310 (Claude Code)' };
  });
  assert.equal(inspect(adapter).version, '2.1.310');
  assert.equal(inspect(adapter).version, '2.1.310');
  assert.equal(calls, 1);
  assert.equal(versionInspector(env, () => ({ status: 0, stdout: 'CLI 2.1.310 Node 22.0.0' }))(adapter).version, undefined);
  writeFileSync(script, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),3500);`);
  const started = performance.now();
  assert.equal(versionInspector(env)(adapter).version, undefined);
  assert.ok(performance.now() - started < 2500);
});

test('CR51 doctor inspects the configured context PATH once and skips custom launchers', (t) => {
  const sb = sandbox(t), bin = sb.makeDir('bin'), script = join(bin, 'cursor-agent'), calls = join(bin, 'calls');
  writeFileSync(script, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)},'call\\n');process.stdout.write('2025.09.12-4852336');`);
  chmodSync(script, 0o755);
  sb.env.PATH = `${bin}:${sb.env.PATH}`;
  const original = sb.ctx(), ctx = { ...original, config: { ...original.config, agents: {} } };
  for (const name of ['one', 'two']) {
    ctx.tmux.newSession(name, sb.root, 'sleep 3600');
    ctx.tmux.setMeta(name, { agent: 'cursor', cwd: sb.root, conversation: `exact-${name}`, profile: JSON.stringify(captureProfile('cursor', sb.env)) });
  }
  const version = doctor(ctx).find((f) => /configured CLI/.test(f.problem));
  assert.equal(version?.severity, 'warning', JSON.stringify(version));
  assert.ok(version?.problem.includes(script));
  assert.match(version?.problem ?? '', /2026-01-16/);
  assert.equal(readFileSync(calls, 'utf8'), 'call\n');
  const custom = { ...ctx, config: { ...ctx.config, agents: { cursor: { launch: `${script} {args}` } } } };
  assert.ok(doctor(custom).some((f) => /custom launch\/resume template; version not inspected/.test(f.problem)));
  assert.equal(readFileSync(calls, 'utf8'), 'call\n');
});

test('CR55 version probes resolve per launch directory, cache executables and cap native queries', (t) => {
  const sb = sandbox(t), adapter = getAdapter('claude')!;
  let calls: string[] = [];
  const inspect = versionInspector({ ...sb.env, PATH: '.' }, (executable, cwd) => {
    assert.equal(executable, join(cwd, 'claude'));
    calls = [...calls, executable];
    return { status: 0, stdout: readFileSync(executable, 'utf8').trim() };
  });
  const dirs = Array.from({ length: 9 }, (_, index) => {
    const cwd = sb.makeDir(`version-${index}`);
    writeFileSync(join(cwd, 'claude'), `2.1.${index}`, { mode: 0o755 });
    return cwd;
  });
  for (let i = 0; i < 8; i++) assert.equal(inspect(adapter, dirs[i]).version, `2.1.${i}`);
  assert.equal(inspect(adapter, dirs[0]).version, '2.1.0');
  assert.match(inspect(adapter, dirs[8]).detail!, /limit reached/);
  assert.deepEqual(calls, dirs.slice(0, 8).map(cwd => join(cwd, 'claude')));
});

test('CR55 doctor distinguishes same-named standard CLIs in different session directories', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const records = ['1', '2'].map((version) => {
    const cwd = sb.makeDir(`session-${version}`);
    writeFileSync(join(cwd, 'claude'), `#!${process.execPath}\nprocess.stdout.write('2.1.${version}');`, { mode: 0o755 });
    return { name: `session-${version}`, cwd, agent: 'claude', argv: 'claude', conversation: '', origin: 'none' };
  });
  ctx.store.write(records, {});
  const configured = { ...ctx, config: { ...ctx.config, agents: {} } };
  const findings = doctor(configured, { ...sb.env, PATH: '.' });
  const versions = findings.filter((f) => f.problem.includes('configured CLI'));
  assert.equal(versions.length, 2);
  for (let i = 0; i < records.length; i++) {
    assert.ok(versions[i].problem.includes(join(records[i].cwd, 'claude')));
    assert.ok(versions[i].problem.includes(`2.1.${i + 1}`));
  }
});
