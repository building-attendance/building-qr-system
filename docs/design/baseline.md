# The design baseline

What the UI and UX of the two apps measure today, so that a later change can be compared with it instead of with a
memory. The rules are in [`../design.md`](../design.md). A number here is one that a command printed, never an estimate.
Measure again after an iteration of design work and add a dated section below the first one; do not edit an old section.

## 11/10/2026 (master b0dffc2)

### Automated, run on every pull request

| What | Value | Command or file |
|---|---|---|
| Accessibility violations (WCAG 2.1 A and AA, the WCAG 2.2 AA target size, axe best practices; both apps, light and dark) | 0, and `e2e/a11y-baseline.js` lists no exception | `e2e/a11y.spec.js` |
| Reflow at 320 px, with worst-case text, in the four languages of the provider app and in the committee app (rule T2) | no screen scrolls sideways | `e2e/reflow.spec.js` |
| Inputs under 16 px on a phone (rule F5) | none | `e2e/reflow.spec.js` |
| Physical CSS properties outside the list of exceptions (rule R1) | 0; the list holds 4, each with its reason | `tests/design-css.test.js`, `tests/design-budget.json` |
| Hard-coded spacing, radius and font-size values (rule V1, may only go down) | 278: `src/admin/admin.css` 178, `src/ui/ui.css` 84, 16 in JSX | `tests/design-budget.json` |
| Visual baselines (both apps, phone and computer, light and dark) | 46 pictures | `e2e/visual.spec.js` |
| Contrast of the colour tokens, light and dark | passes | `tests/contrast.test.js` |

### The size of what a phone downloads

| Part | Bytes (brotli) | Budget |
|---|---|---|
| Provider app, entry JS | 78,410 | 86,016 |
| Provider app, entry CSS | 3,932 | 4,608 |
| Committee app, chunk JS | 75,463 | 79,872 |
| Committee app, chunk CSS | 9,155 | 10,240 |
| Precache, total | 236,806 (16 files) | 256,000 (17 files) |

`npm run size`, `scripts/check-bundle-size.json`.

### Friction in production

**Not measured yet.** The owner asks the committee's agent, which reads the read-only agent API:
- for the last 30 days, the visits that were not counted, by reason (`/refusals`, which lists them page by page);
- for the last 30 days, the visits counted per day (`/counts`);
- as they are now, the phone health of each provider (`/providers`): the visits waiting on its phones (`waiting`), the
  phones on an old version (`outdated_devices`), and the visits that its phones dropped (`not_accepted_total`,
  `overflow_total`). These are current values and totals since each phone signed in, not a history of 30 days.

The answer goes here as numbers only: no names, no dates of a single visit.

### Sessions with the people who use the apps

**Not held yet.** Five short sessions with service providers and committee members, by the script in
[`research/session-script.md`](research/session-script.md). Only what the script says to record goes here, without a
name or anything else that identifies a person.

### What is known and not fixed yet

