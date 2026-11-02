import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../src/context.js';
import { create, list } from '../src/registry/sessions.js';
import { installTmux } from '../src/tmux/install.js';
import { wasClosed } from '../src/snapshot/lifecycle.js';
import { sandbox, waitFor } from './helpers.js';

const LITERAL = "literal #{session_name} #S ## #(printf noop) 'quoted'";

test('CR68 normal closure evidence survives format-looking state paths', async (t) => {
  const sb = sandbox(t);
  const ctx = createContext({ ...sb.env, BERTH_STATE_DIR: sb.makeDir(LITERAL) });
  create(ctx, { agent: 'shell', cwd: sb.root, name: 'victim' });
  const saved = ctx.store.newest()!.sessions.find((row) => row.name === 'victim')!;
  ctx.tmux.killSession('victim');
  await waitFor(() => wasClosed(ctx, saved), 'exact closure marker');
  assert.equal(list(ctx).some((row) => row.name === 'victim'), false, 'normal closure must not become recoverable');
});

test('CR68 installed and reloaded tmux hooks preserve literal CLI paths', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const cli = join(sb.makeDir(LITERAL), 'cli.cjs'), output = join(sb.root, 'hook-calls.jsonl');
  writeFileSync(cli, `require('node:fs').appendFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2))+'\\n');`);
  ctx.tmux.newSession('probe', sb.root, 'sleep 3600');
  const socket = ctx.tmux.run(['display-message', '-p', '#{socket_path}']).stdout.trim();
  const file = installTmux(ctx.tmux, cli, sb.env);
  const events = ['session-created', 'session-renamed', 'session-closed', 'alert-bell', 'client-attached', 'client-session-changed'];
  const calls = (): string[][] => existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  for (const reload of [false, true]) {
    if (reload) {
      for (const event of events) ctx.tmux.run(['set-hook', '-gu', `${event}[97]`]);
      ctx.tmux.run(['source-file', file]);
    }
    const before = calls().length;
    for (const event of events) ctx.tmux.run(['set-hook', '-R', '-t', '=probe:', event]);
    await waitFor(() => calls().length === before + events.length, 'all hook invocations');
    const batch = calls().slice(before);
    assert.deepEqual(batch.map((args) => args[2]).sort(), ['attached', 'attached', 'bell', 'snapshot', 'snapshot', 'snapshot']);
    for (const args of batch) {
      assert.equal(args[0], '--socket-path');
      assert.equal(args[1], socket);
      if (args[2] !== 'snapshot') assert.deepEqual(args.slice(3, 5), ['--session', 'probe']);
    }
  }
});
