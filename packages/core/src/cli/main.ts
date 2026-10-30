#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { createContext, type Context } from '../context.js';
import { BerthError, ExitCode } from '../errors.js';
import { handleHook, hookHint, hookStatus, installHooks, uninstallHooks } from '../agents/hooks.js';
import { adopt, bellRang, checkOrigin, create, forget, list, requireLive, stamp, type SessionRow } from '../registry/sessions.js';
import { doctor } from '../registry/doctor.js';
import { adoptDiscovered, takeSnapshot } from '../snapshot/take.js';
import { ensure, restoreFrom, type RestoreResult } from '../restore/ensure.js';
import { presentState } from '../present/state.js';
import { installTmux, uninstallTmux } from '../tmux/install.js';
import { installIterm2, reattach, uninstallIterm2 } from '../iterm2/install.js';
import { clientAttached } from '../present/attach.js';
import { toolsFor } from '../tools.js';

const USAGE = `usage: berth <command> [options]

  ls [--json]                                   all sessions
  new <agent> [--name N] [--cwd D] [--origin O] [-- agent args]
  adopt <session> --agent <id> [--origin O]
  attach <session> [--origin O]
  stamp [--session S] key=value...
  snapshot
  forget <session>                             stop restoring a stopped session
  ensure [--origin O] [<session>]
  restore [--origin O] [--session S] [<snapshot dir>]
  show <session> [<snapshot dir>]
  doctor [--json]
  hooks install|uninstall <agent>
  tmux install|uninstall                       snapshot hooks in ~/.tmux.conf
  iterm2 install|uninstall                     Berth for iTerm2 (AutoLaunch script)
  iterm2 reattach <session>                    rebuild if missing, print attach command
  present <session>                            show its state on attached terminals

global: --socket <name>        tmux -L socket (overrides BERTH_TMUX_SOCKET)
        --socket-path <path>   tmux -S socket (set by Berth's tmux hooks)

run by hooks: hook <agent> <event>, bell --session S, attached --session S --tty T --termtype X`;

type Out = (text: string) => void;

function parse<const T extends NonNullable<ParseArgsConfig['options']>>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true } as const);
  } catch (error) {
    throw new BerthError((error as Error).message, ExitCode.usage);
  }
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new BerthError(`missing ${what}\n${USAGE}`, ExitCode.usage);
  return value;
}

function formatRows(rows: SessionRow[]): string {
  const lines = rows.map((r) =>
    [r.name, r.managed ? r.agent : '-', r.state || '-', r.managed ? r.origin : '-', r.live ? 'live' : 'stopped', r.conversation ? 'bound' : '-', r.cwd].join('\t'),
  );
  return ['NAME\tAGENT\tSTATE\tORIGIN\tLIVE\tCONV\tCWD', ...lines].join('\n');
}

function formatResults(results: RestoreResult[]): string {
  if (results.length === 0) return 'nothing to restore';
  return results.map((r) => `${r.name}\t${r.outcome}${r.detail ? `\t${r.detail}` : ''}`).join('\n');
}

/** Tell the user, on stderr, when the agent just started has no hooks. */
function hintHooks(agent: string | undefined): void {
  if (agent && hookStatus(agent) === 'missing') process.stderr.write(`${hookHint(agent)}\n`);
}

