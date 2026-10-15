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

## 14/10/2026, after the redesign to direction B (master 6ce5019)

The same measurements as above, after #222 to #238: the twelve pull requests of the topic "visual redesign B". The
owner's decision of 14/10/2026 replaced the one of 11/10/2026 that kept Heebo and the blue. Every number below was
printed by the command next to it, run on 14/10/2026 on master at 6ce5019 with this pull request (documents, pictures
and the script that takes them) on top, one Playwright project at a time, in a scratch schema. A row says so when a
number needed a temporary line of code to be counted; that line was taken out again.

### What changed

| What a person sees | Before | Now | Pull request, decision |
|---|---|---|---|
| The typeface and the colours | Heebo and the blue; Russian and Arabic had no letters in it, so they read in the device's font | Rubik and a violet palette, light and dark; all four scripts are kept for use without a network; the edge of a field is at least 3:1 | #223 (D2, D4) |
| Buttons, fields, cards, dialogs | on a phone only the filters and "More" opened from the bottom | pill buttons, cards that rest on a shadow, and on a phone every dialog is a sheet from the bottom (a computer keeps the centre) | #225 (D7) |
| The actions of a tile or a row | four icon buttons on a point tile; icons on a history row | an edit button and a "more" button; the rest are in its menu, in one order, with the red delete last: points, providers, members, keys, history rows | #222, #231, #234 (D6) |
| The top of the committee app | three icons: the provider app, light or dark, sign out | one account circle with a menu that holds all three; a quiet violet disc with the member's first letter | #227, #236 (D11) |
| The member's face | the first letter only | the member's Google photo in the circle and on the member's card, and the letter when there is no photo or it does not load | #237 (D12) |
| The tab bar on a phone | a bar across the bottom, every tab named | a floating pill, only the current tab named; the page fades out behind it, so nothing shows under or beside it | #227, #235 (D10) |
| The add buttons | a round "+" | a pill that says what it adds (new point, new provider, new committee member, new key) | #236 (D11) |
| Home | a table of the counts of seven days | a summary card with a bar for each day (DD/MM heads under the bars), the providers of the week, and tiles | #228 (D5) |
| History and the audit log | rows divided by edges, and icon buttons on a history row | a soft card for each day, the time in a pill, one "more" button on a row | #234 |
| The provider app | the previous look | cards, a violet card with three steps, result screens with a ring and a status circle (amber for "saved on the phone"), new texts in the four languages | #226 (D8, D9) |
| The app icon and the scan sign | the Home Screen icon was the old blue; the QR drawing read as a grid of apps | a white scan frame on the app's violet, the same sign inside the apps, a robot head for the agent, a lock with a plus for a new password | #238 (D13) |
| What production showed on the way | | each pull request was deployed when it merged, so for hours on 14/10/2026 the new colours stood beside some old structure | D1 |

Three of these (D10, D11, D13) were findings from the owner's own iPhone on 14/10/2026, not from the five sessions below.

