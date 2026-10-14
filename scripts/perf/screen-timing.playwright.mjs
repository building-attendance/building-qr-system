// How long the committee's screens take to show their content on a year of data: `npm run perf:screens` (docs/testing.md, "Timing the
// committee's screens"). A measurement, not a test of what is right, so it is not part of `npm run test:e2e`, of CI or of `npm run
// perf:scan`: the timings of a shared CI runner are noise. (The file is not called *.spec.mjs on purpose: playwright.perf.config.js
// runs every *.spec.mjs of this folder, and the scan timing must not run this.) What is made of numbers is in screen-report.mjs.
//
// The data is T1's year (scripts/perf/year-data.mjs, x1: about 14,600 visits, 730 refused visits, 3,000 audit entries) in the scratch
// schema `perf_screens`, served by the local API. For each device (a phone with Slow 4G and CPU x4, and a computer with no throttling):
//   - one committee member signs in with the dev-only shortcut of the local server (once, with no throttling), and the service worker
//     takes the page over, as it does for a member who has used the app before;
//   - for each screen, one visit that is not counted (and that checks that the screen shows the year of data), then RUNS visits (PERF_RUNS,
//     10 by default): about:blank, then a fresh navigation to the screen, so that nothing of the screen's state is left;
//   - the time is taken inside the page with performance.now(): from the start of the navigation to the moment the screen's content is in
//     the DOM (a MutationObserver, screen-report.mjs `probe`), or, for "load more" and the export, from the click.
// Each visit also records where the time went, from the Resource Timing of the page: the shell's start (the requests every screen waits for),
// the wait for the screen's own data, and the drawing after the last byte (the browser's own work).
//
// The run prints both tables, compares each median with scripts/perf/screen-baseline.json, and writes itself to
// node_modules/.cache/bqr-e2e/perf/last-screen-timing.json (and its tables in Markdown, for a pull request). It never writes the baseline:
// `npm run perf:screens:baseline` does, after the whole run passed (screen-report.mjs).
//
// What it cannot show: the time of Vercel and Neon (the API and the database run on this computer, and the latency of the profile stands
// for the distance), a first visit with an empty cache, Safari (WebKit has no throttling) and a real phone's processor.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { devices } from '@playwright/test'
import { test, expect, SCREEN_TITLES as PAGE_TITLES } from '../../e2e/fixtures.js'
import { loadEnv } from '../../server/loadEnv.js'
import { assertNotProduction } from '../../server/dbGuard.js'
import { normalizeConnectionString } from '../../server/db.js'
import { e2eSettings } from '../e2e-config.mjs'
import { isoDay } from '../../shared/datetime.js'
import { YEAR_DATA_MEMBER_EMAIL, assertYearDataSchema, countYearData } from './year-data.mjs'
import {
  BASELINE, BOOT_API, DEFAULT_RUNS, LAST_RUN, LAST_TABLES, PROFILES, PROFILE_KEYS, SCREEN_TITLES, WARMUPS, headCommit, isDirty, machine, markdownTables,
  probe, probeConfig, reportLines, screensFor, summary, targetFor, TARGET_MS,
} from './screen-report.mjs'

const RUNS = Number(process.env.PERF_RUNS || DEFAULT_RUNS)
const TODAY = isoDay(new Date())
const SCREENS = screensFor(TODAY)
const DEVICE = { phone: devices['Pixel 7'], computer: devices['Desktop Chrome'] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- the results -------------------------------------------------------------------------------------------------------

/** results[profile][screen] = [Visit, ...] (screen-report.mjs) */
const results = {}
const record = (profile, key, visit) => {
  results[profile] ??= {}
  ;(results[profile][key] ??= []).push(visit)
}
let chromium = 'unknown'

// Every run starts without a last run, so that `npm run perf:screens:baseline` can never take one from before.
test.beforeAll(() => fs.rmSync(LAST_RUN, { force: true }))

/** How many rows of each kind the year of data holds, read from the scratch schema before the run ends (counts only). */
async function countTheData() {
  loadEnv()
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!connectionString) return null
  const schema = assertYearDataSchema(e2eSettings().schema)
  const pool = new pg.Pool({ connectionString: normalizeConnectionString(connectionString), options: `-c search_path=${schema}`, max: 1 })
  try {
    await assertNotProduction(pool)
    return await countYearData(pool)
  } finally {
    await pool.end()
  }
}

