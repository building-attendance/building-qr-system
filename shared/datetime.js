// The one place that writes a date or a time for a person: DD/MM/YYYY and HH:MM (24 hours), in the building's time
// zone. The same on every phone and every computer: never the device's own region or language, never a month name, and
// no weekday but the initials of the date picker (below). Anything shown on a screen or written into a file for people goes through here, in the browser and on
// the server (the committee's CSV). tests/dates.test.js fails if another way of writing a date turns up in the code.
//
// What is NOT for people keeps its machine format on purpose: the API and the agent read ISO dates (2026-10-01,
// 2026-10-01T18:00:00Z), which cannot be misread as day-month or month-day.
//
// One exception, with its conditions (AGENTS.md, owner decision of 12/10/2026): the column heads of a table of consecutive days may write
// each day as DD/MM (`formatDayShort`), only when the table shows its whole range in DD/MM/YYYY right above it and each head carries its
// full date for a screen reader. Anywhere else a day keeps its year. tests/dates.test.js pins that `formatDayShort` is used by the Home
// screen's day bars and nowhere else.
//
// A second exception (AGENTS.md, owner decision of 14/10/2026): the app's own date picker (src/admin/DatePicker.jsx) heads the columns of its
// month grid with the one-letter initials of the days of the week, titles the month as MM/YYYY and shows each day as its number. The three
// functions that write them are below `formatDayShort`, and tests/dates.test.js pins that the picker is the one file that uses them, where
// every day of the grid is a button named by its full DD/MM/YYYY and the chosen date shows in its field as DD/MM/YYYY.

// The building's time zone is written once, in shared/contract.js (the server stores `scans.local_date` in the same zone).
// It is re-exported here so that the code that imports it from this file keeps working.
import { BUILDING_TZ } from './contract.js'
export { BUILDING_TZ }

// Only used to get the numbers (in the building's zone, 24 hours, Western digits): the text is put together by hand
// below, so no locale can change its shape.
const numbers = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUILDING_TZ,
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// The same numbers in UTC, for the one column of the committee's file that keeps the exact moment.
const numbersUtc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// A moment given as text must say which moment it is (a Z or an offset, as the API writes it). Text without one would
// be read in the time zone of whatever machine runs this, and the same text would show different times on two phones.
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i

function parts(value, formatter = numbers) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && !WITH_ZONE.test(value)) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const out = {}
  for (const part of formatter.formatToParts(date)) out[part.type] = part.value
  return out
}

/** '01/10/2026' (the day in the building's time zone), or '-' when there is no date. */
export function formatDate(value) {
  const p = parts(value)
  return p ? `${p.day}/${p.month}/${p.year}` : '-'
}

/** '21:05', 24 hours, or '-'. */
export function formatTime(value) {
  const p = parts(value)
  return p ? `${p.hour}:${p.minute}` : '-'
}

/** '01/10/2026 21:05', or '-'. */
export function formatDateTime(value) {
  const p = parts(value)
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '-'
}

/** The same as formatDateTime but in UTC ('30/09/2026 05:12'), for the committee's file: it keeps the exact moment. */
export function formatDateTimeUtc(value) {
  const p = parts(value, numbersUtc)
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '-'
}

/** The building's calendar day as the API writes it: '2026-10-01'. For queries and logic, not for people. */
export function isoDay(value = new Date()) {
  const p = parts(value)
  return p ? `${p.year}-${p.month}-${p.day}` : ''
}

/** '2026-10-01' (a calendar day from the API) as '01/10/2026'. No time zone is involved: it is already a day. */
export function formatDay(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '')
  return match && isRealDay(match[1], match[2], match[3]) ? `${match[3]}/${match[2]}/${match[1]}` : '-'
}

/**
 * '2026-10-01' as '01/10': the day and the month, '-' when it is not a real day.
 *
 * ONLY for the column heads of a table of consecutive days, and only when the table shows its whole range in DD/MM/YYYY right above it
 * (in the header of its card, which names the table) and every head carries its full date (`formatDay`) for a screen reader: the exception that the owner decided on 12/10/2026
 * (AGENTS.md, Rules for every change). A day anywhere else is written by `formatDay`, with its year. tests/dates.test.js fails when another
 * file uses this function.
 */
