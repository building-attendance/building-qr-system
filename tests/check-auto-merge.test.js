// The decision of the auto-merge workflow (scripts/check-auto-merge.mjs, run by .github/workflows/auto-merge.yml), and the
// workflow file itself. The rule is AGENTS.md, "Git and pull requests" ("One workflow may merge too"). Refusals first: each
// test changes one thing of a clean pull request and expects that one thing, and only it, to be the reason. Then the clean
// case, the merge call, the comment, the command line, and a reading of the workflow file. The repository, the commits,
// the numbers and the texts are made up; the logins are the ones that the script names.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ACTIONS_LOGIN,
  CODEX_LOGIN,
  CODEX_STATE_MARKER,
  COMMENT_MARKER,
  CONDITIONS,
  CONVERSATION_QUERY,
  GITHUB_ACTIONS_APP_ID,
  MAX_FILES,
  OVERRIDE_LABEL,
  OWNER_LOGIN,
  REQUIRED_CHECKS,
  clean,
  codexState,
  decide,
  existingComment,
  fileProblem,
  isCandidate,
  mergeRequest,
  readInput,
  run,
} from '../scripts/check-auto-merge.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const SCRIPT = path.join(root, 'scripts', 'check-auto-merge.mjs')
const WORKFLOW = fs.readFileSync(path.join(root, '.github', 'workflows', 'auto-merge.yml'), 'utf8')
const CI = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

const REPO = 'fake-owner/fake-repo'
const HEAD = '0123456789abcdef0123456789abcdef01234567'
const OLDER = 'fedcba9876543210fedcba9876543210fedcba98'
const OTHER_APP_ID = 424242

const codexState1 = (sha, over = {}) =>
  JSON.stringify({
    code_review: { commit_sha: sha, has_any_findings: false, has_unresolved_findings: false, status: 'completed', ...over },
    security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null },
  })
const summaryBody = (json) =>
  `<!-- codex-pull-request-review-summary -->\n<!-- ${CODEX_STATE_MARKER} ${json} -->\n\n## Codex Review Summary\n\nA made-up summary.`
const codexBot = { login: CODEX_LOGIN, __typename: 'Bot' }
const owner = { login: OWNER_LOGIN, __typename: 'User' }

const checkRun = (name, over = {}) => ({
  name,
  head_sha: HEAD,
  status: 'completed',
  conclusion: 'success',
  app: { id: GITHUB_ACTIONS_APP_ID, slug: 'github-actions' },
  ...over,
})

/** A pull request that is in the class and clean, with every argument of decide. */
function cleanCase() {
  const pr = {
    number: 42,
    state: 'open',
    draft: false,
    title: 'test(scan): cover a made-up refused point',
    body: 'A made-up description.',
    user: { login: OWNER_LOGIN, type: 'User' },
    base: { ref: 'master', repo: { full_name: REPO } },
    head: { ref: 'test/made-up-branch', sha: HEAD, repo: { full_name: REPO } },
    changed_files: 2,
    labels: [{ name: 'documentation' }],
  }
  return {
    pr,
    files: [
      { filename: 'tests/made-up.test.js', status: 'modified' },
      { filename: 'docs/testing.md', status: 'added' },
    ],
    labels: pr.labels,
    checks: {
      total_count: 6,
      check_runs: [
        ...REQUIRED_CHECKS.map((name) => checkRun(name)),
        checkRun('unit part 1'),
        checkRun('CodeQL', { app: { id: OTHER_APP_ID, slug: 'made-up-app' }, conclusion: 'neutral' }),
      ],
    },
    comments: {
      totalCount: 3,
      nodes: [
        { databaseId: 1, author: owner, editor: null, body: '@codex review' },
        { databaseId: 2, author: codexBot, editor: codexBot, body: summaryBody(codexState1(HEAD)) },
        { databaseId: 3, author: codexBot, editor: null, body: '<!-- codex-review-receipt:v1 -->\n\nA made-up receipt.' },
      ],
    },
    threads: { totalCount: 1, nodes: [{ isResolved: true }] },
    target: { repository: REPO, branch: 'master', behindBy: 0 },
  }
}

const decideCase = (c) => decide(c.pr, c.files, c.labels, c.checks, c.comments, c.threads, c.target)

/** The decision of the clean case after `change`; the change must be the one and only reason. */
function refusedOnlyFor(change, reason) {
  const c = cleanCase()
  change(c)
  const decision = decideCase(c)
  expect(decision.merge).toBe(false)
  expect(decision.reasons, decision.reasons.join('\n')).toHaveLength(1)
  expect(decision.reasons[0]).toMatch(reason)
  return decision
}

/** The clean case with one file in place of its two. */
const withFile = (file) => (c) => {
  c.files = [file]
  c.pr.changed_files = 1
}

