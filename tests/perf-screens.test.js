// The timing of the committee's screens on a year of data (npm run perf:screens, scripts/perf/screen-timing.playwright.mjs and
// scripts/perf/screen-report.mjs, docs/testing.md "Timing the committee's screens"). No browser runs and no database is used: CI never
// measures (a shared runner's timings are noise), so this file checks what the measurement is made of:
//   1. it is run by its own npm scripts, and the baseline step runs only after a run that passed;
//   2. it is kept out of the E2E run and out of the scan timing, and works on its own ports and schema, on a year of data (not the dev seed);
//   3. the screens: every tab of the committee app, the words that say "loaded" (checked against the components), the targets of D3, and
//      the page-side probe that finds the moment (run here on small pages);
//   4. the numbers: the median and the p95, the parts of the time, the line, the report;
//   5. the step that makes a run the baseline refuses a partial run, a run of another commit and a run with uncommitted changes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import {
  BOOT_API, LINE, LINE_FLOOR_MS, MIN_RUNS, PROFILES, PROFILE_KEYS, SCREEN_TITLES, TARGET_MS, acceptBaseline, judge, markdownTables, overTarget,
  probe, probeConfig, reportLines, screensFor, summary, targetFor, whyNotABaseline,
} from '../scripts/perf/screen-report.mjs'
import { assertYearDataSchema, yearDataPlan } from '../scripts/perf/year-data.mjs'
import { SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, SCREENSHOTS_SCHEMA } from '../scripts/screenshots/settings.mjs'
import { PERF_API_PORT, PERF_API_SCHEMA } from '../scripts/perf/api-timing.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const screensConfig = 'playwright.screens-perf.config.js'
const SPEC = 'scripts/perf/screen-timing.playwright.mjs'
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
/** `playwright test --list` with these arguments, in the project folder: lists the tests without starting a server. */
const list = (...args) =>
  spawnSync(process.execPath, [cli, 'test', '--list', ...args], {
    cwd: root,
    // No variable of an E2E run is passed on: the measurement sets its own, and the E2E config reads its defaults.
    env: { ...process.env, E2E_APP_PORT: '', E2E_API_PORT: '', E2E_SCHEMA: '', CI: '' },
    encoding: 'utf8',
    timeout: 60_000,
  })

const TODAY = '2030-06-15'
const SCREENS = screensFor(TODAY)

