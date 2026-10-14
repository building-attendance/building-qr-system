// Which files the text rules cover (scripts/text-rules.mjs): the project's own text, with one exception inside .claude.
// The skills in .claude/skills/ are committed, so the rules apply to them like to any document. The rest of .claude/ is
// the assistant tooling's own workspace (personal settings, worktrees/ with full copies of the repository, caches) and
// stays out, whatever the .gitignore does with it.
//
// Three readers use the scope: tests/no-em-dash.test.js and tests/english-docs.test.js (through listProjectFiles) and the
// Claude Code edit hook (scripts/hooks/check-edit.mjs, through isTextFileToCheck). This file proves, on a temporary
// project folder with an em dash and an en dash in every file, that all three agree: the skill is checked, the worktree
// copy and settings.local.json are not. No database and no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { EM_DASH, EN_DASH, findDashLines, isSkippedDir, isTextFileToCheck, listProjectFiles } from '../scripts/text-rules.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const HOOK = path.join(root, 'scripts', 'hooks', 'check-edit.mjs')
const DASHED = `a line ${EM_DASH} with an em dash\nand a line ${EN_DASH} with an en dash\n`

// Every file below holds an em dash and an en dash. The rules must catch the skill's three files and the plain document,
// and no other.
const SKILL = '.claude/skills/demo/SKILL.md'
const SKILL_REFERENCE = '.claude/skills/demo/references/notes.md'
const SKILL_SCRIPT = '.claude/skills/demo/scripts/run.sh' // a skill's shell script is text of the project too
const WORKTREE_COPY = '.claude/worktrees/feature/docs/copy.md'
const WORKTREE_SKILL = '.claude/worktrees/feature/.claude/skills/demo/SKILL.md'
const LOCAL_SETTINGS = '.claude/settings.local.json'
const SHARED_SETTINGS = '.claude/settings.json'
const CACHE = '.claude/cc10x/notes.md'
const NESTED_CLAUDE = 'docs/.claude/skills/other.md'
const SKILL_DEPENDENCY = '.claude/skills/demo/node_modules/pkg/readme.md'
const PACKAGE_DOC = 'node_modules/pkg/readme.md'
const DOC = 'docs/plain.md'

let project // a temporary project folder

beforeAll(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'text-rules-scope-'))
  for (const file of [
    SKILL, SKILL_REFERENCE, SKILL_SCRIPT, WORKTREE_COPY, WORKTREE_SKILL, LOCAL_SETTINGS, SHARED_SETTINGS, CACHE, NESTED_CLAUDE,
    SKILL_DEPENDENCY, PACKAGE_DOC, DOC,
  ]) {
    const full = path.join(project, ...file.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, file.endsWith('.json') ? `{ "note": "x ${EM_DASH} y",\n  "other": "x ${EN_DASH} y" }\n` : DASHED)
  }
})

afterAll(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

/** Runs the edit hook the way Claude Code does, for one edited file of the temporary project. */
function runHook(relativeFile) {
  const input = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(project, ...relativeFile.split('/')) } })
  const result = spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' })
  return { code: result.status, stderr: result.stderr }
}

