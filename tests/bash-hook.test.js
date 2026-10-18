// The Claude Code hook that refuses a wait with no limit (scripts/hooks/check-bash.mjs, wired in .claude/settings.json as a
// PreToolUse hook for Bash and PowerShell): runs the real script in a child process with the hook JSON on stdin, as Claude
// Code does, and reads its exit code and stderr. Exit 0 lets the command run, exit 2 refuses it. No database and no network.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const HOOK = path.join(root, 'scripts', 'hooks', 'check-bash.mjs')

/** Runs the hook the way Claude Code does: the tool call as JSON on stdin. */
function runHook(stdin) {
  const result = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const call = (command, tool = 'Bash', extra = {}) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command, ...extra } })

// [command, tool]: each one waits with no limit.
const REFUSED = [
  ['until false; do sleep 5; done', 'Bash'],
  ['while :\ndo\n  sleep 5\ndone', 'Bash'],
  ['until gh pr checks 270 | grep -q pass; do sleep 30; done', 'Bash'],
  ['while ! curl -sf http://localhost:3000 > /dev/null; do sleep 1; done', 'Bash'],
  ['npm run build && until [ -f dist/index.html ]; do sleep 2; done', 'Bash'],
  ['bash -c "while true; do sleep 1; done"', 'Bash'],
  ['until curl -sf --max-time 5 http://localhost:3000; do sleep 2; done', 'Bash'], // --max-time caps one request, not the loop
  ['powershell -Command "while ($true) { Start-Sleep 5 }"', 'Bash'],
  ['tail -f server.log', 'Bash'],
  ['tail -n 50 -F server.log', 'Bash'],
  ['gh pr checks 270 --watch', 'Bash'],
  ['gh run watch 123456 --exit-status', 'Bash'],
  ['while ($true) { Start-Sleep -Seconds 5 }', 'PowerShell'],
  ['do { Start-Sleep 5 } until (Test-Path dist)', 'PowerShell'],
  ['While (-not (Test-Path x)) { sleep 2 }', 'PowerShell'],
  ['Get-Content server.log -Wait', 'PowerShell'],
  ['gh pr checks 270 --watch', 'PowerShell'],
  // GNU timeout reads a duration of 0 as no limit, and -k takes a value of its own (Codex on #271).
  ["timeout 0 sh -c 'until false; do sleep 5; done'", 'Bash'],
  ["timeout -k 5 0 bash -c 'while true; do sleep 5; done'", 'Bash'],
  ['timeout 0s tail -f server.log', 'Bash'],
  ['Start-Job { while ($true) { Start-Sleep 5 } } | Wait-Job -Timeout 0', 'PowerShell'],
]

// [command, tool]: each one has a limit, or does not wait.
const ALLOWED = [
  ["timeout 20 sh -c 'until false; do sleep 5; done'", 'Bash'],
  ["timeout -k 5 300 bash -c 'while true; do sleep 5; done'", 'Bash'],
  ["timeout -k 0 20 sh -c 'until false; do sleep 5; done'", 'Bash'], // the duration is 20: -k 0 only drops the kill
  ["timeout 0.5 sh -c 'while true; do sleep 0.1; done'", 'Bash'],
  ['timeout --kill-after=5 30s tail -f server.log', 'Bash'],
  ['for i in $(seq 30); do curl -sf http://localhost:3000 && break; sleep 2; done', 'Bash'],
  ['i=0; until curl -sf http://localhost:3000 || [ $i -ge 30 ]; do i=$((i+1)); sleep 2; done', 'Bash'],
  ['n=0; while (( n < 10 )); do n=$((n+1)); sleep 1; done', 'Bash'],
  ['while read -r line; do echo "$line"; done < files.txt', 'Bash'],
  ['git ls-files | while IFS= read -r f; do wc -l "$f"; sleep 0.1; done', 'Bash'],
  ['node -e "const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); (async () => { while (!done()) await sleep(500) })()"', 'Bash'],
  ['sleep 5', 'Bash'],
  ['tail -n 50 server.log', 'Bash'],
  ['timeout 60 tail -f server.log', 'Bash'],
  ['timeout 600 gh pr checks 270 --watch', 'Bash'],
  ['gh pr checks 270', 'Bash'],
  ['git commit -m "fix: wait until the server is up, then sleep 5 seconds"', 'Bash'],
  ['npx playwright test --timeout 5000', 'Bash'],
  ['$i = 0; while (-not (Test-Path dist) -and $i -lt 60) { Start-Sleep 1; $i++ }', 'PowerShell'],
  ['Get-Content server.log -Tail 50', 'PowerShell'],
  ['Start-Sleep 5', 'PowerShell'],
]

