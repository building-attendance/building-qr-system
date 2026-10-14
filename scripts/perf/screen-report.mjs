// What the timing of the committee's screens is made of, apart from the browser: the screens and where each one is "loaded", the two
// devices, the targets, the page-side probe, the numbers (median, p95), the comparison with the baseline, the report, and the step
// that makes a run the baseline (`npm run perf:screens`, docs/testing.md "Timing the committee's screens"). Nothing here starts a
// browser, so scripts/perf/screen-timing.playwright.mjs and tests/perf-screens.test.js can both import it.
//
// `npm run perf:screens` writes every run to LAST_RUN (and its tables, in Markdown for a pull request, to LAST_TABLES).
// `npm run perf:screens:baseline` is the same run followed by `node scripts/perf/screen-report.mjs --promote`, joined with `&&`: the
// step runs only when Playwright exited 0, and it copies LAST_RUN over the baseline only when the run is complete, was measured on a
// checkout with no uncommitted change, and was measured at this checkout's commit (as `npm run perf:api:baseline` does).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addDays, yearDataPlan } from './year-data.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

export const BASELINE = path.join(here, 'screen-baseline.json')
export const LAST_RUN = path.join(root, 'node_modules/.cache/bqr-e2e/perf/last-screen-timing.json')
export const LAST_TABLES = path.join(root, 'node_modules/.cache/bqr-e2e/perf/last-screen-timing.md')

/** Timed visits of each screen, after WARMUPS visits that are not counted. A baseline needs MIN_RUNS. */
export const DEFAULT_RUNS = 10
export const MIN_RUNS = 10
export const WARMUPS = 1
/** A median more than LINE slower than the baseline, and slower by more than LINE_FLOOR_MS, is called out (as perf:scan and perf:api do). */
export const LINE = 0.2
export const LINE_FLOOR_MS = 10

// ---------- the two devices ----------

/**
 * The devices of a run (D5 of the plan, 13/10/2026): Chromium as a phone and as a computer. The phone is the one of `npm run perf:scan`
 * (the network numbers of Lighthouse's "Slow 4G": 150 ms, 1.6 Mbps down, 750 kbps up, "roughly the bottom 25% of 4G connections", applied
 * by the Chrome DevTools Protocol to every request, and CPU x4, Lighthouse's default for a mid-tier phone on a fast computer);
 * tests/perf-screens.test.js keeps the numbers equal to scripts/perf/scan-timing.spec.mjs. The computer is a 1280 x 720 window with no
 * throttling: the speed of the machine that measures. WebKit has no throttling, so there is no iPhone here.
 */
export const PROFILES = Object.freeze({
  phone: Object.freeze({
    key: 'phone',
    label: 'a phone: Pixel 7 screen, Slow 4G (150 ms, 1.6 Mbps down, 750 kbps up) and CPU x4',
    latency: 150,
    down: (1.6 * 1024 * 1024) / 8,
    up: (750 * 1024) / 8,
    cpu: 4,
  }),
  computer: Object.freeze({ key: 'computer', label: 'a computer: 1280 x 720 window, no throttling (the speed of this machine)', latency: 0, down: -1, up: -1, cpu: 1 }),
})
export const PROFILE_KEYS = Object.freeze(Object.keys(PROFILES))

/**
 * The targets, set before the first measurement (D3 of the plan, 13/10/2026), for the p95 of a screen at x1 (a real building's year):
 * the content is shown within 1 s on a computer and within 2.5 s on the throttled phone; the Excel export of a year is a download,
 * not a screen, and has the 5 s of the same decision on a computer. On the phone it has none (`null`, decision of the coordinator,
 * 14/10/2026): the file is 3.4 MB, which the throttled 1.6 Mbps takes about 17.5 s to receive whatever the server does, so the time is
 * bound by the bandwidth and says nothing about the app (docs/testing.md). The report shows the size and the bandwidth instead.
 */
