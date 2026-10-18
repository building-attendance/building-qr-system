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
  'timeout 0 npm test', // GNU timeout reads 0 as no limit
  'timeout 0s npm test',
  'timeout -k 5 300 npm test', // an option before the number: the plain form only
  'timeout --signal 9 0 npm test',
  'timeout $LIMIT npm test',
  'timeout 300',
  'timeout 300 npm test; until false; do sleep 1; done',
  'timeout 300 npm test && npm run build',
  'timeout 300 npm test || until false; do sleep 1; done',
  'timeout 300 npm test | tail -40',
  'timeout 300 npm test |& tail -40',
  'timeout 300 npm test &',
  'timeout 300 npm test\nuntil false; do sleep 1; done',
  'npm test && timeout 300 npm run build', // only cd may come before the limit
  'timeout 300 echo $(until false; do sleep 1; done)',
  'timeout 300 echo "$(sleep 999)"',
  'timeout 300 echo `sleep 999`',
  'timeout 300 diff <(sleep 999) a.txt',
]

// Commands that have their own limit, or that the Bash tool stops by itself.
const ALLOWED = [
  ['timeout 1800 npm run test:e2e', {}],
  ['timeout 30m npm run test:e2e', {}],
  ['timeout 0.5 sleep 1', {}],
  ['cd "C:/Users/Some One/bqr-x" && timeout 1800 npm run test:unit', {}],
  ["cd a && cd 'b c' && timeout 60 npm test", {}],
  [`timeout 1800 sh -c 'npm run test:e2e 2>&1 | tail -40; echo "exit=$?"'`, {}],
  [`timeout 300 sh -c 'until test -f done; do sleep 5; done; echo $(date)'`, {}], // inside single quotes, the shell under the limit runs it
  ['timeout 300 sh -c "until test -f done; do sleep 5; done"', {}],
  ['timeout 600 npm test > out.log 2>&1', {}],
  ['timeout 600 npm test &> out.log', {}],
  [`timeout 60 node -e "console.log('a;b|c&d')"`, {}],
  ['timeout 60 npm \\\n  test', {}], // a line continued with a backslash
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

  it('says why, and gives the plain form', () => {
    expect(runHook(call('timeout 0 npm test')).stderr).toContain('its time limit is 0')
    expect(runHook(call('timeout 300 npm test | tail -40')).stderr).toContain('a part of it runs outside the time limit')
    expect(runHook(call('timeout 300 echo $(sleep 9)')).stderr).toContain('which the shell runs before the time limit starts')
    const { stderr } = runHook(call('npx vitest --watch'))
    expect(stderr).toContain('it does not start with a plain `timeout <n>`')
    expect(stderr).toContain('timeout 1800 npm run test:e2e')
    expect(stderr).toContain(`cd "<dir>" && timeout 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`)
  })

  it('and lets the forms of its message through', () => {
    expect(runHook(call('timeout 1800 npm run test:e2e'))).toEqual(ALLOW)
    expect(runHook(call(`cd "C:/work/tree" && timeout 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`))).toEqual(ALLOW)
  })

  it('refuses a background PowerShell command, which has no timeout', () => {
    const result = runHook(call('timeout 1800 npm test', { tool: 'PowerShell' }))
    expect(result.code).toBe(2)
    expect(result.stderr).toMatch(/Run it with the Bash tool as `timeout <seconds> <command>`/)
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
