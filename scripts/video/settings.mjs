// What the recorder of the provider tutorial video (npm run video:frames) shares: where it runs, where its frames go, and the guard
// that keeps the run on the developer's own machine, in a scratch schema of its own. Node built-ins and the settings files of the
// other tools only, so that playwright.video.config.js, scripts/video/record.spec.mjs and tests/video-script.test.js can all import it.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SCHEMA } from '../e2e-config.mjs'
import { SCREENSHOTS_SCHEMA, assertLocalScratch } from '../screenshots/settings.mjs'
import { UI_REVIEW_SCHEMA } from '../ui-review/settings.mjs'

// The run is a Playwright run of its own and reuses the machinery of the E2E run (playwright.config.js reads the three settings as
// E2E_APP_PORT, E2E_API_PORT and E2E_SCHEMA). Its values are away from the development servers (3000, 3001), the E2E runs (3100, 3101,
// 3200, 3201), the README screenshots (3300, 3301), the UI review (3400, 3401) and the timings (3700 to 3721). They are fixed, like the
// README screenshots': a value left in the shell by another run must never send the recorder to that run's schema.
export const VIDEO_APP_PORT = 3600
export const VIDEO_API_PORT = 3601
export const VIDEO_SCHEMA = 'video'

/** The project root, with the separator of this system and a closing one. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The folder of the frames, from the project root. It is in .gitignore (tests/video-script.test.js holds that): nothing in it is committed. */
export const VIDEO_OUT_DIR = 'video/out'

/** The folder of one language's frames and its scenes.json, as an absolute path. */
export const languageOutDir = (lang) => path.join(ROOT, VIDEO_OUT_DIR, lang)

// Schemas that belong to other tools, each of which drops or remakes its own (the E2E run and the README screenshots drop theirs before
// and after a run, the UI review likewise, the timings make theirs fresh). public, dev_ui and neon_auth are refused for every tool by
// parseE2eSchema, inside assertLocalScratch.
const OTHER_TOOLS = Object.freeze({
  [DEFAULT_SCHEMA]: "it is the E2E run's",
  [SCREENSHOTS_SCHEMA]: "it is the README screenshots'",
  [UI_REVIEW_SCHEMA]: "it is the UI review's",
  perf: "it is the scan timing's",
  perf_api: "it is the API timing's",
  perf_screens: "it is the screen timing's",
})

const PREFIX = 'Refusing to record the video'

/**
 * The guard of the run. The frames are taken of the fake sample data in a scratch schema, on this machine, and of nothing else. Throws,
 * with a message that says what was wrong, unless
 *  - the address of the app is `http://localhost:<port>` or `http://127.0.0.1:<port>` (the README screenshots' guard: never another
 *    host, never https), and
 *  - the schema is a scratch schema that is not public, dev_ui or neon_auth, and not the schema of another tool (OTHER_TOOLS).
 * It runs when the config is read, and again in the spec with the address that Playwright really uses.
 * @param {{ baseURL: string | undefined, schema: string | undefined }} where
 */
export function assertLocalVideo({ baseURL, schema }) {
  if (typeof schema === 'string' && Object.hasOwn(OTHER_TOOLS, schema)) {
    throw new Error(`${PREFIX} in the schema "${schema}": ${OTHER_TOOLS[schema]}, which drops it before and after every run.`)
  }
  try {
    return assertLocalScratch({ baseURL, schema })
  } catch (err) {
    // The check is the README screenshots', so its message names them, which is not what the person who ran this did.
    throw new Error(String(err.message).replace(/^Refusing to take screenshots/, PREFIX), { cause: err })
  }
}
