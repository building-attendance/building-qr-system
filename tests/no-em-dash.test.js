// The em dash (U+2014) and the en dash (U+2013) are never used anywhere in this project: not in the screens, the code, the
// comments or the documents (the en dash since the owner's decision of 14/10/2026). Use a regular hyphen, a comma or
// parentheses instead. The characters, the folders to skip and the kind of file to read come from scripts/text-rules.mjs,
// which builds the characters from their code points so that no file here contains them either. The Claude Code edit hook
// (scripts/hooks/check-edit.mjs) checks the same rule. The project's skills (.claude/skills/) are in the walk; the rest of
// .claude/ is not (tests/text-rules-scope.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LONG_DASHES, isTextFileToCheck, listProjectFiles, findDashLines } from '../scripts/text-rules.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

describe('no em dash and no en dash anywhere', () => {
  it('finds none in any source, document, style, page or data file of the project', () => {
    const files = listProjectFiles(root).filter(isTextFileToCheck)
    expect(files.length).toBeGreaterThan(50) // the walk really covers the project
    expect(files.some((file) => file.startsWith('.claude/skills/')), 'the skills are in the walk').toBe(true)
    const offenders = []
    for (const file of files) {
      for (const { line, text, dashes } of findDashLines(fs.readFileSync(path.join(root, file), 'utf8'))) {
        offenders.push(`${file}:${line} (${dashes.join(', ')}): ${text.slice(0, 80)}`)
      }
    }
    expect(offenders, `em dash or en dash found:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the translations in particular (every language) are free of both', () => {
    for (const lang of ['he', 'en', 'ru', 'ar']) {
      const text = fs.readFileSync(path.join(root, 'src', 'i18n', `${lang}.js`), 'utf8')
      for (const dash of LONG_DASHES) expect(text.includes(dash.char), `${lang}: ${dash.name}`).toBe(false)
    }
  })

  it('the two characters are the em dash and the en dash, and a line with either is found', () => {
    expect(LONG_DASHES.map((dash) => dash.char.charCodeAt(0))).toEqual([0x2014, 0x2013])
    const [em, en] = LONG_DASHES.map((dash) => dash.char)
    expect(findDashLines(`clean - line\nan ${en} here\nboth ${em} and ${en}\r\nclean again`)).toEqual([
      { line: 2, text: `an ${en} here`, dashes: ['en dash'] },
      { line: 3, text: `both ${em} and ${en}`, dashes: ['em dash', 'en dash'] },
    ])
  })
})
