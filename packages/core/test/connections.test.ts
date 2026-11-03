import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connections, handoffTerminalClients } from '../src/tmux/connections.js';
import { list } from '../src/registry/sessions.js';
import { sandbox } from './helpers.js';

test('inventory counts use the client sample, not an earlier session count', t => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('connection-fixture', sb.root, 'sleep 3600');
  const run = ctx.tmux.run.bind(ctx.tmux);
  t.mock.method(ctx.tmux, 'run', (args: string[], allowFail = false) => args[0] === 'list-clients'
    ? { ok: true, stdout: `connection-fixture~${process.pid}~/dev/fixture~xterm\n`, stderr: '' }
    : run(args, allowFail));
  const row = list(ctx).find(row => row.name === 'connection-fixture')!;
  assert.equal(row.attachedClients, 1);
  assert.equal(row.connections?.length, 1);
});

test('client query failure rejects inventory instead of reporting no connections', t => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('connection-fixture', sb.root, 'sleep 3600');
  const run = ctx.tmux.run.bind(ctx.tmux);
  t.mock.method(ctx.tmux, 'run', (args: string[], allowFail = false) => args[0] === 'list-clients'
    ? { ok: false, stdout: '', stderr: 'fixture read failure' }
    : run(args, allowFail));
  assert.throws(() => list(ctx), /Could not read terminal connections/);
  assert.throws(() => connections(ctx.tmux, [], true), /fixture read failure/);
});

for (const scenario of ['success', 'destination lost', 'source switched', 'source replaced', 'query failed'] as const) {
  test(`terminal handoff: ${scenario}`, t => {
    const ctx = sandbox(t).ctx();
    const source = { pid: 99000001, terminal: '/dev/source', application: '', ancestors: [99000001] };
    const detached: string[] = [];
    t.mock.method(ctx.tmux, 'run', (args: string[]) => {
      if (args[0] === 'detach-client') {
        detached.push(args[2]);
        return { ok: true, stdout: '', stderr: '' };
      }
      const destination = scenario === 'destination lost' ? '' : 'target~99000002~/dev/destination~xterm\n';
      const session = scenario === 'source switched' ? 'other' : 'target';
      const pid = scenario === 'source replaced' ? 99000003 : source.pid;
      return { ok: scenario !== 'query failed', stdout: `${destination}${session}~${pid}~/dev/source~xterm\ntarget~99000004~/dev/external~xterm\n`, stderr: 'read failure' };
    });
    const transfer = () => handoffTerminalClients(ctx.tmux, 'target', 99000002, [source]);
    if (scenario === 'destination lost' || scenario === 'query failed') assert.throws(transfer);
    else transfer();
    assert.deepEqual(detached, scenario === 'success' ? ['/dev/source'] : []);
  });
}
