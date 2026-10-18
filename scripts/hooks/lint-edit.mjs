// Claude Code hook: runs ESLint on a JavaScript file right after the agent has edited it. Node built-ins only.
//
// It is wired in .claude/settings.json as a PostToolUse hook for Edit, Write and MultiEdit, next to check-edit.mjs. Claude
// Code runs it after every such edit and sends the tool call as JSON on stdin ({ "tool_input": { "file_path": "..." } }).
// `npm run lint` fails CI on any problem, a warning included; this tells the agent at once, file by file, instead.
//
// Which files: .js, .jsx and .mjs files in a checkout of this project. The checkout is the git work tree that holds the
// file (the nearest folder above it with a .git), and it counts as one when it holds this hook. The file is linted with
// that checkout's ESLint and configuration, so a file in a worktree is linted by the worktree. The session's folder is not
// used: a subagent that edits a worktree beside the main checkout keeps the main checkout as its cwd and as
// CLAUDE_PROJECT_DIR.
//
// Exit code 0: nothing to say (no problem, not a JavaScript file of a checkout, ignored by ESLint, or no ESLint there).
// Exit code 2: ESLint reports a problem. The first lines of its report go to stderr, and Claude Code shows them to the
// agent. The edit is already saved at that point, so the message asks for the fix before the next step.
//
// A hook must never break a session: empty or unexpected input, a missing file, ESLint's own failure (exit 2, for example
// a broken configuration), a timeout (20 s) or any other error ends with 0.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const JS_FILE = /\.(?:js|jsx|mjs)$/
const SELF = path.join('scripts', 'hooks', 'lint-edit.mjs')
const ESLINT = path.join('node_modules', 'eslint', 'bin', 'eslint.js')
const TIMEOUT_MS = 20_000
const MAX_LINES = 30

/** The checkout of this project that holds `file`, or null: the nearest folder above it with a .git, if it has this hook. */
function checkoutOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return fs.existsSync(path.join(dir, SELF)) ? dir : null
    if (path.dirname(dir) === dir) return null
  }
}

/** ESLint's report on one edited file as a message for the agent, or null when there is nothing to say. */
function lintFile(file) {
  if (!JS_FILE.test(file) || !fs.statSync(file).isFile()) return null // statSync throws when the file is gone: caught in main
  const checkout = checkoutOf(file)
  if (!checkout || !fs.existsSync(path.join(checkout, ESLINT))) return null
  const result = spawnSync(process.execPath, [path.join(checkout, ESLINT), '--max-warnings', '0', '--no-warn-ignored', file], {
    cwd: checkout,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    windowsHide: true,
  })
  // 0: clean. 1: problems in the file. Anything else (2: ESLint could not run, null: the timeout killed it) is not about
  // the file, so it is not the agent's to fix here: `npm run lint` and CI still run.
  if (result.error || result.status !== 1) return null
  const name = path.relative(checkout, file).split(path.sep).join('/')
  const report = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter((line) => line.trim())
  const shown = report.slice(0, MAX_LINES).join('\n')
  const more = report.length > MAX_LINES ? `\n  ... ${report.length - MAX_LINES} more lines: run npx eslint ${name}` : ''
  return (
    `${name}: ESLint reports a problem, and \`npm run lint\` fails CI on it (scripts/hooks/lint-edit.mjs). The edit is ` +
    `already saved: fix it now, before you do anything else.\n${shown}${more}\n`
  )
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'))
    const filePath = input?.tool_input?.file_path
    if (typeof filePath !== 'string' || !filePath) return 0
    const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
    const message = lintFile(fs.realpathSync(path.resolve(base, filePath)))
    if (!message) return 0
    process.stderr.write(message)
    return 2
  } catch {
    return 0
  }
}

process.exitCode = main()
