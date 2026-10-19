// The recorder of the provider tutorial video (npm run video:frames, playwright.video.config.js). It is not a test of the app: it walks
// one service provider through the provider app the way the E2E specs do, saves one picture per beat of the script (video/script/), and
// writes video/out/<lang>/scenes.json with the beats in order, each with its picture, the box of what to tap and its resolved lines.
//
// What it shows is the fake sample data of its own scratch schema (scripts/dev-seed.mjs) and nothing else; assertLocalVideo refuses to
// run on anything but a local address and a scratch schema of its own. Each beat is saved twice: the picture for the video (390x844 at
// twice the density, the light theme, no motion), and `<id>.masked.png` at one pixel per CSS pixel with every date, time and the build
// label masked (as e2e/visual.spec.js masks them), which is what a later run is compared with to tell whether the video is behind the app.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { devices } from '@playwright/test'
import { test, expect, he, POINTS, PEOPLE, FAR, SAMPLE_POINT, allowConsoleErrors, adminSignIn, chooseFromMenu, pageSettled } from '../../e2e/fixtures.js'
import { VIDEO_SCHEMA, assertLocalVideo, languageOutDir } from './settings.mjs'
import { assertScript, buildScenes } from './script.mjs'
import { DICTS, dirOf } from '../../src/i18n/core.js'

/** The language that the app is recorded in. The other languages of the script (T6) need the app switched to them first. */
const LANG = 'he'
const OUT = languageOutDir(LANG)

// A phone of 390x844 (the width that the layouts of the provider app are checked at), drawn at twice the density: 780x1688 pictures,
// sharp in a 720x1280 video. Chromium: the device's own browser type is left out, because a describe group may not change the browser.
const pixel = { ...devices['Pixel 7'] }
delete pixel.defaultBrowserType
const PHONE = { ...pixel, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 }
// The printed sign: an A4 page is about 900 px wide at the ordinary density, here drawn at twice it.
const PAPER = { viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false }

const NEAR = { latitude: SAMPLE_POINT.lat, longitude: SAMPLE_POINT.lng, accuracy: 10 }
// How long the phone takes to answer for its location while the "checking location" screen is recorded, so that the screen stays up.
const LOCATION_DELAY_MS = 3000

/** What changes from one run to the next, masked in the copy that is compared: the locators of `dynamicRegions` in e2e/visual.spec.js. */
const dynamicRegions = (page) => [page.getByText(/\d{2}:\d{2}|\d{2}\/\d{2}\/\d{4}/), page.locator('.w-build, .a-build')]

/** @type {Record<string, import('./script.mjs').Capture>} */
const captures = {}

/** The box of an element on the picture, in CSS pixels, or null when there is none. */
async function boxOf(locator) {
  if (!locator) return null
  const box = await locator.first().boundingBox()
  expect(box, `the element to point at is on the screen: ${locator}`).not.toBeNull()
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }
}

/**
 * Saves the screen as the picture of the beat `id`, with its masked copy, and keeps the boxes of `tap` (the element that the person
 * taps next) and `highlight` (the element that the line points at, without a tap).
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @param {{ tap?: import('@playwright/test').Locator, highlight?: import('@playwright/test').Locator, settle?: boolean, fullPage?: boolean }} [options]
 */
