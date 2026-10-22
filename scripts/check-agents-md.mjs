// CI guard for the size of AGENTS.md (see .github/workflows/ci.yml, job "guards", every event).
//
// Usage: node scripts/check-agents-md.mjs
//        (`--root <dir>` checks another git checkout instead of this one: only the tests use it.)
//
// Why this exists: Codex (the reviewer on GitHub and the CLI) loads AGENTS.md as its instructions and reads only the
// first CODEX_PROJECT_DOC_MAX_BYTES bytes of it. The rest is cut off without a warning that a person or the review sees,
// so a rules pull request that makes the file longer would silently drop its end (the Safety section is last). This
// guard fails such a pull request and prints, on every passing run, how many bytes are left.
//
// What it counts: bytes, not characters (a Hebrew letter is two bytes in UTF-8), read from the file on disk.
// .gitattributes checks the root AGENTS.md out with LF, so on every machine these are the bytes git holds; another file
// is counted as it is checked out, and a CRLF checkout only counts more than CI does, never less. Codex also reads an
// AGENTS.md (or an AGENTS.override.md) in each folder between the repository's root and the folder it works in, and
// the limit is for all of them together, so every nested one is summed with those of the folders above it.
//
// It fails closed: a root AGENTS.md that is missing or cannot be read, a file that git lists but that cannot be read,
// or a git that cannot list the files, exits 1. It takes no input from the event and needs Node built-ins only.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { argValue, isMain, runGit, splitNul } from './ci-git.mjs'

// Codex's `project_doc_max_bytes` default: 32 KiB (32,768 bytes) for all the project's AGENTS.md files together. Codex
// truncates there and goes on without a warning. Raising this number does not make Codex read more: it only hides the cut.
export const CODEX_PROJECT_DOC_MAX_BYTES = 32768

export const ROOT_DOC = 'AGENTS.md'

// The names Codex looks for in a folder. Matched without regard to case, because on Windows and macOS the file system
// finds `agents.md` when Codex asks for `AGENTS.md`.
const DOC_NAMES = ['agents.md', 'agents.override.md']

/** True when a path (with / or \ separators) names an AGENTS.md or an AGENTS.override.md. */
export function isAgentsDoc(file) {
  const name = String(file).split(/[\\/]/).pop() ?? ''
  return DOC_NAMES.includes(name.toLowerCase())
}

/** The folder of a repository-relative path with / separators: '' for the root. */
function folderOf(file) {
  const parts = file.split('/')
  parts.pop()
  return parts.join('/')
}

/** The folders above a folder, up to the root, nearest first: 'a/b' gives ['a', '']. */
function foldersAbove(folder) {
  const out = []
  let current = folder
  while (current !== '') {
    current = folderOf(current)
    out.push(current)
  }
  return out
}

/**
 * Measures the AGENTS.md files of a checkout. `root` is the folder of the checkout; `docs` are the repository-relative
 * paths (with / separators) of the other AGENTS.md and AGENTS.override.md files (git's list; the root AGENTS.md is
 * always measured, listed or not).
 *
 * Every file is a chain: the file itself plus, for each folder above it up to the root, the largest of that folder's
 * files. Codex takes AGENTS.override.md over AGENTS.md when a folder holds both, so the largest is never less than what
 * it reads. Returns { chains: [{ file, above, bytes }], problems: [text] }; a problem is a file that could not be read,
 * and the chains are those of the files that could (any problem fails the check, but the other sizes are still shown).
 */
export function measureAgentsDocs(root, docs = []) {
  const problems = []
  const sizes = new Map()
  for (const file of new Set([ROOT_DOC, ...docs.map((doc) => doc.replace(/\\/g, '/'))])) {
    try {
      sizes.set(file, fs.readFileSync(path.join(root, file)).length)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'an error'
      problems.push(`${file}: cannot be read (${code}), so its size is unknown.`)
    }
  }
  /** @type {Map<string, string>} the largest file of each folder */
  const largest = new Map()
  for (const [file, bytes] of sizes) {
    const folder = folderOf(file)
    const current = largest.get(folder)
    if (current === undefined || bytes > (sizes.get(current) ?? 0)) largest.set(folder, file)
  }

  const chains = []
  for (const [file, own] of sizes) {
    const above = foldersAbove(folderOf(file))
      .map((folder) => largest.get(folder))
      .filter((doc) => doc !== undefined)
    const bytes = above.reduce((total, doc) => total + (sizes.get(doc) ?? 0), own)
    chains.push({ file, above, bytes })
  }
  return { chains, problems }
}

/** The line for one chain: how many bytes, of the limit, and how many are left or over. */
export function describeChain({ file, above, bytes }, limit = CODEX_PROJECT_DOC_MAX_BYTES) {
  const name = above.length > 0 ? `${file} (with ${above.join(', ')})` : file
  if (bytes <= limit) return `${name}: ${bytes} of ${limit} bytes, ${limit - bytes} left`
  return (
    `${name}: ${bytes} bytes, over the limit of ${limit} bytes by ${bytes - limit}. Codex reads only the first ${limit} ` +
    'bytes of the project\'s AGENTS.md files and drops the rest without a warning: make the file shorter.'
  )
}

/** Checks a checkout. Returns { ok, lines, errors }: `lines` for a pass, `errors` for each failure. */
export function checkAgentsDocs(root, docs = [], limit = CODEX_PROJECT_DOC_MAX_BYTES) {
  const { chains, problems } = measureAgentsDocs(root, docs)
  const errors = [...problems]
  const lines = []
  for (const chain of chains) {
    if (chain.bytes > limit) errors.push(describeChain(chain, limit))
    else lines.push(describeChain(chain, limit))
  }
  return { ok: errors.length === 0, lines, errors }
}

/** The AGENTS.md and AGENTS.override.md files that git tracks in a checkout, read with -z. */
export function trackedAgentsDocs(root) {
  return splitNul(runGit(['-C', root, 'ls-files', '-z'])).filter(isAgentsDoc)
}

function main() {
  const root = argValue(process.argv.slice(2), '--root') ?? fileURLToPath(new URL('..', import.meta.url))
  let docs
  try {
    docs = trackedAgentsDocs(root)
  } catch {
    console.error('Could not list the files that git tracks, so the size of the AGENTS.md files is unknown.')
    process.exit(1)
  }
  const { ok, lines, errors } = checkAgentsDocs(root, docs)
  for (const line of lines) console.log(line)
  if (ok) return
  for (const error of errors) console.error(error)
  process.exit(1)
}

if (isMain(import.meta.url)) main()
