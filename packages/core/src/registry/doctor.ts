import { checkEnvironment } from './environment.js';
import { assessCapability, versionInspector } from '../agents/capabilities.js';
import { profileKey, type AgentProfile } from '../agents/profile.js';
import { usableDirectory } from './directory.js';
import type { Context } from '../context.js';
import { launchCommand } from '../agents/commands.js';
import { shellSplit } from '../shell.js';
import { executableOnPath } from '../tools.js';
import { getAdapter } from '../agents/registry.js';
import { list } from './sessions.js';

/** What a finding is about, so hosts act on it without parsing its wording. */
export type FindingCode = 'environment' | 'legacy-snapshots' | 'unknown-agent' | 'agent-version' | 'cwd-missing'
  | 'binding' | 'recovery' | 'executable-missing' | 'profile-unknown' | 'hooks' | 'conversation-unbound';

export interface Finding {
  session?: string;
  code: FindingCode;
  problem: string;
  severity?: 'info' | 'warning';
  installHooksFor?: string;
  profile?: AgentProfile;
}

/** Drift and gaps worth a user's attention; empty when all is well. */
export function doctor(ctx: Context, env = ctx.env): Finding[] {
  const environment = checkEnvironment(ctx);
  const findings: Finding[] = environment.checks.filter(check => !check.ok)
    .map((check): Finding => ({ code: 'environment', problem: `${check.label}: ${check.detail}`, severity: check.required ? 'warning' : 'info' }));
  if (ctx.config.legacySnapshotRoot) findings.push({ code: 'legacy-snapshots', problem: `Legacy snapshots require endpoint verification: ${ctx.config.legacySnapshotRoot}. After verifying the source server, use berth restore with an explicit snapshot directory.` });
  if (environment.checks.some(check => ['platform', 'tmux'].includes(check.id) && !check.ok)) return findings;
  const checkedProfiles = new Set<string>();
  const checkedVersions = new Set<string>();
  const inspectVersion = versionInspector(env);
  for (const row of list(ctx)) {
    if (!row.managed) continue;

    const adapter = getAdapter(row.agent);
    if (!adapter) {
      findings.push({ session: row.name, code: 'unknown-agent', problem: `unknown agent ${row.agent}` });
      continue;
    }
    const versionKey = JSON.stringify([row.agent, executableOnPath(adapter.binary, env, row.cwd)]);
    if (row.agent !== 'shell' && !checkedVersions.has(versionKey)) {
      checkedVersions.add(versionKey);
      const overrides = ctx.config.agents[row.agent];
      if (overrides?.launch !== undefined || overrides?.resume !== undefined) {
        findings.push({ session: row.name, code: 'agent-version', severity: 'info', problem: `${adapter.displayName}: custom launch/resume template; version not inspected. Verify hook support in that launcher.` });
      } else {
        const observed = inspectVersion(adapter, row.cwd);
        const assessment = observed.version ? assessCapability(row.agent, observed.version) : undefined;
        findings.push({ session: row.name, code: 'agent-version', severity: assessment?.severity ?? 'info',
          problem: `${adapter.displayName} configured CLI (${observed.executable}): ${observed.version ?? observed.detail}. ${assessment?.detail ?? 'Version compatibility remains unverified.'}` });
      }
    }
    if (!usableDirectory(row.cwd)) findings.push({ session: row.name, code: 'cwd-missing', problem: `working directory missing: ${row.cwd}` });
    if (row.bindingIssue) findings.push({ session: row.name, code: 'binding', problem: row.bindingIssue });
    if (row.recovery && row.recovery !== 'confirmed') findings.push({ session: row.name, code: 'recovery', problem: `recovery ${row.recovery}: ${row.recoveryDetail ?? 'inspect the terminal'}` });
    const command = launchCommand({ adapter, name: row.name, cwd: row.cwd, overrides: ctx.config.agents });
    const [binary] = shellSplit(command);
    if (binary && !executableOnPath(binary, env, row.cwd)) findings.push({ session: row.name, code: 'executable-missing', problem: `executable unavailable: ${binary}; install it or correct the agent template` });
    if (row.agent !== 'shell' && !row.profile) findings.push({ session: row.name, code: 'profile-unknown', problem: 'agent profile unknown; a verified start hook can report it, or choose a recovery profile once the session is stopped' });
    if ((row.hooks === 'missing' || row.hooks === 'broken') && row.profile) {
      const key = profileKey(row.agent, row.profile);
      if (!checkedProfiles.has(key)) {
        checkedProfiles.add(key);
        findings.push({ session: row.name, code: 'hooks', installHooksFor: row.agent, profile: row.profile, problem: `hooks for ${adapter.displayName} ${row.hooks === 'broken' ? 'are incomplete or have missing runtime files' : 'are not installed'} in this session profile` });
      }
    }
    if (adapter.resume && !row.conversation) findings.push({ session: row.name, code: 'conversation-unbound', problem: 'conversation not bound; automatic recovery is unavailable. Use the agent conversation picker or start a new session explicitly' });
  }
  return findings;
}
