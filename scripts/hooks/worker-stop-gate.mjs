// Claude Code hook: the stop gate of the worker agent (.claude/agents/worker.md). Node built-ins only.
//
// It is wired in .claude/settings.json as a SubagentStop hook with the matcher ^worker$, so that it runs when a worker
// subagent ends its turn. Not in the worker's frontmatter: on 18/10/2026 the desktop app (Claude Code 2.1.299) did not run
// a subagent's frontmatter Stop hook, while hooks from the settings file ran inside subagents. Claude Code sends the event
// as JSON on stdin ({ "cwd", "agent_id", "agent_transcript_path", ... }). Before the worker may end its turn, the gate runs
// in its worktree the cheap part of CI's guards job, each step with its own time limit:
//   node scripts/check-migrations.mjs --base <base>
//   node scripts/check-tests.mjs --base <base>
//   npm run -s lint
//   npm run -s typecheck
// <base> is the remote's default branch: origin/HEAD, or origin/main or origin/master when origin/HEAD is not set
// (origin/master here, often origin/main in a copy of the repository).
// All pass: the worker may stop. One fails: the gate prints {"decision":"block","reason":"..."}, which Claude Code gives the
// worker as its next instruction: the step, the first lines of its output, the command, and the way out. The unit tests
// are not run here (`vitest related` takes minutes): the worker runs them and reports their output, and CI stays the gate.
//
// Which worktree: the git work trees of the files that the worker edited (read from its transcript) or, when it edited
// none, the one of `cwd`. A worker without isolation keeps the coordinator's folder as its cwd and edits a worktree beside
// it. A work tree is checked when it holds this gate (a checkout of this project) and differs from <base> (a change, a
// commit or an untracked file).
//
// It lets the worker stop (exit 0, nothing on stdout):
//   - when there is nothing to check: no such work tree, or none differs from <base>;
//   - when the worker said it is blocked, with the command that a block gives it:
//       node scripts/hooks/worker-stop-gate.mjs --blocked --agent <id> "<reason>"
//   - when it has already blocked this agent 3 times in a row: it records that it gave up, and says so to the person;
//   - on any error: a broken gate must never trap a worker. A step that cannot finish in its time is skipped.
// Its state is one JSON file per agent in <git common dir>/worker-stop-gate/, the common dir of the checkout that this
// script is in, so that every copy of it in the repository (the main checkout or a worktree) reads the same file.
// It prints only step names, paths and the first lines of a step's output, and it never reads an .env file.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const MARKER = path.join('scripts', 'hooks', 'worker-stop-gate.mjs')
const MAX_BLOCKS = 3
const BUDGET_MS = 100_000 // the settings give the hook 120 s
const STEPS = [
  { name: 'check-migrations', command: (base) => `node scripts/check-migrations.mjs --base ${base}`, timeout: 20_000 },
  { name: 'check-tests', command: (base) => `node scripts/check-tests.mjs --base ${base}`, timeout: 20_000 },
  { name: 'lint', command: () => 'npm run -s lint', timeout: 40_000 },
  { name: 'typecheck', command: () => 'npm run -s typecheck', timeout: 30_000 },
]
// A remote branch, and nothing a shell would read as more than a word: the steps run in a shell.
const BASE_REF = /^origin\/[\w.-]+(?:\/[\w.-]+)*$/
const LINES_PER_STEP = 12
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const AGENT_KEY = /^[A-Za-z0-9_-]{1,128}$/ // also the name of its state file
const MAX_TRANSCRIPT = 64 * 1024 * 1024

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true })
  if (result.error) throw result.error
  return result
}

/** The folder of the state files: <git common dir of the checkout that this script is in>/worker-stop-gate. */
function stateDir() {
  const here = path.dirname(SELF)
  const result = git(here, ['rev-parse', '--git-common-dir'])
  if (result.status !== 0) throw new Error('the gate is not in a git checkout')
  return path.join(path.resolve(here, result.stdout.trim()), 'worker-stop-gate')
}

function readState(dir, key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'))
  } catch {
    return {} // no file yet
  }
}

