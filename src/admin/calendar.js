// The arithmetic of calendar days, for the app's own date picker (DatePicker.jsx: the month grid and the wheels of a phone) and the default
// range of the History tab. A day is
// what the API takes, 'YYYY-MM-DD'. A calendar day has no time zone, so the arithmetic is done in UTC, where every day is 24 hours long
// (a clock change in the building moves no day). "Today" is always the building's day (`isoDay`, in BUILDING_TZ of shared/contract.js),
// never the device's: a committee member abroad sees the building's calendar. Nothing here writes a date for a person: that is
// shared/datetime.js.
import { isoDay } from '../../shared/datetime.js'

const DAY_MS = 86_400_000
const toUtc = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The first day that a date field takes (`parseDay` of shared/datetime.js takes the years 2000 to 2100). */
export const FIRST_DAY = '2000-01-01'

/** True for a real day in the API's shape: '2026-10-14', not '2026-02-30'. */
export const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value

/** `day` moved by `n` days (back when `n` is negative). */
export const addDays = (day, n) => fromUtc(toUtc(day) + n * DAY_MS)

/** The day of the week of `day`: 0 for Sunday, the first day of the week in Israel, to 6 for Saturday. */
export const dayOfWeek = (day) => new Date(toUtc(day)).getUTCDay()

/** The Sunday and the Saturday of the week of `day`. */
export const startOfWeek = (day) => addDays(day, -dayOfWeek(day))
export const endOfWeek = (day) => addDays(day, 6 - dayOfWeek(day))

/** The first day of the month of `day`. */
export const firstOfMonth = (day) => `${day.slice(0, 8)}01`

/** The same day of the month `n` months later (earlier when `n` is negative), or the last day of that month when it is shorter. */
export function addMonths(day, n) {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7)) - 1 + n
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return fromUtc(Date.UTC(year, month, Math.min(Number(day.slice(8, 10)), last)))
}

/** How many days the month of `day` has: 28 to 31, and 29 in the February of a leap year. */
export const daysInMonth = (day) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()

const pad = (n, width) => String(n).padStart(width, '0')

/**
 * `day` with one of its parts set to `n`, as a wheel of the date picker sets it (`part` is 'year', 'month' or 'day', `n` its number): the
 * day of the month is kept, or cut to the last day of a shorter month (the 31st of January in February is the 28th, or the 29th in a leap
 * year), and the day is kept between `first` and `last` (a day after today becomes today), as the keys of the month grid keep it.
 */
export function setDatePart(day, part, n, first = FIRST_DAY, last = '') {
  const year = part === 'year' ? n : Number(day.slice(0, 4))
  const month = part === 'month' ? n : Number(day.slice(5, 7))
  const start = `${pad(year, 4)}-${pad(month, 2)}-01`
  const date = part === 'day' ? n : Number(day.slice(8, 10))
  return clampDay(`${start.slice(0, 8)}${pad(Math.min(date, daysInMonth(start)), 2)}`, first, last)
}

/** `day`, kept between `first` and `last` (each a day, or empty for no limit). */
export function clampDay(day, first, last) {
  if (first && day < first) return first
  if (last && day > last) return last
  return day
}

/**
 * The weeks of the month of `day`, as a month grid draws them: always six rows of seven days, Sunday first, so that the grid keeps its
 * height from one month to the next. A day of another month is null (its cell stays empty).
 * @param {string} day
 * @returns {(string | null)[][]}
 */
export function monthWeeks(day) {
  const first = firstOfMonth(day)
  const sunday = addDays(first, -dayOfWeek(first))
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, d) => {
    const cell = addDays(sunday, week * 7 + d)
    return cell.slice(0, 7) === first.slice(0, 7) ? cell : null
  }))
}

/** The last `n` days up to `today` (the building's), as `{ from, to }`: 7 is the week that the History tab opens with. */
export const lastDays = (n, today = isoDay()) => ({ from: addDays(today, 1 - n), to: today })

/**
 * The quick ranges under the month grid of the date picker (owner decision of 14/10/2026), in their order. Each sets both dates of its
 * filter group at once, and ends today, the building's day.
 */
export const QUICK_RANGES = Object.freeze([
  { key: 'today', label: 'היום', range: (today) => lastDays(1, today) },
  { key: 'week', label: '7 ימים', range: (today) => lastDays(7, today) },
  { key: 'month30', label: '30 יום', range: (today) => lastDays(30, today) },
  { key: 'thisMonth', label: 'החודש', range: (today) => ({ from: firstOfMonth(today), to: today }) },
])
