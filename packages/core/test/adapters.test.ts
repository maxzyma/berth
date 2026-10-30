/** C13: every baseline adapter renders its commands, keeps the right arguments and maps events. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, getAdapter } from '../src/agents/registry.js';
import { keptArgs, launchCommand, resumeCommand } from '../src/agents/commands.js';
import { metaForEvent } from '../src/agents/hooks.js';
import { shellSplit } from '../src/shell.js';

const BASELINE = ['claude', 'codex', 'gemini', 'opencode', 'copilot', 'cursor', 'kimi', 'qoder'];

/** Expected commands (spec §8). */
const EXPECTED: Record<string, { launch: string[]; resume: string[] }> = {
  claude: { launch: ['claude', '--name', 'web'], resume: ['claude', '--resume', 'ID', '--name', 'web'] },
  codex: { launch: ['codex'], resume: ['codex', 'resume', 'ID'] },
  gemini: { launch: ['gemini'], resume: ['gemini', '--resume', 'ID'] },
  opencode: { launch: ['opencode'], resume: ['opencode', '--session', 'ID'] },
  copilot: { launch: ['copilot'], resume: ['copilot', '--resume=ID'] },
  cursor: { launch: ['cursor-agent'], resume: ['cursor-agent', '--resume', 'ID'] },
  kimi: { launch: ['kimi'], resume: ['kimi', '--session', 'ID'] },
  qoder: { launch: ['qodercli', '--name', 'web'], resume: ['qodercli', '--resume', 'ID'] },
};

test('C13 every baseline agent has an adapter with a recorded source', () => {
  for (const id of BASELINE) {
    const adapter = getAdapter(id);
    assert.ok(adapter, `missing adapter ${id}`);
    assert.match(adapter.source, /help|cmux/, `${id} must record its source`);
    assert.ok(adapter.resume, `${id} must resume (spec G8)`);
  }
  assert.deepEqual(ADAPTERS.map((a) => a.id).sort(), [...BASELINE, 'shell'].sort());
});

test('C13 launch and resume commands match spec §8', () => {
  for (const id of BASELINE) {
    const adapter = getAdapter(id)!;
    const base = { adapter, name: 'web', cwd: '/w', overrides: {} };
    assert.deepEqual(shellSplit(launchCommand(base)), EXPECTED[id].launch, `${id} launch`);
    const resume = resumeCommand({ ...base, conversation: 'ID', originalArgv: '' });
    assert.deepEqual(shellSplit(resume ?? ''), EXPECTED[id].resume, `${id} resume`);
  }
});

test('C13 resume keeps configuring options and drops prompts and session selectors', () => {
  const claude = getAdapter('claude')!;
  assert.deepEqual(
    keptArgs(claude, "claude --name x --model opus --continue --add-dir /a 'fix the bug' --dangerously-skip-permissions"),
    ['--model', 'opus', '--add-dir', '/a', '--dangerously-skip-permissions'],
  );
  const codex = getAdapter('codex')!;
  assert.deepEqual(keptArgs(codex, 'codex -m o3 --config=a=b resume old-id "a prompt"'), ['-m', 'o3', '--config=a=b']);
  const resumed = resumeCommand({ adapter: codex, name: 'n', cwd: '/', overrides: {}, conversation: 'new', originalArgv: 'codex -m o3 resume old' });
  assert.deepEqual(shellSplit(resumed ?? ''), ['codex', 'resume', 'new', '-m', 'o3']);
});

test('C13 quoting survives values with spaces and quotes', () => {
  const claude = getAdapter('claude')!;
  const cmd = launchCommand({ adapter: claude, name: "it's", cwd: '/', overrides: {}, extraArgs: ['--add-dir', '/a b'] });
  assert.deepEqual(shellSplit(cmd), ['claude', '--name', "it's", '--add-dir', '/a b']);
});

test('C13 config overrides replace templates', () => {
  const kimi = getAdapter('kimi')!;
  const cmd = launchCommand({ adapter: kimi, name: 'n', cwd: '/', overrides: { kimi: { launch: 'my-kimi --profile work {args}' } } });
  assert.equal(cmd, 'my-kimi --profile work');
});

test('C13 hook events map to state and conversation id', () => {
  const opencode = getAdapter('opencode')!;
  assert.deepEqual(metaForEvent(opencode, 'session.created', { sessionID: 'oc1' }), { conversation: 'oc1' });
  assert.deepEqual(metaForEvent(opencode, 'session.idle', {}), { state: 'done', note: '' });
  const codex = getAdapter('codex')!;
  assert.deepEqual(metaForEvent(codex, 'SessionStart', { session_id: 'cx' }), { conversation: 'cx' });
  assert.deepEqual(metaForEvent(codex, 'Stop', {}), { state: 'done', note: '' });
  assert.deepEqual(metaForEvent(getAdapter('gemini')!, 'Anything', {}), {});
});

test('C13 each agent reports its conversation id and asks for attention only on permission', () => {
  const meta = (id: string, event: string, payload: Record<string, unknown>) => metaForEvent(getAdapter(id)!, event, payload);
  assert.deepEqual(meta('gemini', 'SessionStart', { session_id: 'g1' }), { conversation: 'g1' });
  assert.deepEqual(meta('gemini', 'BeforeAgent', {}), { state: 'working', note: '' });
  assert.deepEqual(meta('gemini', 'Notification', { notification_type: 'ToolPermission', message: 'Allow?' }), { state: 'waiting', note: 'Allow?' });
  assert.deepEqual(meta('gemini', 'Notification', { notification_type: 'Other' }), {});
  assert.deepEqual(meta('gemini', 'AfterAgent', {}), { state: 'done', note: '' });
  assert.deepEqual(meta('copilot', 'sessionStart', { sessionId: 'cp1' }), { conversation: 'cp1' }, 'camelCase payload');
  assert.deepEqual(meta('copilot', 'notification', { notificationType: 'permission_prompt' }), { state: 'waiting', note: '' });
  assert.deepEqual(meta('copilot', 'notification', { notification_type: 'agent_idle' }), {});
  assert.deepEqual(meta('cursor', 'sessionStart', { conversation_id: 'cu1' }), { conversation: 'cu1' });
  assert.deepEqual(meta('cursor', 'beforeSubmitPrompt', {}), { state: 'working', note: '' });
  for (const id of ['kimi', 'qoder']) {
    assert.deepEqual(meta(id, 'SessionStart', { session_id: `${id}1` }), { conversation: `${id}1` });
    assert.deepEqual(meta(id, 'PermissionRequest', {}), { state: 'waiting', note: '' });
    assert.deepEqual(meta(id, 'Stop', {}), { state: 'done', note: '' });
  }
  for (const id of BASELINE) assert.ok(getAdapter(id)!.hookTarget, `${id} has a conversation id source (spec G8)`);
});
