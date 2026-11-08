import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connections } from '../src/tmux/connections.js';
import { clientsOf } from '../src/present/state.js';
import { join } from 'node:path';
import { formatFields, readFields } from '../src/tmux/fields.js';
import { processDirectory } from '../src/process-directory.js';
import { adopt } from '../src/registry/sessions.js';
import { discover, sessionProducers } from '../src/registry/discover.js';
import { takeSnapshot } from '../src/snapshot/take.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, waitFor } from './helpers.js';

test('CR26 native tmux records preserve delimiters, literal escapes and boundary whitespace', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const cwd = realpathSync(sb.makeDir(' leading\nline\tcolumn\rreturn\x1ffield~tilde=7E=3D=0A%7E%0A%25 trailing '));
  ctx.tmux.newSession('native', cwd, 'sleep 3600');
  ctx.tmux.setMeta('native', { agent: 'shell', cwd, note: 'one\ntwo\x1fthree%0A ', argv: 'shell' });
  const rows = ctx.tmux.listSessions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, cwd);
  assert.equal(rows[0].meta.cwd, cwd);
  assert.equal(rows[0].meta.note, 'one\ntwo\x1fthree%0A ');
  assert.equal(ctx.tmux.paneCurrentPath('native'), cwd);
  const encoded = ctx.tmux.run(['list-panes', '-t', '=native:', '-F', formatFields(['session_name', 'pane_current_path'])]).stdout;
  assert.deepEqual(readFields(encoded, 2), [['native', cwd]]);
  takeSnapshot(ctx);
  assert.equal(ctx.store.newest()!.sessions[0].cwd, cwd);
  assert.throws(() => readFields('broken\nrecord\n', 2), /Malformed tmux record/);
});

test('CR26 external producer directory uses native identity, including ambiguous lsof display characters', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const cwd = realpathSync(sb.makeDir('line\nbreak^_literal\x1fcontrol\tend '));
  const bin = sb.makeDir('bin'), agent = join(bin, 'claude');
  writeFileSync(agent, '#!/bin/sh\nsleep 3600\n');
  chmodSync(agent, 0o755);
  ctx.tmux.newSession('external', sb.root, `sh -c ${shellQuote(`(cd ${shellQuote(cwd)} && ${shellQuote(agent)}); sleep 3600`)}`);
  await waitFor(() => sessionProducers(ctx, 'external').length === 1, 'external producer');
  const producer = sessionProducers(ctx, 'external')[0];
  assert.equal(producer.cwd, cwd);
  assert.equal(processDirectory(producer.pid), cwd);
  adopt(ctx, 'external', 'claude');
  assert.equal(ctx.tmux.listSessions()[0].meta.cwd, cwd, 'explicit adoption uses the producer directory, not its launcher');
  discover(ctx);
  assert.equal(ctx.tmux.listSessions()[0].meta.cwd, cwd);
  assert.equal(processDirectory(-1), undefined);
});


test('CR26 client and pane records retain an externally supplied whitespace and escape-looking session name', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  const name = ' external%0A%25name ';
  ctx.tmux.newSession(name, sb.root, 'sleep 3600');
  const pane = ctx.tmux.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_id}']).stdout.trim();
  assert.equal(ctx.tmux.sessionOfPane(pane), name);
  assert.equal(ctx.tmux.listSessions()[0].name, name);
  const [bin, ...args] = ctx.tmux.attachArgv(name);
  const client = spawn(bin, ['-C', ...args], { env: sb.env, stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => client.kill());
  await waitFor(() => connections(ctx.tmux).get(name)?.length === 1, 'named control client');
  assert.equal(connections(ctx.tmux).get(name)![0].pid, client.pid);
  assert.equal(clientsOf(ctx.tmux, name).length, 1);
});

test('batched metadata keeps separators, escapes and empty values literal', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('meta', sb.root, 'sleep 3600');
  const values = { cwd: 'ends;', note: 'mid;dle', topic: 'escaped\\;', origin: ';', state: '' };
  ctx.tmux.setMeta('meta', values);
  const meta = ctx.tmux.listSessions().find((session) => session.name === 'meta')!.meta;
  assert.deepEqual({ cwd: meta.cwd, note: meta.note, topic: meta.topic, origin: meta.origin, state: meta.state ?? '' }, values);
});
