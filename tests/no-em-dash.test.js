// The em dash (U+2014) is never used anywhere in this project: not in the screens, the code, the comments or the
// documents. Use a comma, a colon, a full stop or parentheses instead. The character, the folders to skip and the kind
// of file to read come from scripts/text-rules.mjs, which builds the character from its code point so that no file
// here contains it either. The Claude Code edit hook (scripts/hooks/check-edit.mjs) checks the same rule. The project's
// skills (.claude/skills/) are in the walk; the rest of .claude/ is not (tests/text-rules-scope.test.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { EM_DASH, isTextFileToCheck, listProjectFiles, findEmDashLines } from '../scripts/text-rules.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

describe('no em dash anywhere', () => {
  it('finds none in any source, document, style, page or data file of the project', () => {
    const files = listProjectFiles(root).filter(isTextFileToCheck)
    expect(files.length).toBeGreaterThan(50) // the walk really covers the project
    expect(files.some((file) => file.startsWith('.claude/skills/')), 'the skills are in the walk').toBe(true)
    const offenders = []
    for (const file of files) {
      for (const { line, text } of findEmDashLines(fs.readFileSync(path.join(root, file), 'utf8'))) {
        offenders.push(`${file}:${line}: ${text.slice(0, 80)}`)
      }
    }
    expect(offenders, `em dash found:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the translations in particular (every language) are free of it', () => {
    for (const lang of ['he', 'en', 'ru', 'ar']) {
      const text = fs.readFileSync(path.join(root, 'src', 'i18n', `${lang}.js`), 'utf8')
      expect(text.includes(EM_DASH), lang).toBe(false)
    }
  })
})
