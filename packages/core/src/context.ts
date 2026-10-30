import { loadConfig, type BerthConfig } from './config/index.js';
import { SnapshotStore } from './snapshot/store.js';
import { Tmux } from './tmux/client.js';

export interface Context {
  config: BerthConfig;
  tmux: Tmux;
  store: SnapshotStore;
  /** Environment the context was made from; locates agent configuration. */
  env: Record<string, string | undefined>;
}

export function createContext(env: Record<string, string | undefined> = process.env): Context {
  const config = loadConfig(env);
  return {
    config,
    tmux: new Tmux({ bin: config.tmuxBin, socket: config.tmuxSocket, socketPath: config.tmuxSocketPath }),
    store: new SnapshotStore(config.snapshotRoot),
    env,
  };
}
