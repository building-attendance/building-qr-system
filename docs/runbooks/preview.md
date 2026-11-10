# A preview before production

A change that is not merged yet can run, with both apps, the server and a database, at one fixed address. This page is how
to set that up once, how to put a pull request on it, how to read its build log and how to reset its database. The reasons
are in [ADR 0009](../adr/0009-a-preview-on-the-non-production-database.md). Production is deployed only by a merge
([deploy-and-rollback.md](deploy-and-rollback.md)); the preview is not a way to production.

## What it is

- **One branch, one address.** The branch `preview` is the only branch other than the production branch that Vercel builds
  by itself (`git.deploymentEnabled` in `vercel.json`). Its address never changes and always serves the newest deployment
  of that branch: `https://<project>-git-preview-<scope>.vercel.app` (Vercel's branch URL: the project name, the branch,
  the account or team scope). Every other branch still gets no automatic preview.
- **Its own database, with fake data only.** A Neon branch `preview` of the non-production project, marked `nonprod`.
  The preview build migrates that database, and no other (see "Reading the build log").
- **Only the owner opens it.** Vercel Authentication, Standard Protection: only someone signed in to the Vercel account.
  Never loosen that for a preview, not even for the icon (see "On a phone").
- **One change at a time.** A second pull request replaces the first.

## Setting it up once

1. **The database.** A project of Neon that holds no production data. Never a Neon branch of the production project: it
   copies personal data (ADR 0005, ADR 0009).
   - The main branch of that project carries the marker that says `nonprod`. The first installation's own non-production
     project has it. A new project has none, and a preview build refuses a database with no marker, so make it once on the
     main branch (the statement is the one `server/productionMigrate.js` runs to mark production, with `nonprod`):
     `create table if not exists public.environment_marker (environment text primary key check (environment in ('production', 'nonprod')));`
     then `insert into public.environment_marker (environment) values ('nonprod') on conflict do nothing;`
   - Make the branch: `neon branches create --name preview --project-id <project id> --no-secrets`. Without
     `--no-secrets` the command prints a connection URI (`neon branches create --help`). A branch starts as a copy of its
     parent, marker included: read it back (`select environment from public.environment_marker`) and expect `nonprod`.
   - The two connection strings of the branch are `neon connection-string preview --project-id <project id> --pooled` and
     the same without `--pooled` (the direct one). They are secrets: send them into a file or the clipboard and straight
     into Vercel, never into a chat, a pull request or a log.
2. **Vercel, four variables for Preview, scoped to the branch `preview`** (Settings, Environment Variables, Environments:
   Preview, then the branch):
   - `DATABASE_URL`: the pooled string of the branch `preview`.
   - `DATABASE_URL_UNPOOLED`: its direct string. This is the one the build migrates; a pooled host (`-pooler`) is refused.
   - `GOOGLE_CLIENT_ID`: the same public value as production.
   - `FIRST_ADMIN_EMAIL`: the e-mail of the person who will sign in. The first sign-in on the preview makes that person a
     member, because its database holds no member yet ([install.md](../install.md), section 3.6). Keep it: it does the same
     after every reset.

   Switch "Sensitive value" on for the two connection strings and the e-mail.
3. **What stays Production only.** `APP_BASE_URL`, `HEALTH_HEARTBEAT_URL`, `CRON_SECRET`, `DATABASE_URL_RUNTIME`, the
   production `FIRST_ADMIN_EMAIL`, and the Neon resource that the Vercel integration added (its variables hold the
   production database). A preview build reads every variable of its environment that holds a Postgres URL, under any name,
   and the `PG*` set; one that names a database marked `production`, or with no marker, fails the build. Without
   `DATABASE_URL_RUNTIME` the preview connects as the role that owns the tables, which is fine for fake data.
   [secrets.md](secrets.md) lists where each secret lives.
4. **Vercel, Settings, Deployment Protection:** Vercel Authentication on, Standard Protection. A provider who should try
   something gets the account's one Sharable Link; the Hobby plan allows one per account.
5. **Google.** In the Google Cloud console, the OAuth client of the committee sign-in, Authorized JavaScript origins: add
   the preview's branch URL, exactly (the committee's sign-in works only from a listed origin, with no wildcard). Take the
   address from the deployment of the branch in Vercel, so that no letter is guessed.
6. **Each phone,** once: sign in to Vercel in Safari at the preview address.
7. **Forks.** If a fork opens a pull request from a branch named `preview`, the owner never authorizes its
   deployment (Git Fork Protection holds it until a member of the Vercel account does; ADR 0009).

## Putting a pull request on the preview

Only at the owner's word, and an agent offers it for a pull request that changes what a person sees or what the server
does. The branch only moves forward: a new commit whose files are exactly those of the pull request's head, then a plain
push. Never a force push, never a pull request from `preview`, never a merge of it, never a deleted branch.

```
git fetch origin
git commit-tree <head>^{tree} -p origin/preview -m "preview: #<n> at <sha7>"
git push origin <commit>:preview
```

`<head>` is the head of the pull request's branch (fetch the branch first), `<n>` the pull request's number and `<sha7>` the
first 7 characters of that head. `git commit-tree` prints the new commit, which is `<commit>`. If the push is rejected,
someone moved the branch: fetch again and repeat from the commit-tree line, never force.

