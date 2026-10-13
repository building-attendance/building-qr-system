// How long the service provider's scan takes on a phone: `npm run perf:scan` (docs/testing.md, "Timing a scan").
//
// Three journeys at the point that requires the location (every point of a real building does, since #158):
//   daily      a provider who signed in on this phone before scans the sign: from the start of the navigation to the
//              heading "the visit was recorded". The service worker serves the app; only the API goes to the network.
//   first      a phone that never opened the app: from the start of the navigation to the list of names (when the person
//              can act), then from the tap on "sign in" to the heading "the visit was recorded".
//   offline    the daily journey with no reception: from the start of the navigation to the heading "saved on the phone".
// Each runs RUNS times (PERF_RUNS, 10 by default) in each profile below. A time is taken inside the page with
// performance.now() (a MutationObserver sees the heading come into the DOM), so Playwright's own polling adds nothing.
//
// The run prints the median, the p95, the requests and the bytes of each journey, compares each median with
// scripts/perf/scan-baseline.json, and writes itself to node_modules/.cache/bqr-e2e/perf/last-scan-timing.json.
// PERF_UPDATE_BASELINE=1 makes the run the new baseline: commit it with the change that explains it.
//
// What it cannot show: a real phone's GPS (the browser here answers at once), the server's own time on Vercel and Neon (the
// API runs on this computer; the latency of the profile stands for the distance), and Safari (WebKit has no throttling).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { devices } from '@playwright/test'
import { test, expect, he, POINTS, PEOPLE, SAMPLE_POINT, OFFLINE_NOISE, signIn, clearScans, allowConsoleErrors } from '../../e2e/fixtures.js'

const RUNS = Number(process.env.PERF_RUNS || 10)
const POINT = POINTS.gym // location required, assigned to Ploni
const scanLink = `/scan?code=${POINT}`
const NEAR = { latitude: SAMPLE_POINT.lat, longitude: SAMPLE_POINT.lng, accuracy: 10 }
const QUEUE_KEY = 'qr.queue.v1'
const BASELINE = path.join(import.meta.dirname, 'scan-baseline.json')
const LAST = path.resolve(import.meta.dirname, '../../node_modules/.cache/bqr-e2e/perf/last-scan-timing.json')
// A median more than this much slower than the baseline is called out (docs/testing.md, "Timing a scan").
const LINE = 0.2

// The network numbers of Lighthouse's "Slow 4G" (docs/throttling.md of GoogleChrome/lighthouse: 150 ms, 1.6 Mbps down,
// 750 kbps up, "roughly the bottom 25% of 4G connections"), applied the simple way: the Chrome DevTools Protocol adds the
// latency to every request. CPU x4 is Lighthouse's default for a mid-tier phone on a fast computer.
const PROFILES = [
  { key: 'slow-4g', label: 'Slow 4G (150 ms, 1.6 Mbps down, 750 kbps up) and CPU x4', latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
  { key: 'unthrottled', label: 'no throttling (the speed of this computer)', latency: 0, down: -1, up: -1, cpu: 1 },
]

const TITLES = {
  list: he['login.title'],
  success: he['checkin.success.title'],
  queued: he['checkin.queued.title'],
}

/** Runs in the page before its own scripts: records when each heading, and the first name of the list, comes into the DOM. */
function probe({ titles, submit }) {
  const marks = {}
  Object.defineProperty(globalThis, '__perf', { value: marks }) // globalThis is the window: this runs in the page
  const look = () => {
    for (const heading of globalThis.document.querySelectorAll('h1, h2')) {
      const text = heading.textContent ?? ''
      for (const [key, title] of Object.entries(titles)) if (marks[key] === undefined && text.includes(title)) marks[key] = performance.now()
    }
    // The list of names of the sign-in screen (src/worker/components.jsx); while it loads, a placeholder div stands there.
    if (marks.names === undefined && globalThis.document.querySelector('ul.w-list button')) marks.names = performance.now()
  }
  new globalThis.MutationObserver(look).observe(globalThis.document, { subtree: true, childList: true, characterData: true })
  globalThis.document.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof globalThis.Element ? event.target.closest('button') : null
      if (button && button.textContent?.trim() === submit) marks.submit = performance.now()
    },
    true,
  )
}

