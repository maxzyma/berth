import { createHash } from 'node:crypto';
import { ADAPTERS, type HookStatus } from '@berthdev/berth';

/** globalState key for items the user asked not to be offered again. */
export const SETUP_DECLINED = 'berth.setupDeclined';
const SET_UP = 'Set Up…';
const NEVER = "Don't Ask Again";

export interface SetupItem { key: string; label: string; detail: string; install: () => Promise<void> }
type TmuxState = { state: 'current' | 'missing' | 'broken' | 'other'; target?: string; key: string };

/** Editor surfaces and installers, injected so the policy is unit-testable. */
export interface SetupReminderHost {
  declined(): string[];
  decline(keys: string[]): PromiseLike<void>;
  notify(text: string, ...actions: string[]): PromiseLike<string | undefined>;
  pick(items: SetupItem[]): PromiseLike<SetupItem[] | undefined>;
  failed(message: string): void;
  agentHooks(agent: string): HookStatus;
  /** The CLI an agent's installed hooks run when it is another Berth installation. */
  agentHookOther(agent: string): string | undefined;
  installAgentHooks(agent: string): Promise<void>;
  tmuxHooks(): TmuxState;
  installTmuxHooks(): Promise<void>;
}

/**
 * Offers missing hook setup, and hooks that run another Berth installation,
 * when it starts to matter (spec §6): after startup for agents with live
 * sessions, and after creating an agent session. One notification at a time;
 * each item at most once per activation; "Don't Ask Again" is remembered per
 * item. Inventory refresh never prompts.
 */
export class SetupReminder {
  private readonly offered = new Set<string>();
  private open = false;

  constructor(private readonly host: SetupReminderHost) {}

  async offer(agents: readonly string[]): Promise<void> {
    if (this.open) return;
    const declined = new Set(this.host.declined());
    const missing = [...this.agentItems(agents), ...this.tmuxItems()].filter(item => !declined.has(item.key) && !this.offered.has(item.key));
    if (!missing.length) return;
    missing.forEach(item => this.offered.add(item.key));
    this.open = true;
    try {
      const names = missing.map(item => item.label).join(', ');
      const choice = await this.host.notify(
        `Finish Berth setup: ${names}. Hooks let Berth show agent state and resume conversations after a restart.`, SET_UP, NEVER);
      if (choice === NEVER) {
        await this.host.decline(missing.map(item => item.key));
        return;
      }
      if (choice !== SET_UP) return;
      for (const item of await this.host.pick(missing) ?? []) {
        try { await item.install(); }
        catch (error) { this.host.failed((error as Error).message); }
      }
    } finally { this.open = false; }
  }

  private agentItems(agents: readonly string[]): SetupItem[] {
    return [...new Set(agents)].flatMap(agent => {
      const adapter = ADAPTERS.find(a => a.id === agent);
      if (!adapter?.hookTarget) return [];
      const status = this.host.agentHooks(agent);
      const other = status === 'installed' ? this.host.agentHookOther(agent) : undefined;
      if (other) return [{
        key: `agent:${agent}:other:${createHash('sha256').update(other).digest('hex')}`, label: `${adapter.displayName} hooks`,
        detail: `Run this extension's Berth instead of ${other}.`,
        install: () => this.host.installAgentHooks(agent),
      }];
      if (status !== 'missing' && status !== 'broken') return [];
      return [{
        key: `agent:${agent}`, label: `${adapter.displayName} hooks`,
        detail: status === 'broken' ? 'Installed but not usable; reinstall them for this extension.'
          : 'Show working, waiting and done, and resume the exact conversation after a restart.',
        install: () => this.host.installAgentHooks(agent),
      }];
    });
  }

  private tmuxItems(): SetupItem[] {
    const found = this.host.tmuxHooks();
    if (found.state !== 'missing' && found.state !== 'other') return [];
    return [{
      key: `tmux:${found.key}`, label: 'tmux hooks',
      detail: found.state === 'other' ? `Run this extension's Berth instead of ${found.target}.`
        : 'Keep sessions started, renamed or closed in other terminals recoverable.',
      install: () => this.host.installTmuxHooks(),
    }];
  }
}