describe('refuses: the pull request itself', () => {
  it('one that is not open', () => refusedOnlyFor((c) => (c.pr.state = 'closed'), /not open/))
  it('a draft', () => refusedOnlyFor((c) => (c.pr.draft = true), /draft/))
  it('a draft flag that cannot be read', () => refusedOnlyFor((c) => delete c.pr.draft, /draft/))
  it('one into another branch', () => refusedOnlyFor((c) => (c.pr.base.ref = 'release'), /not into master/))
  it('one into another repository', () => refusedOnlyFor((c) => (c.pr.base.repo.full_name = 'someone/else'), /not into master/))
  it('one from a fork', () => refusedOnlyFor((c) => (c.pr.head.repo.full_name = 'someone/fake-repo'), /fork/))
  it('one whose head repository is gone', () => refusedOnlyFor((c) => (c.pr.head.repo = null), /fork/))
  it('one without a number', () => refusedOnlyFor((c) => delete c.pr.number, /number of the pull request/))
  it('one whose head commit cannot be read', () => {
    const decision = refusedOnlyFor((c) => (c.pr.head.sha = 'not-a-sha'), /head commit cannot be read/)
    expect(decision.reasons).toHaveLength(1)
  })
  it('one that another person opened', () =>
    refusedOnlyFor((c) => (c.pr.user = { login: 'someone-else', type: 'User' }), /not opened by the owner/))
  it("an account with the owner's login that is not a person", () =>
    refusedOnlyFor((c) => (c.pr.user = { login: OWNER_LOGIN, type: 'Bot' }), /not opened by the owner/))
  it('a claude/ branch (the agent loop)', () => refusedOnlyFor((c) => (c.pr.head.ref = 'claude/issue-7-made-up'), /agent branch/))
  it("a codex/ branch (Codex's own work)", () => refusedOnlyFor((c) => (c.pr.head.ref = 'codex/made-up-fix'), /agent branch/))
  it('an agent branch in another case', () => refusedOnlyFor((c) => (c.pr.head.ref = 'Claude/made-up'), /agent branch/))
  it('a branch name that cannot be read', () => refusedOnlyFor((c) => delete c.pr.head.ref, /branch name/))
})

describe('refuses: the title', () => {
  it.each([
    ['another type', 'feat(scan): a made-up feature', /not a test or docs title/],
    ['a type in capitals', 'Docs: a made-up page', /not a test or docs title/],
    ['a type that is not one', 'tests: a made-up change', /not a test or docs title/],
    ['a scope that is not plain', 'docs(Rules): a made-up page', /not a test or docs title/],
    ['no description', 'docs: ', /not a test or docs title/],
    ['a breaking change', 'test!: a made-up change', /breaking change/],
    ['a breaking change with a scope', 'docs(api)!: a made-up change', /breaking change/],
    ['the scope rules', 'docs(rules): a made-up rule', /scope is rules/],
    ['the scope rules on a test title', 'test(rules): a made-up rule', /scope is rules/],
  ])('%s', (_, title, reason) => refusedOnlyFor((c) => (c.pr.title = title), reason))

  it('a title that cannot be read', () => refusedOnlyFor((c) => delete c.pr.title, /title cannot be read/))
})

describe('refuses: the files', () => {
  it('a removed file', () => refusedOnlyFor(withFile({ filename: 'tests/made-up.test.js', status: 'removed' }), /removed/))
  it('a renamed file', () =>
    refusedOnlyFor(
      withFile({ filename: 'tests/made-up-2.test.js', previous_filename: 'tests/made-up.test.js', status: 'renamed' }),
      /renamed from tests\/made-up\.test\.js/,
    ))
  it.each(['copied', 'changed', 'unchanged', undefined])('a file whose status is %s', (status) =>
    refusedOnlyFor(withFile({ filename: 'tests/made-up.test.js', status }), /not added or modified/))

  it.each([
    'src/worker/scanQueue.js',
    'server/router.js',
    'shared/contract.js',
    'db/migrations/099_made_up.sql',
    'scripts/check-tests.mjs',
    'scripts/check-auto-merge.mjs',
    'package.json',
    'vercel.json',
    'vitest.config.js',
    'playwright.config.js',
    'docs/made-up.txt',
    'docs/made-up.png',
    'docs/screenshots/nested/made-up.png',
    'readme.md',
    'tests',
  ])('%s, which is outside the class', (filename) =>
    refusedOnlyFor(withFile({ filename, status: 'modified' }), /not in the class/))

  it.each([
    'e2e/__screenshots__/visual.spec.js/made-up.png',
    'e2e/made-up.png',
    'e2e/made-up.PNG',
    'e2e/a11y-baseline.js',
    'e2e/a11y-report.js',
    'tests/design-budget.json',
    'e2e/fixtures.js',
    'e2e/global-teardown.js',
    'e2e/parts.js',
    'e2e/part-weights.json',
    'tests/time-sequencer.js',
    'tests/setup-no-heartbeat.js',
    'tests/setup-load-cache.js',
    'tests/helpers.js',
    'tests/check-auto-merge.test.js',
    'AGENTS.md',
    'CLAUDE.md',
    'SECURITY.md',
    'LICENSE',
    'docs/privacy.md',
    'docs/Privacy.md',
    'docs/adr/0099-a-made-up-decision.md',
    'docs/runbooks/made-up.md',
    'docs/design.md',
    'docs/design/sources.md',
    'tests/AGENTS.md',
    'docs/made-up/CLAUDE.md',
    'docs/agents.md',
    'tests/.claude/settings.json',
    'docs/.github/made-up.md',
    'e2e/.env',
    '.github/workflows/ci.yml',
    '.claude/settings.json',
  ])('%s, which the class keeps out', (filename) =>
    refusedOnlyFor(withFile({ filename, status: 'modified' }), /kept out of the class|not in the class/))

  it('each file of the deny list is kept out by the deny list itself, not only by being outside the allow list', () => {
    for (const filename of ['e2e/fixtures.js', 'tests/helpers.js', 'docs/privacy.md', 'docs/adr/0001-x.md', 'e2e/x.png']) {
      expect(fileProblem({ filename, status: 'added' })).toMatch(/kept out of the class/)
    }
  })

  it('a list of files that is cut off', () =>
    refusedOnlyFor((c) => (c.pr.changed_files = 3), /incomplete \(2 of 3\)/))
  it(`more than ${MAX_FILES} files`, () =>
    refusedOnlyFor((c) => {
      c.pr.changed_files = MAX_FILES + 1
      c.files = Array.from({ length: MAX_FILES }, (_, i) => ({ filename: `tests/made-up-${i}.test.js`, status: 'added' }))
    }, /more than 100/))
  it('a number of files that cannot be read', () => refusedOnlyFor((c) => delete c.pr.changed_files, /number of changed files/))
  it('a list of files that is not a list', () => refusedOnlyFor((c) => (c.files = { filename: 'x' }), /list of files cannot be read/))
  it('no file at all', () =>
    refusedOnlyFor((c) => {
      c.files = []
      c.pr.changed_files = 0
    }, /no changed file/))

  it('lists at most 20 files and counts the rest', () => {
    const c = cleanCase()
    c.files = Array.from({ length: 25 }, (_, i) => ({ filename: `src/made-up-${i}.js`, status: 'added' }))
    c.pr.changed_files = 25
    const { reasons } = decideCase(c)
    expect(reasons).toHaveLength(21)
    expect(reasons[20]).toBe('and 5 more files')
  })
})

