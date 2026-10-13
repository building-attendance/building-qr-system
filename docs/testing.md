# Testing

The details of running, writing and debugging the tests. The rules that every change follows (the two layers and when to
run each, the throwaway database, the console-error rule, the size budget, what CI requires to merge) are in
[`AGENTS.md`](../AGENTS.md), "Testing". The commands are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#tests) and in the
`scripts` of `package.json`. This page is for when you work on the end-to-end tests, the accessibility baseline, the
icons, CI or the smoke test.

Contents: [Setup](#one-time-setup-on-a-new-machine) | [How an E2E run is set up](#how-an-e2e-run-is-set-up) |
[Running one spec, and reading a failure](#running-one-spec-or-one-project-and-reading-a-failure) |
[Offline tests](#offline-tests) | [Accessibility](#accessibility) | [Visual regression](#visual-regression) |
[Two E2E runs on one machine](#two-e2e-runs-on-one-machine) |
[The icons](#the-icons) | [CI](#ci) | [The smoke test](#the-smoke-test) | [Timing a scan](#timing-a-scan) |
[What is not automated](#what-is-not-automated)

## One-time setup on a new machine

`npm install`, then `npx playwright install chromium webkit` (about 350 MB).

## How an E2E run is set up

- E2E uses ports 3100 (preview of the production build) and 3101 (API) and the scratch schema `e2e`, seeded by
  `scripts/dev-seed.mjs`. Playwright starts both servers (`playwright.config.js`); the schema is dropped before every run
  and again after it (`e2e/global-teardown.js`), so a run that was killed leaves a schema that the next run clears.
  These are the defaults: `E2E_APP_PORT`, `E2E_API_PORT` and `E2E_SCHEMA` change them (`scripts/e2e-config.mjs`, and the
  section on two runs below). Nothing may already be listening on the ports of a run.
- The PWA is tested on the production build, because the service worker only exists there. Do not point the E2E at `vite dev`.
- `vite preview` sends the headers of `vercel.json`, the Content-Security-Policy included (`vite.config.js`), so a page
  that breaks the policy in a tested flow fails its test with a console error. The dev server sends none, because Vite's
  own development scripts would break the policy.

## Running one spec or one project, and reading a failure

A single spec or project: `npx playwright test e2e/pwa.spec.js --project=android-chrome`. A failing run keeps a trace
in `test-results/` (`npx playwright show-trace <trace.zip>`).

## Offline tests

The offline tests run on `android-chrome` only: Playwright's WebKit cannot take a service-worker page offline.

## Accessibility

`e2e/a11y.spec.js` scans the screens of both apps with axe (WCAG 2.1 A and AA, the WCAG 2.2 AA target size, rule T1 of
`docs/design.md`, and axe's best practices, light and dark)
through `expectNoA11yViolations` in `e2e/fixtures.js`. A new screen or dialog gets a scan there. A problem that is a design
decision goes in `e2e/a11y-baseline.js` with its reason, matched exactly (screen, rule, element); an entry that no longer
occurs, or names a screen that is not scanned, fails. Fix a violation rather than baseline it.

## Visual regression

`e2e/visual.spec.js` takes a picture of the key screens and compares it with the baseline image in
`e2e/__screenshots__/visual.spec.js/` (`name.png`; 72 files, about 140 KB at most each). It is there to catch design drift
that no behaviour test sees, and to show the owner the exact image diff of every intended change to a screen. It covers,
each in the light and the dark theme:

- the provider app in Hebrew: the sign-in list, the password screen, home with a visit, "recorded" and "too far", and in
  English (left to right) and Arabic (right to left): the sign-in list and home, on a 390 px phone;
- the committee app in Hebrew, at 360 px and at 1280 px: Home (a fixed week of invented visits, `stubHome`, with the clock at ten in the
  morning of its last day, so that the greeting is always the same) and the seven other screens (history, points, providers, agent,
  settings, audit log and help), the history of a building with no points, the dialog of a point (with the map) and the dialog
  of a provider; and the sheet that the "More" button of the phone's tab bar opens (at 360 px, and at 768 px, the widest
  screen that has the tab bar: a computer has the side rail instead);
- the filters of the History tab below 1024 px: the sheet that its filter button opens (with the defaults), at 360 px and at 768 px, where it
  stays at the bottom of the screen like the sheet under "More", and, at 360 px only, the tab with filters on, which has a chip for each
  (from 1024 px the filters are the block above the list, which the picture of the tab shows).

**It runs in CI only.** The baselines are made on the Linux runner, in Chromium (the `android-chrome` project): another
system draws text a little differently, so a baseline from a laptop would never match. On anything else (WebKit, Windows,
macOS) the spec skips itself, and `snapshotPathTemplate` in `playwright.config.js` leaves the platform out of the file names
for that reason. `VISUAL_ANY_OS=1` lifts the condition, to check that the spec itself still runs on another system: what it
writes there is not a baseline, so delete it and never commit it.

**What keeps the pictures the same** is written at the top of the spec. The clock stands still, animations are off, the
map's tiles are one fixed picture, the committee screens start from a known state (`prepareCommittee`), and everything that
depends on the real date, the real time or the build is masked (the pink boxes): every date and time, the date fields of
the History tab, the build label, and the codes of the Agent tab. A new screen with a date or a time on it needs no mask of
its own (the text pattern finds it); a new kind of changing text does, in `dynamicRegions`. The thresholds are Playwright's
defaults (no pixel may differ). Keep each image under about 150 KB.

**Sign in as little as possible in this spec.** The server counts every sign-in of a run from one address, a correct password
included (`guardLogin` in `server/auth.js`: 60 in 15 minutes), and the other specs of the job use 48 of them. A failing
picture also restarts the worker, and with it the setup of the tests after it. So the spec signs a provider in once, switches
the language on the screen instead of signing in again, and sets the committee's screens up through the API (the visits of the
History tab are a fixed list, `stubHistory`). A test that signs in again can push the run into `429 too_many_attempts`.

**After an intended change to a screen**, CI fails on the pictures that changed (and on a screen with no baseline yet), and
keeps what it took:

1. `gh run download <run-id> -n playwright-android-chrome -D <a new empty folder>`. The `*-actual.png` files are in
   `test-results/`, one folder per test.
2. Copy each `<name>-actual.png` that you meant to change over `e2e/__screenshots__/visual.spec.js/<name>.png`, and
   commit. A picture that changed and that you did not mean to change is the bug that this test found.
3. The owner reviews the image diff of every changed baseline in the pull request (GitHub shows PNG files side by side
   and as a swipe). So the description says which screens changed and why: a baseline that is added, changed or deleted
   without that is a P1 finding in the code review (`AGENTS.md`, Code Review Rules). Check that each new image shows the
   whole screen (no spinner, nothing half loaded) before you commit it.

## Two E2E runs on one machine

Two E2E runs can share a machine when each has its own app port, API port and scratch schema: `E2E_APP_PORT`,
`E2E_API_PORT` and `E2E_SCHEMA` (defaults 3100, 3101 and `e2e`; the rules for the values are in `scripts/e2e-config.mjs`).
Give a second run a different value for all three, for example
`E2E_APP_PORT=3200 E2E_API_PORT=3201 E2E_SCHEMA=e2e_b npx playwright test --project=iphone-webkit`; a run with another
schema keeps its build and report under `node_modules/.cache/bqr-e2e/<schema>`. Runs that share a port are refused by the
second one at once, but runs that share only a schema are not: each drops the other's data, and the seed starts before
the ports bind, so a free port does not prove that no run is starting. Never share a schema.

## The icons

iOS ignores an SVG as the Home Screen icon, so the PNGs in `public/` (`apple-touch-icon.png` 180x180 on a solid
background, `pwa-192x192.png`, `pwa-512x512.png`, and `pwa-maskable-512x512.png`, the artwork inside the centre 80 percent
on a solid background, which Android crops to its own shape and which is not precached) are made from
`public/pwa-512x512.svg` by `npm run icons`. To change the logo, replace that SVG, run `npm run icons`, commit the PNGs.
`tests/pwa-icons.test.js` and the icon tests in `e2e/pwa.spec.js` check them.

## CI

`.github/workflows/ci.yml` has the four checks that are required to merge (`guards`, `unit`, `e2e (android-chrome)`,
`e2e (iphone-webkit)`), and its header lists what `guards` covers. The guards that protect the history of the project
are `scripts/check-migrations.mjs` (a migration is a new file only, and destructive SQL carries a `-- contract: <reason>`
line) and `scripts/check-tests.mjs` (a test is not deleted, renamed away or skipped). They catch the common ways of
breaking those rules; they are heuristics, not a replacement for reading the diff. The rules about removing a test and
about the size budget (`npm run size`, `scripts/check-bundle-size.json`) are in [`AGENTS.md`](../AGENTS.md), "Testing".

The unit tests and each E2E project run in parts side by side, each part a job with its own Postgres container that runs
its share of the tests (`--shard`): `unit` in 2 parts (`ci.yml`), Chromium in 2 and WebKit in 4 (`.github/workflows/e2e.yml`,
called by `ci.yml`). Each required check (`unit`, `e2e (android-chrome)`, `e2e (iphone-webkit)`) is a small job that
passes only when every one of its parts passed. A failed part shows as `unit part <n>` or `e2e (<project>) part <n>`; the
HTML report and the traces of a failed E2E part are the artifact `playwright-<project>-part-<n>`. To run one part on your
machine, give the same option: `npx vitest run --shard=1/2`, `npx playwright test --project=iphone-webkit --shard=2/4`.

On CI, Playwright retries a failed test once and then fails the run anyway (`failOnFlakyTests` in `playwright.config.js`).
The retry only tells the two cases apart in the report: a test that failed twice is broken, and a test that passed on its
retry is flaky. A flaky test is fixed, not rerun until it is green: a check that is allowed to fail now and then teaches
everyone to ignore it.

## The smoke test

`.github/workflows/smoke.yml` is not a merge check: it runs after each production deployment (`scripts/smoke-check.mjs`
against the address in the variable `SMOKE_BASE_URL` of the GitHub environment `smoke`, the production domain; a run
without the variable fails and says so) and opens an issue labelled `bug` when the deployment is broken
([`deploy-and-rollback.md`](runbooks/deploy-and-rollback.md), "The smoke test after a deploy"). The variable decides where
the secret `SMOKE_AGENT_KEY` is sent, so it lives in an environment, whose variables only the owner of a personal
repository (an admin of an organization's) can change, and never in a repository variable, which any collaborator can.

## Timing a scan

`npm run perf:scan` measures how long the service provider's scan takes on a phone, so that "faster" or "slower" is a
number and not a feeling. It is a measurement, not a test: CI never runs it (a shared runner's timings are noise), and
`tests/perf-scan.test.js` keeps it out of the E2E run. It reuses the E2E setup (`playwright.perf.config.js`: the
production build, the API, a scratch schema with the sample data) on its own ports (3700, 3701) and schema (`perf`), and
needs the same `.env.local` as the unit tests.

Three journeys, at the sample point that requires the location (every point of a real building does), 10 runs each:

- **Daily scan:** a provider who signed in on this phone before opens the scan link, until the heading "the visit was
  recorded". The service worker serves the app; only the API goes to the network.
- **First scan on a new phone:** a browser that never opened the app, until the list of names appears (the person can act),
  then from the tap on "sign in" to "recorded".
- **No reception:** the daily scan with the network off, until "saved on the phone".

Each runs in two profiles: **Slow 4G and CPU x4** (the network numbers of Lighthouse's mobile profile: 150 ms, 1.6 Mbps down,
750 kbps up, "roughly the bottom 25% of 4G connections", applied by the Chrome DevTools Protocol to every request; and
Lighthouse's default CPU slowdown for a mid-tier phone), and **no throttling**, for reference. A time is taken inside the
page (`performance.now()` when the heading comes into the DOM), not by Playwright's polling. The run prints the median and
the p95 of each journey, its requests and the bytes that crossed the network, and compares each median with
`scripts/perf/scan-baseline.json`; a median more than 20% slower is marked `OVER THE 20% LINE`. `PERF_RUNS` changes the
number of runs. The run never writes the baseline.

**When to run it:** before and after a change to the provider app's scan flow, the service worker or the PWA files, or
anything that the provider app downloads. Put the two lines that matter in the pull request. A median over the 20% line in
two runs in a row is a regression and needs a reason there; once over the line is a reason to run it again, not a finding.

**A new baseline:** `npm run perf:scan:baseline`, committed only with the change that explains it. It is the same run,
then `scripts/perf/baseline.mjs`, joined with `&&`: the baseline is written only when Playwright exited 0, that is after
every journey passed and every fixture was torn down (the E2E page fixture fails a test for a console error at teardown,
after the test's own hooks, so the run itself cannot tell). Even then the script refuses, and says why, a run with fewer
than 10 runs, a journey with fewer samples or none, or a run of another commit than the checkout's.

**How to read it:** compare runs of one computer only (the baseline names the computer that measured it), with nothing heavy
running beside it: the CPU slowdown multiplies whatever the computer is doing. The noise is real: on 13/10/2026 two runs of
the same commit on the baseline's computer differed by up to 28% in a median, which is why one run over the line proves
nothing.

**What it cannot show:** the GPS of a real phone (the browser here answers at once), the time of the server on Vercel and
Neon (the API runs on this computer, and the latency of the profile stands for the distance), and Safari (WebKit has no
throttling): the iPhone is still checked by hand ([`manual-ios-checklist.md`](manual-ios-checklist.md)).

## What is not automated

Home Screen install, standalone mode, the status bar, offline use on a real iPhone, push. Check them by hand with
[`manual-ios-checklist.md`](manual-ios-checklist.md) before a release that touches the PWA files, the layout or the
location flow.
