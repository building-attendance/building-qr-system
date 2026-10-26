// Shared pieces for the end-to-end specs: a `page` that fails its test on unexpected console errors, the sample data
// of the scratch schema, and small helpers for signing in and for resetting what a test changed.
import { deflateSync, crc32 } from 'node:zlib'
import { test as base, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import he from '../src/i18n/he.js'
import en from '../src/i18n/en.js'
import ru from '../src/i18n/ru.js'
import { SAMPLE_POINT, SAMPLE_FAR_POINT, SAMPLE_PROVIDER_NAMES } from '../scripts/sample-data.mjs'
import { A11Y_BASELINE } from './a11y-baseline.js'
import { flattenViolations, compareWithBaseline, formatReport } from './a11y-report.js'

export { expect, he, en, ru, SAMPLE_POINT }

/** What the browser logs for every request that fails because the test switched the network off on purpose. */
export const OFFLINE_NOISE = /net::ERR_INTERNET_DISCONNECTED/

/**
 * Playwright's WebKit cannot take a page that a service worker serves offline: with the network switched off (or
 * every request aborted) the very first navigation fails with "WebKit encountered an internal error" or "Blocked by Web
 * Inspector", before the worker is asked. So the offline tests run on the Chromium project only, and offline use on an
 * iPhone is on the manual checklist (docs/manual-ios-checklist.md).
 */
export const skipOfflineOnWebKit = (browserName) =>
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot emulate offline for a service-worker page: see docs/manual-ios-checklist.md')

// Sample data created by scripts/dev-seed.mjs (dev-only values that exist only inside the scratch schema).
export const POINTS = {
  lobby: 'BQR-dev00000000000000000001', // GPS checked if available, open to everyone
  basement: 'BQR-dev00000000000000000002', // no GPS check
  gym: 'BQR-dev00000000000000000003', // GPS required, only for Ploni
  switchedOff: 'BQR-dev00000000000000000004', // the old point, switched off: a scan of it is refused (point_inactive)
}
export const PEOPLE = {
  ploni: { name: SAMPLE_PROVIDER_NAMES.cleaner, password: 'dev-pass-1' },
  john: { name: 'John', password: 'dev-pass-4' }, // reads English: he picks it on his phone, nobody sets it for him
}
export const ADMIN_EMAIL = 'dev@example.test'
export const BUILDING_ADDRESS = 'רחוב הדוגמה 1, עיר לדוגמה' // the invented address that scripts/dev-seed.mjs sets
export const BUILDING_NAME = 'בניין הדוגמה' // the invented name that scripts/dev-seed.mjs sets
export const FAR = { latitude: SAMPLE_FAR_POINT.lat, longitude: SAMPLE_FAR_POINT.lng, accuracy: 10 } // about 5.5 km from the sample points

// ---- console guard ---------------------------------------------------------------------------------------------

const allowed = new WeakMap()

/**
 * Lets one test expect a kind of console error, for example the browser's own note about a 401 that the test provokes
 * on purpose. Everything else that reaches the console as an error fails the test.
 */
export function allowConsoleErrors(page, ...patterns) {
  allowed.get(page).push(...patterns)
}

// ---- navigation: the page's requests are settled before its document is replaced -------------------------------------------
//
// THE RACE. WebKit (the iphone-webkit project) refuses a fetch that STARTS while it is replacing the page, and logs "Fetch API cannot
// load <url> due to access control checks". Playwright's WebKit driver reports every engine console error from the JavaScript source as
// a page error, so the console guard of the `page` fixture fails the test with `uncaught: //localhost:<port>/api/... due to access control checks.`
// Chromium logs nothing. The app is not at fault: its `api()` and its hooks catch the failed fetch, and it logs nothing itself. The
// message must never be allowed in the guard; the race is closed here instead. Measured on 08/10/2026:
//   - a fetch that is already in flight when the page is replaced (`page.goto` to another document, `page.reload`) is cancelled
//     quietly, with no error;
//   - a fetch that starts while the page is being replaced (from `pagehide`, from a timer during the swap, or from an effect that
//     runs late) is refused, and WebKit logs the message.
// A screen is drawn in one render and its requests start from effects a task later, sometimes through the service worker. So a test
// that navigates as soon as a heading shows can land in the gap, and under load the gap is wider. A wait for "the requests of this
// screen" depends on knowing which requests a screen makes, so it goes stale when a screen gains one; and a new test can forget it.
//
// THE WAIT. The `page` fixture wraps `page.goto` and `page.reload`. Before a call that replaces the document, it waits until the
// page has settled, and only then navigates. Nobody has to know which requests a screen makes, and a new test cannot repeat the mistake.
//   - Counting. An init script wraps `window.fetch` and counts the calls that have not finished (`window.__e2eFetches`). The count
//     is taken at the moment the app calls fetch, before the call has passed the service worker and reached the network, which is
//     exactly the gap above (Playwright's `request` events come after it). A call counts as finished when its answer has arrived in
//     full (the body too: the app acts on the body, not on the headers). The wrapper calls the real fetch through
//     `window.__e2eFetch`, looked up at call time, so a test can put something beneath the counter. It passes the arguments on and
//     returns the promise of the real call unchanged in value or in rejection. The init script is injected by the driver, not
//     written into the page, so the Content-Security-Policy of the preview does not apply to it (and it allows no inline script).
//     The apps make no XMLHttpRequest, `sendBeacon`, EventSource or WebSocket call, and every request goes through the one `fetch` in
//     src/api/client.js, so the count is complete. Images, scripts and styles are not fetches and were not seen to cause the message.
//   - Settled means: no counted call is pending, and none started across a flush of the page's pending work (one animation frame,
//     then one task: React runs the passive effects of a render in a task that was queued before the flush's own). It takes two such
//     quiet checks in a row, and the count is read again while calls are pending, because an answer can set state, render and start
//     the next call (the check-in's answer makes the home screen ask for today's visits again).
//   - There is a limit, 10 seconds. After it the test fails with the requests that were still pending, never a hang.
//   - Polling. The apps poll with a timer in two places (src/main.jsx: an hourly check for a new service worker, which is not a
//     fetch of the page; src/worker/hooks.js: the 30 second flush of the offline queue, which sends only if a visit waits). A poll
//     that fires while the page settles is counted like any other call. One that fires in the instant between the last check and the
//     navigation is the one case this cannot close; no test lands there.
//
// WHERE. The wait is in the navigation, not in `signIn` or `adminSignIn`, on purpose. "A tab that is opened by its address right
// after signing in" (e2e/admin.spec.js) needs `adminSignIn` to return the moment the shell appears and to wait for nothing before
// its next `page.goto`, which is a fragment change (below). And what matters is the request that starts during the swap, so the
// right moment to wait is right before the swap, whatever the test did before it.
//
// THE FRAGMENT. A `page.goto` whose address differs from the current page only by its fragment (`/admin` to `/admin#history`) is
// the same document: nothing is replaced, so nothing waits. A goto from `about:blank` (the first one of a test) has nothing to wait
// for either. Everything else waits, including a goto to an address with no fragment from one that has it, and a goto to the very
// address the page is on: WebKit loads a new document for it (measured), Chromium keeps the document, and waiting does no harm there.
//
// NO WAY AROUND IT, FOR NOW. A request that a test holds open on purpose (a `page.route` handler that does not answer yet) must be
// answered before the test navigates: the page cannot settle while it is pending, and the failure after 10 seconds names it. No test
// needs otherwise today (the answers that a11y.spec.js and admin.spec.js hold back are released before their next navigation), so
// there is no helper that navigates without the wait. The day a test must, add one here, next to `settleBeforeNavigating`, that keeps
// the unwrapped `goto` and `reload`, and give each use a comment that says why that navigation may not wait.

const SETTLE_LIMIT_MS = 10_000
const QUIET_CHECKS = 2

/**
 * The init script of the `page` fixture. It runs in the page before any script of the page (so before the app can call fetch), and
 * is serialised by Playwright: it must not use anything from this file.
 */
function countFetches() {
  const w = /** @type {any} */ (window)
  if (w.__e2eFetches) return
  /** @type {Map<number, string>} */
  const pending = new Map()
  /** @type {Array<() => void>} */
  let waiting = []
  const tracker = {
    started: 0,
    pending,
    /** Resolves when no counted call is pending any more. */
    whenDrained: () => (pending.size === 0 ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve))),
  }
  const finish = (/** @type {number} */ id) => {
    pending.delete(id)
    if (pending.size > 0) return
    const resolvers = waiting
    waiting = []
    for (const resolve of resolvers) resolve()
  }
  const describe = (/** @type {any} */ input, /** @type {any} */ init) => {
    try {
      const request = typeof input === 'string' || input instanceof URL ? null : input
      const method = (init && init.method) || (request && request.method) || 'GET'
      return `${String(method).toUpperCase()} ${new URL(request ? request.url : String(input), location.href).pathname}`
    } catch {
      return 'fetch'
    }
  }
  /** The whole body of a copy of the answer, or null when there is no copy to read. */
  const readCopy = (/** @type {Response} */ response) => {
    try {
      return response.clone().arrayBuffer()
    } catch {
      return null
    }
  }
  w.__e2eFetch = w.fetch
  w.__e2eFetches = tracker
  w.fetch = function fetch(/** @type {any[]} */ ...args) {
    tracker.started += 1
    const id = tracker.started
    pending.set(id, describe(args[0], args[1]))
    let call
    try {
      call = w.__e2eFetch(...args)
    } catch (error) {
      finish(id)
      throw error
    }
    return call.then(
      (/** @type {Response} */ response) => {
        // The headers are here; the body may not be. The app reads the body before it acts, so the call is finished when a copy of the
        // body has been read to its end (the app's own copy is untouched).
        const read = readCopy(response)
        if (read) read.then(() => finish(id), () => finish(id))
        else finish(id)
        return response
      },
      (/** @type {unknown} */ error) => {
        finish(id)
        throw error
      },
    )
  }
}