/** Throttles this page's CPU, and its network unless `network` is false (offline uses the context's own switch). */
async function throttle(page, profile, { network = true } = {}) {
  const cdp = await page.context().newCDPSession(page)
  if (network) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.down,
      uploadThroughput: profile.up,
    })
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
}

/** Counts the requests of the page and the bytes that crossed the network, from `start()` on. */
function traffic(page) {
  let counts = { requests: 0, api: 0, bytes: 0 }
  page.on('requestfinished', async (request) => {
    counts.requests++
    if (new URL(request.url()).pathname.startsWith('/api/')) counts.api++
    const sizes = await request.sizes().catch(() => null)
    if (sizes && !(await request.response())?.fromServiceWorker()) counts.bytes += sizes.responseBodySize + sizes.responseHeadersSize
  })
  return {
    start: () => (counts = { requests: 0, api: 0, bytes: 0 }),
    read: () => ({ ...counts }),
  }
}

const marks = (page) => page.evaluate(() => ({ ...globalThis.__perf }))

// ---- the results -------------------------------------------------------------------------------------------------------

/** results[profile][metric] = [{ ms, requests, api, bytes }, ...] */
const results = {}
const record = (profile, metric, ms, counts = {}) => {
  results[profile.key] ??= {}
  ;(results[profile.key][metric] ??= []).push({ ms: Math.round(ms), ...counts })
}

function summary(samples) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b)
  const middle = Math.floor(ms.length / 2)
  const median = ms.length % 2 ? ms[middle] : Math.round((ms[middle - 1] + ms[middle]) / 2)
  const p95 = ms[Math.ceil(0.95 * ms.length) - 1] // nearest rank: with 10 runs, the slowest
  const most = (key) => Math.max(...samples.map((s) => s[key] ?? 0))
  return { n: ms.length, median, p95, min: ms[0], max: ms.at(-1), requests: most('requests'), api: most('api'), bytes: most('bytes') }
}

const METRICS = {
  daily: 'daily scan, signed in: navigation to "recorded"',
  first_list: 'first scan on a new phone: navigation to the list of names',
  first_checkin: 'first scan on a new phone: "sign in" tap to "recorded"',
  offline: 'no reception: navigation to "saved on the phone"',
}

const commit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
const machine = () => ({ cpu: os.cpus()[0]?.model?.trim() ?? 'unknown', cores: os.cpus().length, platform: `${os.platform()} ${os.release()}` })

test.afterAll(() => {
  if (!Object.keys(results).length) return
  const run = {
    commit: commit(),
    measuredAt: new Date().toISOString(),
    runs: RUNS,
    point: 'location required (POINTS.gym of the sample data)',
    machine: machine(),
    profiles: Object.fromEntries(PROFILES.map((p) => [p.key, p.label])),
    results: Object.fromEntries(Object.entries(results).map(([key, metrics]) => [key, Object.fromEntries(Object.entries(metrics).map(([m, s]) => [m, summary(s)]))])),
  }
  fs.mkdirSync(path.dirname(LAST), { recursive: true })
  fs.writeFileSync(LAST, `${JSON.stringify(run, null, 2)}\n`)

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null
  const lines = [`Scan timing at ${run.commit ?? 'this checkout'}, ${RUNS} runs each (median / p95, ms):`]
  if (baseline && baseline.machine?.cpu !== run.machine.cpu) {
    lines.push(`  note: the baseline was measured on another computer (${baseline.machine?.cpu}); compare runs of one computer only`)
  }
  for (const profile of PROFILES) {
    if (!run.results[profile.key]) continue
    lines.push(`  ${profile.label}`)
    for (const [metric, words] of Object.entries(METRICS)) {
      const now = run.results[profile.key][metric]
      if (!now) continue
      const before = baseline?.results?.[profile.key]?.[metric]
      let compared = ''
      if (before) {
        const change = (now.median - before.median) / before.median
        compared = `, baseline ${before.median} (${change >= 0 ? '+' : ''}${Math.round(change * 100)}%)${change > LINE ? ' OVER THE 20% LINE' : ''}`
      }
      lines.push(`    ${words}: ${now.median} / ${now.p95}, ${now.requests} requests (${now.api} to the API), ${Math.round(now.bytes / 1024)} KB over the network${compared}`)
    }
  }
  if (process.env.PERF_UPDATE_BASELINE === '1') {
    fs.writeFileSync(BASELINE, `${JSON.stringify(run, null, 2)}\n`)
    lines.push(`  written as the new baseline: ${path.relative(process.cwd(), BASELINE)}`)
  }
  console.log(lines.join('\n'))
})

