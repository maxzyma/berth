import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, lstatSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { inspectTmuxHooks, installTmux, uninstallTmux, tmuxConfPath } from '../src/tmux/install.js';
import { sandbox } from './helpers.js';

const BEGIN = '# >>> berth >>>', END = '# <<< berth <<<';

test('CR69 tmux installation preserves unrelated marker text, whitespace and symlink modes', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), file = tmuxConfPath(sb.env), target = join(sb.root, 'actual.conf');
  const original = `\n\nset -g @example '${BEGIN}'\n\n\nset -g @other '${END}'\n\n`;
  writeFileSync(target, original); chmodSync(target, 0o640); symlinkSync(target, file);
  installTmux(ctx.tmux, '/fixture/cli.js', sb.env);
  const tail = 'set -g mouse on\n';
  const installed = readFileSync(target, 'utf8') + tail;
  writeFileSync(target, installed);
  installTmux(ctx.tmux, '/fixture/cli.js', sb.env);
  assert.equal(readFileSync(target, 'utf8'), installed);
  assert.ok(lstatSync(file).isSymbolicLink());
  assert.equal(statSync(target).mode & 0o777, 0o640);
  uninstallTmux(ctx.tmux, sb.env);
  assert.equal(readFileSync(target, 'utf8'), original + tail);
  uninstallTmux(ctx.tmux, sb.env);
  assert.equal(readFileSync(target, 'utf8'), original + tail);
});

test('CR69 incomplete, reversed and duplicate managed blocks fail without writes', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), file = tmuxConfPath(sb.env);
  for (const text of [BEGIN, END, `${END}\n${BEGIN}\n`, `${BEGIN}\n${BEGIN}\n${END}\n`, `${BEGIN}\n${END}\n${BEGIN}\n${END}\n`]) {
    writeFileSync(file, text);
    assert.throws(() => installTmux(ctx.tmux, '/fixture/cli.js', sb.env), /Invalid Berth managed block/);
    assert.throws(() => uninstallTmux(ctx.tmux, sb.env), /Invalid Berth managed block/);
    assert.equal(readFileSync(file, 'utf8'), text);
  }
});

test('CR69 failed staged tmux writes preserve the original and remove partial files', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), file = tmuxConfPath(sb.env), original = 'set -g mouse on\n';
  writeFileSync(file, original);
  const realWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (String(target).startsWith(sb.env.HOME)) {
      realWrite(target, 'partial', options);
      throw new Error('fixture disk full');
    }
    return realWrite(target, data, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => installTmux(ctx.tmux, '/fixture/cli.js', sb.env), /fixture disk full/);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.deepEqual(readdirSync(sb.env.HOME), ['.tmux.conf']);
});

test('CR69 live installation and removal failures report partial completion and allow retry', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), file = tmuxConfPath(sb.env);
  ctx.tmux.newSession('running', sb.root, 'sleep 3600');
  const run = ctx.tmux.run.bind(ctx.tmux);
  const failure = t.mock.method(ctx.tmux, 'run', (args: string[], allowFail = false) => {
    if (args[0] === 'set-hook') {
      if (allowFail) return { ok: false, stdout: '', stderr: 'fixture live failure' };
      throw new Error('fixture live failure');
    }
    return run(args, allowFail);
  });
  assert.throws(() => installTmux(ctx.tmux, '/fixture/cli.js', sb.env), /changes are complete.*fixture live failure/);
  assert.ok(readFileSync(file, 'utf8').includes(BEGIN));
  assert.throws(() => uninstallTmux(ctx.tmux, sb.env), /changes are complete.*fixture live failure/);
  assert.equal(readFileSync(file, 'utf8'), '');
  failure.mock.restore();
  installTmux(ctx.tmux, '/fixture/cli.js', sb.env);
  uninstallTmux(ctx.tmux, sb.env);
  uninstallTmux(ctx.tmux, sb.env);
});

test('tmux hook inspection tells current, other, broken and missing blocks apart', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), file = tmuxConfPath(sb.env);
  const dir = join(sb.root, 'Editor Helper (Plugin) #1');
  fs.mkdirSync(dir, { recursive: true });
  const runtime = { executable: join(dir, 'helper'), electron: true };
  writeFileSync(runtime.executable, '');
  chmodSync(runtime.executable, 0o755);
  const cli = join(dir, 'cli.mjs'), other = join(sb.root, 'other-cli.js');
  writeFileSync(cli, '');
  writeFileSync(other, '');
  assert.equal(inspectTmuxHooks(cli, sb.env, runtime).state, 'missing');
  ctx.tmux.newSession('live', sb.root, 'sleep 3600');
  installTmux(ctx.tmux, cli, sb.env, runtime);
  assert.equal(inspectTmuxHooks(cli, sb.env, runtime).state, 'current');
  assert.match(sb.tmux('show-hooks', '-g', 'session-created[97]'), /ELECTRON_RUN_AS_NODE=1/);
  installTmux(ctx.tmux, other, sb.env, { executable: process.execPath, electron: false });
  assert.deepEqual(inspectTmuxHooks(cli, sb.env, runtime), { state: 'other', block: inspectTmuxHooks(cli, sb.env, runtime).block, target: other });
  installTmux(ctx.tmux, join(sb.root, 'removed.js'), sb.env, { executable: process.execPath, electron: false });
  assert.equal(inspectTmuxHooks(cli, sb.env, runtime).state, 'broken');
  writeFileSync(file, `${BEGIN}\nset-hook -g session-created[97] 'unrecognized'\n${END}\n`);
  assert.equal(inspectTmuxHooks(cli, sb.env, runtime).state, 'broken');
});
