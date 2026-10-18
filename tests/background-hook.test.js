// The Claude Code hook that refuses a background shell command without a time limit of its own
// (scripts/hooks/check-background.mjs, wired in .claude/settings.json as a PreToolUse hook for Bash and PowerShell): runs
// the real script in a child process with the hook JSON on stdin, as Claude Code does, and reads its exit code and stderr.
// Exit 0 lets the command run, exit 2 refuses it. No database and no network.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const HOOK = path.join(root, 'scripts', 'hooks', 'check-background.mjs')

/** Runs the hook the way Claude Code does: the tool call as JSON on stdin. */
function runHook(stdin) {
  const result = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const call = (command, { tool = 'Bash', background = true } = {}) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command, run_in_background: background } })
const ALLOW = { code: 0, stdout: '', stderr: '' }

// Background Bash commands that have no time limit of their own, or a part outside it.
const REFUSED = [
  'until false; do sleep 5; done', // the loop of 15/10/2026
  'npm run test:e2e',
  'npx vitest --watch',
  'tail -f server.log',
  'cd "C:/work/tree" && npm test',
  // TERM alone is not an upper bound: a program can catch or ignore it, and this one outlives `timeout 1` (Codex on #274).
  `timeout 1 sh -c 'trap "" TERM; while :; do sleep 1; done'`,
  'timeout 300 npm test',
  'timeout -k 0 300 npm test', // GNU timeout reads 0 as no limit, for -k too
  'timeout -k 10 0 npm test',
  'timeout -k 10 0s npm test',
  'timeout --kill-after=10 300 npm test', // one fixed form only: nothing to parse
  'timeout -s KILL 300 npm test',
  'timeout -k 10 --signal 9 0 npm test',
  'timeout -k 10 $LIMIT npm test',
  'timeout -k 10 300',
  'timeout -k 10 300 npm test; until false; do sleep 1; done',
  'timeout -k 10 300 npm test && npm run build',
  'timeout -k 10 300 npm test || until false; do sleep 1; done',
  'timeout -k 10 300 npm test | tail -40',
  'timeout -k 10 300 npm test |& tail -40',
  'timeout -k 10 300 npm test &',
  'timeout -k 10 300 npm test\nuntil false; do sleep 1; done',
  'npm test && timeout -k 10 300 npm run build', // only cd may come before the limit
  'timeout -k 10 300 echo $(until false; do sleep 1; done)',
  'timeout -k 10 300 echo "$(sleep 999)"',
  'timeout -k 10 300 echo `sleep 999`',
  'timeout -k 10 300 diff <(sleep 999) a.txt',
  // Forms of the shell that the hook does not follow, each of which can hide a separator from it (each one, run in bash,
  // ran its second command outside the limit; the first two are Codex's on #274).
  "timeout -k 1 1 true $'a\\''; echo OUTSIDE",
  'timeout -k 1 1 echo x \\>& tail -f /dev/null',
  "timeout -k 1 1 true #'\ntail -f /dev/null",
  'timeout -k 1 1 echo $"hi"',
  'timeout -k 10 60 find . -name \\*.js', // an escape outside quotes, refused even where it would be harmless
]

