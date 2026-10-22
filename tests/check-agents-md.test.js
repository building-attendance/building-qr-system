// The size guard of AGENTS.md that CI runs in the guards job (scripts/check-agents-md.mjs, .github/workflows/ci.yml).
// It never reads or edits the real AGENTS.md: every case writes its files into a new temporary folder, removed
// afterwards, and the command is run on such a folder (a git repository made for it) as a child process.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  CODEX_PROJECT_DOC_MAX_BYTES,
  checkAgentsDocs,
  isAgentsDoc,
  measureAgentsDocs,
  trackedAgentsDocs,
} from '../scripts/check-agents-md.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/check-agents-md.mjs', import.meta.url))
const LIMIT = 32768

const made = []
afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true })
})

/** A new temporary folder with these files ({ relative path: content }); a number is that many ASCII bytes. */
function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bqr-agents-'))
  made.push(dir)
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), typeof content === 'number' ? 'a'.repeat(content) : content)
  }
  return dir
}

/** Like makeDir, and a git repository that tracks every file. */
function makeRepo(files) {
  const dir = makeDir(files)
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  return dir
}

const run = (dir) => spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' })

describe('check-agents-md: the limit', () => {
  it("is Codex's project_doc_max_bytes default, 32 KiB", () => {
    expect(CODEX_PROJECT_DOC_MAX_BYTES).toBe(LIMIT)
  })

  it('passes a file of exactly 32,768 bytes, with 0 left', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT }))
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.lines).toEqual(['AGENTS.md: 32768 of 32768 bytes, 0 left'])
  })

  it('fails a file of 32,769 bytes, and the message names the file, its size, the limit and the excess', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT + 1 }))
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/^AGENTS\.md: 32769 bytes, over the limit of 32768 bytes by 1\./)
  })

  it('prints how many bytes are left', () => {
    expect(checkAgentsDocs(makeDir({ 'AGENTS.md': 32307 })).lines).toEqual(['AGENTS.md: 32307 of 32768 bytes, 461 left'])
  })
})

describe('check-agents-md: bytes, not characters', () => {
  it('counts a multi-byte character as its UTF-8 bytes', () => {
    // 16,383 Hebrew letters are 32,766 bytes; three more ASCII bytes make 32,769, though they are 16,386 characters
    const text = 'א'.repeat(16383) + 'abc'
    expect(text.length).toBeLessThan(LIMIT)
    const dir = makeDir({ 'AGENTS.md': text })
    expect(measureAgentsDocs(dir).chains[0].bytes).toBe(LIMIT + 1)
    expect(checkAgentsDocs(dir).ok).toBe(false)
  })

  it('counts a CR of a CRLF line ending as a byte', () => {
    expect(measureAgentsDocs(makeDir({ 'AGENTS.md': 'a\r\nb\r\n' })).chains[0].bytes).toBe(6)
  })
})

describe('check-agents-md: nested files', () => {
  it('sums a nested file with the root file, and names both', () => {
    const dir = makeDir({ 'AGENTS.md': 30000, 'server/AGENTS.md': 2768 })
    const ok = checkAgentsDocs(dir, ['server/AGENTS.md'])
    expect(ok.ok).toBe(true)
    expect(ok.lines).toContain('server/AGENTS.md (with AGENTS.md): 32768 of 32768 bytes, 0 left')

    const over = checkAgentsDocs(makeDir({ 'AGENTS.md': 30000, 'server/AGENTS.md': 2769 }), ['server/AGENTS.md'])
    expect(over.ok).toBe(false)
    expect(over.lines).toEqual(['AGENTS.md: 30000 of 32768 bytes, 2768 left'])
    expect(over.errors).toEqual([expect.stringMatching(/^server\/AGENTS\.md \(with AGENTS\.md\): 32769 bytes, over the limit of 32768 bytes by 1\./)])
  })

  it('sums every folder between the file and the root', () => {
    const dir = makeDir({ 'AGENTS.md': 10, 'a/AGENTS.md': 20, 'a/b/c/AGENTS.md': 30 })
    const chains = measureAgentsDocs(dir, ['a/AGENTS.md', 'a/b/c/AGENTS.md']).chains
    expect(chains.find((chain) => chain.file === 'a/b/c/AGENTS.md')).toEqual({ file: 'a/b/c/AGENTS.md', above: ['a/AGENTS.md', 'AGENTS.md'], bytes: 60 })
  })

  it("passes Codex's own example: a root override of 1,000 bytes replaces a root AGENTS.md of 30,000", () => {
    const dir = makeDir({ 'AGENTS.md': 30000, 'AGENTS.override.md': 1000, 'services/payments/AGENTS.md': 3000 })
    const result = checkAgentsDocs(dir, ['AGENTS.override.md', 'services/payments/AGENTS.md'])
    expect(result.ok).toBe(true)
    expect(result.lines).toEqual([
      'AGENTS.override.md: 1000 of 32768 bytes, 31768 left',
      'services/payments/AGENTS.md (with AGENTS.override.md): 4000 of 32768 bytes, 28768 left',
    ])
  })

  it('counts the override instead of the AGENTS.md of the same folder, even when the override is the larger', () => {
    const dir = makeDir({ 'AGENTS.md': 100, 'web/AGENTS.md': 20000, 'web/AGENTS.override.md': 32669 })
    const result = checkAgentsDocs(dir, ['web/AGENTS.md', 'web/AGENTS.override.md'])
    expect(result.ok).toBe(false)
    expect(result.lines).toEqual(['AGENTS.md: 100 of 32768 bytes, 32668 left'])
    // 32,669 + 100, never 20,000 + 32,669 + 100: at most one file per folder
    expect(result.errors).toEqual([expect.stringMatching(/^web\/AGENTS\.override\.md \(with AGENTS\.md\): 32769 bytes, over the limit of 32768 bytes by 1\./)])
  })

  it('counts the larger of the two files of a folder whose override is empty, as Codex may fall back to AGENTS.md', () => {
    const dir = makeDir({ 'AGENTS.md': 100, 'AGENTS.override.md': ' \n', 'a/AGENTS.md': 10 })
    const chains = measureAgentsDocs(dir, ['AGENTS.override.md', 'a/AGENTS.md']).chains
    expect(chains).toEqual([
      { file: 'AGENTS.md', above: [], bytes: 100 },
      { file: 'a/AGENTS.md', above: ['AGENTS.md'], bytes: 110 },
    ])
  })

  it('counts a nested agents.md in lower case, which Codex finds on Windows and macOS', () => {
    const dir = makeDir({ 'AGENTS.md': 100, 'x/AGENTS.md': 10, 'x/sub/agents.md': 7 })
    const chains = measureAgentsDocs(dir, ['x/AGENTS.md', 'x/sub/agents.md']).chains
    expect(chains.find((chain) => chain.file === 'x/sub/agents.md')).toEqual({ file: 'x/sub/agents.md', above: ['x/AGENTS.md', 'AGENTS.md'], bytes: 117 })
  })

  it('accepts Windows separators in the list', () => {
    const dir = makeDir({ 'AGENTS.md': 10, 'a/AGENTS.md': 20 })
    expect(measureAgentsDocs(dir, ['a\\AGENTS.md']).chains.map((chain) => chain.bytes)).toEqual([10, 30])
  })

  it('knows the file names, without regard to case', () => {
    for (const name of ['AGENTS.md', 'a/AGENTS.md', 'a\\b\\agents.md', 'AGENTS.override.md', 'x/Agents.Override.md']) expect(isAgentsDoc(name), name).toBe(true)
    for (const name of ['AGENTS.mdx', 'MY-AGENTS.md', 'AGENTS.md/x', 'docs/agents.txt', 'CLAUDE.md', '']) expect(isAgentsDoc(name), name).toBe(false)
  })
})

