// The page of the committee app's shared components on their own (e2e/harness/): built once per test run with Vite, and served to a
// test's page at /__harness/ on the app's own address, by the page itself (page.route), so no server and no port is added. It is how
// the tests reach a component before any screen of the app uses it (the "more" menu), and a dialog at any width without the screens
// around it. Nothing of it goes into the app's build: Vite builds it here, into the cache folder of the run (node_modules/.cache, which
// git, ESLint and the text rules leave alone).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { e2eSettings } from '../scripts/e2e-config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.join(HERE, 'harness')
// One folder per scratch schema, as the run's own build is: two runs side by side (docs/testing.md) do not empty each other's.
const OUT = path.join(HERE, '..', 'node_modules', '.cache', 'bqr-e2e', e2eSettings().schema, 'harness')
const BASE = '/__harness/'

let built
const routed = new WeakSet() // the pages that already answer for /__harness/ (a test may open the page twice)
/** Builds the page once per worker process (a failed test restarts the worker, which builds it again: a second or two). */
function buildOnce() {
  built ??= build({
    configFile: false, // not the app's vite.config.js: no PWA, no service worker, no proxy
    root: SOURCE,
    base: BASE,
    logLevel: 'warn',
    oxc: { jsx: { runtime: 'automatic' } }, // the components are JSX without an import of React, as in vitest.config.js
    build: { outDir: OUT, emptyOutDir: true, minify: false, reportCompressedSize: false },
  })
  return built
}

/**
 * Opens the page of the components in `page`, laid out right to left (`dir: 'ltr'` for left to right). The test's page answers every
 * request under /__harness/ from the built folder, so the page has the address of the app (its baseURL) and no Content-Security-Policy.
 */
export async function openHarness(page, { dir = 'rtl' } = {}) {
  await buildOnce()
  if (!routed.has(page)) {
    routed.add(page)
    await page.route(`**${BASE}**`, (route) => {
      const file = path.join(OUT, decodeURIComponent(new URL(route.request().url()).pathname).slice(BASE.length) || 'index.html')
      return file.startsWith(OUT) && fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: 'not in the harness' })
    })
  }
  await page.goto(`${BASE}index.html${dir === 'ltr' ? '?dir=ltr' : ''}`)
  await page.getByRole('heading', { level: 1, name: 'הרכיבים המשותפים' }).waitFor()
}
