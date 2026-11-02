# Changelog

## 0.4.0

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
