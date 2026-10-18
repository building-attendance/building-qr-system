// The stop gate of the worker agent (scripts/hooks/worker-stop-gate.mjs, a SubagentStop hook for ^worker$): runs the gate
// in a child process with the stop event as JSON on stdin, as Claude Code does, against a temporary git repository with
// origin/master. The repository holds a copy of the gate (which marks a checkout of this project, and keeps the gate's state
// in that repository's .git) and four fake steps: each one fails when a file FAIL_<step> is in the work tree, and logs that
// it ran. No database and no network.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const GATE = path.join(root, 'scripts', 'hooks', 'worker-stop-gate.mjs')
const GIT_ENV = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
const LINT_ERROR = "src/a.js\n  1:7  error  'x' is assigned a value but never used  no-unused-vars\n"

let base, project, worktree, plain, log // a temporary folder holding: the repository, a worktree of it, a plain folder

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout
}

/** A fake step: fails with the text of FAIL_<name> when that file is in the work tree; logs its name either way. */
const fakeStep = (name) => `import fs from 'node:fs'
if (process.env.STEP_LOG) fs.appendFileSync(process.env.STEP_LOG, '${name}\\n')
if (fs.existsSync('FAIL_${name}')) {
  process.stdout.write(fs.readFileSync('FAIL_${name}', 'utf8'))
  process.exit(1)
}
`

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gate-'))
  project = path.join(base, 'project')
  plain = path.join(base, 'plain')
  log = path.join(base, 'steps.log')
  for (const dir of ['scripts/hooks', 'src']) fs.mkdirSync(path.join(project, dir), { recursive: true })
  fs.mkdirSync(plain)
  fs.copyFileSync(GATE, path.join(project, 'scripts', 'hooks', 'worker-stop-gate.mjs'))
  for (const step of ['check-migrations', 'check-tests']) fs.writeFileSync(path.join(project, 'scripts', `${step}.mjs`), fakeStep(step))
  for (const step of ['lint', 'typecheck']) fs.writeFileSync(path.join(project, 'scripts', `${step}.mjs`), fakeStep(step))
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { lint: 'node scripts/lint.mjs', typecheck: 'node scripts/typecheck.mjs' } }),
  )
  fs.writeFileSync(path.join(project, 'src', 'a.js'), 'export const a = 1\n')
  git(project, 'init', '-q', '-b', 'master')
  git(project, 'add', '-A')
  git(project, 'commit', '-q', '-m', 'base')
  git(project, 'update-ref', 'refs/remotes/origin/master', 'HEAD')
  worktree = path.join(base, 'worktree')
  git(project, 'worktree', 'add', '-q', '-b', 'feature', worktree)
})

afterAll(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true })
})

beforeEach(() => {
  // Each test starts from a clean work tree: no FAIL_ file, nothing untracked, an empty log.
  for (const tree of [project, worktree]) {
    for (const name of fs.readdirSync(tree)) if (name.startsWith('FAIL_') || name === 'notes.txt') fs.rmSync(path.join(tree, name))
  }
  fs.writeFileSync(log, '')
})

