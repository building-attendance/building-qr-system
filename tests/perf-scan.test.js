// The timing of the scan (npm run perf:scan, docs/testing.md "Timing a scan"). No browser and no database: the run is
// checked for being kept out of the E2E run (so CI never measures, and a measurement never slows CI), for its own ports and
// schema; the baseline that it compares with is checked for its shape, and the step that writes a baseline for what it
// refuses.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JOURNEYS, PROFILE_KEYS, acceptBaseline, whyNotABaseline } from '../scripts/perf/baseline.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const perfConfig = 'playwright.perf.config.js'
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

describe('the timing of the scan is not part of the E2E run, so that CI never measures', () => {
  it('has a config of its own, at the project root, whose testDir is not under e2e/ or tests/', () => {
    const source = fs.readFileSync(path.join(root, perfConfig), 'utf8')
    const testDir = /testDir:\s*'([^']+)'/.exec(source)?.[1]
    expect(testDir, 'the config names its testDir').toBeTruthy()
    const where = path.posix.normalize(testDir)
    for (const forbidden of ['e2e', 'tests']) {
      expect(where === forbidden || where.startsWith(`${forbidden}/`) || where.startsWith(`./${forbidden}`), `testDir ${testDir}`).toBe(false)
    }
    expect(fs.existsSync(path.join(root, where)), 'its testDir exists').toBe(true)
  })

  it('is run by npm run perf:scan, and npm run perf:scan:baseline promotes a run only when Playwright exited 0', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(scripts['perf:scan']).toBe(`playwright test --config ${perfConfig}`)
    // `&&`: the baseline step runs only after the whole run passed, fixture teardown included (a console error fails a test
    // there, after the test's own hooks), so a run with a failure can never become the baseline.
    expect(scripts['perf:scan:baseline']).toBe(`playwright test --config ${perfConfig} && node scripts/perf/baseline.mjs`)
    expect(scripts['test:e2e']).toBe('playwright test')
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('perf:scan')) expect(command, name).not.toContain(perfConfig)
    }
  })

  it('is not listed by the E2E config, which reads ./e2e and nothing else', () => {
    const result = list()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/Total: \d+ tests in \d+ files/)
    expect(result.stdout).not.toContain('scan-timing.spec')
  })

  it('is listed by its own config: one spec, on Chromium only, and none of the E2E specs', () => {
    const result = list('--config', perfConfig)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('scan-timing.spec.mjs')
    expect(result.stdout).toMatch(/Total: \d+ tests in 1 file/)
    expect(result.stdout).not.toContain('iphone-webkit')
    expect(result.stdout).not.toMatch(/(?:^|[\\/\s])e2e[\\/]/m)
  })
})

describe('the config of the timing', () => {
  // Loaded again, as Playwright does, with the variables of an E2E run set to something else on purpose: the measurement must
  // not take them over (tests/screenshots.test.js does the same for the screenshots).
  async function loadPerfConfig() {
    vi.resetModules()
    vi.stubEnv('E2E_APP_PORT', '3100')
    vi.stubEnv('E2E_API_PORT', '3101')
    vi.stubEnv('E2E_SCHEMA', 'e2e')
    return import('../playwright.perf.config.js')
  }
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('serves its own ports and works in its own schema, whatever an E2E run left in the environment', async () => {
    const { default: config, PERF_APP_PORT, PERF_API_PORT, PERF_SCHEMA } = await loadPerfConfig()
    expect([PERF_APP_PORT, PERF_API_PORT, PERF_SCHEMA]).toEqual([3700, 3701, 'perf'])
    const [api, preview] = config.webServer
    const build = `node_modules/.cache/bqr-e2e/${PERF_SCHEMA}/dist`
    expect(config.use.baseURL).toBe(`http://localhost:${PERF_APP_PORT}`)
    expect(api.command).toBe(
      `node scripts/dev-seed.mjs ${PERF_SCHEMA} --drop && node scripts/dev-seed.mjs ${PERF_SCHEMA} && node server/dev.mjs --schema=${PERF_SCHEMA}`,
    )
    expect(api.url).toBe(`http://localhost:${PERF_API_PORT}/api/public/providers`)
    expect(preview.command).toBe(`npm run build -- --outDir ${build} && npx vite preview --port ${PERF_APP_PORT} --strictPort --outDir ${build}`)
    for (const server of [api, preview]) expect(server.reuseExistingServer).toBe(false)
    expect(config.globalTeardown).toBe('./e2e/global-teardown.js') // drops the schema of this run
    expect(config.workers).toBe(1)
    expect(config.retries).toBe(0)
  })

  it('does not collide with the ports of the screenshots, a development server or an E2E run', async () => {
    const { PERF_APP_PORT, PERF_API_PORT, PERF_SCHEMA } = await loadPerfConfig()
    const { SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, SCREENSHOTS_SCHEMA } = await import('../scripts/screenshots/settings.mjs')
    const taken = [3000, 3001, 3100, 3101, 3200, 3201, SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT]
    for (const port of [PERF_APP_PORT, PERF_API_PORT]) expect(taken).not.toContain(port)
    expect([PERF_SCHEMA]).not.toContain(SCREENSHOTS_SCHEMA)
    expect(PERF_SCHEMA).not.toBe('e2e')
  })
})

