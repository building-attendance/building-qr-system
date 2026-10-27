// What the recorder of the long promo (npm run promo:frames, playwright.promo.config.js) shares: where it runs, where its pictures go,
// the guard that keeps the run on the developer's own machine in a scratch schema of its own, the run's clock, and the pure helpers that
// tests/promo-capture.test.js checks. Node built-ins, shared/datetime.js and the settings files of the other tools only, so that the
// config, the spec, the seed, the clock and the test can all import it.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SCHEMA, runPaths } from '../e2e-config.mjs'
import { SCREENSHOTS_SCHEMA, assertLocalScratch } from '../screenshots/settings.mjs'
import { UI_REVIEW_SCHEMA } from '../ui-review/settings.mjs'
import { VIDEO_SCHEMA } from '../video/settings.mjs'
import { formatTime, isoDay } from '../../shared/datetime.js'

// The run reuses the machinery of the E2E run (playwright.config.js reads the three settings as E2E_APP_PORT, E2E_API_PORT and
// E2E_SCHEMA). Its values are away from the development servers (3000, 3001), the E2E runs (3100, 3101, 3200, 3201), the README
// screenshots (3300, 3301), the UI review (3400, 3401), the tutorial recorder (3600, 3601) and the timings (3700 to 3721). They are fixed:
// a value left in the shell by another run must never send this one to that run's schema.
export const PROMO_APP_PORT = 3800
export const PROMO_API_PORT = 3801
export const PROMO_SCHEMA = 'promo'

/** The project root, with the separator of this system and a closing one. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The folder of the pictures and frames.json, from the project root. Under video/out/, which .gitignore keeps out of git. */
export const PROMO_OUT_DIR = 'video/out/promo-frames/he'
export const promoOutDir = () => path.join(ROOT, PROMO_OUT_DIR)

/**
 * The file through which the spec sets the clock of the API (scripts/promo/clock.mjs reads it): in the run's own folder under
 * node_modules/.cache, which git, ESLint and the text-rule tests leave alone.
 */
export const promoClockFile = () => path.join(ROOT, path.dirname(runPaths(PROMO_SCHEMA).buildDir), 'clock.json')

// Schemas that belong to other tools, each of which drops or remakes its own. public, dev_ui and neon_auth are refused for every tool by
// parseE2eSchema, inside assertLocalScratch.
const OTHER_TOOLS = Object.freeze({
  [DEFAULT_SCHEMA]: "it is the E2E run's",
  [SCREENSHOTS_SCHEMA]: "it is the README screenshots'",
  [UI_REVIEW_SCHEMA]: "it is the UI review's",
  [VIDEO_SCHEMA]: "it is the tutorial recorder's",
  perf: "it is the scan timing's",
  perf_api: "it is the API timing's",
  perf_screens: "it is the screen timing's",
})

const PREFIX = 'Refusing to record the promo'

/**
 * The guard of the run. The pictures are taken of the invented data of a scratch schema, on this machine, and of nothing else. Throws,
 * with a message that says what was wrong, unless
 *  - the address of the app is `http://localhost:<port>` or `http://127.0.0.1:<port>` (never another host, never https), and
 *  - the schema is a scratch schema that is not public, dev_ui or neon_auth, and not the schema of another tool (OTHER_TOOLS).
 * It runs when the config is read, in the seed, and again in the spec with the address that Playwright really uses.
 * @param {{ baseURL: string | undefined, schema: string | undefined }} where
 */
export function assertLocalPromo({ baseURL, schema }) {
  if (typeof schema === 'string' && Object.hasOwn(OTHER_TOOLS, schema)) {
    throw new Error(`${PREFIX} in the schema "${schema}": ${OTHER_TOOLS[schema]}, which drops it before and after every run.`)
  }
  try {
    return assertLocalScratch({ baseURL, schema })
  } catch (err) {
    throw new Error(String(err.message).replace(/^Refusing to take screenshots/, PREFIX), { cause: err })
  }
}

/**
 * The schema half of the guard, for the seed (which has no address to check): the same rules, with the run's own address.
 * @param {string | undefined} schema
 */
export const assertPromoSchema = (schema) => assertLocalPromo({ baseURL: `http://localhost:${PROMO_APP_PORT}`, schema }).schema

// ---- the clock ----------------------------------------------------------------------------------------------------------------------

/** The latest hour of the run's clock: every moment of the story is in the morning, before it. */
const LATEST_HOUR = 9

/**
 * The building day of the story: today when the building's clock has passed 09:00, else yesterday. Every moment of the story (07:41 to
 * 08:40) is then in the past, so a position that the browser stamps with the real time never looks older than the moment of the visit.
 * @param {number} [now]  milliseconds, the real time
 */