test.afterAll(async () => {
  if (!Object.keys(results).length) return
  const run = {
    commit: headCommit(),
    dirty: isDirty(),
    measuredAt: new Date().toISOString(),
    runs: RUNS,
    warmups: WARMUPS,
    machine: { ...machine(), chromium },
    data: await countTheData(),
    targets: TARGET_MS,
    profiles: Object.fromEntries(PROFILE_KEYS.map((key) => [key, PROFILES[key].label])),
    results: Object.fromEntries(Object.entries(results).map(([profile, screens]) => [profile, Object.fromEntries(Object.entries(screens).map(([key, visits]) => [key, summary(visits)]))])),
  }
  fs.mkdirSync(path.dirname(LAST_RUN), { recursive: true })
  fs.writeFileSync(LAST_RUN, `${JSON.stringify(run, null, 2)}\n`)
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null
  fs.writeFileSync(LAST_TABLES, markdownTables(run, baseline, SCREENS))
  console.log(`\n${reportLines(run, baseline, SCREENS).join('\n')}`)
})

// ---- the browser -------------------------------------------------------------------------------------------------------

/** Throttles this page: the network of the profile on every request, and its CPU. Not for the computer, which is not throttled. */
async function throttle(page, profile) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
}

/**
 * Counts the requests of the page and the bytes that crossed the network, from `start()` on, and knows when none is on its way.
 * A request belongs to the sample that was open when it finished, even though its size is known only a moment later, and `read()` waits.
 */
function traffic(page) {
  let counts = { requests: 0, api: 0, bytes: 0 }
  let pending = []
  let inFlight = 0
  page.on('request', () => inFlight++)
  page.on('requestfailed', () => (inFlight = Math.max(0, inFlight - 1)))
  page.on('requestfinished', (request) => {
    inFlight = Math.max(0, inFlight - 1)
    const sample = counts
    sample.requests++
    if (new URL(request.url()).pathname.startsWith('/api/')) sample.api++
    pending.push(
      (async () => {
        const sizes = await request.sizes().catch(() => null)
        const response = await request.response().catch(() => null)
        if (sizes && !response?.fromServiceWorker()) sample.bytes += sizes.responseBodySize + sizes.responseHeadersSize
      })(),
    )
  })
  return {
    start: () => {
      counts = { requests: 0, api: 0, bytes: 0 }
      pending = []
      inFlight = 0
    },
    /** Resolves when no request has been on its way for a moment (the screen has asked for everything it needs), or after 30 s. */
    idle: async () => {
      const deadline = Date.now() + 30_000
      let quietSince = null
      while (Date.now() < deadline) {
        if (inFlight === 0) {
          quietSince ??= Date.now()
          if (Date.now() - quietSince >= 250) return
        } else quietSince = null
        await sleep(25)
      }
    },
    read: async () => {
      const sample = counts
      await Promise.all(pending)
      return { ...sample }
    },
  }
}

/** The Playwright wait for one check of a screen (screen-report.mjs): the same description that `probe` tests in the page. */
function locatorOf(page, check) {
  if (check.heading) {
    const name = check.pattern === undefined ? { name: check.name, exact: true } : { name: new RegExp(check.pattern) }
    return page.getByRole('heading', { level: check.heading, ...name }).first()
  }
  if (check.role) return page.getByRole('main').getByRole(check.role).first()
  return page.getByLabel(check.label, { exact: true })
}

