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
// .gitattributes checks AGENTS.md and AGENTS.override.md out with LF, so on every machine these are the bytes git holds.
// How Codex reads them (its page "Custom instructions with AGENTS.md", learn.chatgpt.com/docs/agent-configuration/
// agents-md, read 22/10/2026, the page carries no date): from the project's root down to the folder it works in, it
// checks each folder for AGENTS.override.md, then AGENTS.md, takes at most one file per folder, skips empty files, and
// stops adding once the files together reach the limit. So each folder's file is summed with those of the folders above.
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

/** True when a path names an AGENTS.override.md (without regard to case). */
function isOverride(file) {
  return (file.split('/').pop() ?? '').toLowerCase() === 'agents.override.md'
}

/**
 * @typedef {{ file: string, bytes: number, blank: boolean }} Doc
 * @param {Doc[]} list
 * @returns {Doc | undefined} the largest of the list
 */
function largestOf(list) {
  return list.reduce((best, doc) => (best === undefined || doc.bytes > best.bytes ? doc : best), /** @type {Doc | undefined} */ (undefined))
}

/**
 * The file that Codex reads in one folder: AGENTS.override.md when there is one, otherwise AGENTS.md. Where the folder
 * holds two names that differ only in case (possible on Linux), the larger is taken.
 *
 * Codex skips an empty file, and its page does not say whether it then falls back to the AGENTS.md of the same folder.
 * So for an override that is empty (or only whitespace) the side that counts more is taken: the larger of the two.
 * @param {Doc[]} docs the readable files of the folder
 */
function readInFolder(docs) {
  const override = largestOf(docs.filter((doc) => isOverride(doc.file)))
  const agents = largestOf(docs.filter((doc) => !isOverride(doc.file)))
  if (override && !override.blank) return override
  return largestOf([override, agents].filter((doc) => doc !== undefined))
}

/**
 * Measures the AGENTS.md files of a checkout. `root` is the folder of the checkout; `docs` are the repository-relative
 * paths (with / separators) of the other AGENTS.md and AGENTS.override.md files (git's list; the root AGENTS.md is
 * always read, listed or not, and must be there).
 *
 * Every folder with a file is a chain: the file Codex reads there plus, for each folder above it up to the root, the
 * file Codex reads in that folder. Returns { chains: [{ file, above, bytes }], problems: [text] }; a problem is a file
 * that could not be read, and the chains are those of the files that could (any problem fails the check, but the other
 * sizes are still shown).
 */
export function measureAgentsDocs(root, docs = []) {
  const problems = []
  /** @type {Map<string, Doc[]>} the readable files of each folder */
  const byFolder = new Map()
  for (const file of new Set([ROOT_DOC, ...docs.map((doc) => doc.replace(/\\/g, '/'))])) {
    try {
      const buffer = fs.readFileSync(path.join(root, file))
      const folder = folderOf(file)
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), { file, bytes: buffer.length, blank: buffer.toString('utf8').trim() === '' }])
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'an error'
      problems.push(`${file}: cannot be read (${code}), so its size is unknown.`)
    }
  }
  /** @type {Map<string, Doc>} the file Codex reads in each folder */
  const read = new Map()
  for (const [folder, list] of byFolder) {
    const doc = readInFolder(list)
    if (doc) read.set(folder, doc)
  }

  const chains = []
  for (const [folder, own] of read) {
    const above = foldersAbove(folder)
      .map((parent) => read.get(parent))
      .filter((doc) => doc !== undefined)
    const bytes = above.reduce((total, doc) => total + doc.bytes, own.bytes)
    chains.push({ file: own.file, above: above.map((doc) => doc.file), bytes })
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
