import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostRegistration, registeredHosts, workspaceIdentity } from '../src/registry/hosts.js';
import { sandbox, waitFor } from './helpers.js';
import { spawn } from 'node:child_process';
import { connections } from '../src/tmux/connections.js';

test('Workspace identity uses full registered URIs, independent of root order', () => {
  assert.notEqual(workspaceIdentity(['file:///a/project'])?.key, workspaceIdentity(['file:///b/project'])?.key);
  assert.equal(workspaceIdentity(['file:///a', 'file:///b'])?.key, workspaceIdentity(['file:///b', 'file:///a'])?.key);
  assert.equal(workspaceIdentity([]), undefined);
});

test('Only one live window claims startup; disposal releases the claim and registration', (t) => {
  const sb = sandbox(t);
  const stateDir = sb.ctx().config.stateDir;
  const workspace = workspaceIdentity(['file:///workspace/project']);
  const first = new HostRegistration(stateDir, 'Editor', workspace);
  const second = new HostRegistration(stateDir, 'Editor', workspace);
  first.update([123]);
  second.update([456]);
  assert.equal(registeredHosts(stateDir).length, 2);
  assert.equal(first.claimStartup(), true);
  assert.equal(second.claimStartup(), false);
  first.dispose();
  assert.equal(second.claimStartup(), true);
  assert.deepEqual(registeredHosts(stateDir).map((host) => host.terminalPids), [[456]]);
  second.dispose();
  assert.deepEqual(registeredHosts(stateDir), []);
});


test('live connections use the application of the matching registered host', async (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.tmux.newSession('host-name', sb.root, 'sleep 3600');
  const [bin, ...args] = ctx.tmux.attachArgv('host-name');
  const client = spawn(bin, ['-C', ...args], { env: sb.env, stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => client.kill());
  await waitFor(() => connections(ctx.tmux).get('host-name')?.length === 1, 'host client');
  const unrelated = new HostRegistration(ctx.config.stateDir, 'Unrelated Editor');
  unrelated.update([-1]);
  const owner = new HostRegistration(ctx.config.stateDir, 'Fixture Editor', workspaceIdentity(['file:///fixture/workspace'], '', 'Fixture workspace'));
  owner.update([client.pid!]);
  t.after(() => { owner.dispose(); unrelated.dispose(); });
  const attached = connections(ctx.tmux, registeredHosts(ctx.config.stateDir)).get('host-name')![0];
  assert.equal(attached.application, 'Fixture Editor');
  assert.equal(attached.workspace, 'Fixture workspace');
  owner.dispose();
  const unknown = connections(ctx.tmux, registeredHosts(ctx.config.stateDir)).get('host-name')![0];
  assert.notEqual(unknown.application, 'Fixture Editor');
  assert.notEqual(unknown.application, 'Unrelated Editor');
  assert.equal(unknown.workspace, undefined);
  const blank = new HostRegistration(ctx.config.stateDir, '   ');
  blank.update([client.pid!]);
  t.after(() => blank.dispose());
  assert.equal(connections(ctx.tmux, registeredHosts(ctx.config.stateDir)).get('host-name')![0].application, unknown.application);
});