function writeState(dir, key, state) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${key}.json`), `${JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2)}\n`)
}

/** The work tree that holds `start` (the nearest folder with a .git), if it is a checkout of this project; else null. */
function workTreeOf(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return fs.existsSync(path.join(dir, MARKER)) ? dir : null
    if (path.dirname(dir) === dir) return null
  }
}

/** The absolute paths of the files that the transcript's Edit, Write, MultiEdit and NotebookEdit calls changed. */
function editedFiles(transcript) {
  try {
    if (typeof transcript !== 'string' || !transcript || fs.statSync(transcript).size > MAX_TRANSCRIPT) return []
    const files = new Set()
    for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue
      let content
      try {
        content = JSON.parse(line)?.message?.content
      } catch {
        continue
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type !== 'tool_use' || !EDIT_TOOLS.has(block.name)) continue
        const file = block.input?.file_path ?? block.input?.notebook_path
        if (typeof file === 'string' && path.isAbsolute(file)) files.add(file)
      }
    }
    return [...files]
  } catch {
    return [] // no transcript, or one that cannot be read: fall back to cwd
  }
}

/** The work trees to check: those of the edited files, or that of cwd when the worker edited none. */
function workTrees(input) {
  const transcript = input.hook_event_name === 'SubagentStop' ? input.agent_transcript_path : input.transcript_path
  const trees = new Set(editedFiles(transcript).map((file) => workTreeOf(path.dirname(file))).filter(Boolean))
  if (!trees.size && typeof input.cwd === 'string' && input.cwd) {
    const tree = workTreeOf(path.resolve(input.cwd))
    if (tree) trees.add(tree)
  }
  return [...trees]
}

/** The remote's default branch as a ref (origin/master here, often origin/main in a copy), or null when there is none. */
function defaultBranch(tree) {
  const head = git(tree, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const named = head.status === 0 ? head.stdout.trim() : ''
  const candidates = named ? [named] : ['origin/main', 'origin/master']
  const base = candidates.find((ref) => git(tree, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0)
  return base && BASE_REF.test(base) && !base.includes('..') ? base : null
}

/** True when the work tree differs from its base: a change or a commit of a tracked file, or an untracked file. */
function differs(tree, base) {
  const diff = git(tree, ['diff', '--quiet', base, '--'])
  if (diff.status === 1) return true
  if (diff.status !== 0) throw new Error('git diff failed') // fail open
  const untracked = git(tree, ['ls-files', '--others', '--exclude-standard'])
  if (untracked.status !== 0) throw new Error('git ls-files failed')
  return untracked.stdout.trim() !== ''
}

const firstLines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, LINES_PER_STEP)
    .map((line) => (line.length > 300 ? `${line.slice(0, 300)}...` : line))

/** The steps that fail in this work tree. A step that cannot run or finish in its time is skipped, never a failure. */
function failingSteps(tree, base, deadline) {
  const failures = []
  for (const step of STEPS) {
    const left = deadline - Date.now()
    if (left < 5_000) break // out of time: what is left is CI's to check
    // A fixed command line with no input but the checked base ref: the shell finds npm on every system (npm.cmd on Windows).
    const command = step.command(base)
    const result = spawnSync(command, {
      cwd: tree,
      shell: true,
      encoding: 'utf8',
      timeout: Math.min(step.timeout, left),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.error || result.signal || result.status === null) continue
    if (result.status !== 0) failures.push({ name: step.name, command, tree, output: firstLines(`${result.stdout}\n${result.stderr}`) })
  }
  return failures
}

function blockReason(failures, key, blocks) {
  return [
    `You cannot finish yet: the stop gate (scripts/hooks/worker-stop-gate.mjs) found a failing check (block ${blocks} of ${MAX_BLOCKS}).`,
    ...failures.map(
      (f) => `- ${f.name} fails in ${f.tree}:\n${f.output.map((line) => `    ${line}`).join('\n')}\n  Run it: cd "${f.tree}" && ${f.command}`,
    ),
    'Fix it, run the command again until it exits 0, commit the fix and push it to the same branch, and then finish.',
    'If you cannot fix it (it needs the owner, or the failure does not come from your change), run',
    `  node "${SELF}" --blocked --agent ${key} "<why, in one line>"`,
    'then finish, and start your report with BLOCKED and the reason.',
  ].join('\n')
}

/** What to print for this stop event: a block, a message for the person, or null (stop, nothing to say). */
function gate(input) {
  const key = input?.agent_id ?? input?.session_id
  if (typeof key !== 'string' || !AGENT_KEY.test(key)) return null
  const dir = stateDir()
  const state = readState(dir, key)
  if (state.blocked) return null
  if ((state.blocks ?? 0) >= MAX_BLOCKS) {
    writeState(dir, key, { ...state, gaveUp: true })
    return { systemMessage: `The worker stop gate gave up on agent ${key} after ${MAX_BLOCKS} blocks: its checks may still fail, CI will say.` }
  }
  const deadline = Date.now() + BUDGET_MS
  const failures = workTrees(input).flatMap((tree) => {
    const base = defaultBranch(tree)
    if (!base) throw new Error('no default branch') // fail open
    return differs(tree, base) ? failingSteps(tree, base, deadline) : []
  })
  if (!failures.length) {
    if (state.blocks) writeState(dir, key, { ...state, blocks: 0 })
    return null
  }
  const blocks = (state.blocks ?? 0) + 1
  writeState(dir, key, { ...state, blocks })
  return { decision: 'block', reason: blockReason(failures, key, blocks) }
}

/** `--blocked --agent <id> "<reason>"`, run by the worker: records the marker that lets it stop. */
function recordBlocked(args) {
  const at = args.indexOf('--agent')
  const key = at >= 0 ? args[at + 1] : undefined
  const reason = args.filter((arg, i) => arg !== '--blocked' && (at < 0 || (i !== at && i !== at + 1))).join(' ').trim()
  if (typeof key !== 'string' || !AGENT_KEY.test(key) || !reason) {
    process.stderr.write(
      'Usage: node scripts/hooks/worker-stop-gate.mjs --blocked --agent <id> "<why, in one line>"\n' +
        'The id is in the message of the stop gate that blocked you.\n',
    )
    return 1
  }
  const dir = stateDir()
  writeState(dir, key, { ...readState(dir, key), blocked: reason.slice(0, 500) })
  process.stdout.write(
    `Recorded: agent ${key} is blocked. The stop gate lets you finish now. Start your report with BLOCKED, then say why, ` +
      'what you tried, and what the owner or the coordinator must do.\n',
  )
  return 0
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--blocked')) {
    try {
      return recordBlocked(args)
    } catch {
      process.stderr.write('Could not record the block. Finish anyway, and start your report with BLOCKED and the reason.\n')
      return 1
    }
  }
  try {
    const result = gate(JSON.parse(fs.readFileSync(0, 'utf8')))
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch {
    // fail open: the worker may stop
  }
  return 0
}

process.exitCode = main()
