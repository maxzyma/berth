import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_BYTES = 16 * 1024 * 1024;
// Darwin: SYS___sysctl=202, CTL_KERN=1, KERN_PROCARGS2=49.
// Keep the bridge inline so the CLI and extension bundle share the same reader.
// It returns argc argv entries only; environment strings never leave this process.
// XNU exec_extract_strings aligns the saved executable path to 8 bytes for
// supported 64-bit macOS processes. kern_procargs2 removes the 16-byte
// executable_path= prefix and prepends argc (4 bytes). Do not skip NULs: they
// may be empty argv entries, and skipping them would expose environment data.
const DARWIN_ARGV = String.raw`use strict;
use warnings;
my $pid = shift @ARGV;
my $mib = pack('i3', 1, 49, $pid);
my $size = pack('Q', 0);
syscall(202, $mib, 3, 0, $size, 0, 0) == 0 or die "size";
my $length = unpack('Q', $size);
$length > 4 && $length <= 16777216 or die "bound";
my $buf = "\0" x $length;
syscall(202, $mib, 3, $buf, $size, 0, 0) == 0 or die "read";
$buf = substr($buf, 0, unpack('Q', $size));
my $argc = unpack('i', $buf);
my $path_end = index($buf, "\0", 4);
$path_end >= 4 && $argc > 0 && $argc <= 65536 or die "header";
my $start = 4 + int(($path_end - 4 + 1 + 7) / 8) * 8;
$start < length($buf) or die "alignment";
substr($buf, $path_end, $start - $path_end) !~ /[^\0]/ or die "padding";
my $end = $start;
for (1 .. $argc) { $end = index($buf, "\0", $end); $end >= 0 or die "truncated"; $end++; }
print substr($buf, $start, $end - $start);
`;

/** Process display strings are not a shell command and cannot recover word boundaries. */
export function processArguments(pid: number): string[] | undefined {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) return undefined;
  try {
    let bytes: Buffer;
    if (process.platform === 'linux') bytes = readFileSync(`/proc/${pid}/cmdline`);
    else if (process.platform === 'darwin') {
      const result = spawnSync('/usr/bin/perl', ['-e', DARWIN_ARGV, String(pid)], {
        timeout: 1000, killSignal: 'SIGKILL', maxBuffer: MAX_BYTES, encoding: 'buffer',
      });
      if (result.status !== 0 || result.error) return undefined;
      bytes = result.stdout;
    } else return undefined;
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.at(-1) !== 0) return undefined;
    const words = new TextDecoder('utf-8', { fatal: true }).decode(bytes).slice(0, -1).split('\0');
    return words[0] ? words : undefined;
  } catch { return undefined; }
}