What this section replaces in the ones above: the typeface and the blue that the decision of 11/10/2026 kept; the four
icon buttons of a point tile (the second known problem of the first section, fixed by #187 and now gone with the icons);
the committee tab bar of 12/10/2026 ("History, Points, Providers and More"), which is now Home, History, Points,
Providers and More, as a floating pill; and "the screen that opens first: History", which Home has been since #201
(13/10/2026, before the redesign).

### Automated, run on every pull request

| What | Value | Command or file |
|---|---|---|
| Accessibility violations (WCAG 2.1 A and AA, the WCAG 2.2 AA target size, axe best practices; both apps, light and dark) | 0 in 197 scans: 60 of the provider app, 129 of the committee app and 8 of the shared components; `e2e/a11y-baseline.js` lists no exception (0 entries) | `npx playwright test e2e/a11y.spec.js e2e/reflow.spec.js --project=android-chrome`: 34 passed, and the same with `--project=iphone-webkit`: 34 passed (9 tests of `e2e/a11y.spec.js` and 25 of `e2e/reflow.spec.js` in each). The scans were counted with a temporary line in `expectNoA11yViolations` (`e2e/fixtures.js`), in a separate run of `e2e/a11y.spec.js` on android-chrome (9 passed) |
| Reflow at 320 px, with worst-case text, in the four languages of the provider app and in the committee app (rule T2) | no screen scrolls sideways | the 25 tests of `e2e/reflow.spec.js`, in the run above |
| Inputs under 16 px on a phone (rule F5) | none | the two F5 tests of `e2e/reflow.spec.js`, in the run above |
| Physical CSS properties outside the list of exceptions (rule R1) | 0; the list holds 4, each with its reason | `tests/design-css.test.js`, `tests/design-budget.json` |
| Hard-coded spacing, radius and font-size values (rule V1, may only go down) | 0 (`literalBudget` is empty) | `tests/design-budget.json` |
| Colour pairs, light and dark (rule V2) | 79 pairs in each theme, 158 in all (53 at 4.5:1 and 26 at 3:1 in each), all pass; 165 tests in the file | `npx vitest run tests/contrast.test.js` |
| Visual baselines (both apps, phone and computer, light and dark) | 86 pictures: the 68 of 12/10/2026, and 4 for Home (#201), 4 for the account menu (#227), 2 for "saved on the phone" (#226), 8 for the photo (#237) | `ls e2e/__screenshots__/visual.spec.js \| wc -l`, and `git log --diff-filter=A 961a610..6ce5019` over that folder |
| How strict the pictures are | a pixel counts when its colour moved further than 0.01; Playwright's default is 0.2 | `PIXEL_THRESHOLD` in `e2e/visual.spec.js` (owner decision of 14/10/2026, #233) |

The thinnest colour pair in the light theme is the field border on the second surface at 3.07:1 (it needs 3:1); the
thinnest text pair is the success green on its own tint, 4.67:1 (it needs 4.5:1). In the dark theme the thinnest is the
focus ring on the darkest step of the count cells at 3.20:1, a token that no screen draws any more. They were read with a
temporary copy of `tests/contrast.test.js` that logged each ratio. The pictures are compared on the Linux runner only
(`docs/testing.md`), so this pull request's CI, not a laptop, is the check on them; this pull request changes none.

### The size of what a phone downloads

| Part | Bytes (brotli) | Budget | Before (12/10/2026) |
|---|---|---|---|
| Provider app, entry JS | 79,482 | 86,016 | 78,482 |
| Provider app, entry CSS | 4,700 | 5,120 | 4,176 |
| Committee app, chunk JS | 40,069 | 41,984 | 77,792 |
| Committee app, chunk CSS | 5,828 | 5,828 | 9,442 |
| Committee app, lazy chunks JS (the map) | 42,799 | 47,104 | in the chunk above |
| Committee app, lazy chunks CSS (the map) | 5,668 | 6,656 | in the chunk above |
| Precache, total | 322,990 (21 files) | 322,990 (21 files) | 239,776 (16 files) |

`npm run size`, `scripts/check-bundle-size.json`, on an export of the commit with LF line endings (`git archive` with
`core.autocrlf` off), which is what CI builds. The map left the committee chunk for a lazy chunk on 14/10/2026, which is
not part of the redesign: it is why the committee chunk is about half of what it was, and the two lazy rows are new. The
committee app's JavaScript in all is 82,868 (it was 77,792) and its CSS 11,496 (it was 9,442). The budgets that the
redesign raised, each with its reason at the top of its pull request: the provider app's entry CSS from 4,608 to 5,120
(#226), the committee chunk's CSS from 5,632 (set when the map left it) to 5,828 (#231, #234, #235, #237), and the
precache from 256,000 to 322,990 (#223 to #238; its count of files went from 17 to 21, two of them the map's).

**There is no headroom left** in two budgets: the committee chunk's CSS (5,828 of 5,828) and the precache (322,990 of
322,990, 21 files of 21). The next byte of CSS in the committee app, or of a font or an icon, needs a raised budget in a
pull request that says why, or something deleted first.

### The fonts

| File (`assets/rubik-<subset>-wght-normal`) | On disk (bytes) | In the precache (brotli) |
|---|---|---|
| hebrew | 9,348 | 9,336 |
| cyrillic-ext | 12,388 | 12,387 |
| cyrillic | 15,112 | 15,116 |
| latin-ext | 19,400 | 19,398 |
| arabic | 32,468 | 32,472 |
| latin | 35,348 | 35,319 |
| Six files | 124,064 | 124,028 |

Six files cover the four scripts (Hebrew, Latin, Cyrillic, Arabic), and every one is in the precache (D2), so the
provider app reads in its own typeface in Hebrew, English, Russian and Arabic with no network: they are 38.4 percent of
the precache. The rest of the 322,990 bytes: the JavaScript and CSS of the provider app, the committee app and the map
180,496; the three PNG icons 16,308 and the two SVG icons 638; the service worker's small files (the theme script, the
page, the manifest) 1,520. The sizes on disk are from `vite build`, the bytes in the precache are from the precache list
of `dist/sw.js`, read with `precacheUrls` and `sizeOfUrl` of `scripts/check-bundle-size.mjs`; the groups are sums of
those.

### Still not measured

The friction in production and the five sessions with people, as in the first section. The sessions are where the new
look (the icon-only tab bar, the account circle, the "more" menu) would be tried by the people who use it; the script
has no question about them yet.

### Known and not fixed

- On a Windows checkout with `core.autocrlf=true`, `npm run size` measures 323,015 bytes for the precache, 25 over the
  budget, because the working tree has CRLF in `index.html`, the theme script and the SVG icons. CI builds with LF and
  measures 322,990. The numbers above are from the LF export.
- Kept only because a test pinned them, with no screen using them: the count-cell tokens `--w-count-1` to `4` and their
  contrast checks (#228), and the `.a-icon-btn--danger` rules and `tone="primary"` of `IconButton` (#234, #236). Removed
  on 15/10/2026, with the assertions that pinned them: see the last section.
- The new things are not checked on a real iPhone yet: the account circle with and without a photo, the fade behind the
  tab bar and the new icon (`docs/manual-ios-checklist.md`, items 1 and 12, before the next release).
- `docs/design.md` is at its limit of 250 lines (it was 251 after #223). This pull request adds the rules T3, V5 and V6
  and makes room by shortening the entries whose check now exists (V1, V4, F4, R1, R3, T1, T2, D1) and by turning the
  `planned:` checks of F5, T1, T2 and R1 into links to their tests. Two `planned:` checks are still not built: F2 (E2E
  per form) and the contrast of the fixed colours in V2 (the select chevron, `#9a9aa4`, has no contrast test). The next
  rule makes room the same way.
- `.claude/skills/ui-review/SKILL.md` still lists Heebo among the fixed tokens (a skill changes only in its own pull
  request). The `frontend-design` row of `docs/design/sources.md` said that the owner kept the current identity; this
  pull request corrects it.

## 15/10/2026, the code that no screen used is removed (master 286f89c)

Owner decision of 15/10/2026: what stayed only because a test pinned it, with no screen using it, goes together with the
assertions that pinned it. The section above listed it under "Known and not fixed". No picture changes: nothing on a
screen used it (the greps are in the description of the pull request). This pull request changes no behaviour.

### What changed

| What | Before | After |
|---|---|---|
| The `tone` prop of `IconButton` (`src/admin/ui.jsx`), with `.a-icon-btn--danger` and `.a-icon-btn--primary` in `src/admin/admin.css` | three looks: grey, red and a filled round button; no `IconButton` in `src/` passed a tone | one look, the grey icon. Red is only the delete item of a "more" menu, and the add button is the pill |
| The count-cell tokens `--w-count-1` to `4` in `src/ui/ui.css` (both themes) | tokens, with 12 contrast pairs in each theme, of cells that Home stopped drawing in #228 | gone |

### Automated

| What | Value | Command or file |
|---|---|---|
| Colour pairs, light and dark (rule V2) | 80 pairs in each theme, 160 in all (58 at 4.5:1 and 22 at 3:1 in each), all pass; 167 tests in the file. Before this pull request the file had 193 tests: the 12 count pairs and the test that the count steps get deeper went from each theme. The 79 pairs and 165 tests of the section above were counted on 14/10/2026, before the calendar (#247) and the wheels (#253) added theirs | `npx vitest run tests/contrast.test.js` |

The thinnest pair of the dark theme was the focus ring on the darkest count step (3.20:1, in the section above). With the
count cells gone it is the field border on the second surface, 4.28:1 (it needs 3:1), and the thinnest text pair is
`--w-text-3` on the violet tint, 6.23:1. The light theme's thinnest pairs did not change: the field border on the second
surface at 3.07:1 and the success green on its own tint at 4.67:1. They were read with a temporary copy of
`tests/contrast.test.js` that logged each ratio; the copy was taken out again.

### Size

`npm run size` on a Windows checkout (CRLF), on master at 286f89c and with this pull request, brotli, the same machine and the
same command. Only the difference is meaningful here, because CRLF adds bytes (see "Known and not fixed" above).

| Measurement | Before | After | Saved |
|---|---|---|---|
| Provider app, entry JS | 79,772 B | 79,646 B | 126 B |
| Provider app, entry CSS | 4,711 B | 4,686 B | 25 B |
| Committee app, chunk JS | 43,212 B | 43,090 B | 122 B |
| Committee app, chunk CSS | 6,547 B | 6,472 B | 75 B |
| Committee app, lazy chunks JS | 42,801 B | 42,787 B | 14 B |
| Committee app, lazy chunks CSS | 5,668 B | 5,668 B | 0 B |
| Precache, total | 327,190 B | 326,810 B | 380 B |