describe('the baseline that a run compares with', () => {
  const file = path.join(root, 'scripts/perf/scan-baseline.json')

  it('is committed, with the commit, the computer and the numbers of every journey in both profiles', () => {
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(baseline.commit).toMatch(/^[0-9a-f]{7}$/)
    expect(baseline.runs).toBeGreaterThanOrEqual(10)
    expect(typeof baseline.machine.cpu).toBe('string')
    expect(Object.keys(baseline.results).sort()).toEqual(['slow-4g', 'unthrottled'])
    for (const journeys of Object.values(baseline.results)) {
      expect(Object.keys(journeys).sort()).toEqual(['daily', 'first_checkin', 'first_list', 'offline'])
      for (const numbers of Object.values(journeys)) {
        expect(numbers.n).toBe(baseline.runs)
        expect(numbers.median).toBeGreaterThan(0)
        expect(numbers.p95).toBeGreaterThanOrEqual(numbers.median)
      }
    }
    expect(whyNotABaseline(baseline), 'the committed baseline passes the rule that wrote it').toBeNull()
  })
})

describe('the step that makes a run the baseline (scripts/perf/baseline.mjs)', () => {
  /** A run as the spec writes it: every journey of every profile with `n` samples. */
  const aRun = ({ runs = 10, n = runs, commit = 'abc1234', drop = null } = {}) => ({
    commit,
    runs,
    results: Object.fromEntries(
      PROFILE_KEYS.map((profile) => [
        profile,
        Object.fromEntries(
          Object.keys(JOURNEYS)
            .filter((journey) => `${profile} ${journey}` !== drop)
            .map((journey) => [journey, { n, median: 100, p95: 120 }]),
        ),
      ]),
    ),
  })
  let dir
  const files = () => ({ last: path.join(dir, 'last.json'), baseline: path.join(dir, 'baseline.json') })
  const accept = (run, commit = 'abc1234') => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-baseline-'))
    const { last, baseline } = files()
    if (run !== undefined) fs.writeFileSync(last, typeof run === 'string' ? run : JSON.stringify(run))
    fs.writeFileSync(baseline, '{"old": true}')
    const result = acceptBaseline({ last, baseline, commit })
    return { ...result, baseline: JSON.parse(fs.readFileSync(baseline, 'utf8')) }
  }
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  it('makes a complete run of this commit the baseline', () => {
    const result = accept(aRun())
    expect(result.written).toBe(true)
    expect(result.baseline).toEqual(aRun())
  })

  it.each([
    ['fewer than 10 runs', aRun({ runs: 2 }), 'at least 10 runs'],
    ['a journey with fewer samples (it failed halfway)', aRun({ n: 9 }), 'slow-4g daily has 9 of 10 runs'],
    ['a journey missing', aRun({ drop: 'unthrottled offline' }), 'unthrottled offline has 0 of 10 runs'],
    ['a run of another commit', aRun({ commit: 'fff0000' }), 'measured fff0000'],
    ['no run at all', undefined, 'there is no last run'],
    ['a run that is not JSON', '{not json', 'not readable JSON'],
  ])('refuses %s, and leaves the baseline as it was', (_what, run, reason) => {
    const result = accept(run)
    expect(result.written).toBe(false)
    expect(result.reason).toContain(reason)
    expect(result.baseline).toEqual({ old: true })
  })
})
