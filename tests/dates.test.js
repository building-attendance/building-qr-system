// Every date and time a person sees is DD/MM/YYYY and HH:MM (shared/datetime.js). This tests the writer itself, and
// guards the code: another way of writing a date (a month name, a weekday, the browser's own date field, the device's
// locale) fails here before it reaches a screen. The patterns of the guard live in scripts/text-rules.mjs, which the
// Claude Code edit hook (scripts/hooks/check-edit.mjs) reads too.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  formatDate, formatTime, formatDateTime, formatDateTimeUtc, formatDay, formatDayShort, buildingHour, isoDay, parseDay, maskDay, editDay,
} from '../shared/datetime.js'
import { findDateProblems } from '../scripts/text-rules.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')

describe('writing a moment: DD/MM/YYYY and HH:MM in the building time', () => {
  it('summer time (UTC+3) and winter time (UTC+2)', () => {
    expect(formatDateTime('2026-09-30T05:12:00Z')).toBe('30/09/2026 08:12')
    expect(formatDateTime('2026-01-15T10:00:00Z')).toBe('15/01/2026 12:00')
    expect(formatDate('2026-09-30T05:12:00Z')).toBe('30/09/2026')
    expect(formatTime('2026-09-30T05:12:00Z')).toBe('08:12')
  })

  it('the day changes at midnight in the building, not in UTC, and midnight is 00:30, never 24:30', () => {
    expect(formatDateTime('2026-09-30T21:30:00Z')).toBe('01/10/2026 00:30')
    expect(formatDateTime('2026-09-30T20:59:00Z')).toBe('30/09/2026 23:59')
  })

  it('follows the clock change at the end of October', () => {
    expect(formatDateTime('2026-10-24T20:00:00Z')).toBe('24/10/2026 23:00')
    expect(formatDateTime('2026-10-25T20:00:00Z')).toBe('25/10/2026 22:00')
  })

  it('takes a Date or an ISO string, and shows "-" for no date or a bad one', () => {
    expect(formatDateTime(new Date('2026-09-30T05:12:00Z'))).toBe('30/09/2026 08:12')
    for (const nothing of [null, undefined, '', 'not a date', NaN]) {
      expect(formatDateTime(nothing)).toBe('-')
      expect(formatDate(nothing)).toBe('-')
      expect(formatTime(nothing)).toBe('-')
    }
  })

  it('always has the same shape, for any moment', () => {
    let seed = 1
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 300; i++) {
      const moment = new Date(Date.UTC(2020, 0, 1) + Math.floor(random() * 12 * 365 * 86_400_000))
      expect(formatDateTime(moment), moment.toISOString()).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
      expect(formatTime(moment)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })

  it('does not depend on the language, region or time zone of the machine it runs on', () => {
    // a fresh Node on a machine set to Arabic (Egypt) and New York time, which reads the module from scratch
    const script = `import('${pathToFileURL(path.join(root, 'shared', 'datetime.js')).href}').then((m) => console.log(JSON.stringify([
      m.formatDateTime('2026-09-30T05:12:00Z'), m.formatDateTimeUtc('2026-09-30T05:12:00Z'), m.formatDate('2026-09-30T21:30:00Z'), m.isoDay('2026-09-30T21:30:00Z'),
    ])))`
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, LANG: 'ar_EG.UTF-8', LC_ALL: 'ar_EG.UTF-8', TZ: 'America/New_York' } })
    expect(JSON.parse(out.toString())).toEqual(['30/09/2026 08:12', '30/09/2026 05:12', '01/10/2026', '2026-10-01'])
  })

  it('a moment as text must say which moment it is (Z or an offset): text without a zone depends on the machine', () => {
    expect(formatDateTime('2026-09-30T05:12:00Z')).toBe('30/09/2026 08:12')
    expect(formatDateTime('2026-09-30T08:12:00+03:00')).toBe('30/09/2026 08:12')
    expect(formatDateTime('2026-09-30T05:12:00.000Z')).toBe('30/09/2026 08:12')
    for (const unclear of ['2026-09-30T05:12:00', '2026-09-30', '2026-09-30 05:12:00', 'Sep 30 2026']) {
      expect(formatDateTime(unclear), unclear).toBe('-')
    }
  })

  it('the exact moment for the committee file: UTC, in the same shape, so the repeated hour of October can be told apart', () => {
    expect(formatDateTimeUtc('2026-09-30T05:12:00Z')).toBe('30/09/2026 05:12')
    // the night the clocks go back (25 October 2026): 01:30 happens twice in the building
    expect(formatDateTime('2026-10-24T22:30:00Z')).toBe('25/10/2026 01:30')
    expect(formatDateTime('2026-10-24T23:30:00Z')).toBe('25/10/2026 01:30')
    expect(formatDateTimeUtc('2026-10-24T22:30:00Z')).not.toBe(formatDateTimeUtc('2026-10-24T23:30:00Z'))
    expect(formatDateTimeUtc(null)).toBe('-')
  })
})

