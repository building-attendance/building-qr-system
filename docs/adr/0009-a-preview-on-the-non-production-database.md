# 0009: A preview of one branch runs on its own non-production database

Status: Accepted

Date: 02/11/2026

## Context

Since #91 (05/10/2026) only the production branch deploys by itself. Every push of every branch had made a preview, the
Hobby plan's daily limit of deployments ran out (production needs the same quota), and the committee's Google sign-in did
not work on a preview address anyway. So a change is first seen running after its merge, in production. The owner wants
(02/11/2026) a place where a change that is not merged yet runs with both apps, the server and a database, on a phone and
a computer, without touching production.

The facts that shape the answer, from the vendors' documentation (read 02/11/2026):

- Vercel Hobby allows 100 deployments a day per account (`vercel.com/docs/limits`). The preview of a branch has a fixed
  address, `<project>-git-<branch>-<scope>.vercel.app`, that always serves the newest deployment of that branch (Generated
  URLs). A Preview variable can be scoped to one branch on every plan; Custom Environments (a staging) are Pro only
  (Environments, Environment Variables). Vercel Authentication protects preview deployments on Hobby, with one Sharable
  Link per account (Deployment Protection).
- Google accepts a sign-in only from an origin listed exactly, with no wildcard (Manage OAuth clients).
- Neon Free has 10 branches and 100 CU-hours a month per project, shared by its branches. Both Vercel integrations of Neon
  branch every preview from the default branch of the connected project, which here is production.

What is already decided: a preview build never migrates production, and only the production build migrates it (ADR 0002);
no Neon branch of production, because it copies personal data (ADR 0005); no database credential on the agent's computer
(ADR 0008).

## Decision

The owner chose this on 02/11/2026 (option B of the topic, with every default):

- **One preview, at one fixed address.** The branch `preview` deploys by itself as a Vercel preview deployment
  (`git.deploymentEnabled` in `vercel.json`); every other branch still does not. Its address is the branch URL, so the
  committee's Google sign-in works there once that address is an authorized JavaScript origin of the existing OAuth client.
- **Its own database, with fake data only.** A Neon branch `preview` of the non-production project, marked `nonprod` like
  its parent, never a branch of production. Its connection strings are Preview variables scoped to the branch `preview`,
  with `GOOGLE_CLIENT_ID` and `FIRST_ADMIN_EMAIL` (the owner, so that his first sign-in there makes him a member). Every
  production variable stays Production only.
- **The preview build migrates its own database, and nothing else.** After `vite build` and the gate (which still answers
  `skip` for a preview and never touches production), a preview build whose environment names a Postgres database reads
  the marker of every one it names: every value that is a Postgres URL, under any name, and the `PG*` set. Only when every
  marker is exactly `nonprod` does it apply the branch's own migrations to `DATABASE_URL_UNPOOLED`. A database marked
  `production`, one with no marker, or one that cannot be read fails the build, so the deployment never serves. A preview
  with no database (a dashboard deployment of another branch) builds as today and touches nothing. There is no check
  against GitHub: a preview runs the branch's unmerged migrations on purpose. The code is `server/previewMigrate.js`,
  guarded like the gate (`AGENTS.md`).
- **Only the owner opens it.** Vercel Authentication, Standard Protection: only someone signed in to the Vercel account.
  A Sharable Link when a provider should try something.
- **A change goes on the preview at the owner's word.** An agent moves the branch forward with one commit whose files are
  exactly the head of the pull request to be shown (`git commit-tree <head>^{tree} -p origin/preview`) and a plain push:
  never a force-push, never a pull request from it, never a merge of it. The agent offers it for a pull request that
  changes what a person sees or what the server does.
- **A reset when the schema goes wrong.** A migration is never undone. When the preview ran a migration that is not on the
  production branch, or one that changed since, the Neon branch is reset from its parent (its connection strings stay),
  after the owner is told, because that also deletes what he entered there.

## Consequences

Good:

- A change is seen running, both apps with a database and the sign-in, before the owner merges it, on free plans.
- Personal data never reaches the preview, and no database credential reaches the agent's computer.
- The quota stays for production: only `preview` and the production branch deploy by themselves.

Bad:

- Preview builds now have a write path, to the preview's own database. The check stops a mistake (a production variable
  copied into Preview), not a hostile branch: the build runs the branch's own copy of the build script, which could change
  the check, as ADR 0002 says of a CLI deploy. The boundary is that the Preview environment holds no production credential
  and that only the owner's agents push branches of this repository.
- A pull request from a fork deploys only after a member of the Vercel account authorizes it (Git Fork Protection, which
  is on). Which Preview variables Vercel would give a fork's branch that is also named `preview` is not documented (read
  02/11/2026), so the owner never authorizes the deployment of a fork.
- One change at a time. A preview that ran a migration leaves its database in a shape that may never reach production,
  until a reset.
- The preview uses the compute and storage of the non-production project, which its branches share on the Free plan.
- The address is long, and a copy of the project has its own (the branch URL holds the project and the account).

## Alternatives considered

- **A dashboard deployment only, as since #91.** No database and no sign-in: the screens only.
- **Neon's Vercel integration, a branch for every preview.** It branches from the production project: a copy of the
  personal data in every preview, which ADR 0005 rejects. A new address for every pull request also breaks Google's exact
  origins.
- **A staging environment of Vercel Pro.** Not on Hobby; the project stays on free plans.
- **A preview for every pull request.** The quota of #91 again, and no fixed address for Google.
- **The agent migrates the preview's database by hand** (`npm run db:migrate`). No change to the build, but the preview's
  connection string would live on the agent's computer, against ADR 0008, and a forgotten step shows a broken preview.
- **Several preview addresses.** Each needs a branch, a Neon branch, its variables and an origin; one is enough to start.
