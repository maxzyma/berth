import type { LiveSession } from '../tmux/client.js';

/** The agent conversation a Berth session is bound to, as one key; undefined when unbound. */
export function conversationKey(agent: string | undefined, conversation: string | undefined): string | undefined {
  return agent && agent !== 'shell' && conversation ? `${agent}\u0000${conversation}` : undefined;
}

export const sharedConversationIssue = (keeper: string) =>
  `This agent conversation is also open in ${keeper}, which keeps it. Two processes writing one agent conversation can lose messages: close one, or branch in one of them.`;

const byName = new Intl.Collator('en', { numeric: true });

/**
 * Live Berth sessions bound to the same agent conversation (spec §4.2): for each
 * member, the session that keeps it (whose binding changed to it last) and the others.
 */
export function sharedConversations(live: readonly LiveSession[]): Map<string, { keeper: string; with: string[] }> {
  const groups = new Map<string, LiveSession[]>();
  for (const session of live) {
    const key = conversationKey(session.meta.agent, session.meta.conversation);
    if (key) groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  const shared = new Map<string, { keeper: string; with: string[] }>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const [keeper] = [...members].sort((a, b) => (b.meta.boundAt ?? '').localeCompare(a.meta.boundAt ?? '') || byName.compare(a.name, b.name));
    for (const member of members) {
      shared.set(member.name, { keeper: keeper.name, with: members.filter((other) => other !== member).map((other) => other.name) });
    }
  }
  return shared;
}
