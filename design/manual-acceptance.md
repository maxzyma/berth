# Manual acceptance

**English** · [简体中文](manual-acceptance.zh-CN.md)

Steps for the cases automated tests cannot cover: V8, V9 and I5
([implementation §6](implementation.md#6-acceptance-cases)). Run
them before each release and record the result at the end of this file's
copy in the release notes.

Before starting, confirm tmux ≥ 3.0 and identify the exact CLI/VSIX artifacts
and hashes. Use `accept-*` names only inside the isolated server. Agree on a
foreground window before launching the editor; never close the daily editor.

Run the following in bash or zsh, replacing the two artifact paths. The prefix
installation leaves the daily CLI unchanged. A clean child environment removes
inherited tmux endpoints, agent profiles and credentials. Authentication or native
agent configuration needed for acceptance must be set up in this temporary HOME.

```sh
BERTH_ACCEPT_ROOT="$(mktemp -d /tmp/berth-test-accept.XXXXXX)"
mkdir -p "$BERTH_ACCEPT_ROOT"/{home,config,state,data,cache,tmp,work}
berth_accept() {
  env -i PATH="$BERTH_ACCEPT_ROOT/cli/node_modules/.bin:$PATH" \
    HOME="$BERTH_ACCEPT_ROOT/home" XDG_CONFIG_HOME="$BERTH_ACCEPT_ROOT/config" \
    XDG_STATE_HOME="$BERTH_ACCEPT_ROOT/state" XDG_DATA_HOME="$BERTH_ACCEPT_ROOT/data" \
    XDG_CACHE_HOME="$BERTH_ACCEPT_ROOT/cache" TMPDIR="$BERTH_ACCEPT_ROOT/tmp" \
    SHELL=/bin/sh TMUX_TMPDIR="$BERTH_ACCEPT_ROOT" BERTH_TMUX_SOCKET=berth-test-accept \
    BERTH_CONFIG="$BERTH_ACCEPT_ROOT/config/berth/config.toml" \
    BERTH_STATE_DIR="$BERTH_ACCEPT_ROOT/state/berth" "$@"
}
tmux_accept() { berth_accept tmux -L berth-test-accept "$@"; }
berth_accept npm install --prefix "$BERTH_ACCEPT_ROOT/cli" "/absolute/path/berthdev-berth-<version>.tgz"
berth_accept code --user-data-dir "$BERTH_ACCEPT_ROOT/user" --extensions-dir "$BERTH_ACCEPT_ROOT/ext" --install-extension "/absolute/path/berth-cr<revision>.vsix"
berth_accept code --user-data-dir "$BERTH_ACCEPT_ROOT/user" --extensions-dir "$BERTH_ACCEPT_ROOT/ext" --new-window "$BERTH_ACCEPT_ROOT/work"
```

Use `berth_accept berth ...` for every local CLI acceptance command and
`tmux_accept ...` for direct tmux inspection or cleanup. Do not substitute bare
`tmux` or `berth`. These functions must remain available in the setup terminal.
After closing the isolated editor, run `tmux_accept kill-server` and remove only
the directory printed by `printf '%s\n' "$BERTH_ACCEPT_ROOT"`.

This setup is for the local macOS editor journey. iTerm2 and remote lifecycle
checks below have their own isolation requirements.

### Window-close terminal revival

In the prepared Berth Profile, check persistent sessions are enabled and process
revival is `onExitAndWindowClose`. Record terminal count, tmux attachments and
pane PIDs, including an unrelated shell. Close the window through File → Close
Window, then reopen the same workspace and Profile. Verify the attachments and
pane processes survive and the terminal count does not grow. Repeat after reload.
Do not delete fallback shells based on their names. Test with unsaved text too:
when Hot Exit backs it up without prompting, verify the recovered content rather
than expecting a save dialog. Explicit user persistence opt-outs must remain intact.

## Completion candidate: native journey

Use the isolated profile and socket above. Agree on a
foreground testing window before opening the editor. Keep existing user
terminals and agent conversations untouched.

1. Run the native integration suite: command registration, actual main/side/manual
   attachment, local detach and layout revert after a user edit. Verify detached
   work remains running and another host stays attached.
2. Open two workspaces with the same folder basename. Open a session in each,
   then restart the isolated editor. Check verified workspace labels and restore
   destinations. Open the same workspace twice: only one window auto-restores.
3. Use Find a Session with duplicate titles, no matches and a removed result;
   cancel without changing the selected terminal. Check the native error message
   when attachment fails.
4. Enter details by pointer and keyboard. Copy a long path, conversation ID and
   title, then paste into a scratch document. Test Escape, focus return, zoom and
   screen-reader names. Clipboard API tests alone do not verify this journey.
5. On a named installed agent version, bind an exact ID, interrupt the isolated
   server and recover it. Require the matching start acknowledgement. Check a
   rejected ID, missing hooks, moved folder, explicit retry and intentional End.
   Unknown producer formats must not replace an existing ID.
6. Install the packaged candidate into the isolated profile and repeat the
   critical open/recover/copy steps. Record package hash, host/agent versions,
   results and unsupported environments. iTerm2 restart/reboot and remote-host
   cases remain separate acceptance entries.

## V9 — clicking a system notification brings the editor forward

Needs, on macOS, `terminal-notifier` (`brew install terminal-notifier`).
Notifications must also be allowed for that helper in System Settings. With
permission denied or the helper unavailable, verify the editor fallback instead
and record the notification-click case as unverified. Do not reset OS permissions
or treat helper exit status as proof that a banner was visible.

1. In VS Code, open a folder and run **Berth: New Agent Session**, pick Shell for this notification-only check. A terminal opens attached to the new session; note its name.
2. Switch to another application so VS Code is not focused.
3. In any terminal run, using that name:
   `berth_accept berth stamp --session <name> state=waiting note="manual check"`
4. Expected within a few seconds: a system notification "Berth — <name> is
   waiting for you: manual check".
5. Click it. Expected: VS Code comes to the front, and its own notification
   offers **Open**; clicking **Open** focuses the session's terminal. The
   session's row in the Berth view shows the waiting icon and the view badge
   shows 1.
6. Clean up: `tmux_accept kill-session -t =<name>`.

Record application activation and exact-session opening separately. macOS may
activate another window of the application; that proves only application
activation. Verify **Open** in the issuing window before passing session opening.

## I5 — iTerm2 restores its layout and every pane's session

Run I5 in a disposable macOS user account with no daily terminals, or a verified
isolated iTerm2 instance. For iTerm2 3.7.0, use a dedicated official application
copy and a unique `-suite`; verify its preferences, Application Support, SavedState
and API socket are separate before connecting. Python API authentication must
target that application path (`IT2_APP_PATH`) and socket suite (`IT2_SUITE`).
Never copy daily API authorization state. Record the exact PID before quit/crash
testing. Do not use `--command`, which suppresses AutoLaunch. This alternative
is supported by the pinned [suite initialization](https://github.com/gnachman/iTerm2/blob/v3.7.0/sources/AppKit/main.m)
and [support directory selection](https://github.com/gnachman/iTerm2/blob/v3.7.0/sources/Categories/NSFileManager%2BiTerm.m). Install the
candidate CLI into the isolated test environment. In a disposable account,
AutoLaunch uses that account's HOME. With a dedicated suite, install the script
into that suite's Application Support and give the CLI its isolated test HOME
and tmux endpoint; never install it into daily Application Support. Record the isolated iTerm2 process PID and account before crash testing;
never use a process-name-wide kill command. Reboot only the disposable test machine
or VM after agreeing the interruption window.

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
3. **Crash.** First activate iTerm2 and switch to another application so native
   restoration state is saved; verify the saved process identities match the live
   panes. From a terminal outside iTerm2: `kill -9 <verified-isolated-iTerm2-pid>`;
   start iTerm2. Expected: as in step 2. Separately test a crash before the next
   native save: iTerm2 may restore old shells and adopt surviving processes in an
   orphan window. Berth must not add duplicate connections to sessions already
   shown by those surviving terminals. Record layout recovery and connection
   safety separately; the latter does not prove layout restoration.
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
release; record which. Use a disposable remote account/container with its own
agent profiles, Berth state and test socket. A separate local editor profile does
not isolate the remote host. Do not run these steps in a daily remote account.
In that isolated remote editor, set `berth.tmuxSocket` to `berth-test-remote`;
use the same endpoint for CLI commands below.

1. Connect VS Code to the remote and open a folder there.
2. Install Berth into the remote window (Extensions view → Berth → *Install
   in SSH / Container / WSL*), or `code --install-extension <vsix>` from a
   terminal in that window.
3. Run **Berth: New Agent Session**. Expected: the session is created on the
   remote's tmux (`tmux -L berth-test-remote ls` in a remote terminal shows it) and its terminal
   opens.
4. Reload the window (**Developer: Reload Window**). Expected: the session's
   terminal is reopened automatically and the agent is still running.
5. Switch to another application, then run
   `BERTH_TMUX_SOCKET=berth-test-remote berth stamp --session <name> state=done`
   remotely. Expected: an in-editor notification and the done state in the row.
   No notification helper runs on the remote server. While the editor is focused,
   completion stays in the row without an extra notification.
6. Clean up only the isolated remote session: `tmux -L berth-test-remote kill-session -t =<name>`.

## Platform coverage

Record the client OS and execution-host OS separately. macOS/Linux runtime
regression, Linux Xvfb editor integration and Windows activation-boundary tests
are different evidence. A Linux VM is useful for a clean dependency check; it
does not establish WSL or Remote-SSH reconnect behavior.

Without another test machine, run the available local journey and automated
matrix. Leave Windows desktop, WSL, remote reconnect, OS notification clicks and
iTerm2 application restart explicitly unverified until exercised. A new iTerm2
test window can verify attach, pane markers, detach and reconnect without
restarting daily windows; it does not replace I5.

## Results

| Case | Date | Environment | Result | Notes |
|---|---|---|---|---|
| V8 | | | | |
| V9 | | | | |
| I5 | | | | |
