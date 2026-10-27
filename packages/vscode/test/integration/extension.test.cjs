// Runs inside the test VS Code instance: user data, extensions and tmux are all throwaway.
const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('Berth for VS Code (integration)', () => {
  test('activates and registers its commands and view', async () => {
    const extension = vscode.extensions.getExtension('berthdev.berth');
    assert.ok(extension, 'extension present');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['berth.new', 'berth.focus', 'berth.attach', 'berth.detach', 'berth.rename', 'berth.kill', 'berth.adopt', 'berth.applyLayout', 'berth.revertLayout']) {
      assert.ok(commands.includes(id), `missing ${id}`);
    }
    await vscode.commands.executeCommand('berth.sessions.focus');
  });

  test('the Berth container opens and terminals open in the editor area', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.berth');
    const config = vscode.workspace.getConfiguration();
    await config.update('terminal.integrated.defaultLocation', 'editor', vscode.ConfigurationTarget.Global);
    const terminal = vscode.window.createTerminal({ shellPath: '/bin/sh' });
    terminal.show();
    await new Promise((r) => setTimeout(r, 500));
    const inEditor = vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal));
    terminal.dispose();
    await config.update('terminal.integrated.defaultLocation', undefined, vscode.ConfigurationTarget.Global);
    assert.ok(inEditor, 'terminal opened as an editor tab');
  });

  test('settings writes stay in the test instance', async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update('terminal.integrated.tabs.location', 'left', vscode.ConfigurationTarget.Global);
    // A configuration object is a snapshot; read again after writing.
    assert.equal(vscode.workspace.getConfiguration().get('terminal.integrated.tabs.location'), 'left');
    await config.update('terminal.integrated.tabs.location', undefined, vscode.ConfigurationTarget.Global);
  });
});