async function beat(page, id, { tap, highlight, settle = true, fullPage = false } = {}) {
  if (settle) await pageSettled(page) // every request of the screen has been answered and drawn
  await page.evaluate(() => globalThis.document.fonts.ready) // (the function runs in the page, where globalThis is the window)
  const image = `${id}.png`
  const masked = `${id}.masked.png`
  // The boxes first, right before the picture: they are measured on the screen that the picture shows.
  const boxes = { tap: await boxOf(tap), highlight: await boxOf(highlight) }
  await page.screenshot({ path: path.join(OUT, image), animations: 'disabled', caret: 'hide', fullPage })
  await page.screenshot({ path: path.join(OUT, masked), animations: 'disabled', caret: 'hide', fullPage, scale: 'css', mask: dynamicRegions(page) })
  const size = await page.evaluate((whole) => {
    const root = globalThis.document.documentElement
    return whole
      ? { width: root.scrollWidth, height: root.scrollHeight, scale: globalThis.devicePixelRatio }
      : { width: globalThis.innerWidth, height: globalThis.innerHeight, scale: globalThis.devicePixelRatio }
  }, fullPage)
  captures[id] = { image, masked, ...size, ...boxes }
  console.log(`  ${image}  ${(statSync(path.join(OUT, image)).size / 1024).toFixed(0)} KB`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertLocalVideo({ baseURL: test.info().project.use.baseURL, schema: VIDEO_SCHEMA })
  assertScript() // a script with a problem stops the run before the build is looked at
  rmSync(OUT, { recursive: true, force: true }) // the frames of this run only: a beat that was removed leaves no picture behind
  mkdirSync(OUT, { recursive: true })
})

test.beforeEach(({ baseURL }) => {
  // Again, with the address that this test really uses.
  assertLocalVideo({ baseURL, schema: VIDEO_SCHEMA })
})

let failed = false
test.afterEach(() => {
  const { status, expectedStatus } = test.info()
  if (status !== expectedStatus) failed = true
})

test.afterAll(() => {
  // A run that failed writes no scenes.json: its error is the one to read, and a half set of frames is never handed on.
  if (failed) return
  const scenes = buildScenes(LANG, captures) // throws when a beat has no picture
  writeFileSync(path.join(OUT, 'scenes.json'), `${JSON.stringify(scenes, null, 2)}\n`)
  console.log(`  scenes.json  ${scenes.scenes.length} scenes, ${Object.keys(captures).length} beats, ${scenes.seconds} seconds, in ${OUT}`)
})

