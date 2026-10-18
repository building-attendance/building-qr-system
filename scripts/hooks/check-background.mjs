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
// The rule, refused with exit 2 and the message on stderr:
//   - A background Bash command is one command under a time limit in one fixed form: `timeout -k <k> <n> <command>`, with
//     k and n numbers above 0 (seconds, or with the suffix s, m, h or d), optionally after `cd <dir> &&` steps. After n,
//     timeout sends TERM, which a program can catch or ignore (`trap "" TERM`); k later it sends KILL, which no program
//     can, so -k is what makes the limit an upper bound. Anything that could run outside the limit is refused: another
//     command after ; && || | & or a new line, $( ), backticks, <( ) or >( ) outside single quotes (the shell runs them
//     before timeout starts), and any form of the shell that this hook does not follow ($'...', an escape or a comment
//     outside quotes), because such a form could hide a separator from it. A compound command goes inside the limit:
//     `timeout -k 10 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`.
//   - A background PowerShell command is refused: PowerShell has no `timeout`, and the Bash tool has.
// It reads the form of the command, not what the program does, so it needs no list of programs that wait: any program in
// the background gets the limit. What it cannot see, on purpose: a process that the command detaches by itself (`nohup`,
// `setsid`, a `&` inside `sh -c '...'`) can outlive the limit. That is a deliberate act, not the forgotten limit that this
// hook is about, and it is out of its scope. (An earlier hook on #271 tried to recognize waits by their text, a loop that sleeps,
// `tail -f`, `--watch`; four review rounds each found another spelling, so this one does not try.)
//
// Exit code 0: run the command. Exit code 2: refused. A foreground command, another tool, empty or unexpected input and any
// error of its own: 0, a hook must never break a session.
import fs from 'node:fs'

// `timeout -k 10 1800 <command>`: this one form only, so nothing has to be parsed (another option, or the two numbers in
// another order, could make a number mean something else).
const LIMIT = /^timeout\s+-k\s+(\d+(?:\.\d*)?|\.\d+)[smhd]?\s+(\d+(?:\.\d*)?|\.\d+)[smhd]?\s+\S/
// `cd <dir>`, the one step allowed before the limit (it ends at once): a word, or a quoted path with spaces.
const CD = /^cd(?:\s+(?:"[^"]*"|'[^']*'|[^\s'"]+))?$/

/**
 * The command cut at the separators that the shell reads outside quotes, as [{ text, sep }], or null when it holds a form
 * that this reader does not follow. It follows single quotes, double quotes (inside which a backslash escapes the next
 * character) and a backslash that continues a line, and nothing else, so any other form that could change where a command
 * ends is refused rather than read: $( ), backticks, <( ) and >( ) (the shell runs them before timeout starts), $'...' and
 * $"..." quotes, an escape outside quotes (`\>`, `\;`), and a comment (a # that starts a word hides the rest of its line,
 * quotes included).
 * @param {string} command
 */
function topLevel(command) {
  const parts = []
  let text = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    const next = command[i + 1] ?? ''
    if (quote === "'") {
      text += c
      if (c === "'") quote = ''
      continue
    }
    if (c === '`' || (c === '$' && next === '(')) return null
    if (quote === '"') {
      text += c === '\\' ? c + next : c // inside double quotes a backslash escapes the next character, a quote included
      if (c === '\\') i++
      else if (c === '"') quote = ''
      continue
    }
    if (c === '\\') {
      if (next !== '\n') return null // an escape outside quotes
      text += c + next // a line continued with a backslash
      i++
      continue
    }
    if (c === '$' && (next === "'" || next === '"')) return null
    if ((c === '<' || c === '>') && next === '(') return null
    if (c === '#' && (text === '' || /\s$/.test(text))) return null
    if (c === "'" || c === '"') {
      quote = c
      text += c
      continue
    }
    // & is part of a redirection in 2>&1, <&0, &> and &>>, and a separator anywhere else.
    const redirection = c === '&' && (/[<>]$/.test(text) || next === '>')
    const sep = (c === '&' && next === '&') || (c === '|' && next === '|') ? c + next : ';|&\n'.includes(c) && !redirection ? c : ''
    if (!sep) {
      text += c
      continue
    }
    parts.push({ text: text.trim(), sep })
    text = ''
    i += sep.length - 1
  }
  parts.push({ text: text.trim(), sep: '' })
  return parts
}

/** Why this background Bash command has no limit of its own, or null when it has one. */
function missingLimit(command) {
  const parts = topLevel(command.trim())
  if (!parts) {
    return "it uses a form of the shell that this hook does not follow ($( ), backticks, <( ), >( ), $'...', or an escape or a comment outside quotes)"
  }
  const last = parts.length - 1
  for (let i = 0; i < last; i++) {
    if (parts[i].sep !== '&&' || !CD.test(parts[i].text)) return 'a part of it runs outside the time limit'
  }
  const limit = LIMIT.exec(parts[last].text)
  if (!limit) return 'it does not start with `timeout -k <seconds> <seconds>`'
  if (!(Number.parseFloat(limit[1]) > 0 && Number.parseFloat(limit[2]) > 0)) {
    return 'one of its times is 0, which GNU timeout reads as no limit at all'
  }
  return null
}

const BASH_FORMS = [
  'timeout -k 10 1800 npm run test:e2e',
  `cd "<dir>" && timeout -k 10 1800 sh -c 'npm run test:e2e 2>&1 | tail -40'`,
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
        `(scripts/hooks/check-background.mjs): ${why}. It did not run. Put the whole command under a limit in this form ` +
        `(KILL 10 seconds after TERM, which a program can ignore):\n${BASH_FORMS.map((form) => `  ${form}`).join('\n')}\n` +
        'Or run it in the foreground, where the Bash tool stops it at its own limit.\n',
    )
    return 2
  } catch {
    return 0
  }
}

process.exitCode = main()
