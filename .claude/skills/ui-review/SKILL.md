---
name: ui-review
description: Review a change to what a person sees (a screen, a form, a dialog, a style, UI text) against docs/design.md, with pictures in the languages, themes and widths the apps run in. Use before opening a pull request that touches a CSS file, a screen or dialog component, or text in src/i18n or src/admin, and when asked to review or audit the UI or UX of a screen.
---

# UI review

The rules are `docs/design.md`. This skill applies them to one change. A finding names its rule (F1 to C1) or one of the
eight questions of "Reviewing a UI change" at the end of that file; taste alone is not a finding. The visual identity is
direction B of the redesign (owner decision of 14/10/2026), and it is fixed:

- Rubik, the one typeface, and the violet palette with the other tokens (V1; `--w-primary` is `#5b4bdb` in light,
  `src/ui/ui.css`).
- A tile or row of the committee app shows one "more" button, and all its actions are in the menu of that button, edit
  first (when it has one): the order is in `AGENTS.md`.
- On a phone the tab bar of the committee app floats, with the page fading out behind it (T3).
- An add button is a pill with its words, and the account circle is a quiet violet tint, filled by the member's Google
  photo when there is one (V5).
- The scan sign is a frame of four corner brackets (V6).

A finding is fixed inside this identity: no new colour, size, font or library comes out of a review.

## Steps

1. **Scope.** From `git diff origin/master...HEAD`, list every screen and state that the change can reach: a CSS selector
   leads to the components that use it, a component to the screens that render it, a text key to every screen that shows
   it. Include the states that apply: empty, loading, error, offline, a long name.
   Done when every changed selector, component and text key maps to at least one screen and state.

2. **Run the checks that exist**, cheapest first, with the ports and schema of your own E2E run (`docs/testing.md`):
   - `npx vitest run tests/design-css.test.js tests/contrast.test.js tests/typography.test.js tests/i18n.test.js`
   - `npx playwright test e2e/reflow.spec.js e2e/a11y.spec.js --project=android-chrome`, then `--project=iphone-webkit`
   - The visual baselines are compared in CI only (`e2e/visual.spec.js`). After the push, expect changed pictures on the
     screens of step 1 and nowhere else: a picture that changed elsewhere is a finding.
   Done when each command exits 0, or each failure is written down as a finding.

3. **Look.** Take a picture of every screen and state of step 1 with the helper, `npm run ui-review:pictures`
   (`docs/testing.md`, "The pictures of the UI review"). It builds the app, seeds the worst case of the `break-ui` skill (long
   names, one long word, a name of one letter, a count of exactly 1, an empty building) in a schema of its own, and takes the
   provider app at 390 px in all four languages (Russian runs longest, English is left to right, Arabic right to left in another
   script) and the committee app at 360 px and at 1280 px in Hebrew, each in the light and the dark theme. For a narrow change add
   `--grep` with the words of the screens: `npm run ui-review:pictures -- --grep providers` (the titles are "provider app",
   "committee app, 360 px", "committee app, 1280 px", "empty building" and the name of the screen). The pictures go to
   `UI_REVIEW_OUT`, or to `ui-review-pictures/`, which git ignores, and the end of the run says where and how many. They are not
   baselines and are never committed. The data is the helper's own (`scripts/ui-review/worst-case.mjs`), never a toggle in the app
   and never real people or attendance. A run next to another one takes its own `UI_REVIEW_APP_PORT`, `UI_REVIEW_API_PORT` and
   `UI_REVIEW_SCHEMA`, as the E2E run of step 2 does. A state that the helper does not reach (a dialog, a form with an error) is
   taken with a scratch Playwright script outside the repository, or with the browser pane when the session has one, on the same
   fake data.
   Done when you have opened every picture in scope.

4. **Judge.** Apply every rule of `docs/design.md` that the scope touches (a form: F1 to F7; a delete: D1; a list or a
   status: S1 to S3; anything tapped, or a floating bar: T1 to T3; layout or icons: R1 to R3; colour, size, focus,
   motion, the top of a committee screen, the scan sign: V1 to V6; words: C1), then the eight questions. On a phone screen also read the `mobile-native` skill.
   Done when every applicable rule has a verdict: pass, finding, or not applicable with the reason.

5. **Report.** Rank the findings:
   1. a rule broken: its ID, the screen and state, the picture, and the fix;
   2. a question of the checklist that fails;
   3. polish.

   Say what the person experiences ("the sign-in tile goes off the screen and cannot be tapped"), then the cause. Then
   write the evidence for the pull request body: the pictures before and after, the commands and their exit codes.

**Done when** every finding has a decision: fixed in this change, an issue opened for it, or rejected with the reason.

## Boundaries

- A component that works is not restyled without a finding (`docs/design.md`, "A UI change starts from a finding").
- A visual baseline changes only with a sentence in the pull request that says which screens changed and why
  (AGENTS.md, Code Review Rules, P1).
- A finding the existing checks could have caught mechanically is also a lesson: propose the check (a test, a rule in
  `tests/design-budget.json`), so that the next review does not depend on someone looking.