export function formatDayShort(ymd) {
  const full = formatDay(ymd)
  return full === '-' ? full : full.slice(0, 5)
}

// The three writers of the month grid of the app's own date picker (the second exception in the header of this file). ONLY for that grid,
// whose every day is a button named by its full date (`formatDay`) and whose chosen date shows in its field as DD/MM/YYYY.
// tests/dates.test.js fails when another file uses one of them.

/** '2026-10-14' (any day of the month) as '10/2026', the title of the month grid; '-' when it is not a real day. */
export function formatMonth(ymd) {
  const full = formatDay(ymd)
  return full === '-' ? full : full.slice(3)
}

/** '2026-10-05' as '5', a day of the month grid; '-' when it is not a real day. Its button is named by its full date. */
export function formatDayNumber(ymd) {
  const full = formatDay(ymd)
  return full === '-' ? full : String(Number(full.slice(0, 2)))
}

// The heads of the seven columns, Sunday first as the week runs in Israel: the first letter of each day's Hebrew name (alef, bet, gimel,
// dalet, he, vav, shin). The letters are what the committee app shows, and they are built here from their code points because the code of
// shared/ is in English and holds no Hebrew letter (AGENTS.md; tests/english-code.test.js).
const DAY_INITIALS = Object.freeze([0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5, 0x05e9].map((code) => String.fromCharCode(code)))

/** The one-letter initials of the days of the week, Sunday first: the column heads of the month grid. */
export function dayInitials() {
  return [...DAY_INITIALS]
}

/**
 * The hour of the moment in the building's time zone, 0 to 23 (so the 00:30 of a night is 0, never 24), or null when there is no moment.
 * It is the building's clock and not the device's, as every time a person sees (the greeting of the Home screen decides by it).
 * @param {Date | string | number} [now]  default: now
 * @returns {number | null}
 */
export function buildingHour(now = new Date()) {
  const p = parts(now)
  return p ? Number(p.hour) : null
}

/** True for a day that exists on the calendar: 29/02 only in a leap year, no 31st in a 30-day month. */
function isRealDay(year, month, day) {
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return check.getUTCFullYear() === Number(year) && check.getUTCMonth() === Number(month) - 1 && check.getUTCDate() === Number(day)
}

/** What a person types, '01/10/2026', as the API's '2026-10-01', or null when it is not a real date. */
export function parseDay(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text ?? '').trim())
  if (!match) return null
  const [, day, month, year] = match
  return isRealDay(year, month, day) && Number(year) >= 2000 && Number(year) <= 2100 ? `${year}-${month}-${day}` : null
}

/** While typing: digits only, with the slashes put in by themselves ('0110' becomes '01/10'), at most DD/MM/YYYY. */
export function maskDay(text) {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * What the DD/MM/YYYY field shows after the person edits it. `previous` is the text before the edit, `raw` is what the
 * browser has now (digits, maybe a slash that was typed or deleted) and `caret` is where the cursor is in `raw`.
 * Returns { text, caret }: the masked text and where the cursor goes, after the same digit as before.
 *
 * Deleting a slash also deletes the digit before it. Otherwise the slash would come straight back and the key press
 * would seem to do nothing, and the next one would delete the wrong digit.
 */
export function editDay(previous, raw, caret = String(raw ?? '').length) {
  const text = String(raw ?? '')
  let digits = ''
  let before = 0 // how many digits are left of the cursor
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i])) {
      digits += text[i]
      if (i < caret) before += 1
    }
  }
  const deletedASlash = text.length === String(previous ?? '').length - 1 && maskDay(text) === previous
  if (deletedASlash && before > 0) {
    digits = digits.slice(0, before - 1) + digits.slice(before)
    before -= 1
  }
  digits = digits.slice(0, 8)
  before = Math.min(before, digits.length)
  return { text: maskDay(digits), caret: before + (before > 2 ? 1 : 0) + (before > 4 ? 1 : 0) }
}
