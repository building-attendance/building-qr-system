// Claude Code hook: refuses a shell command that waits with no limit, before it runs. Node built-ins only.
//
// It is wired in .claude/settings.json as a PreToolUse hook for Bash and PowerShell, so it runs before every shell command
// of every session in this repository, the agent loop on GitHub included (claude.yml uses the same settings). Claude Code
// sends the tool call as JSON on stdin ({ "tool_name": "Bash", "tool_input": { "command": "..." }, ... }).
//
// Why: a wait with no limit runs for as long as the thing it waits for does not happen, which can be hours (a worker once
// looped for 21). Every wait gets a cap, and the cheapest place to make sure is before the command runs.
//
// It refuses (exit 2, the message on stderr, which Claude Code shows to the agent instead of running the command):
//   - a loop (`until` or `while` in a shell; `while (` or `do { } until (` in PowerShell) that sleeps (the word `sleep`
//     followed by anything, or `Start-Sleep`), when nothing in the command limits it: no `timeout <n>`, no counter test
//     (`-lt`, `-le`, `-gt`, `-ge`, `(( a < b ))`, `seq <n>`) and no PowerShell `-Timeout <n>`;
//   - a command that follows without end (`tail -f`, `tail --follow`, PowerShell `Get-Content -Wait`, `gh ... --watch`,
//     `gh run watch`), when it has no `timeout <n>` (or PowerShell `-Timeout <n>`).
// It lets through a loop that does not sleep (so a `while` inside `node -e "..."` runs), a `while read` loop (it ends with
// its input), a JavaScript `sleep(500)`, and a loop with a counter. `--max-time` is not a limit of a loop on purpose: it
// caps one request, and the loop around it goes on.
//
// It reads text, it does not parse the shell: a limit anywhere in the command counts, and a word inside a quoted string
// counts like code (so `sh -c '...'` is read too). It catches the common way of waiting forever, not every way. Where it
// has to guess what a sleep or a limit is, it guesses toward refusing, because a refused command costs the agent one
// rewrite and a missed one can run for hours: anything after `sleep` makes a sleep (`sleep .5`, `sleep "$D"`), and only
// the plain form of a limit counts, with a number above zero (chosen on #271 after three review rounds that each found
// another spelling: `timeout 0`, `timeout --signal 9 0`, `sleep .5`).
//
// Exit code 0: run the command. Exit code 2: refused. Empty or unexpected input, a very long command or any error: 0, a
// hook must never break a session.
import fs from 'node:fs'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const MAX_COMMAND = 200_000 // a command this long is a file written through a heredoc, not a wait: let it through