describe('how the timing is run', () => {
  it('is run by npm run perf:screens, and npm run perf:screens:baseline promotes a run only when Playwright exited 0', () => {
    const { scripts } = JSON.parse(read('package.json'))
    expect(scripts['perf:screens']).toBe(`playwright test --config ${screensConfig}`)
    // `&&`: the promotion runs only after the whole run passed, fixture teardown and the console-error check of the run included.
    expect(scripts['perf:screens:baseline']).toBe(`playwright test --config ${screensConfig} && node scripts/perf/screen-report.mjs --promote`)
    expect(scripts['test:e2e']).toBe('playwright test')
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('perf:screens')) {
        expect(command, name).not.toContain(screensConfig)
        expect(command, name).not.toContain('screen-report')
      }
    }
  })

  it('has a config of its own, at the project root, whose testDir is not under e2e/ or tests/', () => {
    const source = read(screensConfig)
    const testDir = /testDir:\s*'([^']+)'/.exec(source)?.[1]
    expect(testDir, 'the config names its testDir').toBeTruthy()
    const where = path.posix.normalize(testDir)
    for (const forbidden of ['e2e', 'tests']) {
      expect(where === forbidden || where.startsWith(`${forbidden}/`) || where.startsWith(`./${forbidden}`), `testDir ${testDir}`).toBe(false)
    }
    expect(fs.existsSync(path.join(root, where, 'screen-timing.playwright.mjs')), 'its spec is in its testDir').toBe(true)
  })

  it('is not called *.spec.mjs, because playwright.perf.config.js runs every *.spec.mjs of scripts/perf (the scan timing must not run it)', () => {
    expect(fs.readdirSync(path.join(root, 'scripts/perf')).filter((name) => /screen/.test(name) && /\.spec\.mjs$/.test(name))).toEqual([])
    expect(read('playwright.perf.config.js')).toContain("testMatch: '*.spec.mjs'")
  })

  it('is not listed by the E2E config, which reads ./e2e and nothing else, nor by the scan timing', () => {
    const e2e = list()
    expect(e2e.status, e2e.stderr).toBe(0)
    expect(e2e.stdout).toMatch(/Total: \d+ tests in \d+ files/)
    expect(e2e.stdout).not.toContain('screen-timing')
    const scan = list('--config', 'playwright.perf.config.js')
    expect(scan.status, scan.stderr).toBe(0)
    expect(scan.stdout).toContain('scan-timing.spec.mjs')
    expect(scan.stdout).not.toContain('screen-timing')
  })

  it('is listed by its own config: one file, on Chromium only, a test for each screen on each device, and none of the E2E specs', () => {
    const result = list('--config', screensConfig)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('screen-timing.playwright.mjs')
    expect(result.stdout).toMatch(new RegExp(`Total: ${PROFILE_KEYS.length * SCREENS.length} tests in 1 file`))
    expect(result.stdout).not.toContain('iphone-webkit')
    expect(result.stdout).not.toMatch(/(?:^|[\\/\s])e2e[\\/]/m)
    for (const profile of PROFILE_KEYS) for (const screen of SCREENS) expect(result.stdout).toContain(`${profile} › ${screen.key}:`)
  })

  it('only talks to the local servers that its config starts, and to no other address', () => {
    const spec = read(SPEC)
    expect(spec, 'no absolute address').not.toMatch(/https?:\/\//)
    // The one request of the script's own (the export on the throttled phone) asks for the address of the link on the page, a path of the local API.
    expect(spec.match(/\bfetch\(/g)).toHaveLength(1)
    expect(spec).toContain('const response = await globalThis.fetch(address)')
    expect(spec).toContain(".getAttribute('href')")
    expect(spec).toContain('toMatch(/^\\/api\\/admin\\/scans\\?/)')
    // Every navigation is relative to the baseURL of the run (the preview of the scratch build) or about:blank.
    for (const [, target] of spec.matchAll(/page\.goto\(([^)]*)\)/g)) expect(target, target).toMatch(/^('about:blank'|'\/admin'|'\/admin#home'|`\/admin\$\{screen\.hash\}`)$/)
    expect(spec).toContain("mode: 'serial'")
  })
})

