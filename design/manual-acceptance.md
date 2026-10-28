# Manual acceptance

**English** · [简体中文](manual-acceptance.zh-CN.md)

Steps for the cases automated tests cannot cover: V8, V9 and I5
([implementation §6](implementation.md#6-acceptance-cases)). Run
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

## I5 — iTerm2 restores its layout and every pane's session

Needs iTerm2 3.7 or later with the Python API enabled, window restoration on
(iTerm2 Settings → General → Startup, and macOS System Settings → Desktop &
Dock → *Close windows when quitting an application* off), and
`berth tmux install` and `berth iterm2 install` done. Turn off any other
startup script that reopens one tab per session.

1. In iTerm2 build a layout: two windows; in the first, two tabs, one of them
   split vertically. In each pane, start or attach an agent session with your
   usual launcher. Note which session is in which pane.
2. **Quit.** Quit iTerm2 (⌘Q) and start it again. Expected: the same windows,
   tabs and splits; within a few seconds every pane is back in the session it
   showed.
3. **Crash.** From a terminal outside iTerm2: `kill -9 $(pgrep -x iTerm2)`;
   start iTerm2. Expected: as in step 2.
4. **State.** `berth stamp --session <name> state=waiting note="manual check"`.
   Expected: that pane's tab shows a status dot and the subtitle "manual
   check"; `state=` clears it.
5. **Reboot** (optional): restart the machine and start iTerm2. Expected: the
   layout returns, each session is rebuilt and its agent resumes its
   conversation.
6. Record for steps 2, 3 and 5 whether panes came back by themselves; if not,
   iTerm2 dropped the panes' user variables (spec §12).

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
| I5 | | | | |
