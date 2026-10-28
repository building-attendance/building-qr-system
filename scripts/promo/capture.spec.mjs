// The recorder of the long promo (npm run promo:frames, playwright.promo.config.js). It is not a test of the app: it walks one service
// provider through the provider app and one committee member through the committee app, on the invented building of
// scripts/promo/sample.mjs, saves one picture per screen that the promo's script shows (the topic plan's 28 scenes), and writes
// video/out/promo-frames/he/frames.json with each picture's size, the box of each element that a scene names (the ring goes around it)
// and a zoom rectangle around it, both in the picture's own pixels, and `agentSample`, the counts that the committee's agent reads for the
// week. The names of the pictures and the boxes each must have are the contract with the composition: PROMO_PICTURES and BOXES of
// video/promo/script/long.js. A picture may have more boxes than BOXES asks for (a zoom that a later scene may want).
//
// Everything happens in one run, on one morning (the story's day, scripts/promo/settings.mjs): the browser's clock is set with
// page.clock and the API's is moved with it (scripts/promo/clock.mjs), so the visit that the provider app records at 08:06 is the 08:06
// row of the committee's history. assertLocalPromo refuses to run on anything but a local address and the run's own scratch schema.
// Nothing is masked for comparison (these pictures are not compared), with one exception for safety: the prefix of the agent's key. And
// one thing is left out of every picture: the build label, which a local build writes as "dev" (setBuildLabels).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { devices } from '@playwright/test'
import { test, expect, he, FAR, allowConsoleErrors, changeFilters, chooseFromMenu, pageSettled } from '../../e2e/fixtures.js'
import { DICTS, dirOf } from '../../src/i18n/core.js'
import { formatDay } from '../../shared/datetime.js'
import { PROMO_SCHEMA, addDays, assertLocalPromo, buildingInstant, missingDay, pictureBox, promoClockFile, promoDay, promoOutDir, zoomRect } from './settings.mjs'
import { LIVE, LIVE_OFFSET_M, MEMBERS, MISTAKE, NEW_PROVIDER, POINTS, PROVIDERS, positionNear } from './sample.mjs'
import { BOXES, PROMO_PICTURES } from '../../video/promo/script/long.js'

const OUT = promoOutDir()
const DAY = process.env.PROMO_DAY ?? promoDay() // set (and checked) by the config for the whole run
const WEEK = Array.from({ length: 7 }, (_, i) => addDays(DAY, i - 6)) // the seven days of the committee's Home, the oldest first

// A phone of 390x844 drawn at twice the density (780x1688 pictures); a computer of 1280x800, also at twice the density; an A4 page for
// the printed sign. Chromium: the device's own browser type is left out, because a describe group may not change the browser.
const pixel = { ...devices['Pixel 7'] }
delete pixel.defaultBrowserType
const PHONE = { ...pixel, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 }
const COMPUTER = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false }
const PAPER = { viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false }

/** Where the phone stands: `metres` due north of the pin (D9: 5 to 10 metres off), with a good accuracy. */
const standing = (metres) => {
  const { lat, lng, accuracy } = positionNear(metres)
  return { latitude: lat, longitude: lng, accuracy }
}

