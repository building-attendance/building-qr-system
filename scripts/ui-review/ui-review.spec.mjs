// Takes the pictures of the UI review (npm run ui-review:pictures, docs/testing.md, step 3 of the ui-review skill). It is not a test of the
// app: it drives the two apps the way the E2E specs do and saves what is on the screen, so that a review looks at every screen on the
// worst-case fake data (scripts/ui-review/worst-case.mjs) in the languages, themes and widths that the apps run in, and not on the
// ordinary sample rows that make every screen look right.
//
// What it shows is the fake data of the scratch schema and nothing else (assertLocalUiReview refuses to run on anything but a local
// address and a schema of its own). The pictures are not baselines and are never committed: they go to UI_REVIEW_OUT, or to a folder
// that git ignores (scripts/ui-review/settings.mjs). A picture of a screen is taken whole, up to MAX_HEIGHT, light and dark.
//
// The order matters: the pictures of the full building come first, and then the building is made empty (the seed with --empty) for the
// pictures of the empty states. `--grep <words>` runs the tests whose title has the words, for example `--grep providers`.
//
// What a program can see without looking is a note, printed as it happens and again at the end of the run (`note` below): a console error
// of the app (the E2E specs fail a test for one), a page that scrolls sideways, a button that cannot be tapped. A note is a finding of the
// review but not a reason to lose the pictures. An uncaught error of the page does fail the test.
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { devices } from '@playwright/test'
import { test, expect, he, en, ru, POINTS, OFFLINE_NOISE, SCREEN_TITLES, allowConsoleErrors, pageSettled, signIn, openAccountMenu } from '../../e2e/fixtures.js'
import ar from '../../src/i18n/ar.js'
import { ROOT, outDir, assertLocalUiReview, uiReviewSettings } from './settings.mjs'
import { PLAIN_ADMIN, PROVIDERS, SIGN_IN } from './worst-case.mjs'

const OUT = outDir()
const { schema: SCHEMA } = uiReviewSettings()

/** The tallest picture of a whole screen, in pixels: a longer one is cut (the Agent screen ends in ten kilobytes of text). */
const MAX_HEIGHT = 4000
const AGENT_HEIGHT = 1500

// The screens. The provider app is checked at 390 px, the committee app at 360 px (a phone) and at 1280 px (a computer): the widths that
// the layouts are checked at (AGENTS.md). One CSS pixel per pixel of the picture. A phone is a touch device, a computer is not.
// (the device's own browser type is left out: a describe group may not change the browser, and this is Chromium anyway)
const pixel = { ...devices['Pixel 7'] }
delete pixel.defaultBrowserType
const phone = (width, height) => ({ ...pixel, viewport: { width, height }, screen: { width, height }, deviceScaleFactor: 1 })
const PROVIDER_PHONE = phone(390, 844)
const COMMITTEE_PHONE = phone(360, 740)
const COMMITTEE_COMPUTER = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }

const DICTS = { he, en, ru, ar }
const LANGUAGES = Object.keys(DICTS)

test.beforeAll(() => {
  assertLocalUiReview({ baseURL: test.info().project.use.baseURL, schema: SCHEMA })
  mkdirSync(OUT, { recursive: true })
})

/**
 * A finding that a program can see without looking: printed as it happens, and kept on the test as an annotation so that the reporter
 * (scripts/ui-review/reporter.mjs) lists every note again at the end of the run. It does not fail the test.
 */
function note(text) {
  test.info().annotations.push({ type: 'note', description: text })
  console.log(`  note: ${text}`)
}

test.beforeEach(({ page, baseURL }) => {
  assertLocalUiReview({ baseURL, schema: SCHEMA }) // again, with the address that this test really uses
  allowConsoleErrors(page, /[\s\S]*/) // a console error of the app is a note, not a failure
  page.on('console', (message) => {
    if (message.type() === 'error' && !OFFLINE_NOISE.test(message.text())) note(`console.error: ${message.text().slice(0, 240)}`)
  })
})

// ---- taking a picture ---------------------------------------------------------------------------------------------------------

/**
 * Saves what is on the screen as `name`.png in the folder of the pictures. A screen is taken whole (`whole`): the viewport is made as tall
 * as the page for the picture, up to `maxHeight`, then put back, which keeps what is fixed to the bottom of the screen (the tab bar of the
 * committee app on a phone) at the bottom of the picture. A menu or a dialog is taken as it opens (`whole: false`).
 */