/**
 * Runs in the page: one step of settling. With calls pending it waits (at most `sliceMs`) until they have finished and says the page
 * is not quiet. With none pending it lets the page's pending work run, one animation frame and then one task, and says the page is
 * quiet if still nothing is pending and no call was made meanwhile. Returns null in a document without the counter.
 * @param {number} sliceMs
 */
async function flushPage(sliceMs) {
  const tracker = /** @type {any} */ (window).__e2eFetches
  if (!tracker) return null
  const startedBefore = tracker.started
  const pendingBefore = tracker.pending.size
  if (pendingBefore > 0) {
    await Promise.race([tracker.whenDrained(), new Promise((resolve) => setTimeout(resolve, sliceMs))])
  } else {
    await new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0))
      setTimeout(resolve, 100) // a page that is hidden draws no frames: the task alone is then the flush
    })
  }
  return {
    quiet: pendingBefore === 0 && tracker.pending.size === 0 && tracker.started === startedBefore,
    pending: [...tracker.pending.values()],
  }
}

/**
 * Waits until the page has settled (see above), or throws, after SETTLE_LIMIT_MS, with the calls that were still pending.
 * @param {import('@playwright/test').Page} page
 * @param {string} before  what the test is about to do, for the message
 */
async function settle(page, before) {
  const deadline = Date.now() + SETTLE_LIMIT_MS
  let quiet = 0
  let pending = /** @type {string[]} */ ([])
  while (quiet < QUIET_CHECKS) {
    const left = deadline - Date.now()
    if (left <= 0) {
      throw new Error(
        `The page did not settle within ${SETTLE_LIMIT_MS / 1000} s before ${before}. Still pending: ${pending.join(', ') || 'a call started after the last check'}. ` +
          'A request that the test holds open on purpose must be answered before the test navigates (see e2e/fixtures.js).',
      )
    }
    let step
    try {
      step = await page.evaluate(flushPage, Math.min(left, 1_000))
    } catch (error) {
      // The page navigated by itself while we looked: its new document has a fresh count, so start over.
      if (/context was destroyed|navigation|Navigation/.test(String(/** @type {Error} */ (error)?.message))) {
        quiet = 0
        continue
      }
      throw error
    }
    if (step === null) return // a document without the counter (an error page): nothing can be counted
    pending = step.pending
    quiet = step.quiet ? quiet + 1 : 0
  }
}

