// The text rules of this project, in one place. Node built-ins only.
//
// Two rules are checked on the text of files:
//   - the em dash (U+2014) is never used, anywhere (see AGENTS.md, "Rules for every change");
//   - a date or time that a person sees is written only by shared/datetime.js (DD/MM/YYYY and HH:MM), so the code in
//     src/, server/ and shared/ must not use another way of writing one.
//
// Three things read these rules, so that they cannot drift apart:
//   - tests/no-em-dash.test.js, tests/english-docs.test.js and tests/dates.test.js, which fail `npm run test:unit` on a
//     violation (the first two walk the repository with listProjectFiles below);
//   - scripts/hooks/check-edit.mjs, the Claude Code hook that tells the agent right after it edits a file.
// To change a rule, change it here. Do not copy a pattern into another file.
import fs from 'node:fs'
import path from 'node:path'

// Built from its code point, so that this file does not contain the character either.
export const EM_DASH = String.fromCharCode(0x2014)

// ---- which files -------------------------------------------------------------------------------------------------

// Folders that are not part of the project, wherever they are. .claude is the assistant tooling's own workspace
// (personal settings, worktrees/ with full copies of the repository, notes and caches it writes for itself), with one
// exception: see SKILLS_DIR. playwright-report, test-results and blob-report are what Playwright generates (its report
// is a bundle of its own code).
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.vercel', '.claude', 'coverage', 'playwright-report', 'test-results', 'blob-report',
])
// The files that are text of the project. package-lock.json is text, but generated.
export const TEXT = /\.(js|jsx|mjs|cjs|css|html|md|json|sql|txt|yml|yaml|sh)$|^\.env\.example$|^\.gitignore$/
export const SKIP_FILES = new Set(['package-lock.json'])
// The one folder inside .claude that is part of the project: its skills are committed (AGENTS.md, CLAUDE.md), so they
// are text of the project like any document. Only this exact folder at the project root: the rest of .claude/
// (settings.local.json, worktrees/, ...) stays out, and so does a .claude folder anywhere else.
export const SKILLS_DIR = '.claude/skills'

const norm = (relativePath) => String(relativePath).replace(/\\/g, '/')
const split = (relativePath) => norm(relativePath).split('/').filter(Boolean)

/** True when a file in these folders (names from the project root) is inside a skipped folder. */
function insideSkippedDir(dirs) {
  const skills = SKILLS_DIR.split('/')
  const below = skills.every((name, i) => dirs[i] === name) ? dirs.slice(skills.length) : dirs
  return below.some((dir) => SKIP_DIRS.has(dir))
}

/**
 * True when a walk of the project must not go into this folder: nothing in it is project text.
 * @param relativeDir  the folder's path from the project root, with / or \ as the separator
 */
export function isSkippedDir(relativeDir) {
  const dirs = split(relativeDir)
  if (dirs.length === 1 && SKILLS_DIR.startsWith(`${dirs[0]}/`)) return false // .claude itself: entered only to reach skills/
  return insideSkippedDir(dirs)
}

/**
 * True when this file is in the part of the repository that the text rules cover, whatever kind of file it is.
 * @param relativePath  the path from the project root, with / or \ as the separator
 */
export function isProjectFile(relativePath) {
  const parts = split(relativePath)
  return parts.length > 0 && !insideSkippedDir(parts.slice(0, -1))
}

/**
 * True when the em dash rule applies to this file: a text file of the project that is not inside a skipped folder.
 * @param relativePath  the path from the project root, with / or \ as the separator
 */
export function isTextFileToCheck(relativePath) {
  const name = split(relativePath).pop()
  return Boolean(name) && isProjectFile(relativePath) && TEXT.test(name) && !SKIP_FILES.has(name)
}

/**
 * Every file of the project under `root`, as a path from the root with / as the separator. The tests walk the
 * repository with this, so that they and the edit hook cover the same files; a skipped folder is not entered.
 * @param root  the absolute path of the project folder
 */
export function listProjectFiles(root) {
  const found = []
  const visit = (relativeDir) => {
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!isSkippedDir(relative)) visit(relative)
      } else if (isProjectFile(relative)) {
        found.push(relative)
      }
    }
  }
  visit('')
  return found
}

// ---- the em dash -------------------------------------------------------------------------------------------------

/** The lines of `text` that hold an em dash: [{ line (1-based), text (the trimmed line) }]. */
export function findEmDashLines(text) {
  const found = []
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (line.includes(EM_DASH)) found.push({ line: i + 1, text: line.trim() })
  })
  return found
}

// ---- dates -------------------------------------------------------------------------------------------------------

// The folders (from the project root) where the date rules apply, and the files in them that are code.
export const DATE_RULE_DIRS = ['src', 'server', 'shared']
export const DATE_RULE_FILE = /\.(js|jsx|mjs)$/

// Ways of writing a date or a time that depend on the device or show a month name or a weekday, or a date field that
// shows the device's own format. Each entry is [pattern, description].
export const FORBIDDEN = [
  [/toLocale(Date|Time)?String/, 'toLocaleDateString / toLocaleTimeString / toLocaleString'],
  [/\bdateStyle\b|\btimeStyle\b/, 'dateStyle / timeStyle'],
  [/toDateString|toTimeString|toUTCString/, 'toDateString / toTimeString / toUTCString'],
  [/type=["'](date|time|datetime-local|month|week)["']/, 'a native date or time field'],
  [/\bweekday\s*:|\bmonth\s*:\s*['"](long|short|narrow)/, 'a weekday or a month name'],
]

// Intl.DateTimeFormat is only for shared/datetime.js; server/scans.js also has the API's own machine format
// ('2026-09-30 08:12:00', read by the agent), which is not for people and must not change.
export const INTL_ALLOWED = new Set(['shared/datetime.js', 'server/scans.js'])

/** True when the date rules apply to this file: JavaScript under src/, server/ or shared/. */
export function isDateRuleFile(relativePath) {
  const file = norm(relativePath)
  return DATE_RULE_DIRS.some((dir) => file.startsWith(`${dir}/`)) && DATE_RULE_FILE.test(file)
}

/**
 * The date rules that this file breaks, as short descriptions (none: all good). Comments are not code, so they are
 * removed first. A file the rules do not apply to (see isDateRuleFile) has no problems.
 * @param relativePath  the path from the project root, with / or \ as the separator
 * @param text  the contents of the file
 */
export function findDateProblems(relativePath, text) {
  const file = norm(relativePath)
  if (!isDateRuleFile(file)) return []
  const code = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const problems = []
  for (const [pattern, what] of FORBIDDEN) if (pattern.test(code)) problems.push(what)
  if (/Intl\.DateTimeFormat/.test(code) && !INTL_ALLOWED.has(file)) problems.push('Intl.DateTimeFormat (use shared/datetime.js)')
  return problems
}
