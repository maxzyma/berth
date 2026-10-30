/** C16: sessions running an agent are managed without any launcher stamping them (spec §4.3). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentAmong } from '../src/registry/discover.js';
import { CLI, killServer, sandbox, waitFor } from './helpers.js';

test('C16 agents are recognised by program name, also behind an interpreter or a launcher shell', () => {
  const procs = [
    { pid: 10, ppid: 1, args: '-zsh' },
    { pid: 11, ppid: 10, args: 'bash /home/u/bin/my-launcher --cli claude' },
    { pid: 12, ppid: 11, args: 'claude --name w --model opus' },
    { pid: 20, ppid: 1, args: 'node /usr/local/lib/node_modules/@x/codex/bin/codex -m o3' },
    { pid: 30, ppid: 1, args: 'vim notes.md' },
  ];
  assert.deepEqual(agentAmong(10, procs), { agent: 'claude', argv: 'claude --name w --model opus' });
  assert.deepEqual(agentAmong(20, procs), { agent: 'codex', argv: 'codex -m o3' });
  assert.equal(agentAmong(30, procs), undefined);
});

test('C16 a session a launcher started without Berth is managed, restorable, and can be left alone', async (t) => {
  const sb = sandbox(t);
  const bin = sb.makeDir('bin');
  writeFileSync(join(bin, 'kimi'), '#!/bin/sh\nsleep 3600\n');
  chmodSync(join(bin, 'kimi'), 0o755);
  const project = sb.makeDir('ws/projects/p');
  // Like a launcher: the session starts at the root, the agent runs in a project.
  sb.tmux('new-session', '-d', '-s', 'foreign', '-c', sb.makeDir('ws'), `sh -c 'cd "${project}" && ${join(bin, 'kimi')} --yolo'`);
  sb.tmux('new-session', '-d', '-s', 'plain', 'sleep 3600');
  await waitFor(() => sb.tmux('display-message', '-p', '-t', '=foreign:', '#{pane_current_path}').trim().endsWith('/projects/p'), 'agent in project');

  const off = { ...sb.env, BERTH_AUTO_ADOPT: '0' };
  spawnSync(process.execPath, [CLI, 'ls'], { env: off });
  assert.equal(sb.tmux('display-message', '-p', '-t', '=foreign:', '#{@berth_agent}').trim(), '', 'switched off: untouched');

  sb.cli('ls');
  const meta = sb.tmux('display-message', '-p', '-t', '=foreign:', '#{@berth_agent}|#{@berth_cwd}|#{@berth_argv}|#{@berth_origin}').trim();
  assert.match(meta, /^kimi\|.*\/ws\/projects\/p\|kimi --yolo\|none$/);
  assert.equal(sb.tmux('display-message', '-p', '-t', '=plain:', '#{@berth_agent}').trim(), '', 'no agent: not managed');
  killServer(sb);
  assert.match(sb.cli('ensure').stdout, /foreign\t/, 'in the snapshot, so it comes back');
});
