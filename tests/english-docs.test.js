// Everything in this repository is written in English: the README, the documents in docs/, the issue and pull request
// templates, the community files and the workflows. Another language belongs only to text that a person sees in the app
// (src/i18n/*.js, and for now the Hebrew of the committee app in src/admin/) and to the tests that check that text (see
// AGENTS.md, "Rules for every change"). This test covers the documents: every .md, .yml and .yaml file of the project
// holds no Hebrew letter (U+0590 to U+05FF). The folders to skip come from scripts/text-rules.mjs; the project's skills
// (.claude/skills/) are covered, the rest of .claude/ is not (tests/text-rules-scope.test.js).
//
// The only exception is a UI label that a person needs in order to find a button, for example the committee app's
// Hebrew tab names. It is allowed only when it is short, made of Hebrew letters alone, and quoted in double quotes
// inside parentheses: (the Committee tab ("<label>")). Nothing else in Hebrew is allowed. The Hebrew in this file is
// written as escapes, so that it does not contain a Hebrew letter either.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SKIP_DIRS, listProjectFiles } from '../scripts/text-rules.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

const DOCUMENT = /\.(md|yml|yaml)$/
const HEBREW_LETTER = /[\u0590-\u05FF]/
// ("label"): parentheses, double quotes, then up to 40 characters that are Hebrew letters, spaces, an apostrophe, a
// comma, a full stop or a hyphen, and the label starts with a Hebrew letter.
const QUOTED_LABEL = /\("[\u0590-\u05FF][\u0590-\u05FF ',.-]{0,39}"\)/g

/** The lines of `text` that hold a Hebrew letter once the allowed quoted labels are taken out: [{ line, text }]. */
function findHebrewLines(text) {
  const found = []
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (HEBREW_LETTER.test(line.replace(QUOTED_LABEL, ''))) found.push({ line: i + 1, text: line.trim() })
  })
  return found
}

/** The documents of the project, as paths from the root with / as the separator. */
const documents = () => listProjectFiles(root).filter((file) => DOCUMENT.test(file))

// The Hebrew word for "committee" (the Committee tab), as escapes.
const COMMITTEE = '\u05D5\u05E2\u05D3'
// A Hebrew sentence ("welcome"), as escapes.
const SENTENCE = '\u05D1\u05E8\u05D5\u05DB\u05D9\u05DD \u05D4\u05D1\u05D0\u05D9\u05DD'

describe('the documents are written in English', () => {
  it('no .md, .yml or .yaml file of the repository holds a Hebrew letter, apart from a quoted UI label', () => {
    const files = documents()
    expect(files.length).toBeGreaterThan(10) // the walk really covers the documents
    const offenders = []
    for (const file of files) {
      for (const { line, text } of findHebrewLines(fs.readFileSync(path.join(root, file), 'utf8'))) {
        offenders.push(`${file}:${line}: ${text.slice(0, 80)}`)
      }
    }
    expect(offenders, `Hebrew found in a document (write it in English):\n${offenders.join('\n')}`).toEqual([])
  })

  it('the walk includes the README, the docs, the community files, the issue templates and the skills', () => {
    const relative = new Set(documents())
    for (const expected of [
      'README.md',
      'AGENTS.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
      'docs/agent-prompt.md',
      'docs/agent-api.md',
      'docs/manual-ios-checklist.md',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/pull_request_template.md',
      '.claude/skills/writing-for-agents/SKILL.md',
    ]) {
      expect(relative.has(expected), expected).toBe(true)
    }
  })

  it('the walk skips the folders that are not part of the project', () => {
    const relative = documents()
    // Under .claude only skills/ is walked, and inside it the skipped folders (node_modules, ...) are still skipped.
    const inSkippedFolder = (file) => {
      const dirs = file.split('/').slice(0, -1)
      return (file.startsWith('.claude/skills/') ? dirs.slice(2) : dirs).some((part) => SKIP_DIRS.has(part))
    }
    expect(relative.filter(inSkippedFolder)).toEqual([])
    expect(relative.filter((file) => file.startsWith('.claude/') && !file.startsWith('.claude/skills/'))).toEqual([])
  })
})

describe('the one exception: a Hebrew UI label quoted in parentheses and double quotes', () => {
  it('allows a short label in parentheses and double quotes', () => {
    expect(findHebrewLines(`Add the others from the Committee tab ("${COMMITTEE}").`)).toEqual([])
    expect(findHebrewLines(`Open the Agent tab ("\u05D0\u05D9\u05D9\u05D2\u05F3\u05E0\u05D8") first.`)).toEqual([])
    expect(findHebrewLines(`Two labels ("${COMMITTEE}") and ("${COMMITTEE} ${COMMITTEE}") on one line.`)).toEqual([])
  })

  it('reports a Hebrew sentence in a document', () => {
    expect(findHebrewLines(`Welcome. ${SENTENCE}`)).toEqual([{ line: 1, text: `Welcome. ${SENTENCE}` }])
  })

  it('reports a label that is not in parentheses and double quotes', () => {
    expect(findHebrewLines(`The tab "${COMMITTEE}" is on the right.`)).toHaveLength(1) // quotes without parentheses
    expect(findHebrewLines(`The tab (${COMMITTEE}) is on the right.`)).toHaveLength(1) // parentheses without quotes
    expect(findHebrewLines(`The tab ('${COMMITTEE}') is on the right.`)).toHaveLength(1) // single quotes
    expect(findHebrewLines(`The tab ${COMMITTEE} is on the right.`)).toHaveLength(1) // bare
  })

  it('reports a quoted text that is long or is not made of Hebrew letters alone', () => {
    expect(findHebrewLines(`("${`${SENTENCE} `.repeat(6).trim()}")`)).toHaveLength(1) // longer than a label
    expect(findHebrewLines(`("${COMMITTEE} and more")`)).toHaveLength(1) // Latin letters inside
    expect(findHebrewLines(`("${COMMITTEE}") ${SENTENCE}`)).toHaveLength(1) // a label does not excuse the rest
  })

  it('reports the right line number, also with Windows line endings', () => {
    const text = `first\r\nsecond ("${COMMITTEE}")\r\nthird ${SENTENCE}\r\n`
    expect(findHebrewLines(text)).toEqual([{ line: 3, text: `third ${SENTENCE}` }])
  })
})
