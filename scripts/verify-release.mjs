/**
 * Post-release check (implementation.md R5): downloads a published version from
 * npm, GitHub Releases and the VS Code Marketplace, compares the archives byte
 * for byte, checks the npm integrity, extracts both archives for content scans
 * and, when the version is installed locally, compares the extension payload.
 *
 * Usage: node scripts/verify-release.mjs <version> <work-directory>
 * Prints a JSON receipt; exits non-zero when any comparison fails.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const [version, work] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !work) {
  throw new Error('Usage: node scripts/verify-release.mjs <version> <work-directory>');
}
const repo = 'maxzyma/berth';
const npmName = '@berthdev/berth';
// The official registry, not a configured mirror whose copy may be stale.
const registry = 'https://registry.npmjs.org';
const extension = { publisher: 'berthdev', name: 'berth' };
const tgzName = `berthdev-berth-${version}.tgz`;
const vsixName = `berth-vscode-${version}.vsix`;

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options });
const sha = (algorithm, file, encoding = 'hex') => createHash(algorithm).update(readFileSync(file)).digest(encoding);
const dir = (...parts) => { const path = join(work, ...parts); mkdirSync(path, { recursive: true }); return path; };

function download(url, file) {
  run('curl', ['--fail', '--silent', '--show-error', '--location', '--compressed', '--output', file, url]);
  return file;
}

function files(root) {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.name !== '.git').flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const meta = JSON.parse(run('npm', ['view', `${npmName}@${version}`, 'dist', 'dist-tags', '--json', '--registry', registry]));
const npmFile = download(meta.dist.tarball, join(dir('npm'), tgzName));
const npmIntegrity = `sha512-${sha('sha512', npmFile, 'base64')}`;

run('gh', ['release', 'download', `v${version}`, '--repo', repo, '--dir', dir('gh'), '--clobber']);
const ghTgz = join(work, 'gh', tgzName);
const ghVsix = join(work, 'gh', vsixName);

const marketplaceUrl = `https://${extension.publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/`
  + `${extension.publisher}/extension/${extension.name}/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
const mktVsix = download(marketplaceUrl, join(dir('mkt'), `${extension.name}-${version}.vsix`));

const tgzX = dir('x', 'tgz');
const vsixX = dir('x', 'vsix');
run('tar', ['-xzf', ghTgz, '-C', tgzX]);
run('unzip', ['-q', '-o', ghVsix, '-d', vsixX]);

const installed = join(homedir(), '.vscode', 'extensions', `${extension.publisher}.${extension.name}-${version}`);
let localInstall = { version, installed: false };
if (existsSync(installed)) {
  const payload = join(vsixX, 'extension');
  const mismatched = files(payload).map((file) => relative(payload, file)).filter((path) => {
    const local = join(installed, path);
    if (!existsSync(local) || !statSync(local).isFile()) return true;
    if (path !== 'package.json') return sha('sha256', local) !== sha('sha256', join(payload, path));
    const strip = (file) => { const json = JSON.parse(readFileSync(file, 'utf8')); delete json.__metadata; return JSON.stringify(json); };
    return strip(local) !== strip(join(payload, path));
  });
  localInstall = {
    version, installed: true, verifiedPayloadFiles: files(payload).length - mismatched.length, mismatched,
    excludedComparison: "VS Code-added package.json __metadata",
  };
}

const artifacts = [[tgzName, ghTgz], [vsixName, ghVsix], [`npm-${version}.tgz`, npmFile], [`marketplace-${version}.vsix`, mktVsix]]
  .map(([name, file]) => ({ name, sha256: sha('sha256', file) }));
const receipt = {
  version,
  npmRegistry: registry,
  npmTarball: meta.dist.tarball,
  npmIntegrity,
  npmIntegrityMatchesRegistry: npmIntegrity === meta.dist.integrity,
  npmGithubPayloadMatch: artifacts[0].sha256 === artifacts[2].sha256,
  marketplaceGithubPayloadMatch: artifacts[1].sha256 === artifacts[3].sha256,
  artifacts,
  verifiedAt: new Date().toISOString(),
  extractedFiles: files(join(work, 'x')).length,
  extractedTo: join(work, 'x'),
  localInstall,
  npmDistTags: meta['dist-tags'],
};
writeFileSync(join(work, 'receipt.json'), `${JSON.stringify(receipt, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 1)}\n`);
const failed = !receipt.npmIntegrityMatchesRegistry || !receipt.npmGithubPayloadMatch
  || !receipt.marketplaceGithubPayloadMatch || (localInstall.installed && localInstall.mismatched.length > 0);
process.exitCode = failed ? 1 : 0;