describe('the scope of the text rules: the paths', () => {
  it('a file under .claude/skills/ is checked, at any depth, with either separator', () => {
    expect(isTextFileToCheck(SKILL)).toBe(true)
    expect(isTextFileToCheck(SKILL_REFERENCE)).toBe(true)
    expect(isTextFileToCheck('.claude\\skills\\demo\\SKILL.md')).toBe(true)
    expect(isTextFileToCheck('.claude/skills/demo/SOURCE.md')).toBe(true)
  })

  it('a file under .claude/worktrees/ is not, not even a copy of a skill inside a worktree', () => {
    expect(isTextFileToCheck(WORKTREE_COPY)).toBe(false)
    expect(isTextFileToCheck(WORKTREE_SKILL)).toBe(false)
    expect(isTextFileToCheck('.claude\\worktrees\\feature\\README.md')).toBe(false)
  })

  it('settings.local.json is not, and neither is any other file of .claude outside skills/', () => {
    expect(isTextFileToCheck(LOCAL_SETTINGS)).toBe(false)
    expect(isTextFileToCheck(SHARED_SETTINGS)).toBe(false)
    expect(isTextFileToCheck('.claude/launch.json')).toBe(false)
    expect(isTextFileToCheck(CACHE)).toBe(false)
  })

  it('the exception is only .claude/skills/ at the project root', () => {
    expect(isTextFileToCheck(NESTED_CLAUDE)).toBe(false) // a .claude folder anywhere else stays out
    expect(isTextFileToCheck(SKILL_DEPENDENCY)).toBe(false) // and the other skipped folders still apply inside skills/
    expect(isTextFileToCheck(PACKAGE_DOC)).toBe(false)
  })

  it('nothing else changed: the project text is checked, other kinds of file are not', () => {
    expect(isTextFileToCheck(DOC)).toBe(true)
    expect(isTextFileToCheck('README.md')).toBe(true)
    expect(isTextFileToCheck(SKILL_SCRIPT)).toBe(true) // a shell script is text of the project (two skills carry one)
    expect(isTextFileToCheck('.claude/skills/demo/LICENSE')).toBe(false) // no extension
    expect(isTextFileToCheck('package-lock.json')).toBe(false)
  })

  it('a walk enters .claude only to reach skills/', () => {
    expect(isSkippedDir('.claude')).toBe(false)
    expect(isSkippedDir('.claude/skills')).toBe(false)
    expect(isSkippedDir('.claude/skills/demo/references')).toBe(false)
    expect(isSkippedDir('.claude/worktrees')).toBe(true)
    expect(isSkippedDir('.claude/cc10x')).toBe(true)
    expect(isSkippedDir('docs/.claude')).toBe(true)
    expect(isSkippedDir('.claude/skills/demo/node_modules')).toBe(true)
    expect(isSkippedDir('node_modules')).toBe(true)
    expect(isSkippedDir('docs')).toBe(false)
  })
})

describe('the scope of the text rules: the three readers agree', () => {
  it('the walk of the tests lists the skill and the documents, and nothing else of .claude or node_modules', () => {
    const files = listProjectFiles(project).sort()
    expect(files).toContain(SKILL)
    expect(files).toContain(SKILL_REFERENCE)
    expect(files).toContain(SKILL_SCRIPT)
    expect(files).toContain(DOC)
    for (const left of [WORKTREE_COPY, WORKTREE_SKILL, LOCAL_SETTINGS, SHARED_SETTINGS, CACHE, NESTED_CLAUDE, SKILL_DEPENDENCY, PACKAGE_DOC]) {
      expect(files, left).not.toContain(left)
    }
  })

  it('an em dash and an en dash are found in the files of the skill and in the plain document, and nowhere else', () => {
    const found = listProjectFiles(project)
      .filter(isTextFileToCheck)
      .map((file) => ({ file, dashes: findDashLines(fs.readFileSync(path.join(project, ...file.split('/')), 'utf8')).flatMap((d) => d.dashes) }))
      .filter(({ dashes }) => dashes.length > 0)
    expect(found.map(({ file }) => file).sort()).toEqual([SKILL_REFERENCE, SKILL_SCRIPT, DOC, SKILL].sort())
    for (const { file, dashes } of found) expect(dashes, file).toEqual(['em dash', 'en dash'])
  })

  it('the edit hook stops on the skill (exit 2) and says nothing about the worktree copy or settings.local.json (exit 0)', () => {
    const skill = runHook(SKILL)
    expect(skill.code).toBe(2)
    expect(skill.stderr).toContain(SKILL)
    expect(skill.stderr).toMatch(/em dash on line 1\b/)
    expect(skill.stderr).toMatch(/en dash on line 2\b/)
    expect(runHook(SKILL_REFERENCE).code).toBe(2)
    for (const left of [WORKTREE_COPY, WORKTREE_SKILL, LOCAL_SETTINGS, SHARED_SETTINGS, CACHE]) {
      expect(runHook(left), left).toEqual({ code: 0, stderr: '' })
    }
  })

  it('on the real repository the walk reaches the skills and no other part of .claude', () => {
    const files = listProjectFiles(root)
    expect(files.some((file) => file.startsWith('.claude/skills/') && file.endsWith('/SKILL.md'))).toBe(true)
    expect(files.filter((file) => file.startsWith('.claude/') && !file.startsWith('.claude/skills/'))).toEqual([])
  })
})