/**
 * True when navigating to `target` replaces the document that `current` is. Not when `current` is not a web page (about:blank, the
 * first goto of a test), and not when the two addresses differ only by their fragment (the same document, the fragment changes).
 * @param {string} current  page.url()
 * @param {string} target  what the test passed to goto
 * @param {string | undefined} base  the baseURL of the test, which Playwright resolves a relative address against
 */
function replacesTheDocument(current, target, base) {
  let from
  let to
  try {
    from = new URL(current)
    if (from.protocol !== 'http:' && from.protocol !== 'https:') return false
    to = new URL(target, base ?? current)
  } catch {
    return false // not an address: goto will say so
  }
  const withoutFragment = (/** @type {URL} */ url) => url.href.split('#')[0]
  const fragmentOnly = to.href.includes('#') && withoutFragment(to) === withoutFragment(from) && to.href !== from.href
  return !fragmentOnly
}

/**
 * Waits until the page has settled, the same wait as before a navigation (see above). For a test that checks what the page shows once
 * the answers to its requests have arrived and been drawn, for example that a screen did NOT break: right after a heading appears,
 * that check could pass before the answer that would break it.
 * @param {import('@playwright/test').Page} page
 */
export const pageSettled = (page) => settle(page, 'the next check')

/**
 * Makes `page.goto` and `page.reload` of this page settle the page first (see above). Same arguments, same results.
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined} baseURL
 */