// ---- the journeys ------------------------------------------------------------------------------------------------------

/** Signs Ploni in at the point once, and waits until the service worker controls the page, as on a phone that used the app. */
async function signedInPhone(page, request) {
  await clearScans(request)
  await page.goto(scanLink)
  await signIn(page, PEOPLE.ploni)
  await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
  await page.evaluate(() => globalThis.navigator.serviceWorker.ready)
  // A check-in takes the code out of the address (WorkerApp.jsx, stripCodeFromUrl), so the link is opened again rather than
  // reloaded: this navigation is the service worker's, and the second visit of the day says so.
  await page.goto(scanLink)
  await expect(page.getByRole('heading', { name: he['checkin.duplicate.title'] })).toBeVisible()
  expect(await page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller)), 'the service worker serves the app').toBe(true)
}

for (const profile of PROFILES) {
  test.describe(profile.key, () => {
    test('daily scan, signed in', async ({ page, request }) => {
      await page.addInitScript(probe, { titles: TITLES, submit: he['login.submit'] })
      await signedInPhone(page, request)
      await throttle(page, profile)
      const meter = traffic(page)
      for (let run = 0; run < RUNS; run++) {
        await clearScans(request) // so that every run is a first visit of the day, not "already recorded"
        meter.start()
        await page.goto(scanLink)
        await expect(page.getByRole('heading', { name: TITLES.success })).toBeVisible({ timeout: 60_000 })
        record(profile, 'daily', (await marks(page)).success, meter.read())
      }
    })

    test('first scan on a new phone', async ({ browser, request, baseURL }) => {
      for (let run = 0; run < RUNS; run++) {
        await clearScans(request)
        const context = await browser.newContext({
          ...devices['Pixel 7'],
          baseURL,
          timezoneId: 'Asia/Jerusalem',
          permissions: ['geolocation'],
          geolocation: NEAR,
        })
        const page = await context.newPage()
        const errors = []
        page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
        page.on('pageerror', (error) => errors.push(error.message))
        await page.addInitScript(probe, { titles: TITLES, submit: he['login.submit'] })
        await throttle(page, profile)
        const meter = traffic(page)
        await page.goto(scanLink)
        await expect(page.getByRole('list').getByRole('button').first()).toBeVisible({ timeout: 60_000 })
        record(profile, 'first_list', (await marks(page)).names, meter.read())
        meter.start()
        await signIn(page, PEOPLE.ploni)
        await expect(page.getByRole('heading', { name: TITLES.success })).toBeVisible({ timeout: 60_000 })
        const seen = await marks(page)
        record(profile, 'first_checkin', seen.success - seen.submit, meter.read())
        await context.close()
        expect(errors, 'console errors on a new phone').toEqual([])
      }
    })

    test('no reception', async ({ page, context, request }) => {
      allowConsoleErrors(page, OFFLINE_NOISE) // every request that fails while the network is off is logged by the browser
      await page.addInitScript(probe, { titles: TITLES, submit: he['login.submit'] })
      await signedInPhone(page, request)
      await throttle(page, profile, { network: false })
      const meter = traffic(page)
      for (let run = 0; run < RUNS; run++) {
        await context.setOffline(true)
        meter.start()
        await page.goto(scanLink)
        await expect(page.getByRole('heading', { name: TITLES.queued })).toBeVisible({ timeout: 60_000 })
        record(profile, 'offline', (await marks(page)).queued, meter.read())
        // Forget the saved visit before the network returns, so that the next run is the same first visit of the day.
        await page.evaluate((key) => globalThis.localStorage.removeItem(key), QUEUE_KEY)
        await page.goto('about:blank')
        await context.setOffline(false)
      }
    })
  })
}
