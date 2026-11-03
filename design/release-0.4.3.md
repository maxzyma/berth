# Release 0.4.3

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md) for terminal handoff,
Editor creation, compact rows, host artwork and discovery changes.

## Validation and publication

Local full regression: 301 passed, 8 opt-in live tests skipped, 0 failed.
The CLI package file allowlist, VSIX packaging and public-content scan passed.
Browser regression: 94 passed across 1440×900 and 1280×800. Prior visual
review evidence is retained; this automated run is not native manual acceptance.
The [release workflow](https://github.com/maxzyma/berth/actions/runs/41664635558)
completed successfully. npm `latest`, the
[GitHub release](https://github.com/maxzyma/berth/releases/tag/v0.4.3) and the
VS Code Marketplace report 0.4.3. The downloaded npm/GitHub CLI archives are
byte-identical; Marketplace/GitHub extension payloads match. The official VSIX
is installed locally. Hashes and accepted limits are in the
[release receipt](assets/code-review/release-0.4.3.json).

## Accepted limits

The maintainer authorized publication with the Codex shared-daemon passive
binding issue retained. Already-running unbound conversations have no verified
terminal-to-current-thread mapping; live tmux attachment remains usable, but
exact recovery after process loss requires an established binding. Qoder
missed-start support remains deferred.

Native Editor focus/tab lifecycle, onboarding/upgrade and OS notification manual
acceptance remain unverified. Publication authorization does not count as
passing these checks. Existing automated evidence is recorded in the
[code review](code-review.md).
