# Branch rulesets for the default branch

The rulesets apply to the repository's default branch (`~DEFAULT_BRANCH`: `master` here, often `main` in a copy), so a
copy needs no edit to them. The file names keep `master` from this repository.

`master-gates.json` protects the default branch for everybody, with no bypass: it cannot be deleted or force-pushed,
every change arrives through a pull request that is squash-merged (no approval is needed, so you can merge your own),
and the branch must be up to date with the default branch with all four CI checks green: `guards`, `unit`, `e2e (android-chrome)`
and `e2e (iphone-webkit)` (the job names in `.github/workflows/ci.yml`; `unit` and each e2e check are jobs that pass
only when every one of their parts passed, and the parts, `unit part <n>` and `e2e (<project>) part <n>`, are not
required by name). Each check is bound to GitHub Actions
(`integration_id` 15368 is the GitHub Actions app), so nothing else can report a status under the same name.

It also requires every review conversation of the pull request to be resolved before it merges
(`required_review_thread_resolution`). A conversation is what an inline review comment opens, such as a finding of the
Codex review: whoever answers the finding (a fix, or a short reply that says why no change is needed) then marks the
conversation resolved, and only then can the pull request merge. It is here, with no bypass, because on 11/10/2026
four pull requests merged with a finding that had arrived 4 to 34 minutes before the merge and was not handled yet
(#172, #177, #182, #184), and each one cost a follow-up pull request. It cannot catch a finding that arrives after the
merge, so the owner still waits for the review.

`master-approval.json` adds a second person: one approving review is required, it must come from a code owner
(`.github/CODEOWNERS`), and it does not survive a push made after it (stale reviews are dismissed). The repository admin
role may bypass it on a pull request, and that is every repository administrator, not only the owner. GitHub cannot tell
the owner from an agent that runs with the owner's own `gh` login or token, so a local agent could merge as an admin:
local agents must never merge. `.claude/settings.json` denies `gh pr merge` to Claude Code, but that is a guardrail
against the usual command, not a security boundary (`docs/adr/0003-the-reviewer-is-from-another-vendor.md`): the habit of
never merging matters more than the setting. An agent in GitHub Actions runs as its own app, which is not an admin, so
it needs the approval like anybody else. The two rulesets add up, so the checks and the squash rule still hold.

The agent loop (`.github/workflows/claude.yml`, ADR 0006) works through the Claude GitHub App: it pushes branches
named `claude/...` and comments, and the owner opens the pull request from the link in its comment. The app is not
an admin and is not in `bypass_actors`, so a pull request of the agent needs the owner's approval like anybody else's,
and the owner merges. The rulesets protect the default branch only, so the app can push its own `claude/` branches, but
never the default branch itself.

A pull request can change its own workflow and guard scripts, and the checks that run on it are the changed ones. So a
change under `.github/` or to `scripts/check-*` needs the owner's careful look: green checks are not proof that the
checks themselves were not weakened.

The files are the exact request body of GitHub's "Create a repository ruleset" API; a ruleset is only enforced once it
has been created that way (or in the repository settings). Apply each one once, from the repository root, and only after
the four checks have run green once (a required check that has never run blocks every pull request). `gh` fills in
`{owner}` and `{repo}` from the repository of the current folder:

```
gh api --method POST repos/{owner}/{repo}/rulesets --input .github/rulesets/master-gates.json
gh api --method POST repos/{owner}/{repo}/rulesets --input .github/rulesets/master-approval.json
```

To change one later, send the edited file with `gh api --method PUT repos/{owner}/{repo}/rulesets/<id> --input <file>`
(the ids are listed by `gh api repos/{owner}/{repo}/rulesets`).

## The auto-merge App (coming: not in `master-approval.json` yet)

`.github/workflows/auto-merge.yml` may merge one narrow class of pull requests without the owner's click: a `test` or
`docs` pull request that the owner opened, whose files are only component tests, E2E tests and documents and whose commits
are all by a person's GitHub account with no Codex co-author, and that is clean in every way
(AGENTS.md, "Git and pull requests", the paragraph "One workflow may merge too"; the exact conditions are in
`scripts/check-auto-merge.mjs`). It starts in a dry run that only comments (`LIVE: false` in the workflow), and nothing in
this folder changes for it until the owner sets up its GitHub App. That App is the only new actor, and this is what it may
do.

- **What it can do.** Merge a pull request through the API, nothing else. The workflow mints its token for this repository
  only, with `contents: write` only (GitHub lists the merge endpoint under "Contents"), for one job, and the token is
  revoked when the job ends. Just before the merge the workflow reads the pull request again and decides again, so a
  change since the first decision (a label, the title, a new Codex finding) stops it, and the merge call carries the head
  commit that was decided on (`sha`), so GitHub refuses it when anything was pushed after the decision.
- **Why it cannot touch `master-gates`.** It is added to the `bypass_actors` of `master-approval` only, with
  `bypass_mode: pull_request`: it skips the code-owner approval of a pull request, and nothing more. `master-gates` keeps an
  empty `bypass_actors`, so a merge by the App still needs the four checks green and up to date, every conversation
  resolved and the squash method, and the App can never push to the default branch or delete it.
- **Where its key lives.** In the environment `auto-merge`, never among the repository secrets. Its deployment branch
  policy allows the default branch only, so a workflow that runs for a pull request (whose ref is never the default
  branch) cannot read the key. The workflow reads it in one step of one job, which is skipped while `LIVE` is false.

### Set it up (the owner, once, before the pull request that turns `LIVE` on)

1. Create a GitHub App owned by the account that owns the repository (the organization `building-attendance` here: its
   Settings, Developer settings, GitHub Apps), installable only on that account: no webhook, the repository permission
   **Contents: Read and write** and nothing else (GitHub adds Metadata: Read-only by itself). Install it on this repository
   only. Generate a private key, and keep the `.pem` file out of the repository.
2. Create the environment and limit it to the default branch, before any secret goes into it. A run of a workflow that names
   an environment creates it, with no rules, so if `auto-merge` is already listed (`gh api repos/{owner}/{repo}/environments`),
   set the rule on that one:

   ```
   gh api --method PUT repos/{owner}/{repo}/environments/auto-merge \
     -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
   gh api --method POST repos/{owner}/{repo}/environments/auto-merge/deployment-branch-policies -f name=master -f type=branch
   ```

   (`master` is the default branch here; a copy writes its own.)
3. Put the App's client id and its key into that environment, from files, never on the command line:
   `gh secret set AUTO_MERGE_APP_CLIENT_ID --env auto-merge < client-id.txt` and
   `gh secret set AUTO_MERGE_APP_KEY --env auto-merge < app-key.pem`. Note both in `docs/runbooks/secrets.md`.
4. Add the App to `master-approval`. Its id is `gh api apps/<app-slug> --jq .id`. Add this entry to `bypass_actors` in
   `master-approval.json`, next to the repository admin role, and send the file with the `PUT` command above:

   ```
   { "actor_id": <the App's id>, "actor_type": "Integration", "bypass_mode": "pull_request" }
   ```

   The file in this folder does not have the entry yet, on purpose: a placeholder id would break whoever applies the file.
   The pull request that adds the real id is the owner's.

### Switch it off

- At once, for every pull request: disable the workflow (`gh workflow disable auto-merge.yml`, or the Actions tab), or take
  the App out of `bypass_actors` (send `master-approval.json` without its entry). Without the bypass, the approval rule
  refuses a merge by the App, so nothing merges even while the workflow runs.
- For one pull request: keep it a draft, or leave a conversation open. Either one is a reason, and the workflow does not
  merge it.
- For good: a pull request that sets `LIVE` back to `false`; then uninstall the App and delete the environment.

## The merge queue (an organization's repository, without a bypassed approval)

`master-merge-queue.json` makes every pull request merge through GitHub's merge queue. A pull request is added with
"Merge when ready"; the queue builds it on top of the default branch and of the pull requests ahead of it, runs the four
checks there (the `merge_group` trigger in `ci.yml`), and squash-merges it only if they pass ("all green"; one pull request
is enough to start, with no waiting). So nobody brings a pull request up to date by hand any more, and two pull requests
that pass alone but fail together never reach the default branch. It has no bypass.

It works only when a pull request can meet every other requirement without a bypass. A pull request joins the queue only
when all of them are met, and GitHub does not count a bypass there: the repository admin's bypass of `master-approval`
merges a pull request directly, but does not let it into the queue. So with `master-approval` the queue needs a code
owner who approves each pull request and who is neither its author nor its last pusher. This repository has one
maintainer, who opens and pushes every pull request and merges with that bypass, so it does not apply the file: on
07/10/2026 it was applied, the merge box showed "Merging is blocked" with "Merge when ready" greyed out and no bypass, and
the ruleset was removed the same day. The file stays for a copy where it works: one with a second person who approves,
or one with a single maintainer that applies `master-gates` without `master-approval` (`master-gates` requires no
approval, so there is nothing to bypass; not tried yet).

GitHub offers a merge queue only to repositories owned by an organization; a copy in a personal account skips this file.
An organization's copy where it works applies it after the other rulesets:

```
gh api --method POST repos/{owner}/{repo}/rulesets --input .github/rulesets/master-merge-queue.json
```
