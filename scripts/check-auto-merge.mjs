// The decision of the auto-merge workflow (.github/workflows/auto-merge.yml): may this pull request merge without the
// owner's click? The rule is AGENTS.md, "Git and pull requests" (the paragraph "One workflow may merge too", owner decision
// of 16/10/2026); this file is that rule as code, and tests/check-auto-merge.test.js has a test for each condition.
//
// Usage: node scripts/check-auto-merge.mjs --read      (the workflow: reads the pull request from GitHub's API, then decides)
//        node scripts/check-auto-merge.mjs < input.json  (decides on a document read before, for example a saved one)
// Both print the decision as one JSON document. With --read the environment gives GH_TOKEN (read access is enough), REPO
// ("owner/name"), PR_NUMBER, DEFAULT_BRANCH and LIVE; any answer of the API that is not a success stops it with an error.
//
// The document is read from GitHub's API alone, never from a checkout of the pull request (readInput):
// { repository, default_branch, live, pr, files, checks, compare, comments, threads }.
//   repository, default_branch   this repository ("owner/name") and its default branch, from the event
//   live                         false in the dry run (only a comment), true when the workflow merges for real
//   pr                           GET /repos/{repo}/pulls/{n}
//   files                        GET /repos/{repo}/pulls/{n}/files?per_page=100 (one page: more than 100 files refuses)
//   checks                       GET /repos/{repo}/commits/{head}/check-runs?per_page=100
//   compare                      { behind_by } of GET /repos/{repo}/compare/{default_branch}...{head}
//   comments, threads            the pull request's `comments(last: 100)` and `reviewThreads(first: 100)` from GraphQL,
//                                which says who wrote a comment (`author`) and who edited it last (`editor`); REST does not
// The workflow reads and decides twice when it is live: once to decide and comment, and again in the merge job just before
// the merge, so that a label, a title or a Codex review that changed in between (with the same head commit) still stops it.
// Node built-ins only: the workflow checks out this one file from the default branch and runs it with no `npm ci`. Its name
// (scripts/check-*) keeps it out of the agent loop's reach (AGENTS.md, "The agent loop").
//
// Fail closed: every condition is checked on its own and adds a reason when it does not hold, and anything that cannot be
// read in full (a missing field, an unknown format, a list that may be cut off) is a reason too. Only a decision with no
// reason merges, and then only the head commit that was decided on (mergeRequest).
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** The owner's GitHub login: only a pull request that the owner opened can be in the class. */
export const OWNER_LOGIN = 'MatanBaruch1988'
/**
 * The Codex review bot, as GraphQL names it: an actor of type Bot whose login is this (REST writes the same account as
 * `chatgpt-codex-connector[bot]` with `type: "Bot"`). A person cannot be of type Bot, so a person's account with the same
 * login is refused by the type.
 */
export const CODEX_LOGIN = 'chatgpt-codex-connector'
/** The account of the workflow's own GITHUB_TOKEN, which writes the decision comment (`github-actions[bot]` in REST). */
export const ACTIONS_LOGIN = 'github-actions'
/** The GitHub Actions app: the only source of the four required checks, as in .github/rulesets/master-gates.json. */
export const GITHUB_ACTIONS_APP_ID = 15368
/** The four checks that master-gates requires, by their job names in .github/workflows/ci.yml. */
export const REQUIRED_CHECKS = Object.freeze(['guards', 'unit', 'e2e (android-chrome)', 'e2e (iphone-webkit)'])
/** One page of the files API. A pull request with more files is refused rather than read in parts. */
export const MAX_FILES = 100
/** The label that lets a pull request remove or switch off a test (scripts/check-tests.mjs): never merged without the owner. */
export const OVERRIDE_LABEL = 'allow-test-removal'
/** The hidden JSON that the Codex review bot keeps in its summary comment. */
export const CODEX_STATE_MARKER = 'codex-review-state:v1'
/** The first line of the workflow's own comment, one per head commit: `<!-- auto-merge:v1 head=<sha> -->`. */
export const COMMENT_MARKER = 'auto-merge:v1'

const SHA = /^[0-9a-f]{40}$/
/** test or docs, an optional scope, an optional `!` (refused below, with its own reason), a colon and a description. */
const TITLE = /^(test|docs)(?:\(([a-z0-9-]+)\))?(!)?: \S/
/** The branches of the agents: the agent loop pushes claude/..., Codex pushes codex/... (D6 of the plan). */
const AGENT_BRANCH = /^(?:claude|codex)\//i

