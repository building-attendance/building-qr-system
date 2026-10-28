// CI guard for the size of AGENTS.md (see .github/workflows/guards.yml, job "guards", every event).
//
// Usage: node scripts/check-agents-md.mjs
//        (`--root <dir>` checks another git checkout instead of this one: only the tests use it.)
//
// Why this exists: Codex (the reviewer on GitHub and the CLI) loads AGENTS.md as its instructions and reads only the
// first CODEX_PROJECT_DOC_MAX_BYTES bytes of it. The rest is cut off without a warning that a person or the review sees,
// so a rules pull request that makes the file longer would silently drop its end (the Safety section is last). This
// guard fails such a pull request and prints, on every passing run, how many bytes are left.
//
// What it checks:
// 1. The root AGENTS.md is there, can be read, and is at most CODEX_PROJECT_DOC_MAX_BYTES bytes. It counts bytes, not
//    characters (a Hebrew letter is two bytes in UTF-8), read from the file on disk; .gitattributes checks AGENTS.md out
//    with LF, so on every machine these are the bytes git holds.
// 2. No other file that git tracks is named AGENTS.md or AGENTS.override.md, in any folder and without regard to case
//    (the root's AGENTS.override.md included). Codex also reads such files as instructions, in place of AGENTS.md (an
//    override) or on top of it (a file in a folder below), within the same limit (its page "Custom instructions with
//    AGENTS.md", learn.chatgpt.com/docs/agent-configuration/agents-md, read 22/10/2026, the page carries no date). A
//    second instruction file is a change to the rules, so it is refused instead of counted: allowing one means changing
//    this guard in a pull request that the owner reads.
//
// It fails closed: a root AGENTS.md that is missing or cannot be read, or a git that cannot list the files, exits 1. It
// takes no input from the event and needs Node built-ins only.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { argValue, isMain, runGit, splitNul } from './ci-git.mjs'

// Codex's `project_doc_max_bytes` default: 32 KiB (32,768 bytes) for the project's instruction files together. Codex
// truncates there and goes on without a warning. Raising this number does not make Codex read more: it only hides the cut.
export const CODEX_PROJECT_DOC_MAX_BYTES = 32768

export const ROOT_DOC = 'AGENTS.md'

// The names Codex looks for in a folder. Matched without regard to case, because on Windows and macOS the file system
// finds `agents.md` when Codex asks for `AGENTS.md`.
const DOC_NAMES = ['agents.md', 'agents.override.md']

/** True when a path (with / or \ separators) names an AGENTS.md or an AGENTS.override.md, in any case. */
export function isAgentsDoc(file) {
  const name = String(file).split(/[\\/]/).pop() ?? ''
  return DOC_NAMES.includes(name.toLowerCase())
}

/** The line for the root file: its bytes, of the limit, and how many are left or over. */
export function describeSize(bytes, limit = CODEX_PROJECT_DOC_MAX_BYTES) {
  if (bytes <= limit) return `${ROOT_DOC}: ${bytes} of ${limit} bytes, ${limit - bytes} left`
  return (
    `${ROOT_DOC}: ${bytes} bytes, over the limit of ${limit} bytes by ${bytes - limit}. Codex reads only the first ` +
    `${limit} bytes and drops the rest without a warning: make the file shorter.`
  )
}

/** The refusal of an instruction file other than the root AGENTS.md. */
export function describeOtherDoc(file) {
  return (
    `${file}: an instruction file other than the root ${ROOT_DOC}. Codex would read it as instructions, in place of or ` +
    `on top of ${ROOT_DOC}, so a second instruction file is a change to the rules: allowing one means changing ` +
    'scripts/check-agents-md.mjs in a pull request that the owner reads.'
  )
}

/**
 * Checks a checkout. `root` is its folder; `docs` are the repository-relative paths that git tracks and that name an
 * instruction file (see isAgentsDoc), the root AGENTS.md among them or not. Returns { ok, lines, errors }: `lines` for a
 * pass, `errors` for each failure.
 */
export function checkAgentsDocs(root, docs = [], limit = CODEX_PROJECT_DOC_MAX_BYTES) {
  const errors = []
  const lines = []
  for (const doc of docs) {
    const file = String(doc).replace(/\\/g, '/')
    if (file !== ROOT_DOC) errors.push(describeOtherDoc(file))
  }
  try {
    const bytes = fs.readFileSync(path.join(root, ROOT_DOC)).length
    if (bytes > limit) errors.unshift(describeSize(bytes, limit))
    else lines.push(describeSize(bytes, limit))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'an error'
    errors.unshift(`${ROOT_DOC}: cannot be read (${code}), so its size is unknown.`)
  }
  return { ok: errors.length === 0, lines, errors }
}

/** The AGENTS.md and AGENTS.override.md files, in any case and any folder, that git tracks in a checkout, read with -z. */
export function trackedAgentsDocs(root) {
  return splitNul(runGit(['-C', root, 'ls-files', '-z'])).filter(isAgentsDoc)
}

function main() {
  const root = argValue(process.argv.slice(2), '--root') ?? fileURLToPath(new URL('..', import.meta.url))
  let docs
  try {
    docs = trackedAgentsDocs(root)
  } catch {
    console.error('Could not list the files that git tracks, so the instruction files are unknown.')
    process.exit(1)
  }
  const { ok, lines, errors } = checkAgentsDocs(root, docs)
  for (const line of lines) console.log(line)
  if (ok) return
  for (const error of errors) console.error(error)
  process.exit(1)
}

if (isMain(import.meta.url)) main()
