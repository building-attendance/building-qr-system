// The Home screen must run on the browsers that the build targets. vite.config.js builds for es2020, chrome87 and safari14: Vite lowers
// syntax for those, but it does not polyfill built-ins, so a method that a target lacks is a TypeError at run time, and Home is the first
// screen of the committee app (it would crash the app on an older iPhone). `Array.prototype.at` is the one that Codex found (Safari 15.4);
// the others below are as new or newer.
//
// This is local to the Home screen on purpose: a guard for all of src/ and shared/ is a change of its own.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
/** The code without its comments and without the text of its strings, so that a word in a comment or in a sentence is not a call. */
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

// Built-ins that Safari 14 (or Chrome 87) does not have, with where they arrived.
const NEWER_THAN_THE_TARGET = [
  [/\.at\(/, 'Array.prototype.at / String.prototype.at (Safari 15.4, Chrome 92): index with length - 1'],
  [/\.findLast(Index)?\(/, 'findLast / findLastIndex (Safari 15.4, Chrome 97)'],
  [/\.to(Sorted|Reversed|Spliced)\(/, 'toSorted / toReversed / toSpliced (Safari 16, Chrome 110)'],
  [/\.with\(/, 'Array.prototype.with (Safari 16, Chrome 110)'],
  [/\bObject\.hasOwn\(/, 'Object.hasOwn (Safari 15.4, Chrome 93)'],
  [/\bstructuredClone\(/, 'structuredClone (Safari 15.4, Chrome 98)'],
  [/\.replaceAll\(/, 'String.prototype.replaceAll (Safari 13.1, but the project keeps to replace with a global pattern)'],
  [/\.group(By)?\(/, 'Array.prototype.group / Object.groupBy (Safari 17.4, Chrome 117)'],
  [/\.isWellFormed\(|\.toWellFormed\(/, 'isWellFormed / toWellFormed (Safari 16.4, Chrome 111)'],
  [/\bArray\.fromAsync\(/, 'Array.fromAsync (Safari 16.4, Chrome 121)'],
  [/\bAbortSignal\.(timeout|any)\(/, 'AbortSignal.timeout / any (Safari 16, Chrome 103)'],
  [/\bcrypto\.randomUUID\(/, 'crypto.randomUUID (Safari 15.4, Chrome 92)'],
  [/\bIntl\./, 'Intl: dates and times go through shared/datetime.js only'],
]

describe('the Home screen uses only what the build targets have', () => {
  it('still builds for Safari 14 and Chrome 87 (so the list below is the right one)', () => {
    const config = read('vite.config.js')
    expect(config).toMatch(/target:\s*\[[^\]]*'safari14'/)
    expect(config).toMatch(/target:\s*\[[^\]]*'chrome87'/)
  })

  it('has no call of a built-in that came after those targets (Array.prototype.at first of all)', () => {
    const source = code(read('src/admin/views/HomeView.jsx'))
    expect(source.length, 'the file was read').toBeGreaterThan(2000)
    const found = NEWER_THAN_THE_TARGET.filter(([pattern]) => pattern.test(source)).map(([, why]) => why)
    expect(found, `HomeView.jsx uses a built-in that the build's browsers lack:\n  ${found.join('\n  ')}`).toEqual([])
  })

  it('sees what it is looking for: the check finds a call in code, and ignores a word in a comment or in a sentence', () => {
    const find = (text) => NEWER_THAN_THE_TARGET.filter(([pattern]) => pattern.test(code(text))).length
    expect(find('const last = days.at(-1)')).toBe(1)
    expect(find('const last = rows.findLast((r) => r)')).toBe(1)
    expect(find('// days.at(-1) is not allowed\nconst last = days[days.length - 1]')).toBe(0)
    expect(find("const text = 'at(0)'\nconst last = days[days.length - 1]")).toBe(0)
  })
})
