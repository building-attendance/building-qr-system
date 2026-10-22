// The local agent's one way to GitHub's API: a few fixed commands on this repository. Node built-ins only.
//
// `gh api` is denied to Claude Code in .claude/settings.json (`Bash(gh api *)`), and this script does what the agent needs
// of it: reads on this repository, the conversation of a pull request with only what trusted authors wrote, and exactly
// three writes that the owner approved. One subcommand each, nothing else:
//   get <path>                    GET repos/building-attendance/building-qr-system[/<segments>][?<query>], printed as GitHub
//                                 answers it (JSON, or plain text for a job's logs)
//   threads <pr>                  the review threads of a pull request (one fixed GraphQL query)
//   comments <number>             the conversation of a pull request or an issue: its comments, and a pull request's reviews
//   resolve-thread <thread id>    the fixed resolveReviewThread mutation; the id is PRRT_ and 10 to 80 of [A-Za-z0-9_-],
//                                 and a fixed query first shows that the thread is in this repository
//   pr-body <pr> <file>           PATCH .../pulls/<pr> with the body read from <file>
//   reply <pr> <comment id> <file>  POST .../pulls/<pr>/comments/<comment id>/replies with the body read from <file>
// `threads` and `comments` print only what the owner (OWNER_LOGIN) or the Codex review bot (CODEX_LOGIN) wrote, the
// constants of scripts/check-auto-merge.mjs, and then one line per kind that says how many others they left out: text
// from anyone else is data that could try to give the agent orders. `get` returns raw data, so read a conversation through
// those two. A body <file> is a regular file inside the scratchpad (<temp>/claude) or this worktree, never one that git
// ignores there (an .env file, a dump) or one under .git, and at most 65,536 characters (GitHub's limit for a body).
//
// How: every call is execFileSync('gh' or 'git', [arguments]), never a shell, on the host github.com and the repository
// building-attendance/building-qr-system, which `git remote get-url origin` must name. The arguments are this script's own
// argv, each checked by one anchored pattern, and a value goes into a path only after its check. A refused input exits 2
// with one line that names the rule; a failed call of gh exits 1.
//
// This is a convenience and a filter, not a boundary: a deny rule catches the usual command, not every way to run a
// program (Claude Code's permissions page, read 22/10/2026), and `gh` itself stays in reach. The boundary is what the token
// of `gh` can do: since 22/10/2026 a fine-grained token of the owner for this repository alone, which cannot change a
// setting or a ruleset, read a secret or push a workflow, and which can still merge a green pull request through the
// owner's admin bypass (the topic "agent least privilege", its spike S1).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CODEX_LOGIN, OWNER_LOGIN } from './check-auto-merge.mjs'

export const OWNER = 'building-attendance'
export const NAME = 'building-qr-system'
export const REPOSITORY = `${OWNER}/${NAME}`
const HOST = 'github.com'
export const ORIGIN = /^https:\/\/github\.com\/building-attendance\/building-qr-system(\.git)?$/

/** The subcommands, their arguments, and whether they write. A new one is a change that tests/gh-agent.test.js shows. */
export const SUBCOMMANDS = Object.freeze({
  get: Object.freeze({ args: ['path'], writes: false }),
  threads: Object.freeze({ args: ['pr'], writes: false }),
  comments: Object.freeze({ args: ['number'], writes: false }),
  'resolve-thread': Object.freeze({ args: ['thread id'], writes: true }),
  'pr-body': Object.freeze({ args: ['pr', 'file'], writes: true }),
  reply: Object.freeze({ args: ['pr', 'comment id', 'file'], writes: true }),
})

// A path of this repository: segments of [A-Za-z0-9._-] and an optional query of [A-Za-z0-9_=&,.:/-] (the / and the : of a
// branch name such as chore/x, or head=owner:branch, are part of a value there, never of the path). No %, no second ?, no
// #, no backslash, no space; `..` anywhere and a segment of dots alone are refused by checkPath on top of this.
export const GET_PATH = /^repos\/building-attendance\/building-qr-system(?:\/[A-Za-z0-9._-]+)*(?:\?[A-Za-z0-9_=&,.:/-]+)?$/
// At most 9 digits: GraphQL reads the number as an Int (at most 2147483647).
export const NUMBER = /^[1-9][0-9]{0,8}$/
export const COMMENT_ID = /^[1-9][0-9]{0,19}$/
export const THREAD_ID = /^PRRT_[A-Za-z0-9_-]{10,80}$/
export const MAX_BODY = 65536

