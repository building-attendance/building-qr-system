# Testing

The details of running, writing and debugging the tests. The rules that every change follows (the two layers and when to
run each, the throwaway database, the console-error rule, the size budget, what CI requires to merge) are in
[`AGENTS.md`](../AGENTS.md), "Testing". The commands are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#tests) and in the
`scripts` of `package.json`. This page is for when you work on the end-to-end tests, the accessibility baseline, the
icons, CI or the smoke test.

Contents: [Setup](#one-time-setup-on-a-new-machine) | [How an E2E run is set up](#how-an-e2e-run-is-set-up) |
[Running one spec, and reading a failure](#running-one-spec-or-one-project-and-reading-a-failure) |
[Offline tests](#offline-tests) | [Accessibility](#accessibility) | [Two E2E runs on one machine](#two-e2e-runs-on-one-machine) |
[The icons](#the-icons) | [CI](#ci) | [The smoke test](#the-smoke-test) | [What is not automated](#what-is-not-automated)

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

## The smoke test

`.github/workflows/smoke.yml` is not a merge check: it runs after each production deployment (`scripts/smoke-check.mjs`
against the address in the variable `SMOKE_BASE_URL` of the GitHub environment `smoke`, the production domain; a run
without the variable fails and says so) and opens an issue labelled `bug` when the deployment is broken
([`deploy-and-rollback.md`](runbooks/deploy-and-rollback.md), "The smoke test after a deploy"). The variable decides where
the secret `SMOKE_AGENT_KEY` is sent, so it lives in an environment, whose variables only the owner of a personal
repository (an admin of an organization's) can change, and never in a repository variable, which any collaborator can.

## What is not automated

Home Screen install, standalone mode, the status bar, offline use on a real iPhone, push. Check them by hand with
[`manual-ios-checklist.md`](manual-ios-checklist.md) before a release that touches the PWA files, the layout or the
location flow.
