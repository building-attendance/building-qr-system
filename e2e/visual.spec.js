// Visual regression: baseline images of the key screens of both apps, compared on every pull request (decision of 11/10/2026).
// What it is for: to notice design drift that no behaviour test sees, and to show the owner the exact image diff of every
// intended change to a screen. docs/testing.md ("Visual regression") says how a baseline is updated after an intended change.
//
// Where it runs. The baselines are made by CI, on the Linux runner, in Chromium (the android-chrome project): another system
// draws text differently, so a baseline from a laptop would never match. So the spec runs only there, and skips itself on
// anything else (WebKit, Windows, macOS) the way e2e/fixtures.js skips the offline tests on WebKit. VISUAL_ANY_OS=1 lifts the
// platform condition to check that the spec itself still runs on another system: what it writes there is not a baseline, and
// must never be committed.
//
// Why the images are the same every run:
//   - The clock stands still (page.clock) from the first navigation, at the moment the test started, so a screen cannot change
//     between two frames (`stopClock`; not in the test that opens the map, see there). It is not a made-up date: the server stamps
//     the visits with the real time, and "today" on the phone must be the day of those visits, or the home screen would list none.
//   - Everything that still depends on the real date, the real time or the build is masked (the pink boxes): every date and
//     time that a person reads, the date fields of the History tab, the build label, and the codes of
//     the Agent tab (a random key prefix, the address of the server, the prompt that quotes it). `dynamicRegions` lists them.
//   - The map's tiles are one fixed picture that this file draws, not OpenStreetMap's.
//   - The committee tests start from a known state (`prepareCommittee`), not from whatever an earlier spec left behind, and the
//     visits that the History tab lists are a fixed list (`stubHistory`): no provider signs in for them, and their time is not real.
//   - Signing in is rationed: the server counts every sign-in of the run from one address (60 in 15 minutes), the other specs use most
//     of that, and a failing screen restarts the worker and with it the setup of the next test. So the spec signs in once.
//   - Animations and transitions are off (`animations: 'disabled'`, and the browser is told to reduce motion), the caret is
//     hidden, the fonts are loaded, and every request of the screen has been answered before the picture is taken.
//   - The service worker is blocked: this spec answers the map's tiles itself (page.route), which a worker would bypass.
//
// The size of the images: about 150 KB at most each (`scale: 'css'`, one pixel per CSS pixel, a plain screen compresses well).
// The thresholds are Playwright's own defaults: no pixel may differ.
import { deflateSync, crc32 } from 'node:zlib'
import ar from '../src/i18n/ar.js'
import {
  test, expect, he, en, POINTS, PEOPLE, FAR, ADMIN_EMAIL, BUILDING_NAME, clearScans, pageSettled, signIn,
} from './fixtures.js'

// ---- where and when it runs ----------------------------------------------------------------------------------------------------

/** True where the baselines can be compared: Chromium as the Pixel, on Linux (or anywhere, when VISUAL_ANY_OS=1 asks for it). */
const canCompare = (browserName, testInfo) =>
  browserName === 'chromium' && testInfo.project.name === 'android-chrome' && (process.platform === 'linux' || process.env.VISUAL_ANY_OS === '1')

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(!canCompare(browserName, testInfo), 'The visual baselines are made by CI on Linux in Chromium (android-chrome) only: see docs/testing.md, "Visual regression"')
})

/**
 * Stops the clock of the page at the time the test started (timers go on running). Called first thing in a test, before its first
 * navigation. Not in the test that opens the map: Leaflet fades its tiles in by comparing `new Date()` with the time each tile
 * arrived, so on a clock that stands still they stay invisible for ever.
 */
const stopClock = (page) => page.clock.setFixedTime(new Date())

