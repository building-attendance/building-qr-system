# Pilot 1: do the design rules change what an agent builds?

An A/B pilot of the design knowledge (`docs/design.md` and the project's skills), run on 11/10/2026. One task, so the
result is an indication, not a statistic.

## Setup

Both arms were the same model (Claude Sonnet) with the same one-paragraph task: committee members lose everything they
typed in a dialog of the committee app when they tap outside it or press Esc by accident; fix this. Each followed the
`AGENTS.md` of its own starting point.

| | Arm A (control) | Arm B (with the knowledge) |
|---|---|---|
| Starting point | bec6a24, before `docs/design.md` and the skills existed | master of 11/10/2026, with both |
| Told to use the knowledge | no; told not to use any skill | no; allowed to use the project's skills |
| Result | draft #180, closed after the comparison | #181, merged |

The same reviewers judged both: a probe test written by the planner, the Codex review on GitHub, and a read-only Codex
CLI review with the same prompt for both.

## Outcome

| | A | B |
|---|---|---|
| Asks only when something was typed; keeps the text and the focus; phone and computer | yes | yes |
| The page scroll comes back after "close without saving" | **no**: the page stays locked (`overflow: hidden`), proved by the probe test, P1 on the GitHub review, also found by the Codex CLI | **yes**: found and fixed while building, with a test |
| Looked at pictures of the question (360 and 1280 px, light and dark) | not reported | yes |
| Gaps that both arms left, found by the reviews | a discard during a pending save; a value put back still counted as changed; the form under the question not inert | the same three; fixed in #182, then the remaining close paths in #183 |

## What it tells us

- The one difference that would have reached people (a page that cannot scroll after discarding) was avoided by the arm
  with the knowledge, and caught by every reviewer in the arm without it.
- The knowledge did not make the reviews unnecessary: three gaps were left by both arms, and only the two outside
  reviewers found them. The review layer stays.
- Arm A wrote more tests (59) than arm B (21), and they still missed its bug: the number of tests is not the measure.

## Limits

One task, one model, one run per arm. A second pilot, on a different kind of task (a provider screen, or copy in four
languages), would tell more than a rerun of this one.
