// Runs inside the test VS Code instance: user data, extensions and tmux are all throwaway.
const assert = require('node:assert/strict');
const vscode = require('vscode');
const { execFileSync, spawn } = require('node:child_process');

async function until(check, description) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}


suite('Berth for VS Code (integration)', () => {
  test('activates and registers its commands and view', async () => {
    const extension = vscode.extensions.getExtension('berthdev.berth');
    assert.ok(extension, 'extension present');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    // Berth's own commands, and the workbench commands it relies on.
    for (const id of ['berth.new', 'berth.newInFolder', 'berth.findSession', 'berth.checkSetup', 'berth.retryRecovery', 'berth.recoveryFolder', 'berth.nextAttention', 'berth.focus', 'berth.openToSide', 'berth.detach', 'berth.rename', 'berth.kill', 'berth.adopt', 'berth.applyLayout', 'berth.revertLayout',
      'revealInExplorer', 'workbench.files.action.collapseExplorerFolders', 'workbench.action.lockEditorGroup', 'workbench.action.positionPanelBottom', 'workbench.action.closePanel']) {
      assert.ok(commands.includes(id), `missing ${id}`);
    }
    await vscode.commands.executeCommand('berth.sessions.focus');
  });

  test('session terminals hold the first editor group; files open beside them', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.berth');
    const config = vscode.workspace.getConfiguration();
    await config.update('workbench.editor.autoLockGroups', { terminalEditor: true }, vscode.ConfigurationTarget.Global);
    const terminal = vscode.window.createTerminal({ shellPath: '/bin/sh', location: { viewColumn: vscode.ViewColumn.One } });
    terminal.show();
    await until(() => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputTerminal)), 'terminal editor');
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    // Open the way the explorer does: no target group, so a locked group is skipped.
    const root = vscode.workspace.workspaceFolders[0].uri;
    const file = vscode.Uri.joinPath(root, 'a-file.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('a file'));
    await vscode.commands.executeCommand('vscode.open', file);
    await until(() => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.path.endsWith('a-file.txt'))), 'file editor');
    const groupOf = (pred) => vscode.window.tabGroups.all.find((g) => g.tabs.some(pred))?.viewColumn;
    const terminalColumn = groupOf((t) => t.input instanceof vscode.TabInputTerminal);
    const fileColumn = groupOf((t) => t.input instanceof vscode.TabInputText && t.input.uri.path.endsWith('a-file.txt'));
    terminal.dispose();
    await vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await config.update('workbench.editor.autoLockGroups', undefined, vscode.ConfigurationTarget.Global);
    assert.equal(terminalColumn, vscode.ViewColumn.One, 'terminal in the first group');
    assert.ok(fileColumn && fileColumn !== vscode.ViewColumn.One, `file opened outside the terminal group (got ${fileColumn})`);
  });



  test('real terminal attachment is acknowledged; main, side and manual clients detach locally', async () => {
    const socket = process.env.BERTH_TMUX_SOCKET;
    assert.ok(socket?.startsWith('berth-test-'), 'test socket required');
    const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
    const name = 'native-attachment';
    const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
    let manual, independent;
    try {
      tmux('new-session', '-d', '-s', name, '-c', cwd, 'sleep 3600');
      tmux('set-option', '-t', `=${name}:`, '@berth_agent', 'shell');
      tmux('set-option', '-t', `=${name}:`, '@berth_cwd', cwd);
      await vscode.commands.executeCommand('berth.focus', name);
      const count = () => tmux('list-clients', '-t', `=${name}`, '-F', '#{client_pid}').trim().split('\n').filter(Boolean).length;
      assert.equal(count(), 1, 'main acknowledged');
      assert.equal(tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_origin}').trim(), 'vscode');
      assert.match(tmux('display-message', '-p', '-t', `=${name}:`, '#{@berth_ownerWorkspace}').trim(), /^[a-f0-9]{64}$/);
      await vscode.commands.executeCommand('berth.openToSide', name);
      assert.equal(count(), 2, 'side acknowledged');
      manual = vscode.window.createTerminal({ shellPath: 'tmux', shellArgs: ['-L', socket, 'attach-session', '-t', `=${name}`] });
      await until(() => count() === 3, 'manual attachment');
      independent = spawn('tmux', ['-L', socket, '-C', 'attach-session', '-t', `=${name}`], { stdio: ['pipe', 'ignore', 'ignore'] });
      await until(() => count() === 4, 'independent attachment');
      await vscode.commands.executeCommand('berth.refresh');
      await vscode.commands.executeCommand('berth.detach', name);
      await until(() => count() === 1, 'local detach preserves independent client');
      assert.equal(tmux('list-clients', '-t', `=${name}`, '-F', '#{client_pid}').trim(), String(independent.pid));
      assert.doesNotThrow(() => tmux('has-session', '-t', `=${name}`), 'detach leaves work running');
    } finally {
      manual?.dispose();
      independent?.kill();
      try { tmux('kill-session', '-t', `=${name}`); } catch { /* Already removed by failed fixture startup. */ }
    }
  });





  test('settings writes stay in the test instance', async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update('terminal.integrated.tabs.location', 'left', vscode.ConfigurationTarget.Global);
    // A configuration object is a snapshot; read again after writing.
    assert.equal(vscode.workspace.getConfiguration().get('terminal.integrated.tabs.location'), 'left');
    await config.update('terminal.integrated.tabs.location', undefined, vscode.ConfigurationTarget.Global);
  });
});

