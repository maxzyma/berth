import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tmux } from '../src/tmux/client.js';
import { detachTerminalClients, waitForAttachment } from '../src/tmux/connections.js';

function client(session: string, pid: number): Tmux {
  const tmux = new Tmux({ bin: 'tmux' });
  tmux.run = () => ({ ok: true, stdout: `${session}~${pid}~/dev/test~xterm\n`, stderr: '' });
  return tmux;
}

test('Attachment acknowledgement requires both terminal ancestry and exact destination', async () => {
  await waitForAttachment(client('wanted', process.pid), 'wanted', process.pid, { timeoutMs: 0 });
  await assert.rejects(waitForAttachment(client('other', process.pid), 'wanted', process.pid, { timeoutMs: 0 }), /Could not confirm/);
  await assert.rejects(waitForAttachment(client('wanted', 99999999), 'wanted', process.pid, { timeoutMs: 0 }), /Could not confirm/);
  await assert.rejects(waitForAttachment(client('wanted', process.pid), 'wanted', process.pid, { exited: () => true }), /exited/);
});


test('Detach affects only clients descended from the current window terminals', () => {
  const tmux = new Tmux({ bin: 'tmux' });
  const detached: string[][] = [];
  tmux.run = (args) => {
    if (args[0] === 'detach-client') detached.push(args);
    return { ok: true, stdout: `wanted~${process.pid}~/dev/local~xterm\nwanted~99999999~/dev/other~xterm\n`, stderr: '' };
  };
  detachTerminalClients(tmux, 'wanted', new Set([process.pid]));
  assert.deepEqual(detached, [['detach-client', '-t', '/dev/local']]);
});