// The Home screen greets by the hour of the building's clock: 05:00 to 11:59 the morning, 12:00 to 16:59 the noon, 17:00 to 04:59 the evening.
// This is the hour itself, and the edges of those windows are tested where the greeting is (tests/components/home.test.jsx).
describe("the hour on the building's clock (buildingHour)", () => {
  it('summer time (UTC+3): the edges of the three windows, to the minute', () => {
    const hour = (iso) => buildingHour(iso)
    expect(hour('2026-10-12T01:59:00Z')).toBe(4) // 04:59
    expect(hour('2026-10-12T02:00:00Z')).toBe(5) // 05:00
    expect(hour('2026-10-12T08:59:00Z')).toBe(11) // 11:59
    expect(hour('2026-10-12T09:00:00Z')).toBe(12) // 12:00
    expect(hour('2026-10-12T13:59:00Z')).toBe(16) // 16:59
    expect(hour('2026-10-12T14:00:00Z')).toBe(17) // 17:00
  })

  it('winter time (UTC+2): the same edges, an hour later in UTC', () => {
    const hour = (iso) => buildingHour(iso)
    expect(hour('2026-01-15T02:59:00Z')).toBe(4) // 04:59
    expect(hour('2026-01-15T03:00:00Z')).toBe(5) // 05:00
    expect(hour('2026-01-15T09:59:00Z')).toBe(11) // 11:59
    expect(hour('2026-01-15T10:00:00Z')).toBe(12) // 12:00
    expect(hour('2026-01-15T14:59:00Z')).toBe(16) // 16:59
    expect(hour('2026-01-15T15:00:00Z')).toBe(17) // 17:00
  })

  it("midnight is hour 0, never 24, and the hour is the building's and not UTC's", () => {
    expect(buildingHour('2026-09-30T21:30:00Z')).toBe(0) // 00:30 on 01/10
    expect(buildingHour('2026-09-30T20:59:00Z')).toBe(23) // 23:59 on 30/09
    expect(buildingHour('2026-01-15T22:00:00Z')).toBe(0) // 00:00 in winter
  })

  it('follows the two clock changes: the hour that is skipped in spring, and the hour that happens twice in autumn', () => {
    // spring 2026: at 02:00 on 27 March the clocks go to 03:00, so there is no 02:xx
    expect(buildingHour('2026-03-26T23:59:00Z')).toBe(1) // 01:59 (UTC+2)
    expect(buildingHour('2026-03-27T00:00:00Z')).toBe(3) // 03:00 (UTC+3)
    // autumn 2026: at 02:00 on 25 October the clocks go back to 01:00, so 01:30 happens twice
    expect(buildingHour('2026-10-24T22:30:00Z')).toBe(1) // 01:30 (UTC+3)
    expect(buildingHour('2026-10-24T23:30:00Z')).toBe(1) // 01:30 again (UTC+2)
    expect(buildingHour('2026-10-25T02:59:00Z')).toBe(4) // 04:59 (UTC+2)
    expect(buildingHour('2026-10-25T03:00:00Z')).toBe(5) // 05:00 (UTC+2)
  })

  it('takes a Date, a number or an ISO string with an offset, and has the hour of now when it is given nothing', () => {
    expect(buildingHour(new Date('2026-10-12T09:00:00Z'))).toBe(12)
    expect(buildingHour(Date.parse('2026-10-12T09:00:00Z'))).toBe(12)
    expect(buildingHour('2026-10-12T12:00:00+03:00')).toBe(12)
    expect(buildingHour()).toBe(Number(formatTime(new Date()).slice(0, 2)))
  })

  it('is null for no moment, for text that is not one, and for text that does not say which moment it is', () => {
    for (const nothing of [null, '', 'not a date', '2026-10-12T09:00:00', '2026-10-12', NaN]) {
      expect(buildingHour(nothing), String(nothing)).toBeNull()
    }
  })

  it('does not depend on the time zone or the language of the machine it runs on', () => {
    const script = `import('${pathToFileURL(path.join(root, 'shared', 'datetime.js')).href}').then((m) => console.log(JSON.stringify([
      m.buildingHour('2026-10-12T09:00:00Z'), m.buildingHour('2026-09-30T21:30:00Z'), m.formatDayShort('2026-10-01'),
    ])))`
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, LANG: 'ar_EG.UTF-8', LC_ALL: 'ar_EG.UTF-8', TZ: 'America/New_York' } })
    expect(JSON.parse(out.toString())).toEqual([12, 0, '01/10'])
  })
})