suite('Session responsiveness', () => {
  test('switching terminals follows the selected terminal and shell exit removes its attachment', async () => {
    const socket = process.env.BERTH_TMUX_SOCKET;
    assert.ok(socket?.startsWith('berth-test-'), 'isolated tmux required');
    const { promisify } = require('node:util');
    const { execFile } = require('node:child_process');
    const { join } = require('node:path');
    const run = promisify(execFile);
    const ext = vscode.extensions.getExtension('berthdev.berth');
    await ext.activate();
    const cli = join(ext.extensionPath, 'dist', 'cli.mjs');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const names = [`responsive-first-${process.pid}`, `responsive-second-${process.pid}`];
    const opened = [];
    const timings = [];
    try {
      for (const name of names) {
        const started = Date.now();
        await run(process.execPath, [cli, 'new', 'shell', '--cwd', cwd, '--name', name], { env });
        await vscode.commands.executeCommand('berth.focus', name);
        opened.push(vscode.window.activeTerminal);
        timings.push(Date.now() - started);
      }
      assert.notEqual(opened[0], opened[1]);
      opened[0].show();
      await until(() => vscode.window.activeTerminal === opened[0], 'first terminal selected');
      await vscode.commands.executeCommand('berth.refresh');
      assert.equal(vscode.window.activeTerminal, opened[0], 'folder reveal must not focus the older main');
      for (const terminal of [opened[1], opened[0], opened[1], opened[0]]) {
        terminal.show();
        await until(() => vscode.window.activeTerminal === terminal, 'rapid terminal selection');
      }
      const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.berth-responsive-file.txt');
      await vscode.workspace.fs.writeFile(file, Buffer.from('File focus acceptance'));
      const document = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
      await vscode.commands.executeCommand('berth.refresh');
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), file.toString(), 'folder follow must not steal file focus');
      const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input.uri?.toString() === file.toString());
      if (tab) await vscode.window.tabGroups.close(tab);
      await vscode.workspace.fs.delete(file);
      const started = Date.now();
      opened[0].sendText('exit');
      await until(() => opened[0].exitStatus !== undefined || !vscode.window.terminals.includes(opened[0]), 'shell terminal exits');
      const exitMs = Date.now() - started;
      await vscode.commands.executeCommand('berth.refresh');
      const rows = JSON.parse((await run(process.execPath, [cli, 'ls', '--json'], { env })).stdout);
      assert.equal(rows.some(row => row.name === names[0] && row.live), false);
      assert.ok(rows.some(row => row.name === names[1] && row.live), 'other session remains alive');
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.berth-responsive-result.json'), Buffer.from(JSON.stringify({ openMs: timings, exitMs })));
    } finally {
      for (const terminal of opened) terminal?.dispose();
      for (const name of names) {
        try { await run('tmux', ['-L', socket, 'kill-session', '-t', `=${name}`], { env }); }
        catch { /* The exit test already removed the first session. */ }
      }
    }
  });
});