/** What the class allows, matched on the path exactly as GitHub lists it (case-sensitive). */
const ALLOWED = Object.freeze([
  /^tests\/./,
  /^e2e\/./,
  /^docs\/(?:[^/]+\/)*[^/]+\.md$/,
  /^docs\/screenshots\/[^/]+\.png$/,
  /^README\.md$/,
  /^CONTRIBUTING\.md$/,
])

const CI_PARTS = ['e2e/parts.js', 'e2e/part-weights.json', 'tests/time-sequencer.js']

/**
 * What the class keeps out even where ALLOWED matches. Matched on the path in lower case, so that a change of case cannot
 * get around an entry (Windows and macOS check out `Docs/Privacy.md` and `docs/privacy.md` as the same file).
 */
const DENIED = Object.freeze([
  { match: (p) => p.split('/').some((part) => part.startsWith('.')), why: 'a hidden file or folder (.claude, .github, .env and the like)' },
  { match: (p) => /(?:^|\/)(?:agents|claude)\.md$/.test(p), why: 'the project rules (AGENTS.md or CLAUDE.md, in any folder)' },
  { match: (p) => p.startsWith('e2e/') && p.endsWith('.png'), why: 'a visual baseline (the owner approves pictures by eye)' },
  { match: (p) => p === 'e2e/a11y-baseline.js' || p === 'e2e/a11y-report.js', why: 'the accessibility baseline and how every scan is judged' },
  { match: (p) => p === 'tests/design-budget.json', why: 'the design budget' },
  { match: (p) => p === 'e2e/fixtures.js' || p === 'e2e/global-teardown.js', why: 'what every E2E test runs with' },
  { match: (p) => /^tests\/setup-[^/]+$/.test(p) || p === 'tests/helpers.js', why: 'what every unit test (or every database test) runs with' },
  { match: (p) => CI_PARTS.includes(p), why: 'how CI splits the tests into parts' },
  { match: (p) => p === 'tests/check-auto-merge.test.js', why: 'the tests of this gate' },
  { match: (p) => p === 'security.md' || p === 'license', why: 'the security policy or the licence' },
  { match: (p) => p === 'docs/privacy.md', why: 'the privacy record' },
  { match: (p) => p.startsWith('docs/adr/'), why: 'a decision record' },
  { match: (p) => p.startsWith('docs/runbooks/'), why: 'a runbook' },
  { match: (p) => p === 'docs/design.md' || p === 'docs/design/sources.md', why: 'the design rules' },
])

/** What the comment lists when every condition holds: the reasons to merge. */
export const CONDITIONS = Object.freeze([
  'open, not a draft, into the default branch, from a branch of this repository',
  'opened by the owner, from a branch that is neither claude/ nor codex/',
  'a test or docs title, with no ! and not the scope rules',
  `every file added or modified, at most ${MAX_FILES}, all inside the class`,
  `no ${OVERRIDE_LABEL} label`,
  `${REQUIRED_CHECKS.join(', ')}: green on the head, from GitHub Actions`,
  'a Codex review of exactly the head, completed, with no finding',
  'every review conversation resolved',
  'up to date with the default branch',
])

/** Text from the pull request made safe to print in a comment or a log: plain characters only, never longer than 100. */
export function clean(text) {
  return String(text).replace(/[^A-Za-z0-9._/+-]/g, '?').slice(0, 100)
}

const short = (sha) => (typeof sha === 'string' && SHA.test(sha) ? sha.slice(0, 7) : 'unknown')
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

/** Why a file is not in the class, or null when it is. */
export function fileProblem(file) {
  if (!isObject(file) || typeof file.filename !== 'string' || file.filename === '') return 'a file that cannot be read'
  const name = file.filename
  if (file.status === 'removed') return `${clean(name)}: removed (only added or modified files are in the class)`
  if (file.status === 'renamed') {
    return `${clean(name)}: renamed from ${clean(file.previous_filename ?? '?')} (only added or modified files are in the class)`
  }
  if (file.status !== 'added' && file.status !== 'modified') return `${clean(name)}: ${clean(file.status ?? 'no status')}, not added or modified`
  const denied = DENIED.find((entry) => entry.match(name.toLowerCase()))
  if (denied) return `${clean(name)}: kept out of the class (${denied.why})`
  if (!ALLOWED.some((pattern) => pattern.test(name))) {
    return `${clean(name)}: not in the class (tests/, e2e/, docs/**/*.md, docs/screenshots/*.png, README.md, CONTRIBUTING.md)`
  }
  return null
}

