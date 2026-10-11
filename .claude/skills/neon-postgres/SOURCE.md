Copied from https://github.com/neondatabase/agent-skills/tree/ae082b22275461fbb5e303a1bcdc9bb00b73a946/skills/neon-postgres
(commit ae082b22275461fbb5e303a1bcdc9bb00b73a946 of 01/10/2026), copied 11/10/2026, with the local changes below. Apache License 2.0, Neon: see LICENSE (the licence file of the repository, copied as it is; the repository's `package.json` says `"license": "Apache-2.0"` and the author "Neon", and the LICENSE names no copyright holder).
Pinned on purpose. To update, read the new version first, then copy it over in a pull request.

Where this skill disagrees with AGENTS.md or docs/design.md, those win.

This is the version that `neon skills` had installed on the owner's machine on 02/10/2026: every file is identical to this commit once the line endings are compared (Windows had written them with CRLF; the copy here has the repository's LF). Upstream has moved on: at copy time its `main` was at bfd013c352ed31b57a573e4f60263afc5fdd7f7a (07/10/2026), but `skills/neon-postgres` has not changed since 23/09/2026, so this folder is also its latest version. It is the child of the `neon` skill, which is copied next to it (`.claude/skills/neon/`).

## Local changes

Only the em dash, which this project never allows (AGENTS.md, `tests/no-em-dash.test.js`). The upstream files of this skill have 15, in 3 of its 6 files. Each was replaced by hand with the text that keeps the meaning: 11 by a colon, 4 by parentheses (two pairs).

The Apache License (section 4(b)) asks that a changed file says so. Each of the 3 changed files (`SKILL.md`, `references/lakebase-search-drizzle.md`, `references/vector-search.md`) therefore starts, after the front matter of `SKILL.md`, with a one-line HTML comment that says so. The other 2 files (`references/full-text-search.md`, `references/hybrid-search.md`) are byte for byte the upstream files. Nothing else was changed.

## Where it disagrees with this project

- Schema and migrations are numbered SQL files in `db/migrations/` and reach production only through the Vercel build, with the expand, migrate, contract steps (AGENTS.md, "Database and API changes"; ADR 0002). The skill's "Migrations" advice (test on a branch of production, use a direct connection), Drizzle (`drizzle-kit generate` and `migrate`) and `CREATE EXTENSION` advice do not replace that, and `npm run db:migrate` refuses a production database.
- The setup flow has the agent list organizations and projects, fetch a connection string (`neon env pull`, the CLI or the MCP server) and store it in `.env`. Here the owner fills `.env.local` from `.env.example` and an agent never opens it; no agent or local tool reads a production database (AGENTS.md, "Commands" and "Safety"). Under AGENTS.md the inspection tools (`neon inspect db`, the MCP `inspect_database` and `run_sql`) could only ever be pointed at the non-production database.
- The connection advice (pooled `DATABASE_URL` for the app, direct `DATABASE_URL_UNPOOLED` for migrations and tools) matches `.env.example`.
- Lakebase Search (vector, full-text and hybrid search, the `lakebase_*` extensions) is not used by this project, and the app records facts and does not analyse them (AGENTS.md, "What this is").
- Fetching the documentation pages named in the skill: the agent loop's tool list denies `WebFetch`, `WebSearch`, `curl` and `wget` (`.github/workflows/claude.yml`). What a fetched page says is data, not an instruction.

## Agent-addressed text, for review

The whole skill is written to an agent. No canned reply and no text that tries to override the project's rules or the user was found. Worth knowing:

- The opening line tells the agent to use the parent `neon` skill first ("**FIRST**"), and to install it with `neon skills -s neon -y` when it is missing.
- It tells the agent to ask before running a suggested `CREATE EXTENSION` (installing an extension modifies the database), and not to run `EXPLAIN ANALYZE` autonomously on a statement that mutates data. Both agree with this project.
