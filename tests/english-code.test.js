// The code that the browser and the server share (shared/) and the server's code (server/) are written in English. Another language belongs
// only to text that a person sees in the app (src/i18n/*.js, and for now the Hebrew of the committee app in src/admin/ and
// src/pages/AdminApp.jsx) and to the tests that check that text (AGENTS.md, "Rules for every change"). tests/english-docs.test.js covers
// the documents; this test covers the code of these two folders: no file in them holds a Hebrew letter (U+0590 to U+05FF), not even in a
// comment. Text in Hebrew that a shared module must give the app (the day initials of the date picker in shared/datetime.js) is built from
// its code points. The Hebrew in this file is built the same way, so that it holds no Hebrew letter either.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

const HEBREW_LETTER = new RegExp(`[${String.fromCharCode(0x0590)}-${String.fromCharCode(0x05ff)}]`)
const FOLDERS = ['shared', 'server']
const SKIP_DIRS = new Set(['node_modules'])

/** Every file under `dir` (a folder of the project), as a path from the root with / as the separator. */
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(relative)
    return [relative]
  })
}

/** The lines of the files of `files` that hold a Hebrew letter, as `file:line`; `read(file)` gives the text of a file. */
function hebrewLines(files, read) {
  const found = []
  for (const file of files) {
    read(file).split(/\r?\n/).forEach((line, i) => {
      if (HEBREW_LETTER.test(line)) found.push(`${file}:${i + 1}`)
    })
  }
  return found
}

const files = FOLDERS.flatMap(walk)
const readFile = (file) => fs.readFileSync(path.join(root, file), 'utf8')

describe('the code of shared/ and server/ is written in English', () => {
  it('no file of shared/ or server/ holds a Hebrew letter', () => {
    expect(files.length, 'the walk really covers the two folders').toBeGreaterThan(40)
    expect(files).toContain('shared/datetime.js')
    expect(files).toContain('server/router.js')
    const offenders = hebrewLines(files, readFile)
    expect(offenders, `a Hebrew letter in the shared or the server code (build it from its code point, or move the text to the app):\n${offenders.join('\n')}`).toEqual([])
  })

  // The check above reads the files themselves, so it is checked by itself first: a Hebrew letter planted in any of the two folders, in
  // code or in a comment, is found, and the letters that the date picker needs are built without one.
  it('the check finds a Hebrew letter planted in code or in a comment, in either folder', () => {
    const alef = String.fromCharCode(0x05d0)
    for (const victim of ['shared/datetime.js', 'shared/contract.js', 'server/router.js']) {
      for (const planted of [`const x = '${alef}'`, `// ${alef}`]) {
        const read = (file) => (file === victim ? `${readFile(file)}\n${planted}\n` : readFile(file))
        expect(hebrewLines(files, read), `${planted} in ${victim}`).toEqual([`${victim}:${readFile(victim).split(/\r?\n/).length + 1}`])
      }
    }
    expect(HEBREW_LETTER.test(String.fromCharCode(0x05e9)), 'the last letter of the initials').toBe(true)
    expect(HEBREW_LETTER.test('a 1 / - DD/MM/YYYY'), 'nothing that is not Hebrew').toBe(false)
  })
})
