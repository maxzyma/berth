import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { autoLaunchScript, attachCommand, inspectIterm2, installIterm2 } from '../src/iterm2/install.js';
import { toolsFor } from '../src/tools.js';
import { createContext } from '../src/context.js';
import { shellSplit } from '../src/shell.js';
import { sandbox } from './helpers.js';

test('CR19 the generated host commands preserve custom endpoint and state configuration', (t) => {
  const sb = sandbox(t), socketPath = join(sb.root, 'berth-test-endpoint.sock');
  const ctx = createContext({ ...sb.env, BERTH_TMUX_SOCKET_PATH: socketPath });
  ctx.tmux.newSession('target', sb.root, 'sleep 3600');
  t.after(() => ctx.tmux.run(['kill-server'], true));
  const tools = toolsFor(ctx, '/fixture/cli.mjs');
  const [bin, selector, endpoint] = shellSplit(attachCommand(ctx, tools, 'target'));
  assert.equal(selector, '-S');
  assert.equal(endpoint, realpathSync(socketPath));
  const result = spawnSync(bin, [selector, endpoint, 'display-message', '-p', '-t', '=target:', '#{session_name}'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'target');
  const script = autoLaunchScript(tools);
  assert.ok(script.includes('"--socket-path"'));
  assert.ok(script.includes(realpathSync(socketPath)));
  assert.ok(script.includes(sb.env.XDG_STATE_HOME));
});

test('CR20 generated iTerm adapter requires an unchanged empty prompt inside a transaction', (t) => {
  const sb = sandbox(t), script = join(sb.root, 'generated.py');
  writeFileSync(script, autoLaunchScript({ node: '/node', cli: '/cli', tmux: '/tmux' }));
  const fixture = `
import asyncio, sys, types, json
active = False
class Transaction:
    def __init__(self, connection): pass
    async def __aenter__(self):
        global active
        assert not active
        active = True
    async def __aexit__(self, *args):
        global active
        active = False
class Pane:
    session_id = 'pane'
    def __init__(self, job='zsh', state='editing', command='', unique_id='prompt'):
        self.job, self.state, self.command, self.unique_id = job, state, command, unique_id
        self.name, self.sent = 'saved', []
    async def async_get_variable(self, key):
        assert active
        return self.name if key.startswith('user.') else self.job
    async def async_send_text(self, text):
        assert active
        self.sent.append(text)
async def prompt(connection, session_id):
    assert active
    return types.SimpleNamespace(state=pane.state, command=pane.command, unique_id=pane.unique_id)
sys.modules['iterm2'] = types.SimpleNamespace(Transaction=Transaction, PromptState=types.SimpleNamespace(EDITING='editing'), async_get_last_prompt=prompt, RPCException=RuntimeError, run_until_complete=lambda main: None)
scope = {}
exec(compile(open(sys.argv[1]).read(), 'generated', 'exec'), scope)
results = {}
for name, options, change in [
    ('ready', {}, None), ('editor', {'job':'vim'}, None),
    ('busy', {'state':'running'}, None), ('typed', {'command':'echo user'}, None),
    ('unknown', {'state':'unknown'}, None), ('no_prompt_id', {'unique_id':None}, None),
    ('changed_job', {}, 'job'), ('changed_prompt', {}, 'prompt'), ('changed_owner', {}, 'owner')]:
    pane = Pane(**options)
    calls = []
    def attach(name, existing_ttys=()):
        assert not active
        calls.append(name)
        if change == 'job': pane.job = 'vim'
        if change == 'prompt': pane.unique_id = 'different'
        if change == 'owner': pane.name = 'other'
        return 'tmux attach-session -t =saved'
    scope['attach_command'] = attach
    asyncio.run(scope['restore_pane'](None, pane, 'saved'))
    assert len(pane.sent) == (1 if name == 'ready' else 0), name
    if name in ['editor','busy','typed','unknown','no_prompt_id']: assert not calls, name
    results[name] = len(pane.sent)
print(json.dumps(results))
`;
  const result = spawnSync('python3', ['-c', fixture, script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  assert.equal(Object.keys(cases).length, 9);
  assert.equal(cases.ready, 1);
});

test('the iTerm2 script reports which Berth it runs: current, another, removed or none', (t) => {
  const sb = sandbox(t);
  const env = { HOME: sb.env.HOME };
  const cli = join(sb.root, 'berth cli.mjs');
  writeFileSync(cli, '// synthetic CLI\n');
  assert.equal(inspectIterm2(cli, env).state, 'missing');
  installIterm2({ node: process.execPath, cli, tmux: '/usr/bin/true' }, env);
  assert.equal(inspectIterm2(cli, env).state, 'current');
  assert.deepEqual(inspectIterm2('/elsewhere/cli.mjs', env), { state: 'other', target: cli });
  rmSync(cli);
  assert.equal(inspectIterm2('/elsewhere/cli.mjs', env).state, 'broken');
});

test('an iTerm2 script installed under an editor runtime runs it as Node', () => {
  const ctx = createContext({ HOME: '/fixture/home' });
  assert.equal(toolsFor(ctx, '/fixture/cli.mjs', true).env?.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(toolsFor(ctx, '/fixture/cli.mjs', false).env?.ELECTRON_RUN_AS_NODE, undefined);
});
