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
    keptArgs(claude, "claude --name x --model opus --continue 'fix the bug' --add-dir /a --dangerously-skip-permissions"),
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
  assert.deepEqual(metaForEvent(opencode, 'session.updated', { sessionID: 'oc1' }), { conversation: 'oc1' });
  assert.deepEqual(metaForEvent(opencode, 'session.idle', {}), { state: 'done', note: '' });
  const codex = getAdapter('codex')!;
  assert.deepEqual(metaForEvent(codex, 'SessionStart', { session_id: 'cx' }), { conversation: 'cx' });
  assert.deepEqual(metaForEvent(codex, 'Stop', {}), { state: 'done', note: '' });
  assert.deepEqual(metaForEvent(codex, 'UserPromptSubmit', { session_id: 'cx', prompt: 'Next turn' }), { state: 'working', note: '', topic: 'Next turn' });
  assert.deepEqual(metaForEvent(codex, 'PermissionRequest', { session_id: 'cx' }), { state: 'waiting', note: '' });
  assert.deepEqual(metaForEvent(getAdapter('gemini')!, 'Anything', {}), {});
});

test('C13 each agent reports its conversation id and asks for attention only on permission', () => {
  const meta = (id: string, event: string, payload: Record<string, unknown>) => metaForEvent(getAdapter(id)!, event, payload);
  assert.deepEqual(meta('gemini', 'SessionStart', { session_id: 'g1' }), { conversation: 'g1' });
  assert.deepEqual(meta('gemini', 'BeforeAgent', {}), { state: 'working', note: '' });
  assert.deepEqual(meta('gemini', 'BeforeModel', {}), { state: 'working', note: '' });
  assert.deepEqual(meta('gemini', 'AfterTool', {}), {});
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


test('Codex interruption clears activity and tool completion clears approval waiting', () => {
  const codex = getAdapter('codex')!;
  assert.deepEqual(metaForEvent(codex, 'Interrupt', { session_id: 'cx' }), { state: '', note: '' });
  assert.deepEqual(metaForEvent(codex, 'PostToolUse', { session_id: 'cx' }), { state: 'working', note: '' });
  assert.deepEqual(metaForEvent(codex, 'PermissionRequest', { tool_name: 'Bash', tool_input: { description: 'Run verification?' } }), { state: 'waiting', note: 'Run verification?' });
  assert.deepEqual(metaForEvent(codex, 'PermissionRequest', { tool_name: 'Bash' }), { state: 'waiting', note: 'Approval requested: Bash' });
});


test('CR38 Kimi interruption clears activity without declaring successful completion', () => {
  assert.deepEqual(metaForEvent(getAdapter('kimi')!, 'Interrupt', { session_id: 'session_fixture', reason: 'user' }), { state: '', note: '' });
});


test('CR39 Kimi approval decisions resume activity and failed turns clear it', () => {
  const kimi = getAdapter('kimi')!;
  for (const decision of ['approve', 'reject']) {
    assert.deepEqual(metaForEvent(kimi, 'PermissionResult', { decision }), { state: 'working', note: '' });
  }
  for (const event of ['StopFailure', 'Interrupt']) {
    assert.deepEqual(metaForEvent(kimi, event, { message: 'Earlier notification' }), { state: '', note: '' });
  }
});


test('CR40 Qoder tool outcomes clear approval waiting and failures do not imply success', () => {
  const qoder = getAdapter('qoder')!;
  const waiting = { conversation: 'qoder_fixture', ...metaForEvent(qoder, 'PermissionRequest', { message: 'Allow fixture?' }) };
  for (const event of ['PostToolUse', 'PostToolUseFailure']) {
    assert.deepEqual({ ...waiting, ...metaForEvent(qoder, event, {}) }, { conversation: 'qoder_fixture', state: 'working', note: '' });
  }
  for (const event of ['PostToolUseFailure', 'StopFailure']) {
    assert.deepEqual({ ...waiting, ...metaForEvent(qoder, event, { is_interrupt: true, message: 'Stale request' }) }, { conversation: 'qoder_fixture', state: '', note: '' });
  }
  assert.equal(metaForEvent(qoder, 'PostToolUseFailure', { is_interrupt: 'true' }).state, 'working');
  assert.deepEqual(metaForEvent(qoder, 'UnregisteredEvent', { is_interrupt: true }), {});
});


test('CR43 Claude waits on explicit permission and resumes only after the whole batch', () => {
  const claude = getAdapter('claude')!;
  assert.equal(metaForEvent(claude, 'PermissionRequest', { tool_name: 'Bash' }).state, 'waiting');
  assert.equal(metaForEvent(claude, 'Notification', { notification_type: 'permission_prompt', message: '请批准' }).state, 'waiting');
  assert.deepEqual(metaForEvent(claude, 'Notification', { notification_type: 'idle_prompt', message: 'permission' }), {});
  assert.equal(metaForEvent(claude, 'Notification', { message: 'Claude needs permission' }).state, 'waiting');
  const waiting = { conversation: 'fixture', state: 'waiting', note: 'Allow?' };
  assert.deepEqual({ ...waiting, ...metaForEvent(claude, 'PostToolUse', {}) }, waiting);
  assert.deepEqual({ ...waiting, ...metaForEvent(claude, 'PostToolBatch', {}) }, { conversation: 'fixture', state: 'working', note: '' });
  assert.deepEqual({ ...waiting, ...metaForEvent(claude, 'StopFailure', { error: 'invalid_request' }) }, { conversation: 'fixture', state: '', note: '' });
});


test('CR50 Cursor stop reports success only for an explicit completed outcome', () => {
  const cursor = getAdapter('cursor')!;
  assert.deepEqual(metaForEvent(cursor, 'stop', { status: 'completed' }), { state: 'done', note: '' });
  for (const status of ['aborted', 'error', 'unknown', undefined, null, false]) {
    assert.deepEqual(metaForEvent(cursor, 'stop', { status, message: 'old request' }), { state: '', note: '' });
  }
  assert.deepEqual(metaForEvent(cursor, 'beforeSubmitPrompt', { prompt: 'Next task', status: 'error' }), { state: 'working', note: '', topic: 'Next task' });
  assert.deepEqual(metaForEvent(cursor, 'unregistered', { status: 'error' }), {});
});