describe('refuses: the labels', () => {
  it(`the label ${OVERRIDE_LABEL}`, () =>
    refusedOnlyFor((c) => c.labels.push({ name: OVERRIDE_LABEL }), `the label ${OVERRIDE_LABEL} is on it`))
  it('labels that cannot be read', () => refusedOnlyFor((c) => (c.labels = undefined), /labels cannot be read/))
  it('a label that cannot be read', () => refusedOnlyFor((c) => c.labels.push({ id: 7 }), /label cannot be read/))
})

describe('refuses: the four checks', () => {
  it.each(REQUIRED_CHECKS)('%s missing', (name) =>
    refusedOnlyFor((c) => {
      c.checks.check_runs = c.checks.check_runs.filter((r) => r.name !== name)
      c.checks.total_count = c.checks.check_runs.length
    }, `${name} has not run`))

  it.each(REQUIRED_CHECKS)('%s failed', (name) =>
    refusedOnlyFor((c) => (c.checks.check_runs.find((r) => r.name === name).conclusion = 'failure'), /did not pass \(failure\)/))

  it('a check that has not finished', () =>
    refusedOnlyFor((c) => {
      const unit = c.checks.check_runs.find((r) => r.name === 'unit')
      unit.status = 'in_progress'
      unit.conclusion = null
    }, /unit has not finished/))

  it('a check that was skipped or cancelled', () => {
    for (const conclusion of ['skipped', 'cancelled', 'neutral', null]) {
      refusedOnlyFor((c) => (c.checks.check_runs.find((r) => r.name === 'guards').conclusion = conclusion), /guards did not pass/)
    }
  })

  it('a forged check: the same name from another app, and none from GitHub Actions', () =>
    refusedOnlyFor((c) => {
      c.checks.check_runs.find((r) => r.name === 'guards').app = { id: OTHER_APP_ID, slug: 'made-up-app' }
    }, /a check named guards was reported by an app other than GitHub Actions/))

  it('a forged check next to the real one', () =>
    refusedOnlyFor((c) => {
      c.checks.check_runs.push(checkRun('e2e (iphone-webkit)', { app: { id: OTHER_APP_ID } }))
      c.checks.total_count += 1
    }, /e2e \(iphone-webkit\) was reported by an app other/))

  it('a check without its app', () =>
    refusedOnlyFor((c) => delete c.checks.check_runs.find((r) => r.name === 'unit').app, /unit was reported by an app other/))

  it('a second run of the same check that failed', () =>
    refusedOnlyFor((c) => {
      c.checks.check_runs.push(checkRun('unit', { conclusion: 'failure' }))
      c.checks.total_count += 1
    }, /unit did not pass/))

  it('a check that ran on another commit', () =>
    refusedOnlyFor((c) => (c.checks.check_runs.find((r) => r.name === 'unit').head_sha = OLDER), /unit ran on another commit/))

  it('a list of check runs that is cut off', () => refusedOnlyFor((c) => (c.checks.total_count = 120), /incomplete/))
  it('check runs that cannot be read', () => refusedOnlyFor((c) => (c.checks = { message: 'Not Found' }), /check runs cannot be read/))
})