function settleBeforeNavigating(page, baseURL) {
  const goto = page.goto.bind(page)
  const reload = page.reload.bind(page)
  page.goto = async (url, options) => {
    if (replacesTheDocument(page.url(), url, baseURL)) await settle(page, `goto ${url}`)
    return goto(url, options)
  }
  page.reload = async (options) => {
    await settle(page, 'reload')
    return reload(options)
  }
}

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const problems = []
    allowed.set(page, [])
    await page.addInitScript(countFetches)
    settleBeforeNavigating(page, baseURL)
    page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      if (allowed.get(page).some((pattern) => pattern.test(message.text()))) return
      problems.push(`console.error: ${message.text()}`)
    })
    await use(page)
    expect(problems, 'unexpected console errors').toEqual([])
  },
})

// ---- helpers ---------------------------------------------------------------------------------------------------

/** Picks a person on the sign-in list and signs in. `words` is the dictionary of the language the screen is in now. */
export async function signIn(page, person, words = he) {
  await page.getByRole('button', { name: new RegExp(person.name) }).click()
  await page.getByLabel(words['login.passwordLabel'], { exact: true }).fill(person.password)
  await page.getByRole('button', { name: words['login.submit'], exact: true }).click()
}

/**
 * The <h1> of each screen of the committee app, by the key of its address (`/admin#points`). In the order of the side rail; the first
 * screen, Home, is the one that opens when the address names none. Home's <h1> is a greeting that follows the hour of the building (and
 * the first word of the member's name), so its title is a pattern: the three greetings, with or without ", <name>".
 */
export const SCREEN_TITLES = Object.freeze({
  home: /^(בוקר טוב|צהריים טובים|ערב טוב)(, .+)?$/,
  history: 'היסטוריית נוכחות',
  points: 'נקודות סריקה',
  providers: 'נותני שירות',
  agent: "גישה לאייג'נט",
  settings: 'הגדרות',
  audit: 'יומן פעולות',
  help: 'איך עובדים עם המערכת',
})

/**
 * The name on the button of each screen, in the side rail and in the tab bar of the phone (`nav` in TABS, src/pages/AdminApp.jsx). The
 * tab bar has the first four; the others are under "עוד" on a phone, where the sheet says the whole name (SCREEN_LABELS; SCREEN_TITLES has the h1).
 */
export const SCREEN_NAV = Object.freeze({
  home: 'בית',
  history: 'היסטוריה',
  points: 'מיקומים',
  providers: 'ספקים',
  agent: 'אייג׳נט',
  settings: 'הגדרות',
  audit: 'יומן פעולות',
  help: 'עזרה',
})
/** The name of each screen as a page (`label` in TABS): the title of the window, and the name of its button in the sheet under "עוד". */
export const SCREEN_LABELS = Object.freeze({
  home: 'בית',
  history: 'היסטוריה',
  points: 'נקודות',
  providers: 'נותני שירות',
  agent: 'אייג׳נט',
  settings: 'הגדרות',
  audit: 'יומן פעולות',
  help: 'איך עובדים עם המערכת',
})
export const BAR_SCREENS = Object.freeze(['home', 'history', 'points', 'providers'])

/**
 * Opens a screen of the committee app from the navigation that is on the screen: the side rail on a computer; on a phone the button
 * of the tab bar, or, for the screens that the bar does not have, "עוד" and then the screen in its sheet. Waits for nothing else: the
 * caller waits for the screen it expects.
 */
export async function openScreen(page, key) {
  const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)', exact: true })
  if (!(await bar.isVisible())) {
    await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: SCREEN_NAV[key], exact: true }).click()
  } else if (BAR_SCREENS.includes(key)) {
    await bar.getByRole('button', { name: SCREEN_NAV[key], exact: true }).click()
  } else {
    await bar.getByRole('button', { name: 'עוד', exact: true }).click()
    await page.getByRole('dialog', { name: 'עוד', exact: true }).getByRole('button', { name: new RegExp(`^${SCREEN_LABELS[key]} `) }).click() // the row's name is the screen's name and the line under it
  }
}

/**
 * The account button of the committee app, the one that is on the screen: the initial in the top bar of a phone, the name and the e-mail
 * at the foot of the side rail on a computer (CSS hides the other, and a role query sees only what is shown).
 */
export const accountButton = (page) => page.getByRole('button', { name: /^החשבון שלי והגדרות/ })

/** Opens the account menu (src/admin/AccountMenu.jsx: the light / dark choice, the provider app, the sign-out) and returns it. */
export async function openAccountMenu(page) {
  await accountButton(page).click()
  const menu = page.getByRole('dialog', { name: 'החשבון שלי', exact: true })
  await expect(menu).toBeVisible()
  return menu
}

