const assert = require('node:assert/strict');
const vscode = require('vscode');
const { existsSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const phase = process.env.BERTH_TEST_HOST_PHASE;
async function until(check, description) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}
(phase ? suite : suite.skip)('Native workspace ownership across editor processes', () => {
  test('one live claimant restores its workspace and a later host reopens it', async () => {
    const root = process.env.BERTH_TEST_HOST_ROOT;
    assert.ok(process.env.BERTH_TMUX_SOCKET.startsWith('berth-test-'));
    const tmux = (...args) => execFileSync('tmux', ['-L', process.env.BERTH_TMUX_SOCKET, ...args], { encoding: 'utf8' });
    const name = 'host-restart';
    const count = () => tmux('list-clients', '-t', `=${name}`, '-F', '#{client_pid}').trim().split('\n').filter(Boolean).length;
    const marker = key => join(root, key);
    await vscode.extensions.getExtension('berthdev.berth').activate();
    if (phase === 'leader') {
      tmux('new-session', '-d', '-s', name, '-c', join(root, 'workspace'), 'sleep 3600');
      tmux('set-option', '-t', `=${name}:`, '@berth_agent', 'shell');
      await vscode.commands.executeCommand('berth.focus', name);
      assert.equal(count(), 1);
      await vscode.commands.executeCommand('berth.refresh');
      const cli = join(vscode.extensions.getExtension('berthdev.berth').extensionPath, 'dist', 'cli.mjs');
      const rows = JSON.parse(execFileSync('node', [cli, 'ls', '--json'], { encoding: 'utf8' }));
      assert.equal(rows.find(row => row.name === name).connections[0].application, vscode.env.appName);
      await vscode.commands.executeCommand('berth.detach', name);
      await until(() => count() === 0, 'leader detach');
      writeFileSync(marker('leader-ready'), 'ready');
      await until(() => existsSync(marker('follower-verified')) && existsSync(marker('other-verified')), 'both workspace ownership checks');
    } else if (phase === 'follower' || phase === 'other') {
      await until(() => existsSync(marker('leader-ready')), 'leader ready');
      await vscode.commands.executeCommand('berth.refresh');
      const servers = readdirSync(join(root, 'state', 'servers'));
      assert.equal(servers.length, 1);
      const claimDir = join(root, 'state', 'servers', servers[0], 'host-claims');
      const claims = readdirSync(claimDir).filter(file => file.endsWith('.json'));
      assert.equal(claims.length, phase === 'other' ? 2 : 1);
      const owners = claims.map(file => JSON.parse(readFileSync(join(claimDir, file), 'utf8')));
      assert.equal(owners.some(owner => owner.pid === process.pid), phase === 'other', 'only a distinct workspace receives another claim');
      assert.equal(count(), 0, 'second editor must not attach a session owned by the live claimant');
      writeFileSync(marker(phase + '-verified'), 'verified');
    } else {
      assert.equal(phase, 'restart');
      await until(() => count() === 1, 'later editor restores the workspace session');
      assert.match(tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_ownerWorkspace}').trim(), /^[a-f0-9]{64}$/);
      await vscode.commands.executeCommand('berth.detach', name);
      await until(() => count() === 0, 'restart detach');
      tmux('kill-session', '-t', `=${name}`);
    }
  });
});