describe('refuses: the Codex review', () => {
  const summaryOf = (c) => c.comments.nodes.find((n) => n.databaseId === 2)

  it('a forged review: a person wrote the same JSON under the Codex login', () =>
    refusedOnlyFor((c) => (summaryOf(c).author = { login: CODEX_LOGIN, __typename: 'User' }), /no Codex review summary/))

  it('a forged review: the owner wrote the same JSON', () =>
    refusedOnlyFor((c) => (summaryOf(c).author = owner), /no Codex review summary/))

  it('a forged review: another bot wrote the same JSON', () =>
    refusedOnlyFor((c) => (summaryOf(c).author = { login: 'made-up-app', __typename: 'Bot' }), /no Codex review summary/))

  it('a forged review: somebody else edited the Codex summary last', () => {
    refusedOnlyFor((c) => (summaryOf(c).editor = owner), /last edited by someone other than the Codex bot/)
    refusedOnlyFor((c) => (summaryOf(c).editor = { login: 'claude', __typename: 'Bot' }), /last edited by someone other/)
  })

  it('a clean review of an older commit', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody(codexState1(OLDER))), /Codex reviewed another commit \(fedcba9\)/))

  it('a review that is not completed', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody(codexState1(HEAD, { status: 'in_progress' }))), /not completed/))

  it('a review with findings', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody(codexState1(HEAD, { has_any_findings: true }))), /has findings/))

  it('a review that does not say whether it has findings', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody(codexState1(HEAD, { has_any_findings: null }))), /has findings/))

  it('Codex JSON that does not parse', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody('{"code_review": {"commit_sha": ')), /state cannot be read/))

  it('Codex JSON without its end', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = `<!-- ${CODEX_STATE_MARKER} ${codexState1(HEAD)}`), /state cannot be read/))

  it('Codex JSON with no code review', () =>
    refusedOnlyFor((c) => (summaryOf(c).body = summaryBody('{"security_review": {}}')), /has no code review/))

  it('no summary at all (a receipt alone is not enough)', () =>
    refusedOnlyFor((c) => {
      c.comments.nodes = c.comments.nodes.filter((n) => n.databaseId !== 2)
      c.comments.totalCount = c.comments.nodes.length
    }, /no Codex review summary/))

  it('two summaries', () =>
    refusedOnlyFor((c) => {
      c.comments.nodes.push({ databaseId: 9, author: codexBot, editor: null, body: summaryBody(codexState1(HEAD)) })
      c.comments.totalCount += 1
    }, /more than one Codex review summary/))

  it('more comments than were read', () => refusedOnlyFor((c) => (c.comments.totalCount = 140), /more comments than can be read/))
  it('comments that cannot be read', () => refusedOnlyFor((c) => (c.comments = null), /comments cannot be read/))
})

describe('refuses: the conversations and the branch', () => {
  it('a review conversation that is not resolved', () =>
    refusedOnlyFor((c) => {
      c.threads = { totalCount: 2, nodes: [{ isResolved: true }, { isResolved: false }] }
    }, /1 review conversation is not resolved/))
  it('more conversations than were read', () => refusedOnlyFor((c) => (c.threads.totalCount = 101), /more review conversations/))
  it('conversations that cannot be read', () => refusedOnlyFor((c) => (c.threads = undefined), /conversations cannot be read/))
  it('a branch that is behind the default branch', () =>
    refusedOnlyFor((c) => (c.target.behindBy = 2), /2 commits behind master: bring it up to date/))
  it('a branch whose distance cannot be read', () => refusedOnlyFor((c) => delete c.target.behindBy, /behind cannot be read/))
})

describe('fails closed on input that cannot be read', () => {
  it('refuses with no pull request or no repository', () => {
    const c = cleanCase()
    expect(decide(null, c.files, c.labels, c.checks, c.comments, c.threads, c.target).merge).toBe(false)
    expect(decide(c.pr, c.files, c.labels, c.checks, c.comments, c.threads, null).merge).toBe(false)
    expect(decide(c.pr, c.files, c.labels, c.checks, c.comments, c.threads, { repository: REPO }).merge).toBe(false)
  })

  it('refuses an empty document, and a document of the wrong kind, without throwing', () => {
    for (const input of [{}, null, [], 'text', { pr: 'x' }, { pr: { head: {} } }]) {
      const out = run(input)
      expect(out.merge).toBe(false)
      expect(out.reasons.length).toBeGreaterThan(0)
      expect(out.merge_request).toBeNull()
      expect(out.comment.post).toBe(false)
    }
  })

  it('reads no Codex state from text that has none', () => {
    expect(codexState(undefined)).toBeNull()
    expect(codexState('no marker here')).toBeNull()
    expect(codexState(`<!-- ${CODEX_STATE_MARKER} [1, 2] -->`)).toBeNull()
    expect(codexState(summaryBody(codexState1(HEAD))).code_review.commit_sha).toBe(HEAD)
  })
})

describe('the clean case', () => {
  it('merges, with no reason', () => {
    expect(decideCase(cleanCase())).toEqual({ merge: true, reasons: [] })
  })

  it('takes every kind of file of the class', () => {
    const c = cleanCase()
    c.files = [
      'tests/made-up.test.js',
      'tests/components/MadeUp.test.jsx',
      'tests/fixtures/made-up.json',
      'e2e/made-up.spec.js',
      'docs/made-up.md',
      'docs/made-up/deeper/page.md',
      'docs/screenshots/made-up.png',
      'README.md',
      'CONTRIBUTING.md',
    ].map((filename) => ({ filename, status: 'modified' }))
    c.pr.changed_files = c.files.length
    expect(decideCase(c)).toEqual({ merge: true, reasons: [] })
  })

  it(`takes exactly ${MAX_FILES} files`, () => {
    const c = cleanCase()
    c.files = Array.from({ length: MAX_FILES }, (_, i) => ({ filename: `tests/made-up-${i}.test.js`, status: 'added' }))
    c.pr.changed_files = MAX_FILES
    expect(decideCase(c).merge).toBe(true)
  })

  it('takes a docs title, a scope, a summary that Codex never edited, no conversation, and an older finding that is resolved', () => {
    const c = cleanCase()
    c.pr.title = 'docs: a made-up page'
    c.comments.nodes[1].editor = null
    c.threads = { totalCount: 0, nodes: [] }
    expect(decideCase(c).merge).toBe(true)
    c.pr.title = 'docs(install): a made-up page'
    c.threads = { totalCount: 1, nodes: [{ isResolved: true }] }
    expect(decideCase(c).merge).toBe(true)
  })

  it('ignores checks that are not required, from any app, whatever they say', () => {
    const c = cleanCase()
    c.checks.check_runs.find((r) => r.name === 'CodeQL').conclusion = 'failure'
    c.checks.check_runs.find((r) => r.name === 'unit part 1').conclusion = 'failure'
    expect(decideCase(c).merge).toBe(true)
  })

  it('names every condition when it merges', () => {
    expect(CONDITIONS).toHaveLength(9)
    expect(CONDITIONS.join(' ')).toContain(REQUIRED_CHECKS.join(', '))
  })
})