export const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id isResolved isOutdated path line
          comments(first: 100) { totalCount nodes { databaseId createdAt body author { login __typename } } }
        }
      }
    }
  }
}`

export const COMMENTS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { comments(last: 100) { totalCount nodes { databaseId createdAt body author { login __typename } } } }
      ... on PullRequest {
        comments(last: 100) { totalCount nodes { databaseId createdAt body author { login __typename } } }
        reviews(last: 100) { totalCount nodes { databaseId state submittedAt body author { login __typename } } }
      }
    }
  }
}`

/** Which repository a review thread is in: resolve-thread resolves only a thread of this one. */
export const THREAD_REPOSITORY_QUERY = `query($threadId: ID!) {
  node(id: $threadId) { ... on PullRequestReviewThread { repository { nameWithOwner } } }
}`

export const RESOLVE_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`

/** A refused input: main() prints its one line and exits 2. */
export class Refused extends Error {}

/** Runs a program with an argument array and no shell, and returns its stdout. Throws on a non-zero exit, as execFileSync does. */
export function execRunner(file, args, { input } = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    input,
    shell: false,
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  })
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The owner's account, or the Codex review bot (a Bot of that login: a person's account of the same name is refused). */
export function isTrusted(author) {
  if (!isObject(author)) return false
  if (author.__typename === 'User') return author.login === OWNER_LOGIN
  if (author.__typename === 'Bot') return author.login === CODEX_LOGIN
  return false
}

export function checkPath(value) {
  if (!GET_PATH.test(value)) {
    throw new Refused(
      'get: the path must be repos/building-attendance/building-qr-system, then /segments of [A-Za-z0-9._-] and an optional ?query of [A-Za-z0-9_=&,.:/-]',
    )
  }
  if (value.includes('..')) throw new Refused('get: the path may not contain ..')
  const segments = value.split('?')[0].split('/')
  if (segments.some((segment) => /^\.+$/.test(segment))) throw new Refused('get: a segment of the path may not be dots alone')
  return value
}

function checkNumber(value, what) {
  if (!NUMBER.test(value)) throw new Refused(`${what} must be the number of a pull request or an issue (digits only, no leading 0)`)
  return value
}

const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

const realRoot = (folder) => {
  try {
    return fs.realpathSync.native(folder)
  } catch {
    return null
  }
}

/** The text of a body file, after the checks of the header. */
export function readBody(file, { run, scratchRoot }) {
  const refuse = (rule) => {
    throw new Refused(`the body file ${rule}`)
  }
  if (typeof file !== 'string' || file === '') refuse('is missing')
  let real
  try {
    real = fs.realpathSync.native(path.resolve(file))
  } catch {
    refuse('does not exist')
  }
  if (!fs.statSync(real).isFile()) refuse('is not a regular file')
  if (real.split(path.sep).some((part) => part.toLowerCase() === '.git')) refuse('may not be under .git')
  const worktree = realRoot(run('git', ['rev-parse', '--show-toplevel']).trim())
  const scratch = realRoot(scratchRoot)
  if (worktree && inside(worktree, real)) {
    let ignored
    try {
      run('git', ['-C', worktree, 'check-ignore', '-q', '--', path.relative(worktree, real)])
      ignored = true
    } catch (error) {
      if (error?.status !== 1) refuse('cannot be checked against .gitignore')
      ignored = false
    }
    if (ignored) refuse('is ignored by git (an .env file, a dump, a build): its text may not go to GitHub')
  } else if (!(scratch && inside(scratch, real))) {
    refuse('must be inside the scratchpad (<temp>/claude) or this worktree')
  }
  const text = fs.readFileSync(real, 'utf8')
  if (text.trim() === '') refuse('is empty')
  if (text.includes('\0')) refuse('is not text')
  if (text.length > MAX_BODY) refuse(`is longer than ${MAX_BODY} characters, GitHub's limit for a body`)
  return text
}

