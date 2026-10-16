// What the UI review pictures (npm run ui-review:pictures, docs/testing.md) share: where they run, where they go, and the guards that
// keep the run on the developer's own machine, in a scratch schema, and the pictures out of the files that git tracks. Node built-ins
// and the two settings files of the other tools only, so that the Playwright config, the spec, the seed and tests/ui-review.test.js can
// all import it.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseE2eSchema, parsePort } from '../e2e-config.mjs'
import { SCREENSHOTS_SCHEMA, assertLocalScratch } from '../screenshots/settings.mjs'

// The run is a Playwright run of its own and reuses the machinery of the E2E run (playwright.config.js reads the three settings as
// E2E_APP_PORT, E2E_API_PORT and E2E_SCHEMA). Its defaults are away from the development servers (3000, 3001), the E2E runs (3100,
// 3101, 3200, 3201), the README screenshots (3300, 3301) and the timings (3700 and up). Each can be changed for a second run on the
// same machine, as an E2E run can (docs/testing.md, "Two E2E runs on one machine"), with its own value of all three.
export const UI_REVIEW_APP_PORT = 3400
export const UI_REVIEW_API_PORT = 3401
export const UI_REVIEW_SCHEMA = 'ui_review'

/** The project root, with the separator of this system and a closing one. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The folder of the pictures when UI_REVIEW_OUT is not set, from the project root. It is in .gitignore (tests/ui-review.test.js). */
export const DEFAULT_OUT_DIR = 'ui-review-pictures'

/** The folders inside the project where the pictures may go: the default one and node_modules (a folder in it, not the folder itself), both ignored by git. */
export const IGNORED_OUT_DIRS = Object.freeze([DEFAULT_OUT_DIR, 'node_modules'])

// Schemas that belong to other tools, which would empty them (the E2E run and the README screenshots drop theirs before and after a
// run, the timings make theirs fresh, and dev_ui, public and neon_auth are refused by parseE2eSchema for every tool).
const OTHER_TOOLS = Object.freeze({
  e2e: "it is the E2E run's",
  [SCREENSHOTS_SCHEMA]: "it is the README screenshots'",
  perf: "it is the scan timing's",
  perf_api: "it is the API timing's",
  perf_screens: "it is the screen timing's",
})

/**
 * The schema half of the guard: a scratch schema that no other tool uses. Returns the name, or throws.
 * @param {string | undefined} value
 */
export function parseUiReviewSchema(value) {
  const name = parseE2eSchema(value === undefined || value === '' ? UI_REVIEW_SCHEMA : value) // throws for a bad name, public, dev_ui, neon_auth
  if (Object.hasOwn(OTHER_TOOLS, name)) {
    throw new Error(`UI_REVIEW_SCHEMA "${name}" is refused: ${OTHER_TOOLS[name]}, which drops it. Pick another name (the default is ${UI_REVIEW_SCHEMA}).`)
  }
  return name
}

/**
 * The settings of one run, from UI_REVIEW_APP_PORT, UI_REVIEW_API_PORT and UI_REVIEW_SCHEMA (the defaults above when they are not
 * set). Throws, before anything is started, for a value that is not valid or when the two ports are the same.
 * @param {Record<string, string | undefined>} [env]
 */
export function uiReviewSettings(env = process.env) {
  const appPort = parsePort('UI_REVIEW_APP_PORT', env.UI_REVIEW_APP_PORT, UI_REVIEW_APP_PORT)
  const apiPort = parsePort('UI_REVIEW_API_PORT', env.UI_REVIEW_API_PORT, UI_REVIEW_API_PORT)
  if (appPort === apiPort) throw new Error(`UI_REVIEW_APP_PORT and UI_REVIEW_API_PORT must differ (both are ${appPort}).`)
  return { appPort, apiPort, schema: parseUiReviewSchema(env.UI_REVIEW_SCHEMA) }
}

/**
 * The guard of the run, the same as the README screenshots': the address of the app is `http://localhost` or `http://127.0.0.1`, and the
 * schema is one that parseUiReviewSchema accepts. It runs when the config is read, and again in the spec with the address that
 * Playwright really uses.
 * @param {{ baseURL: string | undefined, schema: string | undefined }} where
 */
export function assertLocalUiReview({ baseURL, schema }) {
  const name = parseUiReviewSchema(schema)
  assertLocalScratch({ baseURL, schema: name }) // the README screenshots' guard of the address (and a second look at the schema)
  return { schema: name }
}

/**
 * The folder of the pictures, as an absolute path: UI_REVIEW_OUT (an absolute path, or one from the project root), or the default
 * folder. A folder outside the project is taken as it is. A folder inside it must be one that git ignores (IGNORED_OUT_DIRS),
 * because the pictures are never committed: they are not baselines, and the README pictures and the visual baselines change only on
 * purpose, with the owner looking at each one. Throws for any other folder in the project.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]  the project root
 */
export function outDir(env = process.env, root = ROOT) {
  const given = env.UI_REVIEW_OUT
  const dir = path.resolve(root, given === undefined || given === '' ? DEFAULT_OUT_DIR : given)
  const relative = path.relative(path.resolve(root), dir)
  const outside = relative.startsWith('..') || path.isAbsolute(relative) // another folder, or another drive
  if (!outside) {
    const [top, ...below] = relative.split(path.sep)
    const ignored = top === DEFAULT_OUT_DIR || (top === 'node_modules' && below.length > 0)
    if (!ignored) {
      throw new Error(
        `UI_REVIEW_OUT "${given}" is inside the project and git does not ignore it. ` +
          `Use a folder outside the project, or one under ${IGNORED_OUT_DIRS.join('/ or ')}/. The pictures are never committed.`,
      )
    }
  }
  return dir
}
