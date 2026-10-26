// The guard of AGENTS.md that runs in the guards job (scripts/check-agents-md.mjs, .github/workflows/guards.yml): the
// root AGENTS.md fits in what Codex reads, and it is the only instruction file.
// It never reads or edits the real AGENTS.md: every case writes its files into a new temporary folder, removed
// afterwards, and the command is run on such a folder (a git repository made for it) as a child process.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CODEX_PROJECT_DOC_MAX_BYTES, checkAgentsDocs, isAgentsDoc, trackedAgentsDocs } from '../scripts/check-agents-md.mjs'

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

const SECOND_FILE = /an instruction file other than the root AGENTS\.md\. Codex would read it as instructions/

describe('check-agents-md: the size of the root AGENTS.md', () => {
  it("is limited to Codex's project_doc_max_bytes default, 32 KiB", () => {
    expect(CODEX_PROJECT_DOC_MAX_BYTES).toBe(LIMIT)
  })

  it('passes a file of exactly 32,768 bytes, with 0 left', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT }), ['AGENTS.md'])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.lines).toEqual(['AGENTS.md: 32768 of 32768 bytes, 0 left'])
  })

  it('fails a file of 32,769 bytes, and the message names the file, its size, the limit and the excess', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT + 1 }), ['AGENTS.md'])
    expect(result.ok).toBe(false)
    expect(result.lines).toEqual([])
    expect(result.errors).toEqual([expect.stringMatching(/^AGENTS\.md: 32769 bytes, over the limit of 32768 bytes by 1\./)])
  })

  it('prints how many bytes are left', () => {
    expect(checkAgentsDocs(makeDir({ 'AGENTS.md': 32307 })).lines).toEqual(['AGENTS.md: 32307 of 32768 bytes, 461 left'])
  })

  it('counts a multi-byte character as its UTF-8 bytes', () => {
    // 16,383 Hebrew letters are 32,766 bytes; three more ASCII bytes make 32,769, though they are 16,386 characters
    const text = 'א'.repeat(16383) + 'abc'
    expect(text.length).toBeLessThan(LIMIT)
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': text }))
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.stringMatching(/^AGENTS\.md: 32769 bytes/)])
  })

  it('counts a CR of a CRLF line ending as a byte', () => {
    expect(checkAgentsDocs(makeDir({ 'AGENTS.md': 'a\r\nb\r\n' })).lines).toEqual(['AGENTS.md: 6 of 32768 bytes, 32762 left'])
  })
})

describe('check-agents-md: it fails closed', () => {
  it('fails when the root AGENTS.md is missing, naming it', () => {
    const result = checkAgentsDocs(makeDir({ 'README.md': 'x' }))
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.stringMatching(/^AGENTS\.md: cannot be read \(ENOENT\)/)])
  })

  it('fails when the root AGENTS.md is a folder', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md/x': 'x' }))
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([expect.stringMatching(/^AGENTS\.md: cannot be read/)])
  })
})

describe('check-agents-md: the root AGENTS.md is the only instruction file', () => {
  for (const other of ['AGENTS.override.md', 'server/AGENTS.md', 'src/admin/agents.override.md', 'docs/Agents.md', 'agents.md']) {
    it(`fails on ${other}, naming it and saying why`, () => {
      const result = checkAgentsDocs(makeDir({ 'AGENTS.md': 100 }), ['AGENTS.md', other])
      expect(result.ok).toBe(false)
      expect(result.lines).toEqual(['AGENTS.md: 100 of 32768 bytes, 32668 left'])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].startsWith(`${other}: `)).toBe(true)
      expect(result.errors[0]).toMatch(SECOND_FILE)
      expect(result.errors[0]).toContain('a change to the rules')
    })
  }

  it('names every other file, and the size of the root first when it is over too', () => {
    const result = checkAgentsDocs(makeDir({ 'AGENTS.md': LIMIT + 1 }), ['a\\AGENTS.md', 'AGENTS.md', 'b/AGENTS.override.md'])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.stringMatching(/^AGENTS\.md: 32769 bytes, over the limit/),
      expect.stringMatching(/^a\/AGENTS\.md: an instruction file other than/),
      expect.stringMatching(/^b\/AGENTS\.override\.md: an instruction file other than/),
    ])
  })

  it('knows the file names, without regard to case', () => {
    for (const name of ['AGENTS.md', 'a/AGENTS.md', 'a\\b\\agents.md', 'AGENTS.override.md', 'x/Agents.Override.md']) expect(isAgentsDoc(name), name).toBe(true)
    for (const name of ['AGENTS.mdx', 'MY-AGENTS.md', 'AGENTS.md/x', 'docs/agents.txt', 'CLAUDE.md', '']) expect(isAgentsDoc(name), name).toBe(false)
  })
})

describe('check-agents-md: the command', () => {
  it('lists the files that git tracks, and not an untracked one', () => {
    const dir = makeRepo({ 'AGENTS.md': 10, 'a/AGENTS.md': 20, 'b/agents.override.md': 5, 'c/notes.md': 1 })
    fs.writeFileSync(path.join(dir, 'c', 'AGENTS.md'), 'untracked')
    expect(trackedAgentsDocs(dir).sort()).toEqual(['AGENTS.md', 'a/AGENTS.md', 'b/agents.override.md'])
  })

  it('exits 0 and prints the bytes left', () => {
    const result = run(makeRepo({ 'AGENTS.md': 32307, 'docs/notes.md': 400 }))
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('AGENTS.md: 32307 of 32768 bytes, 461 left\n')
  })

  it('exits 1 on a root AGENTS.md over the limit, and says so on stderr', () => {
    const result = run(makeRepo({ 'AGENTS.md': LIMIT + 1 }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AGENTS.md: 32769 bytes, over the limit of 32768 bytes by 1.')
  })

  it('exits 1 on a tracked root AGENTS.override.md, a nested AGENTS.md, a nested agents.override.md and an Agents.md in a subfolder', () => {
    const result = run(
      makeRepo({ 'AGENTS.md': 100, 'AGENTS.override.md': 10, 'server/AGENTS.md': 10, 'src/agents.override.md': 10, 'docs/Agents.md': 10 }),
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('AGENTS.md: 100 of 32768 bytes, 32668 left\n')
    for (const file of ['AGENTS.override.md', 'server/AGENTS.md', 'src/agents.override.md', 'docs/Agents.md']) {
      expect(result.stderr).toContain(`${file}: an instruction file other than the root AGENTS.md.`)
    }
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