// A phone, a computer, and the settings every screen shares. A describe group may not change the browser, so the devices are not
// spread here: the project's Pixel 7 stays, and only its size changes. One CSS pixel per pixel of the image.
const SAME = { deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' }
const PROVIDER_PHONE = { ...SAME, viewport: { width: 390, height: 844 } } // what the layouts of the provider app are checked at
const COMMITTEE_PHONE = { ...SAME, viewport: { width: 360, height: 740 } }
const COMMITTEE_COMPUTER = { ...SAME, viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }

test.describe.configure({ timeout: 120_000 })

// ---- the pictures --------------------------------------------------------------------------------------------------------------

/**
 * What changes from one run to the next, as locators to mask (a pink box over each). Read from the real screens:
 *   - a date or a time anywhere in the text (DD/MM/YYYY, HH:MM: shared/datetime.js writes them all, and nothing else on a screen
 *     has the shape of one). The smallest element that holds one is masked: a stamp, or the sentence that has one in it.
 *   - the date fields of the History tab (a field's value is not text, so the pattern above does not see it).
 *   - the build label of both apps (BuildLabel: `.w-build`, `.a-build`). It is "dev" in a test build, but the label is the one
 *     place that names a version, so a change of the build must never move a baseline.
 *   - the codes (`.a-code`) of the Agent tab: the prefix of an agent key (random), the address of the API and the prompt for the
 *     agent (both carry the host of the server). The prompt is ten kilobytes of text, which tests/agent-prompt.test.js pins, and
 *     which would make the picture of that tab four times the size of the others.
 */
function dynamicRegions(page) {
  return [
    page.getByText(/\d{2}:\d{2}|\d{2}\/\d{2}\/\d{4}/),
    page.getByLabel('מתאריך'),
    page.getByLabel('עד תאריך'),
    page.locator('.w-build, .a-build'),
    page.locator('.a-code'),
  ]
}

/**
 * Takes the picture of the screen as it is now: `name` is the file (e2e/__screenshots__/visual.spec.js/<name>.png). A soft
 * assertion: a picture that differs does not stop the test, so that one run writes the new image of every screen that changed
 * (the update after an intended change takes them all from one run: docs/testing.md).
 *
 * A screen is taken whole (`whole`): the viewport is made as tall as the page for the picture, then put back. That is what a
 * long screen looks like on a tall phone, and it keeps what is fixed to the bottom of the screen (the tab bar of the committee
 * app on a phone) at the bottom of the picture, where Playwright's own full-page picture would put it in the middle. A dialog is
 * taken as it opens (`whole: false`): the screen that a person sees.
 */
async function shot(page, name, { whole = true } = {}) {
  const viewport = page.viewportSize()
  if (whole) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) })
  }
  try {
    await pageSettled(page) // every request of the screen has been answered, and drawn
    await page.evaluate(() => document.fonts.ready)
    await expect.soft(page).toHaveScreenshot(`${name}.png`, {
      mask: dynamicRegions(page),
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    })
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

// ---- the map ---------------------------------------------------------------------------------------------------------------

/**
 * One tile of the map, drawn here: a 256 by 256 picture, a pale ground with a grid. The map's real tiles come from the internet
 * (OpenStreetMap), and change whenever someone edits the map; this one never does. Built by hand (a PNG is a signature, then three
 * chunks) so that no binary file has to be committed beside the baselines.
 */
function mapTile() {
  const size = 256
  const ground = [233, 229, 220]
  const line = [214, 208, 194]
  const rows = Buffer.alloc((1 + size * 3) * size) // each row: a filter byte (0, none), then one RGB triple per pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = x % 64 === 0 || y % 64 === 0 ? line : ground
      const at = y * (1 + size * 3) + 1 + x * 3
      rows[at] = r
      rows[at + 1] = g
      rows[at + 2] = b
    }
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
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits per channel, RGB, the usual compression and filter, no interlacing
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Answers every tile of the map with the one above, and waits (below) until the map has drawn them all. */
async function stubMapTiles(page) {
  const tile = mapTile()
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png', body: tile }))
}

/** Waits until every tile that the map asked for is drawn and faded in, and the map has stopped moving (it recomputes its size once the dialog has opened). */
async function mapDrawn(page) {
  const state = () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')]
    const pane = document.querySelector('.leaflet-map-pane')
    return {
      tiles: tiles.length,
      // loaded, and faded in all the way (Leaflet raises a tile's opacity from 0 to 1 over 200 ms)
      drawn: tiles.filter((t) => t.classList.contains('leaflet-tile-loaded') && getComputedStyle(t).opacity === '1').length,
      box: JSON.stringify(document.querySelector('.leaflet-container')?.getBoundingClientRect()),
      at: pane ? getComputedStyle(pane).transform : '',
    }
  })
  let before = ''
  await expect.poll(async () => {
    const now = await state()
    const same = JSON.stringify(now) === before && now.tiles > 0 && now.tiles === now.drawn
    before = JSON.stringify(now)
    return same
  }, { message: 'the map has drawn its tiles and stopped moving', intervals: [150], timeout: 15_000 }).toBe(true)
}