// A shell loop: `until` or `while` where a command starts (at the start, after ; & | ( { ! a quote or a new line, or
// after do, then or else). A shell keyword is lower case. `while read` is not a wait: it ends with its input.
const SHELL_LOOP = /(?:^|[;&|({!'"`\n]|\b(?:do|then|else)\b)\s*(?:until|while)\b(?!\s+(?:IFS=\S*\s+)?read\b)/
// A PowerShell loop: while (...) { }, and do { } until (...) or do { } while (...). PowerShell ignores case.
const POWERSHELL_LOOP = /\bwhile\s*\(|\bdo\s*\{[\s\S]*\}\s*(?:until|while)\b/i
// A sleep: the word `sleep` with any operand after it (`sleep 5`, `sleep .5`, `sleep "$DELAY"`, PowerShell's alias
// `sleep -Seconds 5`), and `Start-Sleep`. Not code that names a function sleep: `sleep(500)`, `time.sleep(5)`,
// `const sleep = (ms) => ...` (an operand never starts with `=`, `(`, `)`, `;`, `|` or `&`).
const SLEEP = /(?:^|[^\w$.-])sleep\s+[^\s=();|&]|\bStart-Sleep\b/i
// A limit, only in its plain form and above zero: GNU `timeout <n>` with the number right after the word (`timeout 300`,
// `timeout 0.5`, `timeout 20s`; not a `--timeout` option of another command), PowerShell's `-Timeout <n>` (Wait-Job,
// Wait-Process), and for a loop a counter test as well. Any other form is not read as a limit, on purpose: GNU timeout
// reads 0 as no limit at all, and its options take values that look like a duration (`timeout -k 5 0`, `timeout --signal
// 9 0`), so a command with options before the duration is refused, and the message gives the plain form.
const TIMEOUT = /(?<![\w-])timeout\s+(\d+(?:\.\d*)?|\.\d+)[smhd]?(?=\s|$)/g
const POWERSHELL_TIMEOUT = /\s-Timeout\s+(\d+)\b/gi
const hasLimit = (command) =>
  [...command.matchAll(TIMEOUT), ...command.matchAll(POWERSHELL_TIMEOUT)].some((match) => Number(match[1]) > 0)
const COUNTER = /\s-(?:lt|le|gt|ge)\b|\(\([^)]*[<>][^)]*\)\)|\bseq\s+\d/i
// A command that follows without end: `tail -f`, `tail -n 50 -F`, `tail --follow=name`, PowerShell's `Get-Content -Wait`
// (and its aliases), `gh pr checks --watch`, `gh run watch`. Only inside one simple command (up to ; & | or a new line).
const FOLLOWS = [
  { test: /\btail\b[^\n;&|]*?\s(?:-[A-Za-z0-9]*[fF][A-Za-z0-9]*\b|--follow\b)/, what: '`tail -f` follows the file without end' },
  { test: /\b(?:Get-Content|gc|cat|type)\b[^\n;&|]*?\s-Wait\b/i, what: '`Get-Content -Wait` follows the file without end' },
  { test: /\bgh\b[^\n;&|]*?(?:\s--watch\b|\srun\s+watch\b)/, what: '`gh ... --watch` waits for as long as the checks run' },
]

/** Why this command waits with no limit, or null when it does not (or has a limit). */
function findUnlimitedWait(command) {
  if (typeof command !== 'string' || !command || command.length > MAX_COMMAND) return null
  const hasTimeout = hasLimit(command)
  if ((SHELL_LOOP.test(command) || POWERSHELL_LOOP.test(command)) && SLEEP.test(command) && !hasTimeout && !COUNTER.test(command)) {
    return { kind: 'loop', what: 'a loop that sleeps until something happens, with nothing that ends it if it never does' }
  }
  if (!hasTimeout) {
    const follow = FOLLOWS.find(({ test }) => test.test(command))
    if (follow) return { kind: 'follow', what: follow.what }
  }
  return null
}

/** The message for the agent: what was found, and the two capped forms in the language of its shell. */
function message(found, powershell) {
  const forms =
    found.kind === 'loop'
      ? powershell
        ? [
            'a deadline: $end = (Get-Date).AddMinutes(5); while (-not (<check>) -and (Get-Date) -lt $end) { Start-Sleep 5 }',
            'a counter: for ($i = 0; $i -lt 60 -and -not (<check>); $i++) { Start-Sleep 5 }',
          ]
        : [
            "a time limit on the whole command: timeout 300 sh -c 'until <check>; do sleep 5; done'",
            'a counter: for i in $(seq 60); do <check> && break; sleep 5; done',
          ]
      : powershell
        ? [
            'look once instead of following: Get-Content <file> -Tail 50, or gh pr checks <number> without --watch',
            'or put a time limit on it: Start-Job { <command> } | Wait-Job -Timeout 300',
          ]
        : [
            'look once instead of following: tail -n 50 <file>, or gh pr checks <number> without --watch',
            'or put a time limit on it: timeout 300 <command>',
          ]
  return (
    `This command waits with no limit, so it can run for hours (scripts/hooks/check-bash.mjs): ${found.what}. ` +
    `It did not run. Give the wait a cap and run it again, in one of two forms:\n${forms.map((f) => `  - ${f}`).join('\n')}\n` +
    'A time limit counts only in its plain form, with a number above 0 right after the word (no options before it).\n'
  )
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'))
    if (!SHELL_TOOLS.has(input?.tool_name)) return 0
    const found = findUnlimitedWait(input?.tool_input?.command)
    if (!found) return 0
    process.stderr.write(message(found, input.tool_name === 'PowerShell'))
    return 2
  } catch {
    return 0
  }
}

process.exitCode = main()
