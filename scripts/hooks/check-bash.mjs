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
//   - a loop (`until` or `while` in a shell; `while (` or `do { } until (` in PowerShell) that sleeps (`sleep N`,
//     `Start-Sleep`), when nothing in the command limits it: no `timeout <n>` with n above 0, no counter test (`-lt`,
//     `-le`, `-gt`, `-ge`, `(( a < b ))`, `seq <n>`) and no PowerShell `-Timeout <n>`;
//   - a command that follows without end (`tail -f`, `tail --follow`, PowerShell `Get-Content -Wait`, `gh ... --watch`,
//     `gh run watch`), when it has no `timeout <n>` (or PowerShell `-Timeout <n>`).
// It lets through a loop that does not sleep, a `while read` loop (it ends with its input), a JavaScript `sleep(500)`,
// and a loop with a counter. `--max-time` is not a limit of a loop on purpose: it caps one request, and the loop around it goes on.
//
// It reads text, it does not parse the shell: a limit anywhere in the command counts, and a word inside a quoted string
// counts like code (so `sh -c '...'` is read too). It catches the common way of waiting forever, not every way, and when
// in doubt it lets the command run.
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
// A sleep: `sleep 5`, `sleep 0.5`, `sleep $DELAY`, PowerShell's alias `sleep -Seconds 5`, and `Start-Sleep`. Not a
// function call such as `sleep(500)` or `time.sleep(5)`.
const SLEEP = /(?:^|[^\w$.-])sleep\s+(?:-\w+\s+)?[\d$"']|\bStart-Sleep\b/i
// A limit: GNU `timeout 20` (not a `--timeout` option of another command), PowerShell's `-Timeout 600` (Wait-Job,
// Wait-Process), and for a loop a counter test as well. Only a duration above zero is a limit: GNU timeout reads 0 as no
// limit at all. The duration is the first operand after timeout's options, read as `timeout --help` describes them: `-k` /
// `--kill-after` and `-s` / `--signal` take a value, attached (`-k5`, `--signal=KILL`) or as the next word (`-k 5`,
// `--signal 9`, also inside a group such as `-vk 5` and with a long name cut short such as `--kill 5`), the other options
// take none, and `--` ends them. So the duration of `timeout --signal 9 0` is 0, not 9.
const TIMEOUT_WORD = /(?<![\w-])timeout(?=\s)/g
const TAKES_VALUE = ['kill-after', 'signal']
const POWERSHELL_TIMEOUT = /\s-Timeout\s+(\d+)/gi

/** The duration operand among the words that follow `timeout`, or undefined. */
function timeoutDuration(words) {
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === '--') return words[i + 1]
    if (word.startsWith('--')) {
      const name = word.slice(2).split('=')[0]
      if (name && !word.includes('=') && TAKES_VALUE.some((option) => option.startsWith(name))) i++ // the value is the next word
      continue
    }
    if (word.length > 1 && word.startsWith('-')) {
      // Short options, maybe grouped: the first k or s takes the rest of the word as its value, or the next word when it ends the word.
      if (word.slice(1).search(/[ks]/) === word.length - 2) i++
      continue
    }
    return word
  }
  return undefined
}

/** True for a duration above zero: a number (GNU allows a fraction and a suffix s, m, h or d), not `0`, `inf` or a variable. */
function positiveDuration(word) {
  const text = typeof word === 'string' ? word.replace(/^['"]|['"]$/g, '') : ''
  const seconds = Number.parseFloat(text)
  return /^(?:\d|\.\d)/.test(text) && Number.isFinite(seconds) && seconds > 0
}

const hasLimit = (command) =>
  [...command.matchAll(TIMEOUT_WORD)].some((match) =>
    positiveDuration(timeoutDuration(command.slice(match.index + match[0].length).trim().split(/\s+/).slice(0, 16))),
  ) || [...command.matchAll(POWERSHELL_TIMEOUT)].some((match) => Number(match[1]) > 0)
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
    `It did not run. Give the wait a cap and run it again, in one of two forms:\n${forms.map((f) => `  - ${f}`).join('\n')}\n`
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
