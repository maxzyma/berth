import type { SessionRow } from '@berthdev/berth';

function elapsed(at: string, now: number): string | undefined {
  const age = now - Date.parse(at);
  if (!Number.isFinite(age) || age < 0) return undefined;
  const minutes = Math.floor(age / 60_000);
  if (!minutes) return 'less than a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** No timer: relative labels are recalculated with the normal view refresh. */
export function activityTimeLines(row: SessionRow, now = Date.now()) {
  const timing = row.activityTiming;
  if (!row.live || row.bindingIssue || !timing || timing.state !== row.state) return [];
  const entries = [
    ...(timing.turnStartedAt ? [{ label: 'Turn started', at: timing.turnStartedAt, waiting: false }] : []),
    ...(timing.stateSince && row.state === 'waiting' ? [{ label: 'Waiting', at: timing.stateSince, waiting: true }] : []),
    ...(timing.stateSince && row.state === 'done' ? [{ label: 'Finished', at: timing.stateSince, waiting: false }] : []),
  ];
  return entries.flatMap(({ label, at, waiting }) => {
    const age = elapsed(at, now);
    if (!age) return [];
    const local = new Date(at).toLocaleString(undefined, { timeZoneName: 'short' });
    return [{ icon: 'history', text: `${label} ${waiting ? 'for ' : ''}${age}${waiting ? '' : ' ago'} · ${local}`,
      copyValue: at, copyLabel: `${label.toLowerCase()} time` }];
  });
}
