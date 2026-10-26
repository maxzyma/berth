import { loadConfig, type BerthConfig } from './config/index.js';
import { SnapshotStore } from './snapshot/store.js';
import { Tmux } from './tmux/client.js';

export interface Context {
  config: BerthConfig;
  tmux: Tmux;
  store: SnapshotStore;
}

export function createContext(env: Record<string, string | undefined> = process.env): Context {
  const config = loadConfig(env);
  return {
    config,
    tmux: new Tmux({ bin: config.tmuxBin, socket: config.tmuxSocket }),
    store: new SnapshotStore(config.snapshotRoot),
  };
}
