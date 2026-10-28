// Runs inside the test VS Code instance: user data, extensions and tmux are all throwaway.
const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('Berth for VS Code (integration)', () => {
  test('activates and registers its commands and view', async () => {
    const extension = vscode.extensions.getExtension('berthdev.berth');
    assert.ok(extension, 'extension present');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    // Berth's own commands, and the workbench commands it relies on.
    for (const id of ['berth.new', 'berth.focus', 'berth.attach', 'berth.openToSide', 'berth.detach', 'berth.rename', 'berth.kill', 'berth.adopt', 'berth.applyLayout', 'berth.revertLayout',
      'revealInExplorer', 'workbench.files.action.collapseExplorerFolders', 'workbench.action.lockEditorGroup', 'vscode.moveViews', 'workbench.action.positionPanelBottom']) {
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
    await new Promise((r) => setTimeout(r, 800));
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    // Open the way the explorer does: no target group, so a locked group is skipped.
    const root = vscode.workspace.workspaceFolders[0].uri;
    const file = vscode.Uri.joinPath(root, 'a-file.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('a file'));
    await vscode.commands.executeCommand('vscode.open', file);
    await new Promise((r) => setTimeout(r, 300));
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

  test('settings writes stay in the test instance', async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update('terminal.integrated.tabs.location', 'left', vscode.ConfigurationTarget.Global);
    // A configuration object is a snapshot; read again after writing.
    assert.equal(vscode.workspace.getConfiguration().get('terminal.integrated.tabs.location'), 'left');
    await config.update('terminal.integrated.tabs.location', undefined, vscode.ConfigurationTarget.Global);
  });
});