/** Signs out of the committee app, through the account menu. */
export async function signOut(page) {
  const menu = await openAccountMenu(page)
  await menu.getByRole('button', { name: 'יציאה', exact: true }).click()
}

// ---- the "more" menu of a tile -------------------------------------------------------------------------------------------------

/** The "more" button of a tile (a card or a row): "עוד פעולות ל<name>", so a tile is told from the next one by its own name. */
export const moreButton = (tile) => tile.getByRole('button', { name: /^עוד פעולות/ })

/** Opens the menu of a tile (src/admin/ui.jsx Menu) and returns it. */
export async function openTileMenu(tile) {
  await moreButton(tile).click()
  const menu = tile.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/** Chooses one action of the menu of a tile, by its name (the menu closes, and the action runs). Edit is the first of them: `chooseFromMenu(tile, 'עריכה')`. */
export async function chooseFromMenu(tile, name) {
  const menu = await openTileMenu(tile)
  await menu.getByRole('menuitem', { name, exact: true }).click()
}

/**
 * Signs the committee in through the local-only shortcut that the scratch-schema API offers, and waits for the first screen: the
 * history, unless the test names another one (`screen`, a key of SCREEN_TITLES), which is then the address that the sign-in starts from.
 * Home is the screen that the app opens when the address names none, so it is the one start that has no `#`: `adminSignIn(page, 'home')`
 * is the app opened the way a person opens it. The default stays the history, with its address, for the many tests that begin there.
 */
export async function adminSignIn(page, screen = 'history') {
  await page.goto(screen === 'home' ? '/admin' : `/admin#${screen}`)
  await page.getByRole('button', { name: 'כניסת פיתוח' }).click()
  await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[screen], exact: true })).toBeVisible()
}

// ---- the committee's Home screen ------------------------------------------------------------------------------------

/**
 * The seven days of the Home that the tests stub, the oldest first: a fixed week, so that a picture and a count do not depend on today.
 * The clock of a test that looks at the greeting is set to 12/10/2026 (`HOME_NOW`), the last of them.
 */
