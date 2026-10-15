// Accessibility of both apps, checked screen by screen with axe-core (the WCAG 2.1 A and AA rules, the WCAG 2.2 AA target
// size, and axe's best practices).
//
// The code takes care of accessibility one piece at a time (roles, live regions, focus traps, accessible names for the
// icon buttons, contrast tests on the colour tokens), and nothing else renders the screens and checks them as a whole,
// so a missing label, a colour written outside the tokens or a broken ARIA attribute would go unnoticed. This spec opens
// the screens of the provider app (in Hebrew and in English) and of the committee app, in the light and in the dark
// theme, and fails with a list of what axe finds. Known problems that are a design decision are in a11y-baseline.js.
//
// To keep it fast, one page load covers several screens: a screen is scanned where it is reached, in the light theme and
// then in the dark one (the device's setting is emulated, which is what the app follows until a person chooses). Every
// scan is of the settled screen: expectNoA11yViolations switches the animations off first.
import { randomUUID } from 'node:crypto'
import ar from '../src/i18n/ar.js'
import { PROVIDER_TOKEN_PREFIX } from '../shared/contract.js'
import {
  test, expect, he, en, ru, POINTS, PEOPLE, FAR, ADMIN_EMAIL, BUILDING_NAME, adminSignIn, clearScans, allowConsoleErrors, expectNoA11yViolations,
  changeFilters, openFilters, SCREEN_TITLES, stubHome, homeSummary, openAccountMenu, openTileMenu, chooseFromMenu, setDate, dateWheels,
} from './fixtures.js'
import { openHarness } from './harness.js'

// No service worker: this spec answers some requests itself (page.route), and a page that a service worker controls
// would not give those requests to it.
test.use({ serviceWorkers: 'block' })

const COMPUTER = { width: 1280, height: 800 }
// A tablet held upright: the filters are in a sheet (below 1024 px) whose dates take typing and open the calendar (from 640 px).
const TABLET = { width: 768, height: 1024 }
const scanLink = (code) => `/scan?code=${code}`
const UNKNOWN_CODE = 'BQR-doesnotexist000000000000' // the shape of a code of ours, that no point has

/**
 * Where axe must not look. Only what is not ours, each one with its reason:
 * - the box that Google's sign-in button is drawn into: the button is an iframe from accounts.google.com, so its markup
 *   and its colours are Google's. (The tests blank GOOGLE_CLIENT_ID, so the box is empty here and this is for the day it
 *   is not; the text around the box is ours and is scanned.)
 */
const GOOGLE_BUTTON = '.a-login__google > div:first-child'

/** Scans the screen as it is now in the light theme, and again in the dark one. Leaves the device light. */
async function scanBothThemes(page, screen, options = {}) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    await expectNoA11yViolations(page, { context: `${screen} [${scheme}]`, ...options })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

// ---- the provider app -----------------------------------------------------------------------------------------------