// ---- the provider app --------------------------------------------------------------------------------------------------------

/** The sign-in list: waits until the five sample providers and the name of the building are on the screen. */
async function signInListShown(page, title) {
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('list').getByRole('button')).toHaveCount(5)
  await expect(page.getByRole('banner').getByText(BUILDING_NAME)).toBeVisible()
}

/** Picks a language in the picker of the top bar; `from` is the dictionary of the language the screen is in now (it names the picker). */
const pickLanguage = (page, from, code) => page.getByLabel(from['lang.label']).selectOption(code)

// Every sign-in of the run counts against the address's limit (server/auth.js: 60 in 15 minutes, a correct password included), and
// the other specs of the job use most of it (48 of the 60 on 11/10/2026). So the whole spec signs in ONCE, in the second test below,
// and switches the language on the screens instead of signing in again. A failed run starts that test again (a retry): two at most.
test.describe('provider app', () => {
  test.use(PROVIDER_PHONE)

  // One left-to-right language and one right-to-left language besides Hebrew.
  test('the sign-in list in Hebrew, English and Arabic', async ({ page }) => {
    await stopClock(page)
    await page.goto('/')
    await signInListShown(page, he['login.title'])
    await shotBothThemes(page, 'provider-he-sign-in-list')

    await pickLanguage(page, he, 'en') // the person picks it on the phone; nobody sets it for them
    await signInListShown(page, en['login.title'])
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await shotBothThemes(page, 'provider-en-sign-in-list')

    await pickLanguage(page, en, 'ar')
    await signInListShown(page, ar['login.title'])
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await shotBothThemes(page, 'provider-ar-sign-in-list')
  })

  test('in Hebrew: the password, recorded, home with a visit and too far, and the home in English and Arabic', async ({ page, context, request }) => {
    await stopClock(page)
    await clearScans(request) // a visit still on record would answer "already recorded"
    await page.goto('/')
    await signInListShown(page, he['login.title'])
    await page.getByRole('button', { name: new RegExp(PEOPLE.ploni.name) }).click()
    await expect(page.getByLabel(he['login.passwordLabel'], { exact: true })).toBeFocused()
    await shotBothThemes(page, 'provider-he-password')

    await page.goto(`/scan?code=${POINTS.lobby}`) // the way a QR code opens the app; the phone is not signed in yet
    await signIn(page, PEOPLE.ploni)
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await shotBothThemes(page, 'provider-he-recorded')

    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect(page.getByRole('heading', { name: /שלום/ })).toContainText(PEOPLE.ploni.name)
    await expect(page.getByRole('list').getByText('לובי')).toBeVisible()
    await shotBothThemes(page, 'provider-he-home')

    // the same home screen in the other two languages: the same person, the same visit
    await pickLanguage(page, he, 'en')
    await expect(page.getByRole('heading', { name: /Hello/ })).toContainText(PEOPLE.ploni.name)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await shotBothThemes(page, 'provider-en-home')
    await pickLanguage(page, en, 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('list').getByText('לובי')).toBeVisible()
    await shotBothThemes(page, 'provider-ar-home')
    await pickLanguage(page, ar, 'he')
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible()

    await context.setGeolocation(FAR)
    await page.goto(`/scan?code=${POINTS.gym}`) // the gym requires the location, and this phone is 5.5 km away
    await expect(page.getByRole('heading', { name: he['checkin.far.title'] })).toBeVisible()
    await shotBothThemes(page, 'provider-he-too-far')
  })
})

