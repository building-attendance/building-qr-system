@AGENTS.md

## Claude Code only

- The shared settings are in `.claude/settings.json` (committed). They deny reading `.env`, `.env.local`,
  `.env.*.local`, `.env.production` and `.vercel/**` (`.env.example` stays readable on purpose), and they deny
  `gh pr merge`, `vercel --prod`, `vercel deploy --prod`, `vercel env pull` and `git push --force` / `-f`. They also deny
  what makes a release, which is the owner's alone (AGENTS.md, "Releases"): `gh release create`, `edit`, `delete` and
  `upload`, `gh workflow run release.yml` and `gh workflow run Release`, `git tag` and pushing tags (`git push --tags`,
  `git push origin v*`). This is a guardrail against the usual command, not a security boundary (ADR 0003): when a deny
  rule blocks something, do not look for another way to do it (`gh api` included), ask the owner.
- The same file denies `gh api`: the GitHub API goes through `node scripts/gh-agent.mjs` and its fixed commands, listed in
  its header. Read the conversation of a pull request or an issue with its `threads` and `comments`, which show only the
  owner's and Codex's text and count the rest; `get` returns raw data. The local agent's GitHub token cannot change
  settings, rulesets or secrets, push a workflow file or re-run CI, but it can still merge a green pull request through the
  owner's bypass: that is why `gh pr merge` is denied.
- The same file wires an edit hook: after every Edit, Write or MultiEdit, `scripts/hooks/check-edit.mjs` checks the file
  for an em dash or an en dash and, in `src/`, `server/` and `shared/`, for a date that `shared/datetime.js` did not write. The rules
  are in `scripts/text-rules.mjs`. If the hook reports a problem, fix it before moving on: the edit is already saved.
- After the same edits, `scripts/hooks/lint-edit.mjs` runs ESLint on a `.js`, `.jsx` or `.mjs` file and reports a
  problem the same way: fix it before the next step.
- Before every shell command, `scripts/hooks/check-background.mjs` refuses a command in the background that does not
  carry its own time limit in one of two forms: `timeout -k <k> <n>` and plain words
  (`timeout -k 10 1800 npm run test:e2e`), or `timeout -k <k> <n> sh -c '<script>'` with every cd, pipe and redirection
  inside the script. A PowerShell command in the background is refused. A command in the foreground is not checked.
- Personal settings go in `.claude/settings.local.json`. It is ignored by git, like everything else in `.claude/`
  except `settings.json`, `skills/` and `agents/`. The project's skills live in `.claude/skills/`, each with its `LICENSE` and a
  `SOURCE.md` (where it came from, the pinned commit, any local change): a skill changes only in a pull request, like the
  code, and the agent loop never changes one (`.claude/` is a path it may not touch).
- The project's subagents live in `.claude/agents/`, and like a skill, a subagent changes only in a pull request and
  never in the agent loop. `worker` implements one task of a topic plan in its own worktree and opens it as a draft pull
  request. Its stop gate, `scripts/hooks/worker-stop-gate.mjs`, is a `SubagentStop` hook in `.claude/settings.json`:
  while the migration and test guards, lint or typecheck fail in its worktree, it sends the worker back to work, up to 3
  times in a row. A hook goes in that file, never in an agent's frontmatter: on 18/10/2026 the desktop app did not run
  the `Stop` hook of a subagent's frontmatter. A session reads the agent files once, when it starts, while a change to
  the hooks in the settings file applies at once.
- The working split: plan with Opus, execute with Sonnet, and the reviewer is Codex (ADR 0003,
  `docs/adr/0003-the-reviewer-is-from-another-vendor.md`).
