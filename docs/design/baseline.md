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