// ---- the committee app ---------------------------------------------------------------------------------------------------------

/**
 * Puts the scratch schema in the state that the committee's screens are drawn from, whatever an earlier spec left behind:
 * no visits, no phone signed in, no agent key but one, nobody else on the committee. Everything is done through the committee's
 * API, the way the dev tools of the other specs do it, and nothing signs a provider in (see the note above the provider tests).
 * Returns `clean`, which removes it again.
 */
async function prepareCommittee(playwright, baseURL) {
  const admin = await playwright.request.newContext({ baseURL })
  const login = await admin.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
  expect(login.ok(), 'dev admin sign-in').toBeTruthy()
  // What a refused call says: the status and the error code of the answer, so that a failure names its cause.
  const refusal = async (response) => (response.ok() ? '' : ` answered ${response.status()} ${(await response.json().catch(() => null))?.error?.code ?? ''}`)
  const send = async (url, data = {}) => {
    const response = await admin.post(url, { data })
    expect(response.ok(), `POST ${url}${await refusal(response)}`).toBeTruthy()
    return response.json()
  }
  const get = async (url) => {
    const response = await admin.get(url)
    expect(response.ok(), `GET ${url}${await refusal(response)}`).toBeTruthy()
    return response.json()
  }
  const remove = async (url) => {
    const response = await admin.delete(url, { data: {} })
    expect(response.ok(), `DELETE ${url}${await refusal(response)}`).toBeTruthy()
  }
  const reset = async () => {
    await clearScans(admin)
    for (const p of (await get('/api/admin/providers')).providers) await send(`/api/admin/providers/${p.id}/revoke-devices`) // no phone signed in
    for (const key of (await get('/api/admin/api-keys')).api_keys) await remove(`/api/admin/api-keys/${key.id}`)
  }

  await reset()
  for (const member of (await get('/api/admin/admins')).admins) if (member.email !== ADMIN_EMAIL) await remove(`/api/admin/admins/${member.id}`)
  await send('/api/admin/api-keys', { name: "האייג'נט של הוועד" })
  return {
    clean: async () => {
      await reset()
      await admin.dispose()
    },
  }
}

/**
 * The visits that the History tab lists: three people at three points on one day, answered in place of the server's list of accepted
 * visits (the shape is `scanJson` in server/scans.js). A real visit means a provider signing in, which the throttle allows only a few
 * times in a run, and its time would be the real one. These carry a fixed day and time, and show the three kinds of badge (a
 * distance, an unverified location, none).
 */
const HISTORY_ROWS = [
  { time: '2026-03-02T10:40:00.000Z', point: 'גימבורי', who: 'ניקיון – פלוני', distance_m: 3, accuracy: 10, flags: [] },
  { time: '2026-03-02T09:15:00.000Z', point: 'לובי', who: 'Cleaning Co – John', distance_m: null, accuracy: null, flags: ['location_unverified'] },
  { time: '2026-03-02T07:05:00.000Z', point: 'מינוס 1', who: 'Уборка – Иван', distance_m: null, accuracy: null, flags: [] },
].map((r, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  checked_in_at: r.time,
  checked_in_local: r.time,
  local_date: '2026-03-02',
  point_id: `00000000-0000-4000-8000-0000000001${i + 1}0`,
  point_name: r.point,
  provider_id: `00000000-0000-4000-8000-0000000002${i + 1}0`,
  provider_name: r.who,
  service_type: 'cleaning',
  source: 'online',
  outcome: 'accepted',
  distance_m: r.distance_m,
  gps_accuracy_m: r.accuracy,
  flags: r.flags,
  voided: false,
  void_reason: null,
}))

