# Berth for VS Code

Find terminal coding agents and return to the right conversation inside VS Code.

- **Sessions** groups work by folder and shows product identity, attention state
  and verified terminal connections. **Find a Session** searches names, titles
  and folders; details provide Copy controls for full values.
- **Persistence** keeps agents running in tmux when a terminal or editor closes.
  Startup recovery uses the workspace recorded at successful attachment. Legacy
  records stay available for manual opening.
- **Recovery** requires a bound conversation ID. Berth distinguishes a resume
  request from a matching agent acknowledgement, failure and no confirmation.
  Missing IDs or executables do not silently create a new conversation.
  **Retry Recovery** and **Choose Recovery Folder** provide explicit next steps.
- Installation and upgrades preserve your current view and layout. Hook setup and
  the optional layout are available when you choose them; inventory refresh does
  not prompt you to install hooks. Existing conversation records are completed
  automatically when a verified agent event supplies the missing identity.
- **Check Setup** explains missing prerequisites, hooks and recovery limits.
- **Check Recovery Readiness**, in the right-click menu (also in stopped-session details),
  explains what prevents that conversation from being recovered and offers
  applicable repairs. Checking never restarts the agent or clears an unverified
  binding. Running sessions keep these recovery risks in details.
  Hook installation uses the bundled runtime, independent of a global CLI PATH.
- **Notifications** identify sessions that need attention. The optional
  **Create Agent Layout Profile** opens native profile import without changing
  your current settings. **Switch Layout Profile** lets you select your usual
  profile again. Create the profile from a local window before using it remotely.
  In the import review, choose **Extensions → Default** to reuse extensions
  installed in Default, including an offline VSIX; copying template extensions
  may require Marketplace access. Earlier in-place layout backups remain
  available through **Inspect Earlier Layout Backup** for manual recovery.

Requires tmux 3.0 or later on the machine where the workspace runs. Remote
workspaces use that host's tmux and state. Native host and agent-version
acceptance is tracked in the repository's product review; implementation support
alone is not a verified compatibility claim.