async function shot(page, name, { whole = true, maxHeight = MAX_HEIGHT } = {}) {
  const viewport = page.viewportSize()
  if (whole) {
    const height = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)
    await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(viewport.height, height), maxHeight) })
  }
  try {
    await pageSettled(page) // every request of the screen has been answered, and drawn
    await page.evaluate(() => globalThis.document.fonts.ready)
    // The one break that a program can see without looking: the page is wider than the screen, so it scrolls sideways (the long word
    // or the badge that did not wrap, or a box that did not shrink). Said as a note; the picture shows where.
    const sideways = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)
    if (sideways > 0) note(`${name}: the page scrolls sideways by ${sideways} px`)
    const file = path.join(OUT, `${name}.png`)
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' })
    console.log(`  ${name}.png  ${(statSync(file).size / 1024).toFixed(0)} KB`)
  } finally {
    if (whole) await page.setViewportSize(viewport)
  }
}

/** The same screen in the light theme and then in the dark one (the device's setting is emulated, which the app follows until a person chooses). */
async function shotBothThemes(page, name, options) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    await shot(page, `${name}-${scheme}`, options)
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

/** Waits until a screen of the committee app has nothing left to load. */
async function loaded(page) {
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
  await pageSettled(page)
}

// ---- the provider app ---------------------------------------------------------------------------------------------------------------

/** Runs `take(code)` once in each language of the provider app (he, en, ru, ar), by the picker of the top bar, and leaves the screen in Hebrew. */
async function inEachLanguage(page, take) {
  let current = 'he'
  const pick = async (code) => {
    await page.getByLabel(DICTS[current]['lang.label']).selectOption(code)
    current = code
    await expect(page.locator('html')).toHaveAttribute('lang', code)
  }
  for (const code of LANGUAGES) {
    if (code !== current) await pick(code)
    await take(code)
  }
  await pick('he')
}

const person = { name: SIGN_IN.provider.name.slice(0, 25), password: SIGN_IN.provider.password } // the first words are enough to find the button

test.describe('provider app', () => {
  test.use(PROVIDER_PHONE)

  test('sign-in list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: new RegExp(person.name) })).toBeVisible()
    await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-sign-in-list`))
  })

  test('password screen', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp(person.name) }).click()
    await expect(page.getByLabel(he['login.passwordLabel'], { exact: true })).toBeVisible()
    await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-password`))
  })

  test('check-in recorded, home, and the visit saved on the phone', async ({ page, context }) => {
    // The person scans the lobby (a name of 108 characters) and signs in as the provider with the longest names.
    await page.goto(`/scan?code=${POINTS.lobby}`)
    await signIn(page, person, he)
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-recorded`))

    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible()
    await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-home`))

    // A second point, so that the phone knows it, then the network goes away and the same person scans the lobby again.
    await page.goto(`/scan?code=${POINTS.basement}`)
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready)
    await page.reload() // controlled by the service worker from here on, so that the app opens without a network
    await context.setOffline(true)
    try {
      await page.goto(`/scan?code=${POINTS.lobby}`)
      await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible()
      await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-saved-on-phone`))
    } finally {
      await context.setOffline(false)
    }
  })
})

// ---- the committee app ---------------------------------------------------------------------------------------------------------

/**
 * Signs the committee member `email` in through the local-only shortcut of the scratch-schema API, on the browser's own cookies, and opens
 * the app on `screen` (a key of SCREEN_TITLES; Home is the screen that the app opens when the address names none). It waits for the
 * screen's heading and for the screen to finish loading. The sign-in goes first, so that the app never asks who is signed in without
 * being: the browser logs the 401 of that as a console error.
 */
async function committeeSignedIn(page, email, screen) {
  const login = await page.request.post('/api/admin/dev-login', { data: { email } })
  expect(login.ok(), 'the dev sign-in of the committee').toBeTruthy()
  await page.goto(screen === 'home' ? '/admin' : `/admin#${screen}`)
  await expect(page.getByRole('heading', { name: SCREEN_TITLES[screen], level: 1, exact: true })).toBeVisible()
  await loaded(page)
}

/** The screens that have a list, which can be empty (the guide has none, and Settings always lists the member who is signed in). */
const LIST_SCREENS = ['home', 'history', 'points', 'providers', 'agent', 'audit', 'settings']

/** The pictures of the committee app at one width, on the full building (`worst`) or on the empty one. */
function committeeScreens(width, { email, prefix, screens }) {
  for (const screen of screens) {
    test(screen, async ({ page }) => {
      await committeeSignedIn(page, email, screen)
      await shotBothThemes(page, `committee-${width}-${prefix}${screen}`, { maxHeight: screen === 'agent' ? AGENT_HEIGHT : MAX_HEIGHT })
    })
  }
}

