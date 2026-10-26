/**
 * L1 (opt-in, implementation §5.5): a real Claude Code session survives a
 * server kill and resumes its own conversation.
 *
 * Usage is kept minimal: one agent, the smallest model, one short prompt
 * (about one model request); resuming sends nothing. Runs only with
 * BERTH_LIVE=1 and at most once every 6 hours unless BERTH_LIVE_FORCE=1.
 * Hooks are injected with --settings, so ~/.claude/settings.json is not
 * touched; Claude still records the conversation under ~/.claude as usual.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI, killServer, sandbox, waitFor } from '../helpers.js';
import { hookCommand } from '../../src/agents/hooks.js';

const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STAMP = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'berth-live', 'last-run');

function skipReason(): string | undefined {
  if (!process.env.BERTH_LIVE) return 'set BERTH_LIVE=1 to run live tests';
  if (spawnSync('claude', ['--version']).status !== 0) return 'claude not installed';
  if (!process.env.BERTH_LIVE_FORCE && existsSync(STAMP)) {
    const last = Number(readFileSync(STAMP, 'utf8'));
    if (Date.now() - last < MIN_INTERVAL_MS) return 'ran less than 6 hours ago (BERTH_LIVE_FORCE=1 to override)';
  }
  return undefined;
}

const reason = skipReason();

/** Wait until the pane has not changed for `quietMs`. */
async function steady(read: () => string, quietMs: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = read();
  let since = Date.now();
  while (Date.now() - since < quietMs) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 50));
    const now = read();
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
}

test('L1 a live Claude session resumes its own conversation after the server dies', { skip: reason, timeout: 300_000 }, async (t) => {
  mkdirSync(join(STAMP, '..'), { recursive: true });
  writeFileSync(STAMP, String(Date.now()));

  const settings = join(process.env.TMPDIR || '/tmp', `berth-live-settings-${process.pid}.json`);
  const events = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop'];
  writeFileSync(
    settings,
    JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: 'command', command: hookCommand(CLI, 'claude', e) }] }]])) }),
  );
  const base = `claude --settings ${settings} --model haiku`;
  const sb = sandbox(t, {
    claude: { launch: `${base} --name {name} {args}`, resume: `${base} --resume {conversation} --name {name} {args}` },
  });
  // Real login lives under the real HOME; config, state and tmux stay isolated.
  sb.env.HOME = process.env.HOME || homedir();

  const dir = sb.makeDir('live');
  assert.equal(sb.cli('new', 'claude', '--cwd', dir).status, 0);
  const pane = () => sb.tmux('capture-pane', '-p', '-t', '=live:');
  const meta = (key: string) => sb.tmux('display-message', '-p', '-t', '=live:', `#{@berth_${key}}`).trim();

  // A new directory asks for trust once. The default choice is "No, exit", and
  // keys sent while the dialog is still mounting are lost when it re-renders,
  // so wait for a steady screen, choose "Yes", and confirm the dialog closed.
  await waitFor(() => /trust this folder/i.test(pane()) || meta('conversation'), 'trust prompt or session start', 30_000);
  for (let attempt = 0; attempt < 3 && /trust this folder/i.test(pane()) && !meta('conversation'); attempt++) {
    await steady(pane, 1_000);
    sb.tmux('send-keys', '-t', '=live:', 'Down');
    await waitFor(() => /❯\s*Yes, I trust/.test(pane()), 'trust choice selected', 5_000);
    await steady(pane, 500);
    if (!/❯\s*Yes, I trust/.test(pane())) continue;
    sb.tmux('send-keys', '-t', '=live:', 'Enter');
    await waitFor(() => !/trust this folder/i.test(pane()), 'trust dialog closed', 5_000).catch(() => undefined);
  }

  const conversation = await waitFor(() => meta('conversation'), 'SessionStart hook', 60_000).catch((error: Error) => {
    throw new Error(`${error.message}\n--- pane ---\n${pane()}`);
  });
  sb.tmux('send-keys', '-t', '=live:', '-l', 'Reply with just: ok');
  sb.tmux('send-keys', '-t', '=live:', 'Enter');
  await waitFor(() => meta('state') === 'done', 'Stop hook', 120_000);

  assert.equal(sb.cli('snapshot').status, 0);
  killServer(sb);
  const ensured = sb.cli('ensure');
  assert.match(ensured.stdout, /live\tresumed/, ensured.stderr);

  // ensure restores the recorded id itself; overwrite it so only the agent's own
  // SessionStart hook can prove which conversation it resumed.
  sb.cli('stamp', '--session', 'live', 'conversation=awaiting-resume');
  const resumed = await waitFor(() => meta('conversation') !== 'awaiting-resume' && meta('conversation'), 'SessionStart after resume', 60_000);
  assert.equal(resumed, conversation, 'resumed into the same conversation');
  killServer(sb);
});