describe('a calendar day', () => {
  it("is the building's day as the API writes it, and as a person reads it", () => {
    expect(isoDay('2026-09-30T21:30:00Z')).toBe('2026-10-01')
    expect(formatDay('2026-10-01')).toBe('01/10/2026')
    expect(formatDay('')).toBe('-')
    expect(formatDay('1 Oct 2026')).toBe('-')
    expect(formatDay('2026-02-30')).toBe('-') // a day that is not on the calendar
    expect(formatDay('2028-02-29')).toBe('29/02/2028')
    expect(isoDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is written short, for a column head: the day and the month, and "-" for what is not a real day', () => {
    expect(formatDayShort('2026-10-01')).toBe('01/10')
    expect(formatDayShort('2026-12-31')).toBe('31/12')
    expect(formatDayShort('2028-02-29')).toBe('29/02') // a leap year
    for (const bad of ['', '1 Oct 2026', '2026-02-30', '2027-02-29', '2026-13-01', '01/10/2026', null, undefined]) {
      expect(formatDayShort(bad), String(bad)).toBe('-')
    }
  })

  it('is read back from what a person types, only when it is a real date', () => {
    expect(parseDay('01/10/2026')).toBe('2026-10-01')
    expect(parseDay(' 29/02/2028 ')).toBe('2028-02-29') // a leap year
    for (const bad of ['31/02/2026', '29/02/2027', '00/10/2026', '1/10/2026', '01-10-2026', '2026-10-01', '01/10/1999', '01/10/2101', '', null]) {
      expect(parseDay(bad), String(bad)).toBeNull()
    }
  })

  it('is masked while typing: the slashes come by themselves, digits only, nothing past the year', () => {
    expect(maskDay('')).toBe('')
    expect(maskDay('0')).toBe('0')
    expect(maskDay('01')).toBe('01')
    expect(maskDay('011')).toBe('01/1')
    expect(maskDay('0110')).toBe('01/10')
    expect(maskDay('01102026')).toBe('01/10/2026')
    expect(maskDay('01/10/2026999')).toBe('01/10/2026')
    expect(maskDay('ab01x10')).toBe('01/10')
    expect(maskDay('01/1')).toBe('01/1') // already masked text stays as it is
  })

  describe('editing the field (editDay)', () => {
    it('typing at the end adds the slashes and keeps the cursor at the end', () => {
      expect(editDay('01', '013', 3)).toEqual({ text: '01/3', caret: 4 })
      expect(editDay('01/1', '01/10', 5)).toEqual({ text: '01/10', caret: 5 })
      expect(editDay('', '0', 1)).toEqual({ text: '0', caret: 1 })
    })

    it('deleting the last digit takes the slash that would follow nothing away', () => {
      expect(editDay('01/1', '01/', 3)).toEqual({ text: '01', caret: 2 })
      expect(editDay('01/10/2', '01/10/', 6)).toEqual({ text: '01/10', caret: 5 })
    })

    it('deleting a slash deletes the digit before it, so something happens and the cursor stays by that digit', () => {
      // backspace with the cursor right after the first slash of 01/10/2026
      expect(editDay('01/10/2026', '0110/2026', 2)).toEqual({ text: '01/02/026', caret: 1 })
      // backspace right after the second slash
      expect(editDay('01/10/2026', '01/102026', 5)).toEqual({ text: '01/12/026', caret: 4 })
    })

    it('typing a digit in the middle pushes the others along, and the cursor follows the typed digit', () => {
      expect(editDay('01/10/2026', '051/10/2026', 2)).toEqual({ text: '05/11/0202', caret: 2 })
    })

    it('pasting a whole date, with or without the slashes, gives the same field', () => {
      expect(editDay('', '01/10/2026')).toEqual({ text: '01/10/2026', caret: 10 })
      expect(editDay('', '01102026')).toEqual({ text: '01/10/2026', caret: 10 })
      expect(editDay('01/01/2026', '15/11/2026999', 13).text).toBe('15/11/2026')
    })

    it('selecting everything and typing replaces it', () => {
      expect(editDay('01/10/2026', '7', 1)).toEqual({ text: '7', caret: 1 })
    })
  })
})

// ---- the guard ---------------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path.join(dir, entry.name))
    return /\.(js|jsx|mjs)$/.test(entry.name) ? [path.join(dir, entry.name).replace(/\\/g, '/')] : []
  })
}

