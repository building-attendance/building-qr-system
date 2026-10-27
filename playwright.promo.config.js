// The recorder of the long promo (npm run promo:frames): the same machinery as the end-to-end run (the production build served by
// `vite preview`, the local API over a scratch schema), with its own ports, its own schema, its own invented building
// (scripts/promo/seed.mjs) and a clock set to the story's morning, and a spec that saves one picture per screen of the script into
// video/out/promo-frames/he/ with frames.json, instead of checking behaviour.
//
// It is NOT under e2e/ on purpose: `npm run test:e2e` and CI read playwright.config.js, whose testDir is ./e2e, so they never run this.
// tests/promo-capture.test.js holds that.
//
// It reads playwright.config.js instead of copying it: the build and the preview, the time zone, the location and the teardown that drops
// the schema. What it changes is below: the first web server seeds the promo's building instead of the sample data, and starts the API
// with the run's clock.
import { defineConfig, devices } from '@playwright/test'
import {
  PROMO_APP_PORT, PROMO_API_PORT, PROMO_SCHEMA, assertLocalPromo, checkPromoDay, promoClockFile, promoDay,
} from './scripts/promo/settings.mjs'

// playwright.config.js takes its ports and its schema from these three variables when it is read, so they are set first (and that is
// why it is imported below and not at the top). They are set here and not read from the shell: a value that is left over from an E2E run
// must not send the recorder to its schema.
process.env.E2E_APP_PORT = String(PROMO_APP_PORT)
process.env.E2E_API_PORT = String(PROMO_API_PORT)
process.env.E2E_SCHEMA = PROMO_SCHEMA
const { default: e2e } = await import('./playwright.config.js')

// The guard, before anything starts: only the local address and a scratch schema of its own. The seed and the spec check again.
assertLocalPromo({ baseURL: e2e.use?.baseURL, schema: PROMO_SCHEMA })

// The story's day, decided once for the whole run (the seed and the spec read it; a worker inherits it), so that a run that crosses
// midnight keeps one day. The API's clock is the real one until the spec sets it, through the file that the API is told about here.
process.env.PROMO_DAY = checkPromoDay(process.env.PROMO_DAY || promoDay()) // a day given in the shell is checked first
const clockFile = promoClockFile()

const [api, app] = e2e.webServer
const apiServer = {
  ...api,
  // The schema name is safe in a command: assertLocalPromo accepts only [a-z][a-z0-9_]{0,30}. The schema is dropped and made again
  // with the promo's building (never the sample data of the E2E run), then the API runs over it as app_runtime, with the run's clock.
  command:
    `node scripts/dev-seed.mjs ${PROMO_SCHEMA} --drop && node scripts/promo/seed.mjs ${PROMO_SCHEMA} && ` +
    `node --import ./scripts/promo/clock.mjs server/dev.mjs --schema=${PROMO_SCHEMA} --runtime-role`,
  env: { ...api.env, PROMO_DAY: process.env.PROMO_DAY, PROMO_CLOCK_FILE: clockFile },
}

export default defineConfig({
  ...e2e,
  testDir: './scripts/promo',
  testMatch: '*.spec.mjs',
  webServer: [apiServer, app],
  // One spec, one worker, in order: the committee's screens show the visits that the provider app made earlier in the run.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: false,
  failOnFlakyTests: false,
  timeout: 240_000,
  reporter: [['list']],
  use: {
    ...e2e.use,
    // The look of every picture: the light theme, Hebrew, no motion.
    colorScheme: 'light',
    locale: 'he-IL',
    reducedMotion: 'reduce',
    trace: 'off',
  },
  // One project, Chromium: each test sets the size of its own screen.
  projects: [{ name: 'promo', use: { ...devices['Desktop Chrome'] } }],
})