/** Answers the History tab's list of visits with HISTORY_ROWS (its CSV export is a link, not a request of the page, and is left alone). */
async function stubHistory(page) {
  await page.route(/\/api\/admin\/scans\?/, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ json: { scans: HISTORY_ROWS, next_cursor: null } })
  })
}

const TABS = [
  ['points', 'נקודות סריקה'],
  ['providers', 'נותני שירות'],
  ['history', 'היסטוריית נוכחות'],
  ['agent', 'גישה לאייג\'נט'],
  ['committee', 'חברי הוועד'],
]

/**
 * Signs the committee in through the API of the scratch schema, on the browser's own cookies, and opens the app: it then shows its
 * first screen at once. (The sign-in button of adminSignIn would first load /admin without a session, and the browser logs the 401
 * of that request as a console error: not something to allow in a test that is about how the screens look.)
 */
async function committeeSignedIn(page) {
  const login = await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
  expect(login.ok(), 'dev admin sign-in').toBeTruthy()
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'נקודות סריקה', level: 1 })).toBeVisible()
}

/** Opens a tab by its address and waits until it has loaded. */
async function openTab(page, tab, title) {
  await page.goto(`/admin#${tab}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}

/** The five tabs, and the dialog of a point and the dialog of a provider, at one width. `width` names the files. */
function committeeScreens(width) {
  test('the five tabs', async ({ page }) => {
    await stopClock(page)
    await stubHistory(page)
    await committeeSignedIn(page)
    for (const [tab, title] of TABS) {
      await openTab(page, tab, title)
      if (tab === 'points') await expect(page.getByRole('article').filter({ hasText: 'לובי' })).toBeVisible()
      if (tab === 'history') await expect(page.getByRole('listitem').filter({ hasText: 'Уборка' })).toBeVisible()
      if (tab === 'agent') await expect(page.getByRole('article').filter({ hasText: 'האייג\'נט של הוועד' })).toBeVisible()
      if (tab === 'committee') await expect(page.getByLabel('שם הבניין', { exact: true })).toHaveValue(BUILDING_NAME)
      await shotBothThemes(page, `committee-${width}-${tab}`)
    }
  })

  test('the dialog of a point and the dialog of a provider', async ({ page }) => {
    await stubMapTiles(page)
    await committeeSignedIn(page)

    await page.getByRole('article').filter({ hasText: 'לובי' }).getByRole('button', { name: 'עריכה' }).click()
    const point = page.getByRole('dialog', { name: 'עריכת נקודה: לובי' })
    await expect(point).toBeVisible()
    await mapDrawn(page)
    await shotBothThemes(page, `committee-${width}-point-dialog`, { whole: false })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await openTab(page, 'providers', 'נותני שירות')
    await page.getByRole('article').filter({ hasText: PEOPLE.ploni.name }).getByRole('button', { name: 'עריכה' }).click()
    await expect(page.getByRole('dialog', { name: `עריכה: ${PEOPLE.ploni.name}` })).toBeVisible()
    await shotBothThemes(page, `committee-${width}-provider-dialog`, { whole: false })
  })
}

test.describe('committee app', () => {
  let state
  test.beforeAll(async ({ playwright, browserName }, testInfo) => {
    test.skip(!canCompare(browserName, testInfo), 'The visual baselines are made by CI on Linux in Chromium (android-chrome) only: see docs/testing.md, "Visual regression"')
    state = await prepareCommittee(playwright, testInfo.project.use.baseURL)
  })
  test.afterAll(async () => {
    await state?.clean()
  })

  test.describe('at 360 px', () => {
    test.use(COMMITTEE_PHONE)
    committeeScreens('360')
  })

  test.describe('at 1280 px', () => {
    test.use(COMMITTEE_COMPUTER)
    committeeScreens('1280')
  })
})