test.describe('provider app', () => {
  test('in Hebrew: the sign-in list, the password form, every kind of check-in result, and the home screen', async ({ page, context, request }) => {
    await clearScans(request) // a visit that is still on record would answer "already recorded" instead of recording
    allowConsoleErrors(page, /status of 401/, /status of 404/) // the wrong password and the unknown code that this test provokes
    const people = page.getByRole('list').getByRole('button')
    const password = page.getByLabel(he['login.passwordLabel'], { exact: true })

    await page.goto(scanLink(UNKNOWN_CODE)) // no banner: nobody knows the point, and the list is the same as at "/"
    await expect(people).toHaveCount(5) // the five sample providers
    await expect(page.getByRole('banner').getByText(BUILDING_NAME)).toBeVisible() // the header has its two lines: the name of the building above its address
    await scanBothThemes(page, 'provider he: sign-in list')

    await page.goto(scanLink(POINTS.lobby))
    await expect(page.getByText(/נקודת סריקה/)).toContainText('לובי')
    await scanBothThemes(page, 'provider he: sign-in list with the scan point')

    await page.getByRole('button', { name: new RegExp(PEOPLE.ploni.name) }).click()
    await expect(password).toBeVisible()
    await scanBothThemes(page, 'provider he: password form')

    await password.fill('not-the-password')
    await page.getByRole('button', { name: he['login.submit'], exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(he['login.wrong'])
    await scanBothThemes(page, 'provider he: password form with an error')

    await password.fill(PEOPLE.ploni.password)
    await page.getByRole('button', { name: he['login.submit'], exact: true }).click()
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: check-in recorded')

    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect(page.getByRole('heading', { name: /שלום/ })).toContainText(PEOPLE.ploni.name)
    await expect(page.getByRole('list').getByText('לובי')).toBeVisible()
    await scanBothThemes(page, 'provider he: home with a visit')

    await page.goto(scanLink(POINTS.lobby)) // still signed in on this phone
    await expect(page.getByRole('heading', { name: he['checkin.duplicate.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: check-in already recorded')

    await context.setGeolocation(FAR)
    await page.goto(scanLink(POINTS.gym)) // the gym requires the location
    await expect(page.getByRole('heading', { name: he['checkin.far.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: refused, too far')

    // a phone that refuses to say where it is (the browser answers "denied" at once, to a single request and to a watch: a
    // point that requires the location watches the position for a precise reading)
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_done, fail) => fail({ code: 1 })
      navigator.geolocation.watchPosition = (_done, fail) => {
        fail({ code: 1 })
        return 1
      }
    })
    await page.goto(scanLink(POINTS.gym))
    await expect(page.getByRole('heading', { name: he['checkin.needLocation.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: refused, needs the location')

    await page.goto(scanLink(UNKNOWN_CODE))
    await expect(page.getByText(he['error.unknown_code'])).toBeVisible()
    await scanBothThemes(page, 'provider he: refused, unknown code')
  })

  test('in English (left to right): the same journey, and a point that is not the person\'s', async ({ page, request }) => {
    await clearScans(request)
    allowConsoleErrors(page, /status of 401/, /status of 403/) // the wrong password and the point that is not John's
    const password = page.getByLabel(en['login.passwordLabel'], { exact: true })

    await page.goto(scanLink(POINTS.lobby))
    await page.getByLabel(he['lang.label']).selectOption('en') // John picks it himself on his phone
    await expect(page.getByRole('heading', { name: en['login.title'] })).toBeVisible()
    await expect(page.getByText(/Scan point/)).toContainText('לובי')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await scanBothThemes(page, 'provider en: sign-in list with the scan point')

    await page.getByRole('button', { name: new RegExp(PEOPLE.john.name) }).click()
    await expect(password).toBeVisible()
    await scanBothThemes(page, 'provider en: password form')

    await password.fill('not-the-password')
    await page.getByRole('button', { name: en['login.submit'], exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(en['login.wrong'])
    await scanBothThemes(page, 'provider en: password form with an error')

    await password.fill(PEOPLE.john.password)
    await page.getByRole('button', { name: en['login.submit'], exact: true }).click()
    await expect(page.getByRole('heading', { name: en['checkin.success.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider en: check-in recorded')

    await page.getByRole('button', { name: en['checkin.done'] }).click()
    await expect(page.getByRole('heading', { name: /Hello/ })).toContainText(PEOPLE.john.name)
    await expect(page.getByRole('list').getByText('לובי')).toBeVisible()
    await scanBothThemes(page, 'provider en: home with a visit')

    await page.goto(scanLink(POINTS.gym)) // the gym is Ploni's only
    await expect(page.getByText(en['error.not_assigned'])).toBeVisible()
    await scanBothThemes(page, 'provider en: refused, not assigned')
  })

  test('the language picker and the theme picker', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('list').getByRole('button')).toHaveCount(5)
    // A native <select>: the list of choices is the phone's own and is not in the page, so what the page can show is the
    // picker focused, and the screen after a choice. (The labels of both pickers follow the language.)
    await page.getByLabel(he['lang.label']).focus()
    await scanBothThemes(page, 'provider he: language picker focused')
    await page.getByLabel(he['theme.label']).focus()
    await scanBothThemes(page, 'provider he: theme picker focused')

    await page.getByLabel(he['lang.label']).selectOption('ar')
    await expect(page.getByRole('heading', { name: 'اختر حسابك' })).toBeVisible()
    await scanBothThemes(page, 'provider ar: sign-in list')
    await page.getByLabel(ar['lang.label']).selectOption('ru')
    await expect(page.getByRole('heading', { name: ru['login.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider ru: sign-in list')

    // a theme that the person chose is kept whatever the device says: the picker, not the device, sets it here
    const choose = async (choice) => {
      await page.getByLabel(ru['theme.label']).selectOption(choice)
      await expect(page.locator('html')).toHaveAttribute('data-theme', choice)
    }
    await choose('dark')
    await expectNoA11yViolations(page, { context: 'provider ru: theme chosen in the picker [dark]' })
    await choose('light')
    await expectNoA11yViolations(page, { context: 'provider ru: theme chosen in the picker [light]' })
  })

  test('the states that a slow, failing or empty server brings, and a phone with visits saved on it', async ({ page }) => {
    allowConsoleErrors(page, /status of 500/, /status of 503/, /status of 401/) // the answers that this test makes up
    const provider = { id: '00000000-0000-4000-8000-000000000001', contact_name: PEOPLE.ploni.name, company: 'ניקיון' }
    const saved = () => ({
      id: randomUUID(), code: POINTS.lobby, client_time: new Date().toISOString(), gps: null,
      provider_id: provider.id, saved_at: new Date().toISOString(), point_name: 'לובי',
    })
    const answerEveryone = (results) => async (route) => {
      const { scans } = route.request().postDataJSON()
      await route.fulfill({ json: { results: scans.map(({ id }) => ({ id, ok: true, scan: { outcome: results } })) } })
    }

    // the sign-in list while it loads, when it cannot load, and with nobody on it
    let held
    let providersAnswer = (route) => { held = route }
    await page.route('**/api/public/providers', (route) => providersAnswer(route))
    await page.goto('/')
    await expect(page.getByRole('status', { name: he['common.loading'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: sign-in list while it loads')
    await held.fulfill({ status: 500, json: { error: { code: 'server_error' } } })
    await expect(page.getByRole('alert')).toContainText(he['login.loadError'])
    await scanBothThemes(page, 'provider he: sign-in list that could not load')
    providersAnswer = (route) => route.fulfill({ json: { providers: [] } })
    await page.getByRole('button', { name: he['common.retry'] }).click()
    await expect(page.getByText(he['login.noProviders'])).toBeVisible()
    await scanBothThemes(page, 'provider he: sign-in list with nobody on it')

    // A phone that is signed in and has a visit saved on it, and a server that is down: a check-in is saved on the phone
    // too. (The sign-in and the answers are made up here, so that no password and no real visit is needed.)
    providersAnswer = (route) => route.continue()
    let syncAnswer = (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } })
    let sessionAnswer = (route) => route.fulfill({ json: { provider } })
    await page.route('**/api/scans/sync', (route) => syncAnswer(route))
    await page.route('**/api/scan', (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }))
    await page.route('**/api/my/scans', (route) => route.fulfill({ json: { scans: [] } }))
    // the phone reports its status once the session is confirmed: with a token that no server issued, the real server would
    // answer 401 and the app would sign the person out in the middle of this test
    await page.route('**/api/my/device-status', (route) => route.fulfill({ json: { ok: true, build: null } }))
    await page.route('**/api/session', (route) => (route.request().method() === 'GET' ? sessionAnswer(route) : route.continue()))
    // The token has the shape of a device token (the app keeps only a session whose token could be ours), but no server
    // issued it.
    await page.evaluate(([session, visit]) => {
      localStorage.setItem('qr.session', JSON.stringify(session))
      localStorage.setItem('qr.queue.v1', JSON.stringify([visit]))
    }, [{ token: `${PROVIDER_TOKEN_PREFIX}a-token-that-no-server-knows`, provider }, saved()])
    await page.goto(scanLink(POINTS.lobby))
    await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible()
    await scanBothThemes(page, 'provider he: check-in saved on the phone')

    // the same screen when the visit could not be saved with a position: one more line, that the server may refuse it
    await page.evaluate(() => localStorage.removeItem('qr.lastfix.v1')) // the check-in above kept its position, and would be used
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_done, fail) => fail({ code: 2 })
      navigator.geolocation.watchPosition = (_done, fail) => {
        fail({ code: 2 })
        return 1
      }
    })
    await page.goto(scanLink(POINTS.lobby))
    await expect(page.getByText(he['checkin.queued.noLocation'])).toBeVisible()
    await scanBothThemes(page, 'provider he: check-in saved on the phone, without a position')

    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect(page.getByRole('button', { name: he['home.syncNow'] })).toBeVisible() // two visits are waiting
    await scanBothThemes(page, 'provider he: home with visits waiting to be sent')

    // the network is back and the server counts the visits
    syncAnswer = answerEveryone('accepted')
    await page.getByRole('button', { name: he['home.syncNow'] }).click()
    await expect(page.getByText(he['sync.done'])).toBeVisible()
    await scanBothThemes(page, 'provider he: home, the saved visits were sent')

    // a visit that the server does not count (the person had left the point): a warning that stays until it is dismissed
    syncAnswer = answerEveryone('rejected_far')
    await page.evaluate(([visit]) => {
      localStorage.setItem('qr.queue.v1', JSON.stringify([visit]))
      window.dispatchEvent(new Event('online')) // what the browser says when the network returns: the app sends at once
    }, [saved()])
    await expect(page.getByText(/נוכחויות שלא נקלטו/)).toBeVisible()
    await scanBothThemes(page, 'provider he: home, a saved visit was not counted')

    // a stored sign-in that the server no longer knows: back to the list, with a notice
    sessionAnswer = (route) => route.fulfill({ status: 401, json: { error: { code: 'invalid_session' } } })
    await page.goto('/')
    await expect(page.getByText(he['error.invalid_session'])).toBeVisible()
    await scanBothThemes(page, 'provider he: sign-in list with the notice that the sign-in expired')
  })
})

// ---- the committee app -----------------------------------------------------------------------------------------------

/** The map's tiles come from the internet (OpenStreetMap): answer them here, as map-qr.spec.js does. The markers come with the app. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
async function stubMapImages(page) {
  const answer = (route) => route.fulfill({ contentType: 'image/png', body: PIXEL })
  await page.route('https://tile.openstreetmap.org/**', answer)
}

/**
 * The test server does not know its build (it has no VERCEL_GIT_COMMIT_SHA), so it never calls a phone "outdated". The answers that
 * carry that are changed here, so that the note on Ploni's card and the badge in his phones dialog are on the screens that are
 * scanned. Only reads are touched.
 */
async function markPloniOutdated(page) {
  await page.route('**/api/admin/providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const json = await response.json()
    for (const p of json.providers) if (p.contact_name === PEOPLE.ploni.name) p.outdated_devices = 1
    return route.fulfill({ response, json })
  })
  await page.route('**/api/admin/providers/*/devices', async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    // Only the first phone that reported a build is made outdated, so that the page has exactly one such badge however many
    // phones earlier tests left signed in (each of them reports its build, `dev`), and matches outdated_devices = 1 above.
    let marked = false
    json.devices = json.devices.map((d) => {
      if (marked || !d.app_build) return d
      marked = true
      return { ...d, app_build: '1234567', outdated: true }
    })
    return route.fulfill({ response, json })
  })
}

const NEW_PROVIDER = 'בדיקת נגישות' // the company that the provider form of the dialogs is filled with
const NEW_KEY = 'מפתח נגישות' // the start of the name that the agent key of the dialogs is given

const loaded = async (page, title) => {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}
/**
 * Waits until the committee app has signed in and shows its first screen. Nothing more is needed before a tab is opened by
 * address: the tab follows the address through an external store that React subscribes to (src/admin/tab.js), so an address
 * that changes in the moment after the shell appears is not lost. (Until that was so, this also waited for the title, which the
 * effect that attaches the listener sets, because a tab opened in that moment stayed on the first one.)
 */
const signedIn = async (page, title = 'היסטוריית נוכחות') => {
  await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible()
}
const openTab = async (page, tab, title) => {
  await page.goto(`/admin#${tab}`)
  await loaded(page, title)
}

/**
 * Fills the sample schema the way a committee that has used the app for a while would have it: visits that were accepted,
 * refused and cancelled, a provider that is switched off, an agent key that was cancelled, a member whose access was
 * removed. It talks to the API directly, and everything is made at once to save time. Returns what the specs need to
 * find, and `clean`, which removes it all again (the specs that run after this one expect the sample data).
 */
async function fillCommittee(playwright, baseURL) {
  const admin = await playwright.request.newContext({ baseURL })
  const phone = await playwright.request.newContext({ baseURL })
  const login = await admin.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
  expect(login.ok(), 'dev admin sign-in').toBeTruthy()
  const tag = randomUUID().slice(0, 6)
  const send = async (client, url, data = {}, token) => {
    const response = await client.post(url, { data, headers: token ? { authorization: `Bearer ${token}` } : {} })
    expect(response.ok(), `POST ${url}`).toBeTruthy()
    return response.json()
  }
  const post = (url, data) => send(admin, url, data)
  const change = async (url, data) => expect((await admin.patch(url, { data })).ok(), `PATCH ${url}`).toBeTruthy()

  // Ploni and the demo account each sign in on a phone (Ploni's card then shows connected devices) and make visits:
  // one accepted, one refused as too far, one without a position (recorded with a flag) that is then cancelled, and
  // the demo account's. Ploni has a second phone that reports nothing (an old version of the app), and the first one reports
  // visits that wait in its queue, one of them for 30 hours: so his card shows the line and the warning, and his phones dialog
  // both kinds of phone.
  const waiting = { build: 'abcdef1', waiting: 3, oldest_waiting_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), not_accepted_total: 2, overflowed_total: 1 }
  const visits = async () => {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const signIn = async (name, password, { report, silentPhones = 0 } = {}) => {
      const found = providers.find((p) => p.contact_name === name)
      const { token } = await send(phone, '/api/session', { provider_id: found.id, password })
      if (report) await send(phone, '/api/my/device-status', report, token)
      for (let i = 0; i < silentPhones; i++) await send(phone, '/api/session', { provider_id: found.id, password })
      return (code, gps) => send(phone, '/api/scan', { id: randomUUID(), code, gps }, token)
    }
    const [ploni, demo] = await Promise.all([
      signIn(PEOPLE.ploni.name, PEOPLE.ploni.password, { report: waiting, silentPhones: 1 }),
      signIn('לקוח דמה', 'dev-pass-5'),
    ])
    const [, , cancelled] = await Promise.all([
      ploni(POINTS.basement, null),
      ploni(POINTS.gym, { lat: FAR.latitude, lng: FAR.longitude, accuracy: FAR.accuracy }),
      ploni(POINTS.lobby, null),
      demo(POINTS.lobby, null),
    ])
    await post(`/api/admin/scans/${cancelled.scan.id}/void`, { reason: 'נסרק בטעות' })
  }

  // The live key is used past its limit of the minute (130 calls in a row, one after the other: at most 60 are let through in a
  // minute, so even when the run crosses the turn of a minute at least 10 are turned away). Its card on the Agent screen then
  // shows its usage and the warning line for a key that was refused, which the other key (never used) does not have, so the
  // scan covers a card with the warning and one without it.
  const overuse = async (secret) => {
    for (let i = 0; i < 130; i++) {
      const answer = await phone.get('/api/agent/v1/health', { headers: { authorization: `Bearer ${secret}` } })
      expect([200, 429], 'GET /api/agent/v1/health').toContain(answer.status())
    }
  }
  const [live, dead, member, removed, off] = await Promise.all([
    post('/api/admin/api-keys', { name: `פעיל ${tag}` }).then(async (r) => (await overuse(r.key), r.api_key)),
    post('/api/admin/api-keys', { name: `בוטל ${tag}` }).then(async (r) => (await post(`/api/admin/api-keys/${r.api_key.id}/revoke`), r.api_key)),
    post('/api/admin/admins', { email: `a11y-${tag}@example.test`, name: `חבר ${tag}` }).then((r) => r.admin),
    post('/api/admin/admins', { email: `a11y-off-${tag}@example.test`, name: `הוסר ${tag}` }).then(async (r) => (await change(`/api/admin/admins/${r.admin.id}`, { is_active: false }), r.admin)),
    post('/api/admin/providers', { company: `חברה ${tag}`, contact_name: `מושבת ${tag}`, password: `pw-${tag}-1234` }).then(async (r) => (await change(`/api/admin/providers/${r.provider.id}`, { is_active: false }), r.provider)),
    visits(),
  ])

  const clean = async () => {
    await clearScans(admin)
    const providers = (await (await admin.get('/api/admin/providers')).json()).providers
    const ploniId = providers.find((p) => p.contact_name === PEOPLE.ploni.name).id
    // the provider and the key that the dialogs made are found by what they were given
    const keys = (await (await admin.get('/api/admin/api-keys')).json()).api_keys
    await Promise.all([
      admin.post(`/api/admin/providers/${ploniId}/revoke-devices`, { data: {} }),
      ...[live, dead, ...keys.filter((k) => k.name.startsWith(NEW_KEY))].map((key) => admin.delete(`/api/admin/api-keys/${key.id}`, { data: {} })),
      ...[member, removed].map(({ id }) => admin.delete(`/api/admin/admins/${id}`, { data: {} })),
      ...providers.filter((p) => p.id === off.id || p.company === NEW_PROVIDER).map(({ id }) => admin.delete(`/api/admin/providers/${id}`, { data: {} })),
    ])
    await Promise.all([admin.dispose(), phone.dispose()])
  }
  return { member, clean }
}

test.describe('committee app', () => {
  test.beforeEach(async ({ page, request }) => {
    // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
    allowConsoleErrors(page, /status of 401/)
    await clearScans(request)
  })

  test('the sign-in screen, and the history when there are no visits', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'ניהול נוכחות הבניין' })).toBeVisible()
    await expect(page.getByText(BUILDING_NAME)).toBeVisible() // the name of the building, under the title (the public route has answered)
    await scanBothThemes(page, 'committee: sign-in', { exclude: [GOOGLE_BUTTON] })

    await page.getByRole('button', { name: 'כניסת פיתוח' }).click()
    await signedIn(page, SCREEN_TITLES.home) // the first screen, with no screen in the address, is Home
    // Home of a week with no visit: seven bars of 0 and no link among them, and every provider a row of empty dots and a total of 0
    await expect(page.getByRole('region', { name: 'השבוע בבניין' }).getByRole('table')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
    await scanBothThemes(page, 'committee phone: home, no visits this week')
    // A new installation has nothing in it: Home says to start with a point and a provider (the numbers are answered here, as if it were new).
    const emptyBuilding = homeSummary({
      providers: [],
      counts: { points: { active: 0, total: 0 }, providers: { active: 0, total: 0 }, visits_not_counted: 0, waiting: { phones: 0, visits: 0 } },
    })
    const homeRoute = /\/api\/admin\/home$/
    const answerEmpty = (route) => route.fulfill({ json: emptyBuilding })
    await page.route(homeRoute, answerEmpty)
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'עוד אין נקודות ונותני שירות' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: home, nothing in the building yet')
    await page.unroute(homeRoute, answerEmpty)
    await openTab(page, 'history', 'היסטוריית נוכחות')
    await expect(page.getByText('אין נוכחויות בטווח הזה')).toBeVisible()
    await scanBothThemes(page, 'committee phone: history, empty')
    // The filters are a bar above the list, and a sheet from the bottom that its button opens.
    const filters = await openFilters(page)
    await scanBothThemes(page, 'committee phone: history, the filters sheet')
    await filters.getByRole('button', { name: 'סגירה' }).click()

    // A new installation has no points: the first screen says to start with them instead of "widen the dates".
    await page.route('**/api/admin/points', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { points: [] } }) : route.continue()))
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'עוד אין נקודות' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: history, no points yet')
    await page.unroute('**/api/admin/points')
    await page.reload()
    await signedIn(page)

    // The visits that the server did not count, for a stretch of time in which there were none: its own empty state.
    await changeFilters(page, async (sheet) => {
      await sheet.getByLabel('סוג').selectOption({ label: 'לא נקלטו' })
      await setDate(sheet, 'מתאריך', '01/01/2020') // with the wheels
      await setDate(sheet, 'עד תאריך', '02/01/2020')
    })
    await expect(page.getByRole('heading', { level: 2, name: 'אין ביקורים שלא נקלטו בטווח הזה' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: history, no visits not counted')
  })
})

/** Waits for the entries of the audit log screen, with the members that the sample data added among them. */
async function waitForAuditLog(page) {
  const log = page.getByRole('main')
  await expect(log.getByRole('listitem').first()).toBeVisible()
  await expect(log.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
  await expect(log.getByRole('listitem').filter({ hasText: 'הוספת מנהל מערכת' }).first()).toBeVisible() // the members that the sample data added
}

/** Waits until the topics of the help screen are drawn (it is text only: nothing opens). */
async function waitForHelp(page) {
  const help = page.getByRole('main')
  await expect(help.getByRole('heading', { level: 2, name: 'נקודות ושלטי QR' })).toBeVisible()
  await expect(help.getByRole('heading', { level: 2, name: 'כשטלפון תקוע' })).toBeVisible()
}

/** Filters the open log to the agent keys, and waits until the list has changed. */
async function filterAuditLog(page) {
  const log = page.getByRole('main')
  await changeFilters(page, (filters) => filters.getByLabel('סוג פעולה').selectOption({ label: "מפתחות אייג'נט" }), log)
  await expect(log.getByRole('listitem').filter({ hasText: 'הוספת מנהל מערכת' })).toHaveCount(0)
  await expect(log.getByRole('listitem').filter({ hasText: "יצירת מפתח אייג'נט" }).first()).toBeVisible()
}

test.describe('committee app with the sample data filled in', () => {
  let committee
  test.beforeAll(async ({ playwright }, testInfo) => {
    committee = await fillCommittee(playwright, testInfo.project.use.baseURL)
  })
  test.afterAll(async () => {
    await committee?.clean()
  })

  const dialogs = (page) => ({
    dialog: (name) => page.getByRole('dialog', { name }),
    closeWithEscape: async (name) => {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name })).toHaveCount(0)
    },
    // A form that holds something typed asks before Esc closes it (F4): `scan` looks at the question, then "close without saving" ends it.
    discardWithEscape: async (name, scan) => {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'לסגור בלי לשמור?' })).toBeVisible()
      await scan()
      await page.getByRole('dialog', { name: 'לסגור בלי לשמור?' }).getByRole('button', { name: 'סגירה בלי לשמור' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('dialog', { name })).toHaveCount(0)
    },
  })

  test('the eight screens and the sheet under "עוד", on a phone and on a computer', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
    await markPloniOutdated(page)
    await stubHome(page) // Home's summary card and providers with a week of visits of every size (the sample data has none), so that every bar and every dot is scanned
    await adminSignIn(page)
    await signedIn(page)
    await expect(page.getByRole('banner')).toContainText(BUILDING_NAME) // the top bar says the name of the building, not the plain brand
    // (every screen is named by a plain string, so that tests/a11y-report.test.js can read the names from this file)
    await openTab(page, 'home', SCREEN_TITLES.home)
    await expect(page.getByRole('region', { name: 'השבוע בבניין' }).getByRole('table').getByRole('link').first()).toBeVisible()
    await scanBothThemes(page, 'committee phone: home')
    await openTab(page, 'points', 'נקודות סריקה')
    await scanBothThemes(page, 'committee phone: points')
    await openTab(page, 'providers', 'נותני שירות')
    await scanBothThemes(page, 'committee phone: providers')
    await openTab(page, 'history', 'היסטוריית נוכחות')
    await scanBothThemes(page, 'committee phone: history')
    // the sheet of filters that the button of the bar opens
    const historyFilters = await openFilters(page)
    await scanBothThemes(page, 'committee phone: history, the filters sheet')
    await historyFilters.getByRole('button', { name: 'סגירה' }).click()
    // the same screen switched to the visits that the server did not count (the seed has some, from a queue and online)
    await changeFilters(page, (sheet) => sheet.getByLabel('סוג').selectOption({ label: 'לא נקלטו' }))
    await expect(page.getByText('נקודה כבויה').first()).toBeVisible()
    await expect(page.getByText('מהתור בטלפון').first()).toBeVisible()
    await scanBothThemes(page, 'committee phone: history, visits not counted')
    await openTab(page, 'agent', "גישה לאייג'נט")
    // the key that was used past its limit says so, and the page says the limits once (the cards of the other keys have no such line)
    await expect(page.getByText(/^נחסמו \d+ קריאות ב-30 הימים האחרונים בגלל מגבלת הקצב$/)).toHaveCount(1)
    await expect(page.getByText(/^כל מפתח מוגבל ל-\d+ קריאות בדקה ול-\d+ ביום\.$/)).toHaveCount(1)
    await scanBothThemes(page, 'committee phone: agent')
    await openTab(page, 'settings', 'הגדרות')
    await expect(page.getByLabel('שם הבניין', { exact: true })).toHaveValue(BUILDING_NAME) // the card is loaded, with the name filled in
    await scanBothThemes(page, 'committee phone: settings')
    // the name field with a refusal under it (a character that cannot be saved): the message is tied to the field
    await page.getByLabel('שם הבניין', { exact: true }).fill('בניין\tהדוגמה')
    await page.getByRole('button', { name: 'שמירה', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'השם מכיל תווים שאי אפשר לשמור' })).toBeVisible()
    // The click on "שמירה" left the page scrolled to its end, and that end moved down by the room that the fade of the tab bar needs: the "more actions" button of a
    // card now stands under the sticky top bar, which axe reads as an obscured target (a state of the scroll, not of the screen). Every other
    // screen is scanned from its top, so this one is too.
    await page.evaluate(() => window.scrollTo(0, 0))
    await scanBothThemes(page, 'committee phone: settings, the name refused')
    await page.getByLabel('שם הבניין', { exact: true }).fill(BUILDING_NAME)
    await expect(page.getByRole('alert').filter({ hasText: 'השם מכיל תווים שאי אפשר לשמור' })).toHaveCount(0)
    // the audit log: a screen of its own (the sample data above wrote its entries)
    await openTab(page, 'audit', 'יומן פעולות')
    await waitForAuditLog(page)
    await scanBothThemes(page, 'committee phone: audit log')
    // the filters of the log are in a sheet on a phone, as the History tab's are
    const auditFilters = await openFilters(page)
    await scanBothThemes(page, 'committee phone: audit log, the filters sheet')
    await auditFilters.getByRole('button', { name: 'סגירה' }).click()
    // with a filter on: only the entries of the agent keys (the members that were added leave the list)
    await filterAuditLog(page)
    await scanBothThemes(page, 'committee phone: audit log, filtered by group')
    // the help: a screen of its own (text only)
    await openTab(page, 'help', 'איך עובדים עם המערכת')
    await waitForHelp(page)
    await scanBothThemes(page, 'committee phone: help')
    // the sheet that the fourth button of the tab bar opens, over the help (which it marks as the current screen)
    await page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'עוד', exact: true })).toBeVisible()
    await scanBothThemes(page, 'committee phone: the sheet under "עוד"')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the account menu of the top bar, open over the help: a dialog that is not modal, with the light / dark radio group
    await openAccountMenu(page)
    await scanBothThemes(page, 'committee phone: the account menu')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the history with every kind of row: refused, cancelled, flagged, and the demo account's
    await openTab(page, 'history', 'היסטוריית נוכחות')
    await changeFilters(page, async (sheet) => {
      await sheet.getByLabel('סוג').selectOption('all')
      await sheet.getByLabel('כולל מבוטלות').check()
      await sheet.getByLabel('כולל חשבון דמו').check()
    })
    await expect(page.getByText('נדחתה: רחוק מהנקודה')).toBeVisible()
    await expect(page.getByText(/מבוטלת: נסרק בטעות/)).toBeVisible()
    await scanBothThemes(page, 'committee phone: history, every kind of row') // the bar now holds the chips of the three filters
    // the "more" menu of a row, open: restoring a cancelled visit, a separator, and the red delete
    await openTileMenu(page.getByRole('listitem').filter({ hasText: /מבוטלת: נסרק בטעות/ }).first())
    await scanBothThemes(page, 'committee phone: the "more" menu of a cancelled visit, open')
    await page.keyboard.press('Escape')
    // a date field that holds a date that does not exist (31 February): flagged with aria-invalid, in red. Only a field that takes typing can
    // hold one: the sheet of a tablet (on a phone the wheels give whole dates only).
    const phoneSize = page.viewportSize()
    await page.setViewportSize(TABLET)
    const unfinished = await openFilters(page)
    const until = unfinished.getByLabel('עד תאריך')
    await until.fill('')
    await until.pressSequentially('31022026')
    await expect(until).toHaveAttribute('aria-invalid', 'true')
    await scanBothThemes(page, 'committee tablet: history, a date that does not exist')
    // "show results" does not apply it quietly: the message is under the field, which has the focus
    await unfinished.getByRole('button', { name: 'הצגת תוצאות' }).click()
    await expect(unfinished.getByRole('alert')).toContainText('התאריך לא תקין')
    await expect(until).toBeFocused()
    await scanBothThemes(page, 'committee tablet: history, a date that does not exist, with the message')
    // Esc with an unfinished date in the sheet asks before it closes (F4)
    await page.keyboard.press('Escape')
    const question = page.getByRole('dialog', { name: 'לסגור בלי להציג את התוצאות?' })
    await expect(question).toBeVisible()
    await scanBothThemes(page, 'committee tablet: history, the question before the filters sheet is closed')
    await question.getByRole('button', { name: 'סגירה בלי להציג' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize(phoneSize)

    // The side rail replaces the top bar and the tab bar. The screens are the same markup at any width, so a few of
    // them are enough to see the rail (its two groups and the line between them) and the wider layout.
    await page.setViewportSize(COMPUTER)
    await openTab(page, 'home', SCREEN_TITLES.home)
    await expect(page.getByRole('region', { name: 'השבוע בבניין' }).getByRole('table').getByRole('link').first()).toBeVisible()
    await scanBothThemes(page, 'committee computer: home')
    await openTab(page, 'points', 'נקודות סריקה')
    await expect(page.getByRole('complementary')).toContainText(BUILDING_NAME) // the side rail says the name of the building too
    await scanBothThemes(page, 'committee computer: points')
    await openTab(page, 'providers', 'נותני שירות')
    await scanBothThemes(page, 'committee computer: providers')
    // a tile's "more" menu, open: the screen's actions, switching off, a separator, and the red delete
    await openTileMenu(page.getByRole('article').filter({ hasText: PEOPLE.ploni.name }))
    await scanBothThemes(page, 'committee computer: the "more" menu of a provider, open')
    await page.keyboard.press('Escape')
    await chooseFromMenu(page.getByRole('article').filter({ hasText: PEOPLE.ploni.name }), 'מכשירים')
    // (a phone that an earlier test signed Ploni in on is listed too, so "at least his two": the one that reports and the one that does not)
    await expect(page.getByRole('dialog', { name: `מכשירים: ${PEOPLE.ploni.name}` }).getByRole('heading', { level: 3 }).nth(1)).toBeVisible()
    await scanBothThemes(page, 'committee computer: provider phones dialog')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openTab(page, 'history', 'היסטוריית נוכחות')
    await scanBothThemes(page, 'committee computer: history')
    await openTileMenu(page.getByRole('listitem').filter({ hasText: 'מינוס 1' }).first()) // cancelling, a separator, and the red delete
    await scanBothThemes(page, 'committee computer: the "more" menu of a visit, open')
    await page.keyboard.press('Escape')
    await page.getByLabel('סוג').selectOption({ label: 'לא נקלטו' })
    await expect(page.getByText('נקודה כבויה').first()).toBeVisible()
    await expect(page.getByText('מהתור בטלפון').first()).toBeVisible()
    await scanBothThemes(page, 'committee computer: history, visits not counted')
    await openTab(page, 'settings', 'הגדרות')
    await expect(page.getByLabel('שם הבניין', { exact: true })).toHaveValue(BUILDING_NAME)
    await scanBothThemes(page, 'committee computer: settings')
    await openTab(page, 'help', 'איך עובדים עם המערכת')
    await waitForHelp(page)
    await scanBothThemes(page, 'committee computer: help')
    await openTab(page, 'audit', 'יומן פעולות')
    await waitForAuditLog(page)
    await scanBothThemes(page, 'committee computer: audit log')
    // the account menu of the side rail, open over the audit log: it stands over its button, at the foot of the rail
    await openAccountMenu(page)
    await scanBothThemes(page, 'committee computer: the account menu')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the dialogs of the points and the providers', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
    await stubMapImages(page)
    await markPloniOutdated(page)
    await page.addInitScript(() => {
      window.__prints = 0
      window.print = () => { window.__prints += 1 }
    })
    await adminSignIn(page, 'points')
    await signedIn(page, 'נקודות סריקה')
    const { dialog, closeWithEscape, discardWithEscape } = dialogs(page)

    // the form with the map, with an error, the QR dialog, and the questions
    const lobby = page.getByRole('article').filter({ hasText: 'לובי' })
    await openTileMenu(lobby)
    await scanBothThemes(page, 'committee phone: the "more" menu of a point, open')
    await page.keyboard.press('Escape')
    await chooseFromMenu(lobby, 'עריכה')
    const form = dialog('עריכת נקודה: לובי')
    await expect(form.locator('img.leaflet-tile-loaded').first()).toBeAttached() // the map has drawn
    await scanBothThemes(page, 'committee phone: point form with the map')
    await form.getByLabel('שם הנקודה').fill('')
    await form.getByRole('button', { name: 'שמירה' }).click()
    await expect(form.getByText('צריך שם לנקודה.')).toBeVisible()
    await scanBothThemes(page, 'committee phone: point form with an error')
    await discardWithEscape('עריכת נקודה: לובי', () => scanBothThemes(page, 'committee phone: the question before a form with typed changes is closed'))

    await chooseFromMenu(lobby, 'QR והדפסה')
    const qr = dialog('QR: לובי')
    await expect.poll(() => qr.getByRole('img', { name: 'קוד QR של הנקודה לובי' }).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
    await scanBothThemes(page, 'committee phone: QR dialog')
    await qr.getByRole('button', { name: 'החלפת קוד ה-QR' }).click()
    await expect(dialog('להחליף את קוד ה-QR?')).toBeVisible() // a question on top of the QR dialog
    await scanBothThemes(page, 'committee phone: confirm on top of another dialog')
    await closeWithEscape('להחליף את קוד ה-QR?')

    // The sign is on the page only for the printer (hidden on a screen), so the page is scanned the way the printer sees it.
    // The browser's own print dialog is outside the page: count the call instead.
    await qr.getByRole('button', { name: 'הדפסת שלט' }).click()
    await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1) // the sheet is built and shown
    await page.emulateMedia({ media: 'print' })
    // PrintSheet marks the whole sheet aria-hidden="true", which is right on a screen (a screen reader must not read a
    // second copy of the sign), but it also takes the sign out of what axe looks at: with the print styles only the sheet
    // is left, so axe would scan an empty page and pass whatever the sign looks like. So for this scan only, the attribute
    // is taken off, and the sign must then really be in the accessibility tree before axe is asked.
    await page.evaluate(() => document.querySelector('.a-print-only').removeAttribute('aria-hidden'))
    await expect(page.getByRole('heading', { name: 'לובי' })).toBeVisible()
    await expectNoA11yViolations(page, { context: 'committee: the printed sign [print]' })
    await page.emulateMedia({ media: null })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))) // what the browser says when printing is over: the sheet goes

    await chooseFromMenu(lobby, 'מחיקת הנקודה')
    await expect(dialog('למחוק את "לובי"?')).toBeVisible()
    await scanBothThemes(page, 'committee phone: confirm, delete a point')
    await closeWithEscape('למחוק את "לובי"?')

    // providers: the form with an error, the password that is shown once (with the message on the screen), a new password
    await openTab(page, 'providers', 'נותני שירות')
    await page.getByRole('button', { name: 'נותן שירות חדש' }).click()
    const provider = dialog('נותן שירות חדש')
    await expect(provider).toBeVisible()
    await scanBothThemes(page, 'committee phone: provider form')
    await provider.getByRole('button', { name: 'שמירה' }).click()
    await expect(provider.getByText('צריך שם חברה או שם.')).toBeVisible()
    await scanBothThemes(page, 'committee phone: provider form with an error')
    await provider.getByLabel('חברה').fill(NEW_PROVIDER)
    await provider.getByRole('button', { name: 'שמירה' }).click()
    await expect(dialog('הסיסמה נשמרה')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'נותן השירות נוסף' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: password shown once, with a message on the screen')
    await closeWithEscape('הסיסמה נשמרה')

    await chooseFromMenu(page.getByRole('article').filter({ hasText: PEOPLE.ploni.name }), 'סיסמה חדשה')
    await expect(dialog(`סיסמה חדשה: ${PEOPLE.ploni.name}`)).toBeVisible()
    await scanBothThemes(page, 'committee phone: new password dialog')
    await closeWithEscape(`סיסמה חדשה: ${PEOPLE.ploni.name}`)

    // the phones of a provider: what each phone reported, read only, with the sign-out of all of them at the bottom; then the
    // same dialog for a provider whose phones were all signed out meanwhile (answered here) and when the list cannot be loaded
    const phones = `מכשירים: ${PEOPLE.ploni.name}`
    const ploni = page.getByRole('article').filter({ hasText: PEOPLE.ploni.name })
    await chooseFromMenu(ploni, 'מכשירים')
    await expect(dialog(phones).getByRole('heading', { level: 3 }).nth(1)).toBeVisible() // at least his two phones (see the computer scan)
    await expect(dialog(phones).getByText('ישנה', { exact: true })).toBeVisible()
    await scanBothThemes(page, 'committee phone: provider phones dialog')
    await closeWithEscape(phones)

    await page.route('**/api/admin/providers/*/devices', (route) => route.fulfill({ json: { devices: [] } }))
    await chooseFromMenu(ploni, 'מכשירים')
    await expect(dialog(phones).getByRole('heading', { name: 'אין מכשירים מחוברים' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: provider phones dialog, no phone')
    await closeWithEscape(phones)

    allowConsoleErrors(page, /status of 500/) // the list that is answered with an error below
    await page.route('**/api/admin/providers/*/devices', (route) => route.fulfill({ status: 500, json: { error: { code: 'server_error', message: 'x' } } }))
    await chooseFromMenu(ploni, 'מכשירים')
    await expect(dialog(phones).getByRole('heading', { name: 'לא הצלחנו לטעון' })).toBeVisible()
    await expect(dialog(phones).getByRole('button', { name: 'ניתוק כל המכשירים' })).toBeVisible()
    await scanBothThemes(page, 'committee phone: provider phones dialog, not loaded')
    await closeWithEscape(phones)
  })

  test('the dialogs of the history, the agent keys and the settings', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
    await adminSignIn(page)
    await signedIn(page)
    const { dialog, closeWithEscape, discardWithEscape } = dialogs(page)

    // history: cancelling a visit, deleting one
    await openTab(page, 'history', 'היסטוריית נוכחות')
    const row = page.getByRole('listitem').filter({ hasText: 'מינוס 1' }).first()
    await chooseFromMenu(row, 'ביטול הנוכחות')
    await expect(dialog('ביטול נוכחות')).toBeVisible()
    await scanBothThemes(page, 'committee phone: cancel a visit')
    await closeWithEscape('ביטול נוכחות')
    await chooseFromMenu(row, 'מחיקת הנוכחות לצמיתות')
    await expect(dialog('למחוק את הנוכחות לצמיתות?')).toBeVisible()
    await scanBothThemes(page, 'committee phone: confirm, delete a visit')
    await closeWithEscape('למחוק את הנוכחות לצמיתות?')

    // agent keys: the form with an error, and the key that is shown once
    await openTab(page, 'agent', 'גישה לאייג\'נט')
    await page.getByRole('button', { name: 'מפתח חדש' }).click()
    const form = dialog('מפתח גישה חדש')
    await expect(form).toBeVisible()
    await scanBothThemes(page, 'committee phone: new agent key')
    await form.getByRole('button', { name: 'יצירה' }).click()
    await expect(form.getByText(/תנו למפתח שם/)).toBeVisible()
    await scanBothThemes(page, 'committee phone: new agent key with an error')
    await form.getByLabel('שם המפתח').fill(`${NEW_KEY} ${randomUUID().slice(0, 6)}`)
    await form.getByRole('button', { name: 'יצירה' }).click()
    await expect(dialog('המפתח נוצר')).toBeVisible()
    await scanBothThemes(page, 'committee phone: agent key shown once')
    await closeWithEscape('המפתח נוצר')
    // the key's card has no edit action: its "more" button is alone, and its menu holds revoking and the red delete
    await openTileMenu(page.getByRole('article').filter({ hasText: NEW_KEY }).first())
    await scanBothThemes(page, 'committee phone: the "more" menu of an agent key, open')
    await page.keyboard.press('Escape')

    // settings: adding a member, and taking an access away
    await openTab(page, 'settings', 'הגדרות')
    await page.getByRole('button', { name: 'מנהל מערכת חדש' }).click()
    const add = dialog('מנהל מערכת חדש')
    await expect(add).toBeVisible()
    await scanBothThemes(page, 'committee phone: new member')
    await add.getByLabel('כתובת Gmail').fill('not-an-address')
    await add.getByRole('button', { name: 'הוספה' }).click()
    await expect(add.getByText('כתובת מייל לא תקינה.')).toBeVisible()
    await scanBothThemes(page, 'committee phone: new member with an error')
    await discardWithEscape('מנהל מערכת חדש', () => scanBothThemes(page, 'committee phone: the question before a new member with a typed address is closed'))
    const member = page.getByRole('article').filter({ hasText: committee.member.name })
    await openTileMenu(member)
    await scanBothThemes(page, 'committee phone: the "more" menu of a member, open')
    await page.keyboard.press('Escape')
    await chooseFromMenu(member, 'הסרת גישה')
    await expect(page.getByRole('dialog')).toBeVisible()
    await scanBothThemes(page, 'committee phone: confirm, remove an access')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

// The committee app's own date picker (src/admin/DatePicker.jsx), open. On a phone (below 640 px) the field of a date is a button that opens
// three wheels in a sheet over the sheet of filters: each wheel is a listbox whose options are 44 px rows, each named so that a screen reader
// reads it without guessing, and the band of the chosen row and the rows around it are held to AA by tests/contrast.test.js as well. From
// 640 px the field has a calendar beside it: a popover over the sheet of filters of a tablet, and beside its field on a computer. Its grid is
// a table with the role of a grid, its days are 44 px buttons named by their full date, and its colours (a chosen day, the band of the range,
// today, a day after today) are held to AA by tests/contrast.test.js.
test.describe('the date picker', () => {
  test('open: the wheels over the filters sheet on a phone, the calendar over it on a tablet, and beside its field on a computer', async ({ page }) => {
    const login = await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } }) // no sign-in screen, so no 401 to allow
    expect(login.ok(), 'dev admin sign-in').toBeTruthy()
    await page.goto('/admin#history')
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
    let filters = await openFilters(page)
    await filters.getByLabel('מתאריך', { exact: true }).click()
    const wheels = dateWheels(page)
    await expect(wheels.getByRole('listbox')).toHaveCount(3)
    await expect(wheels.getByRole('listbox', { name: 'יום', exact: true }).getByRole('option', { selected: true })).toBeFocused()
    await scanBothThemes(page, 'committee phone: the date wheels, open over the filters sheet')
    await page.keyboard.press('Escape') // the wheels
    await expect(wheels).toHaveCount(0)
    await page.keyboard.press('Escape') // the sheet, which has nothing chosen in it
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.setViewportSize(TABLET)
    filters = await openFilters(page)
    await filters.getByRole('button', { name: 'לוח שנה: תאריך התחלה' }).click()
    const start = page.getByRole('dialog', { name: 'תאריך התחלה', exact: true })
    await expect(start.getByRole('grid')).toBeVisible()
    await scanBothThemes(page, 'committee tablet: the date picker, open over the filters sheet')
    await page.keyboard.press('Escape') // the picker
    await expect(start).toHaveCount(0)
    await page.keyboard.press('Escape') // the sheet, which has nothing chosen in it
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.setViewportSize(COMPUTER)
    await page.getByRole('button', { name: 'לוח שנה: תאריך סיום' }).click()
    const end = page.getByRole('dialog', { name: 'תאריך סיום', exact: true })
    await expect(end.getByRole('grid')).toBeVisible()
    await scanBothThemes(page, 'committee computer: the date picker, open beside its field')
  })
})