/** The text of an i18n line up to its first placeholder, as a pattern for the start of the text on the screen. */
const startOf = (line) => new RegExp(`^${line.split('{')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

// What every picture leaves out: the build label (src/ui/BuildLabel.jsx), which a local build writes as "dev" and a viewer would read as a
// test. It is hidden for the picture only and shown again right after, and hidden, not removed, so that nothing on the screen moves and
// every box is where it was measured. Through each label's own style (the CSSOM, the way Playwright hides the caret), not a style sheet:
// the preview's Content-Security-Policy refuses a <style> element, so the `style` option of page.screenshot would hide nothing.
const BUILD_LABEL = '.w-build'

/** Sets the `visibility` of every build label on the screen (`hidden`, or '' for the app's own; BuildLabel sets no style of its own). */
async function setBuildLabels(page, visibility) {
  await page.locator(BUILD_LABEL).evaluateAll((labels, value) => {
    for (const label of labels) {
      if (value) label.style.setProperty('visibility', value, 'important')
      else label.style.removeProperty('visibility')
    }
  }, visibility)
}

/** @type {Record<string, { width: number, height: number, scale: number, boxes: Record<string, object>, zooms: Record<string, object> }>} */
const frames = {}
/** @type {Record<string, unknown> | null} */
let agentSample = null
const notes = []

/**
 * Sets the story's clock to `hhmm` on the story's day: the browser's (page.clock) and the API's (the file that clock.mjs reads), both
 * running on from that moment. Not a fixed time: the map fades its tiles in by the clock (Leaflet), and a clock that stands still keeps
 * them invisible.
 */
async function setClock(page, hhmm) {
  const at = buildingInstant(DAY, hhmm)
  writeFileSync(promoClockFile(), JSON.stringify({ at: at.getTime(), setAt: Date.now() }))
  await page.clock.setSystemTime(at)
}

/** The box of an element in CSS pixels of the viewport, or the union of the boxes of several. */
async function boxOf(...locators) {
  const boxes = []
  for (const locator of locators) {
    const box = await locator.first().boundingBox()
    expect(box, `the element to point at is on the screen: ${locator}`).not.toBeNull()
    boxes.push(box)
  }
  return union(boxes)
}

/** The smallest box that holds all of `boxes` ({ x, y, width, height }). */
function union(boxes) {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

/**
 * Saves the screen as `name`, with the box and the zoom rectangle of each of `targets`, in the picture's own pixels. A target is an
 * element, a list of elements (the box that holds them all), or a function that measures a box in CSS pixels of the viewport; every one is
 * measured after the page has settled, right before the picture. In a picture of the whole page the boxes are moved by the scroll of the
 * page, since the picture starts at the top of the document and not of the screen.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {Record<string, import('@playwright/test').Locator | import('@playwright/test').Locator[] | (() => Promise<{ x: number, y: number, width: number, height: number }>)>} [targets]
 * @param {{ fullPage?: boolean, mask?: import('@playwright/test').Locator[], maskColor?: string }} [options]
 */
async function shot(page, name, targets = {}, { fullPage = false, mask = [], maskColor } = {}) {
  expect(PROMO_PICTURES, `${name} is a picture of the contract`).toContain(name)
  expect(Object.keys(targets), `the boxes of ${name}`).toEqual(expect.arrayContaining([...(BOXES[name] ?? [])]))
  await pageSettled(page) // every request of the screen has been answered and drawn
  await page.evaluate(() => globalThis.document.fonts.ready) // (the function runs in the page, where globalThis is the window)
  const css = {}
  const scroll = fullPage ? await page.evaluate(() => ({ x: globalThis.scrollX, y: globalThis.scrollY })) : { x: 0, y: 0 }
  for (const [key, target] of Object.entries(targets)) {
    const box = typeof target === 'function' ? await target() : Array.isArray(target) ? await boxOf(...target) : await boxOf(target)
    css[key] = { ...box, x: box.x + scroll.x, y: box.y + scroll.y }
  }
  const file = path.join(OUT, name)
  await setBuildLabels(page, 'hidden') // (a picture that fails ends its test, and its page is not used again)
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', fullPage, mask, ...(maskColor ? { maskColor } : {}) })
  await setBuildLabels(page, '')
  const png = readFileSync(file)
  const picture = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } // the IHDR chunk of the PNG
  const scale = await page.evaluate(() => globalThis.devicePixelRatio)
  const boxes = {}
  const zooms = {}
  for (const [key, b] of Object.entries(css)) {
    boxes[key] = pictureBox(b, scale, picture)
    expect(boxes[key].width > 0 && boxes[key].height > 0, `${name}: the box ${key} is inside the picture`).toBe(true)
    zooms[key] = zoomRect(boxes[key], picture)
  }
  frames[name] = { ...picture, scale, boxes, zooms }
  console.log(`  ${name}  ${picture.width}x${picture.height}  ${(png.length / 1024).toFixed(0)} KB`)
}

/** Scrolls the page so that the top of `locator` is `margin` pixels below the top of the screen. */
async function scrollTo(locator, margin = 88) {
  await locator.evaluate((el, gap) => globalThis.scrollTo(0, el.getBoundingClientRect().top + globalThis.scrollY - gap), margin)
}

/** Signs the committee member in (the local-only shortcut of the scratch API, with the member's own address) and opens `hash`. */
async function memberSignIn(page, hash = '') {
  const login = await page.request.post('/api/admin/dev-login', { data: { email: MEMBERS.yael.email } })
  expect(login.ok(), 'the member signs in').toBeTruthy()
  await page.goto(`/admin${hash}`)
}

const loaded = (page) => expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertLocalPromo({ baseURL: test.info().project.use.baseURL, schema: PROMO_SCHEMA })
  rmSync(OUT, { recursive: true, force: true }) // the pictures of this run only
  mkdirSync(OUT, { recursive: true })
  // The API's clock starts at the story's morning (a file left by an earlier run would hold another day); each test sets it again.
  mkdirSync(path.dirname(promoClockFile()), { recursive: true })
  writeFileSync(promoClockFile(), JSON.stringify({ at: buildingInstant(DAY, LIVE.start).getTime(), setAt: Date.now() }))
})

test.beforeEach(({ baseURL }) => {
  assertLocalPromo({ baseURL, schema: PROMO_SCHEMA }) // again, with the address that this test really uses
})

let failed = false
test.afterEach(() => {
  const { status, expectedStatus } = test.info()
  if (status !== expectedStatus) failed = true
})

test.afterAll(() => {
  // A run that failed writes no frames.json: its error is the one to read, and a half set of pictures is never handed on.
  if (failed) return
  // The contract, whole: every picture of PROMO_PICTURES was written, with every box that BOXES asks of it.
  const missing = PROMO_PICTURES.filter((name) => !frames[name] || !existsSync(path.join(OUT, name)))
  if (missing.length) throw new Error(`No picture was taken for ${missing.join(', ')}`)
  const noBox = Object.entries(BOXES).flatMap(([name, keys]) => keys.filter((key) => !frames[name]?.boxes[key]).map((key) => `${name}: ${key}`))
  if (noBox.length) throw new Error(`frames.json has no box for ${noBox.join(', ')}`)
  const out = { day: DAY, week: WEEK, missingDay: missingDay(DAY), notes, pictures: frames, agentSample }
  writeFileSync(path.join(OUT, 'frames.json'), `${JSON.stringify(out, null, 2)}\n`)
  console.log(`  frames.json  ${Object.keys(frames).length} pictures, in ${OUT}`)
})

test.describe('the provider app, on a phone', () => {
  test.use(PHONE)

  test('the cleaner signs in, checks in, loses the signal, is too far, and reads it in four languages', async ({ page, context }) => {
    allowConsoleErrors(page, /status of 503/) // the answers of "no signal", made up below
    const cleaner = PROVIDERS.cleaner
    await context.setGeolocation(standing(LIVE_OFFSET_M))

    // The list of accounts, the first time on this phone, with the privacy notice under it
    await setClock(page, LIVE.lobby)
    await page.goto(`/scan?code=${POINTS.lobby.token}`)
    const title = page.getByRole('heading', { name: he['login.title'] })
    await expect(title).toBeVisible()
    const me = page.getByRole('button', { name: new RegExp(cleaner.contact) })
    await shot(page, 'provider-list.png', {
      'list-top': [title, page.getByRole('list')],
      'name-row': me,
      privacy: page.getByText(startOf(he['login.privacy'])),
    })

    // The password, typed (dots)
    await me.click()
    const password = page.getByLabel(he['login.passwordLabel'], { exact: true })
    await password.fill(cleaner.password)
    const submit = page.getByRole('button', { name: he['login.submit'], exact: true })
    await shot(page, 'provider-password.png', { password, submit })

    // The visit is recorded at 08:06, 7 metres from the pin (the clock is set again right before, so that the minute is still 08:06)
    await setClock(page, LIVE.lobby)
    await submit.click()
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await shot(page, 'provider-recorded.png', {
      'verified-line': page.getByText(startOf(he['checkin.verified'])),
      time: page.getByText(LIVE.lobby, { exact: true }),
    })
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    const today = page.getByRole('region', { name: he['home.today'] })
    await expect(today.getByRole('listitem')).toHaveCount(1)

    // No signal in the parking at 08:24 (the server cannot be reached: 503, as e2e/visual.spec.js does), so the visit waits on the phone
    await setClock(page, LIVE.parking)
    const unavailable = (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } })
    await page.route('**/api/scan', unavailable)
    await page.route('**/api/scans/sync', unavailable)
    await page.goto(`/scan?code=${POINTS.parking.token}`)
    const queued = page.getByRole('heading', { name: he['checkin.queued.title'] })
    await expect(queued).toBeVisible()
    await shot(page, 'provider-queued.png', {
      status: [page.getByText(he['checkin.queued.chip'], { exact: true }), queued],
      time: page.getByText(LIVE.parking, { exact: true }),
    })
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    const syncNow = page.getByRole('button', { name: he['home.syncNow'] })
    await expect(today.getByRole('listitem').filter({ hasText: he['home.pending'] })).toHaveCount(1)

    // The signal is back at 08:26: the visit is sent, with the time at which it was scanned
    await setClock(page, LIVE.synced)
    await page.unroute('**/api/scan')
    await page.unroute('**/api/scans/sync')
    await syncNow.click()
    const sent = page.getByRole('status').filter({ hasText: he['sync.done'] })
    await expect(sent).toBeVisible()
    await expect(today.getByRole('listitem').filter({ hasText: he['home.recorded'] })).toHaveCount(2)
    await shot(page, 'provider-sent.png', { status: sent, visit: today.getByRole('listitem').filter({ hasText: LIVE.parking }) })

    // Too far from the point (SAMPLE_FAR_POINT, about 5.5 km away)
    await setClock(page, LIVE.far)
    await context.setGeolocation(FAR)
    await page.goto(`/scan?code=${POINTS.lobby.token}`)
    const farTitle = page.getByRole('heading', { name: he['checkin.far.title'] })
    await expect(farTitle).toBeVisible()
    await shot(page, 'provider-far.png', {
      message: [farTitle, page.getByText(startOf(he['checkin.far.body']))],
      retry: page.getByRole('button', { name: he['checkin.retry'] }),
    })
    await context.setGeolocation(standing(LIVE_OFFSET_M))

    // The home screen with both visits, recorded, and the link to the tutorial
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect(today.getByRole('listitem')).toHaveCount(2)
    // The notice keeps the language it was written in, so it is closed first, unless it already closed by itself (after 9 seconds).
    await page.getByRole('button', { name: he['notice.dismiss'] }).click({ timeout: 2_000 }).catch(() => {}) // it may close by itself first
    await expect(sent).toHaveCount(0)
    await shot(page, 'provider-home.png', { 'tutorial-link': page.getByRole('link', { name: he['home.tutorial'] }), visits: today })

    // The same home screen in the other three languages
    const languages = (lang) => page.getByLabel(DICTS[lang]['lang.label'])
    let current = 'he'
    for (const lang of ['en', 'ru', 'ar']) {
      await languages(current).selectOption(lang)
      current = lang
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.locator('html')).toHaveAttribute('dir', dirOf(lang))
      await shot(page, `provider-lang-${lang}.png`, {
        hello: page.getByRole('heading', { level: 1 }),
        visits: page.getByRole('region', { name: DICTS[lang]['home.today'] }),
      })
    }
    await languages(current).selectOption('he')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
  })
})

test.describe('the committee app, on a phone', () => {
  test.use(PHONE)

  test('cancel a visit, the log, home, the history, points, providers, members and the agent', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the app asks who is signed in before it knows
    await setClock(page, LIVE.committee)
    await memberSignIn(page, '#history')
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    await loaded(page)

    // The history as it opens: the last seven days, the newest first
    const todays = page.getByRole('region', { name: formatDay(DAY) })
    await expect(todays.getByRole('listitem')).toHaveCount(3) // the gardener at 07:41, and the cleaner's 08:06 and 08:24
    await shot(page, 'committee-history.png', { 'first-row': todays.getByRole('listitem').first() })

    // A visit scanned by mistake is cancelled, with a reason
    const mistake = page.getByRole('region', { name: formatDay(addDays(DAY, -4)) }).getByRole('listitem').filter({ hasText: MISTAKE.time })
    await mistake.getByRole('button', { name: /^עוד פעולות לביקור/ }).click()
    await mistake.getByRole('menuitem', { name: 'ביטול הנוכחות', exact: true }).click()
    const voiding = page.getByRole('dialog', { name: 'ביטול נוכחות' })
    const reason = voiding.getByLabel('סיבה (לא חובה)')
    await reason.fill(MISTAKE.reason)
    await shot(page, 'committee-void-dialog.png', { reason, dialog: voiding })
    await voiding.getByRole('button', { name: 'ביטול הנוכחות' }).click()
    await expect(voiding).toHaveCount(0)
    const done = page.getByRole('status').filter({ hasText: 'הנוכחות בוטלה' })
    await expect(done).toBeVisible()
    await done.getByRole('button', { name: 'סגירת ההודעה' }).click() // so that it is not in the next picture
    await expect(done).toHaveCount(0)

    // Its row in the audit log
    await page.goto('/admin#audit')
    await expect(page.getByRole('heading', { level: 1, name: 'יומן פעולות' })).toBeVisible()
    await loaded(page)
    // Only the visits' entries (the sign-in of the run is a local shortcut, which no installation has)
    await changeFilters(page, (scope) => scope.getByLabel('סוג פעולה', { exact: true }).selectOption('scan'))
    await loaded(page)
    const logged = page.getByRole('listitem').filter({ hasText: MISTAKE.reason })
    await expect(logged).toHaveCount(1)
    await shot(page, 'committee-audit.png', { 'audit-row': logged })

    // Home: the week, a row per provider and a dot per day, scrolled so that the rows show under the bars
    await page.goto('/admin')
    const week = page.getByRole('region', { name: 'השבוע בבניין' })
    await expect(week.getByRole('table').getByRole('link').first()).toBeVisible()
    const cleanerRow = page.getByRole('link', { name: new RegExp(PROVIDERS.cleaner.contact) })
    await scrollTo(week.getByRole('table'), 120)
    // The dots are drawn in the order of the days, the oldest first; Home gives them no name of their own (the row of dots is one picture
    // for a screen reader), so the box of the empty day is read from the drawing of its row.
    const dotOf = (day) => async () => {
      const dots = await cleanerRow.getByRole('img').evaluate((el) =>
        [...el.children].map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
      expect(dots).toHaveLength(WEEK.length)
      return dots[WEEK.indexOf(day)]
    }
    await shot(page, 'committee-home.png', { 'empty-day': dotOf(missingDay(DAY)), 'provider-row': cleanerRow, week })

    // A tap on the cleaner's row opens her history for the week: today's 08:06, and 08:24, sent after no signal
    await cleanerRow.click()
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    await loaded(page)
    const online = todays.getByRole('listitem').filter({ hasText: LIVE.lobby })
    const offline = todays.getByRole('listitem').filter({ hasText: LIVE.parking })
    await expect(todays.getByRole('listitem')).toHaveCount(2) // hers only
    await expect(online).toHaveCount(1)
    await expect(offline).toHaveCount(1)
    await scrollTo(page.getByRole('heading', { level: 2, name: new RegExp(`^${formatDay(DAY)}`) }))
    await shot(page, 'committee-history-from-home.png', {
      'row-0806': online,
      'row-0824': offline,
      distance: online.getByText(/מ׳ מהנקודה/),
      'offline-badge': offline.getByText('נשלח אחרי חוסר קליטה'),
    })

    // The visits that were not counted, with the reason (the link of Home's tile)
    await page.goto(`/admin#history?outcome=not_counted&from=${WEEK[0]}&to=${DAY}`)
    const refused = page.getByRole('listitem').filter({ hasText: 'לא משויך לנקודה' })
    await expect(refused).toHaveCount(1)
    await shot(page, 'committee-history-refused.png', { 'refused-row': refused })

    // The points
    await page.goto('/admin#points')
    const lobby = page.getByRole('article').filter({ hasText: POINTS.lobby.name })
    await expect(lobby).toBeVisible()
    await scrollTo(lobby, 120) // the lobby is the last card: brought into view, under the top bar
    await shot(page, 'committee-points.png', { 'point-row': lobby })

    // The lobby on the map, the pin and the circle of its radius. The form of an existing point: a new one has no pin yet, and its map
    // opens on a real city, while the sample point is at sea on purpose (D10).
    await chooseFromMenu(lobby, 'עריכה')
    const form = page.getByRole('dialog', { name: `עריכת נקודה: ${POINTS.lobby.name}` })
    const map = form.getByRole('application', { name: 'מפה לסימון מיקום הנקודה' })
    await expect(map).toBeVisible()
    await map.scrollIntoViewIfNeeded()
    // The tiles come from the network (OpenStreetMap): wait for them, and take the picture anyway if they do not come.
    const tiles = await expect
      .poll(() => map.evaluate((el) => el.querySelectorAll('.leaflet-tile-loaded').length), { timeout: 20_000 })
      .toBeGreaterThan(0)
      .then(() => true, () => false)
    if (!tiles) notes.push('committee-points-map.png: the map tiles did not load; the picture shows the pin and the circle without them.')
    // The pin and the circle are drawn by Leaflet, which gives them no name: their boxes are read from the map's own drawing.
    const drawn = (selector) => async () => {
      const box = await map.evaluate((el, which) => {
        const node = el.querySelector(which)
        if (!node) return null
        const r = node.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }, selector)
      expect(box, `${selector} is on the map`).toBeTruthy()
      return box
    }
    await shot(page, 'committee-points-map.png', { pin: drawn('.leaflet-marker-icon'), circle: drawn('path.leaflet-interactive'), map })
    await form.getByRole('button', { name: 'ביטול', exact: true }).click()
    await expect(form).toHaveCount(0)

    // Who may scan at the garden
    await chooseFromMenu(page.getByRole('article').filter({ hasText: POINTS.garden.name }), 'עריכה')
    const gardenForm = page.getByRole('dialog', { name: `עריכת נקודה: ${POINTS.garden.name}` })
    const who = gardenForm.getByRole('group', { name: 'מי רשאי לסרוק כאן' })
    await who.scrollIntoViewIfNeeded()
    await shot(page, 'committee-access.png', { 'access-list': who })
    await gardenForm.getByRole('button', { name: 'ביטול', exact: true }).click()
    await expect(gardenForm).toHaveCount(0)

    // A new provider, with a personal password (an invented one of the sample; the form is closed without saving)
    await page.goto('/admin#providers')
    await page.getByRole('button', { name: 'נותן שירות חדש' }).click()
    const adding = page.getByRole('dialog', { name: 'נותן שירות חדש' })
    await adding.getByLabel('חברה', { exact: true }).fill(NEW_PROVIDER.company)
    await adding.getByLabel('שם העובד', { exact: true }).fill(NEW_PROVIDER.contact)
    await adding.getByLabel('סוג שירות', { exact: true }).selectOption(NEW_PROVIDER.service)
    const newPassword = adding.getByLabel('סיסמה', { exact: true })
    await newPassword.fill(NEW_PROVIDER.password)
    await newPassword.blur()
    await shot(page, 'committee-providers-password.png', { password: newPassword, dialog: adding })
    await adding.getByRole('button', { name: 'ביטול', exact: true }).click() // the form's own cancel closes it without asking
    await expect(adding).toHaveCount(0)

    // The committee's members, who sign in with Google. The screen has no Google button: the box is the line that says so and the list.
    await page.goto('/admin#settings')
    const members = page.getByRole('region', { name: 'מנהלי המערכת' })
    await expect(members.getByRole('article')).toHaveCount(2)
    await shot(page, 'committee-admins.png', {
      'google-button': [
        members.getByText('מי רשאי להיכנס לניהול. הכניסה תמיד עם חשבון Google.'),
        members.getByRole('article').first(),
        members.getByRole('article').last(),
      ],
    })

    // A read-only key for the committee's own AI. The key is made through the committee API, kept only in this variable, used for the
    // counts of the week, and revoked before the test ends: it is never written to a picture, a file or the log.
    const created = await page.request.post('/api/admin/api-keys', { data: { name: 'ה-AI של הוועד' } })
    expect(created.status(), 'the key is made').toBe(201)
    const { api_key: keyRow, key } = await created.json()
    try {
      const counts = async (groupBy) => {
        const res = await page.request.get(`/api/agent/v1/counts?from=${WEEK[0]}&to=${DAY}&group_by=${groupBy}`, {
          headers: { Authorization: `Bearer ${key}` },
        })
        expect(res.ok(), `the agent API answers the counts by ${groupBy}`).toBeTruthy()
        return res.json()
      }
      const byDay = await counts('day,provider,service_type')
      const byProvider = await counts('provider,service_type')
      agentSample = {
        from: WEEK[0],
        to: DAY,
        days: WEEK,
        total: byProvider.total,
        byProvider: byProvider.counts.map((r) => ({ provider_name: r.provider_name, service_type: r.service_type, count: r.count })),
        byDay: byDay.counts.map((r) => ({ day: r.day, provider_name: r.provider_name, service_type: r.service_type, count: r.count })),
      }

      await page.goto('/admin#agent')
      await expect(page.getByRole('heading', { level: 1, name: "גישה לאייג'נט" })).toBeVisible()
      const card = page.getByRole('article').filter({ hasText: keyRow.name })
      await expect(card).toBeVisible()
      // The first characters of the key are covered, in the colour of their own tile, so that no part of a key is in the picture.
      const prefix = card.getByText(`${keyRow.key_prefix}…`, { exact: true })
      const tileColour = await prefix.evaluate((el) => {
        for (let node = el; node; node = node.parentElement) {
          const colour = globalThis.getComputedStyle(node).backgroundColor
          if (colour && colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour
        }
        return '#ffffff'
      })
      await shot(page, 'committee-agent.png', { 'read-only': page.getByText(/^נתוני הנוכחות זמינים לקריאה בלבד/), key: card }, {
        mask: [prefix],
        maskColor: tileColour,
      })
    } finally {
      const revoked = await page.request.post(`/api/admin/api-keys/${keyRow.id}/revoke`, { data: {} })
      expect.soft(revoked.status(), 'the key is revoked').toBe(200) // soft: an earlier failure stays the one that is reported
    }
  })
})

