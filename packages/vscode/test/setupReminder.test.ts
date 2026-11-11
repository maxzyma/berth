import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HookStatus } from '@berthdev/berth';
import { SetupReminder, type SetupItem, type SetupReminderHost } from '../src/setupReminder.js';

function host(options: { answer?: string; hooks?: HookStatus; otherHooks?: string; tmux?: 'current' | 'missing' | 'other'; iterm2?: 'current' | 'missing' | 'broken' | 'other'; declined?: string[] } = {}) {
  const calls = { notices: [] as string[], installed: [] as string[], declined: [...options.declined ?? []] };
  const fake: SetupReminderHost = {
    declined: () => calls.declined,
    decline: async keys => { calls.declined.push(...keys); },
    notify: async text => { calls.notices.push(text); return options.answer; },
    pick: async (items: SetupItem[]) => items,
    failed: message => { calls.notices.push(`failed: ${message}`); },
    agentHooks: () => options.hooks ?? 'missing',
    agentHookOther: () => options.otherHooks,
    installAgentHooks: async agent => { calls.installed.push(agent); },
    tmuxHooks: () => ({ state: options.tmux ?? 'current', target: '/other/cli.js', key: options.tmux ?? 'current' }),
    installTmuxHooks: async () => { calls.installed.push('tmux'); },
    iterm2: () => ({ state: options.iterm2 ?? 'missing', target: '/old/berth/main.js', key: options.iterm2 ?? 'missing' }),
    installIterm2: async () => { calls.installed.push('iterm2'); },
  };
  return { fake, calls };
}

test('setup reminder lists missing agent and tmux hooks once and installs the selection', async () => {
  const { fake, calls } = host({ answer: 'Set Up…', tmux: 'missing' });
  const reminder = new SetupReminder(fake);
  await reminder.offer(['claude', 'claude', 'shell']);
  assert.equal(calls.notices.length, 1);
  assert.match(calls.notices[0], /Claude Code hooks, tmux hooks/);
  assert.deepEqual(calls.installed, ['claude', 'tmux']);
  await reminder.offer(['claude']);
  assert.equal(calls.notices.length, 1, 'each item is offered at most once per activation');
});

test('setup reminder stays silent when hooks are installed and remembers declined items', async () => {
  const installed = host({ hooks: 'installed' });
  await new SetupReminder(installed.fake).offer(['claude']);
  assert.deepEqual(installed.calls.notices, []);

  const never = host({ answer: "Don't Ask Again", tmux: 'other' });
  await new SetupReminder(never.fake).offer(['codex']);
  assert.deepEqual(never.calls.declined, ['agent:codex', 'tmux:other']);
  await new SetupReminder(never.fake).offer(['codex']);
  assert.equal(never.calls.notices.length, 1, 'a later activation does not ask again');
  assert.deepEqual(never.calls.installed, []);
});

test('setup reminder offers a new agent after an earlier one was dismissed', async () => {
  const { fake, calls } = host({ answer: undefined });
  const reminder = new SetupReminder(fake);
  await reminder.offer(['claude']);
  await reminder.offer(['codex']);
  assert.equal(calls.notices.length, 2);
  assert.match(calls.notices[1], /Codex CLI hooks/);
  assert.doesNotMatch(calls.notices[1], /Claude/);
});

test('agent hooks that run another Berth installation are offered once per target', async () => {
  const old = host({ answer: 'Set Up…', hooks: 'installed', otherHooks: '/old/berth/main.js' });
  await new SetupReminder(old.fake).offer(['claude']);
  assert.match(old.calls.notices[0], /Claude Code hooks/);
  assert.deepEqual(old.calls.installed, ['claude']);

  const never = host({ answer: "Don't Ask Again", hooks: 'installed', otherHooks: '/old/berth/main.js' });
  await new SetupReminder(never.fake).offer(['claude']);
  assert.equal(never.calls.declined.length, 1);
  assert.match(never.calls.declined[0], /^agent:claude:other:/);
  await new SetupReminder(never.fake).offer(['claude']);
  assert.equal(never.calls.notices.length, 1, 'the same target is not offered again');

  const moved = host({ answer: 'Set Up…', hooks: 'installed', otherHooks: '/another/berth/main.js', declined: never.calls.declined });
  await new SetupReminder(moved.fake).offer(['claude']);
  assert.deepEqual(moved.calls.installed, ['claude'], 'a different installation is offered again');
});

test('an installed iTerm2 integration on another or a removed Berth is offered; none installed is not', async () => {
  for (const state of ['other', 'broken'] as const) {
    const { fake, calls } = host({ answer: 'Set Up…', hooks: 'installed', iterm2: state });
    await new SetupReminder(fake).offer(['claude']);
    assert.match(calls.notices[0], /iTerm2 integration/, state);
    assert.deepEqual(calls.installed, ['iterm2'], state);
  }
  for (const state of ['missing', 'current'] as const) {
    const { fake, calls } = host({ hooks: 'installed', iterm2: state });
    await new SetupReminder(fake).offer(['claude']);
    assert.deepEqual(calls.notices, [], state);
  }
});
