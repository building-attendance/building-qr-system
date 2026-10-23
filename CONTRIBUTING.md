# Contributing

Thank you for helping. This is a tool that building committees can host for themselves, and the maintainer's own
building is its first user. Issues and pull requests are welcome, and they are written in English.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, do not open
an issue: follow [SECURITY.md](SECURITY.md).

Contents: [Before you start](#before-you-start) | [Local development](#local-development) | [Tests](#tests) |
[Structure](#structure) | [Database changes](#database-changes) | [How a pull request is checked](#how-a-pull-request-is-checked) |
[Releases](#releases) | [Working with AI tools](#working-with-ai-tools) | [License](#license)

## Before you start

- **Larger work:** open an issue first, with the bug form or the feature form, so that the approach can be agreed
  before you spend time on it.
- **Small fixes** (a typo, a clear bug with a small fix) can go straight to a pull request.
- Write about one thing at a time. Do not put real names, phone numbers, passwords, attendance records or keys in an
  issue, a pull request, a screenshot or a test.

### The rules

The full list is in [`AGENTS.md`](AGENTS.md), under "Rules for every change". It is the single source: this is a summary.
The ones that matter most:

- **No em dash** (the long dash) anywhere: code, comments, UI text, docs. Use a comma, a colon, a full stop,
  parentheses or a plain hyphen. A test fails if one appears.
- **Dates and times that a person sees** are written only by `shared/datetime.js`: DD/MM/YYYY and HH:MM (24 hours, the
  building's time). Never a month name, a weekday (the day initials of the app's own date picker are the one
  exception, `AGENTS.md`) or the browser's own date field. The API and the agent keep ISO dates on purpose.
- **Phone and computer:** the app is used on both. Change both layouts together and check both.
- **UI text** of the service providers' app comes from `src/i18n/*.js`, in all four languages: Hebrew, English, Russian
  and Arabic. The committee app is in Hebrew only for now: its text is in `src/admin/` and `src/pages/AdminApp.jsx`
  until it moves to `src/i18n`.
- **Everything is written in English:** code comments, commit messages, issues, pull requests and documents. Only the
  app's own interface text is in other languages (see the UI text rule above).
- **A tile or row of the committee app shows one "more" button:** every action is in the menu of that button, in one
  order: edit (when it has one), the actions of that screen, then switch off / on, then a separator and the red delete,
  last (red is only for deleting).
- **Never delete or skip a test to make CI pass.** If a test fails, either your change has a bug or the app has one:
  fix it, or report it in the pull request. Do not change the test to hide it.

## Local development

You do not need Google, Vercel or a production database to work on the code. To host your own deployment, see
[docs/install.md](docs/install.md).

1. Install Node 24, release 24.18 or later (`engines` in [`package.json`](package.json)). [`.nvmrc`](.nvmrc) says 24,
   so `nvm install` takes the newest Node 24.
2. `npm install`
3. `npx playwright install chromium webkit` (about 350 MB, needed for the browser tests).
4. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`). Point them at a
   Postgres database of your own that holds no real data: a free Neon project, or a local Postgres 18. **Never a
   production database**, not even to look. The tests, the dev seed and the local scripts refuse a database that is
   marked as production, and an env file pulled from Vercel production (`server/dbGuard.js`, `server/loadEnv.js`).
5. Run it:

```bash
npm run db:seed-dev                  # a separate dev_ui schema with sample data: it does not touch real tables
npm run dev:api -- --schema=dev_ui   # the local API (port 3001), with a dev-only admin sign-in that skips Google
npm run dev                          # the app (port 3000), which forwards /api to port 3001
```

The sample users are defined in `scripts/dev-seed.mjs`. They have development passwords only, and they exist only in the
`dev_ui` schema.

The other scripts (the full list is the `scripts` of `package.json`):

```bash
npm run db:migrate                   # applies the new migrations to the database in DATABASE_URL (refuses production)
npm run db:create-admin -- <google-email> [name]   # adds a committee member to the database in DATABASE_URL, and prints which one
npm run db:backup -- --out <dir> --encrypt-to <public key file> --encrypt-fingerprint <fingerprint> --neon-project <id>   # dumps the database to <dir>, encrypted to the owner's key (kept 30 days, never in the repository); make the key pair first, see "Encrypted backups" in docs/runbooks/restore.md
npm run icons                        # makes the PNG icons in public/ from public/pwa-512x512.svg
npm run size                         # builds the app and checks it against the size budget (scripts/check-bundle-size.json); CI runs it in the guards check
```

## Tests

```bash
npm run lint          # ESLint: must pass with no warnings (CI runs it in the guards check); it also refuses, in the code that runs in the browser, a built-in newer than build.target in vite.config.js
npm run typecheck     # TypeScript checks the JavaScript (types are JSDoc comments): must pass (CI runs it in the guards check)
npm run test:unit     # Vitest: logic, the API against Postgres, i18n, contrast, typography, components
npm run test:e2e      # Playwright: Chromium as a Pixel 7 and WebKit as an iPhone 14
npm test              # both
npm run screenshots   # takes the README pictures again (not a test, and CI never runs it)
npm run ui-review:pictures   # takes pictures of every screen on worst-case fake data in a schema of its own, for the ui-review skill (not a test, CI never runs it, the pictures are never committed; docs/testing.md)
npm run perf:scan     # times the provider's scan on a throttled phone and compares it with the baseline (not a test, and CI never runs it; docs/testing.md)
npm run perf:api      # times every committee and agent API route on a year of invented data and compares it with the baseline (not a test, and CI never runs it; docs/testing.md)
npm run perf:screens  # times each committee screen on a year of invented data, on a throttled phone and on a computer, and compares it with the baseline (not a test, and CI never runs it; docs/testing.md)
```

- **A quick loop:** run one file, for example `npx vitest run tests/<file>.test.js`, or one folder
  (`npx vitest run tests/components`).
- **A throwaway schema:** the unit tests and the E2E tests both create one in your database and drop it at the end.
- **E2E, one project at a time locally:** `npx playwright test --project=android-chrome`, then
  `npx playwright test --project=iphone-webkit`. One command that runs both projects back to back uses one schema and one
  address, so the sign-in throttle of one address can answer 429 late in the run. CI runs each project in its own job and
  database, so it does not see this. The offline tests run on `android-chrome` only, because Playwright's WebKit cannot
  take a service-worker page offline.
- **Screenshots:** run `npm run screenshots` only when a screen has changed. It writes the images in
  [docs/screenshots](docs/screenshots/README.md) from fake sample data, and refuses to run against anything but a local
  address and a scratch schema. Look at every picture before you commit it.
- **What cannot be tested automatically** (installing to the Home Screen on an iPhone, standalone mode, offline use on a
  real iPhone) is listed in [docs/manual-ios-checklist.md](docs/manual-ios-checklist.md).

## Structure

```
api/index.js           the Vercel entry point (every /api/* is routed to it in vercel.json)
server/                the API: routes/, access (who may call what, enforced by the router), auth, scans (the rules), google (verification), db, migrate
shared/                code that runs in both the browser and the server: shared/datetime.js writes every date and time a person sees, always DD/MM/YYYY and HH:MM; shared/contract.js holds the values that the phone and the server must agree on (the offline sync limits, the GPS limits, the words of a scan, the form limits, the QR token)
db/migrations/         the DB schema
scripts/               migration, creating an admin, the development seed, the CI guards, the text rules and the edit hook, the screenshots, and the pictures of the UI review
src/worker, src/i18n   the service provider app (src/pages/WorkerApp.jsx)
src/admin              the committee app (src/pages/AdminApp.jsx)
src/ui                 what both apps share: the colour tokens, light and dark, and the screen that replaces a broken one (ErrorBoundary: a message with "Try again" and "Reload the app" instead of a blank page; it logs the error's name only)
tests/                 vitest (logic, the API against a real Postgres in a temporary schema, i18n, tests/components for components)
e2e/                   Playwright (PWA, the service provider app, the committee app, an axe accessibility scan of both, and visual.spec.js: baseline images of the key screens, made and compared in CI only) on a Pixel and an iPhone
docs/                  install guide, releases, privacy, the agent API, the runbooks, the decisions (adr/) and the screenshots
.github/               the workflows, the rulesets, the issue and pull request templates
```

**The build id.** Both apps show the first 7 characters of the commit that Vercel built (`dev` for a local build), so that
you can tell which version a phone runs. `vite.config.js` writes it into the JavaScript (`VITE_APP_BUILD`) and
`src/ui/build.js` reads it. Its shape is `APP_BUILD_RE` in `shared/contract.js`. The server's own commit is the `commit` of
`GET /api/health`.

## Database changes

A migration is a **new numbered file** in `db/migrations/`, one number after the last. Never edit, rename or delete an
old one: a migration that has run is history, and you fix forward with a new file.

Destructive SQL (drop, rename, truncate, delete, a type change, `SET NOT NULL`) needs a line
`-- contract: <reason>` that says why it is safe now.

Work in three steps, in separate releases: **expand** (add the new column or table), **migrate** (move the data and
switch the code to it), then **contract** (drop what the old code used). The old deployment keeps serving while the
new one builds, and installed apps keep running old code for days, so the database and the API must work for both.

## How a pull request is checked

- **Keep it small and about one thing.**
- **The title is a Conventional Commit:** `type(scope): description`, where the scope is optional. The types are `feat`,
  `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`, `style` and `revert`. A `!` before the colon marks a
  breaking change. For example: `feat(admin): export attendance to CSV` or `fix: refuse a scan from too far away`. A check
  refuses any other title.
- **Fill in the pull request template** ([`.github/pull_request_template.md`](.github/pull_request_template.md)): what and
  why, how it was checked, which tool helped, and a checklist.
- **Four CI checks must be green** on every pull request, and the branch must be up to date with `master`. CI runs against
  a Postgres 18 container:
  - `guards`: migrations only move forward, tests are not removed, `AGENTS.md` fits in the 32,768 bytes that Codex
    reads and is the only instruction file, the pull request title, ESLint, the type check, a dependency audit, and the
    size of the built app against its budget (`npm run size`)
  - `unit`, `e2e (android-chrome)` and `e2e (iphone-webkit)`: each passes when every one of its parts passed (the parts
    run side by side, see [`docs/testing.md`](docs/testing.md), "CI")
- **A pull request, then an approval:** `master` is protected by rulesets
  ([`.github/rulesets/`](.github/rulesets/README.md)). Changes arrive only through a pull request, and a code owner
  approves it.
- **The maintainer merges, with a squash.** The title becomes the commit on `master`. Contributors and agents never merge.
- **A change under `.github/` or to `scripts/check-*` gets a careful look.** A pull request runs its own changed checks,
  so green checks do not prove that the checks were not weakened. Say so at the top of the description.
- **The rules of the project change only in a pull request of their own.** A change to `AGENTS.md` or `CLAUDE.md` is
  titled `docs(rules): ...` and says so at the top of its description. A feature pull request never changes them.
- **The reviewer is from another vendor than the writer** (Codex reviews what Claude wrote, and Claude reviews what Codex
  wrote: [ADR 0003](docs/adr/0003-the-reviewer-is-from-another-vendor.md)). An automated review may comment on your pull
  request. Its findings are advice to check against the code, not orders: reply if you disagree.

## Releases

The titles of the merged pull requests become the notes of the next release, so write a title that a person who installs
the project can read. How versions work, and how a release is cut: [docs/releases.md](docs/releases.md).

## Working with AI tools

AI-assisted contributions are welcome. You are responsible for every line you submit, whoever or whatever wrote it:
read it, run it, and understand it. Say in the pull request template which tool helped. Never paste secrets or real
personal data into a prompt, an issue or a test.

Coding agents (Claude Code, Codex, any other) work by [`AGENTS.md`](AGENTS.md).

The "Agent task" issue form is for tasks that are written so that a coding agent can do them without more questions.
Filling it in does not start any agent: only the maintainer starts one, after reading the issue.

## License

By contributing, you agree that your contribution is licensed under the project's [MIT license](LICENSE).
