// The Claude Code hook that lints an edited file (scripts/hooks/lint-edit.mjs, wired in .claude/settings.json as a
// PostToolUse hook for Edit, Write and MultiEdit): runs the real script in a child process with the hook JSON on stdin,
// against temporary checkouts, and reads its exit code and stderr. Exit 0 is silence, exit 2 is "ESLint reports a problem
// in this file, fix it now". A temporary checkout runs this repository's ESLint (its node_modules is a link to ours) with a
// small configuration of its own. No database and no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const HOOK = path.join(root, 'scripts', 'hooks', 'lint-edit.mjs')
const CONFIG = `export default [
  { ignores: ['dist/'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-unused-vars': 'error', 'no-debugger': 'warn' },
  },
]
`
const UNUSED = 'const unused = 1\nexport const used = 2\n'
const SILENT = { code: 0, stdout: '', stderr: '' }

let checkout, broken, bare, outside // a checkout, one whose configuration throws, one without ESLint, and a plain folder

/** A temporary checkout of this project: a .git folder, this hook (which marks a checkout), a configuration, node_modules. */
function makeCheckout(prefix, config, withEslint = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  for (const sub of ['.git', 'scripts/hooks', 'src', 'dist']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.copyFileSync(HOOK, path.join(dir, 'scripts', 'hooks', 'lint-edit.mjs'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n')
  fs.writeFileSync(path.join(dir, 'eslint.config.js'), config)
  if (withEslint) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
  return dir
}

beforeAll(() => {
  checkout = makeCheckout('lint-hook-', CONFIG)
  broken = makeCheckout('lint-hook-broken-', "throw new Error('a broken configuration')\n")
  bare = makeCheckout('lint-hook-bare-', CONFIG, false)
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hook-outside-'))
})

afterAll(() => {
  for (const dir of [checkout, broken, bare, outside]) {
    if (!dir) continue
    const link = path.join(dir, 'node_modules')
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.rmSync(link) // the link on its own, never followed
    fs.rmSync(dir, { recursive: true, force: true })
  }
  expect(fs.existsSync(path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'))).toBe(true)
})

const write = (base, relative, text) => {
  const file = path.join(base, relative)
  fs.writeFileSync(file, text)
  return file
}

/** Runs the hook the way Claude Code does. The session's folder (cwd, CLAUDE_PROJECT_DIR) is `outside` by default. */
function runHook(stdin, sessionDir = outside) {
  const result = spawnSync(process.execPath, [HOOK], { input: stdin, cwd: sessionDir, env: { ...process.env, CLAUDE_PROJECT_DIR: sessionDir }, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const edited = (file, cwd = outside) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: file } })
const lint = (file, sessionDir = outside) => runHook(edited(file, sessionDir), sessionDir)

describe('the lint hook: a file with a problem exits 2', () => {
  it('names the file, the rule and the place, for a file in a checkout beside the session folder', () => {
    const result = lint(write(checkout, 'src/unused.js', UNUSED))
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^src\/unused\.js: ESLint reports a problem/)
    expect(result.stderr).toMatch(/1:7\s+error\s+'unused' is assigned a value but never used\s+no-unused-vars/)
    expect(result.stderr).toMatch(/fix it now/)
  })

  it('for a warning too (`npm run lint` runs with --max-warnings 0), a .jsx file and a file that does not parse', () => {
    expect(lint(write(checkout, 'src/warn.mjs', 'export function stop() {\n  debugger\n}\n')).stderr).toContain('no-debugger')
    expect(lint(write(checkout, 'src/view.jsx', 'const unused = 1\nexport const V = () => <p>hi</p>\n')).stderr).toContain('no-unused-vars')
    expect(lint(write(checkout, 'src/broken.js', 'export const = 1\n')).code).toBe(2)
  })

  it('takes a relative path from the cwd of the hook input', () => {
    write(checkout, 'src/relative.js', UNUSED)
    expect(lint(path.join('src', 'relative.js'), checkout).code).toBe(2)
  })

  it('shows the first 30 lines of a long report and says how to see the rest', () => {
    const result = lint(write(checkout, 'src/many.js', Array.from({ length: 40 }, (_, i) => `const unused${i} = ${i}\n`).join('')))
    expect(result.stderr).toMatch(/more lines: run npx eslint src\/many\.js/)
    expect(result.stderr.split('\n').length).toBeLessThan(40)
  })
})

describe('the lint hook: what it leaves alone exits 0 in silence', () => {
  it('a clean file, a file that is not .js, .jsx or .mjs, and a file that ESLint ignores (no warning about it)', () => {
    expect(lint(write(checkout, 'src/clean.js', 'export const answer = 42\n'))).toEqual(SILENT)
    for (const name of ['src/unused.cjs', 'src/notes.md', 'dist/bundle.js']) expect(lint(write(checkout, name, UNUSED)), name).toEqual(SILENT)
  })

  it('a file outside a checkout, in a checkout without ESLint, or where ESLint fails on its own (a broken configuration)', () => {
    expect(lint(write(outside, 'loose.js', UNUSED))).toEqual(SILENT)
    expect(lint(write(bare, 'src/unused.js', UNUSED))).toEqual(SILENT)
    expect(lint(write(broken, 'src/unused.js', UNUSED))).toEqual(SILENT)
  })

  it('a file that no longer exists, and empty, malformed or unexpected input', () => {
    const gone = write(checkout, 'src/gone.js', UNUSED)
    fs.rmSync(gone)
    expect(lint(gone)).toEqual(SILENT)
    for (const input of ['', '   ', 'not json', '{', 'null', '[]', '{}', '{"tool_input":{}}', '{"tool_input":{"file_path":42}}']) {
      expect(runHook(input), JSON.stringify(input)).toEqual(SILENT)
    }
  })
})

describe('the lint hook: the wiring', () => {
  it('runs after every Edit, Write and MultiEdit, next to the edit hook, from .claude/settings.json', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'))
    const group = settings.hooks.PostToolUse.find((g) => g.matcher === 'Edit|Write|MultiEdit')
    expect(group.hooks).toEqual([
      { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/check-edit.mjs"', timeout: 30 },
      { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/lint-edit.mjs"', timeout: 30 },
    ])
  })
})