describe('the wait hook: a wait with no limit is refused', () => {
  it.each(REFUSED)('refuses %j (%s)', (command, tool) => {
    const result = runHook(call(command, tool))
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/waits with no limit/)
    expect(result.stderr).toMatch(/did not run/)
  })

  it('also in the background, where nothing else would stop it', () => {
    expect(runHook(call('until false; do sleep 5; done', 'Bash', { run_in_background: true })).code).toBe(2)
  })
})

describe('the wait hook: what it lets through', () => {
  it.each(ALLOWED)('lets %j run (%s)', (command, tool) => {
    expect(runHook(call(command, tool))).toEqual({ code: 0, stdout: '', stderr: '' })
  })
})

describe('the wait hook: the message gives two capped forms, in the language of the shell', () => {
  it.each([
    ['until false; do sleep 5; done', 'Bash', ["timeout 300 sh -c 'until <check>; do sleep 5; done'", 'for i in $(seq 60); do <check> && break; sleep 5; done']],
    ['while ($true) { Start-Sleep 5 }', 'PowerShell', ['while (-not (<check>) -and (Get-Date) -lt $end)', 'for ($i = 0; $i -lt 60 -and -not (<check>); $i++)']],
    ['tail -f server.log', 'Bash', ['tail -n 50 <file>', 'timeout 300 <command>']],
    ['Get-Content server.log -Wait', 'PowerShell', ['Get-Content <file> -Tail 50', 'Wait-Job -Timeout 300']],
  ])('for %j (%s)', (command, tool, forms) => {
    const { stderr } = runHook(call(command, tool))
    for (const form of forms) expect(stderr).toContain(form)
  })

  it('and the hook lets each of those forms through', () => {
    for (const [command, tool] of [
      ["timeout 300 sh -c 'until test -f done; do sleep 5; done'", 'Bash'],
      ['for i in $(seq 60); do test -f done && break; sleep 5; done', 'Bash'],
      ['$end = (Get-Date).AddMinutes(5); while (-not (Test-Path done) -and (Get-Date) -lt $end) { Start-Sleep 5 }', 'PowerShell'],
      ['for ($i = 0; $i -lt 60 -and -not (Test-Path done); $i++) { Start-Sleep 5 }', 'PowerShell'],
      ['timeout 300 tail -f server.log', 'Bash'],
      ['Start-Job { Get-Content server.log -Wait } | Wait-Job -Timeout 300', 'PowerShell'],
    ]) {
      expect(runHook(call(command, tool)).code, command).toBe(0)
    }
  })
})

describe('the wait hook: it never breaks a session', () => {
  it('empty, malformed or unexpected input exits 0', () => {
    for (const input of ['', '   ', 'not json', '{', 'null', '[]', '{}', '{"tool_name":"Bash"}', '{"tool_name":"Bash","tool_input":{"command":42}}']) {
      expect(runHook(input), JSON.stringify(input)).toEqual({ code: 0, stdout: '', stderr: '' })
    }
  })

  it('another tool exits 0, whatever its input says', () => {
    expect(runHook(call('until false; do sleep 5; done', 'Monitor')).code).toBe(0)
    expect(runHook(call('until false; do sleep 5; done', 'Read')).code).toBe(0)
  })

  it('a very long command (a file written through a heredoc) exits 0', () => {
    const long = `cat > notes.txt <<'EOF'\n${'x'.repeat(200_001)}\nEOF\nuntil false; do sleep 5; done`
    expect(runHook(call(long)).code).toBe(0)
  })
})

describe('the wait hook: the wiring', () => {
  it('runs before every Bash and PowerShell command, from .claude/settings.json', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'))
    const group = settings.hooks.PreToolUse.find((g) => g.matcher === 'Bash|PowerShell')
    expect(group.hooks).toContainEqual({
      type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/check-bash.mjs"',
      timeout: 10,
    })
  })
})
