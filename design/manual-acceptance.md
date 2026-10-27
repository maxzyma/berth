# Manual acceptance

**English** · [简体中文](manual-acceptance.zh-CN.md)

Steps for the cases automated tests cannot cover: V8, V9 and the in-iTerm2
part of I3 ([implementation §6](implementation.md#6-acceptance-cases)). Run
them before each release and record the result at the end of this file's
copy in the release notes.

Before starting: tmux ≥ 3.0, the `berth` CLI and the Berth extension from the
release are installed, and VS Code has been reloaded since the extension was
installed. Test sessions are named `accept-*` so they are easy to clean up.

To keep your everyday editor untouched, run the VS Code cases in a separate
instance with its own profile, installing the extension from a local build:

```sh
R=~/.berth-accept
code --user-data-dir $R/user --extensions-dir $R/ext --install-extension berth-vscode-<version>.vsix
code --user-data-dir $R/user --extensions-dir $R/ext --new-window $R/work
```

`npm install -g <path to berthdev-berth-<version>.tgz>` installs the CLI from a
local build. Remove `~/.berth-accept` afterwards.

## V9 — clicking a system notification brings the editor forward

Needs, on macOS, `terminal-notifier` (`brew install terminal-notifier`).

1. In VS Code, open a folder and run **Berth: New Agent Session**, pick any
   agent. A terminal opens attached to the new session; note its name.
2. Switch to another application so VS Code is not focused.
3. In any terminal run, using that name:
   `berth stamp --session <name> state=waiting note="manual check"`
4. Expected within a few seconds: a system notification "Berth — <name> is
   waiting for you: manual check".
5. Click it. Expected: VS Code comes to the front, and its own notification
   offers **Open**; clicking **Open** focuses the session's terminal. The
   session's row in the Berth view shows the waiting icon and the view badge
   shows 1.
6. Clean up: `tmux kill-session -t <name>`.

With two VS Code instances open, macOS brings forward the application, which
may show the other instance's window; that still counts as a pass.

## I3 — iTerm2 reopens its own sessions

1. `berth iterm2 install`. If iTerm2 asks whether the script may use the
   Python API, allow it.
2. Create one session for iTerm2 and one for VS Code:
   `berth new claude --name accept-iterm --origin iterm2 --cwd ~`
   `berth new claude --name accept-code --origin vscode --cwd ~`
3. `berth snapshot`
4. Quit iTerm2 (sessions keep running in tmux). Make sure no terminal is
   attached to `accept-iterm`: `tmux list-clients -t accept-iterm` prints
   nothing.
5. Start iTerm2. Expected: a tab "Berth: accept-iterm" opens attached to that
   session; no tab opens for `accept-code`.
6. Run `berth stamp --session accept-iterm state=waiting` from another
   terminal. Expected: the tab shows a "◐ waiting" badge, an amber tab colour
   and an iTerm2 notification.
7. Reboot path (optional, needs a restart): repeat 2–3, restart the machine,
   start iTerm2. Expected: `accept-iterm` is rebuilt and attached; it
   resumes its conversation when one was recorded.
8. Clean up: `tmux kill-session -t accept-iterm; tmux kill-session -t
   accept-code; berth iterm2 uninstall`.

## V8 — Remote workspaces

Needs a reachable remote with tmux: Remote-SSH to a Linux or macOS host, a
Dev Container (Docker running), or WSL on Windows. One of them is enough per
release; record which.

1. Connect VS Code to the remote and open a folder there.
2. Install Berth into the remote window (Extensions view → Berth → *Install
   in SSH / Container / WSL*), or `code --install-extension <vsix>` from a
   terminal in that window.
3. Run **Berth: New Agent Session**. Expected: the session is created on the
   remote's tmux (`tmux ls` in a remote terminal shows it) and its terminal
   opens.
4. Reload the window (**Developer: Reload Window**). Expected: the session's
   terminal is reopened automatically and the agent is still running.
5. `berth stamp --session <name> state=done` in a remote terminal. Expected:
   an in-editor notification, the row shows done.
6. Clean up: kill the session on the remote.

## Recording

| Case | Date | Environment | Result | Notes |
|---|---|---|---|---|
| V8 | | | | |
| V9 | | | | |
| I3 | | | | |
