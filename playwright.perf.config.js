// How long the service provider's scan takes on a phone: `npm run perf:scan` (docs/testing.md, "Timing a scan"). It is a
// measurement, not a test of what is right, so it is not part of `npm run test:e2e` or of CI: the timings of a shared CI
// runner are noise. Like playwright.screenshots.config.js, it reads playwright.config.js instead of copying it (the web
// servers: a fresh scratch schema with the seed, the API, the build and the preview; the time zone, the location and the
// teardown that drops the schema), with ports and a schema of its own, so that it can run next to a development server
// (3000, 3001), an E2E run (3100, 3101), a second E2E run (3200, 3201) and the screenshots (3300, 3301).
//
// It is NOT under e2e/ on purpose: `npm run test:e2e` and CI read playwright.config.js, whose testDir is ./e2e, so they never
// run this. tests/perf-scan.test.js holds that.
import { defineConfig, devices } from '@playwright/test'

export const PERF_APP_PORT = 3700
export const PERF_API_PORT = 3701
export const PERF_SCHEMA = 'perf'

// playwright.config.js takes its ports and its schema from these three variables when it is read, so they are set first (and
// that is why it is imported below and not at the top). They are set here and not read from the shell: a value that is left
// over from an E2E run must not send the measurement to its schema.
process.env.E2E_APP_PORT = String(PERF_APP_PORT)
process.env.E2E_API_PORT = String(PERF_API_PORT)
process.env.E2E_SCHEMA = PERF_SCHEMA
const { default: e2e } = await import('./playwright.config.js')

export default defineConfig({
  ...e2e,
  testDir: './scripts/perf',
  testMatch: '*.spec.mjs',
  // One worker, in order: every journey works on the same sample point and clears its visits between runs.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  failOnFlakyTests: false,
  timeout: 20 * 60_000,
  reporter: [['list']],
  // Chromium only: the CPU and network throttling come from the Chrome DevTools Protocol, which WebKit does not have.
  projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }],
})