export const TARGET_MS = Object.freeze({
  screen: Object.freeze({ phone: 2500, computer: 1000 }),
  download: Object.freeze({ phone: null, computer: 5000 }),
})

/** The target of a screen on a device, in ms, or null when it has none. */
export const targetFor = (screen, profile) => TARGET_MS[screen.target][profile]

// ---------- the screens ----------

// What each screen says when its data is on it, read from the components in src/admin/views/ (the heading of the screen, its cards or
// its rows). A check is one of
//   { heading: 1 | 2, name }       an <h1> or <h2> whose text is `name`            (getByRole('heading', { level, name, exact: true }))
//   { heading: 1 | 2, pattern }    ... whose text matches the regular expression   (getByRole('heading', { level, name: RegExp }))
//   { role, count? }               at least `count` (1) elements of that role inside <main>: article, listitem or row
//   { label }                      a field with this label                          (getByLabel(label, { exact: true }))
// The same description is turned into a Playwright wait by the spec and into the page-side test by `probe` below, so they cannot differ.
const TITLES = Object.freeze({
  home_week: 'נוכחות ב-7 הימים האחרונים', // HomeView.jsx: the <h2> of the week table (the <h1> is a greeting that follows the hour)
  history: 'היסטוריית נוכחות', // HistoryView.jsx
  points: 'נקודות סריקה', // PointsView.jsx
  providers: 'נותני שירות', // ProvidersView.jsx
  agent: "גישה לאייג'נט", // AgentView.jsx
  settings: 'הגדרות', // SettingsView.jsx
  audit: 'יומן פעולות', // AuditView.jsx
  help: 'איך עובדים עם המערכת', // HelpView.jsx
  building_field: 'שם הבניין', // SettingsView.jsx, BuildingCard: the field that is drawn once the building's details have come
  load_more: 'טעינת עוד', // HistoryView.jsx and AuditView.jsx: the button under a list that has another page
  export: 'ייצוא ל-Excel', // HistoryView.jsx: the link of the export
})
export const SCREEN_TITLES = TITLES

// A list of days: the <h2> of each building day, "DD/MM/YYYY · <rows of that day>" (HistoryView.jsx, AuditView.jsx). Nothing of a list
// is drawn before its page has come, so the first one is the moment the list is on the screen.
const DAY_HEADING = Object.freeze({ heading: 2, pattern: String.raw`^\d{2}\/\d{2}\/\d{4} · \d+$` })

/**
 * The screens of one run, in the order of the run and of the tables. `today` is the building's day of the run (the data ends the day before).
 * Each has
 *   key, words   its name in the tables, and what it is
 *   kind         'navigate': from the start of the navigation to the content;
 *                'more': the page is open, and the time is from the click on "load more" to the next page's rows;
 *                'download': the page is open, and the time is from the click on the export to the finished file
 *   hash         the address (`/admin<hash>`); the page-side probe finds its test by it
 *   ready        the checks that say the content is on the screen (above)
 *   api          the requests that the content waits for (paths, from the components), to split the time into the app's code, the requests
 *                that every screen waits for, the wait for the data and the drawing
 *   rows         what the year of data must show, checked once outside the timing, so that a screen that loaded empty fails loudly:
 *                { role, atLeast } or { role, exactly } elements inside <main>, { lines } lines in the file; null for a screen with no data
 *   click        (more, download) what is clicked, and for 'more' what grows when the next page is drawn
 *   target       'screen' or 'download' (TARGET_MS)
 * @param {string} today  YYYY-MM-DD
 */