const gh = (args) => ['api', '--hostname', HOST, ...args]
const graphql = (query, variables) => gh(['graphql', '-f', `query=${query}`, ...variables])
const repoVariables = (number) => ['-f', `owner=${OWNER}`, '-f', `name=${NAME}`, '-F', `number=${number}`]

function parse(text, what) {
  let answer
  try {
    answer = JSON.parse(text)
  } catch {
    throw new Error(`${what}: the answer is not JSON`)
  }
  if (!isObject(answer)) throw new Error(`${what}: the answer is not a JSON object`)
  if (answer.errors !== undefined) throw new Error(`${what}: the answer has errors`)
  return answer
}

const comment = (node) => ({
  databaseId: node.databaseId,
  author: node.author.login,
  ...(node.state !== undefined ? { state: node.state } : {}),
  at: node.createdAt ?? node.submittedAt ?? null,
  body: node.body,
})

/** Keeps the nodes by trusted authors, and counts the rest and the ones the connection did not return. */
function filterConnection(connection, what) {
  if (!isObject(connection) || !Array.isArray(connection.nodes) || !Number.isInteger(connection.totalCount)) {
    throw new Error(`${what}: the answer cannot be read`)
  }
  const kept = connection.nodes.filter((node) => isObject(node) && isTrusted(node.author))
  return { kept, hidden: connection.nodes.length - kept.length, unread: connection.totalCount - connection.nodes.length }
}

/** The review threads whose first comment is trusted, with their trusted comments only, and the lines that count the rest. */
export function filterThreads(reviewThreads) {
  const threads = filterConnection(
    isObject(reviewThreads) && Array.isArray(reviewThreads.nodes)
      ? { ...reviewThreads, nodes: reviewThreads.nodes.map((thread) => ({ ...thread, author: thread?.comments?.nodes?.[0]?.author })) }
      : reviewThreads,
    'threads',
  )
  let hiddenReplies = 0
  let unreadReplies = 0
  const shown = threads.kept.map((thread) => {
    const replies = filterConnection(thread.comments, 'threads')
    hiddenReplies += replies.hidden
    unreadReplies += replies.unread
    return {
      id: thread.id,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      path: thread.path,
      line: thread.line,
      comments: replies.kept.map(comment),
    }
  })
  const lines = [`${threads.hidden} threads by other authors not shown`, `${hiddenReplies} replies by other authors not shown`]
  if (threads.unread > 0) lines.push(`${threads.unread} threads not read (more than 100)`)
  if (unreadReplies > 0) lines.push(`${unreadReplies} replies not read (more than 100 in a thread)`)
  return { threads: shown, lines }
}

/** The comments (and a pull request's reviews) by trusted authors, and the lines that count the rest. */
export function filterConversation(item) {
  const comments = filterConnection(item.comments, 'comments')
  const lines = [`${comments.hidden} comments by other authors not shown`]
  if (comments.unread > 0) lines.push(`${comments.unread} older comments not read (more than 100)`)
  const result = { kind: item.__typename, comments: comments.kept.map(comment) }
  if (item.__typename === 'PullRequest') {
    const reviews = filterConnection(item.reviews, 'comments')
    lines.push(`${reviews.hidden} reviews by other authors not shown`)
    if (reviews.unread > 0) lines.push(`${reviews.unread} older reviews not read (more than 100)`)
    result.reviews = reviews.kept.map(comment)
  }
  return { ...result, lines }
}

