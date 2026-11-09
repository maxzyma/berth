import type { Finding, FindingCode, SessionRow } from '@berthdev/berth';

export interface RecoveryCheckItem {
  label: string;
  detail: string;
  action?: 'inspect' | 'hooks' | 'profile' | 'options' | 'folder';
}

/** Findings the row's own fields already explain above. */
const SHOWN_FROM_ROW: ReadonlySet<FindingCode> = new Set(['binding', 'hooks', 'profile-unknown', 'conversation-unbound', 'recovery']);

/** Explain readiness without changing binding or attempting recovery. */
export function recoveryCheckItems(row: SessionRow, findings: Finding[]): RecoveryCheckItem[] {
  const items: RecoveryCheckItem[] = [];
  if (row.bindingIssue) items.push({ label: 'Binding needs verification',
    detail: `${row.bindingIssue} ${row.live ? 'Open the existing terminal to inspect the conversation. A verified agent event must confirm its identity; checking alone cannot clear this.' : 'Keep the saved ID. Verify this conversation in the agent conversation picker before resuming; do not substitute the latest conversation.'}`,
    ...(row.live ? { action: 'inspect' as const } : {}) });
  if (!row.conversation) items.push({ label: 'Conversation not bound', detail: 'Automatic recovery has no exact conversation ID. Inspect the agent conversation picker; a verified start event must establish the binding.', ...(row.live ? { action: 'inspect' as const } : {}) });
  if (!row.profile) items.push({ label: 'Agent profile unknown', detail: row.live ? 'A verified start hook must report the active profile. Do not guess it from the default profile.' : 'Choose the profile that contains the saved conversation.', ...(row.live ? {} : { action: 'profile' as const }) });
  if (row.hooks === 'missing' || row.hooks === 'broken') items.push({ label: 'Repair agent hooks', detail: row.profile ? 'Install hooks in this session’s verified profile. Installation does not itself verify the conversation.' : 'The active agent profile must be identified before its hooks can be repaired.', ...(row.profile ? { action: 'hooks' as const } : {}) });
  else if (row.hooks === 'unknown') items.push({ label: 'Hook status unknown', detail: 'Hook delivery has not been verified for this profile. Inspect the agent hook configuration.' });
  if (row.recoveryOptionsRequired) items.push({ label: 'Review recovery options', detail: row.live ? 'Saved launch options need verification. Review Recovery Options is available after this session stops; leave the running agent intact.' : 'Review the saved launch options before resuming.', ...(!row.live ? { action: 'options' as const } : {}) });
  if (row.recovery && row.recovery !== 'confirmed') items.push({ label: `Recovery ${row.recovery}`, detail: row.recoveryDetail || 'Inspect the previous recovery attempt.', ...(row.live ? { action: 'inspect' as const } : {}) });
  const relevant = findings.filter(finding => (!finding.session || finding.session === row.name) && !SHOWN_FROM_ROW.has(finding.code));
  for (const finding of relevant) {
    items.push({ label: finding.severity === 'info' ? 'Compatibility information' : 'Setup requires attention', detail: finding.problem,
      ...(finding.code === 'cwd-missing' && !row.live ? { action: 'folder' as const } : {}) });
  }
  if (!items.length) items.push({ label: 'No known recovery blockers', detail: 'The conversation and profile are recorded. Actual recovery is confirmed only when the agent resumes that exact conversation.' });
  return items;
}