export function screensFor(today) {
  const plan = yearDataPlan(1)
  const yearFrom = addDays(today, -364)
  const heading = (key) => ({ heading: 1, name: TITLES[key] })
  const screen = (fields) => Object.freeze({ kind: 'navigate', target: 'screen', ...fields })
  return Object.freeze([
    screen({
      key: 'home',
      words: 'Home: the week table and the cards',
      hash: '#home',
      ready: [{ heading: 2, name: TITLES.home_week }],
      api: ['/api/admin/home'],
      rows: { role: 'row', atLeast: plan.providers },
    }),
    screen({
      key: 'history',
      words: 'History as it opens: the last 7 days, the first 100 visits',
      hash: '#history',
      ready: [heading('history'), DAY_HEADING],
      api: ['/api/admin/scans'],
      rows: { role: 'listitem', atLeast: 100 },
    }),
    screen({
      key: 'history_more',
      words: 'History, "load more" once: from the click to the next 100 visits',
      kind: 'more',
      hash: '#history',
      ready: [heading('history'), DAY_HEADING],
      click: { tag: 'button', name: TITLES.load_more, growth: 'listitem' },
      api: ['/api/admin/scans'],
      rows: { role: 'listitem', atLeast: 200 },
    }),
    screen({
      key: 'history_refused',
      words: 'History, the type "not counted": the refused visits of the last 7 days',
      hash: '#history?outcome=not_counted',
      ready: [DAY_HEADING],
      api: ['/api/admin/scan-refusals'],
      rows: { role: 'listitem', atLeast: 5 },
    }),
    screen({
      key: 'history_csv',
      words: 'History, Excel export of a year: from the click to the finished file (on the phone: the request to the last byte)',
      kind: 'download',
      target: 'download',
      hash: `#history?from=${yearFrom}&to=${today}`,
      ready: [heading('history'), DAY_HEADING],
      click: { tag: 'a', name: TITLES.export },
      api: [],
      rows: { lines: 10_000 },
    }),
    screen({
      key: 'points',
      words: 'Points: a card for each point',
      hash: '#points',
      ready: [heading('points'), { role: 'article' }],
      api: ['/api/admin/points'],
      rows: { role: 'article', exactly: plan.points },
    }),
    screen({
      key: 'providers',
      words: 'Providers: a card for each service provider',
      hash: '#providers',
      ready: [heading('providers'), { role: 'article' }],
      api: ['/api/admin/providers'],
      rows: { role: 'article', exactly: plan.providers },
    }),
    screen({
      key: 'agent',
      words: 'Agent: the keys and their use',
      hash: '#agent',
      ready: [heading('agent'), { role: 'article' }],
      api: ['/api/admin/api-keys'],
      rows: { role: 'article', exactly: plan.agentKeys },
    }),
    screen({
      key: 'settings',
      words: 'Settings: the committee members and the building',
      hash: '#settings',
      ready: [heading('settings'), { role: 'article' }, { label: TITLES.building_field }],
      api: ['/api/admin/admins', '/api/admin/building'],
      rows: { role: 'article', exactly: plan.members },
    }),
    screen({
      key: 'audit',
      words: 'Audit log as it opens, with no date: the first 50 entries',
      hash: '#audit',
      ready: [heading('audit'), DAY_HEADING],
      api: ['/api/admin/audit'],
      rows: { role: 'listitem', atLeast: 50 },
    }),
    screen({
      key: 'help',
      words: 'Help: a screen with no data (what the shell alone costs)',
      hash: '#help',
      ready: [heading('help')],
      api: [],
      rows: null,
    }),
  ])
}

/** The requests that every screen waits for before the shell draws it: who is signed in, and what the sign-in screen needs. */
export const BOOT_API = Object.freeze(['/api/admin/me', '/api/admin/config'])

/**
 * What the probe is given: for each address, the checks that say the content is on the screen and the clicks to note. Two screens that
 * share an address (the History as it opens, with and without "load more") must agree on their checks.
 * @param {ReadonlyArray<ReturnType<typeof screensFor>[number]>} screens
 */
export function probeConfig(screens) {
  const byHash = {}
  for (const s of screens) {
    byHash[s.hash] ??= { ready: s.ready, clicks: [] }
    if (JSON.stringify(byHash[s.hash].ready) !== JSON.stringify(s.ready)) throw new Error(`The screens at ${s.hash} disagree about what "loaded" is`)
    if (s.click) byHash[s.hash].clicks.push({ ...s.click })
  }
  return byHash
}