function cliPath(): string {
  return realpathSync(fileURLToPath(import.meta.url));
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function run(ctx: Context, command: string, rest: string[], out: Out): number {
  switch (command) {
    case 'ls': {
      const { values } = parse(rest, { json: { type: 'boolean' } });
      adoptDiscovered(ctx);
      const rows = list(ctx);
      out(values.json ? JSON.stringify(rows, null, 2) : formatRows(rows));
      return ExitCode.ok;
    }
    case 'new': {
      const dash = rest.indexOf('--');
      const own = dash >= 0 ? rest.slice(0, dash) : rest;
      const extraArgs = dash >= 0 ? rest.slice(dash + 1) : [];
      const { values, positionals } = parse(own, { name: { type: 'string' }, cwd: { type: 'string' }, origin: { type: 'string' } });
      const name = create(ctx, {
        agent: need(positionals[0], 'agent'),
        cwd: resolve(values.cwd ?? process.cwd()),
        name: values.name,
        origin: values.origin,
        extraArgs,
      });
      out(name);
      hintHooks(positionals[0]);
      return ExitCode.ok;
    }
    case 'adopt': {
      const { values, positionals } = parse(rest, { agent: { type: 'string' }, origin: { type: 'string' } });
      const agent = need(values.agent, '--agent');
      adopt(ctx, need(positionals[0], 'session'), agent, values.origin);
      hintHooks(agent);
      return ExitCode.ok;
    }
    case 'attach': {
      const { values, positionals } = parse(rest, { origin: { type: 'string' } });
      const name = need(positionals[0], 'session');
      requireLive(ctx, name);
      if (values.origin) stamp(ctx, name, { origin: checkOrigin(values.origin) });
      const [bin, ...args] = ctx.tmux.attachArgv(name);
      return spawnSync(bin, args, { stdio: 'inherit' }).status ?? ExitCode.failure;
    }
    case 'stamp': {
      const { values, positionals } = parse(rest, { session: { type: 'string' } });
      const pairs = Object.fromEntries(
        positionals.map((p) => {
          const eq = p.indexOf('=');
          if (eq <= 0) throw new BerthError(`expected key=value, got ${p}`, ExitCode.usage);
          return [p.slice(0, eq), p.slice(eq + 1)];
        }),
      );
      const session = values.session ?? (process.env.TMUX_PANE ? ctx.tmux.sessionOfPane(process.env.TMUX_PANE) : undefined);
      stamp(ctx, need(session, '--session (not inside a tmux pane)'), pairs);
      return ExitCode.ok;
    }
    case 'forget':
      forget(ctx, need(rest[0], 'session'));
      return ExitCode.ok;
    case 'snapshot':
      out(takeSnapshot(ctx));
      return ExitCode.ok;
    case 'present': {
      const name = need(rest[0], 'session');
      requireLive(ctx, name);
      const meta = ctx.tmux.listSessions().find((s) => s.name === name)?.meta ?? {};
      out(String(presentState(ctx.tmux, name, meta.state ?? '', { note: meta.note })));
      return ExitCode.ok;
    }
    case 'tmux': {
      if (rest[0] === 'install') out(installTmux(ctx.tmux, cliPath()));
      else if (rest[0] === 'uninstall') out(uninstallTmux(ctx.tmux));
      else throw new BerthError(`tmux: expected install or uninstall\n${USAGE}`, ExitCode.usage);
      return ExitCode.ok;
    }
    case 'iterm2': {
      if (rest[0] === 'install') out(installIterm2(toolsFor(ctx, cliPath())).script);
      else if (rest[0] === 'uninstall') out(uninstallIterm2().script);
      else if (rest[0] === 'reattach') out(reattach(ctx, toolsFor(ctx, cliPath()), need(rest[1], 'session')));
      else throw new BerthError(`iterm2: expected install, uninstall or reattach\n${USAGE}`, ExitCode.usage);
      return ExitCode.ok;
    }
    case 'attached': {
      const { values } = parse(rest, { session: { type: 'string' }, tty: { type: 'string' }, termtype: { type: 'string' } });
      clientAttached(ctx, { session: need(values.session, '--session'), tty: need(values.tty, '--tty'), termtype: values.termtype ?? '' });
      return ExitCode.ok;
    }
    case 'ensure': {
      const { values, positionals } = parse(rest, { origin: { type: 'string' } });
      out(formatResults(ensure(ctx, { origin: values.origin, session: positionals[0] })));
      return ExitCode.ok;
    }
    case 'restore': {
      const { values, positionals } = parse(rest, { origin: { type: 'string' }, session: { type: 'string' } });
      const snapshot = positionals[0] ? ctx.store.read(resolve(positionals[0])) : ctx.store.newest();
      out(formatResults(restoreFrom(ctx, snapshot, { origin: values.origin, session: values.session })));
      return ExitCode.ok;
    }
    case 'show': {
      const { positionals } = parse(rest, {});
      const dir = positionals[1] ? resolve(positionals[1]) : ctx.store.newest()?.dir;
      if (!dir) throw new BerthError('no snapshots yet', ExitCode.notFound);
      out(ctx.store.scrollback(dir, need(positionals[0], 'session')));
      return ExitCode.ok;
    }
    case 'doctor': {
      const { values } = parse(rest, { json: { type: 'boolean' } });
      adoptDiscovered(ctx);
      const findings = doctor(ctx);
      out(values.json ? JSON.stringify(findings, null, 2) : findings.map((f) => `${f.session ? `${f.session}: ` : ''}${f.problem}`).join('\n') || 'ok');
      return ExitCode.ok;
    }
    case 'hooks': {
      const [action, agent] = rest;
      if (action === 'install') out(installHooks(need(agent, 'agent'), cliPath()));
      else if (action === 'uninstall') out(uninstallHooks(need(agent, 'agent')));
      else throw new BerthError(`hooks: expected install or uninstall\n${USAGE}`, ExitCode.usage);
      return ExitCode.ok;
    }
    case 'bell': {
      const { values } = parse(rest, { session: { type: 'string' } });
      bellRang(ctx, need(values.session, '--session'));
      return ExitCode.ok;
    }
    case 'hook': {
      handleHook(need(rest[0], 'agent'), need(rest[1], 'event'), readStdin());
      return ExitCode.ok;
    }
    default:
      throw new BerthError(USAGE, ExitCode.usage);
  }
}

export function main(argv: string[], out: Out = (t) => process.stdout.write(`${t}\n`)): number {
  const args = [...argv];
  const env = { ...process.env };
  for (const [flag, variable] of [['--socket', 'BERTH_TMUX_SOCKET'], ['--socket-path', 'BERTH_TMUX_SOCKET_PATH']] as const) {
    const at = args.indexOf(flag);
    if (at < 0) continue;
    env[variable] = need(args[at + 1], `${flag} value`);
    args.splice(at, 2);
  }
  const [command, ...rest] = args;
  if (!command || command === '-h' || command === '--help') {
    out(USAGE);
    return command ? ExitCode.ok : ExitCode.usage;
  }
  try {
    return run(createContext(env), command, rest, out);
  } catch (error) {
    if (error instanceof BerthError) {
      process.stderr.write(`berth: ${error.message}\n`);
      return error.code;
    }
    process.stderr.write(`berth: ${(error as Error).message}\n`);
    return ExitCode.failure;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === cliPath()) {
  process.exitCode = main(process.argv.slice(2));
}
