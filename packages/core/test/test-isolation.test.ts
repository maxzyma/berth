import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers.js';
import { Tmux } from '../src/tmux/client.js';

test('CR47 teardown validates the effective endpoint rather than a shadowed test name', (t) => {
  for (const target of [
    { socket: 'berth-test-named', socketPath: '/fixture/daily-server' },
    { socket: 'daily-server' }, {},
  ]) {
    const tmux = new Tmux({ bin: 'unused-fixture', ...target });
    const run = t.mock.method(tmux, 'run', () => ({ ok: true, stdout: '', stderr: '' }));
    assert.throws(() => tmux.killServer(), /not a Berth test server/);
    assert.equal(run.mock.callCount(), 0);
  }
  const tmux = new Tmux({ bin: 'unused-fixture', socket: 'shadowed', socketPath: '/fixture/berth-test-exact' });
  const run = t.mock.method(tmux, 'run', () => ({ ok: true, stdout: '', stderr: '' }));
  tmux.killServer();
  assert.equal(run.mock.callCount(), 1);
});

test('CR47 core sandbox removes inherited routing and profile selectors', (t) => {
  const injected = { BERTH_TMUX_SOCKET_PATH: '/fixture/daily-server', BERTH_CONFIG: '/fixture/config.toml',
    BERTH_STATE_DIR: '/fixture/state', BERTH_TMUX: '/fixture/tmux', BERTH_AUTO_ADOPT: '0',
    CLAUDE_CONFIG_DIR: '/fixture/claude', CODEX_HOME: '/fixture/codex', QODER_CONFIG_DIR: '/fixture/qoder',
    COPILOT_HOME: '/fixture/copilot', KIMI_CODE_HOME: '/fixture/kimi' };
  const previous = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, injected);
    const sb = sandbox(t), ctx = sb.ctx();
    for (const key of Object.keys(injected)) assert.equal(sb.env[key], undefined, key);
    assert.equal(ctx.tmux.target.socket, sb.socket);
    assert.equal(ctx.tmux.target.socketPath, undefined);
    assert.ok(ctx.config.stateDir.startsWith(sb.env.XDG_STATE_HOME));
    assert.equal(ctx.config.autoAdopt, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