describe('check-agents-md: it fails closed', () => {
  it('fails when the root AGENTS.md is missing, naming it', () => {
    const result = checkAgentsDocs(makeDir({ 'README.md': 'x' }))
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.stringMatching(/^AGENTS\.md: cannot be read \(ENOENT\)/)])
  })

  it('fails when the root AGENTS.md is a folder, and when a listed file is missing', () => {
    expect(checkAgentsDocs(makeDir({ 'AGENTS.md/x': 'x' })).ok).toBe(false)
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': 10 }), ['gone/AGENTS.md'])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.stringMatching(/^gone\/AGENTS\.md: cannot be read/)])
  })

  it('still reports the files it could read, so a root over the limit is not hidden behind a missing file', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT + 1 }), ['gone/AGENTS.md'])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.stringMatching(/^gone\/AGENTS\.md: cannot be read/),
      expect.stringMatching(/^AGENTS\.md: 32769 bytes, over the limit/),
    ])
  })
})

describe('check-agents-md: the command', () => {
  it('lists the files that git tracks, and not an untracked one', () => {
    const dir = makeRepo({ 'AGENTS.md': 10, 'a/AGENTS.md': 20, 'b/agents.override.md': 5, 'c/notes.md': 1 })
    fs.writeFileSync(path.join(dir, 'c', 'AGENTS.md'), 'untracked')
    expect(trackedAgentsDocs(dir).sort()).toEqual(['AGENTS.md', 'a/AGENTS.md', 'b/agents.override.md'])
  })

  it('exits 0 and prints the bytes left for every file', () => {
    const result = run(makeRepo({ 'AGENTS.md': 32307, 'server/AGENTS.md': 400 }))
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('AGENTS.md: 32307 of 32768 bytes, 461 left\n')
    expect(result.stdout).toContain('server/AGENTS.md (with AGENTS.md): 32707 of 32768 bytes, 61 left\n')
  })

  it('exits 1 on a file over the limit, and says so on stderr', () => {
    const result = run(makeRepo({ 'AGENTS.md': LIMIT + 1 }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AGENTS.md: 32769 bytes, over the limit of 32768 bytes by 1.')
  })

  it('exits 1 on a nested file that is over only with the root, though each is under the limit', () => {
    const result = run(makeRepo({ 'AGENTS.md': 20000, 'server/AGENTS.md': 20000 }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('server/AGENTS.md (with AGENTS.md): 40000 bytes, over the limit of 32768 bytes by 7232.')
  })

  it('exits 1 when the root AGENTS.md is missing, and when git cannot list the files', () => {
    const missing = run(makeRepo({ 'README.md': 'x' }))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toMatch(/AGENTS\.md: cannot be read/)

    // a folder that does not exist: `git -C` fails there wherever the temporary folder is
    const noFolder = run(path.join(makeDir({ 'AGENTS.md': 10 }), 'missing'))
    expect(noFolder.status).toBe(1)
    expect(noFolder.stderr).toMatch(/Could not list the files that git tracks/)
  })
})