/** The account menu (the popover of the top bar's button on a phone, the one of the side rail's button on a computer), over the guide. */
function accountMenu(width) {
  test('account menu', async ({ page }) => {
    await committeeSignedIn(page, SIGN_IN.admin, 'help')
    await openAccountMenu(page)
    await page.mouse.move(0, 0) // the pointer is where the button was clicked: its hover look is not what the picture is for
    await shotBothThemes(page, `committee-${width}-account-menu`, { whole: false })
  })
}

/**
 * What is where the middle of `button` is, as a sentence for a note: the answer to "why can this not be tapped". The button as the page
 * lays it out, and the element that a finger would reach at its middle.
 */
async function whatCoversIt(button) {
  return button.evaluate((el) => {
    const describe = (e) => (e ? `<${e.tagName.toLowerCase()}${e.getAttribute('class') ? ` class="${e.getAttribute('class')}"` : ''}>` : 'nothing')
    const reach = () => {
      const box = el.getBoundingClientRect()
      const x = Math.round(box.left + box.width / 2)
      const y = Math.round(box.top + box.height / 2)
      const hit = globalThis.document.elementFromPoint(x, y)
      const itself = hit === el || el.contains(hit) ? ' (the button itself)' : ''
      return `${Math.round(box.width)} x ${Math.round(box.height)} at (${Math.round(box.left)}, ${Math.round(box.top)}), and at its middle a finger reaches ${describe(hit)}${itself}`
    }
    const now = reach()
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const screen = `${globalThis.innerWidth} px wide, scaled ${globalThis.visualViewport?.scale ?? 1}`
    return `on a screen ${screen} the button is ${now}; scrolled to the middle of the screen it is ${reach()}`
  })
}

/**
 * The "more" menu of one card: the provider with the longest name, whose title and menu are the hardest to fit. A click that does not
 * reach the button is a note and not a failure of the run: the note says what is there instead.
 */
function cardMenu(width) {
  test('"more" menu of a card', async ({ page }) => {
    await committeeSignedIn(page, SIGN_IN.admin, 'providers')
    const card = page.getByRole('article').filter({ hasText: PROVIDERS.russian.contact_name.slice(0, 25) })
    const button = card.getByRole('button', { name: /^עוד פעולות/ })
    // The button is in the middle of a card that can be taller than the screen: a person scrolls to it, and so does this (Playwright's own
    // scroll can leave it under the top bar, which sticks, and then the click is refused for a reason that is not the page's).
    await button.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }))
    try {
      await button.click({ timeout: 3_000 })
    } catch {
      // A click at the middle of the button did not reach it. Say what is there, and open the menu with the keyboard, so that the picture
      // of the open menu is still taken (a page that scrolls sideways moves the point that a click lands on, in this emulation).
      note(`committee-${width}-card-menu: a click at the middle of the "more" button of the card with the longest name did not reach it: ${await whatCoversIt(button)}. The menu was opened with the keyboard for the picture`)
      await button.focus()
      await page.keyboard.press('Enter')
    }
    await expect(card.getByRole('menu')).toBeVisible()
    await page.mouse.move(0, 0)
    await shotBothThemes(page, `committee-${width}-card-menu`)
  })
}

for (const [width, device] of [['360', COMMITTEE_PHONE], ['1280', COMMITTEE_COMPUTER]]) {
  test.describe(`committee app, ${width} px`, () => {
    // The service worker is not needed here, and one that is still updating is a source of pictures that differ for no reason.
    test.use({ ...device, serviceWorkers: 'block' })
    committeeScreens(width, { email: SIGN_IN.admin, prefix: '', screens: [...Object.keys(SCREEN_TITLES)] })
    accountMenu(width)
    cardMenu(width)
  })
}

// ---- the empty building ------------------------------------------------------------------------------------------------------------

test.describe('empty building', () => {
  test.beforeAll(() => {
    // A new installation: one committee member and nothing else. The schema is made again, so the pictures above must be taken first.
    execFileSync(process.execPath, ['scripts/ui-review/seed.mjs', SCHEMA, '--empty'], { cwd: ROOT, stdio: 'inherit' })
  })

  test.describe('provider app', () => {
    test.use(PROVIDER_PHONE)

    test('sign-in list without any provider', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText(he['login.noProviders'])).toBeVisible()
      await inEachLanguage(page, (code) => shotBothThemes(page, `provider-${code}-empty-sign-in-list`))
    })
  })

  for (const [width, device] of [['360', COMMITTEE_PHONE], ['1280', COMMITTEE_COMPUTER]]) {
    test.describe(`committee app, ${width} px`, () => {
      test.use({ ...device, serviceWorkers: 'block' })
      committeeScreens(width, { email: PLAIN_ADMIN.email, prefix: 'empty-', screens: LIST_SCREENS })
    })
  }
})