/** The JSON that the Codex review bot keeps in a comment, or null when the comment has none or it does not parse. */
export function codexState(body) {
  if (typeof body !== 'string') return null
  const open = `<!-- ${CODEX_STATE_MARKER} `
  const start = body.indexOf(open)
  if (start === -1) return null
  const end = body.indexOf(' -->', start + open.length)
  if (end === -1) return null
  try {
    const state = JSON.parse(body.slice(start + open.length, end))
    return isObject(state) ? state : null
  } catch {
    return null
  }
}

const isCodexBot = (actor) => isObject(actor) && actor.__typename === 'Bot' && actor.login === CODEX_LOGIN

function titleReasons(title) {
  if (typeof title !== 'string') return ['the title cannot be read']
  const match = TITLE.exec(title)
  if (!match) return ['the title is not a test or docs title (test: ..., docs: ..., or with a scope)']
  const reasons = []
  if (match[3]) reasons.push('the title marks a breaking change (!)')
  if (match[2] === 'rules') reasons.push('the scope is rules: a change of the rules is never in the class')
  return reasons
}

function fileReasons(pr, files) {
  if (!Array.isArray(files)) return ['the list of files cannot be read']
  const count = pr.changed_files
  if (!Number.isInteger(count)) return ['the number of changed files cannot be read']
  if (count > MAX_FILES) return [`${count} changed files: more than ${MAX_FILES} cannot be read in one page`]
  if (files.length !== count) return [`the list of files is incomplete (${files.length} of ${count})`]
  if (count === 0) return ['no changed file']
  const problems = files.map(fileProblem).filter(Boolean)
  const shown = problems.slice(0, 20)
  if (problems.length > shown.length) shown.push(`and ${problems.length - shown.length} more files`)
  return shown
}

function labelReasons(labels) {
  if (!Array.isArray(labels)) return ['the labels cannot be read']
  const names = labels.map((label) => (isObject(label) ? label.name : label))
  if (names.some((name) => typeof name !== 'string')) return ['a label cannot be read']
  return names.includes(OVERRIDE_LABEL) ? [`the label ${OVERRIDE_LABEL} is on it`] : []
}

function checkReasons(checks, head) {
  if (!isObject(checks) || !Array.isArray(checks.check_runs) || !Number.isInteger(checks.total_count)) {
    return ['the check runs cannot be read']
  }
  if (checks.total_count > checks.check_runs.length) {
    return [`the check runs are incomplete (${checks.check_runs.length} of ${checks.total_count})`]
  }
  const reasons = []
  for (const name of REQUIRED_CHECKS) {
    const named = checks.check_runs.filter((run) => isObject(run) && run.name === name)
    if (named.some((run) => !isObject(run.app) || run.app.id !== GITHUB_ACTIONS_APP_ID)) {
      reasons.push(`a check named ${name} was reported by an app other than GitHub Actions`)
      continue
    }
    if (named.length === 0) {
      reasons.push(`${name} has not run on the head commit`)
    } else if (named.some((run) => run.head_sha !== head)) {
      reasons.push(`${name} ran on another commit`)
    } else if (named.some((run) => run.status !== 'completed')) {
      reasons.push(`${name} has not finished`)
    } else if (named.some((run) => run.conclusion !== 'success')) {
      const failed = named.find((run) => run.conclusion !== 'success')
      reasons.push(`${name} did not pass (${clean(failed.conclusion ?? 'no conclusion')})`)
    }
  }
  return reasons
}

