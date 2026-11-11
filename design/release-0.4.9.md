# Release 0.4.9

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md). The setup reminder now
offers to switch agent hooks that run another Berth installation to the
extension's Berth, as it already did for tmux hooks (spec §6). Without it, agent
hooks installed by an older standalone CLI kept handling events with that CLI
after the extension upgraded, so fixes such as 0.4.8's nested-agent identity
check did not reach them. Core gains `hookTarget`, which reports the runtime and
CLI an agent's installed hooks run.

## Validation and publication

Source `b7c120d`, 2026-11-11, macOS:

- Unit and controller suite: 411 passed, 11 opt-in native tests skipped, 0 failed.
  New tests cover the reported target in every hook format and the reminder's
  offer, install and per-target decline.
- VS Code integration suite: 5 passed, 1 pending (the multi-process workspace
  ownership phase).
- On this machine, a Claude configuration whose hooks ran a 0.4.2 standalone CLI
  is reported as another installation; the current configuration, whose hooks
  run the extension's Berth, is not.
- The webview is unchanged since 0.4.8.
- Manual cases V8, V9 and I5 were not re-run. They cover remote workspaces,
  notification focus and iTerm2 restoration, which this change does not touch;
  the [0.4.6 results](manual-acceptance.md#results) remain the latest.
- The private-identifier check of the working tree found no matches.

The [release workflow](https://github.com/maxzyma/berth/actions/runs/42952964099)
passed on its first attempt: on macOS 15 and macOS 15 Intel, 411 tests passed,
11 opt-in tests skipped, zero failures; the Linux and Windows jobs also passed.
npm `latest`, [GitHub Releases](https://github.com/maxzyma/berth/releases/tag/v0.4.9)
and the VS Code Marketplace publish 0.4.9. The npm archive from the official
registry matches the GitHub archive byte for byte and its integrity; the
Marketplace and GitHub VSIX archives match byte for byte. Private-identifier and
credential scans of the 209 published files found nothing. The official VSIX is
installed locally, with all 33 extension payload files verified against the
archive (ignoring VS Code's installation metadata). See the
[publication receipt](assets/code-review/release-0.4.9.json).

## Accepted limits

The limits of [0.4.8](release-0.4.8.md#accepted-limits) still apply. Agents read
hook configuration when they start, so sessions already running keep calling the
previous target until they restart.