The first time, when the branch is not on the remote yet, push the head itself: `git push origin <head>:refs/heads/preview`.

What the preview then serves is the pull request's tree, with nothing of master that the pull request does not hold: a
branch that is behind master shows the old master under it. Its `/api/health` reports the first 7 characters of the new
commit, not of the head.

## Reading the build log

Vercel dashboard, the project, **Deployments**, the newest one of the branch `preview`, **Build Logs**. A good preview
build prints these lines, in this order (`ep-xxx****` is an endpoint of Neon with the middle of its name hidden; the host
is masked by `maskDatabaseHost` in `server/dbGuard.js`):

```
vercel-ignore: build, not a production build
Deploy gate: skip (a Vercel preview build, so the production database is never touched). VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=preview commit=<sha7>
Preview database: ep-xxx****.<region>.aws.neon.tech (DATABASE_URL), marker nonprod
Preview database: ep-xxx****.<region>.aws.neon.tech (DATABASE_URL_UNPOOLED), marker nonprod
Applied: 006_..., 007_...
```

The pooled and the direct host are two databases to the build, so each has its line, with the variable that names it. The
last line is `Database is up to date.` when nothing was pending, and `Applied:` lists the files that were. The migrations
that run are the branch's own, whether or not they are on the production branch (nothing is checked against GitHub).

When the preview build fails, the deployment does not serve, and the line says why (it begins with `Preview migration
failed:`):

- `... is marked production: a preview build never touches production. Remove it from the Preview environment variables in
  Vercel`: a variable of the Preview environment names the production database. Remove it from Preview. Nothing was changed.
- `... has no environment marker: a preview build migrates only a database marked nonprod`: make the marker (setting up,
  step 1).
- `The marker of ... could not be read (...)`: the database did not answer or refused the role; check the string.
- `DATABASE_URL_UNPOOLED is not set`, or `... points at a pooled host (-pooler)`: fix the variable.
- `... names a Postgres database, but not as a valid URL with a host`, or `... is set but is not a postgres:// or
  postgresql:// connection URL`: the value is wrong (white space around it counts).
- `Migration NNN_name.sql failed: <SQLSTATE> (<condition>)`: a migration of the branch failed on the preview's database.
  Read its message by running the file on the non-production database with `npm run db:migrate`, as in
  [deploy-and-rollback.md](deploy-and-rollback.md), "A failed migration".

A preview with no database in its environment (a deployment made from the dashboard for another branch) prints
`Preview build: no database in its environment, so none is touched.` and builds as before.

## Resetting the database

A migration is never undone, and the runner records only a migration's name, so a file that changed after the preview ran it
is not run again. Reset the preview's database when it ran a migration that is not on the production branch, or one that
changed since: it would show a shape that production will not have.

```
neon branches reset preview --parent --project-id <project id>
```

(`--parent` resets to the parent branch; `neon branches reset --help`.) The Neon console has a button for the same. **Tell
the owner first**: a reset also deletes what was entered on the preview (points, providers, scans, and the committee
members too). The connection strings stay. The next sign-in with the e-mail of `FIRST_ADMIN_EMAIL` makes that person a
member again. The reset does not build anything: the deployment that is up expects the newer shape until the next build, so
push the next forward commit, or **Redeploy** it in Vercel, and the build migrates the branch again.

## On a phone

- **A QR made on the preview points at the preview.** `APP_BASE_URL` is Production only, so the committee app builds the
  address from the host of the request (`baseUrl(req)` in `server/routes/admin.js`). A sign printed from the preview works
  only there, and only for someone signed in to Vercel. Never put one on the wall.
- **The Home Screen.** After one Vercel sign-in in Safari, the preview added to the Home Screen opens straight into the
  app, with no Vercel screen. Its icon is blank: without the Vercel cookie the preview answers `/apple-touch-icon.png` and
  `/manifest.webmanifest` with a 302 to the Vercel sign-in, where production answers 200. That is expected and harmless on a
  test copy. Do not loosen the protection to fix it.

## What never goes there

- Production data: no restore of a backup, no copy of a row, no real name, phone number, e-mail or position.
- A production variable or connection string in the Preview environment, for any name. The build refuses it, but that is
  the last guard, not the first.
- A pull request opened from `preview`, or a merge of it.
- A Sharable Link given out without a reason, or a loosened Deployment Protection.

## Drill log

Repeat the drill after a change to the Vercel project, the Neon project or the build script, and add one entry here each
time. The entries below are the first installation's own record: a copy keeps its own, or removes them.

- `10/11/2026`: the first end-to-end run. The first preview was built on 07/11/2026 and migrated 006 to 017 (twelve
  files) on its own database; the log showed `Deploy gate: skip` and `Preview database: ... marker nonprod` for both
  strings. The owner signed in with Google on the preview and became its first member. He made a point where he stood, a
  provider, and one scan, accepted online at 6 m accuracy. Counts read back from the preview's database: 1 point, 1
  provider, 1 scan, 0 refusals. Production was checked by name and showed no trace: no such point, no such provider, no
  attendance in the range. The preview added to the Home Screen of his iPhone opened straight into the app after one Vercel
  sign-in in Safari, with a blank icon (above).
