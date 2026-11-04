# Release 0.4.4

## Scope

See the [release notes](../packages/vscode/CHANGELOG.md) for terminal persistence,
restored ownership and connection indicators. The [iteration plan](iterations.md#extension-boundary)
prioritizes session reliability and preserves terminal-led launch without adding
an extension platform.

## Validation and publication

Local regression: 304 passed, 8 opt-in live tests skipped, 0 failed.
Browser regression: 98 passed across 1440×900 and 1280×800. Existing light/dark
visual evidence remains applicable; native manual acceptance is separate.
CLI package allowlist, VSIX packaging, changed-document links and public-content
checks passed. Publication results will be recorded after the release workflow.

## Accepted limits

Native terminal reload, Editor focus/tab lifecycle and onboarding/upgrade manual
acceptance remain unverified. Previously transient terminals must be reopened
once through Berth after updating; VS Code persistence settings remain authoritative.

Passive binding for already-running unbound Codex shared-daemon conversations
remains unresolved: live attachment is usable, but exact recovery after process
loss requires a verified binding. Qoder missed-start support remains deferred.

Older Codex hook installations can lack working/prompt events. A live connected
session without those events or a verified conversation can have neither activity
nor a second-row summary. Hook upgrade and running-agent activation are tracked
in [T7](iterations.md#t7--make-setup-and-health-understandable); they are not fixed
by this release.