async function waitForContent(page, screen) {
  for (const check of screen.ready) {
    await expect(locatorOf(page, check), `${screen.key}: ${JSON.stringify(check)}`).toBeVisible({ timeout: 60_000 })
  }
}

/** What the page-side probe marked, and the API requests of this document with the time each one ended (Resource Timing). */
const readPage = (page) =>
  page.evaluate(() => ({
    marks: { ...globalThis.__perf },
    api: globalThis.performance
      .getEntriesByType('resource')
      .map((e) => ({ path: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd }))
      .filter((e) => e.path.startsWith('/api/')),
  }))

const latest = (entries, paths, after = 0) => entries.filter((e) => paths.includes(e.path) && e.start >= after).reduce((last, e) => Math.max(last, e.end), 0)

/** The year of data is what the screen shows (checked once for each screen, outside the timing): not an empty screen, not the sample data. */
async function checkRows(page, screen) {
  const { rows } = screen
  if (!rows) return
  if (rows.lines) return
  const found = page.getByRole('main').getByRole(rows.role)
  if (rows.exactly !== undefined) await expect(found, `${screen.key} shows ${rows.exactly} ${rows.role}s`).toHaveCount(rows.exactly)
  else await expect.poll(() => found.count(), { message: `${screen.key} shows at least ${rows.atLeast} ${rows.role}s` }).toBeGreaterThanOrEqual(rows.atLeast)
}

/**
 * One visit of a screen: about:blank first, so that nothing of the last visit is left (the page, its state and the cache of the committee
 * app's answers are new), then the navigation. Returns the Visit of screen-report.mjs.
 */
async function visit(committee, screen, { first = false } = {}) {
  const { page, meter } = committee
  await page.goto('about:blank')
  meter.start()
  await page.goto(`/admin${screen.hash}`)
  await waitForContent(page, screen)
  await meter.idle()
  let seen = await readPage(page)
  if (seen.marks.ready === undefined) throw new Error(`${screen.key}: Playwright saw the content, the page-side probe did not (${JSON.stringify(seen.marks)})`)

  if (screen.kind === 'navigate') {
    if (first) await checkRows(page, screen)
    // The app asks for who is signed in as soon as its code has run; the screen asks for its data when the answer is in; then it draws.
    const asked = Math.min(...seen.api.filter((e) => BOOT_API.includes(e.path)).map((e) => e.start))
    const boot = latest(seen.api, BOOT_API)
    const dataEnd = Math.max(boot, latest(seen.api, screen.api))
    const ready = seen.marks.ready
    return { ms: ready, code: asked, boot: boot - asked, wait: Math.max(0, dataEnd - boot), draw: Math.max(0, ready - dataEnd), ...(await meter.read()) }
  }

  if (screen.kind === 'more') {
    meter.start() // the requests of the click alone
    await page.getByRole('button', { name: SCREEN_TITLES.load_more, exact: true }).click()
    await page.waitForFunction(() => globalThis.__perf.done !== undefined, null, { timeout: 60_000 })
    await meter.idle()
    seen = await readPage(page)
    if (first) await checkRows(page, screen)
    const { click, done } = seen.marks
    const dataEnd = Math.min(done, Math.max(click, latest(seen.api, screen.api, click)))
    return { ms: done - click, code: null, boot: null, wait: dataEnd - click, draw: done - dataEnd, ...(await meter.read()) }
  }

  // The export. The DevTools network conditions do not slow Chromium's download manager (measured on 13/10/2026: a 3.4 MB file took the same
  // 0.3 s on the phone as on the computer), so on the throttled phone the page asks for the address of the link itself and reads the
  // answer to the last byte, from the request to the end, which is what its network would take.
  if (committee.throttled) {
    const address = await page.getByRole('link', { name: SCREEN_TITLES.export, exact: true }).getAttribute('href')
    expect(address, `${screen.key}: the address of the link`).toMatch(/^\/api\/admin\/scans\?/) // the local API, a path and not an address
    const got = await page.evaluate(
      async ({ address, count }) => {
        const started = globalThis.performance.now()
        const response = await globalThis.fetch(address)
        const body = new Uint8Array(await response.arrayBuffer())
        const ms = globalThis.performance.now() - started
        let lines = 0
        if (count) for (const byte of body) if (byte === 10) lines++
        return { ms, status: response.status, bytes: body.length, lines }
      },
      { address, count: first },
    )
    expect(got.status, `${screen.key}: the answer`).toBe(200)
    if (first) expect(got.lines, `${screen.key}: the lines of the file`).toBeGreaterThanOrEqual(screen.rows.lines)
    return { ms: got.ms, code: null, boot: null, wait: null, draw: null, requests: 1, api: 1, bytes: got.bytes }
  }

  // On the computer, as a person does it: the click on the link until the file is on the disk. The clock is the page's for the click and
  // this process's for the end (one computer, so one clock).
  const downloading = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('link', { name: SCREEN_TITLES.export, exact: true }).click()
  const download = await downloading
  const file = await download.path()
  const finished = Date.now()
  const { marks } = await readPage(page)
  if (marks.clickEpoch === undefined) throw new Error(`${screen.key}: the probe did not see the click on the export`)
  const bytes = fs.statSync(file).size
  if (first) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length
    expect(lines, `${screen.key}: the lines of the file`).toBeGreaterThanOrEqual(screen.rows.lines)
  }
  return { ms: finished - marks.clickEpoch, code: null, boot: null, wait: null, draw: null, requests: 1, api: 1, bytes }
}

