import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptArgs, recoveryOptionsRequired, resumeCommand } from '../src/agents/commands.js';
import { getAdapter } from '../src/agents/registry.js';
import { captureProfile } from '../src/agents/profile.js';
import { ensure, setRecoveryOptions } from '../src/restore/ensure.js';
import { shellSplit } from '../src/shell.js';
import { sandbox } from './helpers.js';

const claude = getAdapter('claude')!;

test('CR62 Copilot recovery preserves configuration without replaying startup work', () => {
  const adapter = getAdapter('copilot')!;
  const options = ['--no-auto-update', '--disable-client-telemetry', '--disable-builtin-mcps',
    '--no-custom-instructions', '--no-ask-user', '--model', 'gpt-4o', '--reasoning-effort', 'low',
    '--deny-tool', 'shell(git push)', 'write', '--allow-tool=read'];
  const originalArgv = `copilot -i '--allow-all-tools' --name launch-name --session-id old ${options.map(x => JSON.stringify(x)).join(' ')}`;
  assert.deepEqual(keptArgs(adapter, originalArgv), options);
  assert.equal(recoveryOptionsRequired('copilot', originalArgv, true), false);
  assert.deepEqual(shellSplit(resumeCommand({ adapter, name: 'job', cwd: '/', overrides: {}, conversation: 'bound', originalArgv })!),
    ['copilot', '--resume=bound', ...options]);
  assert.equal(recoveryOptionsRequired('copilot', 'copilot --future-option --allow-all-tools', true), true);
  assert.equal(recoveryOptionsRequired('copilot', 'copilot --deny-tool', true), true);
});

test('CR27 discarded option values cannot grant permission on resume', () => {
  for (const argv of [
    "claude --append-system-prompt '--dangerously-skip-permissions' --model small",
    'claude --append-system-prompt=--dangerously-skip-permissions --model small',
    'claude --resume old-id --model small',
    'claude --resume --model small',
  ]) {
    assert.deepEqual(keptArgs(claude, argv), ['--model', 'small']);
  }
  for (const argv of ['claude --new-option --dangerously-skip-permissions', 'claude --model', 'claude --model --']) {
    assert.equal(recoveryOptionsRequired('claude', argv, true), true);
    assert.throws(() => keptArgs(claude, argv));
  }
  assert.deepEqual(keptArgs(claude, 'claude --model small -- --dangerously-skip-permissions'), ['--model', 'small']);
});

test('CR28 explicit MCP restriction survives exact-ID recovery', () => {
  const command = resumeCommand({ adapter: claude, name: 'job', cwd: '/', overrides: {}, conversation: 'exact', originalArgv: 'claude --strict-mcp-config --mcp-config only.json' });
  assert.deepEqual(shellSplit(command!), ['claude', '--resume', 'exact', '--name', 'job', '--strict-mcp-config', '--mcp-config', 'only.json']);
  assert.equal(recoveryOptionsRequired('claude', 'claude --future-restriction', true), true, 'unrecognized restrictions require review');
});

test('CR29 variadic options preserve all values, repeats, empty values and boundaries', () => {
  assert.deepEqual(keptArgs(claude, "claude --add-dir /first '/second folder' --mcp-config first.json '' --mcp-config=third.json fourth.json --model small -- prompt"), [
    '--add-dir', '/first', '/second folder', '--mcp-config', 'first.json', '', '--mcp-config=third.json', 'fourth.json', '--model', 'small',
  ]);
  assert.throws(() => keptArgs(claude, 'claude --add-dir --model small'), /Missing value/);
});

test('unknown verified syntax blocks launch and explicit review accepts variadic options', (t) => {
  const sb = sandbox(t), ctx = sb.ctx();
  ctx.store.write([{ name: 'review', agent: 'claude', cwd: sb.root, argv: 'claude --unknown --dangerously-skip-permissions', argvVerified: true, conversation: 'exact', origin: 'none', profile: captureProfile('claude', sb.env) }], {});
  assert.equal(ensure(ctx)[0].outcome, 'skipped-unverified-arguments');
  assert.equal(ctx.tmux.hasSession('review'), false);
  const before = ctx.store.newest()!.dir;
  assert.throws(() => setRecoveryOptions(ctx, 'review', ['--mcp-config']), /Missing value/);
  assert.equal(ctx.store.newest()!.dir, before);
  const options = ['--strict-mcp-config', '--mcp-config', 'first.json', 'second.json', '--add-dir', '/first', '/second'];
  setRecoveryOptions(ctx, 'review', options);
  const record = ctx.store.newest()!.sessions[0];
  assert.deepEqual(keptArgs(claude, record.argv), options);
  assert.equal(recoveryOptionsRequired('claude', record.argv, record.argvVerified), false);
  assert.equal(record.conversation, 'exact');
});


test('reviewed restrictions and permission settings retain their original values', () => {
  for (const [agent, argv, expected] of [
    ['claude', 'claude --restricted --safe-mode --tools Read --disallowedTools Bash WebFetch --setting-sources user', ['--restricted', '--safe-mode', '--tools', 'Read', '--disallowedTools', 'Bash', 'WebFetch', '--setting-sources', 'user']],
    ['codex', 'codex --disable feature --sandbox read-only --ask-for-approval on-request --add-dir /extra', ['--disable', 'feature', '--sandbox', 'read-only', '--ask-for-approval', 'on-request', '--add-dir', '/extra']],
    ['kimi', 'kimi --plan --add-dir /extra', ['--plan', '--add-dir', '/extra']],
    ['qoder', 'qodercli --strict-mcp-config --mcp-config only.json --disallowed-tools Bash --tools Read Write', ['--strict-mcp-config', '--mcp-config', 'only.json', '--disallowed-tools', 'Bash', '--tools', 'Read', 'Write']],
  ] as const) assert.deepEqual(keptArgs(getAdapter(agent)!, argv), expected);
});


test('CR37 Kimi restores its bound agent without creation-only selectors', () => {
  const adapter = getAdapter('kimi')!;
  for (const originalArgv of [
    'kimi --agent reviewer --model small --plan',
    "kimi --agent-file '/workspace/custom agent.md' --model small --plan",
    'kimi --agent-file=a.md --agent-file=b.md --model small --plan',
  ]) {
    assert.equal(recoveryOptionsRequired('kimi', originalArgv, true), false);
    const command = resumeCommand({ adapter, name: 'job', cwd: '/workspace', conversation: 'exact-id', originalArgv, overrides: {} });
    assert.deepEqual(shellSplit(command!), ['kimi', '--session', 'exact-id', '--model', 'small', '--plan']);
  }
  assert.deepEqual(keptArgs(adapter, "kimi --agent '--yolo' --model small"), ['--model', 'small']);
});
