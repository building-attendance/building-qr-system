# Security policy

This is a small project run by volunteers, but the hosted instance holds real people's attendance data, so a security
report is taken seriously. Thank you for taking the time to send one.

## Supported versions

Only the latest release is supported: the newest version on the
[Releases page](https://github.com/building-attendance/building-qr-system/releases). A security fix is released the same day
that it merges, so a copy gets it by updating to the new release. That release is usually a PATCH version (`v2.0.1`); its
number follows everything that merged since the previous release, so it is a MINOR one when features merged in between,
and a MAJOR one when installers must act. How versions work is in [docs/releases.md](docs/releases.md). The hosted instance (the first installation, run by the owner of this repository)
is deployed from `master`, so it has a fix as soon as it merges.

## How to report a vulnerability

Report it privately, through GitHub's private vulnerability reporting (it is enabled for this repository):

https://github.com/building-attendance/building-qr-system/security/advisories/new

That is the reporting route of this repository and of the first installation. A copy of the project has its own maintainer,
who replaces this address with the one of the copy's repository (`https://github.com/<owner>/<repo>/security/advisories/new`)
and says who answers there.

Never report a vulnerability in a public issue, a pull request or a discussion, and do not share the details anywhere
else before it is fixed. Please write in English.

Please include:

- **The affected part:** the provider app, the committee app, the API, the agent API, a migration or a workflow.
- **Steps to reproduce it:** short and concrete, so that somebody else can follow them.
- **The impact:** what an attacker could read, change or do, and who would be hurt.
- **A proof of concept that uses only your own data.** Do not use anybody else's account, key or records.

## What to expect

This is a volunteer project, so the times below are goals, not a contract.

- We acknowledge your report within 7 days.
- For a high or critical issue we send a fix or a written plan within 30 days.
- We use coordinated disclosure: the advisory is published after the fix is out, and at most 90 days after the report,
  unless you and the maintainer agree on another date.
- If you want credit in the advisory, say so in the report and tell us how to name you.

## What is in scope

- The provider app (scanning, `/`).
- The committee app (`/admin`) and its sign-in.
- The API in `server/` (entry `api/index.js`).
- The read-only agent API ([`docs/agent-api.md`](docs/agent-api.md)).
- The database migrations in `db/migrations/`.
- The CI workflows in `.github/workflows/`.

## What is out of scope

- The configuration of somebody else's self-hosted deployment (their keys, their database, their hosting settings).
- Attacks that need a stolen committee Google account or an unlocked phone.
- Volume or denial-of-service testing.
- Social engineering of the maintainer, the committee or the service providers.

## Rules for testing, in good faith

The hosted instance holds real people's attendance, so please test against your own deployment.
[CONTRIBUTING.md](CONTRIBUTING.md) explains how to run the project on your own computer, and
[docs/install.md](docs/install.md) explains how to host a copy. Research that follows these rules is welcome and is
treated as good faith.

- Do not read, change or delete other people's data.
- If you reach personal data by accident, stop, do not copy or keep it, and tell us in your report.
- Do not run load tests or anything that could slow the hosted instance down.

## Guidelines for the automated security review

Every pull request that changes anything beyond documentation, tests and the text a person sees in the app also gets a
security review by Codex. Here it runs through the local CLI, in a checkout of the pull request's head, and its result
goes into the pull request's description. The CLI does not read this file by itself, so the command names it:

```
codex review "Security review of the changes on this branch against origin/master (git diff origin/master...HEAD). Follow the section 'Guidelines for the automated security review' in SECURITY.md and the Safety section of AGENTS.md. Report only security findings, each with a severity, a file and a line."
```

Codex's security review on GitHub (`@codex security review`) reads this section by itself, but it is not available on
every ChatGPT plan; a copy whose plan includes it can ask for it there instead. The project's rules are in `AGENTS.md`:
its "Code Review Rules" say what counts as P1, and its "Safety" section holds the rules behind them. Judge a pull request
against the base branch's version of both. What matters most here:

- **Personal data:** names, e-mails, phone numbers, attendance rows and positions never reach a log, an error record, a
  URL, a test, a fixture or an answer that its role may not see.
- **Secrets:** the value of a point's QR token, a provider or committee token, an agent API key, a password hash,
  `CRON_SECRET` or `HEALTH_HEARTBEAT_URL` never appears in the diff, a log, an answer or a workflow's output, and a key's
  prefix never reaches an agent answer. The prefixes themselves are constants in `server/config.js` and
  `shared/contract.js`, where the server checks a token's shape, not secrets.
- **Authorization:** every route under `/api` is owned by exactly one rule of `server/access.js`: a public route is on its
  `PUBLIC` list with the reason it answers without credentials, and every other route has a guard that runs before any
  code of its handler. The agent API only reads, and builds every answer field by field.
- **Production:** no local tool reaches a deployment's database but `npm run db:backup` (read-only) and
  `npm run db:create-admin`; only the production build migrates.
- **The browser:** what the Content-Security-Policy in `vercel.json` allows.
- **Workflows:** actions pinned to a full commit SHA, the narrowest `permissions`, untrusted text only through `env`, and
  each secret only in its environment.

A finding names the file and the line, says who could exploit it and how, and says when the problem is in code that the
pull request did not change (pre-existing), so that its fix goes into its own pull request instead of this one.

## Known and already handled

An old Google API key from the project's earlier Firebase version is in the git history. It was revoked and the
secret-scanning alert is closed, so it does not need a report.
