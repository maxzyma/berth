import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleHook } from '../src/agents/hooks.js';
import { agentsAmong } from '../src/registry/discover.js';
import { ensure } from '../src/restore/ensure.js';
import { takeSnapshot } from '../src/snapshot/take.js';
import { sandbox, killServer } from './helpers.js';

test('Independent branches are conflicts; nested subagents belong to their parent', () => {
  const tree = [
    { pid: 10, ppid: 1, args: 'sh' },
    { pid: 11, ppid: 10, args: 'claude' },
    { pid: 12, ppid: 11, args: 'codex' },
    { pid: 13, ppid: 10, args: 'claude' },
  ];
  assert.deepEqual(agentsAmong(10, tree).map((p) => p.pid), [11, 13]);
});

test('Other panes and adapters cannot overwrite bound conversation or state', (t) => {
  const sb = sandbox(t);
  const ctx = sb.ctx();
  const cwd = sb.makeDir('project');
  ctx.tmux.newSession('bound', cwd, 'sleep 3600');
  ctx.tmux.setMeta('bound', { agent: 'claude', cwd, conversation: 'original', state: 'working' });
  const socket = sb.tmux('display-message', '-p', '-t', '=bound:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=bound:', '#{pane_id}').trim();
  const env = { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane };
  handleHook('claude', 'SessionStart', JSON.stringify({ session_id: 'original' }), env);
  const other = sb.tmux('split-window', '-d', '-P', '-F', '#{pane_id}', '-t', '=bound:', 'sleep 3600').trim();
  handleHook('claude', 'SessionStart', JSON.stringify({ session_id: 'other' }), { ...env, TMUX_PANE: other });
  handleHook('codex', 'SessionStart', JSON.stringify({ session_id: 'codex-other' }), { ...env, TMUX_PANE: other });
  const meta = ctx.tmux.listSessions()[0].meta;
  assert.equal(meta.agent, 'claude');
  assert.equal(meta.conversation, 'original');
  assert.equal(meta.state, 'working');
  assert.ok(meta.bindingIssue);
  takeSnapshot(ctx);
  killServer(sb);
  assert.equal(ensure(ctx)[0].outcome, 'skipped-binding-conflict');
  assert.equal(ctx.tmux.hasSession('bound'), false);
});

test('Delayed lifecycle events for a previous conversation are ignored', (t) => {
  const sb = sandbox(t);
  const ctx = sb.ctx();
  ctx.tmux.newSession('bound', sb.makeDir('project'), 'sleep 3600');
  ctx.tmux.setMeta('bound', { agent: 'claude', conversation: 'current', state: 'working' });
  const socket = sb.tmux('display-message', '-p', '-t', '=bound:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=bound:', '#{pane_id}').trim();
  handleHook('claude', 'Stop', JSON.stringify({ session_id: 'previous' }), { ...sb.env, TMUX: `${socket},1,0`, TMUX_PANE: pane });
  assert.equal(ctx.tmux.listSessions()[0].meta.state, 'working');
});
