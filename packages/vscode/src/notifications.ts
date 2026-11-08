import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { resolveBinary } from '@berthdev/berth';

const MAC_BUNDLES: Record<string, string> = {
  'Visual Studio Code': 'com.microsoft.VSCode',
  'Visual Studio Code - Insiders': 'com.microsoft.VSCodeInsiders',
  Cursor: 'com.todesktop.230313mzl4w4u92',
};

/** A launched helper is not proof that the operating system displayed a notification. */
export function launchNotification(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 3000);
      child.once('error', () => { clearTimeout(timer); resolve(false); });
      child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    } catch { resolve(false); }
  });
}

export function notificationCommand(title: string, body: string, appName: string,
  os: NodeJS.Platform = platform(), env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } | undefined {
  if (os === 'darwin') {
    const notifier = resolveBinary('terminal-notifier', env);
    const bundle = MAC_BUNDLES[appName];
    if (notifier !== 'terminal-notifier') {
      return { command: notifier, args: ['-title', title, '-message', body, ...(bundle ? ['-activate', bundle] : [])] };
    }
    return { command: 'osascript', args: ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`] };
  }
  if (os === 'linux') return { command: 'notify-send', args: [title, body] };
  return undefined;
}

/** Best effort; editor notifications and session activity remain independent. */
export async function notifySystem(title: string, body: string, appName: string): Promise<boolean> {
  const invocation = notificationCommand(title, body, appName);
  return invocation ? launchNotification(invocation.command, invocation.args) : false;
}

/** Choose the attention channel; the originating editor retains the session action. */
export function notificationChannel(state: 'waiting' | 'done', focused: boolean,
  current: boolean, systemEnabled: boolean, remote = false): 'none' | 'editor' | 'system' {
  if (focused) return current || state === 'done' ? 'none' : 'editor';
  return systemEnabled && !remote ? 'system' : 'editor';
}

/** Keep Open available without waiting for an OS helper or losing it on success. */
export async function deliverNotification(channel: 'none' | 'editor' | 'system',
  editor: () => void, system: () => Promise<boolean>): Promise<void> {
  if (channel === 'none') return;
  editor();
  if (channel === 'system') await system();
}