// Commands that have their own limit, or that the Bash tool stops by itself.
const ALLOWED = [
  ['timeout -k 10 1800 npm run test:e2e', {}],
  ['timeout -k 30s 30m npm run test:e2e', {}],
  ['timeout -k 1 0.5 sleep 1', {}],
  [`timeout -k 1 1 sh -c 'trap "" TERM; while :; do sleep 1; done'`, {}], // KILL 1 s after TERM ends it
  ['cd "C:/Users/Some One/bqr-x" && timeout -k 10 1800 npm run test:unit', {}],
  ["cd a && cd 'b c' && timeout -k 10 60 npm test", {}],
  [`timeout -k 10 1800 sh -c 'npm run test:e2e 2>&1 | tail -40; echo "exit=$?"'`, {}],
  [`timeout -k 10 300 sh -c 'until test -f done; do sleep 5; done; echo $(date)'`, {}], // inside single quotes, the shell under the limit runs it
  ['timeout -k 10 300 sh -c "until test -f done; do sleep 5; done"', {}],
  ['timeout -k 10 600 npm test > out.log 2>&1', {}],
  ['timeout -k 10 600 npm test &> out.log', {}],
  [`timeout -k 10 60 node -e "console.log('a;b|c&d')"`, {}],
  ['timeout -k 10 60 npm \\\n  test', {}], // a line continued with a backslash
  ['timeout -k 10 60 echo "a\\"; tail -f x"', {}], // inside double quotes \" does not end them, so ; stays inside
  ["timeout -k 10 60 echo 'a#b' x#y", {}], // a # inside a word starts no comment
  ['until false; do sleep 5; done', { background: false }], // the foreground: the Bash tool stops it
  ['npx vitest --watch', { background: false }],
  ['until false; do sleep 5; done', { tool: 'Monitor' }],
]

describe('the background hook: a background command without a limit of its own is refused', () => {
  it.each(REFUSED)('refuses %j', (command) => {
    const result = runHook(call(command))
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/would run in the background, where nothing stops it/)
    expect(result.stderr).toMatch(/It did not run/)
  })

  it('says why, and gives the form', () => {
    expect(runHook(call('timeout -k 10 0 npm test')).stderr).toContain('one of its times is 0')
    expect(runHook(call('timeout -k 10 300 npm test | tail -40')).stderr).toContain('a part of it runs outside the time limit')
    expect(runHook(call('timeout -k 10 300 echo $(sleep 9)')).stderr).toContain('a form of the shell that this hook does not follow')
    expect(runHook(call('timeout 300 npm test')).stderr).toContain('it does not start with `timeout -k <seconds> <seconds>`')
    const { stderr } = runHook(call('npx vitest --watch'))
    expect(stderr).toContain('KILL 10 seconds after TERM')
    expect(stderr).toContain('timeout -k 10 1800 npm run test:e2e')
    expect(stderr).toContain(`cd "<dir>" && timeout -k 10 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`)
  })

  it('and lets the forms of its message through', () => {
    expect(runHook(call('timeout -k 10 1800 npm run test:e2e'))).toEqual(ALLOW)
    expect(runHook(call(`cd "C:/work/tree" && timeout -k 10 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`))).toEqual(ALLOW)
  })

  it('refuses a background PowerShell command, which has no timeout', () => {
    const result = runHook(call('timeout -k 10 1800 npm test', { tool: 'PowerShell' }))
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/Run it with the Bash tool as `timeout -k 10 <seconds> <command>`/)
    expect(runHook(call('npm test', { tool: 'PowerShell', background: false }))).toEqual(ALLOW)
  })
})

describe('the background hook: what it lets through', () => {
  it.each(ALLOWED)('lets %j run (%j)', (command, options) => {
    expect(runHook(call(command, options))).toEqual(ALLOW)
  })
})

describe('the background hook: it never breaks a session', () => {
  it('empty, malformed or unexpected input exits 0', () => {
    for (const input of ['', '   ', 'not json', '{', 'null', '[]', '{}', '{"tool_name":"Bash"}', '{"tool_name":"Bash","tool_input":{"command":42,"run_in_background":true}}']) {
      expect(runHook(input), JSON.stringify(input)).toEqual(ALLOW)
    }
  })
})

describe('the background hook: the wiring', () => {
  it('runs before every Bash and PowerShell command, from .claude/settings.json', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'))
    const group = settings.hooks.PreToolUse.find((g) => g.matcher === 'Bash|PowerShell')
    expect(group.hooks).toContainEqual({
      type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/check-background.mjs"',
      timeout: 10,
    })
  })
})
