# Design rules

The rules for what a person sees and touches. The visual identity is direction B of the redesign (owner decision of
14/10/2026): one typeface, Rubik, and a violet palette in a light and a dark theme (V1). It replaced Heebo and the blue
palette. The focus of these rules is UX, forms, errors, states, right-to-left layout and consistency. Where every source
comes from, and which ones were turned down: [`design/sources.md`](design/sources.md). What the apps measure today, and
the pilots and sessions with users: [`design/baseline.md`](design/baseline.md) and [`design/research/`](design/research/).

- **Scope:** every change to a screen, form, dialog, style or text a person sees, in both apps.
- **Precedence when sources disagree:** `AGENTS.md` > WCAG > research (GOV.UK) > platform guidance (Apple HIG) > expert
  opinion (Vercel, Emil Kowalski, Impeccable). Example: Vercel prefers APCA to WCAG contrast and writes dates with
  `Intl`; WCAG and `AGENTS.md` win.
- **A UI change starts from a finding** (an issue, a rule below, a user session), not from taste. A working component
  is not restyled on the way.
- **How a rule gets in:** a pull request that cites its source in `design/sources.md` (licence checked) and writes the
  rule as one entry below, with a check or the reason it has none.
- **A mechanical rule becomes a check.** Once a test enforces it, this file keeps only its reason and a link to the test.
- **This file has a size limit:** 250 lines, and every rule in it has a check or the stated reason it has none. A new
  rule makes room by shrinking one that now has a check.

An entry is the rule, then **Why** (written for this app: field workers on phones, often old ones, sometimes offline;
volunteer committee members who are not technical; Hebrew first, right to left; four languages in the provider app),
**Source** (with its evidence level: research, standard, platform or expert opinion) and **Check**: an existing test, or
`planned: <name>` for a check that another branch is adding, or `review` when only a person or a reviewing agent can
judge it. What `AGENTS.md` already holds (dates, the four
languages, phone and computer together, the order of tile actions, the Content-Security-Policy) is not repeated here.

## Forms and errors

**F1. Every field has a visible label, never a placeholder alone.**
- **Why:** a placeholder vanishes at the first keystroke, so a volunteer who returns to a form after a phone call no
  longer knows what the field wanted. A visible label stays.