// ---------- the page-side probe ----------

/**
 * Runs in the page before its own scripts (page.addInitScript), so it must stand alone. For the address the page was opened at, it
 * records in `globalThis.__perf` (ms from the start of the navigation, `performance.now()`):
 *   ready        the first moment when every check of the screen holds: a MutationObserver sees the content come into the DOM, so
 *                Playwright's own polling adds nothing (as in scripts/perf/scan-timing.spec.mjs). It is the time of the DOM, one frame
 *                (and under CPU x4 a few) before the pixels.
 *   click        the click on a button or link of the screen's `clicks` (matched by its tag and its name: the aria-label, or its text),
 *                and `clickEpoch`, the same moment as a clock time, for a download that Node waits for
 *   before, done for a click with `growth`: how many elements of that role were there at the click, and the first moment when there are more
 * @param {{ scenarios: Record<string, { ready: any[], clicks: any[] }> }} config  probeConfig() of the screens
 */
export function probe({ scenarios }) {
  const marks = {}
  Object.defineProperty(globalThis, '__perf', { value: marks, configurable: true })
  const scenario = scenarios[globalThis.location.hash]
  if (!scenario) return
  const doc = globalThis.document
  const SELECTOR = { article: 'main article', listitem: 'main li', row: 'main tr' }
  const count = (role) => doc.querySelectorAll(SELECTOR[role]).length
  const holds = (check) => {
    if (check.heading) {
      const pattern = check.pattern === undefined ? null : new RegExp(check.pattern)
      return [...doc.querySelectorAll(`h${check.heading}`)].some((h) => {
        const text = (h.textContent ?? '').trim()
        return pattern ? pattern.test(text) : text === check.name
      })
    }
    if (check.role) return count(check.role) >= (check.count ?? 1)
    return [...doc.querySelectorAll('label')].some((l) => (l.textContent ?? '').trim() === check.label && l.control !== null)
  }
  const look = () => {
    const now = performance.now()
    if (marks.ready === undefined && scenario.ready.every(holds)) marks.ready = now
    if (marks.before !== undefined && marks.done === undefined && count(marks.growth) > marks.before) marks.done = now
  }
  new globalThis.MutationObserver(look).observe(doc, { subtree: true, childList: true, characterData: true })
  doc.addEventListener(
    'click',
    (event) => {
      const element = event.target instanceof globalThis.Element ? event.target.closest('button, a') : null
      if (!element || marks.click !== undefined) return
      const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()
      const rule = scenario.clicks.find((c) => c.tag === element.tagName.toLowerCase() && c.name === name)
      if (!rule) return
      marks.click = performance.now()
      marks.clickEpoch = performance.timeOrigin + marks.click
      if (rule.growth) {
        marks.growth = rule.growth
        marks.before = count(rule.growth)
      }
    },
    true,
  )
}

// ---------- numbers ----------

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/**
 * One visit of a screen as the spec records it:
 *   ms        the time that the screen is judged by (above)
 *   code      from the start to the app's first request: its code loaded (from the service worker), parsed and run, or null
 *   boot      from there to the end of the requests that every screen waits for (who is signed in), or null
 *   wait      from there to the end of the last request that the content waits for, or null
 *   draw      from there to the content in the DOM: the browser's own work, or null
 *   requests, api, bytes   the requests that finished (and those to the API), and the bytes that crossed the network
 * @typedef {{ ms: number, code: number | null, boot: number | null, wait: number | null, draw: number | null, requests: number, api: number, bytes: number }} Visit
 */

/**
 * The median, the p95 (nearest rank: with 10 visits, the slowest), the fastest and the slowest of the visits of one screen, in whole ms,
 * the times of the visits in the order they were made (`samples`, so that a slow one can be told: the first after the warm-up is a cold
 * start, another is a visit that went slow by itself), the median of each part of the time, and the most requests and bytes of any visit.
 * @param {Visit[]} visits  in the order of the run
 */