- The provider app is 24 px taller than the screen on every page (`.w-app` has `min-height: 100dvh` and padding), so
  every screen scrolls a little. Found by the visual baselines (#176).
- On the Points tab, a long point name squeezes the card title next to its four icon buttons and breaks mid-word (#175).
- In a committee dialog whose title wraps to several lines, the close button is centred against the whole head (#175).
- `e2e/admin.spec.js` compares `scrollWidth` with `window.innerWidth`, which grows with the content on Chromium, so its
  check of sideways scrolling cannot fail there (#175).

## 11/10/2026, after the first iteration (master 2ca89a8)

The same commands as above, after #181 to #187.

### What changed

| What | Before | Now |
|---|---|---|
| Height of every provider screen at 390x844 | 868 px (24 px of scroll on every page) | 844 px, the height of the screen (#187) |
| A committee dialog with typed text, closed by a tap outside or Esc | the text was lost | it asks first; nothing closes it while its save is on its way (#181, #182, #183) |
| A long point name on a card at 360 px | broken mid-word in a 104 px column | the actions wrap below it and the title has the full width (#187) |
| The close button of a dialog whose title wraps | beside the middle of the title | at the top (#187) |

### Automated, unchanged

Accessibility violations 0; no screen scrolls sideways at 320 px; no input under 16 px; 4 physical exceptions; 278
hard-coded sizes; 46 visual baselines (18 of them, the provider screens, remade at the new height in #187).

### Size

| Part | Bytes (brotli) | Budget |
|---|---|---|
| Provider app, entry JS | 78,431 | 86,016 |
| Provider app, entry CSS | 3,943 | 4,608 |
| Committee app, chunk JS | 75,566 | 79,872 |
| Committee app, chunk CSS | 9,178 | 10,240 |
| Precache, total | 236,959 (16 files) | 256,000 (17 files) |

### Still not measured

The friction in production and the five sessions with people, as in the first section.

### Known and not fixed

- `fitsTheWidth` in `e2e/error-boundary.spec.js` and `noHorizontalScroll` in `e2e/building-address.spec.js` compare with
  `window.innerWidth`, which grows with the content on Chromium, so they cannot fail there. #187 fixed the same check in
  `e2e/admin.spec.js`.
- The `ui-review` skill has no helper for its pictures, and the dev seed has no long names: the first use of the skill
  (#187) wrote its own scripts and data.

## 12/10/2026, after the second iteration (master 961a610)

The same commands as above, after #189 to #192 and #191. The first row on the History tab was measured by a script of
#191 on the stubbed rows of `e2e/visual.spec.js`, and `e2e/filters.spec.js` now holds it.

### What changed

| What | Before | Now |
|---|---|---|
| Hard-coded spacing, radius and font-size values (rule V1) | 278 | 0: three scales of tokens and five named layout constants (#189, #190) |
| Radius and font-size steps (`src/ui/base.css`) | 9 radii, 10 font sizes and a literal 1.375rem in two inline styles | 6 radii (the pill included), 7 font sizes, no literal (#190) |
| The committee app's tab bar on a phone | 5 tabs, the fifth ("ועד") holding the members, the building, the guide and the audit log | 4: History, Points, Providers and More ("עוד"), a sheet with Agent, Settings, Audit log and Help; the side rail lists all 7 in two groups (#192) |
| The screen that opens first | Points | History; a building with no points is sent to Points from it (#192) |
| The first visit on the History tab at 360x740 | y = 873 px, below the screen, under 600 px of filters | y = 309 px: one bar (filter button, dates, chips) and the fields in a sheet; the same on the audit log (#191) |

### Automated

Accessibility violations 0 and `e2e/a11y-baseline.js` still empty, with new scans of the settings, audit and help
screens, the More ("עוד") sheet and the filters sheet; no screen scrolls sideways at 320 px; no input under 16 px; 4 physical
exceptions; 0 hard-coded sizes (`tests/design-budget.json` has an empty `literalBudget`); 68 visual baselines.

### Size

| Part | Bytes (brotli) | Budget |
|---|---|---|
| Provider app, entry JS | 78,482 | 86,016 |
| Provider app, entry CSS | 4,176 | 4,608 |
| Committee app, chunk JS | 77,792 | 79,872 |
| Committee app, chunk CSS | 9,442 | 10,240 |
| Precache, total | 239,776 (16 files) | 256,000 (17 files) |

The committee app's JavaScript grew by 2,226 bytes in this iteration (the sheets and the filter state) and has 2,080
bytes left in its budget.

### Still not measured

The friction in production and the five sessions with people, as in the first section. Task 2 of the committee's part
of the session script ("how many visits a provider made last week") now goes through the filters sheet.

### Known and not fixed

- `fitsTheWidth` in `e2e/error-boundary.spec.js` and `noHorizontalScroll` in `e2e/building-address.spec.js` still compare
  with `window.innerWidth`, as in the section above.
- The guide (`src/admin/help.js`) does not say that on a phone the filters of History and of the audit log open from the
  Filter ("סינון") button.
- Not checked on a real iPhone yet: the two sheets (focus, the room above the home indicator) and the layout that a
  turned tablet keeps while a date is half typed. `docs/manual-ios-checklist.md` before the next release.