// The shared components on their own page (e2e/harness.js), before any screen uses them: the "more" menu of a tile (Menu in
// src/admin/ui.jsx) open, with an item that is off, and inside a dialog, on a phone and on a computer. The screens scan it again where
// they use it.
test.describe('the shared components on their own page', () => {
  test('the "more" menu, open: on a card, with an item that is off, and inside a dialog', async ({ page }) => {
    const open = async (scope, label) => {
      await scope.getByRole('button', { name: label, exact: true }).click()
      await expect(scope.getByRole('menu', { name: label }).getByRole('menuitem').first()).toBeFocused()
    }
    await openHarness(page)
    await open(page, 'עוד פעולות ללובי')
    await page.keyboard.press('ArrowDown') // an item with the focus, the other with none
    await scanBothThemes(page, 'components phone: the "more" menu, open')
    await page.keyboard.press('Escape')
    await open(page, 'עוד פעולות לנוכחות בחניון')
    await scanBothThemes(page, 'components phone: a "more" menu with an item that is off')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'פתיחת חלון' }).click()
    const dialog = page.getByRole('dialog', { name: 'עריכת נקודה' })
    await open(dialog, 'עוד פעולות לנקודה בחלון')
    await scanBothThemes(page, 'components phone: a dialog with its "more" menu open')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.setViewportSize(COMPUTER)
    await open(page, 'עוד פעולות ללובי')
    await scanBothThemes(page, 'components computer: the "more" menu, open')
  })
})