export function summary(visits) {
  const samples = visits.map((v) => Math.round(v.ms))
  const ms = [...samples].sort((a, b) => a - b)
  const part = (key) => (visits.every((v) => v[key] === null || v[key] === undefined) ? null : median(visits.map((v) => Math.round(v[key] ?? 0))))
  const most = (key) => Math.max(...visits.map((v) => v[key] ?? 0))
  return {
    n: ms.length,
    median: median(ms),
    p95: ms[Math.ceil(0.95 * ms.length) - 1],
    min: ms[0],
    max: ms[ms.length - 1],
    samples,
    code: part('code'),
    boot: part('boot'),
    wait: part('wait'),
    draw: part('draw'),
    requests: most('requests'),
    api: most('api'),
    bytes: most('bytes'),
  }
}

/**
 * A screen measured now against the same screen in the baseline and against its target: `{ overTarget, medianOver, change, overLine }`.
 * `overTarget` is the p95 over the target (as perf:api judges); `medianOver` is the median over it too, which is more than one slow visit
 * (with 10 visits the p95 is the slowest one). `change` is the change of the median (0.25 is 25% slower), null without a baseline. A median
 * is over the line when it is more than LINE slower and more than LINE_FLOOR_MS slower.
 * @param {{ median: number, p95: number }} now
 * @param {{ median: number } | null | undefined} before
 * @param {number | null} target  ms, or null for a screen that has none (nothing is over it)
 */
export function judge(now, before, target) {
  const overTarget = target !== null && now.p95 > target
  const medianOver = target !== null && now.median > target
  if (!before || !(before.median > 0)) return { overTarget, medianOver, change: null, overLine: false }
  const change = (now.median - before.median) / before.median
  return { overTarget, medianOver, change, overLine: change > LINE && now.median - before.median > LINE_FLOOR_MS }
}

// ---------- the baseline ----------

/** The short commit of this checkout, or null outside git. */
export function headCommit(cwd = root) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Whether this checkout has changes to tracked files that are not committed (a baseline must name the code it measured). */
export function isDirty(cwd = root) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' }).trim() !== ''
  } catch {
    return true
  }
}

/** The keys of the screens, which do not depend on the day. */
export const SCREEN_KEYS = Object.freeze(screensFor('2030-01-01').map((s) => s.key))

/**
 * Why `run` (what a run wrote to LAST_RUN) cannot be the baseline, or null when it can: at least MIN_RUNS visits of every screen on both
 * devices, with the year of data counted, measured on a checkout with no uncommitted change.
 * @param {any} run
 */
export function whyNotABaseline(run) {
  if (!run || typeof run !== 'object') return 'there is no run to take'
  if (!Number.isInteger(run.runs) || run.runs < MIN_RUNS) return `a baseline needs at least ${MIN_RUNS} runs of every screen, and this one made ${run.runs}`
  if (run.dirty !== false) return 'the run measured a checkout with changes that are not committed'
  if (!(run.data?.scans > 0)) return 'the run does not say how much data it measured'
  for (const profile of PROFILE_KEYS) {
    for (const key of SCREEN_KEYS) {
      const n = run.results?.[profile]?.[key]?.n ?? 0
      if (n !== run.runs) return `${profile} ${key} has ${n} of ${run.runs} runs`
    }
  }
  return null
}

/**
 * Makes the last run the baseline, or says why not. Returns { written: true } or { written: false, reason }.
 * @param {{ last?: string, baseline?: string, commit?: string | null }} [where]
 */
