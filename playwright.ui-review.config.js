// The pictures of the UI review (npm run ui-review:pictures, docs/testing.md and the ui-review skill): the same machinery as the
// end-to-end run (the production build served by `vite preview`, the local API over a scratch schema with the dev-only committee
// sign-in), with its own ports and its own schema, a seed with the worst-case fake data of scripts/ui-review/worst-case.mjs, and a spec
// that takes pictures instead of checking behaviour.
//
// It is NOT under e2e/ on purpose: `npm run test:e2e` and CI read playwright.config.js, whose testDir is ./e2e, so they never run this.
// tests/ui-review.test.js holds that. It does not change the sample data (the schema is its own and it adds to a copy of that data),
// any README picture or any visual baseline, and the pictures go to a folder that git ignores.
//
// It reads playwright.config.js instead of copying it: the web servers, the time zone, the location and the teardown that drops the
// schema. What it changes is below. The ports and the schema have defaults of their own and can be changed (UI_REVIEW_APP_PORT,
// UI_REVIEW_API_PORT, UI_REVIEW_SCHEMA), for a second run on the same machine.
import { defineConfig, devices } from '@playwright/test'
import { uiReviewSettings, assertLocalUiReview, outDir } from './scripts/ui-review/settings.mjs'

const { appPort, apiPort, schema } = uiReviewSettings()

// playwright.config.js takes its ports and its schema from these three variables when it is read, so they are set first (and that is why
// it is imported below and not at the top: an import is read before any line of this file runs). They are set here and not read from
// the shell: a value that is left over from an E2E run must not send the pictures to its schema.
process.env.E2E_APP_PORT = String(appPort)
process.env.E2E_API_PORT = String(apiPort)
process.env.E2E_SCHEMA = schema
const { default: e2e } = await import('./playwright.config.js')

// The guards, before anything starts: only the local address and a scratch schema of our own, and a folder for the pictures that git
// ignores. The spec checks the address again with the one that the browser really uses.
assertLocalUiReview({ baseURL: e2e.use?.baseURL, schema })
outDir()

// The seed replaces the one of playwright.config.js: the same dev seed first (inside scripts/ui-review/seed.mjs), then the worst case.
// The schema name is safe to put in a command: uiReviewSettings accepts only [a-z][a-z0-9_]{0,30}.
const [api, preview] = e2e.webServer ?? []

export default defineConfig({
  ...e2e,
  testDir: './scripts/ui-review',
  testMatch: '*.spec.mjs',
  // One spec, one worker, in order: the empty building is made from the same schema after the pictures of the full one.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: false,
  failOnFlakyTests: false,
  // A picture can take a while on a long screen in four languages and two themes, and a build is not part of it.
  timeout: 180_000,
  // the list of tests, then where the pictures went (scripts/ui-review/reporter.mjs)
  reporter: [['list'], ['./scripts/ui-review/reporter.mjs']],
  use: {
    ...e2e.use,
    // The look of every picture, so that a run on another machine gives the same one: Hebrew, no motion. The theme is chosen per picture.
    locale: 'he-IL',
    reducedMotion: 'reduce',
    trace: 'off',
  },
  // One project: each test sets the size of its own screen (a phone or a computer), in Chromium. The E2E projects (a Pixel and an
  // iPhone) would run every picture twice.
  projects: [{ name: 'ui-review', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      ...api,
      command: `node scripts/dev-seed.mjs ${schema} --drop && node scripts/ui-review/seed.mjs ${schema} && node server/dev.mjs --schema=${schema}`,
    },
    preview,
  ],
})