export function promoDay(now = Date.now()) {
  return isoDay(new Date(now - LATEST_HOUR * 60 * 60 * 1000))
}

/**
 * The story's day as the run was given it (PROMO_DAY): a real calendar day that is not after promoDay(), or an error. A later day would put
 * the story in the future of the browser's own timestamps.
 * @param {string | undefined} day
 */
export function checkPromoDay(day) {
  const real = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day
  if (!real || day > promoDay()) throw new Error(`PROMO_DAY ${JSON.stringify(day)} is not a day of the story: YYYY-MM-DD, at most ${promoDay()}.`)
  return day
}

/**
 * The moment at which the building's clock shows `hhmm` on `day`: a Date, or an error when there is none (a time that the clocks skip).
 * It tries every offset from UTC that a time zone has (UTC-12 to UTC+14, in quarters of an hour) and keeps the one at which
 * shared/datetime.js writes that day and that time, so the building's zone and its summer time are the app's own rules.
 * @param {string} day  `YYYY-MM-DD`
 * @param {string} hhmm  `HH:MM`
 */
export function buildingInstant(day, hhmm) {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)
  const asUtc = Date.UTC(year, month - 1, date, hour, minute)
  for (let quarters = -56; quarters <= 48; quarters++) {
    const at = new Date(asUtc - quarters * 15 * 60 * 1000)
    if (isoDay(at) === day && formatTime(at) === hhmm) return at
  }
  throw new Error(`The building's clock never shows ${hhmm} on ${day}.`)
}

/**
 * `n` calendar days after `day` (before it when `n` is negative), as `YYYY-MM-DD`. Arithmetic on the date in UTC, where every day has
 * the same length (as server/home.js does).
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10)
}

/** The day of the week of `day`, 0 for Sunday to 6 for Saturday. */
export const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay()

/** Sunday to Thursday: the days of the week on which the cleaning comes (five a week, as the agreement of the story says). */
export const isWorkday = (day) => weekdayOf(day) <= 4

/**
 * The day of the story's week on which the cleaning did not come, one of the six days before `today`: a Monday, a Tuesday or a Wednesday
 * when there is one (its empty dot then stands alone between two days with a visit, not beside the empty dots of the weekend), the one
 * nearest to the middle of the week (three days ago, then two, four, one, five, six); else the workday nearest to the middle.
 * @param {string} today
 */
export function missingDay(today) {
  const days = [3, 2, 4, 1, 5, 6].map((n) => addDays(today, -n))
  const midweek = days.find((day) => weekdayOf(day) >= 1 && weekdayOf(day) <= 3)
  const day = midweek ?? days.find(isWorkday)
  if (!day) throw new Error('Six days in a row always hold a workday') // never
  return day
}

// ---- the boxes of frames.json -------------------------------------------------------------------------------------------------------

/** The shape of the video's frame (1080x1920): what a zoom rectangle is cut to. */
export const FRAME_ASPECT = 9 / 16

/**
 * The rectangle that a scene zooms into, around `box` (the element that the scene names), on a picture of `width` by `height` (all in the
 * picture's own pixels): the shape of the video's frame, `factor` times narrower than the picture (at least two, D3), or as large as the
 * element needs, centred on the element and kept inside the picture. Whole pixels.
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {{ width: number, height: number }} picture
 * @param {number} [factor]
 */
export function zoomRect(box, picture, factor = 2) {
  const pad = box.width * 0.08 + 8
  let w = Math.max(picture.width / factor, box.width + 2 * pad, (box.height + 2 * pad) * FRAME_ASPECT)
  let h = w / FRAME_ASPECT
  if (w > picture.width) { w = picture.width; h = w / FRAME_ASPECT }
  if (h > picture.height) { h = picture.height; w = Math.min(picture.width, h * FRAME_ASPECT) }
  const clamp = (start, size, total) => Math.min(Math.max(start, 0), total - size)
  const x = clamp(box.x + box.width / 2 - w / 2, w, picture.width)
  const y = clamp(box.y + box.height / 2 - h / 2, h, picture.height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
}

/**
 * The box of an element in the picture's own pixels: its box in CSS pixels times the density of the picture, kept inside the picture.
 * @param {{ x: number, y: number, width: number, height: number }} css
 * @param {number} scale
 * @param {{ width: number, height: number }} picture
 */
export function pictureBox(css, scale, picture) {
  const x = Math.max(0, Math.round(css.x * scale))
  const y = Math.max(0, Math.round(css.y * scale))
  const right = Math.min(picture.width, Math.round((css.x + css.width) * scale))
  const bottom = Math.min(picture.height, Math.round((css.y + css.height) * scale))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}
