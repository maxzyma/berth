import { existsSync } from 'node:fs';
import type { Context } from '../context.js';
import { getAdapter } from '../agents/registry.js';
import { hooksInstalled } from '../agents/hooks.js';
import { list } from './sessions.js';

export interface Finding {
  session?: string;
  problem: string;
}

/** Drift and gaps worth a user's attention; empty when all is well. */
export function doctor(ctx: Context, env = process.env): Finding[] {
  const findings: Finding[] = [];
  const agentsInUse = new Set<string>();
  for (const row of list(ctx)) {
    if (!row.managed) continue;
    agentsInUse.add(row.agent);
    const adapter = getAdapter(row.agent);
    if (!adapter) {
      findings.push({ session: row.name, problem: `unknown agent ${row.agent}` });
      continue;
    }
    if (!existsSync(row.cwd)) findings.push({ session: row.name, problem: `working directory missing: ${row.cwd}` });
    if (adapter.resume && !row.conversation) findings.push({ session: row.name, problem: 'conversation not bound; restore will start fresh' });
  }
  for (const agent of agentsInUse) {
    const adapter = getAdapter(agent);
    if (adapter?.hookTarget && !hooksInstalled(agent, env)) {
      findings.push({ problem: `hooks for ${adapter.displayName} not installed (berth hooks install ${agent})` });
    }
  }
  return findings;
}
