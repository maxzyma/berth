# Release 0.4.5

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md) for unread completion,
hover activity times, passive Codex display and conditional native binding.
Terminal-led launch remains the core principle: the passive observer does not
change agent configuration or require launcher integration.

## Validation and publication

Local regression: 323 passed, 11 opt-in native tests skipped, 0 failed.
Two selected native Codex journeys passed separately, including default-footer
preview without a binding and exact-selection/recovery on a shared server.
Four activity-time browser checks passed across 1440×900 and 1280×800 in dark and
light themes, including timestamp copying; rendered screenshots were inspected.
The earlier eight unread-completion browser checks remain applicable.
Detailed evidence is in the [code review](code-review.md).

The [release workflow](https://github.com/maxzyma/berth/actions/runs/41945016039)
passed: 323 tests passed, 11 opt-in tests skipped, zero failures. npm `latest`,
[GitHub Releases](https://github.com/maxzyma/berth/releases/tag/v0.4.5) and the
VS Code Marketplace publish 0.4.5. Downloaded npm/GitHub CLI archives and
Marketplace/GitHub VSIX archives match byte for byte; npm integrity also matches.
The official VSIX is installed locally, with all 32 extension payload files
verified against the archive (ignoring VS Code's installation metadata).
Reload Window activates the installed update; native manual acceptance remains
separate. See the [publication receipt](assets/code-review/release-0.4.5.json).

## Accepted limits

Unbound default-footer Codex clients on a shared daemon still lack a verified
current conversation ID. Display-only activity and prompt excerpts do not authorize
exact recovery. Existing full native footer IDs can be independently verified;
that conditional capability does not establish default zero-configuration binding.
Hook trust remains agent-owned. Qoder missed-start support is deferred. Broader
native reload, cross-host, onboarding and accessibility acceptance remains open.

## Public repository audit

Audit on 2026-11-05, source baseline `367782c561ee2b8e90633b482c743f076207b4a2`, plus the
0.4.5 candidate changes. The [audit receipt](assets/code-review/public-audit-0.4.5.json)
records archive fingerprints and cross-channel comparisons.

- Reviewed 83 reachable commits, 21 tags and the current source tree. Private
  identifier checks found no matches. Six credential-scanner findings were
  SHA-256 hashes in review evidence, not credentials. Personal author email
  addresses are intentional public attribution and remain unchanged.
- Inspected 19 GitHub releases, 19 npm versions and 15 Marketplace versions:
  72 archives containing 3,611 file entries. Artifact credential and private
  identifier scans found no matches. All 33 comparable channel pairs contained
  matching package payloads. OCR completed for 44 tracked images without errors
  or private-identifier matches; displayed paths belong to synthetic fixtures.
- Updated GitHub About, package descriptions and current documentation to separate
  VS Code session management from optional iTerm2 reattachment and tab state.
  Recovery claims now state the verified-identity requirement. Historical review
  screenshots and release notes retain their version-specific meaning.
- Removed npm's stale `next` tag and deprecated the nonfunctional `0.0.0-stage`
  placeholder; official registry readback confirmed both changes. Normal releases,
  packages and tags remain available for rollback and versioned references.
  Tags for unsuccessful 0.4.0/0.4.1 release attempts remain as documented in the
  [0.4.2 release record](release-0.4.2.md).

The audit found no reason to rewrite public history or remove usable versions.
Pattern scans and OCR cannot establish that every sensitive string is absent.
Unreachable server objects, third-party clones/caches and Actions logs are outside
this evidence set. Public repository metadata, release text and package manifests
were included. The final candidate passed private-identifier and whitespace
checks; all 187 local Markdown link targets resolved. Source credential scanning
reported only the six reviewed evidence hashes. Both package allowlists passed
(168 npm archive entries and 34 VSIX entries).
