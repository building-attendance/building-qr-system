// Claude Code hook: a shell command in the background must carry its own time limit. Node built-ins only.
//
// It is wired in .claude/settings.json as a PreToolUse hook for Bash and PowerShell, so it runs before every shell command
// of every session in this repository, the agent loop on GitHub included (claude.yml uses the same settings). Claude Code
// sends the tool call as JSON on stdin ({ "tool_name": "Bash", "tool_input": { "command": "...", "run_in_background": true } }).
//
// Why: a command in the background runs until it ends, and nothing waits for it: on 15/10/2026 a worker's background
// `until ...; do sleep 5; done` ran for 21 hours. A command in the foreground is not checked here, because the Bash tool
// stops it at its own time limit (2 minutes by default, 10 at most).
//
// The rule, refused with exit 2 and the message on stderr. A background Bash command has one of two forms, and nothing else:
//   1. `timeout -k <k> <n> <words>`: the words are plain, only letters, digits, spaces and _ . / : = , @ % + -
//      (`timeout -k 10 1800 npm run test:e2e`);
//   2. `timeout -k <k> <n> sh -c '<anything>'` (or bash -c): one single-quoted script, where everything, a cd, a pipe, a
//      redirection, a loop, runs inside the shell under the limit
//      (`timeout -k 10 1800 sh -c 'cd "<dir>" && npm run test:e2e 2>&1 | tail -40'`).
// k and n are numbers above 0 (seconds, or with the suffix s, m, h or d). After n, timeout sends TERM, which a program can
// catch or ignore; k later it sends KILL, which no program can, so -k is what makes the limit an upper bound.
// A background PowerShell command is refused: PowerShell has no `timeout`, and the Bash tool has.
//
// Why only these two forms: whatever bash does before it starts `timeout` runs outside the limit, a second command after a
// separator, an expansion such as $( ), a redirection from a pipe that has no writer. A hook that reads the shell to find
// those has to follow all of its syntax, and the review of #274 found a new way past such a reader in each round
// (`$'...'`, an escaped `>`, a comment, a redirection). Plain words leave bash nothing to do before `timeout` starts, and
// the text of `sh -c '...'` is only read by the shell that runs under the limit, so there is nothing left to read.
// What it cannot see, on purpose: a process that the command detaches by itself (`nohup`, `setsid`, a `&` inside
// `sh -c '...'`) can outlive the limit. That is a deliberate act, not the forgotten limit that this hook is about.
//
// Exit code 0: run the command. Exit code 2: refused. A foreground command, another tool, empty or unexpected input and any
// error of its own: 0, a hook must never break a session.
import fs from 'node:fs'

const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)[smhd]?`
const LIMIT = new RegExp(String.raw`^timeout[ \t]+-k[ \t]+${NUMBER}[ \t]+${NUMBER}[ \t]+`)
const PLAIN_WORDS = /^[\w./:=,@%+-]+(?:[ \t]+[\w./:=,@%+-]+)*$/
const SHELL_SCRIPT = /^(?:sh|bash)[ \t]+-c[ \t]+'[^']*'$/

/** Why this background Bash command has no limit of its own, or null when it has one. */
function missingLimit(command) {
  const text = command.trim()
  const limit = LIMIT.exec(text)
  if (!limit) return 'it does not start with `timeout -k <seconds> <seconds>`'
  if (!(Number.parseFloat(limit[1]) > 0 && Number.parseFloat(limit[2]) > 0)) {
    return 'one of its times is 0, which GNU timeout reads as no limit at all'
  }
  const rest = text.slice(limit[0].length)
  if (PLAIN_WORDS.test(rest) || SHELL_SCRIPT.test(rest)) return null
  return "after the limit it has more than plain words, and bash could run some of it before the limit starts: put it inside sh -c '...'"
}

const BASH_FORMS = [
  'timeout -k 10 1800 npm run test:e2e',
  `timeout -k 10 1800 sh -c 'cd "<dir>" && npm run test:e2e 2>&1 | tail -40'`,
]

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'))
    if (input?.tool_input?.run_in_background !== true) return 0
    if (input.tool_name === 'PowerShell') {
      process.stderr.write(
        'This PowerShell command would run in the background, where nothing stops it, and PowerShell has no `timeout` ' +
          '(scripts/hooks/check-background.mjs). It did not run. Run it with the Bash tool as `timeout -k 10 <seconds> <command>`, ' +
          'or in the foreground, where the tool stops it at its own limit.\n',
      )
      return 2
    }
    if (input.tool_name !== 'Bash' || typeof input.tool_input.command !== 'string') return 0
    const why = missingLimit(input.tool_input.command)
    if (!why) return 0
    process.stderr.write(
      `This command would run in the background, where nothing stops it, without a time limit of its own ` +
        `(scripts/hooks/check-background.mjs): ${why}. It did not run. Use one of the two forms ` +
        `(KILL 10 seconds after TERM, which a program can ignore):\n${BASH_FORMS.map((form) => `  ${form}`).join('\n')}\n` +
        'Or run it in the foreground, where the Bash tool stops it at its own limit.\n',
    )
    return 2
  } catch {
    return 0
  }
}

process.exitCode = main()