/** A new browser context for one device: signed in as the committee member of the data, with the service worker in charge. */
async function openCommittee(browser, baseURL, profile) {
  const context = await browser.newContext({ ...DEVICE[profile.key], baseURL, timezoneId: 'Asia/Jerusalem', acceptDownloads: true })
  const page = await context.newPage()
  await page.addInitScript(probe, { scenarios: probeConfig(SCREENS) })

  await page.goto('/admin')
  // The first load of /admin is answered 401 by /me, before the sign-in (e2e/a11y.spec.js allows the same): the guard starts after it.
  await page.getByLabel('אימייל אדמין לפיתוח').fill(YEAR_DATA_MEMBER_EMAIL)
  await page.getByRole('button', { name: 'כניסת פיתוח' }).click()
  await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLES.home })).toBeVisible()
  const errors = []
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.evaluate(() => globalThis.navigator.serviceWorker.ready)
  // The service worker serves the app from the next navigation on (a member who has used the app before); only the API goes to the network.
  await page.goto('about:blank')
  await page.goto('/admin#home')
  await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLES.home })).toBeVisible()
  expect(await page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller)), 'the service worker serves the app').toBe(true)

  const throttled = profile.cpu > 1 || profile.latency > 0
  if (throttled) await throttle(page, profile)
  return { context, page, errors, throttled, meter: traffic(page) }
}

// ---- the visits --------------------------------------------------------------------------------------------------------

for (const profile of PROFILE_KEYS.map((key) => PROFILES[key])) {
  test.describe(profile.key, () => {
    // One member signed in for all the screens of a device, in order: the first that fails stops the rest (a partial run is no baseline).
    test.describe.configure({ mode: 'serial' })
    let committee

    test.beforeAll(async ({ browser }, testInfo) => {
      chromium = browser.version()
      committee = await openCommittee(browser, testInfo.project.use.baseURL, profile)
    })
    test.afterAll(async () => {
      await committee?.context.close()
      expect(committee?.errors, `console errors on the ${profile.key}`).toEqual([])
    })

    for (const screen of SCREENS) {
      const target = targetFor(screen, profile.key)
      test(`${screen.key}: ${screen.words} (${target === null ? 'no target' : `target ${target} ms`})`, async () => {
        await visit(committee, screen, { first: true })
        for (let run = 0; run < RUNS; run++) record(profile.key, screen.key, await visit(committee, screen))
      })
    }
  })
}