test.describe('the committee app, on a computer', () => {
  test.use(COMPUTER)

  test('the history with its filters and the Excel button', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/)
    await setClock(page, LIVE.committee)
    await memberSignIn(page, '#history')
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    await loaded(page)
    await expect(page.getByRole('region', { name: formatDay(DAY) })).toBeVisible()
    await shot(page, 'computer-history.png', {
      filters: [page.getByText('מתאריך', { exact: true }), page.getByLabel('סוג', { exact: true }), page.getByText('כולל חשבון דמו')],
      excel: page.getByRole('link', { name: 'ייצוא ל-Excel' }),
    })
  })
})

test.describe('the printed sign', () => {
  test.use(PAPER)

  test('the sign of the lobby, as the committee prints it', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/)
    await page.addInitScript(() => {
      globalThis.print = () => {} // the print dialog of the browser would wait for a person, and cannot be recorded
    })
    await setClock(page, LIVE.committee)
    await memberSignIn(page, '#points')
    await chooseFromMenu(page.getByRole('article').filter({ hasText: POINTS.lobby.name }), 'QR והדפסה')
    await page.getByRole('dialog', { name: `QR: ${POINTS.lobby.name}` }).getByRole('button', { name: 'הדפסת שלט' }).click()
    // The sheet exists only for the printer, so it is hidden from the accessibility tree (aria-hidden, and its code has no alt text): it
    // is found by its classes (src/admin/PrintSheet.jsx), as the tutorial's recorder finds it, and drawn as the printer would.
    const sheet = page.locator('.a-print-only .a-sign')
    await expect(sheet).toHaveCount(1)
    const code = sheet.locator('img')
    await expect.poll(() => code.evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth)).toBeGreaterThan(0)
    await page.emulateMedia({ media: 'print' })
    await expect(sheet).toBeVisible()
    // The code is a scratch point's: the video covers it with the demo code (its box is `qr`).
    await shot(page, 'committee-print-sign.png', { qr: code, sign: sheet }, { fullPage: true })
  })
})