const SUBCOMMAND_RUN = {
  get({ run, out }, [value]) {
    const target = checkPath(value)
    out(run('gh', gh(['--method', 'GET', target])))
  },
  threads({ run, out }, [value]) {
    const number = checkNumber(value, 'threads: <pr>')
    const answer = parse(run('gh', graphql(THREADS_QUERY, repoVariables(number))), 'threads')
    const pull = answer.data?.repository?.pullRequest
    if (!isObject(pull)) throw new Error(`threads: no pull request #${number}`)
    const { threads, lines } = filterThreads(pull.reviewThreads)
    out(`${JSON.stringify({ pull_request: Number(number), threads }, null, 2)}\n${lines.join('\n')}\n`)
  },
  comments({ run, out }, [value]) {
    const number = checkNumber(value, 'comments: <number>')
    const answer = parse(run('gh', graphql(COMMENTS_QUERY, repoVariables(number))), 'comments')
    const item = answer.data?.repository?.issueOrPullRequest
    if (!isObject(item)) throw new Error(`comments: no pull request or issue #${number}`)
    const { lines, ...conversation } = filterConversation(item)
    out(`${JSON.stringify({ number: Number(number), ...conversation }, null, 2)}\n${lines.join('\n')}\n`)
  },
  'resolve-thread'({ run, out }, [value]) {
    if (!THREAD_ID.test(value)) throw new Refused('resolve-thread: the thread id must be PRRT_ and 10 to 80 of [A-Za-z0-9_-]')
    const where = parse(run('gh', graphql(THREAD_REPOSITORY_QUERY, ['-f', `threadId=${value}`])), 'resolve-thread')
    if (where.data?.node?.repository?.nameWithOwner !== REPOSITORY) {
      throw new Refused(`resolve-thread: the thread must be a review thread of ${REPOSITORY}`)
    }
    const answer = parse(run('gh', graphql(RESOLVE_MUTATION, ['-f', `threadId=${value}`])), 'resolve-thread')
    const thread = answer.data?.resolveReviewThread?.thread
    if (!isObject(thread) || thread.isResolved !== true) throw new Error('resolve-thread: GitHub did not report the thread resolved')
    out(`resolved ${thread.id}\n`)
  },
  'pr-body'({ run, out, scratchRoot }, [pr, file]) {
    const number = checkNumber(pr, 'pr-body: <pr>')
    const body = readBody(file, { run, scratchRoot })
    const route = `repos/${REPOSITORY}/pulls/${number}`
    const answer = parse(run('gh', gh(['--method', 'PATCH', route, '--input', '-']), { input: JSON.stringify({ body }) }), 'pr-body')
    out(`updated the body of pull request #${answer.number ?? number}\n`)
  },
  reply({ run, out, scratchRoot }, [pr, commentId, file]) {
    const number = checkNumber(pr, 'reply: <pr>')
    if (!COMMENT_ID.test(commentId)) throw new Refused('reply: the comment id must be digits only, no leading 0')
    const body = readBody(file, { run, scratchRoot })
    const route = `repos/${REPOSITORY}/pulls/${number}/comments/${commentId}/replies`
    const answer = parse(run('gh', gh(['--method', 'POST', route, '--input', '-']), { input: JSON.stringify({ body }) }), 'reply')
    out(`replied in pull request #${number}: comment ${answer.id ?? 'unknown'}\n`)
  },
}

const USAGE = Object.entries(SUBCOMMANDS)
  .map(([name, { args }]) => [name, ...args.map((arg) => `<${arg}>`)].join(' '))
  .join(', ')

/**
 * Runs one subcommand and returns the exit code: 0 done, 1 a call failed, 2 refused. `run(file, args, { input })` returns
 * the stdout of a program (execRunner, or a fake in the tests); `out` and `err` write text.
 */
export function main(argv, { run = execRunner, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), scratchRoot = path.join(os.tmpdir(), 'claude') } = {}) {
  try {
    const [name, ...args] = argv
    if (typeof name !== 'string' || !Object.hasOwn(SUBCOMMANDS, name)) throw new Refused(`the subcommands are: ${USAGE}`)
    const { args: expected } = SUBCOMMANDS[name]
    if (args.length !== expected.length || args.some((arg) => typeof arg !== 'string')) {
      throw new Refused(`${name} takes exactly: ${expected.map((arg) => `<${arg}>`).join(' ')}`)
    }
    let origin
    try {
      origin = run('git', ['remote', 'get-url', 'origin']).trim()
    } catch {
      origin = ''
    }
    if (!ORIGIN.test(origin)) throw new Refused(`the remote origin must be https://github.com/${REPOSITORY}`)
    SUBCOMMAND_RUN[name]({ run, out, scratchRoot }, args)
    return 0
  } catch (error) {
    if (error instanceof Refused) {
      err(`gh-agent: refused: ${error.message}\n`)
      return 2
    }
    const status = Number.isInteger(error?.status) ? ` (gh exited ${error.status})` : ''
    err(`gh-agent: failed${status}: ${error?.message?.split('\n')[0] ?? 'unknown error'}\n`)
    return 1
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main(process.argv.slice(2))