test.describe('the provider app, on a phone', () => {
  test.use(PHONE)

  test('one provider, from the first scan to the language', async ({ page, context }) => {
    allowConsoleErrors(page, /status of 503/) // the answers of "no signal", made up below

    // The location answers late only for the first scan, whose "checking location" screen is a scene. The script is removed after it,
    // and the next scans load a new page without it.
    const slowLocation = await page.addInitScript((delay) => {
      const geo = globalThis.navigator.geolocation
      const ask = geo.getCurrentPosition.bind(geo)
      geo.getCurrentPosition = (ok, fail, options) => globalThis.setTimeout(() => ask(ok, fail, options), delay)
    }, LOCATION_DELAY_MS)

    // 3. The list of names, the first time on this phone
    await page.goto(`/scan?code=${POINTS.lobby}`)
    await expect(page.getByRole('heading', { name: he['login.title'] })).toBeVisible()
    const me = page.getByRole('button', { name: new RegExp(PEOPLE.ploni.name) })
    await expect(me).toBeVisible()
    await beat(page, 'list', { tap: me })

    // 4. The password, then "stay signed in" (on by default) and the sign-in button
    await me.click()
    const password = page.getByLabel(he['login.passwordLabel'], { exact: true })
    await expect(password).toBeVisible()
    await beat(page, 'password', { tap: password })
    await password.fill(PEOPLE.ploni.password)
    const submit = page.getByRole('button', { name: he['login.submit'], exact: true })
    // The switch is a label around a hidden checkbox and two lines of text: the box of the whole label is what a person sees.
    const remember = page.locator('label').filter({ has: page.getByRole('checkbox', { name: he['login.remember'] }) })
    await expect(page.getByRole('checkbox', { name: he['login.remember'] })).toBeChecked()
    await beat(page, 'submit', { tap: submit, highlight: remember })

    // 5. Checking the location (the phone's own question is drawn by the video, not recorded: it differs on every phone)
    await submit.click()
    await expect(page.getByText(he['checkin.locating'])).toBeVisible()
    await beat(page, 'locating', { settle: false }) // the sign-in has answered; the location is still on its way, on purpose
    await slowLocation.dispose()

    // 6. The visit is recorded
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    const done = page.getByRole('button', { name: he['checkin.done'] })
    await beat(page, 'recorded', { tap: done })

    // 1 and 7. The home screen with today's visit: the opening, and the scene of the home screen
    await done.click()
    const today = page.getByRole('region', { name: he['home.today'] })
    await expect(today.getByRole('listitem')).toHaveCount(1)
    await beat(page, 'intro')
    await beat(page, 'home', { highlight: today })

    // 8. Too far from the point
    await context.setGeolocation(FAR)
    await page.goto(`/scan?code=${POINTS.gym}`)
    await expect(page.getByRole('heading', { name: he['checkin.far.title'] })).toBeVisible()
    await beat(page, 'far', { tap: page.getByRole('button', { name: he['checkin.retry'] }) })
    await context.setGeolocation(NEAR)

    // 9. No signal: the server cannot be reached (answered here with 503, as e2e/visual.spec.js does), so the visit waits on the phone
    const unavailable = (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } })
    await page.route('**/api/scan', unavailable)
    await page.route('**/api/scans/sync', unavailable)
    await page.goto(`/scan?code=${POINTS.basement}`)
    await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible()
    await beat(page, 'queued', { highlight: page.getByText(he['checkin.queued.chip'], { exact: true }) })
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    const syncNow = page.getByRole('button', { name: he['home.syncNow'] })
    await expect(syncNow).toBeVisible()
    await beat(page, 'pending', { tap: syncNow })
    // The signal is back: the visit is sent
    await page.unroute('**/api/scan')
    await page.unroute('**/api/scans/sync')
    await syncNow.click()
    const sent = page.getByRole('status').filter({ hasText: he['sync.done'] })
    await expect(sent).toBeVisible()
    await beat(page, 'sent', { highlight: sent }) // (the notice closes by itself after 9 seconds: src/pages/WorkerApp.jsx)

    // 10. The language. The notice is closed first, unless it already closed by itself: it keeps the language it was written in (a
    // finding of the topic plan).
    if (await sent.isVisible()) await page.getByRole('button', { name: he['notice.dismiss'] }).click()
    await expect(sent).toHaveCount(0)
    // The menu of languages is named in the language that the screen is in (its label also holds the chosen language, so not exact).
    const languages = (lang) => page.getByLabel(DICTS[lang]['lang.label'])
    await beat(page, 'language', { tap: languages('he') })
    let current = 'he'
    for (const lang of ['en', 'ru', 'ar']) {
      await languages(current).selectOption(lang)
      current = lang
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.locator('html')).toHaveAttribute('dir', dirOf(lang))
      await beat(page, `language-${lang}`)
    }

    // 11. The end: back in Hebrew, with the day's visits
    await languages(current).selectOption('he')
    await expect(page.getByRole('heading', { name: new RegExp(PEOPLE.ploni.name) })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    await beat(page, 'outro')
  })
})

test.describe('the printed sign', () => {
  test.use(PAPER)

  test('2. the sign of the lobby, as the committee prints it', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the sign-in screen asks who is signed in before anybody is
    await page.addInitScript(() => {
      globalThis.print = () => {} // the print dialog of the browser would wait for a person
    })
    await adminSignIn(page, 'points')
    await chooseFromMenu(page.getByRole('article').filter({ hasText: 'לובי' }), 'QR והדפסה')
    await page.getByRole('dialog', { name: 'QR: לובי' }).getByRole('button', { name: 'הדפסת שלט' }).click()
    // The sheet exists only for the printer, so it is hidden from the accessibility tree (aria-hidden, and the code has no alt text):
    // it is found by its classes (src/admin/PrintSheet.jsx).
    const sheet = page.locator('.a-print-only .a-sign')
    await expect(sheet).toHaveCount(1)
    const code = sheet.locator('img')
    await expect.poll(() => code.evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth)).toBeGreaterThan(0)
    await page.emulateMedia({ media: 'print' })
    await expect(sheet).toBeVisible() // in print, only while the app is printing (src/admin/admin.css, `.is-printing`)
    await beat(page, 'sign', { highlight: code, fullPage: true })
  })
})
