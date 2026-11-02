# Release preparation: 0.4.0

Status: approved for publication with the limitations below. Native acceptance is still unverified.

The candidate includes the current session/recovery, layout Profile, hover,
icon and quiet-upgrade repairs. User-facing changes and limits are in the
[release notes](../packages/vscode/CHANGELOG.md). The last published release is
0.3.6, checked against GitHub Releases and npm on 2026-11-02.

## Verification

The isolated Node 24 candidate installed from the lockfile and completed the
full default suite: 279 passed, 7 skipped, 0 failed (146.6 seconds). The CLI
archive contains 144 files; the VSIX contains 28. Package versions, archive
contents, isolated CLI installation, installed-file comparison, both CLI help
entry points and npm publish dry-run passed. Workflow lint, changelog extraction
and the public-information check passed. See the
[candidate receipt](assets/code-review/release-0.4.0.json).

The workflow now packages both archives and extracts release notes before
publishing npm. It publishes the inspected tarball, then creates the GitHub
release and publishes Marketplace through the existing OIDC workflow.

## Accepted release limitations

- Implementation R6 requires manual cases V8, V9, I5 and `npm run test:vscode`
  before each release. These were not run for this candidate. The maintainer's
  no-foreground-testing request remains in effect. The maintainer explicitly
  authorized this release after these gaps were disclosed on 2026-11-02; this
  release exception does not mark the manual checks as passed.
- CR51's earlier version-diagnosis failure did not recur in this full run. Its
  cause remains unknown; this is not evidence of a completed repair.
- Full passive first-install adoption remains open. The release notes disclose
  that limitation, including Codex shared-daemon mode, without claiming all CLI
  identities can be discovered immediately.

Existing rendered browser evidence remains applicable to unchanged webview
code. No daily editor window was controlled or reloaded for this preparation.

## Publication

Publish only the reviewed source commits,
update the parent repository reference, and create the version tag at the
published commit. The existing tag workflow publishes npm, GitHub release
assets and Marketplace. The maintainer authorized the official release on 2026-11-02.

## Open-source review

The pre-publication audit covered 75 reachable commits, 450 historical blobs,
294 candidate files, 16 npm versions, 16 GitHub releases and 12 Marketplace
versions. Across 60 archives, no credentials or private workspace identifiers
were found. Marketplace contents matched the corresponding GitHub packages.
Forty evidence images received OCR checks, with a flagged fixture reviewed
visually. Six candidate secret-scanner findings were verified evidence hashes.
Existing public attribution remains in history; new release commits use the
maintainer's GitHub noreply address. No historical rewrite or old-version
withdrawal is required by these findings. See the
[audit receipt](assets/code-review/open-source-audit.json).
