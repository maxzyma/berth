/** Explicit creation metadata survives native terminal reconnection. */
export const TERMINAL_OWNER_ENV = 'BERTH_EDITOR_OWNER';

export function persistentTerminalOptions(owner: string) {
  return { isTransient: false, env: { [TERMINAL_OWNER_ENV]: owner } };
}

export function restoredTerminalSession(
  env: Readonly<Record<string, string | null | undefined>> | undefined,
  owner: string, pid: number | undefined, sessions: ReadonlyMap<number, string>,
): string | undefined {
  if (!owner || env?.[TERMINAL_OWNER_ENV] !== owner || pid === undefined) return undefined;
  return sessions.get(pid);
}
