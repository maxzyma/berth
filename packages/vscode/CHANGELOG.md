# Changelog

## 0.4.9

### Hook setup

- Agent hooks that run another Berth installation, such as an older standalone CLI, are now offered a switch to this extension's Berth, as tmux hooks already were. Until you switch, those hooks keep handling agent events with the older Berth, so fixes in newer releases do not reach them. Declining is remembered until the hooks point somewhere else.

## 0.4.8

### Conversation identity

- An agent that a session's agent starts inside itself, such as a non-interactive `claude -p` run, no longer takes over the session. Before, its hooks could replace the session's conversation, so recovery after a reboot would have resumed that short run instead of your conversation, and its prompt and missing completion left a stale topic and a working state.

### Session details

- The hover card opens after VS Code's own hover delay (`workbench.hover.delay`, 1.5 s on macOS by default) unless you set `berth.hover.delay`.
- Clicking a session row no longer opens its hover card once the pointer leaves, or keeps it open; keyboard focus still opens details.
- Text in the hover card uses the width that its Copy buttons used to leave empty; the buttons sit in a column under the close button.

## 0.4.7

### Fewer, clearer menu entries

- A session's context menu has one *Open* entry. *Show Session* and *Open in This Window* did the same thing; key bindings to either command keep working.
- A stopped session shows *Choose Recovery Folder*, *Choose Recovery Profile* or *Review Recovery Options* only when it needs that repair: its folder is gone, its profile is unknown, or its saved options need review. *Check Recovery Readiness* still lists every blocker.
- *Inspect Earlier Layout Backup* appears in the command palette only if you used the earlier in-place layout.
- *Refresh* stays in the sessions view's menu and leaves the command palette; the view already updates on its own.

## 0.4.6

### Setup

- Check host dependencies before creating a session, with guided repair through existing package managers. Diagnose Problems shows every check.
- Offer agent and tmux hooks when they start to matter: after startup for agents running in sessions, and after creating an agent session. One notification; your answer is remembered.
- tmux hooks installed from VS Code run the extension's own Berth, so extension updates reach them. Berth repairs hooks that point to a removed installation.
- The standalone CLI is optional for VS Code users.

### Sessions

- Create sessions faster: the core creates in about 200 ms with a dozen sessions, and inspects the selected launcher in the same step.
- Session names accept CJK and other characters tmux keeps. Rename explains a refused name while you type and suggests a fixed one.
- Renaming a session renames the agent's conversation where the agent allows it: Codex through its app server; Claude Code, Qoder and OpenCode through their hooks; launch and resume through `--name`. Berth offers Copilot and Kimi Code their own rename command and types it only after you confirm. Gemini and Cursor keep their own titles.
- Reorder folder groups by dragging a header, with Alt+Up/Down, or with Move Folder Up/Down. Berth saves the order per workspace; Reset Folder Order restores the default. The New Session folder picker follows the same order.
- Exited sessions leave the list sooner, and the selection follows the active terminal.

### Fixes

- A window reload no longer reports that another restore is running. The editor waits at most 5 seconds for the state lock and names the process holding it.
- Berth keeps the agent metadata a custom launcher stamps, even when it arrives while Berth waits for the state lock.
- Keyboard focus stays on a folder header while you reorder it, and dropping a header outside the list inserts nothing.

## 0.4.5

### Activity and session details

- Show unread completion with a blue normal-weight title and a circle-check icon. Working and waiting take precedence over old unread decoration.
- Show available turn-start, waiting and completion times in hover details, including local date/time and a copyable timestamp. Keep the session list and natural ordering unchanged.
- Use validated hook events and native event timestamps; do not substitute polling time or infer completion from a quiet terminal.

### Codex discovery

- Detect working activity from a recognized live TUI without requiring a conversation ID. When verified task text is absent, use a temporary visible-prompt excerpt with its source identified in hover.
- Verify an existing complete native session-ID footer against the running client, profile and root rollout before binding. Support the npm launcher and native codex-tui rollout variants.
- Preserve remote-server and no-daemon launch options during recovery.
- Complete recognized legacy Berth two-event hook installations while preserving unrelated or customized configuration. Codex still requires native hook trust review; Berth does not grant trust.

### Upgrade notes and limits

- Clarify VS Code session management, optional iTerm2 reattachment and the evidence required for conversation recovery in public documentation.
- Reload VS Code after updating. Existing custom launch scripts remain independent of Berth.
- The passive observer does not change Codex configuration or launch arguments. A visible-prompt excerpt disappears when it is no longer visible and is never used for recovery.
- Exact conversation binding and automatic recovery remain unavailable for unbound shared-daemon Codex clients without a current identity signal. Working activity and prompt preview do not close this gap.
- Qoder missed-start support remains deferred. Broader native reload, cross-host and accessibility acceptance remains open.

## 0.4.4

### Terminal persistence

- Allow Berth Editor terminals to survive window reloads when VS Code terminal persistence is enabled.
- Reclaim restored Berth terminals using their owner identity and live tmux attachment before startup navigation creates a new view.
- Keep user-created and other-window terminals outside this restoration ownership.

### Connection indicators

- Keep the host icon fixed at the right edge, with activity in a stable slot to its left.
- Replace the extra-connection number with a compact stacked marker. Hover details list every connection and its terminal identity.
- Preserve the distinct current-window dot and light/dark theme behavior.

### Upgrade notes and limits

- Reload VS Code after updating. Terminals created by earlier versions with persistence disabled must be reopened once through Berth; subsequent reloads can restore the new terminals.
- Respect VS Code terminal persistence settings; Berth does not change them. Native reload behavior still awaits manual acceptance.
- Custom launch scripts remain independent of Berth; session discovery must not require a Berth-aware launcher.
- Older Codex hook installations may lack working/prompt events. Such sessions can appear connected while activity and the second-row summary remain unavailable; this release does not repair that integration gap.
- Passive conversation binding for already-running unbound Codex shared-daemon sessions remains a known limitation. Live terminal attachment is usable; exact recovery requires a verified binding. Qoder missed-start support remains deferred.


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