export function acceptBaseline({ last = LAST_RUN, baseline = BASELINE, commit = headCommit() } = {}) {
  if (!fs.existsSync(last)) return { written: false, reason: `there is no last run (${last}): run npm run perf:screens:baseline` }
  let run
  try {
    run = JSON.parse(fs.readFileSync(last, 'utf8'))
  } catch {
    return { written: false, reason: 'the last run is not readable JSON' }
  }
  const reason = whyNotABaseline(run)
  if (reason) return { written: false, reason }
  if (!commit || run.commit !== commit) return { written: false, reason: `the last run measured ${run.commit}, and this checkout is at ${commit}` }
  fs.writeFileSync(baseline, `${JSON.stringify(run, null, 2)}\n`)
  return { written: true }
}

/** The computer that measures, for the run and for the note when a baseline came from another one. */
export const machine = () => ({ cpu: os.cpus()[0]?.model?.trim() ?? 'unknown', cores: os.cpus().length, platform: `${os.platform()} ${os.release()}` })

// ---------- the report ----------

const pad = (text, width, right = false) => (right ? String(text ?? '-').padStart(width) : String(text ?? '-').padEnd(width))
const kb = (bytes) => (bytes < 10 * 1024 ? (bytes / 1024).toFixed(1) : String(Math.round(bytes / 1024)))
const n = (value) => value.toLocaleString('en-US')

/**
 * The notes of a screen on a device: over its target (the median too, or the visits that were, and which was the slowest: visit 1 is the
 * first after the warm-up, a cold start; another is a visit that went slow by itself), the bandwidth that binds a screen with no
 * target, over the line.
 * @param {ReturnType<typeof judge>} verdict
 * @param {ReturnType<typeof summary>} r
 * @param {string} profile
 * @param {number | null} target
 */
function notesOf(verdict, r, profile, target) {
  const notes = []
  if (verdict.overTarget) {
    const samples = r.samples ?? []
    const slowest = samples.indexOf(Math.max(...samples)) + 1
    const over = samples.filter((ms) => ms > target).length
    const which = slowest === 1 ? 'visit 1, the first after the warm-up' : `visit ${slowest}`
    notes.push(
      verdict.medianOver
        ? 'OVER TARGET (the median too)'
        : `OVER TARGET (the median is within it; ${over} of ${r.n} visits over, the slowest is ${samples.length ? which : 'unknown'})`,
    )
  }
  if (target === null) notes.push(`bound by the throttled bandwidth: ${Math.round(r.bytes / 1024)} KB at ${(PROFILES[profile].down * 8) / (1024 * 1024)} Mbps`)
  if (verdict.overLine) notes.push('OVER THE 20% LINE')
  return notes
}

/** The screens of a run on one device that are over their target (the p95; none for a screen with no target), by key. */
export function overTarget(run, profile, screens) {
  return screens.filter((s) => run.results?.[profile]?.[s.key] && targetFor(s, profile) !== null && run.results[profile][s.key].p95 > targetFor(s, profile)).map((s) => s.key)
}

