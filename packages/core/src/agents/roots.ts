import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Shared profile location for hook installation, status, binding and display. */
export function agentRoot(agent: string, env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir();
  const overrides: Record<string, string | undefined> = {
    claude: env.CLAUDE_CONFIG_DIR, codex: env.CODEX_HOME,
    gemini: env.GEMINI_CLI_HOME ? join(env.GEMINI_CLI_HOME, '.gemini') : undefined,
    qoder: env.QODER_CONFIG_DIR, copilot: env.COPILOT_HOME, kimi: env.KIMI_CODE_HOME,
    opencode: join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'),
  };
  if (overrides[agent]) return overrides[agent]!;
  if (agent === 'kimi') {
    const legacy = join(home, '.kimi'), current = join(home, '.kimi-code');
    return existsSync(legacy) && !existsSync(current) ? legacy : current;
  }
  return join(home, `.${agent}`);
}
