// The recorder of the provider tutorial video (npm run video:frames): the same machinery as the end-to-end run (the production build
// served by `vite preview`, the local API over a scratch schema with the fake sample data), with its own ports and its own schema, and a
// spec that saves one picture per beat of the script (video/script/) instead of checking behaviour.
//
// It is NOT under e2e/ on purpose: `npm run test:e2e` and CI read playwright.config.js, whose testDir is ./e2e, so they never run this.
// tests/video-script.test.js holds that.
//
// It reads playwright.config.js instead of copying it: the web servers (a fresh scratch schema with the seed, the API, the build and
// the preview), the time zone, the location and the teardown that drops the schema. What it changes is below.
import { defineConfig, devices } from '@playwright/test'
import { VIDEO_APP_PORT, VIDEO_API_PORT, VIDEO_SCHEMA, assertLocalVideo } from './scripts/video/settings.mjs'

// playwright.config.js takes its ports and its schema from these three variables when it is read, so they are set first (and that is
// why it is imported below and not at the top: an import is read before any line of this file runs). They are set here and not read
// from the shell: a value that is left over from an E2E run must not send the recorder to its schema.
process.env.E2E_APP_PORT = String(VIDEO_APP_PORT)
process.env.E2E_API_PORT = String(VIDEO_API_PORT)
process.env.E2E_SCHEMA = VIDEO_SCHEMA
const { default: e2e } = await import('./playwright.config.js')

// The guard, before anything starts: only the local address and a scratch schema of its own. The spec checks again with the address
// that the browser really uses.
assertLocalVideo({ baseURL: e2e.use?.baseURL, schema: VIDEO_SCHEMA })

export default defineConfig({
  ...e2e,
  testDir: './scripts/video',
  testMatch: '*.spec.mjs',
  // One spec, one worker, in order: the scenes follow one person through the app, and the sign is taken last.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: false,
  failOnFlakyTests: false,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    ...e2e.use,
    // The look of every frame, so that a run on another machine gives the same one: the light theme, Hebrew, no motion.
    colorScheme: 'light',
    locale: 'he-IL',
    reducedMotion: 'reduce',
    trace: 'off',
  },
  // One project, Chromium: each test sets the size of its own screen. The E2E projects (a Pixel and an iPhone) would record twice.
  projects: [{ name: 'video', use: { ...devices['Desktop Chrome'] } }],
})
