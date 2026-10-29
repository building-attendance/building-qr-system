# 0008: The local agent works with least privilege

Status: Accepted

Date: 22/10/2026

## Context

Most of the work is done by an agent in a session on the owner's computer, not by the loop of ADR 0006. On 22/10/2026 a
panel of reviewers read the project's retrospective, and its security reviewer found that the careful limits of the loop
(an App of its own, a closed tool list, no `gh api`) never reached that local agent. Six findings were checked with live
commands the same day: (1) the local agent ran as the owner, with a classic `gh` token (`repo`, `workflow`, `gist`) of a
repository and organization admin, a Neon CLI signed in to the organization of production, signed-in Vercel and Firebase
CLIs, unencrypted full dumps of production in a folder it reads, and local settings that pre-approved production commands;
(2) nothing denied `gh api`; (3) no migration had a `GRANT`, and the app connected as the owner of every table, so the
append-only triggers held only against the app's own code; (4) `server/dbGuard.js` refuses only a database marked
`production`; (5) nothing kept `AGENTS.md` inside the 32 KiB that Codex reads; (6) a local session holds all three legs of
the "lethal trifecta" (untrusted text, credentials and private data, a way out), which ADR 0006 cuts only in GitHub Actions.

One fact shapes every answer: the agent runs under the owner's Windows account, so every credential signed in there is in
its reach. A deny rule in `.claude/settings.json` catches the usual command, not every way to run a program (ADR 0003,
`CLAUDE.md`). So the boundary has to move from rules and habits to the credentials themselves: what the agent's
credentials cannot do, no injected text can make it do.

## Decision

- **The agent's GitHub token** (22/10/2026): a fine-grained token of the owner for this repository only, with Contents,
  Issues and Pull requests read and write, and Actions, Commit statuses, Deployments and Metadata read; 90 days. It replaced
  the classic token, whose OAuth app was revoked. A spike (S1, 22/10/2026) ran a token with the same permissions on a
  throwaway repository with the same two rulesets. GitHub refused it: switching off a ruleset (403, row e), pushing a
  workflow file (row f), listing the secrets (403, row h), approving its own pull request (422, row j), changing a setting,
  creating or deleting a repository, creating a gist (403, rows k to n). It allowed: merging a green pull request without an
  approval (200, rows c and o: the admin bypass of `master-approval` serves any token of the owner, whatever its
  permissions), and creating a tag and a release (201, row g). A push to `master` is refused by `master-gates`, which has no
  bypass. Without Actions write, re-running a job or starting a workflow is the owner's click.
- **What only the owner does** (in the browser): merging, approving, settings, rulesets, secrets, releases and starting a
  workflow. A step that needs a script with more rights (a push that changes a workflow file) gets a short fine-grained token
  made for it, kept only in the owner's password manager and read at a hidden prompt into the memory of one command; none is
  ever stored on the computer. The last one (24/10/2026, 7 days, for #332) is deleted.
- **The CLIs:** the Vercel and Firebase CLIs are signed out (22/10/2026), their tokens revoked, and an agent never signs them
  in. The Neon CLI is to keep only a key for the non-production project, and production only through the owner's console.
- **The browser:** a session reads the web in the desktop app's own browser, which holds no sign-in. The owner's Chrome only
  when the owner asks for it in that turn; the consoles of GitHub, Vercel, Neon and Google Cloud are the owner's. A password
  statement in Neon's SQL Editor has its History entry deleted right after Run (finding 7, below).
- **Backups:** every dump is encrypted to the owner's public key, and the private key is only in the owner's password
  manager (#320, #327). A restore drill with the real key passed (#330), and every older plaintext dump was encrypted and
  then deleted (24/10/2026). The daily backup is to run under a Windows account of its own, from its own copy of the code,
  with a read-only login (`backup_login`, a member of `backup_reader`) and a token that can only open issues.
- **The database:** the app connects as `app_login`, a member of `app_runtime`, which owns nothing and holds only what the
  code does to each table; on `audit_log` and `scan_refusals` only `SELECT` and `INSERT` (#317, migration 016,
  `tests/db-privileges.test.js`; #321, live since 23/10/2026, `owns_tables: false`). The migrations still run as the owner
  in the production build (ADR 0002).
- **The GitHub API:** `gh api` is denied, and `scripts/gh-agent.mjs` holds the fixed commands the agent needs; `threads` and
  `comments` print only the owner's and Codex's text, which narrows the untrusted-text leg (#318, #319).
- **The rules file:** a CI guard keeps `AGENTS.md` within 32 KiB and refuses a second instructions file (#316), and the
  loop and auto-merge treat `AGENTS.override.md` like `AGENTS.md` (#332).
- **Release tags:** a ruleset for `refs/tags/v*` is postponed. Against a token of the owner its admin bypass would let a tag
  through (row g), so it waits for the machine account below. Until then the deny rules on `git tag` and `gh release` hold
  the usual command, and AGENTS.md says releases are the owner's.

## Consequences

Good:

- What matters most is refused by GitHub, not by a rule the agent could step around: rulesets, settings, secrets and
  workflow files are out of the token's reach, so a workflow can no longer be pushed to read the repository's secrets.
- The running app cannot switch off the append-only triggers or delete an audit row, even through injected SQL.
- A dump on the computer is unreadable without a key that is not on the computer.

Bad:

- A deny rule is a guardrail, and the token is the boundary. The token can still merge a green pull request without the
  owner's approval and make a tag or a release (rows c, g). That is held by the deny rules and the habit only; such a
  merge would be public and pass the four required checks.
- One Windows account: any credential the owner signs in there is in the agent's reach. Staying signed out is a habit of
  the owner, not a mechanism.
- Not done on 29/10/2026: the backup account ran on 25/10/2026 and is paused since 26/10/2026, so the daily backup runs
  again from the owner's account through the Neon CLI, whose sign-in reaches production's owner role. Until it is finished
  and the CLI keeps only the non-production key, a production credential is still in the agent's reach.
- The way-out leg stays open: an open network and `git push` to a public repository. Running sessions in WSL2 with the
  sandbox, or in a dev container, is to be measured after this topic: the sandbox does not exist on native Windows.
- Outside this decision, still on the computer: the Codex CLI and Claude sign-ins, and a text-to-speech key with a credit
  cap. `CLAUDE_CODE_OAUTH_TOKEN` and `SMOKE_AGENT_KEY` stay repository secrets, read only by a workflow run, which the
  agent's token can no longer change. The token can add a label, `allow-test-removal` included, which auto-merge refuses.
- Neon takes a role's password only as plain text, and the SQL Editor opens its newest History entry when it loads. On
  25/10/2026 a session that prepared a step in the owner's Chrome saw the `app_login` password there (finding 7). It was
  rotated that evening (ADR 0004), and the entries deleted.

## Alternatives considered

- **A machine account** (a GitHub user of its own with Write only): it has no admin bypass, so no token on the computer
  could merge without the owner's approval. Postponed: it costs the owner's setup time, and whether Codex reviews its pull
  requests is not documented (Codex reviews the pull requests of members of the owner's ChatGPT workspace).
- **A GitHub App for the agent:** the same question about Codex, and a tool that mints a token every hour.
- **A hook that allows `gh api` in fixed forms:** more precise, but filters that read shell syntax cost round after round of
  review (#271, #274). The wrapper is a list of fixed commands instead.
- **`gh auth login` before an owner step and `gh auth logout` after it:** a running session holds the owner's token between.
- **Revoking rights from the owner role:** an owner can grant them back to itself.
- **The sandbox now:** a move to WSL2 changes the whole working setup (WebKit, the local PostgreSQL, the worktrees).