/** Runs the gate the way Claude Code does, from the repository's own copy. */
function runGate(stdin, args = [], cwd = project) {
  const result = spawnSync(process.execPath, [path.join(project, 'scripts', 'hooks', 'worker-stop-gate.mjs'), ...args], {
    input: stdin,
    cwd,
    env: { ...process.env, STEP_LOG: log },
    encoding: 'utf8',
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const stop = (agent, cwd = project, extra = {}) =>
  JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's1', agent_id: agent, agent_type: 'worker', cwd, stop_hook_active: false, ...extra })
const stepsRun = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
const state = (agent) => JSON.parse(fs.readFileSync(path.join(project, '.git', 'worker-stop-gate', `${agent}.json`), 'utf8'))
const fail = (step, text = `${step} failed\n`, tree = project) => fs.writeFileSync(path.join(tree, `FAIL_${step}`), text)
const ALLOW = { code: 0, stdout: '', stderr: '' }

describe('the stop gate lets the worker stop', () => {
  it('when cwd is not a git work tree', () => {
    expect(runGate(stop('agent-plain', plain))).toEqual(ALLOW)
    expect(stepsRun()).toEqual([])
  })

  it('when nothing differs from origin/master and nothing is untracked, without running a step', () => {
    expect(runGate(stop('agent-clean'))).toEqual(ALLOW)
    expect(stepsRun()).toEqual([])
    expect(fs.existsSync(path.join(project, '.git', 'worker-stop-gate', 'agent-clean.json'))).toBe(false)
  })

  it('when the work tree differs and every step passes', () => {
    fs.writeFileSync(path.join(project, 'notes.txt'), 'an untracked file\n')
    expect(runGate(stop('agent-green'))).toEqual(ALLOW)
    expect(stepsRun()).toEqual(['check-migrations', 'check-tests', 'lint', 'typecheck'])
  })

  it('when the worker recorded that it is blocked, with the command the gate gives', () => {
    fail('lint')
    const recorded = runGate('', ['--blocked', '--agent', 'agent-stuck', 'the fix needs the owner'])
    expect(recorded.code).toBe(0)
    expect(recorded.stdout).toMatch(/^Recorded: agent agent-stuck is blocked/)
    expect(state('agent-stuck').blocked).toBe('the fix needs the owner')
    expect(runGate(stop('agent-stuck'))).toEqual(ALLOW)
    expect(stepsRun()).toEqual([])
  })

  it('--blocked without an agent id or a reason records nothing and says how', () => {
    for (const args of [['--blocked', 'a reason'], ['--blocked', '--agent', 'agent-x'], ['--blocked', '--agent', '../escape', 'why']]) {
      const result = runGate('', args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.stderr).toMatch(/^Usage: .*--blocked --agent <id>/)
    }
    expect(fs.existsSync(path.join(project, '.git', 'worker-stop-gate', 'agent-x.json'))).toBe(false)
  })

  it('on empty, malformed or unexpected input, and on any error (here: no origin/master)', () => {
    fail('lint')
    for (const input of ['', '   ', 'not json', '{', 'null', '[]', '{}', '{"agent_id":"../escape"}', '{"agent_id":42}']) {
      expect(runGate(input), JSON.stringify(input)).toEqual(ALLOW)
    }
    git(project, 'update-ref', '-d', 'refs/remotes/origin/master')
    try {
      expect(runGate(stop('agent-no-base'))).toEqual(ALLOW)
    } finally {
      git(project, 'update-ref', 'refs/remotes/origin/master', 'master')
    }
  })
})

describe('the stop gate blocks a worker whose checks fail', () => {
  it('names the step, its first lines, the command to run and the way out, and counts the block', () => {
    fail('lint', LINT_ERROR)
    const result = runGate(stop('agent-red'))
    expect(result.code).toBe(0)
    const out = JSON.parse(result.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('(block 1 of 3)')
    expect(out.reason).toContain(`- lint fails in ${project}:`)
    expect(out.reason).toContain("1:7  error  'x' is assigned a value but never used  no-unused-vars")
    expect(out.reason).toContain(`Run it: cd "${project}" && npm run -s lint`)
    expect(out.reason).toMatch(/worker-stop-gate\.mjs" --blocked --agent agent-red "<why, in one line>"/)
    expect(out.reason).not.toContain('typecheck fails')
    expect(state('agent-red').blocks).toBe(1)
  })

  it('lists every failing step, and a fix lets the worker stop and starts the count again', () => {
    fail('check-migrations')
    fail('typecheck')
    const { reason } = JSON.parse(runGate(stop('agent-fix')).stdout)
    expect(reason).toContain('node scripts/check-migrations.mjs --base origin/master')
    expect(reason).toContain('npm run -s typecheck')
    for (const step of ['check-migrations', 'typecheck']) fs.rmSync(path.join(project, `FAIL_${step}`))
    fs.writeFileSync(path.join(project, 'notes.txt'), 'still a change\n')
    expect(runGate(stop('agent-fix'))).toEqual(ALLOW)
    expect(state('agent-fix').blocks).toBe(0)
  })

  it('at most 3 times in a row for one agent: then it records that it gave up and lets it stop', () => {
    fail('lint')
    for (const n of [1, 2, 3]) expect(JSON.parse(runGate(stop('agent-loop')).stdout).reason).toContain(`(block ${n} of 3)`)
    fs.writeFileSync(log, '')
    const gaveUp = JSON.parse(runGate(stop('agent-loop')).stdout)
    expect(gaveUp.decision).toBeUndefined()
    expect(gaveUp.systemMessage).toMatch(/gave up on agent agent-loop after 3 blocks/)
    expect(state('agent-loop').gaveUp).toBe(true)
    expect(stepsRun()).toEqual([])
    expect(JSON.parse(runGate(stop('agent-other')).stdout).reason).toContain('(block 1 of 3)') // the count is per agent
  })

  it('checks the worktree that the worker edited beside the session folder, read from its transcript', () => {
    fail('typecheck', 'src/b.js(1,1): error TS2304\n', worktree)
    const transcript = path.join(base, 'agent-wt.jsonl')
    const edit = { type: 'tool_use', name: 'Edit', input: { file_path: path.join(worktree, 'src', 'a.js') } }
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { content: 'the task' } })}\n${JSON.stringify({ type: 'assistant', message: { content: [edit] } })}\n`)
    expect(runGate(stop('agent-wt-blind'))).toEqual(ALLOW) // without the transcript, cwd (the clean main checkout) is all it sees
    const { reason } = JSON.parse(runGate(stop('agent-wt', project, { agent_transcript_path: transcript })).stdout)
    expect(reason).toContain(`- typecheck fails in ${worktree}:`)
    expect(reason).toContain('error TS2304')
  })
})
