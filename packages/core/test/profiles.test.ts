import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createContext } from '../src/context.js';
import { create, list, stamp } from '../src/registry/sessions.js';
import { ensure, setRecoveryProfile } from '../src/restore/ensure.js';
import { captureProfile, profileAtRoot, profileEnvironment, readProfile } from '../src/agents/profile.js';
import { profiledTitleLookup } from '../src/agents/titles.js';
import { handleHook, installHooks } from '../src/agents/hooks.js';
import { agentRoot } from '../src/agents/roots.js';
import { hookFormat } from '../src/agents/hook-files.js';
import { shellQuote } from '../src/shell.js';
import { sandbox, killServer, waitFor, CLI } from './helpers.js';

test('CR18 launch and recovery use the saved profile despite a stale server and another host profile', async (t) => {
  const sb = sandbox(t), original = sb.ctx();
  original.tmux.newSession('keep', sb.root, 'sleep 3600');
  original.tmux.run(['set-environment', '-g', 'CODEX_HOME', join(sb.root, 'stale')]);
  const selected = sb.makeDir('selected'), other = sb.makeDir('other');
  const output = join(sb.root, 'profile.json'), script = join(sb.root, 'record.mjs');
  writeFileSync(script, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(output)},JSON.stringify({home:process.env.CODEX_HOME,state:process.env.BERTH_STATE_DIR,config:process.env.BERTH_CONFIG,path:process.env.PATH}));setInterval(()=>{},10000);`);
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  const config = { ...original.config, agents: { ...original.config.agents, codex: { launch: command, resume: command } } };
  const ctx = { ...createContext({ ...sb.env, CODEX_HOME: selected }), config };
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'profile' });
  await waitFor(() => existsSync(output), 'launch environment');
  const first = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(first.home, selected);
  assert.equal(first.state, dirname(dirname(ctx.config.stateDir)));
  assert.equal(first.path, ctx.env.PATH);
  stamp(ctx, 'profile', { conversation: 'exact-profile-id' });
  killServer(sb);
  rmSync(output);
  const resumed = { ...createContext({ ...sb.env, CODEX_HOME: other }), config };
  assert.equal(ensure(resumed, { session: 'profile' })[0].outcome, 'resume-requested');
  await waitFor(() => existsSync(output), 'resume environment');
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).home, selected);
  assert.equal(readProfile('codex', resumed.tmux.listSessions()[0].meta.profile)?.environment.CODEX_HOME, selected);
});

test('CR18 titles and hook status follow each recorded profile, not the editor environment', (t) => {
  const sb = sandbox(t), a = sb.makeDir('a'), b = sb.makeDir('b');
  for (const [root, title] of [[a, 'Profile A'], [b, 'Profile B']]) writeFileSync(join(root, 'session_index.jsonl'), JSON.stringify({ id: 'shared-id', thread_name: title }));
  const pa = captureProfile('codex', { ...sb.env, CODEX_HOME: a });
  const pb = captureProfile('codex', { ...sb.env, CODEX_HOME: b });
  const title = profiledTitleLookup([{ agent: 'codex', conversation: 'shared-id', profile: pa }, { agent: 'codex', conversation: 'shared-id', profile: pb }], { ...sb.env, CODEX_HOME: b });
  assert.equal(title('codex', sb.root, 'shared-id', pa), 'Profile A');
  assert.equal(title('codex', sb.root, 'shared-id', pb), 'Profile B');
  assert.equal(title('codex', sb.root, 'shared-id'), undefined);
  const ctx = createContext({ ...sb.env, CODEX_HOME: a });
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'a' });
  stamp(ctx, 'a', { conversation: 'shared-id' });
  installHooks('codex', CLI, profileEnvironment('codex', pa, sb.env));
  const row = list(createContext({ ...sb.env, CODEX_HOME: b }))[0];
  assert.equal(row.hooks, 'installed');
  assert.equal(row.conversationTitle, 'Profile A');
});

test('CR18 legacy records require explicit profile selection and reject credential fields', (t) => {
  const sb = sandbox(t), ctx = sb.ctx(), root = sb.makeDir('selected');
  ctx.store.write([{ name: 'legacy', agent: 'codex', cwd: sb.root, argv: '', conversation: 'exact', origin: 'none' }], {});
  assert.equal(ensure(ctx)[0].outcome, 'skipped-unknown-profile');
  assert.equal(ctx.tmux.hasSession('legacy'), false);
  setRecoveryProfile(ctx, 'legacy', root);
  assert.equal(ensure(ctx)[0].outcome, 'resume-requested');
  const captured = captureProfile('codex', { ...sb.env, CODEX_HOME: root, API_KEY: 'not-persisted' });
  assert.equal(JSON.stringify(captured).includes('not-persisted'), false);
  assert.equal(readProfile('codex', { environment: { HOME: sb.env.HOME, API_KEY: 'secret' } }), undefined);
  assert.throws(() => captureProfile('codex', { ...sb.env, CODEX_HOME: 'relative' }), /absolute/);
});

test('CR18 a start hook from another profile cannot confirm a pending recovery', (t) => {
  const sb = sandbox(t), selected = sb.makeDir('selected'), other = sb.makeDir('other');
  const ctx = createContext({ ...sb.env, CODEX_HOME: selected });
  create(ctx, { agent: 'codex', cwd: sb.root, name: 'pending' });
  stamp(ctx, 'pending', { conversation: 'expected' });
  ctx.tmux.setMeta('pending', { recovery: 'requested' });
  const socket = sb.tmux('display-message', '-p', '-t', '=pending:', '#{socket_path}').trim();
  const pane = sb.tmux('display-message', '-p', '-t', '=pending:', '#{pane_id}').trim();
  handleHook('codex', 'SessionStart', JSON.stringify({ session_id: 'expected' }), { ...sb.env, CODEX_HOME: other, TMUX: `${socket},1,0`, TMUX_PANE: pane });
  const live = ctx.tmux.listSessions()[0].meta;
  assert.equal(live.recovery, 'failed');
  assert.match(live.recoveryDetail ?? '', /different profile/);
  assert.equal(readProfile('codex', live.profile)?.environment.CODEX_HOME, selected);
});


test('CR31 Kimi profile display and hook location share current and legacy resolution', (t) => {
  const sb = sandbox(t), env = { HOME: sb.env.HOME };
  const current = join(env.HOME, '.kimi-code'), legacy = join(env.HOME, '.kimi');
  const check = (root: string, environment = env) => {
    assert.equal(agentRoot('kimi', environment), root);
    assert.equal(hookFormat('kimi-config').file(environment), join(root, 'config.toml'));
  };
  check(current);
  mkdirSync(legacy, { recursive: true });
  check(legacy);
  mkdirSync(current, { recursive: true });
  check(current);
  const selected = { ...env, KIMI_CODE_HOME: sb.makeDir('custom-kimi') };
  check(selected.KIMI_CODE_HOME, selected);
});

test('CR58 Gemini custom home participates in hook paths and saved profile identity', (t) => {
  const sb = sandbox(t), selected = sb.makeDir('gemini-home'), other = sb.makeDir('other-home');
  const env = { ...sb.env, GEMINI_CLI_HOME: selected };
  const profile = captureProfile('gemini', env);
  assert.equal(profile.environment.GEMINI_CLI_HOME, selected);
  assert.equal(profileAtRoot('gemini', sb.env, join(selected, '.gemini')).environment.GEMINI_CLI_HOME, selected);
  assert.throws(() => profileAtRoot('gemini', sb.env, selected), /Choose the .gemini folder/);
  assert.equal(agentRoot('gemini', env), join(selected, '.gemini'));
  const file = installHooks('gemini', CLI, env);
  assert.equal(file, join(selected, '.gemini', 'settings.json'));
  assert.equal(profileEnvironment('gemini', profile, { ...sb.env, GEMINI_CLI_HOME: other }).GEMINI_CLI_HOME, selected);
  const defaultProfile = captureProfile('gemini', sb.env);
  assert.equal(profileEnvironment('gemini', defaultProfile, { GEMINI_CLI_HOME: other }).GEMINI_CLI_HOME, undefined);
  assert.throws(() => captureProfile('gemini', { ...sb.env, GEMINI_CLI_HOME: 'relative' }), /absolute/);
});