describe('the merge call', () => {
  it('is pinned to the head commit that was decided on, and squashes', () => {
    const { pr } = cleanCase()
    expect(mergeRequest(pr)).toEqual({
      sha: HEAD,
      merge_method: 'squash',
      commit_title: 'test(scan): cover a made-up refused point (#42)',
      commit_message: 'A made-up description.',
    })
  })

  it('has an empty message when the pull request has no description', () => {
    const { pr } = cleanCase()
    pr.body = null
    expect(mergeRequest(pr).commit_message).toBe('')
  })

  it('refuses to build a call without a head commit', () => {
    const { pr } = cleanCase()
    pr.head.sha = 'abc'
    expect(() => mergeRequest(pr)).toThrow(/head commit/)
  })

  it('comes out of run() only when the decision is to merge, with the sha of the head', () => {
    const c = cleanCase()
    const input = {
      repository: REPO,
      default_branch: 'master',
      live: false,
      pr: c.pr,
      files: c.files,
      checks: c.checks,
      compare: { behind_by: 0 },
      comments: c.comments,
      threads: c.threads,
    }
    const yes = run(input)
    expect(yes.merge).toBe(true)
    expect(yes.merge_request.sha).toBe(HEAD)
    expect(yes.head_sha).toBe(HEAD)
    expect(yes.number).toBe(42)
    expect(yes.merged_body).toContain('merged automatically')
    const no = run({ ...input, compare: { behind_by: 1 } })
    expect(no.merge).toBe(false)
    expect(no.merge_request).toBeNull()
    expect(no.merged_body).toBeNull()
  })
})

describe('the comment', () => {
  const inputOf = (c, over = {}) => ({
    repository: REPO,
    default_branch: 'master',
    live: false,
    pr: c.pr,
    files: c.files,
    checks: c.checks,
    compare: { behind_by: c.target.behindBy },
    comments: c.comments,
    threads: c.threads,
    ...over,
  })

  it('is written for an open, ready pull request with a test or docs title, and only for it', () => {
    const c = cleanCase()
    expect(isCandidate(c.pr)).toBe(true)
    expect(isCandidate({ ...c.pr, title: 'docs(rules): a made-up rule' })).toBe(true)
    expect(isCandidate({ ...c.pr, title: 'feat: a made-up feature' })).toBe(false)
    expect(isCandidate({ ...c.pr, title: 'tests: not a type' })).toBe(false)
    expect(isCandidate({ ...c.pr, draft: true })).toBe(false)
    expect(isCandidate({ ...c.pr, state: 'closed' })).toBe(false)
    expect(run(inputOf(c, { pr: { ...c.pr, title: 'feat: a made-up feature' } })).comment.post).toBe(false)
  })

  it('starts with the marker of its head commit, and says that it is a dry run', () => {
    const c = cleanCase()
    const yes = run(inputOf(c))
    expect(yes.comment.post).toBe(true)
    expect(yes.comment.body.split('\n')[0]).toBe(`<!-- ${COMMENT_MARKER} head=${HEAD} -->`)
    expect(yes.comment.body).toContain('### Auto-merge, dry run: would merge `0123456`')
    expect(yes.comment.body).toContain('nothing is merged')
    c.target.behindBy = 3
    const no = run(inputOf(c))
    expect(no.comment.body).toContain('### Auto-merge, dry run: would not merge `0123456`')
    expect(no.comment.body).toContain('- the branch is 3 commits behind master')
    expect(no.summary).toBe(no.comment.body.split('\n').slice(1).join('\n'))
  })

  it('says merging, and not dry run, when the workflow is live', () => {
    const out = run(inputOf(cleanCase(), { live: true }))
    expect(out.comment.body).toContain('### Auto-merge: merging')
    expect(out.comment.body).not.toContain('dry run')
    const refused = run(inputOf(cleanCase(), { live: true, compare: { behind_by: 1 } }))
    expect(refused.comment.body).toContain('### Auto-merge: will not merge')
  })

  it('edits the comment of this head commit that the workflow wrote, and no other', () => {
    const c = cleanCase()
    const ours = { databaseId: 77, author: { login: ACTIONS_LOGIN, __typename: 'Bot' }, editor: null, body: `<!-- ${COMMENT_MARKER} head=${HEAD} -->\nold` }
    const olderHead = { ...ours, databaseId: 76, body: `<!-- ${COMMENT_MARKER} head=${OLDER} -->\nold` }
    const forged = { ...ours, databaseId: 75, author: owner }
    const otherBot = { ...ours, databaseId: 74, author: { login: 'made-up-app', __typename: 'Bot' } }
    c.comments.nodes.push(forged, otherBot, olderHead)
    c.comments.totalCount = c.comments.nodes.length
    expect(existingComment(c.comments, HEAD)).toBeNull()
    c.comments.nodes.push(ours)
    c.comments.totalCount += 1
    expect(existingComment(c.comments, HEAD)).toBe(77)
    expect(run(inputOf(c)).comment.id).toBe(77)
  })

  it('shows text of the pull request only in plain characters', () => {
    expect(clean('docs/a`b @someone\n<img src=x>.md')).toBe('docs/a?b??someone??img?src?x?.md')
    expect(clean('x'.repeat(300))).toHaveLength(100)
    const c = cleanCase()
    c.files = [{ filename: 'src/`@someone`\n## Heading.js', status: 'added' }]
    c.pr.changed_files = 1
    const body = run(inputOf(c)).comment.body
    expect(body).toContain('src/??someone?????Heading.js')
    expect(body).not.toContain('@someone')
  })
})