describe('no other way of writing a date in the code', () => {
  const files = ['src', 'server', 'shared'].flatMap(walk)

  it('the code that writes dates is the shared module, with the API machine format as the one exception', () => {
    expect(files.length).toBeGreaterThan(40)
    // The patterns are in scripts/text-rules.mjs. Make sure the guard is not empty: it must see a bad date and let
    // the shared module and the API's own machine format through.
    expect(findDateProblems('src/x.js', 'new Date().toLocaleDateString()')).not.toEqual([])
    expect(findDateProblems('shared/datetime.js', 'new Intl.DateTimeFormat()')).toEqual([])
    expect(findDateProblems('server/scans.js', 'new Intl.DateTimeFormat()')).toEqual([])
    expect(findDateProblems('src/x.js', 'new Intl.DateTimeFormat()')).not.toEqual([])
    const offenders = []
    for (const file of files) {
      for (const what of findDateProblems(file, fs.readFileSync(path.join(root, file), 'utf8'))) offenders.push(`${file}: ${what}`)
    }
    expect(offenders, `another way of writing a date:\n${offenders.join('\n')}`).toEqual([])
  })

  it("the machine string of the API ('YYYY-MM-DD HH:mm:ss') is never shown on a screen", () => {
    const shown = files.filter((f) => f.startsWith('src/') && !f.endsWith('AgentView.jsx')) // AgentView only names it, in the text for the agent
    for (const file of shown) {
      expect(fs.readFileSync(path.join(root, file), 'utf8'), file).not.toContain('checked_in_local')
    }
  })

  // The one place that a day is written without its year: the column heads of a table of consecutive days, on the condition that the whole range
  // stands in DD/MM/YYYY right above the table and that each head carries its full date for a screen reader (AGENTS.md, owner decision of
  // 12/10/2026; the header of shared/datetime.js). So `formatDayShort` is used by the week table of the Home screen and by nothing else, and
  // that table has both conditions in its source (tests/components/home.test.jsx proves them on the screen).
  it('formatDayShort (a day with no year) is used by the column heads of the Home week table only, with the range and the full date beside it', () => {
    const using = files.filter((file) => file !== 'shared/datetime.js' && /\bformatDayShort\b/.test(fs.readFileSync(path.join(root, file), 'utf8')))
    expect(using, 'the files that use formatDayShort').toEqual(['src/admin/views/HomeView.jsx'])
    const home = fs.readFileSync(path.join(root, 'src/admin/views/HomeView.jsx'), 'utf8')
    expect(home.match(/formatDayShort\(/g), 'used once, for the heads').toHaveLength(1)
    // the range, in full, is the caption of the table
    expect(home).toMatch(/<caption[^>]*>[^]*formatDay\(days\[0\]\)[^]*formatDay\(today\)[^]*<\/caption>/)
    // and each head writes DD/MM for the eye (hidden from a reader) and carries its full date for a reader (hidden from the eye)
    expect(home).toMatch(/<span className="a-stamp" aria-hidden="true">\{formatDayShort\(day\)\}<\/span>\s*<span className="w-sr">\{formatDay\(day\)\}<\/span>/)
  })

  it('the committee screens write dates through the shared module', () => {
    const history = fs.readFileSync(path.join(root, 'src/admin/views/HistoryView.jsx'), 'utf8')
    expect(history).toContain("from '../../../shared/datetime.js'")
    // The two date fields are the app's own DateInput (never the browser's date field), drawn by `DateRangeFields`, which the History
    // tab and the audit log share (src/admin/filters.jsx); the History tab hands it its own filters.
    expect(history).toMatch(/<DateRangeFields from=\{values\.from\} to=\{values\.to\}/)
    const filters = fs.readFileSync(path.join(root, 'src/admin/filters.jsx'), 'utf8')
    expect(filters).toContain("from '../../shared/datetime.js'")
    expect(filters).toMatch(/<DateInput value=\{from\}/)
    expect(filters).toMatch(/<DateInput value=\{to\}/)
    const hooks = fs.readFileSync(path.join(root, 'src/admin/hooks.js'), 'utf8')
    expect(hooks).toContain("export { formatDateTime } from '../../shared/datetime.js'")
  })
})
