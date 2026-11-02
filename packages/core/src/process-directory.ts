import { spawnSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';

// Darwin proc_info(336), PROC_INFO_CALL_PIDINFO(2), PROC_PIDVNODEPATHINFO(9).
// proc_vnodepathinfo contains two vnode_info_path structures; each ends with
// vip_path[MAXPATHLEN=1024]. Derive the offset from the returned structure size.
const DARWIN_CWD = String.raw`
use strict;
use warnings;
my $pid = int(shift @ARGV);
my $buffer = "\0" x 16384;
my $size = syscall(336, 2, $pid, 9, 0, $buffer, 16384);
$size > 2048 && $size <= 16384 && $size % 2 == 0 or die "process directory unavailable";
my $path = substr($buffer, $size / 2 - 1024, 1024);
my $end = index($path, "\0");
$end > 0 or die "invalid directory";
print substr($path, 0, $end);
`;

/** Read directory identity, never a terminal-escaped rendering of its name. */
export function processDirectory(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) return undefined;
  try {
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform !== 'darwin') return undefined;
    const result = spawnSync('/usr/bin/perl', ['-e', DARWIN_CWD, String(pid)], { timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 16384 });
    if (result.status !== 0 || result.error || !result.stdout.length) return undefined;
    const path = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
    return path.startsWith('/') ? path : undefined;
  } catch { return undefined; }
}