function codexReasons(comments, head) {
  if (!isObject(comments) || !Array.isArray(comments.nodes) || !Number.isInteger(comments.totalCount)) {
    return ['the comments cannot be read']
  }
  if (comments.totalCount > comments.nodes.length) {
    return [`more comments than can be read in full (${comments.totalCount}), so the Codex review cannot be found for sure`]
  }
  const summaries = comments.nodes.filter((node) => isObject(node) && isCodexBot(node.author) && codexState(node.body) !== null)
  const marked = comments.nodes.filter(
    (node) => isObject(node) && isCodexBot(node.author) && typeof node.body === 'string' && node.body.includes(CODEX_STATE_MARKER),
  )
  if (marked.length > summaries.length) return ['the Codex review state cannot be read']
  if (summaries.length === 0) return ['no Codex review summary on the pull request']
  if (summaries.length > 1) return ['more than one Codex review summary on the pull request']
  const [summary] = summaries
  if (summary.editor !== null && summary.editor !== undefined && !isCodexBot(summary.editor)) {
    return ['the Codex review summary was last edited by someone other than the Codex bot']
  }
  const review = codexState(summary.body).code_review
  if (!isObject(review)) return ['the Codex review state has no code review']
  const reasons = []
  if (review.commit_sha !== head) reasons.push(`Codex reviewed another commit (${short(review.commit_sha)}), not the head`)
  if (review.status !== 'completed') reasons.push(`the Codex review is not completed (${clean(review.status ?? 'no status')})`)
  if (review.has_any_findings !== false) reasons.push('the Codex review has findings, or does not say that it has none')
  return reasons
}

function threadReasons(threads) {
  if (!isObject(threads) || !Array.isArray(threads.nodes) || !Number.isInteger(threads.totalCount)) {
    return ['the review conversations cannot be read']
  }
  if (threads.totalCount > threads.nodes.length) {
    return [`more review conversations than can be read in full (${threads.totalCount})`]
  }
  const open = threads.nodes.filter((thread) => !isObject(thread) || thread.isResolved !== true).length
  return open > 0 ? [`${plural(open, 'review conversation is', 'review conversations are')} not resolved`] : []
}

/**
 * The decision. Every argument is an answer of GitHub's API as the header describes it; `target` is
 * { repository, branch, behindBy }: this repository, its default branch, and how many commits the head is behind it.
 * Returns { merge, reasons }: merge is true only when there is no reason.
 */
export function decide(pr, files, labels, checks, codexComments, threads, target) {
  if (!isObject(pr)) return { merge: false, reasons: ['the pull request cannot be read'] }
  if (!isObject(target) || typeof target.repository !== 'string' || typeof target.branch !== 'string') {
    return { merge: false, reasons: ['the repository and its default branch are not known'] }
  }
  const reasons = []
  const head = isObject(pr.head) && typeof pr.head.sha === 'string' && SHA.test(pr.head.sha) ? pr.head.sha : null

  if (!Number.isInteger(pr.number) || pr.number < 1) reasons.push('the number of the pull request cannot be read')
  if (pr.state !== 'open') reasons.push('the pull request is not open')
  if (pr.draft !== false) reasons.push('the pull request is a draft')
  if (!isObject(pr.base) || pr.base.ref !== target.branch || pr.base.repo?.full_name !== target.repository) {
    reasons.push(`the pull request is not into ${clean(target.branch)} of this repository`)
  }
  if (!isObject(pr.head) || !isObject(pr.head.repo) || pr.head.repo.full_name !== target.repository) {
    reasons.push('the pull request comes from a fork, or its branch is gone')
  }
  if (!head) reasons.push('the head commit cannot be read')
  if (!isObject(pr.user) || pr.user.login !== OWNER_LOGIN || pr.user.type !== 'User') {
    reasons.push('the pull request was not opened by the owner')
  }
  const branch = isObject(pr.head) ? pr.head.ref : undefined
  if (typeof branch !== 'string' || branch === '') reasons.push('the branch name cannot be read')
  else if (AGENT_BRANCH.test(branch)) reasons.push('the branch is an agent branch (claude/ or codex/)')

  reasons.push(...titleReasons(pr.title))
  reasons.push(...fileReasons(pr, files))
  reasons.push(...labelReasons(labels))
  reasons.push(...(head ? checkReasons(checks, head) : []))
  reasons.push(...(head ? codexReasons(codexComments, head) : []))
  reasons.push(...threadReasons(threads))

  if (!Number.isInteger(target.behindBy) || target.behindBy < 0) reasons.push('how far the branch is behind cannot be read')
  else if (target.behindBy > 0) {
    reasons.push(`the branch is ${plural(target.behindBy, 'commit', 'commits')} behind ${clean(target.branch)}: bring it up to date first`)
  }

  return { merge: reasons.length === 0, reasons }
}

