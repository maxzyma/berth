# Changelog

## 0.4.3

### Terminal navigation

- Open sessions in dedicated Berth Editor terminals without switching another session.
- Hand off existing connections in this VS Code window only after the Editor attachment is confirmed; preserve other sessions and external clients.
- Open external sessions directly in the Editor without an extra confirmation dialog. Repeated selection reuses the existing Berth view.
- Share current-folder and choose-folder creation through one Editor toolbar entry and the sidebar.

### Interface and discovery

- Keep connection icons and activity on the first row; show optional conversation context on the second row with more spacing.
- Use distinct terminal-host artwork, a transparent VS Code mark, a smaller working indicator and reduced-motion support.
- Replace the Berth brand mark and separate it from the new-session action icon.
- Improve connection counts, process identity compatibility and native waiting-state reconciliation.
- Rename the setup diagnostic entry to Diagnose Problems.

### Upgrade notes and limits

- Reload VS Code after updating. Selecting an existing local session transfers its unowned local connections into the Berth Editor; explicit side views and external connections remain.
- Already-running, unbound Codex shared-daemon conversations still lack verified passive terminal-to-thread mapping. Live tmux attachment works; exact recovery after process loss requires a verified conversation binding.
- Qoder missed-start binding remains deferred. Native editor, onboarding/upgrade and OS-notification manual acceptance remains incomplete; this release proceeds with the maintainer’s authorization.

## 0.4.2

### Session management

- Distinguish the selected row, active terminal and sessions attached to this window.
- Keep natural session ordering and show conversation titles when available.
- Verify conversation IDs, producer processes and profiles before recovery. Preserve saved conversations when recovery fails.
- Fill missing bindings from verified turn events for Claude Code, Codex CLI, Gemini CLI, OpenCode, GitHub Copilot CLI, Cursor CLI and Kimi CLI.
- Recover launch options and host ownership without selecting another conversation by directory or name.

### Interface and setup

- Keep session details open while moving the pointer into them; copy individual values from the card.
- Remove internal recovery diagnostics from live-session details. Explicit recovery checks remain available from the context menu.
- Use product-specific agent icons with recorded sources and licenses.
- Create a separate native VS Code layout Profile instead of overwriting the current layout settings.
- Reduce startup and upgrade prompts; installation and recovery repairs remain explicit actions.

### Upgrade notes and limits

- Existing terminal sessions keep running. Reload the editor after updating the extension.
- Automatic recovery requires an exact conversation ID and its profile. Older records may need explicit recovery setup.
- Installing hooks does not identify every already-running conversation immediately. The agent must execute a supported event or expose verified native identity evidence.
- Passive Codex binding supports a process holding its own rollout file; shared-daemon TUI mapping is not supported yet.
- Qoder has no new missed-start binding support in this release.
