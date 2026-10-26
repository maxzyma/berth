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

  test('settings writes stay in the test instance', async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update('terminal.integrated.tabs.location', 'left', vscode.ConfigurationTarget.Global);
    // A configuration object is a snapshot; read again after writing.
    assert.equal(vscode.workspace.getConfiguration().get('terminal.integrated.tabs.location'), 'left');
    await config.update('terminal.integrated.tabs.location', undefined, vscode.ConfigurationTarget.Global);
  });
});