/**
 * The body of the merge call, PUT /repos/{repo}/pulls/{n}/merge. `sha` is the head that was decided on, so GitHub refuses
 * the merge when anything was pushed since; the title and the message are the ones that were decided on, written the way
 * the repository's own squash merge writes them (the title with the number, the description as the message).
 */
export function mergeRequest(pr) {
  if (!isObject(pr) || !isObject(pr.head) || !SHA.test(pr.head.sha ?? '') || !Number.isInteger(pr.number) || typeof pr.title !== 'string') {
    throw new Error('mergeRequest needs a pull request with its number, title and head commit')
  }
  return {
    sha: pr.head.sha,
    merge_method: 'squash',
    commit_title: `${pr.title} (#${pr.number})`,
    commit_message: typeof pr.body === 'string' ? pr.body : '',
  }
}

/** A pull request whose decision is written as a comment: open, ready, with a test or docs title. Others get the run's summary only. */
export function isCandidate(pr) {
  return isObject(pr) && pr.state === 'open' && pr.draft === false && typeof pr.title === 'string' && /^(?:test|docs)[(!:]/.test(pr.title)
}

/** The id of this workflow's comment for this head commit, or null. Only a comment that the workflow's own account wrote counts. */
export function existingComment(comments, head) {
  if (!isObject(comments) || !Array.isArray(comments.nodes) || !SHA.test(head ?? '')) return null
  const first = `<!-- ${COMMENT_MARKER} head=${head} -->`
  const found = comments.nodes.find(
    (node) =>
      isObject(node) &&
      isObject(node.author) &&
      node.author.__typename === 'Bot' &&
      node.author.login === ACTIONS_LOGIN &&
      typeof node.body === 'string' &&
      node.body.startsWith(first) &&
      Number.isInteger(node.databaseId),
  )
  return found ? found.databaseId : null
}

const RULE = 'AGENTS.md, "Git and pull requests"'

/** The text of the decision, for the comment (with its first line, the marker) and for the summary of the run. */
export function decisionText({ merge, reasons }, head, live) {
  const mode = live ? 'Auto-merge' : 'Auto-merge, dry run'
  const verdict = merge ? (live ? 'merging' : 'would merge') : live ? 'will not merge' : 'would not merge'
  const lines = [`### ${mode}: ${verdict} \`${short(head)}\``, '']
  if (merge) {
    lines.push(`Every condition of the rule (${RULE}) holds for this head commit:`, '')
    lines.push(...CONDITIONS.map((condition) => `- ${condition}`))
  } else {
    lines.push(`The rule (${RULE}) does not let this head commit merge by itself, because:`, '')
    lines.push(...reasons.map((reason) => `- ${reason}`))
  }
  lines.push('')
  lines.push(
    live
      ? 'Decided by `.github/workflows/auto-merge.yml` with `scripts/check-auto-merge.mjs`, from GitHub\'s API alone.'
      : 'This is a dry run: nothing is merged, and the owner merges as before. Decided by `.github/workflows/auto-merge.yml` with `scripts/check-auto-merge.mjs`, from GitHub\'s API alone.',
  )
  return lines.join('\n')
}

/** The comment after a merge that went through. */
export function mergedText(head) {
  return [
    `<!-- ${COMMENT_MARKER} head=${head} -->`,
    `### Auto-merge: merged automatically \`${short(head)}\``,
    '',
    `Every condition of the rule (${RULE}) held for this head commit, so the auto-merge App merged it:`,
    '',
    ...CONDITIONS.map((condition) => `- ${condition}`),
  ].join('\n')
}

/**
 * Everything the workflow needs from one input document: the decision, the comment to write (and whether to write it at
 * all), the merge call, and the comment after the merge. Never throws on a bad document: it refuses instead.
 */
export function run(input) {
  const doc = isObject(input) ? input : {}
  const pr = isObject(doc.pr) ? doc.pr : null
  const head = pr && isObject(pr.head) && SHA.test(pr.head.sha ?? '') ? pr.head.sha : null
  const live = doc.live === true
  const target = {
    repository: doc.repository,
    branch: doc.default_branch,
    behindBy: isObject(doc.compare) ? doc.compare.behind_by : undefined,
  }
  const decision = decide(pr, doc.files, pr?.labels, doc.checks, doc.comments, doc.threads, target)
  const text = decisionText(decision, head, live)
  return {
    merge: decision.merge,
    reasons: decision.reasons,
    number: pr && Number.isInteger(pr.number) ? pr.number : null,
    head_sha: head,
    summary: text,
    comment: {
      post: head !== null && isCandidate(pr),
      id: existingComment(doc.comments, head),
      body: `<!-- ${COMMENT_MARKER} head=${head} -->\n${text}`,
    },
    merge_request: decision.merge ? mergeRequest(pr) : null,
    merged_body: decision.merge ? mergedText(head) : null,
  }
}

/**
 * The GraphQL query of the comments and the review conversations. At most 100 of each: decide() refuses a pull request
 * that has more, because what was not read could hold the review or an open conversation.
 */
export const CONVERSATION_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { totalCount nodes { isResolved } }
      comments(last: 100) {
        totalCount
        nodes { databaseId body author { login __typename } editor { login __typename } }
      }
    }
  }
}`

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const NUMBER = /^[1-9][0-9]{0,9}$/
const BRANCH = /^[A-Za-z0-9._/-]+$/
const API_URL = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/[A-Za-z0-9._/-]*)?$/

/**
 * Reads the document of run() from GitHub's API, with the token in env.GH_TOKEN, for the pull request env.PR_NUMBER of
 * env.REPO. Throws on anything unexpected (a value of the environment that does not look right, an answer that is not a
 * success, a GraphQL error, a head commit that is not a SHA): the job then stops, and nothing is merged. The messages name
 * the call and the status, never the token.
 */
export async function readInput(env, fetchImpl = fetch) {
  const { REPO: repository, PR_NUMBER: number, DEFAULT_BRANCH: branch, GH_TOKEN: token } = env
  if (!REPOSITORY.test(repository ?? '')) throw new Error('REPO is not owner/name')
  if (!NUMBER.test(number ?? '')) throw new Error('PR_NUMBER is not the number of a pull request')
  if (!BRANCH.test(branch ?? '') || branch.startsWith('-')) throw new Error('DEFAULT_BRANCH is not a branch name')
  if (typeof token !== 'string' || token === '') throw new Error('GH_TOKEN is not set')
  const api = env.GITHUB_API_URL || 'https://api.github.com'
  if (!API_URL.test(api)) throw new Error('GITHUB_API_URL is not an https address')

  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}${route}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'auto-merge-workflow',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`${method} ${route.split('?')[0]}: HTTP ${response.status}`)
    return response.json()
  }

  const pr = await call('GET', `/repos/${repository}/pulls/${number}`)
  const head = isObject(pr) && isObject(pr.head) ? pr.head.sha : undefined
  if (!SHA.test(head ?? '')) throw new Error('the head commit of the pull request is not a SHA')
  const files = await call('GET', `/repos/${repository}/pulls/${number}/files?per_page=${MAX_FILES}`)
  const checks = await call('GET', `/repos/${repository}/commits/${head}/check-runs?per_page=100`)
  const compare = await call('GET', `/repos/${repository}/compare/${branch}...${head}`)
  const [owner, name] = repository.split('/')
  const graph = await call('POST', '/graphql', { query: CONVERSATION_QUERY, variables: { owner, name, number: Number(number) } })
  if (!isObject(graph) || graph.errors !== undefined) throw new Error('POST /graphql: the answer has errors')
  const pull = graph.data?.repository?.pullRequest
  return {
    repository,
    default_branch: branch,
    live: env.LIVE === 'true',
    pr,
    files,
    checks,
    compare: { behind_by: isObject(compare) ? compare.behind_by : undefined },
    comments: pull?.comments,
    threads: pull?.reviewThreads,
  }
}

async function main() {
  if (process.argv.includes('--read')) {
    let input
    try {
      input = await readInput(process.env)
    } catch (error) {
      // exitCode and not exit(): the timer of a refused request may still be open, and the output stays empty.
      console.error(`check-auto-merge: could not read the pull request: ${error.message}`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${JSON.stringify(run(input))}\n`)
    return
  }
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    console.error('check-auto-merge: the input on stdin is not JSON.')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(run(input))}\n`)
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