- **Source:** [WCAG 3.3.2](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) (standard);
  [GOV.UK text input](https://design-system.service.gov.uk/components/text-input/) (research).
- **Check:** axe in `e2e/a11y.spec.js` fails a field with no accessible name, but axe accepts a placeholder as a name,
  so a label that is visible is `review`.

**F2. Validate on submit, not while the person types. Errors appear next to the field and, in a long form, in a summary
at the top. Focus moves to the first error (to the summary, when there is one).**
- **Why:** GOV.UK: "Do not validate when the user moves away from a field." A half-typed phone number is not an
  error yet, and slow typists suffer most. On a phone the keyboard hides the form, so only focus brings the person
  to the error. GOV.UK shows the summary even for one error; here it is for long forms only, because a short dialog
  already shows its one or two errors beside the fields.
- **Source:** [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/),
  [error summary](https://design-system.service.gov.uk/components/error-summary/) (research);
  [Vercel, Forms](https://github.com/vercel-labs/web-interface-guidelines/blob/main/AGENTS.md) (expert opinion).
- **Check:** `review`, and `planned: E2E per form` (the pull request of each form adds it).

**F3. An error message says what happened and how to fix it, uses the same words next to the field and in the summary,
and never clears what was typed.**
- **Why:** "Invalid input" does not say whether to fix the phone or the e-mail. Retyping a long address on a small
  keyboard because one field failed is where people give up. GOV.UK: "Do not clear any form fields when showing the
  Error message component."
- **Source:** [GOV.UK error message](https://design-system.service.gov.uk/components/error-message/) (research);
  [WCAG 3.3.3](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) (standard).
- **Check:** `review`.

**F4. Typed input is never lost. A dialog with unsaved changes does not close on an outside click or Esc without asking.**
- **Why:** on a phone one stray tap outside a dialog is easy, and a committee member who filled in a point, with the
  keyboard open and the map behind, should not lose it. A failed save keeps the form as it was typed.
- **Source:** GOV.UK error message, as in F3 (research); Impeccable
  [`harden`](https://github.com/pbakaus/impeccable/blob/main/skill/reference/harden.md), "Preserve user input on
  error"; Vercel, Forms, "Warn on unsaved changes before navigation" (expert opinion).
- **Check:** `tests/components/dialog-unsaved-changes.test.jsx` (a new form adds its case) and `e2e/admin.spec.js` (tap outside, Esc).

**F5. Text inputs are at least 16px on phones, so that iOS does not zoom.**
- **Why:** iOS Safari zooms into a field under 16px and stays zoomed, which leaves the form cropped. The cure is the
  font size, never a viewport that blocks zoom. `.w-input` already follows it.
- **Source:** Emil Kowalski
  [`mobile-native`](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md), "Page zooms into
  the input"; Vercel, Targets and input (expert opinion).
- **Check:** `e2e/reflow.spec.js`, "F5 input font size on a phone".

**F6. Never block paste. Give fields the right `autocomplete` and input type, so password managers and keyboards help.**
- **Why:** a provider who signs in by password on a phone saves retyping when a password manager can fill the field,
  and `inputmode` or `type` brings the numeric or e-mail keyboard instead of a hunt through symbols.
- **Source:** [WCAG 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)
  (standard); Vercel, Forms; Emil Kowalski `mobile-native` (expert opinion).
- **Check:** `review`.

**F7. A button names its outcome ("Save point", not "OK"), and the same action has the same name everywhere.**
- **Why:** a volunteer who opens the app twice a month learns the buttons by their words. "OK" says nothing, and a
  second word for the same action ("Remove" here, "Delete" there) reads as a second action, and costs a second
  translation in four languages.
- **Source:** Anthropic
  [`frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), writing section
  (expert opinion); [GOV.UK button](https://design-system.service.gov.uk/components/button/) (research).
- **Check:** `review`.

## Destructive actions

**D1. A destructive action names the object it affects, asks before it acts unless it can be undone, and is red only for
deleting (see `AGENTS.md`, Rules for every change).**
- **Why:** the rows of the committee app look alike (several points, several providers). "Delete?" does not say which
  one, and on a phone a tap lands on the wrong row easily.
- **Source:** Impeccable
  [`clarify`](https://github.com/pbakaus/impeccable/blob/main/skill/reference/clarify.md), "Actions and navigation";
  Vercel, Feedback, "Confirm destructive actions or provide Undo window" (expert opinion).
- **Check:** `review`; `e2e/admin.spec.js` measures the order of the menu actions (the red delete last), not the wording.

## States

**S1. Every list and screen has a designed empty, loading and error state, each with a next step.**
- **Why:** a new installation starts empty, and a phone in a basement fails its requests. A
  blank screen does not tell a volunteer whether to wait, try again or add the first item.
- **Source:** Impeccable [`onboard`](https://github.com/pbakaus/impeccable/blob/main/skill/reference/onboard.md)
  and `harden` (empty and loading states); Vercel, Content (expert opinion).
- **Check:** `review`, and the component tests in `tests/components/`.

**S2. Offline, the app always says whether an action was saved on the phone or sent, and never fails silently.**
- **Why:** a provider scans in a stairwell with no signal. Without "kept on this phone, will be sent" they scan again or
  believe the visit is lost. Say what the app does, not "offline": non-technical readers misread that word.
- **Source:** [web.dev, Offline UX design guidelines](https://web.dev/articles/offline-ux-design-guidelines) (platform,
  2016, CC BY 4.0); this app's field context.
- **Check:** the offline E2E test in `e2e/provider.spec.js`. WebKit cannot go offline there, so the iPhone is checked by
  hand with `docs/manual-ios-checklist.md`.

**S3. The system shows its status (syncing, location, update available) where the person looks.**
- **Why:** the app waits for things nobody can see: a queued check-in, a position fix, a new version that waits for
  the next start. A status that lives on another screen is not seen.
- **Source:** NN/g, [visibility of system status](https://www.nngroup.com/articles/visibility-system-status/)
  (heuristic 1, expert opinion, paraphrased).
- **Check:** `review`.

## Touch and layout

**T1. Touch targets are at least 24 by 24 CSS px, and primary actions aim for 44.**
- **Why:** field workers tap one-handed on old phones, often in a hurry, and the committee uses the same buttons.
- **Source:** [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (standard, AA);
  [Apple HIG, Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) (platform;
  iOS default control size is 44 by 44 pt).
- **Check:** axe `wcag22aa` in `e2e/a11y.spec.js`; `expectTouchTargets` in `e2e/error-boundary.spec.js` (44px, crash screen).

**T2. No horizontal scroll at 320px in any of the four languages, even with worst-case text (long names, plurals).**
- **Why:** Russian and English run longer than Hebrew, and the committee types the names: plan for 30 to 40 percent more text.
- **Source:** [WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) (standard); Emil Kowalski
  [`break-ui`](https://github.com/emilkowalski/skills/blob/main/skills/break-ui/SKILL.md); Impeccable `harden`
  (expert opinion).
- **Check:** `e2e/reflow.spec.js`, "T2 reflow at 320 px".

**T3. A floating bar hides nothing a tap can reach: on a phone the page fades into the background colour behind it, and
the end of every page stands clear above the fade.**
- **Why:** content peeked out under and beside the floating tab bar, and a tap could reach a control that nobody could see.
- **Source:** this project; the owner's decision of 14/10/2026 (D10 of the redesign), made on his iPhone.
- **Check:** `e2e/admin.spec.js`, "the page fades out behind the tab bar of the phone", at 360 and 320 px.

## RTL and languages

**R1. Layout uses logical CSS properties (inline and block). A physical property appears only in the list of exceptions,
each with its reason.**
- **Why:** one stylesheet serves Hebrew and Arabic (right to left) and English and Russian (left to right). A
  `margin-left` is right in one and wrong in the other.
- **Source:** Ahmad Shadeed, [RTL Styling 101](https://rtlstyling.com/posts/rtl-styling/) (expert opinion, paraphrased);
  [Apple HIG, Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left) (platform).
- **Check:** `tests/design-css.test.js` (the list of exceptions is `tests/design-budget.json`, each with its reason).

**R2. Mirror icons that show direction (back, next, progress, a list's chevron). Never mirror numbers, clocks, media
controls, the QR code, logos or checkmarks.**
- **Why:** a list chevron points "forward", which is left in Hebrew and Arabic (`.w-flip` in `src/ui/ui.css`). Mirrored
  digits misread; a mirrored QR code may not scan (this last one is our own addition, the others are in the sources).
- **Source:** [Apple HIG, Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left)
  (platform, paraphrased); [Material bidirectionality](https://m1.material.io/usability/bidirectionality.html)
  (platform, paraphrased; the page is no longer maintained).
- **Check:** `review`.

**R3. Isolate mixed-direction runs (names, codes, times) so that they keep their order.**
- **Why:** a Latin company name or a code inside Hebrew text scrambles the punctuation and digits next to it;
  `translate()` in `src/i18n/core.js` isolates every inserted value.
- **Source:** [Unicode UAX #9](https://www.unicode.org/reports/tr9/) and the W3C
  [inline bidi markup article](https://www.w3.org/International/articles/inline-bidi-markup/) (standard).
- **Check:** `tests/i18n.test.js`.

## Visual system

**V1. Colours, font weights, spacing, radii and font sizes come from the tokens.**
- **Why:** one set of tokens keeps the light and dark themes in step: a colour written in place passes in one theme and
  fails in the other. Spacing (`--w-space-*`), radius (`--w-radius-*`) and font size (`--w-font-*`) are tokens on `:root` in
  `src/ui/base.css`, and a size that must keep its exact value, such as the room above the tab bar, is a named layout
  constant (`--w-layout-*`). The colours are tokens of each theme in `src/ui/ui.css`; the text on the primary colour is
  white in light and dark in dark, because white on the light violet of the dark theme fails. One typeface, Rubik, is
  pinned, with every subset (Hebrew, Latin, Cyrillic, Arabic) in the offline precache.
- **Source:** this project; Refactoring UI (the advice to fix the spacing, sizing and type scales in advance;
  [book](https://refactoringui.com/), expert opinion, paraphrased).
- **Check:** `tests/contrast.test.js`, `tests/typography.test.js`, `tests/design-css.test.js` (and `tests/design-budget.json`).

**V2. Text has 4.5:1 contrast, UI parts and focus rings 3:1, in both themes, including every fixed colour (the danger
button, the select chevron).**
- **Why:** the app follows the device's light or dark setting, so every colour pair is read in both. Fixed colours sit
  outside the token pairs, so they are the ones that slip.
- **Source:** [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and
  [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (standard).
- **Check:** `tests/contrast.test.js`, to be extended to the fixed colours (`planned: contrast of the fixed colours`).

**V3. Every interactive element has a visible focus that nothing covers.**
- **Why:** committee members on a computer use the keyboard in long lists and dialogs, and a sticky bar or a dialog
  footer can hide the focused row.
- **Source:** [WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) and
  [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) (standard).
- **Check:** `review`. axe (`e2e/a11y.spec.js`) has no rule for the look of the focus, or for a focus that is covered.

**V4. Motion is short (about 200 ms), never on an action repeated many times a day, respects `prefers-reduced-motion`,
and adds no animation library (the size budget).**
- **Why:** a scan or a row action used all day should answer at once, an old phone drops frames on long animations,
  and a library is bytes that every phone downloads.
- **Source:** Emil Kowalski
  [`emil-design-eng`](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) (expert opinion,
  paraphrased); [WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) (standard, AAA).
- **Check:** `review`, and the bundle budget (`npm run size`, `scripts/check-bundle-size.json`).

**V5. At the top of a committee screen the one filled thing is the action: an add button is a pill that says what it adds,
and the person is a quiet circle with their Google photo, or their initial when there is no photo or it does not load.**
- **Why:** two solid violet circles, the account and a round "+", stood one above the other, and the eye did not know where
  to look; a lone "+" does not name what it adds (F7). A missing, refused or failed photo shows the initial, never a broken
  picture, and the photo is decoration (`alt=""`) because the name is beside it.
- **Source:** this project; the owner's decisions of 14/10/2026 (D11 and D12 of the redesign), made on his iPhone.
- **Check:** `tests/admin-icon-buttons.test.js`, `e2e/admin.spec.js` (the headings), `tests/contrast.test.js`,
  `tests/components/member-face.test.jsx`, `e2e/admin-photo.spec.js`.

**V6. The sign for "scan" is a frame of four corner brackets, in the apps and in the app icon, and the icon is that frame
in white on the primary violet.**
- **Why:** the earlier drawing of a QR code read as a grid of apps, and the Home Screen icon was still the old blue.
- **Source:** this project; the owner's decision of 14/10/2026 (D13 of the redesign), made on his iPhone from four options.
- **Check:** `tests/pwa-icons.test.js`, `tests/png.test.js`; the signs inside the apps are `review` and `e2e/visual.spec.js`.

## Copy

**C1. Use plain, short words, one term per concept, and the same term in all screens and languages.**
- **Why:** the committee is not made of specialists, and the provider app has four languages. One word per thing (point,
  provider, visit) is learned once and translated once.
- **Source:** [GOV.UK, use clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)
  (research: even specialists prefer plain English); Anthropic `frontend-design`, writing section (expert opinion).
- **Check:** `review`.

## Reviewing a UI change

Ask these before a UI pull request is opened and when one is reviewed. They paraphrase the ten usability heuristics of
Nielsen Norman Group ([article](https://www.nngroup.com/articles/ten-usability-heuristics/)); read it for the reasoning.

1. **Status.** Does the screen show what the system is doing now (saving, waiting for signal, sent)?
2. **Words.** Are they the words of the person using the app (a cleaner, a volunteer), not of the code?
3. **Control.** Can the person back out or undo, from a dialog too?
4. **Consistency.** Does the same thing look and read the same on every screen and in every language, and does the new
   piece follow what the app already does?
5. **Prevention.** Is the slip made hard (the object named, a confirmation for a delete, the right input type) before an
   error message is needed?
6. **Recognition.** Is what the person needs on the screen, not something to remember from another screen?
7. **Minimal.** Does every element earn its place on a small screen?
8. **Errors.** Does each one say what happened and how to fix it, near its cause, and keep what was typed?

Contains public sector information licensed under the Open Government Licence v3.0.
