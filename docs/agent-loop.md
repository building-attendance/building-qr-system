# The agent loop

A coding agent can also work from GitHub, without anybody's computer: the owner writes a task, a workflow runs Claude on
GitHub's runners with the owner's Claude subscription, and everything after that is the normal pull request flow
([`.github/workflows/claude.yml`](../.github/workflows/claude.yml),
[`.github/workflows/claude-review.yml`](../.github/workflows/claude-review.yml),
[ADR 0006](adr/0006-the-agent-loop-in-github-actions.md)).

This page is the procedure and the reasoning that the other places do not carry. The rules that every agent follows are
in [`AGENTS.md`](../AGENTS.md), "The agent loop". The decision and its consequences are in the ADR. The exact limits (the
count of agent branches, the turns and minutes, the tool lists, the check after a run) are written once, in the headers of
the two workflows, and they are not copied here.

## How a task runs

1. Anybody can fill in the "Agent task" issue form, and it starts nothing. The owner reads the issue and its comments. A
   task that a stranger wrote is rewritten by the owner in his own words first, because the agent works from the text of
   the issue, so that text is its prompt.
2. The owner adds the label `agent:go`. Claude works on a branch `claude/issue-<number>-...`, runs the checks from the
   issue, pushes, and ends its comment on the issue with a "Create a PR" link whose title and body are filled in (the
   action never opens the pull request itself).
3. The owner opens the pull request from that link. CI runs, and Codex reviews it (ADR 0003).
4. To have findings addressed, the owner comments `@claude` in the conversation of the pull request (not as an inline
   comment on the diff: GitHub runs the workflow of an inline comment from the pull request itself, which could carry a
   changed copy of it). Claude checks each finding against the code and pushes the fixes to the same branch.
5. The owner merges. An agent never does.

Claude reads only the comments of the owner, of `claude[bot]` and of the Codex review bot: to hand it somebody else's
remark, quote it in your own comment.

## The other direction

A pull request that Codex wrote (its branch starts with `codex/`) is reviewed by Claude when the owner opens it or marks it
ready, and any other pull request of this repository is when the owner adds the label `review:claude` (if Codex opens its
pull request under a bot account, the label is how to ask for the review). Claude posts one comment and changes nothing.
There is no AI review on every push.

## Why this is safe enough

In the terms of the "lethal trifecta" (an agent is dangerous when it combines text from people it does not trust, private
data, and a way to send data out): the text comes only from an issue that the owner has read and rewritten, and comments
of strangers are hidden from it. The data is this public repository and a throwaway Postgres container, with no
production secret and no committee data (the process holds only the Claude token and a GitHub token for this one
repository, both revocable: [`runbooks/secrets.md`](runbooks/secrets.md)). The way out is narrowed by the tool lists (no
network tool), and the runner's traffic is audited now and will be limited to the endpoints that it needs. Cutting any one
of the three is enough: the loop narrows all of them, and the strongest cut is that nobody but the owner can start it.

## Where the limits are written

| Limit | Where |
|---|---|
| Who can start an agent (the owner only, never from a fork, `allowed_bots` and `allowed_non_write_users` never set) | The headers of both workflows, "Who can start it"; ADR 0006 |
| At most 2 agent branches that are not merged or deleted; one run at a time for everything that makes a new branch; 30 turns and 45 minutes (a review is 15 turns) | The header of `claude.yml`, the first step and the `concurrency` block; `claude-review.yml` |
| No network tools, no merge, no deploy, no force-push; the shell limited to listed commands | The header of `claude.yml`, "Why the tool lists are what they are"; a change to those lists is a P1 finding in the Code Review Rules of `AGENTS.md` |
| The paths that no agent may change, and the job `check` that reads what a run pushed | The header of `claude.yml`, "What is checked after the run"; ADR 0006 |
| The rules come from `master`, never from the branch | The headers of both workflows, "Where the rules come from" and "Which rules it applies"; ADR 0006 |
