// The timing of the scan (npm run perf:scan, docs/testing.md "Timing a scan"). No browser and no database: the run is
// checked for being kept out of the E2E run (so CI never measures, and a measurement never slows CI), for its own ports and
// schema, and the baseline that it compares with is checked for its shape.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

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

  it('is run by npm run perf:scan with that config, and by no other script', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(scripts['perf:scan']).toBe(`playwright test --config ${perfConfig}`)
    expect(scripts['test:e2e']).toBe('playwright test')
    for (const [name, command] of Object.entries(scripts)) {
      if (name !== 'perf:scan') expect(command, name).not.toContain(perfConfig)
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
  })
})