describe('reading the pull request from the API', () => {
  const API = 'https://api.example.test'
  const ENV = { REPO, PR_NUMBER: '42', DEFAULT_BRANCH: 'master', GH_TOKEN: 'made-up-token', LIVE: 'false', GITHUB_API_URL: API }

  /** A fake GitHub that answers the calls of readInput with the clean case, and records them. */
  function fakeGitHub(c, change = {}) {
    const answers = {
      [`GET /repos/${REPO}/pulls/42`]: c.pr,
      [`GET /repos/${REPO}/pulls/42/files?per_page=${MAX_FILES}`]: c.files,
      [`GET /repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`]: c.checks,
      [`GET /repos/${REPO}/compare/master...${HEAD}`]: { behind_by: 0, ahead_by: 2, files: [] },
      'POST /graphql': { data: { repository: { pullRequest: { comments: c.comments, reviewThreads: c.threads } } } },
      ...change,
    }
    const calls = []
    const fetchImpl = async (url, init) => {
      const key = `${init.method} ${url.slice(API.length)}`
      calls.push({ key, init })
      const answer = key in answers ? answers[key] : 404
      if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({ message: 'made up' }) }
      return { ok: true, status: 200, json: async () => answer }
    }
    return { fetchImpl, calls }
  }

  it('reads the five answers, with the token, and builds the document that decides', async () => {
    const c = cleanCase()
    const { fetchImpl, calls } = fakeGitHub(c)
    const doc = await readInput(ENV, fetchImpl)
    expect(calls.map((call) => call.key)).toEqual([
      `GET /repos/${REPO}/pulls/42`,
      `GET /repos/${REPO}/pulls/42/files?per_page=100`,
      `GET /repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`,
      `GET /repos/${REPO}/compare/master...${HEAD}`,
      'POST /graphql',
    ])
    for (const { init } of calls) {
      expect(init.headers.authorization).toBe('Bearer made-up-token')
      expect(init.redirect).toBe('error')
    }
    const graph = JSON.parse(calls[4].init.body)
    expect(graph.query).toBe(CONVERSATION_QUERY)
    expect(graph.query).toContain('editor { login __typename }')
    expect(graph.variables).toEqual({ owner: 'fake-owner', name: 'fake-repo', number: 42 })
    expect(doc).toEqual({
      repository: REPO,
      default_branch: 'master',
      live: false,
      pr: c.pr,
      files: c.files,
      checks: c.checks,
      compare: { behind_by: 0 },
      comments: c.comments,
      threads: c.threads,
    })
    expect(run(doc).merge).toBe(true)
  })

  it('is live only when LIVE is exactly true', async () => {
    for (const [LIVE, live] of [['true', true], ['false', false], ['TRUE', false], [undefined, false], ['1', false]]) {
      const { fetchImpl } = fakeGitHub(cleanCase())
      expect((await readInput({ ...ENV, LIVE }, fetchImpl)).live).toBe(live)
    }
  })

  it.each([
    ['REPO', 'not-a-repo'],
    ['REPO', 'owner/name/more'],
    ['PR_NUMBER', '0'],
    ['PR_NUMBER', '42;x'],
    ['PR_NUMBER', undefined],
    ['DEFAULT_BRANCH', '-x'],
    ['DEFAULT_BRANCH', 'a b'],
    ['GH_TOKEN', ''],
    ['GITHUB_API_URL', 'http://api.example.test'],
    ['GITHUB_API_URL', 'https://api.example.test/?x=1'],
  ])('refuses %s = %s before it calls anything', async (name, value) => {
    const { fetchImpl, calls } = fakeGitHub(cleanCase())
    await expect(readInput({ ...ENV, [name]: value }, fetchImpl)).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('stops on an answer that is not a success, and names the call but never the token', async () => {
    const { fetchImpl } = fakeGitHub(cleanCase(), { [`GET /repos/${REPO}/pulls/42/files?per_page=100`]: 502 })
    const error = await readInput(ENV, fetchImpl).catch((e) => e)
    expect(error.message).toBe(`GET /repos/${REPO}/pulls/42/files: HTTP 502`)
    expect(error.message).not.toContain('made-up-token')
  })

  it('stops on a GraphQL error', async () => {
    const { fetchImpl } = fakeGitHub(cleanCase(), { 'POST /graphql': { errors: [{ message: 'made up' }], data: null } })
    await expect(readInput(ENV, fetchImpl)).rejects.toThrow(/graphql: the answer has errors/)
  })

  it('stops when the head of the pull request is not a commit, before it reads anything else', async () => {
    const c = cleanCase()
    c.pr.head.sha = 'main'
    const { fetchImpl, calls } = fakeGitHub(c)
    await expect(readInput(ENV, fetchImpl)).rejects.toThrow(/not a SHA/)
    expect(calls).toHaveLength(1)
  })

  it('leaves a missing part to decide, which refuses it', async () => {
    const { fetchImpl } = fakeGitHub(cleanCase(), { 'POST /graphql': { data: { repository: null } } })
    const out = run(await readInput(ENV, fetchImpl))
    expect(out.merge).toBe(false)
    expect(out.reasons).toEqual(['the comments cannot be read', 'the review conversations cannot be read'])
  })
})

describe('the command line', () => {
  it('with --read and an environment that is not right, fails and prints no decision', () => {
    const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, REPO: 'not-a-repo', PR_NUMBER: '42' }
    const result = spawnSync(process.execPath, [SCRIPT, '--read'], { env, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('REPO is not owner/name')
  })

  it('reads one JSON document on stdin and prints the decision', () => {
    const c = cleanCase()
    const input = {
      repository: REPO,
      default_branch: 'master',
      live: false,
      pr: c.pr,
      files: c.files,
      checks: c.checks,
      compare: { behind_by: 0 },
      comments: c.comments,
      threads: c.threads,
    }
    const result = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(input), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const out = JSON.parse(result.stdout)
    expect(out.merge).toBe(true)
    expect(out.merge_request.sha).toBe(HEAD)
  })

  it('fails on input that is not JSON, and prints no decision', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
  })
})

// The workflow file, read as text: what it runs on, what it may do, and what it never does.
/** The lines of a block: the line that matches `header` and every line after it that is indented deeper (or empty). */
function block(text, header) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => header.test(line))
  if (start === -1) return null
  const indent = lines[start].search(/\S/)
  const body = [lines[start]]
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break
    body.push(line)
  }
  return body.join('\n')
}

