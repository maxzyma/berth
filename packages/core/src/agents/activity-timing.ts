/** Only lifecycle evidence may create these times; inventory never supplies now. */
export interface ActivityTiming {
  state: string;
  turnStartedAt?: string;
  stateSince?: string;
}

export function eventTime(value: unknown, now = Date.now()): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 && time <= now ? new Date(time).toISOString() : undefined;
}

export function readActivityTiming(raw: string | undefined, state: string, now = Date.now()): ActivityTiming | undefined {
  if (!raw || !['working', 'waiting', 'done'].includes(state)) return undefined;
  try {
    const data = JSON.parse(raw);
    if (data?.state !== state) return undefined;
    const turnStartedAt = eventTime(data.turnStartedAt, now);
    const stateSince = eventTime(data.stateSince, now);
    if (turnStartedAt && stateSince && turnStartedAt > stateSince) return undefined;
    return turnStartedAt || stateSince ? { state, ...(turnStartedAt ? { turnStartedAt } : {}), ...(stateSince ? { stateSince } : {}) } : undefined;
  } catch { return undefined; }
}

/** Called only after validating a live hook's producer and conversation. */
export function hookActivityTiming(raw: string | undefined, previousState: string, state: string,
  newTurn: boolean, now = Date.now()): string {
  if (!['working', 'waiting', 'done'].includes(state)) return '';
  const previous = readActivityTiming(raw, previousState, now);
  const at = new Date(now).toISOString();
  const turnStartedAt = newTurn ? at : previous?.turnStartedAt;
  const stateSince = !newTurn && previous?.state === state ? previous.stateSince || at : at;
  return JSON.stringify({ state, ...(turnStartedAt ? { turnStartedAt } : {}), stateSince });
}