/** The lines that the run prints, for a person. `screens` is screensFor(the day of the run). */
export function reportLines(run, baseline, screens) {
  const lines = [`Screen timing at ${run.commit ?? 'this checkout'}${run.dirty ? ' (with uncommitted changes)' : ''}, ${run.runs} visits of each screen after ${WARMUPS} warm-up (ms, on this computer):`]
  if (baseline && baseline.machine?.cpu !== run.machine.cpu) {
    lines.push(`  note: the baseline was measured on another computer (${baseline.machine?.cpu}); compare runs of one computer only`)
  }
  const k = run.data
  if (k) lines.push(`  the data: ${n(k.scans)} visits, ${n(k.refusals)} refused visits, ${n(k.audit)} audit entries, ${k.points} points, ${k.providers} providers (x1, a real building's year)`)
  for (const profile of PROFILE_KEYS) {
    if (!run.results?.[profile]) continue
    lines.push(`  ${PROFILES[profile].label}`)
    lines.push(
      `    ${pad('screen', 17)}${pad('median', 8, true)}${pad('p95', 8, true)}${pad('target', 8, true)}${pad('code', 7, true)}${pad('boot', 7, true)}${pad('data', 7, true)}${pad('draw', 7, true)}${pad('req', 5, true)}${pad('KB', 7, true)}  baseline`,
    )
    for (const s of screens) {
      const r = run.results[profile][s.key]
      if (!r) continue
      const before = baseline?.results?.[profile]?.[s.key]
      const verdict = judge(r, before, targetFor(s, profile))
      const compared = before ? `${before.median} (${verdict.change >= 0 ? '+' : ''}${Math.round(verdict.change * 100)}%)` : '-'
      const notes = notesOf(verdict, r, profile, targetFor(s, profile))
      lines.push(
        `    ${pad(s.key, 17)}${pad(r.median, 8, true)}${pad(r.p95, 8, true)}${pad(targetFor(s, profile), 8, true)}${pad(r.code, 7, true)}${pad(r.boot, 7, true)}${pad(r.wait, 7, true)}${pad(r.draw, 7, true)}` +
          `${pad(r.requests, 5, true)}${pad(kb(r.bytes), 7, true)}  ${compared}${notes.length ? `  ${notes.join('; ')}` : ''}`,
      )
    }
  }
  lines.push(
    "  code: the start to the app's first request (its code loaded from the service worker, parsed and run); boot: from there to the end of the requests that every screen",
    '  waits for (who is signed in); data: from there to the end of the last request the content waits for; draw: from there to the content in the DOM. Medians, in ms.',
  )
  const over = PROFILE_KEYS.flatMap((profile) => overTarget(run, profile, screens).map((key) => `${profile} ${key}`))
  lines.push(over.length ? `Over the target (p95): ${over.join(', ')}.` : 'Every screen is within its target.')
  if (lines.some((line) => line.includes('OVER THE 20% LINE'))) {
    lines.push('Once over the line can be noise: run it again. A median over the line in two runs in a row is a regression (docs/testing.md).')
  }
  const reason = whyNotABaseline(run)
  lines.push(reason ? `This run cannot be the baseline: ${reason}.` : 'To make a run the baseline: npm run perf:screens:baseline (it writes only after the whole run passed).')
  lines.push(`The run: ${path.relative(process.cwd(), LAST_RUN)}; its tables in Markdown: ${path.relative(process.cwd(), LAST_TABLES)}`)
  return lines
}

/** The tables of a run in Markdown, one for each device, for a pull request. */
export function markdownTables(run, baseline, screens) {
  const out = []
  for (const profile of PROFILE_KEYS) {
    if (!run.results?.[profile]) continue
    out.push(`#### ${PROFILES[profile].label}`, '', '| Screen | What it is | Median ms | p95 ms | Target ms | Code ms | Boot ms | Data ms | Draw ms | Requests | KB | Notes |', '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|')
    for (const s of screens) {
      const r = run.results[profile][s.key]
      if (!r) continue
      const verdict = judge(r, baseline?.results?.[profile]?.[s.key], targetFor(s, profile))
      out.push(`| \`${s.key}\` | ${s.words} | ${r.median} | ${r.p95} | ${targetFor(s, profile) ?? '-'} | ${r.code ?? '-'} | ${r.boot ?? '-'} | ${r.wait ?? '-'} | ${r.draw ?? '-'} | ${r.requests} | ${kb(r.bytes)} | ${notesOf(verdict, r, profile, targetFor(s, profile)).join('; ')} |`)
    }
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

// ---------- the command line ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.slice(2).join() !== '--promote') {
    console.error('Usage: node scripts/perf/screen-report.mjs --promote   (npm run perf:screens:baseline runs it after a run that passed)')
    process.exitCode = 1
  } else {
    const result = acceptBaseline()
    if (result.written) {
      console.log(`written as the new baseline: ${path.relative(process.cwd(), BASELINE)} (commit it with the change that explains it)`)
    } else {
      console.error(`NOT written as the baseline: ${result.reason}. The baseline stays as it was.`)
      process.exitCode = 1
    }
  }
}