export const HOME_DAYS = Object.freeze(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'])
/** 10:00 on the last of HOME_DAYS in the building (UTC+3 in October): the morning, so the greeting is "בוקר טוב". */
export const HOME_NOW = '2026-10-12T07:00:00.000Z'
const homeId = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`
/**
 * The rows of the stubbed week table (the shape is `HomeWeekProvider` in shared/types.js), invented: a provider with every step of the
 * colour (1, 2 to 3, 4 to 6, 7 and over) and a zero, one with a contact name and a company, one with a name in Latin letters, one that is
 * switched off, one that was deleted (its visits stay), and one that did not come all week (an absence is information).
 */
export const HOME_PROVIDERS = Object.freeze([
  { id: homeId(1), name: SAMPLE_PROVIDER_NAMES.cleaner, company: 'ניקיון', is_active: true, counts: [1, 2, 0, 4, 7, 3, 2] },
  { id: homeId(2), name: SAMPLE_PROVIDER_NAMES.gardener, company: 'גינון', is_active: true, counts: [0, 0, 1, 0, 0, 12, 0] },
  { id: homeId(3), name: 'John', company: 'Cleaning Co', is_active: true, counts: [3, 3, 3, 3, 3, 0, 0] },
  { id: homeId(4), name: 'Иван', company: 'Уборка', is_active: false, counts: [0, 1, 0, 0, 0, 0, 0] },
  { id: homeId(5), name: 'ספק ישן', company: null, is_active: false, counts: [0, 0, 2, 0, 0, 0, 0] },
  { id: homeId(6), name: 'דנה', company: 'דנה', is_active: true, counts: [0, 0, 0, 0, 0, 0, 0] },
])

/**
 * What GET /api/admin/home answers in a test that stubs it (HomeSummary, shared/types.js): the week of `HOME_PROVIDERS` with its totals,
 * and the counts of the cards. `providers` and `counts` can be replaced.
 */
export function homeSummary({ providers = HOME_PROVIDERS, counts = {} } = {}) {
  return {
    days: [...HOME_DAYS],
    week: { providers: providers.map((p) => ({ ...p, counts: [...p.counts] })), totals: HOME_DAYS.map((_, i) => providers.reduce((sum, p) => sum + p.counts[i], 0)) },
    counts: {
      points: { active: 3, total: 4 },
      providers: { active: 5, total: 7 },
      committee_members: { active: 2 },
      agent_keys: { active: 1 },
      visits_not_counted: 3,
      waiting: { phones: 2, visits: 5 },
      ...counts,
    },
  }
}

/** Answers the Home screen's request with `summary` (default: `homeSummary()`). Call it after signing in and before Home is opened. */
export async function stubHome(page, summary = homeSummary()) {
  await page.route(/\/api\/admin\/home$/, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: summary }) : route.continue()))
}

// ---- pictures ---------------------------------------------------------------------------------------------------------------

/**
 * A PNG of `width` by `height` pixels, each pixel the RGB triple that `colourAt(x, y)` gives. Built by hand (a signature, then three
 * chunks) so that no binary file has to be committed for a picture that a test answers with.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => number[]} colourAt
 */
export function pngImage(width, height, colourAt) {
  const rows = Buffer.alloc((1 + width * 3) * height) // each row: a filter byte (0, none), then one RGB triple per pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(colourAt(x, y), y * (1 + width * 3) + 1 + x * 3)
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits per channel, RGB, the usual compression and filter, no interlacing
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The address of the committee member's Google photo in the tests: on Google's photo host (the one that the sign-in keeps and that the
 * Content-Security-Policy allows for pictures), made up, and never loaded from Google: `stubMemberPhoto` answers it.
 */
export const MEMBER_PHOTO_URL = 'https://lh3.googleusercontent.com/a/e2e-fake-member-photo=s96-c'

/**
 * The picture that stands for the member's photo: 96 by 96 pixels (the size Google gives), four squares of fixed colours, so that it is
 * plainly not a person, the same in every run (the visual baselines), and easy to tell from the violet tint of the circle.
 */
export const memberPhoto = () =>
  pngImage(96, 96, (x, y) => [[[22, 120, 110], [230, 160, 40]], [[60, 70, 90], [220, 90, 70]]][y < 48 ? 0 : 1][x < 48 ? 0 : 1])

/**
 * Gives the sample committee member (ADMIN_EMAIL) a Google photo: the answers that tell the committee app who is signed in (the dev
 * sign-in, GET /api/admin/me) and the members of Settings (GET /api/admin/admins) carry MEMBER_PHOTO_URL as the member's `picture_url`,
 * the way the server answers after a Google sign-in with a photo (the dev sign-in has no Google token, so the stored photo is empty),
 * and the photo's address is answered with `memberPhoto()`; `blocked: true` refuses it instead (offline, blocked, expired), so that the
 * app falls back to the initial. Returns the requests that were made for the photo, to check what they carried.
 * @param {import('@playwright/test').Page} page
 * @param {{ blocked?: boolean }} [options]
 */
export async function stubMemberPhoto(page, { blocked = false } = {}) {
  const withPhoto = (member) => (member?.email === ADMIN_EMAIL ? { ...member, picture_url: MEMBER_PHOTO_URL } : member)
  const answer = (change) => async (route) => {
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    return route.fulfill({ response, json: change(await response.json()) })
  }
  await page.route(/\/api\/admin\/(me|dev-login)$/, answer((body) => ({ ...body, admin: withPhoto(body.admin) })))
  await page.route(/\/api\/admin\/admins$/, (route) =>
    route.request().method() === 'GET' ? answer((body) => ({ ...body, admins: body.admins.map(withPhoto) }))(route) : route.continue())
  const requests = []
  const photo = memberPhoto()
  await page.route('https://lh3.googleusercontent.com/**', (route) => {
    requests.push(route.request())
    // A plain network failure: for a picture aborted as "blocked by client" WebKit fired no error event (seen on 14/10/2026), so the
    // app, rightly, kept waiting for it.
    return blocked ? route.abort('failed') : route.fulfill({ contentType: 'image/png', body: photo })
  })
  return requests
}

/** True when `img` has loaded a picture (its natural width is known), false while it loads or after it failed. */
export const photoLoaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0)

/** The committee app draws its phone layout below this width (`usePhoneLayout` in src/admin/hooks.js). Both E2E devices are narrower. */
export const COMPUTER_WIDTH = 1024
export const isPhoneLayout = (page) => page.viewportSize().width < COMPUTER_WIDTH

/**
 * Opens the sheet of filters that the History tab and the audit log have on a phone (src/admin/filters.jsx), and returns it. The button
 * is the one in the bar above the list: "סינון", with how many filters are on beside it (the chips' own buttons say "הסרת סינון").
 */
export async function openFilters(page) {
  await page.getByRole('button', { name: /^סינון/ }).click()
  const sheet = page.getByRole('dialog', { name: 'סינון', exact: true })
  await expect(sheet).toBeVisible()
  return sheet
}

/**
 * Changes the filters of the History tab or of the audit log, the same way on a phone and on a computer. `fill(scope)` is given where the
 * controls are and does the changing. On a computer that is `inline` (the page, or the section that holds them): the list follows the
 * controls by itself. On a phone the controls are in a sheet, so it is opened first, `fill` gets the sheet, and "הצגת תוצאות" is pressed
 * after it, because nothing is applied until then.
 */
export async function changeFilters(page, fill, inline = page) {
  if (!isPhoneLayout(page)) return fill(inline)
  const sheet = await openFilters(page)
  await fill(sheet)
  await sheet.getByRole('button', { name: 'הצגת תוצאות' }).click()
  await expect(sheet).toHaveCount(0)
}

/**
 * Below this width a date field of the committee app is a button that opens three wheels, and from it a field that takes typing with a
 * calendar beside it (`POPOVER_QUERY` in src/admin/ui.jsx, owner decision of 15/10/2026). Both E2E devices are narrower.
 */
export const WHEELS_WIDTH = 640
export const hasDateWheels = (page) => page.viewportSize().width < WHEELS_WIDTH

/** The sheet of the wheels that is open (a dialog named after the date it chooses), and the wheel `name` ("שנה", "חודש" or "יום") in it. */
export const dateWheels = (page) => page.getByRole('dialog').filter({ has: page.getByRole('listbox', { name: 'יום', exact: true }) })
export const wheel = (wheels, name) => wheels.getByRole('listbox', { name, exact: true })

/**
 * Turns the open wheels to `ddmmyyyy` (a day that is not after today) with a tap on a row of each wheel, as a person does: the year, the
 * month (its option is named by its name and its number) and the day (named by its full date). `how` is 'tap' (a touch) or 'click'.
 */
export async function turnWheels(wheels, ddmmyyyy, how = 'click') {
  const [, month, year] = ddmmyyyy.split('/') // the day is chosen by its full date
  await wheel(wheels, 'שנה').getByRole('option', { name: year, exact: true })[how]()
  await wheel(wheels, 'חודש').getByRole('option', { name: new RegExp(`, חודש ${Number(month)}$`) })[how]()
  await wheel(wheels, 'יום').getByRole('option', { name: ddmmyyyy, exact: true })[how]()
  await expect(wheel(wheels, 'יום').getByRole('option', { selected: true })).toHaveAccessibleName(ddmmyyyy)
}

/**
 * Sets the date field labelled `label` (in `scope`, the page or the sheet of filters) to `ddmmyyyy`, the way a person does at this width:
 * on a phone the field opens the wheels, which are turned to the date and closed with "אישור"; from 640 px the date is typed into the field.
 */
export async function setDate(scope, label, ddmmyyyy) {
  const page = typeof scope.page === 'function' ? scope.page() : scope // a locator, or the page itself
  const field = scope.getByLabel(label, { exact: true })
  if (!hasDateWheels(page)) {
    await field.fill('')
    await field.pressSequentially(ddmmyyyy.replace(/\//g, ''))
    return
  }
  await field.click()
  const wheels = dateWheels(page)
  await expect(wheels).toBeVisible()
  await turnWheels(wheels, ddmmyyyy)
  await wheels.getByRole('button', { name: 'אישור', exact: true }).click()
  await expect(wheels).toHaveCount(0)
  await expect(field).toHaveText(ddmmyyyy)
}

/**
 * Expects the date field `field` to show `date` (DD/MM/YYYY, a pattern, or '' for no date): the text of the button of a phone, the value
 * of the field of a computer. An empty button of a phone shows the placeholder, and a screen reader hears that nothing is chosen.
 */
export async function expectDate(field, date) {
  if (!hasDateWheels(field.page())) return expect(field).toHaveValue(date)
  if (date === '') return expect(field).toHaveAccessibleName(/ לא נבחר DD\/MM\/YYYY$/)
  return expect(field).toHaveText(date)
}

/**
 * The request that an app makes to report its errors (src/ui/errorReport.js): a POST to `path` (`/api/my/errors` for the provider app,
 * `/api/admin/client-errors` for the committee app). Pass it to `page.waitForRequest`, which must be called before the action that
 * makes the app send it.
 */
export const isErrorReport = (path) => (request) => request.method() === 'POST' && new URL(request.url()).pathname === path

/**
 * Checks a request that an app made to report its errors: the server answered 200, and the body is `{ events }` with exactly the events
 * in `expected` (`kind`, `place` and a `name` or a `code`; `count` is 1 unless it says), each with the build of an end-to-end run
 * ('dev') and with no other field. Nothing that says what happened is in the body: no message, no stack, no address, no token, no QR code.
 */
export async function expectErrorReport(request, expected) {
  const raw = request.postData() ?? ''
  const body = JSON.parse(raw)
  expect(Object.keys(body), 'the body is only a list of events').toEqual(['events'])
  expect(body.events).toHaveLength(expected.length)
  expected.forEach((want, i) => {
    const event = body.events[i]
    expect(Object.keys(event).sort(), `the fields of event ${i}`).toEqual([...Object.keys(want), 'build', 'count'].sort())
    expect(event).toEqual({ ...want, build: 'dev', count: 1, ...(want.count ? { count: want.count } : {}) })
  })
  expect(raw).not.toMatch(/message|stack|Cannot read|https?:|\.js|qrp_|BQR-/)
  const response = await request.response()
  expect(response?.status(), 'the server took the report').toBe(200)
}

/** Deletes every scan, so that each test starts without the visits an earlier one made (the cooldown would hide them). */
export async function clearScans(request) {
  const login = await request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
  expect(login.ok(), 'dev admin sign-in').toBeTruthy()
  const list = await request.get('/api/admin/scans?limit=500&outcome=all&include_voided=true&include_demo=true')
  for (const scan of (await list.json()).scans) {
    const del = await request.delete(`/api/admin/scans/${scan.id}`, { data: {} })
    expect(del.ok(), `delete scan ${scan.id}`).toBeTruthy()
  }
}

// ---- accessibility ---------------------------------------------------------------------------------------------

/**
 * The rules that the scan runs: WCAG 2.1 level A and AA (the level that tests/contrast.test.js holds the colour tokens to),
 * the one rule that WCAG 2.2 level AA adds in axe (`target-size`, the size of a touch target: rule T1 of docs/design.md),
 * and axe's `best-practice` rules. The last are not WCAG success criteria: they are the good practice that screen-reader
 * users feel, mostly the structure of the page (one banner and one main landmark, landmarks that can be told apart, a
 * heading level that follows the one before it, everything inside a landmark).
 */
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

/**
 * Scans the page as it is now with axe-core (A11Y_TAGS: WCAG 2.1 A and AA, WCAG 2.2 AA, and best practice) and fails the test, with a list that says what
 * is wrong and where, when it finds a problem that e2e/a11y-baseline.js does not list. The test goes on after a failure
 * (a soft expectation), so one run lists every screen that has a problem.
 *
 * - `context` names the screen and is how the report and the baseline find it, so it is unique per scan ("provider he:
 *   sign-in list [dark]").
 * - `exclude` is a list of CSS selectors that axe must not look into: only content that is not ours (a third party's
 *   iframe), each one explained where it is written.
 *
 * The baseline is matched exactly: a baseline entry covers one rule on one element (the CSS target) of one screen. A new
 * problem of the same rule on another element still fails, and so does a baseline entry whose problem is gone, so the
 * list cannot go stale.
 *
 * What axe cannot decide ("incomplete" in its result) is not a failure. For colours that is the text of a `<select>`
 * (the arrow is a background image) and some text inside a dialog (axe cannot tell what the fixed overlay covers); the
 * colour tokens of those are held to AA by tests/contrast.test.js.
 */
export async function expectNoA11yViolations(page, { context, exclude = [] }) {
  // Scan the page in its settled state. A colour that is still on its way (a fade, or a transition that a change of theme
  // just started: WebKit keeps showing the text of the light theme on the dark page until a frame has been drawn) would be
  // measured as it is at that moment. So every animation and transition is switched off first, which puts every element
  // at its end state at once, the way Playwright does for a screenshot.
  //
  // The rule goes in through the CSSOM (a constructed stylesheet that the document adopts), not as a style element: the
  // page's Content-Security-Policy has no 'unsafe-inline' in style-src, and a style element that a script adds is an inline
  // style, which the policy refuses. A stylesheet built in script is not subject to style-src, so this works under it. It
  // is added once per document, and stays until the page is navigated away (as the style element did).
  await page.evaluate(() => {
    if (!window.__a11ySettled) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync('*, *::before, *::after { animation: none !important; transition: none !important; }')
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      window.__a11ySettled = sheet
    }
    void getComputedStyle(document.body).color // applies the style now
  })
  // Legacy mode runs axe in the page itself, without the extra page that axe-core/playwright opens to join the results of
  // frames: about twice as fast, and the only thing it gives up is a look into cross-origin iframes, which are excluded.
  const builder = new AxeBuilder({ page }).withTags(A11Y_TAGS).setLegacyMode()
  for (const selector of exclude) builder.exclude(selector)
  const { violations } = await builder.analyze()

  const report = compareWithBaseline(flattenViolations(violations), A11Y_BASELINE, context)
  expect.soft(report.fresh.length + report.gone.length, formatReport(context, report)).toBe(0)
}
