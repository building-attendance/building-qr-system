# Testing

The details of running, writing and debugging the tests. The rules that every change follows (the two layers and when to
run each, the throwaway database, the console-error rule, the size budget, what CI requires to merge) are in
[`AGENTS.md`](../AGENTS.md), "Testing". The commands are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#tests) and in the
`scripts` of `package.json`. This page is for when you work on the end-to-end tests, the accessibility baseline, the
icons, CI or the smoke test.

Contents: [Setup](#one-time-setup-on-a-new-machine) | [How an E2E run is set up](#how-an-e2e-run-is-set-up) |
[Running one spec, and reading a failure](#running-one-spec-or-one-project-and-reading-a-failure) |
[Offline tests](#offline-tests) | [Accessibility](#accessibility) |
[The page of the shared components](#the-page-of-the-shared-components) | [Visual regression](#visual-regression) | [The pictures of the UI review](#the-pictures-of-the-ui-review) |
[Two E2E runs on one machine](#two-e2e-runs-on-one-machine) |
[The icons](#the-icons) | [CI](#ci) | [The smoke test](#the-smoke-test) | [Timing a scan](#timing-a-scan) |
[Timing the committee and agent API](#timing-the-committee-and-agent-api) |
[Timing the committee's screens](#timing-the-committees-screens) | [What is not automated](#what-is-not-automated)

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

## The page of the shared components

A shared component of the committee app can be tested in a real browser before any screen uses it, and without the screens
around it: `e2e/harness.js` builds the page in `e2e/harness/` with Vite (the app's own CSS and components, outside the app's
build, into the run's cache folder; about a tenth of a second) and the test's page serves it to itself at `/__harness/`
(`page.route`, so no server or port is added; the spec blocks service workers, as `e2e/a11y.spec.js` does). The page holds a
card with the "more" menu (`Menu` in `src/admin/ui.jsx`), a box that clips, a tile at the bottom of the screen, every button,
chip and field, and a dialog and a sheet; `?dir=ltr` lays it out left to right, and the theme follows the device. What jsdom
cannot show is tested there: `e2e/components.spec.js` (the keys of the menu as the browser handles them, where it stands on the
screen, the dialog at both widths) and the scans of the open menu in `e2e/a11y.spec.js`.

## Visual regression

`e2e/visual.spec.js` takes a picture of the key screens and compares it with the baseline image in
`e2e/__screenshots__/visual.spec.js/` (`name.png`; 90 files, about 140 KB at most each). It is there to catch design drift
that no behaviour test sees, and to show the owner the exact image diff of every intended change to a screen. It covers,
each in the light and the dark theme:

- the provider app in Hebrew: the sign-in list, the password screen, home with a visit, "recorded", "too far" and "saved on the
  phone" (the server cannot be reached, so the visit goes into the phone's queue), and in
  English (left to right) and Arabic (right to left): the sign-in list and home, on a 390 px phone;
- the committee app in Hebrew, at 360 px and at 1280 px: Home (a fixed week of invented visits, `stubHome`, with the clock at ten in the
  morning of its last day, so that the greeting is always the same) and the seven other screens (history, points, providers, agent,
  settings, audit log and help), the history of a building with no points, the dialog of a point (with the map) and the dialog
  of a provider; the sheet that the "More" button of the phone's tab bar opens (at 360 px, and at 768 px, the widest
  screen that has the tab bar: a computer has the side rail instead); and the account menu, open (the popover of the phone's top bar at
  360 px, the one of the side rail's button at 1280 px); and the member's Google photo, a fixed made-up picture of four coloured
  squares (`stubMemberPhoto` in `e2e/fixtures.js`, never a person and never Google): Settings, where it fills the account circle and
  the member's card, and the account menu, open, at 360 px and at 1280 px (every other picture shows the member's initial);
- the filters of the History tab below 1024 px: the sheet that its filter button opens (with the defaults), at 360 px and at 768 px, where it
  stays at the bottom of the screen like the sheet under "More", and, at 360 px only, the tab with filters on, which has a chip for each
  (from 1024 px the filters are the block above the list, which the picture of the tab shows);
- the date picker, open, with the clock fixed at `HOME_NOW` so that the month, today and the default week are always the same, for the
  first date field of the History tab: at 360 px the wheels of a phone (the year, the month and the day), a sheet over the sheet of
  filters, and at 1280 px the calendar, a popover beside its field.

**It runs in CI only.** The baselines are made on the Linux runner, in Chromium (the `android-chrome` project): another
system draws text a little differently, so a baseline from a laptop would never match. On anything else (WebKit, Windows,
macOS) the spec skips itself, and `snapshotPathTemplate` in `playwright.config.js` leaves the platform out of the file names
for that reason. `VISUAL_ANY_OS=1` lifts the condition, to check that the spec itself still runs on another system: what it
writes there is not a baseline, so delete it and never commit it.

**What keeps the pictures the same** is written at the top of the spec. The clock stands still, animations are off, the
map's tiles are one fixed picture, the committee screens start from a known state (`prepareCommittee`), and everything that
depends on the real date, the real time or the build is masked (the pink boxes): every date and time, the date fields of
the History tab, the build label, and the codes of the Agent tab. A new screen with a date or a time on it needs no mask of
its own (the text pattern finds it); a new kind of changing text does, in `dynamicRegions`. The one exception is the filters
sheet at 360 px, whose two date fields in one row are what its picture is for: it is taken with the clock at `HOME_NOW`, so
its dates cannot change, and with `datesFixed`, which leaves them unmasked. Keep each image under about 150 KB.

**How strict it is.** A pixel counts as different only when its colour moved further than `PIXEL_THRESHOLD` in the spec (a
YIQ distance, from 0 for any change to about 0.97 for black against white), a pixel that pixelmatch takes for the
anti-aliasing of an edge never counts, and a picture fails on one pixel that counts. Playwright's default threshold, 0.2,
is far looser than it sounds: the amber circle of #226 changed from `#8A3E05` to `#B4530A` and the job still passed with
the old baseline. The top of the spec explains the scale and how the value was measured; the value, 0.01, is the owner's
decision of 14/10/2026, and changes only with the owner.
A picture that fails on a few pixels at the edge of a curve, with no change to the screen behind it, is rendering noise and
not a design change: do not copy it over the baseline, report it, since it is evidence about the threshold.

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

## The pictures of the UI review

`npm run ui-review:pictures` takes the pictures that step 3 of the `ui-review` skill asks for: every screen of both apps on
worst-case fake data, in the languages, themes and widths that the apps run in. It is a helper and not a test. CI never
runs it, it checks nothing, and its pictures are never committed: they are not baselines, and the README pictures and the
visual baselines above change only on purpose, with the owner looking at each one. It needs the same `.env.local` as the
unit tests (a local PostgreSQL is the fastest) and `npx playwright install chromium`.

- **The data** is in its own schema, `ui_review`, and changes nothing that the other tools read. `scripts/ui-review/seed.mjs`
  runs the dev seed in that schema, then renames some of its rows to the worst case of `scripts/ui-review/worst-case.mjs`
  and adds a few: the building's name and address at the longest the server accepts (80 and 200 characters), providers
  with long names in Hebrew and in Russian and one with a single long word, a point with a long name, the longest
  description and a long service name, a committee member with a long name and a long e-mail, one agent key alone in its
  list, a day with one visit and a provider with exactly one. The other rows stay as the dev seed made them, so every list also
  has ordinary rows. `tests/ui-review.test.js` checks the values against the limits of `shared/contract.js`. The shared
  sample data (`scripts/sample-data.mjs`, `scripts/dev-seed.mjs`) is not changed.
- **What it takes:** the provider app at 390 px in Hebrew, English, Russian and Arabic, light and dark (the sign-in list, the
  password screen, the check-in recorded, the home with a visit, and the visit saved on the phone), then the committee app
  at 360 px and at 1280 px, light and dark (the eight screens, the account menu, and the "more" menu of the card with the
  longest name), and then an empty building (the seed with `--empty`, which makes the schema again): the sign-in list with no
  provider, and Home, History, Points, Providers, Agent, the audit log and Settings. A run also prints a note for a
  picture whose page scrolls sideways, and for a console error of the app (neither fails the run).
- **Where the pictures go:** `UI_REVIEW_OUT`, or the folder `ui-review-pictures/` that `.gitignore` covers. A folder inside the
  project is refused unless it is under `ui-review-pictures/` or `node_modules/`, so that a picture can never land among the
  tracked files. The run does not empty the folder: a picture is written again, and one from an earlier run stays. The end of the
  run says where the pictures went and how many this run wrote.
- **A narrow run:** `npm run ui-review:pictures -- --grep providers` takes the pictures of the tests whose title has the words (the
  title is made of "provider app", "committee app, 360 px" or "committee app, 1280 px", "empty building", and the name of the
  screen). The build and the seed run anyway.
- **Ports and schema:** 3400 and 3401, and the schema `ui_review`, which the run drops before and after it (as the E2E run does, in
  `e2e/global-teardown.js`; a run that was killed leaves one that the next run clears). A second run on the same machine takes its
  own `UI_REVIEW_APP_PORT`, `UI_REVIEW_API_PORT` and `UI_REVIEW_SCHEMA`, all three different (the schema is never one of another
  tool's: `scripts/ui-review/settings.mjs`). It refuses to run against anything but `http://localhost` or `http://127.0.0.1`.
- **A break that it shows is a finding,** reported with the name of its picture. The helper does not fix the app.

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
The icon is the app's primary violet (`BRAND` in `scripts/make-icons.mjs`) with white drawn straight on it, no tile.
The script writes each PNG again, smaller, with `scripts/png.mjs` (an indexed PNG when the picture has 256 colours or fewer,
otherwise truecolor with better filtering and compression) and keeps the new file only when reading it back gives the same
RGBA values as Chromium's picture, pixel for pixel. It never reduces the colours: `tests/png.test.js` pins that.
`tests/pwa-icons.test.js` and the icon tests in `e2e/pwa.spec.js` check them: the colour, and that every pixel of the maskable
icon that is not the background lies inside the centre circle of 80 percent of the width.

## CI

`.github/workflows/ci.yml` has the four checks that are required to merge (`guards`, `unit`, `e2e (android-chrome)`,
`e2e (iphone-webkit)`), and its header lists what `guards` covers. The guards that protect the history of the project
are `scripts/check-migrations.mjs` (a migration is a new file only, and destructive SQL carries a `-- contract: <reason>`
line) and `scripts/check-tests.mjs` (a test is not deleted, renamed away or skipped). They catch the common ways of
breaking those rules; they are heuristics, not a replacement for reading the diff. The rules about removing a test and
about the size budget (`npm run size`, `scripts/check-bundle-size.json`) are in [`AGENTS.md`](../AGENTS.md), "Testing".

The unit tests and each E2E project run in parts side by side, each part a job with its own Postgres container that runs
its share of the tests: `unit` in 2 parts (`ci.yml`), Chromium in 3 and WebKit in 4 (`.github/workflows/e2e.yml`,
called by `ci.yml`). Each required check (`unit`, `e2e (android-chrome)`, `e2e (iphone-webkit)`) is a small job that
passes only when every one of its parts passed. A failed part shows as `unit part <n>` or `e2e (<project>) part <n>`; the
HTML report and the traces of a failed E2E part are the artifact `playwright-<project>-part-<n>`. To run one part on your
machine, as CI does: `npx vitest run --shard=1/2`; for an E2E part, `node e2e/parts.js --project=iphone-webkit --part=2
--parts=4 --out=part.txt` (it prints which files each part gets), then `npx playwright test --project=iphone-webkit
--test-list=part.txt`.

The E2E files are split by time, not by count: `e2e/parts.js` takes the project's full list of test files from
Playwright (`--list`), sorts it by the seconds of each file in `e2e/part-weights.json`, and gives each file to the part
that has the fewest seconds so far, so every file runs in exactly one part, and a part that would get no file fails. A
new file with no weight counts as the median file. The weights are the seconds of each file in a green CI run, because a
local run is not the same: `e2e/visual.spec.js` runs only on Linux, so on Windows or macOS it takes no time at all. They
only decide which files share a part, so a small change needs no update. Every part keeps its timings as the artifact
`timings-<project>-part-<n>` (7 days, the JSON report of `playwright.config.js` on CI). When the parts drift apart (one
part is clearly the longest), take the timings of a green run of `master` and write the weights of each project:
`gh run download <run id> --pattern "timings-iphone-webkit-*" --dir timings-webkit`, then
`node e2e/parts.js --weights --project=iphone-webkit --report=timings-webkit`, and the same for `android-chrome`.

The unit tests are split the same way, through a Vitest sequencer (`tests/time-sequencer.js`, set in `vitest.config.js`):
`--shard` hands it every test file, and each part keeps its share by the weights of the project `unit` in
`e2e/part-weights.json` (a file under `tests/` by its path, `tests/<file>`). `npx vitest run --shard=1/2` runs the same
part on your machine. Their timings are the artifacts `timings-unit-part-<n>` (Vitest's JSON report), and their weights
are written the same way: `gh run download <run id> --pattern "timings-unit-*" --dir timings-unit`, then
`node e2e/parts.js --weights --project=unit --report=timings-unit`.

On CI, Playwright retries a failed test once and then fails the run anyway (`failOnFlakyTests` in `playwright.config.js`).
The retry only tells the two cases apart in the report: a test that failed twice is broken, and a test that passed on its
retry is flaky. A flaky test is fixed, not rerun until it is green: a check that is allowed to fail now and then teaches
everyone to ignore it.

## Auto-merge of tests and docs

`.github/workflows/auto-merge.yml` decides, after every CI run and after every comment of the Codex review bot, whether a
pull request may merge without the owner's click. The class is narrow: a `test` or `docs` title, opened by the owner from
a branch of this repository that is not `claude/` or `codex/`, with only added or modified component tests
(`tests/components/`), E2E tests and documents, every commit by a person's GitHub account (committed by that person, or by
GitHub's `web-flow` for the "update branch" merge) with no Codex co-author, and clean in every way: the four checks green
on the head, a Codex review of exactly that head with no finding, every conversation resolved, no `allow-test-removal`
label, and the branch up to date (AGENTS.md, "Git and pull requests"). The other tests under `tests/` (the server,
security, privacy and repository-guard tests) stay out, and so do some files under `e2e/` and `docs/` (the visual
baselines, the files that every test runs with, the rules, the privacy record, the decision records, the runbooks, the
design rules). The conditions are `scripts/check-auto-merge.mjs`, with a test for each in `tests/check-auto-merge.test.js`.

For now it is a dry run: on an open, ready pull request with a test or docs title it writes one comment per head commit,
"would merge" or "would not merge" with the reasons, and edits that comment when the decision for the same commit
changes; every other pull request gets the decision in the summary of the run only. It decides again only on those two
events, so a conversation resolved after the last of them is seen at the next CI run or Codex comment. To keep a pull
request from merging once it is live, keep it a draft or leave a conversation open. The App that will merge, its key, and
how to switch it off are in [`.github/rulesets/README.md`](../.github/rulesets/README.md), "The auto-merge App".

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

## Timing the committee and agent API

`npm run perf:api` measures how long the committee's screens and the committee's agent wait for the API on a year of data.
Scans, refused visits and the audit log are never deleted, so a query that reads them "since ever" gets slower every year;
this shows it on invented data first. Like the scan timing it is a measurement, not a test: CI never runs it.
`tests/perf-api.test.js` and `tests/perf-year-data.test.js` check what it is made of. It needs the same `.env.local` as
the unit tests; a local PostgreSQL gives numbers that can be compared, a remote database mostly measures the network.

**The data** (`scripts/perf/year-data.mjs`), in two sizes, each made fresh in the scratch schema `perf_api`:

- **x1, a real building's year:** 25 points (2 switched off), 10 service providers (one of them the demo account), 3
  committee members, about 40 visits a day over the 365 building days that end yesterday (about 14,600, more on Sunday
  to Thursday, few on Saturday), refused visits about 5% of that, about 1% voided (each with its `scan.void` entry), a
  few of the demo account, 3,000 audit entries, and an agent key that asked once every 5 minutes for 90 days.
- **x10:** ten times the visits, the refused visits and the audit entries: a big building, or several years.

Every value is invented, and the same day makes the same rows. The generator refuses a name that is not a scratch schema
or that belongs to another tool (`dev_ui`, `e2e`, `perf`, `screenshots`), refuses a database that is marked production
before its first write, drops only a schema that it made itself (it marks it), and writes only on a connection whose
search path is that schema alone. `node scripts/perf/year-data.mjs <schema> [--scale=1|10]` makes one by hand,
`--drop` removes it.

**What it measures:** for each size, the local API (`server/dev.mjs`) on its own port (3711), signed in with its
development shortcut, and every GET route that a committee screen opens, with the filters that the screen sends (the
History list as it opens, "load more", one point, one provider, a whole year, "not counted", the Excel export of a year;
the audit log as it opens and with each filter; Home, Points, Providers, Agent, Committee), then every route of the agent
API (the scans, the counts of 366 days by each grouping, the refused visits, the audit log, the documents), each with a key
of its own so that none comes near the limit of requests per minute. Each route is called 20 times after one warm-up, one
request at a time, from the request to the last byte of the answer. Then each route is called once more inside the run's
own process, through the app's router, to see which statements it runs, and each statement that reads is run again
under `EXPLAIN (ANALYZE, BUFFERS)` in a read-only transaction. The schema is dropped at the end (`--keep` leaves it).

**How to run it:** `npm run perf:api` (both sizes, a few minutes). `npm run perf:api -- --scale=1` runs one size,
`--runs=5` a quick try, `--port=<port>` another port. The run is written to
`node_modules/.cache/bqr-e2e/perf/last-api-timing.json`, and its tables in Markdown, for a pull request, next to it
(`last-api-timing.md`). A new baseline: `npm run perf:api:baseline`, committed with the change that explains it; it is the
same run, then `--promote`, joined with `&&`, and it refuses a run of one size, a run with fewer than 20 calls of a route,
a route that did not answer 200 every time, a run of another commit, and a run of a checkout with uncommitted changes.

**How to read it:** one table for each size. `median` and `p95` are in ms. `target` is the p95 that was set before the
first measurement (13/10/2026): 300 ms at x1 and 1 s at x10 for a route, 5 s for the Excel export of a year, on this
computer, so that Vercel and Neon, which are slower, still have room. `rows` is what the answer holds, `stmts` how many
statements the route ran (the guard of the committee or of the key apart), and `rows read` how many rows those
statements read from the tables that grow (scans, refused visits, the audit log, the agent keys' minutes), from the plan.
`baseline` is the median of `scripts/perf/api-baseline.json` and the change. The notes say `OVER TARGET`, `OVER THE 20%
LINE` (a median more than 20% and more than 1 ms slower than the baseline), `reads scans 100%` (the route reads at least
half of a table that grows, whatever the index: it gets slower as that table grows), `full scan of` a table that grows,
and an export that was cut at its limit. The plans of those routes are printed under the table, one line per node of
the plan, with its rows, its loops and its time. Compare runs of one computer only; a median over the line once is a
reason to run it again, twice in a row is a regression.

**What it cannot show:** the time of Vercel and of the production database (the database here is on this computer, and
production's is far smaller) and the network of a phone. The numbers compare a change before and after on one computer;
the plan is the evidence that does not depend on the computer, so a query that is fixed gets a unit test of its plan,
which CI runs.

## Timing the committee's screens

`npm run perf:screens` measures how long each screen of the committee app takes to show its content on a year of data, on a
phone and on a computer. It is the third timing, after the scan and the API, and like them a measurement and not a test: CI
never runs it (a shared runner's timings are noise), and `tests/perf-screens.test.js` checks what it is made of and that
nothing else runs it. It needs the same `.env.local` as the unit tests; a local PostgreSQL gives numbers that can be
compared. A run takes about 10 minutes (the build, the data, then the visits on both devices).

**How it is set up:** `playwright.screens-perf.config.js` reads `playwright.config.js` as the scan timing does (the production
build and its preview, the API, the time zone), on its own ports (3720, 3721) and schema (`perf_screens`). The API starts on
the year of data of `scripts/perf/year-data.mjs` at x1 (the data of the section above), not on the dev seed. The schema is
dropped at the end, and only because the generator made it (`scripts/perf/screen-teardown.mjs`). The browser part is
`scripts/perf/screen-timing.playwright.mjs`; the screens, the targets, the numbers, the report and the baseline step are
`scripts/perf/screen-report.mjs`, which has no browser in it and is what the unit tests import. The spec is not called
`*.spec.mjs` on purpose: `playwright.perf.config.js` runs every `*.spec.mjs` of `scripts/perf`, and the scan timing must not
run this.

**What it measures:** two devices, both Chromium (WebKit has no throttling):

- **A phone:** a Pixel 7 screen with Slow 4G (150 ms, 1.6 Mbps down, 750 kbps up) and CPU x4: the profile of the scan timing,
  and the test keeps the numbers equal.
- **A computer:** a 1280 x 720 window with no throttling: the speed of the machine that measures.

On each device a committee member of the generated data signs in once with the development shortcut of the local server, with no
throttling, and the service worker takes the page over, as it does for a member who has used the app before. Then, for each
screen below, one visit that is not counted (it also checks that the screen shows the year of data, so a screen that loaded
empty fails the run) and 10 visits (`PERF_RUNS` changes the number): `about:blank`, then a fresh navigation to the screen, so
that nothing of the last visit is left, not even the committee app's memory of its last answers. A time is taken inside the page
with `performance.now()`: from the start of the navigation to the moment the screen's content is in the DOM (a MutationObserver
sees it, so Playwright's polling adds nothing). That is the time of the DOM, a frame before the pixels. The screens, each with
the element that means "loaded", read from its component in `src/admin/views/`:

- **home:** the heading of the summary card.
- **history:** the History as it opens, the last 7 days: the first day heading of the list (100 visits).
  **history_more:** "load more" once, from the click until the next 100 rows are in the list.
  **history_refused:** the type "not counted" (a link opens it), the refused visits of the last 7 days: the first day heading.
  **history_csv:** the Excel export of a year, from the click until the file is on the disk. On the phone the DevTools network
  conditions do not slow Chromium's download manager (a 3.4 MB file took 0.3 s on both devices), so there the page asks for the
  address of the link itself and reads the answer to the last byte.
- **points, providers, agent:** the heading and the first card. **settings:** the first member card and the field of the
  building's name (it comes with a request of its own). **audit:** the audit log with no date, the first day heading (50 entries).
- **help:** the guide has no data, so it shows what the shell alone costs (the app's code, who is signed in, the first draw).

Where the time went is read from the Resource Timing of the page, in four parts: **code** (from the start to the app's first request:
its code loaded from the service worker, parsed and run), **boot** (from there to the end of the two requests that every screen waits
for, who is signed in), **data** (from there to the end of the requests that the screen's content waits for) and **draw** (from
there to the content in the DOM: the browser's own work). They are medians, so they add up to the median only about.

**Targets** (set before the first measurement, 13/10/2026, D3 of the plan): the p95 of a screen at x1 is within 1 s on the computer
and within 2.5 s on the throttled phone, and the Excel export of a year within 5 s on the computer. The export has no target on the
phone (the table shows "-"): the file is about 3.4 MB, which the throttled 1.6 Mbps takes about 17.5 s to receive whatever the
server does, so the time is bound by the bandwidth and says nothing about the app; its note gives the size and the bandwidth.
With 10 visits the p95 is the slowest visit, so the notes say `OVER TARGET (the median too)` when the median is over as well, and
when it is not they say how many visits were over and which one was the slowest (`the slowest is visit 7`; visit 1 is the first
after the warm-up, a cold start): a slow first visit, or one visit that went slow by itself, is a reason to run it again, and a
median over the target is a finding. The visits are in the run file in the order they were made (`samples`).

**How to run it:** `npm run perf:screens`. `PERF_RUNS=3 npm run perf:screens -- --grep phone` is a quick try of one device (a
partial run can never become the baseline). The run is written to `node_modules/.cache/bqr-e2e/perf/last-screen-timing.json`, and
its tables in Markdown, for a pull request, next to it (`last-screen-timing.md`). **A new baseline:** `npm run perf:screens:baseline`,
committed with the change that explains it. It is the same run, then `scripts/perf/screen-report.mjs --promote`, joined with
`&&`: the baseline is written only when Playwright exited 0, and the script refuses, and says why, a run with fewer than 10 visits
of a screen, a screen missing on a device, a run of another commit than the checkout's and a run of a checkout with uncommitted
changes (so commit the code first, run the baseline from the clean checkout, and commit the baseline after).

**How to read it:** one table for each device. `median` and `p95` are in ms, `target` is the p95 that was set before the first
measurement, `req` and `KB` are the requests that finished and the bytes that crossed the network, and `baseline` is the median
of `scripts/perf/screen-baseline.json` and the change. A median more than 20% and more than 10 ms slower than the baseline is
marked `OVER THE 20% LINE`. Compare runs of one computer only (the baseline names the computer that measured it), with nothing
heavy running beside it: the CPU slowdown multiplies whatever the computer is doing. A median over the line once is a reason to
run it again, twice in a row is a regression.

**What it cannot show:** the time of Vercel and Neon (the API and the database run on this computer, and the latency of the
profile stands for the distance), a first visit with an empty cache (the app's code is then downloaded: the scan timing's first
scan shows what that costs for the provider app), the answers of the real building (a year of invented data), Safari (WebKit has
no throttling: the iPhone is checked by hand, [`manual-ios-checklist.md`](manual-ios-checklist.md)) and a real phone's processor
(CPU x4 stands for a mid-tier one). The local setup does not compress its answers (they carry no `content-encoding`), so the
bytes of a screen, and above all of the export (about 3.4 MB for a year of visits, which the phone's 1.6 Mbps takes about 18 s to receive), are the
uncompressed sizes: a host that compresses text sends fewer.

## What is not automated

Home Screen install, standalone mode, the status bar, offline use on a real iPhone, push. Check them by hand with
[`manual-ios-checklist.md`](manual-ios-checklist.md) before a release that touches the PWA files, the layout or the
location flow.