/** The scripts of every `run: |` step. */
function runScripts(text) {
  const scripts = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!/^\s*run: \|\s*$/.test(line)) return
    const indent = line.search(/\S/)
    const body = []
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== '' && next.search(/\S/) <= indent) break
      body.push(next)
    }
    scripts.push(body.join('\n'))
  })
  return scripts
}

const code = WORKFLOW.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n')
const decideJob = block(code, /^ {2}decide:$/)
const mergeJob = block(code, /^ {2}merge:$/)

describe('the workflow file', () => {
  it('runs only after CI and on comments, never on a trigger that runs the pull request copy of the file', () => {
    const on = block(code, /^on:$/)
    const triggers = on.split('\n').filter((line) => /^ {2}\S/.test(line)).map((line) => line.trim())
    expect(triggers).toEqual(['workflow_run:', 'issue_comment:'])
    expect(on).toMatch(/workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]/)
    expect(on).toMatch(/issue_comment:\n {4}types: \[created, edited\]/)
    expect(CI).toMatch(/^name: CI$/m)
    expect(code).not.toMatch(/pull_request_target|pull_request_review|workflow_dispatch|schedule:|\n {2}push:/)
  })

  it('takes a comment only from the Codex review bot, on an open pull request', () => {
    expect(decideJob).toContain("github.event.comment.user.login == 'chatgpt-codex-connector[bot]'")
    expect(decideJob).toContain("github.event.comment.user.type == 'Bot'")
    expect(decideJob).toContain('github.event.issue.pull_request != null')
    expect(decideJob).toContain("github.event.issue.state == 'open'")
    expect(decideJob).toContain("github.event.workflow_run.event == 'pull_request'")
    expect(decideJob).toContain('github.event.workflow_run.head_repository.full_name == github.repository')
  })

  it('has no permission at the top, and each job only what it needs', () => {
    expect(code).toMatch(/^permissions: \{\}$/m)
    const permissions = (job) => block(job, /^ {4}permissions:$/).split('\n').slice(1).map((l) => l.trim().replace(/ #.*/, ''))
    expect(permissions(decideJob)).toEqual(['contents: read', 'pull-requests: write', 'checks: read'])
    expect(permissions(mergeJob)).toEqual(['contents: read', 'pull-requests: write', 'checks: read'])
  })

  it('pins every action to a full commit SHA, with the pins of ci.yml where it uses the same action', () => {
    const uses = WORKFLOW.split('\n').filter((l) => /uses: /.test(l))
    expect(uses).toHaveLength(5)
    for (const line of uses) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    for (const action of ['actions/checkout', 'actions/setup-node']) {
      const pins = (text) => text.split('\n').filter((line) => line.includes(`uses: ${action}@`)).map((line) => line.split('@')[1].slice(0, 40))
      const [ciPin] = pins(CI)
      expect(pins(WORKFLOW), action).toEqual([ciPin, ciPin])
    }
    expect(WORKFLOW).toContain('uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0')
  })

  it('is a dry run: LIVE is false, and the merge job runs only when it is true', () => {
    expect(code.match(/^ *LIVE: .*$/gm)).toEqual(['  LIVE: false'])
    expect(decideJob).toContain('live: ${{ env.LIVE }}')
    expect(mergeJob).toContain("if: needs.decide.outputs.live == 'true' && needs.decide.outputs.merge == 'true'")
  })

  it('checks out only the decision script of the default branch, without credentials, and never the pull request', () => {
    expect(code.match(/uses: actions\/checkout@/g)).toHaveLength(2)
    for (const job of [decideJob, mergeJob]) {
      const checkout = block(job, /uses: actions\/checkout@/)
      expect(checkout).toContain('ref: ${{ github.sha }}')
      expect(checkout).toContain('persist-credentials: false')
      expect(checkout).toMatch(/sparse-checkout: \|\n\s+\/scripts\/check-auto-merge\.mjs\n\s+\/\.nvmrc\n/)
      expect(checkout).toContain('sparse-checkout-cone-mode: false')
    }
    expect(code.match(/ref: .*/g)).toEqual(['ref: ${{ github.sha }}', 'ref: ${{ github.sha }}'])
    expect(code).not.toMatch(/github\.event\.(?:workflow_run\.head_(?:sha|branch|commit)|pull_request\b)|refs\/pull|allow-unsafe-pr-checkout/)
  })

  it('runs no code of the pull request: no install, and node only for the decision script', () => {
    const scripts = runScripts(code)
    expect(scripts.length).toBeGreaterThanOrEqual(5)
    const nodeLines = []
    for (const script of scripts) {
      expect(script).not.toMatch(/\bnpm\b|\bnpx\b|\byarn\b|\bgit\b|\bcurl\b|\bwget\b|\beval\b/)
      nodeLines.push(...script.split('\n').filter((l) => /\bnode\b/.test(l)).map((l) => l.trim()))
    }
    expect(nodeLines).toEqual([
      'node scripts/check-auto-merge.mjs --read > "$dir/decision.json"',
      'node scripts/check-auto-merge.mjs --read > "$RUNNER_TEMP/again.json"',
    ])
  })

  it('puts no expression into a script: every value goes in through env', () => {
    for (const script of runScripts(code)) expect(script).not.toContain('${{')
  })

  it('reads the App key only in the environment auto-merge, in the one step that mints the token, and never prints it', () => {
    expect(code.match(/\$\{\{ secrets\.[^}]*\}\}/g)).toEqual([
      '${{ secrets.AUTO_MERGE_APP_CLIENT_ID }}',
      '${{ secrets.AUTO_MERGE_APP_KEY }}',
    ])
    expect(code.match(/secrets/g)).toHaveLength(2)
    const mint = block(mergeJob, /- name: Mint a token of the auto-merge App/)
    expect(mint).toContain('client-id: ${{ secrets.AUTO_MERGE_APP_CLIENT_ID }}')
    expect(mint).toContain('private-key: ${{ secrets.AUTO_MERGE_APP_KEY }}')
    expect(mint).toContain('permission-contents: write')
    expect(mint.match(/permission-/g)).toHaveLength(1)
    expect(mergeJob).toMatch(/environment:\n {6}name: auto-merge\n {6}deployment: false/)
    expect(decideJob).not.toContain('environment')
    expect(code.match(/steps\.app\.outputs\.token/g)).toHaveLength(1)
    expect(block(mergeJob, /- name: Merge the head commit that was decided on/)).toContain('GH_TOKEN: ${{ steps.app.outputs.token }}')
    for (const script of runScripts(code)) {
      expect(script).not.toMatch(/GH_TOKEN|secret|::add-mask::|set -x/i)
      expect(script).not.toMatch(/\b(?:echo|printf|cat)\b[^\n]*\$\{?(?:GH_TOKEN|AUTO_MERGE)/)
    }
  })

  it('decides again just before the merge, and merges only the same head, by the squash method', () => {
    const steps = mergeJob.split('\n').filter((l) => /^ {6}- (?:name|uses): /.test(l)).map((l) => l.trim())
    const mint = steps.indexOf('- name: Mint a token of the auto-merge App')
    const again = steps.indexOf('- name: Decide again, just before the merge')
    const merge = steps.indexOf('- name: Merge the head commit that was decided on')
    expect(mint).toBeGreaterThan(-1)
    expect(again).toBe(mint + 1)
    expect(merge).toBe(again + 1)

    const recheck = block(mergeJob, /- name: Decide again, just before the merge/)
    expect(recheck).toContain('HEAD_SHA: ${{ needs.decide.outputs.head_sha }}')
    expect(recheck).toContain('GH_TOKEN: ${{ github.token }}')
    expect(recheck).toContain(
      `jq -e --arg sha "$HEAD_SHA" '.merge == true and .head_sha == $sha and .merge_request.sha == $sha and .merge_request.merge_method == "squash"' "$RUNNER_TEMP/again.json"`,
    )
    expect(recheck).toContain(`jq '.merge_request' "$RUNNER_TEMP/again.json" > "$RUNNER_TEMP/merge.json"`)

    const put = block(mergeJob, /- name: Merge the head commit that was decided on/)
    expect(put).toContain('gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/merge" --input "$RUNNER_TEMP/merge.json"')
    expect(code.match(/\/merge"/g)).toHaveLength(1)
  })

  it('decides one pull request at a time', () => {
    expect(decideJob).toMatch(
      /group: auto-merge-decide-\$\{\{ github\.event\.issue\.number \|\| github\.event\.workflow_run\.pull_requests\[0\]\.number \}\}/,
    )
    expect(mergeJob).toContain('group: auto-merge-merge-${{ needs.decide.outputs.number }}')
  })
})