describe('the config of the timing', () => {
  // Loaded again, as Playwright does, with the variables of an E2E run set to something else on purpose: the measurement must not take
  // them over (tests/perf-scan.test.js does the same for the scan timing).
  async function loadConfig() {
    vi.resetModules()
    vi.stubEnv('E2E_APP_PORT', '3100')
    vi.stubEnv('E2E_API_PORT', '3101')
    vi.stubEnv('E2E_SCHEMA', 'e2e')
    return import('../playwright.screens-perf.config.js')
  }
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('serves its own ports and works in its own schema, whatever an E2E run left in the environment', async () => {
    const { default: config, SCREENS_APP_PORT, SCREENS_API_PORT, SCREENS_SCHEMA, SCREENS_SPEC } = await loadConfig()
    expect([SCREENS_APP_PORT, SCREENS_API_PORT, SCREENS_SCHEMA]).toEqual([3720, 3721, 'perf_screens'])
    expect(process.env.E2E_SCHEMA, 'the teardown and the spec read the schema from here').toBe(SCREENS_SCHEMA)
    const [api, preview] = config.webServer
    const build = `node_modules/.cache/bqr-e2e/${SCREENS_SCHEMA}/dist`
    expect(config.use.baseURL).toBe(`http://localhost:${SCREENS_APP_PORT}`)
    expect(SCREENS_SPEC).toBe('screen-timing.playwright.mjs')
    expect(config.testMatch).toBe(SCREENS_SPEC)
    // The year of data (x1) made by T1's generator, not the four points of the dev seed, and then the API on top of it.
    expect(api.command).toBe(`node scripts/perf/year-data.mjs ${SCREENS_SCHEMA} --scale=1 && node server/dev.mjs --schema=${SCREENS_SCHEMA}`)
    expect(api.command).not.toContain('dev-seed')
    expect(api.url).toBe(`http://localhost:${SCREENS_API_PORT}/api/public/providers`)
    expect(api.env.GOOGLE_CLIENT_ID, 'the sign-in screen must not load Google').toBe('')
    expect(preview.command).toBe(`npm run build -- --outDir ${build} && npx vite preview --port ${SCREENS_APP_PORT} --strictPort --outDir ${build}`)
    for (const server of [api, preview]) expect(server.reuseExistingServer).toBe(false)
    expect(config.globalTeardown).toBe('./scripts/perf/screen-teardown.mjs')
    expect(config.workers).toBe(1)
    expect(config.retries).toBe(0)
    expect(config.projects.map((p) => p.name)).toEqual(['chromium'])
  })

  it('does not collide with the ports of a development server, an E2E run, the screenshots, the scan timing or the API timing', async () => {
    const { SCREENS_APP_PORT, SCREENS_API_PORT, SCREENS_SCHEMA } = await loadConfig()
    const perfScan = read('playwright.perf.config.js')
    const scanPorts = [/PERF_APP_PORT = (\d+)/, /PERF_API_PORT = (\d+)/].map((re) => Number(re.exec(perfScan)?.[1]))
    expect(scanPorts.every(Number.isInteger)).toBe(true)
    const taken = [3000, 3001, 3100, 3101, 3200, 3201, SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, ...scanPorts, PERF_API_PORT]
    for (const port of [SCREENS_APP_PORT, SCREENS_API_PORT]) expect(taken).not.toContain(port)
    expect(assertYearDataSchema(SCREENS_SCHEMA)).toBe(SCREENS_SCHEMA)
    expect(['e2e', 'perf', 'dev_ui', 'public', SCREENSHOTS_SCHEMA, PERF_API_SCHEMA]).not.toContain(SCREENS_SCHEMA)
  })

  it('drops its schema with the generator, which drops only a schema that it made, and nothing else', () => {
    const source = read('scripts/perf/screen-teardown.mjs')
    expect(source).toContain("'scripts/perf/year-data.mjs', schema, '--drop'")
    expect(source).toContain('e2eSettings()')
    expect(source, 'not the E2E teardown, which drops any scratch schema').not.toContain('dev-seed')
  })
})

