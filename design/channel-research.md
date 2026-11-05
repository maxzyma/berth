# Public discovery channels

Evidence for the proposed outreach sequence in [Iterations](iterations.md).
Reviewed on 2026-11-05 against Berth source
`c561258fb6b24d42d7adc047e2bfc89e41a76a38`.
This review supports a channel choice; it does not authorize posting.

## Scope and evidence limits

The sample covers terminal/session tools and one VS Code extension. It establishes
where comparable projects have appeared, not market-wide channel frequency or
attributable installation conversion. Author launch retrospectives are self-reports.
Views, votes and comments are observations, not retention measurements. Recheck
community rules at posting time.

## Comparable project records

| Project | Observed channel and format | What the record supports |
|---|---|---|
| [cmux](https://news.ycombinator.com/item?id=47079718) | Show HN: author explains the workflow problem, implementation and demo | A terminal-agent product can receive technical feedback there; 198 points and 77 comments appeared at inspection |
| [Agent Hand](https://news.ycombinator.com/item?id=47192207) | Show HN: tmux agent session manager | A counterexample to guaranteed exposure: 1 point and 1 comment appeared at inspection |
| [agent-deck](https://www.reddit.com/r/ClaudeCode/comments/1pxyn37/i_got_tired_of_managing_15_terminal_tabs_for_my/) | Author's Reddit showcase, media and installation instructions | Relevant users discuss session navigation and ask implementation questions; comments include author replies |
| [tmux-scout](https://www.v2ex.com/t/1198202) | V2EX Share Your Creations: concrete Claude/Codex session problem | Directly related Chinese-language venue; the visible reply recommends another competing tool |
| [MixHub](https://v2ex.com/t/1254038) | V2EX Share Your Creations: terminal session sidebar, screenshot, install and limits | Another direct category example; no comments appeared at inspection, so posting alone is not evidence of adoption |
| [AI Terminal Sessions](https://www.luanestradioto.com/blog/managing-ai-agent-sessions-in-vscode) | Maintainer's workflow article linking the extension | An explanatory article can connect an existing VS Code workflow to an installable tool |
| [cmux on Product Hunt](https://www.producthunt.com/products/cmux) | Product listing, gallery and maker introduction | The channel is used by a comparable product; its audience is broader than Berth's initial VS Code/tmux audience |

cmux's [launch retrospective](https://cmux.com/blog/show-hn-launch) also reports
social sharing following Show HN. This supports using a short demo on an existing
social account as a supplement. It does not establish that a new account, paid
promotion or a particular posting time would reproduce that result.

## Venue requirements

- **V2EX:** the [Share Your Creations node](https://www.v2ex.com/go/create)
  invites creators to publish their work. Use that node and a concrete workflow
  description. This check does not establish the maintainer's account eligibility
  or posting balance.
- **Reddit:** the inspected [ClaudeCode weekly showcase](https://www.reddit.com/r/ClaudeCode/comments/1xfu9ul/weekly_showcase_thread_what_are_you_building_with/)
  places simple project promotion in that thread. Substantive technical write-ups
  may use the Built with Claude Code flair, explaining actual Claude involvement.
  Repeated promotion and referral links are disallowed. Use the current thread,
  not this historical link, when posting. The dedicated rules page did not expose
  its rule text to the reader; the weekly announcement is the verified basis here.
- **Show HN:** [Show HN guidance](https://news.ycombinator.com/showhn.html)
  requires something people can try, welcomes early work, and discourages routine
  version announcements and requests for votes. The [site guidelines](https://news.ycombinator.com/newsguidelines.html)
  prohibit generated post text, generated or AI-edited comments and automated
  posting. The maintainer must write and post independently; this document is
  research, not submission copy.
- **Product Hunt:** the [launch rules](https://www.producthunt.com/launch/how-product-hunt-works)
  expect an actual product with a clear working destination. Paid hunting and
  purchased traffic are prohibited. A listing is possible, but no evidence in
  this sample establishes that its preparation cost would outperform the more
  targeted venues for Berth now.
- **Marketplace:** [VS Code documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
  identifies it as the install/discovery surface for extensions. It is Berth's
  existing destination, not a substitute for explaining why users should try it.

## Fit for Berth

Berth's testable distinction is session management inside an existing VS Code
workflow while terminal commands and custom launch scripts remain independent.
Do not promote universal recovery, a replacement terminal app or agent orchestration.
The [release record](release-0.4.5.md) describes the remaining Codex binding and
native acceptance limits.

A short demonstrated workflow and readable install/compatibility instructions
should precede outreach. Start with V2EX and a suitable Reddit showcase, separately,
so the maintainer can answer and investigate each round. Show HN is a later option
once the maintainer can demonstrate the advertised path on a clean setup and
write the submission personally. Product Hunt remains optional after that evidence.

Use voluntary reports of successful installation, discovery of an existing
session and repeat use to decide whether to expand. Stars or channel views alone
do not establish that Berth is useful. No product telemetry is needed for this
small initial trial. Sponsorship is a separate task: add a funding destination
only after confirming that it belongs to the maintainer and can receive support.
