import { BerthError } from '../errors.js';
import { formatFields, readFields } from './fields.js';
import { spawnSync } from 'node:child_process';
import type { HostRecord } from '../registry/hosts.js';
import type { Tmux } from './client.js';

export interface ConnectionInfo {
  pid: number;
  terminal: string;
  application: string;
  workspace?: string;
  ancestors: number[];
}

type ProcessTable = ReadonlyMap<number, { parent: number; command: string }>;

/** `ps -axo pid=,ppid=,comm=` output by pid. */
function parseProcessTable(table: string): ProcessTable {
  return new Map(table.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match ? [[Number(match[1]), { parent: Number(match[2]), command: match[3] }] as const] : [];
  }));
}

export function processAncestry(pid: number, table: string): { ancestors: number[]; application: string } {
  return ancestryIn(pid, parseProcessTable(table));
}

function ancestryIn(pid: number, processes: ProcessTable): { ancestors: number[]; application: string } {
  const ancestors: number[] = [];
  let application = '';
  for (let current = pid; current > 1 && ancestors.length < 64 && !ancestors.includes(current);) {
    ancestors.push(current);
    const process = processes.get(current);
    if (!process) break;
    if (/iTerm/i.test(process.command)) application ||= 'iTerm2';
    else if (/Cursor(?:\.app| Helper)/i.test(process.command)) application ||= 'Cursor';
    else if (/Visual Studio Code|Code Helper|\/code(?:\s|$)/i.test(process.command)) application ||= 'VS Code';
    else if (/Terminal\.app/.test(process.command)) application ||= 'Terminal';
    else if (/WezTerm|wezterm/.test(process.command)) application ||= 'WezTerm';
    else if (/ghostty/i.test(process.command)) application ||= 'Ghostty';
    current = process.parent;
  }
  return { ancestors, application };
}

const CLIENT_FIELDS = ['client_session', 'client_pid', 'client_tty', 'client_termtype'];

/** Session and process id of every live tmux client, without reading process ancestry. */
function clientPids(tmux: Tmux): [session: string, pid: number][] {
  const listed = tmux.run(['list-clients', '-F', formatFields(CLIENT_FIELDS)], true);
  return listed.ok ? readFields(listed.stdout, CLIENT_FIELDS.length).map(([session, pid]) => [session, Number(pid)]) : [];
}

/** Whether one of these clients is the terminal process or runs under it (a launcher may not exec tmux). */
function showsTerminal(clients: readonly ConnectionInfo[], terminalPid: number): boolean {
  return clients.some((client) => client.ancestors.includes(terminalPid));
}

/** Live clients only; restore ownership is deliberately not consulted. */
export function connections(tmux: Tmux, hosts: readonly HostRecord[] = [], strict = false): ReadonlyMap<string, ConnectionInfo[]> {
  const result = tmux.run(['list-clients', '-F', formatFields(CLIENT_FIELDS)], true);
  if (!result.ok && strict) throw new BerthError(`Could not read terminal connections: ${result.stderr.trim()}`);
  if (!result.ok || !result.stdout.trim()) return new Map();
  const listed = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL' });
  const processes = parseProcessTable(listed.status === 0 ? listed.stdout : '');
  const entries = readFields(result.stdout, 4).map(([session, rawPid, terminal, termtype]) => {
    const pid = Number(rawPid);
    const ancestry = ancestryIn(pid, processes);
    const host = hosts.find((host) => host.terminalPids.some((pid) => ancestry.ancestors.includes(pid)));
    const application = typeof host?.application === 'string' ? host.application.trim() : '';
    return { session, client: { pid, terminal, ...ancestry, ...(host?.workspace ? { workspace: host.workspace.label } : {}), application: application || ancestry.application || (/iterm/i.test(termtype) ? 'iTerm2' : '') } };
  }).filter(({ client }) => Number.isSafeInteger(client.pid) && client.pid > 0);
  const bySession = new Map<string, ConnectionInfo[]>();
  for (const { session, client } of entries) {
    const clients = bySession.get(session);
    if (clients) clients.push(client);
    else bySession.set(session, [client]);
  }
  return bySession;
}

/**
 * The session a terminal shows. The terminal process is usually the client
 * itself, so process ancestry is read only when no client matches directly.
 * Pass connections already read to look up several terminals at once.
 */
export function sessionForTerminal(tmux: Tmux, terminalPid: number, known?: ReadonlyMap<string, readonly ConnectionInfo[]>): string | undefined {
  if (!known) {
    const direct = clientPids(tmux).find(([, pid]) => pid === terminalPid);
    if (direct) return direct[0];
  }
  return [...(known ?? connections(tmux))].find(([, clients]) => showsTerminal(clients, terminalPid))?.[0];
}

/** Wait for this terminal process to attach to this exact session, not any client. */
export async function waitForAttachment(
  tmux: Tmux, session: string, terminalPid: number,
  options: { timeoutMs?: number; exited?: () => boolean } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  do {
    if (options.exited?.()) throw new Error(`Terminal exited before attaching to ${session}. Try opening it again.`);
    // The terminal process is usually the client itself; read process ancestry
    // only when the session has a client that is not.
    const pids = clientPids(tmux).filter(([name]) => name === session).map(([, pid]) => pid);
    if (pids.includes(terminalPid)) return;
    if (pids.length && showsTerminal(connections(tmux).get(session) ?? [], terminalPid)) return;
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  } while (true);
  throw new Error(`Could not confirm attachment to ${session}. Check tmux and try opening it again.`);
}


/** Detach only clients proven to belong to the caller's terminal processes. */
export function detachTerminalClients(tmux: Tmux, session: string, terminalPids: ReadonlySet<number>): void {
  const clients = connections(tmux).get(session) ?? [];
  for (const client of clients) {
    if (client.terminal && client.ancestors.some((pid) => terminalPids.has(pid))) {
      tmux.run(['detach-client', '-t', client.terminal]);
    }
  }
}

/** Transfer captured clients only while the replacement and source identities remain live. */
export function handoffTerminalClients(
  tmux: Tmux, session: string, destinationPid: number, sources: readonly ConnectionInfo[],
): void {
  for (const source of sources) {
    const live = connections(tmux, [], true).get(session) ?? [];
    const destination = live.find(client => client.ancestors.includes(destinationPid));
    if (!destination) throw new BerthError('Editor attachment disappeared; original terminals were preserved.');
    const current = live.find(client => client.pid === source.pid && client.terminal === source.terminal);
    if (!current || current.pid === destination.pid || !current.terminal) continue;
    tmux.run(['detach-client', '-t', current.terminal]);
  }
}