describe('the screens', () => {
  it('has a name, a kind and a target for each, and covers every screen of the committee app', () => {
    expect(new Set(SCREENS.map((s) => s.key)).size).toBe(SCREENS.length)
    for (const s of SCREENS) {
      expect(['navigate', 'more', 'download']).toContain(s.kind)
      expect(['screen', 'download']).toContain(s.target)
      expect(s.words.length, s.key).toBeGreaterThan(10)
      expect(s.hash, s.key).toMatch(/^#[a-z]+/)
      expect(s.ready.length, s.key).toBeGreaterThan(0)
      if (s.kind !== 'navigate') expect(s.click, s.key).toBeTruthy()
      expect(s.target === 'download', s.key).toBe(s.kind === 'download')
    }
    // The tabs of src/pages/AdminApp.jsx (TABS): every one is visited, whatever else a screen has more than one visit for.
    const tabs = [...read('src/pages/AdminApp.jsx').matchAll(/\{ key: '([a-z]+)', label:/g)].map((m) => m[1])
    expect(tabs.sort()).toEqual(['agent', 'audit', 'help', 'history', 'home', 'points', 'providers', 'settings'])
    expect([...new Set(SCREENS.map((s) => /^#([a-z]+)/.exec(s.hash)[1]))].sort()).toEqual(tabs)
    expect(SCREENS.filter((s) => s.target === 'download').map((s) => s.key)).toEqual(['history_csv'])
  })

  it('visits the History as it opens (7 days), then "load more" once, then the type "not counted", then the export of a year', () => {
    const history = SCREENS.filter((s) => s.hash.startsWith('#history')).map((s) => [s.key, s.kind, s.hash])
    expect(history).toEqual([
      ['history', 'navigate', '#history'],
      ['history_more', 'more', '#history'],
      ['history_refused', 'navigate', '#history?outcome=not_counted'],
      ['history_csv', 'download', '#history?from=2029-06-16&to=2030-06-15'],
    ])
    // The audit log with no date: the address names no filter.
    expect(SCREENS.find((s) => s.key === 'audit').hash).toBe('#audit')
  })

  it('has the targets that were set before the first measurement (D3): 1 s on a computer, 2.5 s on the throttled phone, 5 s for the export of a year on a computer and none on the phone', () => {
    // The export on the phone is bound by the throttled bandwidth (3.4 MB at 1.6 Mbps is about 17.5 s whatever the server does).
    expect(TARGET_MS).toEqual({ screen: { phone: 2500, computer: 1000 }, download: { phone: null, computer: 5000 } })
    const home = SCREENS.find((s) => s.key === 'home')
    const csv = SCREENS.find((s) => s.key === 'history_csv')
    expect([targetFor(home, 'phone'), targetFor(home, 'computer'), targetFor(csv, 'phone'), targetFor(csv, 'computer')]).toEqual([2500, 1000, null, 5000])
  })

  it('says what "loaded" is in the words of the components: each heading, label and button is in the file of its screen', () => {
    const where = {
      home_week: 'HomeView', history: 'HistoryView', points: 'PointsView', providers: 'ProvidersView', agent: 'AgentView', settings: 'SettingsView',
      audit: 'AuditView', help: 'HelpView', building_field: 'SettingsView', load_more: 'HistoryView', export: 'HistoryView',
    }
    expect(Object.keys(where).sort()).toEqual(Object.keys(SCREEN_TITLES).sort())
    for (const [key, view] of Object.entries(where)) {
      expect(read(`src/admin/views/${view}.jsx`), `${key} in ${view}`).toContain(SCREEN_TITLES[key])
    }
    // The strings that the spec types or clicks to sign in: the dev-only sign-in of src/admin/LoginScreen.jsx.
    const login = read('src/admin/LoginScreen.jsx')
    const spec = read(SPEC)
    for (const label of ['אימייל אדמין לפיתוח', 'כניסת פיתוח']) {
      expect(login, label).toContain(label)
      expect(spec, label).toContain(label)
    }
  })

  it('waits for requests that the server has, and for the ones that every screen waits for before it is drawn', async () => {
    await import('../server/index.js')
    const { routeTable } = await import('../server/router.js')
    const gets = new Set(routeTable().filter((r) => r.method === 'GET').map((r) => `/api${r.path}`))
    for (const path of [...BOOT_API, ...SCREENS.flatMap((s) => s.api)]) expect(gets.has(path), `GET ${path}`).toBe(true)
    // The shell of src/pages/AdminApp.jsx draws a screen after /config and /me.
    const shell = read('src/pages/AdminApp.jsx')
    expect(shell).toContain("adminApi('/config')")
    expect(shell).toContain("adminApi('/me')")
  })

  it('shows the year of data (x1): the count of cards and rows that a screen must show is the generator\'s own', () => {
    const plan = yearDataPlan(1)
    const rows = (key) => SCREENS.find((s) => s.key === key).rows
    expect(rows('points')).toEqual({ role: 'article', exactly: plan.points })
    expect(rows('providers')).toEqual({ role: 'article', exactly: plan.providers })
    expect(rows('settings')).toEqual({ role: 'article', exactly: plan.members })
    expect(rows('agent')).toEqual({ role: 'article', exactly: plan.agentKeys })
    expect(rows('help')).toBeNull()
    expect(rows('history_csv').lines).toBeLessThan(plan.visits)
  })

  it('gives the probe one test for each address, and refuses two screens that share an address and disagree', () => {
    const config = probeConfig(SCREENS)
    expect(Object.keys(config).sort()).toEqual([...new Set(SCREENS.map((s) => s.hash))].sort())
    // The History as it opens is visited twice (with and without "load more"): one test, and the click of the second.
    expect(config['#history'].clicks).toEqual([{ tag: 'button', name: SCREEN_TITLES.load_more, growth: 'listitem' }])
    expect(config[SCREENS.find((s) => s.key === 'history_csv').hash].clicks).toEqual([{ tag: 'a', name: SCREEN_TITLES.export }])
    expect(() => probeConfig([...SCREENS, { ...SCREENS[1], key: 'x', ready: [{ role: 'article' }] }])).toThrow('disagree')
  })
})

describe('the probe that finds the moment in the page', () => {
  /** Runs `probe` in a page built from `html` at `hash`, with the globals it reads set from that page; `body(page)` then works with it. */
  async function inPage(html, hash, body) {
    const dom = new JSDOM(html, { url: `http://localhost/admin${hash}` })
    const names = { document: dom.window.document, location: dom.window.location, MutationObserver: dom.window.MutationObserver, Element: dom.window.Element }
    const before = Object.fromEntries(Object.keys(names).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
    for (const [name, value] of Object.entries(names)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    try {
      probe({ scenarios: probeConfig(SCREENS) })
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
      return await body({ document: dom.window.document, marks: () => globalThis.__perf, tick, put: (markup, into = 'body') => dom.window.document.querySelector(into).insertAdjacentHTML('beforeend', markup) })
    } finally {
      for (const [name, descriptor] of Object.entries(before)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
      delete globalThis.__perf
      dom.window.close()
    }
  }

  it('marks the moment the heading and the first card are both there, and not before', async () => {
    await inPage('<body></body>', '#points', async ({ marks, tick, put }) => {
      put('<main><h1>נקודות סריקה</h1></main>')
      await tick()
      expect(marks().ready, 'the heading alone is not the content').toBeUndefined()
      put('<article>a point</article>', 'main')
      await tick()
      expect(marks().ready).toEqual(expect.any(Number))
    })
  })

  it('looks for an article inside <main> only', async () => {
    await inPage('<body></body>', '#agent', async ({ marks, tick, put }) => {
      put('<aside><article>elsewhere</article></aside><main><h1>גישה לאייג\'נט</h1></main>')
      await tick()
      expect(marks().ready).toBeUndefined()
    })
  })

  it('takes a day heading for the first list and not a plain h2', async () => {
    await inPage('<body></body>', '#audit', async ({ marks, tick, put }) => {
      put('<main><h1>יומן פעולות</h1><h2>לא תאריך</h2></main>')
      await tick()
      expect(marks().ready).toBeUndefined()
      put('<h2>13/10/2026 · 41</h2>')
      await tick()
      expect(marks().ready).toEqual(expect.any(Number))
    })
  })

  it('waits for the field of the building in the settings, with the members already there', async () => {
    await inPage('<body></body>', '#settings', async ({ marks, tick, put }) => {
      put('<main><h1>הגדרות</h1><article>a member</article></main>')
      await tick()
      expect(marks().ready).toBeUndefined()
      put('<label for="b">שם הבניין</label><input id="b">')
      await tick()
      expect(marks().ready).toEqual(expect.any(Number))
    })
  })

  it('does nothing for an address that is not a screen of the run', async () => {
    await inPage('<body></body>', '#nothing', async ({ marks, tick, put }) => {
      put('<main><h1>נקודות סריקה</h1><article>a</article></main>')
      await tick()
      expect(marks()).toEqual({})
    })
  })

  it('notes the click on "load more" and the moment the next rows are there, and no other click', async () => {
    const hash = '#history'
    await inPage('<body></body>', hash, async ({ marks, tick, put, document }) => {
      put('<main><h1>היסטוריית נוכחות</h1><h2>13/10/2026 · 3</h2><ul><li>1</li><li>2</li><li>3</li></ul><button id="other">רענון</button><button id="more">טעינת עוד</button></main>')
      await tick()
      expect(marks().ready).toEqual(expect.any(Number))
      document.getElementById('other').click()
      expect(marks().click, 'another button').toBeUndefined()
      document.getElementById('more').click()
      expect(marks()).toMatchObject({ click: expect.any(Number), clickEpoch: expect.any(Number), before: 3, growth: 'listitem' })
      await tick()
      expect(marks().done, 'no new rows yet').toBeUndefined()
      document.querySelector('ul').insertAdjacentHTML('beforeend', '<li>4</li><li>5</li>')
      await tick()
      expect(marks().done).toBeGreaterThanOrEqual(marks().click)
    })
  })

  it('notes the click on the link of the export, by its name', async () => {
    const csv = SCREENS.find((s) => s.key === 'history_csv')
    await inPage('<body></body>', csv.hash, async ({ marks, tick, put, document }) => {
      put('<main><h1>היסטוריית נוכחות</h1><h2>13/10/2026 · 3</h2><a id="x" href="#" aria-label="ייצוא ל-Excel"></a></main>')
      await tick()
      document.getElementById('x').addEventListener('click', (event) => event.preventDefault())
      document.getElementById('x').click()
      expect(marks().clickEpoch).toBeGreaterThan(0)
      expect(marks().before, 'an export has no rows to wait for').toBeUndefined()
    })
  })
})

describe('the numbers of a run', () => {
  const visit = (ms, extra = {}) => ({ ms, code: 100, boot: 20, wait: 50, draw: ms - 170, requests: 9, api: 3, bytes: 2048, ...extra })

  it('takes the median and the nearest-rank p95 of whole milliseconds, and the median of each part', () => {
    const visits = [305, 301, 303, 302, 304, 310, 308, 307, 309, 306].map((ms) => visit(ms))
    // The draw of a visit is its time less 170: the median of the draws is the draw of the median visit.
    // `samples` are the times in the order of the run, to tell which visit was the slow one.
    expect(summary(visits)).toEqual({
      n: 10, median: 306, p95: 310, min: 301, max: 310, samples: [305, 301, 303, 302, 304, 310, 308, 307, 309, 306], code: 100, boot: 20, wait: 50, draw: 306 - 170, requests: 9, api: 3, bytes: 2048,
    })
    expect(summary([visit(10.4), visit(11.6)])).toMatchObject({ median: 11, p95: 12, min: 10, max: 12 })
    expect(summary([visit(1, { requests: 4 }), visit(2, { requests: 9, bytes: 10 }), visit(3)])).toMatchObject({ requests: 9, bytes: 2048 })
  })

  it('has no parts for a visit that has none (the export)', () => {
    const plain = { ms: 4000, code: null, boot: null, wait: null, draw: null, requests: 1, api: 1, bytes: 1_800_000 }
    expect(summary([plain, plain])).toMatchObject({ median: 4000, code: null, boot: null, wait: null, draw: null, bytes: 1_800_000 })
  })

  it('marks a p95 over the target (and the median too, if it is), and a median over the 20% line that is also over the floor', () => {
    expect(LINE).toBe(0.2)
    expect(judge({ median: 900, p95: 1001 }, { median: 700 }, 1000)).toEqual({ overTarget: true, medianOver: false, change: 200 / 700, overLine: true })
    expect(judge({ median: 1100, p95: 1200 }, null, 1000)).toEqual({ overTarget: true, medianOver: true, change: null, overLine: false })
    expect(judge({ median: 800, p95: 1000 }, { median: 700 }, 1000)).toMatchObject({ overTarget: false, overLine: false })
    // A screen with no target (the export on the phone) is never over it, however long it takes.
    expect(judge({ median: 17_900, p95: 18_200 }, { median: 17_000 }, null)).toEqual({ overTarget: false, medianOver: false, change: 900 / 17_000, overLine: false })
    // 40 to 49 ms is 22% slower, and less than LINE_FLOOR_MS: the noise of a computer, not a finding.
    expect(judge({ median: 40 + LINE_FLOOR_MS - 1, p95: 60 }, { median: 40 }, 1000).overLine).toBe(false)
    expect(judge({ median: 40 + LINE_FLOOR_MS + 1, p95: 60 }, { median: 40 }, 1000).overLine).toBe(true)
  })

  it('uses the phone of the scan timing: the same Slow 4G and the same CPU slowdown', () => {
    const scan = read('scripts/perf/scan-timing.spec.mjs')
    expect(scan).toContain('latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4')
    expect(PROFILES.phone).toMatchObject({ latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 })
    expect(PROFILES.computer).toMatchObject({ latency: 0, down: -1, up: -1, cpu: 1 })
    expect(PROFILE_KEYS).toEqual(['phone', 'computer'])
    // The spec throttles the phone only: the computer is the speed of the machine.
    expect(read(SPEC)).toContain('const throttled = profile.cpu > 1 || profile.latency > 0')
  })

  /** A run as the spec writes it: every screen on both devices with `n` visits. */
  const aRun = ({ runs = 10, n = runs, commit = 'abc1234', dirty = false, drop = null, median = 300, p95 = 400, data = { scans: 14606, refusals: 730, audit: 3000, points: 25, providers: 10 } } = {}) => ({
    commit,
    dirty,
    runs,
    machine: { cpu: 'Test CPU', cores: 4, platform: 'test' },
    data,
    results: Object.fromEntries(
      PROFILE_KEYS.map((profile) => [
        profile,
        Object.fromEntries(
          SCREENS.filter((s) => `${profile} ${s.key}` !== drop).map((s) => [
            s.key,
            { n, median, p95, min: 200, max: p95, samples: Array.from({ length: n }, (_, i) => (i === n - 1 ? p95 : median)), code: 90, boot: 10, wait: 60, draw: 140, requests: 8, api: 3, bytes: 4096 },
          ]),
        ),
      ]),
    ),
  })
  /** One slow visit among the visits of a screen: the p95 is that visit, which was the `visit`-th of the run (1 is the first). */
  const slowVisit = (result, visit, ms) => {
    result.samples = result.samples.map(() => result.median)
    result.samples[visit - 1] = ms
    result.p95 = ms
  }

  it('lists the screens that are over their target on a device, by the p95, and none for a screen that has no target', () => {
    const run = aRun()
    run.results.phone.points.p95 = 2501
    run.results.computer.home.p95 = 1001
    run.results.computer.history_csv.p95 = 5000
    run.results.phone.history_csv.p95 = 18_200 // 3.4 MB at 1.6 Mbps: bound by the bandwidth, with no target
    expect(overTarget(run, 'phone', SCREENS)).toEqual(['points'])
    expect(overTarget(run, 'computer', SCREENS)).toEqual(['home'])
  })

  it('prints both tables, the part of the time, the baseline, and what is over', () => {
    const run = aRun()
    run.results.phone.history.median = 2600
    run.results.phone.history.p95 = 2700
    slowVisit(run.results.computer.audit, 3, 1200)
    slowVisit(run.results.phone.points, 1, 2800)
    slowVisit(run.results.phone.providers, 10, 2600)
    const baseline = aRun({ median: 200 })
    const text = reportLines(run, baseline, SCREENS).join('\n')
    expect(text).toContain('Screen timing at abc1234')
    expect(text).toContain(PROFILES.phone.label)
    expect(text).toContain(PROFILES.computer.label)
    expect(text).toMatch(/history\s+2600\s+2700\s+2500\s+90\s+10\s+60\s+140\s+8\s+4\.0\s+200 \(\+1200%\)\s+OVER TARGET \(the median too\); OVER THE 20% LINE/)
    // Which visit was the slow one: the first after the warm-up is a cold start, another is a visit that went slow by itself.
    expect(text).toMatch(/audit\s+300\s+1200\s+1000\s+.*OVER TARGET \(the median is within it; 1 of 10 visits over, the slowest is visit 3\)/)
    expect(text).toMatch(/points\s+300\s+2800\s+2500\s+.*the slowest is visit 1, the first after the warm-up\)/)
    expect(text).toMatch(/providers\s+300\s+2600\s+2500\s+.*the slowest is visit 10\)/)
    // The export on the phone has no target; the note says what binds it.
    expect(text).toMatch(/history_csv\s+300\s+400\s+-\s+.*bound by the throttled bandwidth: 4 KB at 1\.6 Mbps/)
    expect(text).not.toMatch(/history_csv.*OVER TARGET/)
    expect(text).toContain('Over the target (p95): phone history, phone points, phone providers, computer audit.')
    expect(text).toContain('Once over the line can be noise')
    expect(text).toContain('14,606 visits, 730 refused visits')
    expect(reportLines(aRun(), null, SCREENS).join('\n')).toContain('Every screen is within its target.')
    expect(reportLines(aRun({ dirty: true }), null, SCREENS).join('\n')).toContain('This run cannot be the baseline: the run measured a checkout with changes that are not committed.')
    const other = aRun()
    other.machine.cpu = 'Another CPU'
    expect(reportLines(other, baseline, SCREENS).join('\n')).toContain('the baseline was measured on another computer (Test CPU)')
  })

  it('prints the same numbers in Markdown for a pull request, one table for each device', () => {
    const run = aRun()
    run.results.computer.history_csv.median = 5200
    run.results.computer.history_csv.p95 = 5300
    const text = markdownTables(run, null, SCREENS)
    expect(text.match(/^#### /gm)).toHaveLength(2)
    expect(text).toContain(`#### ${PROFILES.phone.label}`)
    expect(text).toContain('| Screen | What it is | Median ms | p95 ms | Target ms | Code ms | Boot ms | Data ms | Draw ms | Requests | KB | Notes |')
    expect(text).toContain('| `home` | Home: the week table and the cards | 300 | 400 | 2500 | 90 | 10 | 60 | 140 | 8 | 4.0 |  |')
    expect(text).toMatch(/\| `history_csv` \| [^|]* \| 5200 \| 5300 \| 5000 \| .*OVER TARGET \(the median too\) \|/)
    // The phone's export has no target ("-"), and says what binds it.
    expect(text).toMatch(/\| `history_csv` \| [^|]* \| 300 \| 400 \| - \| .*bound by the throttled bandwidth: 4 KB at 1\.6 Mbps \|/)
  })
})

describe('the step that makes a run the baseline', () => {
  let dir
  const accept = (run, commit = 'abc1234') => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-screens-baseline-'))
    const last = path.join(dir, 'last.json')
    const baseline = path.join(dir, 'baseline.json')
    if (run !== undefined) fs.writeFileSync(last, typeof run === 'string' ? run : JSON.stringify(run))
    fs.writeFileSync(baseline, '{"old": true}')
    const result = acceptBaseline({ last, baseline, commit })
    return { ...result, baseline: JSON.parse(fs.readFileSync(baseline, 'utf8')) }
  }
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  /** The same run as above, built here so that each case says what is wrong with it. */
  const aRun = ({ runs = 10, n = runs, commit = 'abc1234', dirty = false, drop = null, data = { scans: 100 } } = {}) => ({
    commit,
    dirty,
    runs,
    data,
    results: Object.fromEntries(
      PROFILE_KEYS.map((profile) => [profile, Object.fromEntries(SCREENS.filter((s) => `${profile} ${s.key}` !== drop).map((s) => [s.key, { n, median: 5, p95: 6 }]))]),
    ),
  })

  it('makes a complete run of this commit, measured on a clean checkout, the baseline', () => {
    const result = accept(aRun())
    expect(result.written).toBe(true)
    expect(result.baseline).toEqual(aRun())
    expect(whyNotABaseline(aRun())).toBeNull()
    expect(MIN_RUNS).toBe(10)
  })

  it.each([
    ['fewer than 10 runs', aRun({ runs: 2 }), 'at least 10 runs'],
    ['a screen with fewer samples (it failed halfway)', aRun({ n: 9 }), 'phone home has 9 of 10 runs'],
    ['a screen missing on a device', aRun({ drop: 'computer audit' }), 'computer audit has 0 of 10 runs'],
    ['a run of a checkout with uncommitted changes', aRun({ dirty: true }), 'not committed'],
    ['a run that did not count the data', aRun({ data: null }), 'does not say how much data'],
    ['a run of another commit', aRun({ commit: 'fff0000' }), 'measured fff0000'],
    ['no run at all', undefined, 'there is no last run'],
    ['a run that is not JSON', '{not json', 'not readable JSON'],
  ])('refuses %s, and leaves the baseline as it was', (_what, run, reason) => {
    const result = accept(run)
    expect(result.written).toBe(false)
    expect(result.reason).toContain(reason)
    expect(result.baseline).toEqual({ old: true })
  })

  it('refuses a checkout whose commit is unknown', () => {
    const result = accept(aRun(), null)
    expect(result.written).toBe(false)
    expect(result.reason).toContain('measured abc1234')
  })
})
