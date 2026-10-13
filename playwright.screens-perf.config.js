// How long the committee's screens take to show their content on a year of data: `npm run perf:screens` (docs/testing.md, "Timing the
// committee's screens"). It is a measurement, not a test of what is right, so it is not part of `npm run test:e2e` or of CI: the timings
// of a shared CI runner are noise. Like playwright.perf.config.js (the scan timing), it reads playwright.config.js instead of copying it
// (the production build and its preview, the time zone, the API's environment), with ports and a schema of its own, so that it can run
// next to a development server (3000, 3001), an E2E run (3100, 3101), the screenshots (3300, 3301), the scan timing (3700, 3701) and the
// API timing (3711). The one difference from the scan timing is the data: the API starts on a year of invented data made by
// scripts/perf/year-data.mjs (x1: about 14,600 visits), not on the four points of scripts/dev-seed.mjs.
//
// The spec is NOT under e2e/ and is not called *.spec.mjs on purpose: `npm run test:e2e` and CI read playwright.config.js, whose testDir
// is ./e2e, and playwright.perf.config.js runs every *.spec.mjs of scripts/perf. tests/perf-screens.test.js holds both.
import { defineConfig, devices } from '@playwright/test'

export const SCREENS_APP_PORT = 3720
export const SCREENS_API_PORT = 3721
export const SCREENS_SCHEMA = 'perf_screens'
export const SCREENS_SPEC = 'screen-timing.playwright.mjs'

// playwright.config.js takes its ports and its schema from these three variables when it is read, so they are set first (and that is why
// it is imported below and not at the top). They are set here and not read from the shell: a value that is left over from an E2E run must
// not send the measurement to its schema. The teardown and the spec read the schema from the same variable.
process.env.E2E_APP_PORT = String(SCREENS_APP_PORT)
process.env.E2E_API_PORT = String(SCREENS_API_PORT)
process.env.E2E_SCHEMA = SCREENS_SCHEMA
const { default: e2e } = await import('./playwright.config.js')
const [api, preview] = e2e.webServer

export default defineConfig({
  ...e2e,
  testDir: './scripts/perf',
  testMatch: SCREENS_SPEC,
  // One worker, in order: the spec signs in once for each device and visits the screens one after the other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  failOnFlakyTests: false,
  timeout: 20 * 60_000,
  reporter: [['list']],
  // Drops the scratch schema (only a schema that year-data.mjs made: it leaves a mark).
  globalTeardown: './scripts/perf/screen-teardown.mjs',
  // The spec makes its own browser contexts (a Pixel 7 and a computer window), both Chromium: the CPU and network throttling come from the
  // Chrome DevTools Protocol, which WebKit does not have.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      ...api,
      // The year of data (x1) in the scratch schema, then the API on top of it (dev.mjs turns the dev-only sign-in on for a scratch schema).
      command: `node scripts/perf/year-data.mjs ${SCREENS_SCHEMA} --scale=1 && node server/dev.mjs --schema=${SCREENS_SCHEMA}`,
      timeout: 300_000,
    },
    preview,
  ],
})
