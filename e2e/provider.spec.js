// The service provider's journey on a phone: open a scan link, sign in, check in, and every way it can be refused.
import ar from '../src/i18n/ar.js'
import { test, expect, he, en, ru, POINTS, PEOPLE, FAR, OFFLINE_NOISE, skipOfflineOnWebKit, signIn, clearScans, allowConsoleErrors } from './fixtures.js'

const scanLink = (code) => `/scan?code=${code}`

test.beforeEach(async ({ request }) => {
  await clearScans(request)
})

test('a scan link opens the sign-in list, in Hebrew, naming the point', async ({ page }) => {
  await page.goto(scanLink(POINTS.lobby))
  await expect(page.getByRole('heading', { name: he['login.title'] })).toBeVisible()
  await expect(page.getByText(/נקודת סריקה/)).toContainText('לובי')
  await expect(page.getByRole('list').getByRole('button')).toHaveCount(5) // the five sample providers
  await expect(page.locator('html')).toHaveAttribute('lang', 'he')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: he['privacy.title'] })).toBeVisible()
})

test('with five accounts on the list, the privacy notice is above the first one and in view on a 390 x 844 phone in every language, and opens the short notice with the way to the whole of it', async ({ page }) => {
  // Under the list it went out of view once a building had a few providers (owner, 28/10/2026): it is now beside the video link, as on home.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(scanLink(POINTS.lobby))
  let now = he
  for (const [code, words] of [['he', he], ['en', en], ['ru', ru], ['ar', ar]]) {
    await page.getByLabel(now['lang.label']).selectOption(code)
    now = words
    await expect(page.getByRole('heading', { name: words['login.title'] })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const rows = page.getByRole('list').getByRole('button')
    await expect(rows).toHaveCount(5) // the five sample providers
    const opener = page.getByRole('button', { name: words['privacy.title'] })
    await expect(opener).toBeInViewport({ ratio: 1 })
    const box = await opener.boundingBox()
    expect(box.y + box.height, `${code}: the bottom of the privacy button, above the first account`).toBeLessThanOrEqual((await rows.first().boundingBox()).y)
    expect(box.y + box.height, `${code}: the bottom of the privacy button, in a screen 844 px high`).toBeLessThanOrEqual(844)

    await opener.click()
    const sheet = page.getByRole('dialog', { name: words['privacy.title'] })
    await expect(sheet.getByText(words['login.privacy'])).toBeVisible()
    await expect(sheet.getByRole('link', { name: words['privacy.open'] })).toHaveAttribute('href', '/privacy')
    await sheet.getByRole('button', { name: words['common.close'] }).click()
    await expect(sheet).toBeHidden()
    await expect(opener).toBeFocused()
  }
  await page.getByRole('button', { name: now['privacy.title'] }).click()
  await page.getByRole('dialog', { name: now['privacy.title'] }).getByRole('link', { name: now['privacy.open'] }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: now['privacy.title'] })).toBeVisible()
})

test('the sign-in list links to the tutorial video from its start, and its first accounts stay above the fold of a 390 x 844 phone in every language', async ({ page }) => {
  // The video teaches this very sign-in. Only Hebrew is published, so every language opens the Hebrew player page from the start
  // (src/worker/tutorial.js). The link sits between the sentence under the title and the list: it must not push the list down.
  const FROM_START = 'https://building-attendance.github.io/building-qr-system/video/he/'
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(scanLink(POINTS.lobby))
  let now = he
  for (const [code, words] of [['he', he], ['en', en], ['ru', ru], ['ar', ar]]) {
    await page.getByLabel(now['lang.label']).selectOption(code)
    now = words
    await expect(page.getByRole('heading', { name: words['login.title'] })).toBeVisible()
    const link = page.getByRole('link', { name: words['home.tutorial'] })
    await expect(link).toHaveAttribute('href', FROM_START)
    await expect(link).toHaveAttribute('target', '_blank')
    await page.evaluate(() => document.fonts.ready) // the letters of a language that was not on the screen yet change the line breaks
    const rows = page.getByRole('list').getByRole('button')
    await expect(rows).toHaveCount(5)
    for (const index of [0, 1]) {
      const box = await rows.nth(index).boundingBox()
      expect(box.y + box.height, `${code}: the bottom of account ${index + 1} of the list, in a screen 844 px high`).toBeLessThanOrEqual(844)
    }
    // The committee's way in is in the top bar, so a list of any length never pushes it out of view (owner, 27/10/2026).
    const entry = page.getByRole('link', { name: words['footer.admin'] })
    await expect(entry).toHaveAttribute('href', '/admin')
    const box = await entry.boundingBox()
    expect(box.y + box.height, `${code}: the bottom of the committee's way in, above the first account`).toBeLessThanOrEqual((await rows.first().boundingBox()).y)
  }
})

test('a section title of the privacy notice gets the margin that its class declares', async ({ page }) => {
  // The reset of headings and paragraphs (`.w-app p`, `.w-app h2`) once outranked a single class and cancelled what it declared: the privacy
  // note that the sign-in list had then lost its padding. tests/design-css.test.js holds the reset at no specificity; this is what the
  // browser lays out, on an h2 whose one class declares a margin (the note is gone since the notice opens in a sheet, owner 28/10/2026).
  await page.goto('/privacy')
  const title = page.getByRole('heading', { level: 2 }).first()
  await expect(title).toBeVisible()
  const { declared, computed, expected } = await title.evaluate((el) => {
    const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((r) => r.selectorText === '.w-section-title')
    const probe = document.body.appendChild(document.createElement('div')) // the declared margin, with its token resolved
    probe.style.marginBlockEnd = rule?.style.marginBlockEnd ?? ''
    const out = { declared: rule?.style.marginBlockEnd ?? '', computed: getComputedStyle(el).marginBottom, expected: getComputedStyle(probe).marginBottom }
    probe.remove()
    return out
  })
  expect(declared, 'the stylesheet declares a margin under the title').not.toBe('')
  expect(expected, 'the declared margin resolves to a length').not.toBe('0px')
  expect(computed, `the margin that the title gets is the one its class declares (${declared})`).toBe(expected)
})

// A name that wraps onto many lines (owner decision of 16/10/2026): the letter circle sits level with the FIRST line of the name, at the top of
// the block, and not in the middle of the whole of it (it was centred: beside a name of nine lines the circle floated far below the first one).
// Measured in the browser, on the boxes that the engine laid out: the circle starts within the first line of the name (between the top of the
// name and one line below it), and the name takes at least three lines, so that a circle that is centred fails this. The name itself is not cut.
test('beside a name that wraps onto many lines the letter circle sits level with its first line, in the sign-in list and on the password screen', async ({ page, request }) => {
  const person = {
    company: 'Placeholder Cleaning And Maintenance Ltd',
    contact_name: 'Example Placeholder Longname-Testington, supervisor of the northern stairwells and of all the lifts',
    password: 'dev-pass-circle', // exists only inside the scratch schema
  }
  const created = await request.post('/api/admin/providers', { data: person }) // the request of the test is signed in as the dev admin (beforeEach)
  expect(created.ok(), 'the long-named provider is created').toBeTruthy()
  const { provider } = await created.json()
  /** The box of the name as the engine laid it out: where it starts, its height and the height of one of its lines. */
  const boxOf = (name) => name.evaluate((el) => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }))
  /** `circle` is the one element with the person's initial. */
  const expectLevelWithFirstLine = async (circle, name, where) => {
    const text = await boxOf(name)
    const box = await circle.boundingBox()
    expect(text.lineHeight, `${where}: the height of a line is known`).toBeGreaterThan(0)
    expect(text.height, `${where}: the name wraps onto at least three lines`).toBeGreaterThan(text.lineHeight * 2.5)
    expect(box.y, `${where}: the circle starts no higher than the name`).toBeGreaterThanOrEqual(text.top - 1)
    expect(box.y, `${where}: the circle starts within the first line of the name (centred, it would start far below it)`).toBeLessThanOrEqual(text.top + text.lineHeight)
  }
  try {
    await page.setViewportSize({ width: 320, height: 640 }) // the narrowest phone: the name wraps the most
    await page.goto('/')
    const tile = page.getByRole('button', { name: new RegExp(person.contact_name.slice(0, 20)) })
    await expect(tile).toBeVisible()
    await expectLevelWithFirstLine(tile.getByText('E', { exact: true }), tile.getByText(person.contact_name, { exact: true }), 'the tile of the sign-in list')

    await tile.click()
    const greeting = page.getByRole('heading', { level: 1 })
    await expect(greeting).toContainText(person.contact_name)
    const circle = page.getByText('E', { exact: true })
    await expectLevelWithFirstLine(circle, greeting, 'the password screen')
    // on the password screen nothing is between the top of the block and the circle: the circle starts where the name starts
    expect(Math.abs((await circle.boundingBox()).y - (await greeting.boundingBox()).y), 'the circle and the name start at the same height').toBeLessThan(1)
    await expect(greeting, 'the name is not cut: all of it is in the page').toContainText(person.contact_name)
  } finally {
    await request.delete(`/api/admin/providers/${provider.id}`, { data: {} })
  }
})

test('a wrong password is refused with a clear message and a clear field', async ({ page }) => {
  allowConsoleErrors(page, /status of 401/) // the browser notes the 401 this test provokes
  await page.goto(scanLink(POINTS.lobby))
  await signIn(page, { name: PEOPLE.ploni.name, password: 'not-the-password' })
  await expect(page.getByRole('alert')).toContainText(he['login.wrong'])
  await expect(page.getByLabel(he['login.passwordLabel'], { exact: true })).toHaveValue('')
})

test('signing in checks in at the point, names who signed in, and lists the visit on the home screen', async ({ page }) => {
  await page.goto(scanLink(POINTS.lobby))
  await signIn(page, PEOPLE.ploni)

  await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
  await expect(page.getByText(/משתמש:/)).toContainText(`${PEOPLE.ploni.name} · ניקיון`)
  // The outcome of a check-in has nothing else on its screen: the committee's way in is on the sign-in list and home only.
  await expect(page.getByRole('link', { name: he['footer.admin'] })).toHaveCount(0)

  await page.getByRole('button', { name: he['checkin.done'] }).click()
  await expect(page.getByRole('heading', { name: /שלום/ })).toContainText(PEOPLE.ploni.name)
  await expect(page.getByRole('list').getByText('לובי')).toBeVisible()
  await expect(page.getByRole('list').getByText(/^\d{2}:\d{2}$/)).toBeVisible() // the time of the visit: HH:MM

  // The link to the tutorial video: an ordinary link that opens the player page in a new tab, the whole video like the sign-in screen's.
  // Only Hebrew is published, so English falls back to the Hebrew page for now (src/worker/tutorial.js).
  const TUTORIAL_PAGE = 'https://building-attendance.github.io/building-qr-system/video/he/'
  const tutorial = page.getByRole('link', { name: he['home.tutorial'] })
  await expect(tutorial).toHaveAttribute('href', TUTORIAL_PAGE)
  await expect(tutorial).toHaveAttribute('target', '_blank')

  // The three steps on the violet card must not push today's visit below the fold of a 390 x 844 phone, in any of the four languages
  // (the Russian words are the longest). The language is picked on the screen, so this signs in no one again (the sign-ins of a run are
  // rationed: docs/testing.md, "Visual regression").
  await page.setViewportSize({ width: 390, height: 844 })
  let now = he
  for (const [code, words] of [['he', he], ['en', en], ['ru', ru], ['ar', ar]]) {
    await page.getByLabel(now['lang.label']).selectOption(code)
    now = words
    const visits = page.getByRole('region', { name: words['home.today'] })
    await expect(visits).toBeVisible()
    await expect(page.getByRole('link', { name: words['home.tutorial'] })).toHaveAttribute('href', TUTORIAL_PAGE)
    await page.evaluate(() => document.fonts.ready) // the letters of a language that was not on the screen yet change the line breaks
    const box = await visits.boundingBox()
    expect(box.y + box.height, `${code}: the bottom of today's visits, in a screen 844 px high`).toBeLessThanOrEqual(844)
    // "Switch person" and the committee's way in were under the visits, and a visit or two pushed them out of view (owner, 27/10/2026):
    // now the first is under the greeting and the second in the top bar, both above today's visits however many there are.
    for (const [what, control] of [
      ['"switch person"', page.getByRole('button', { name: words['home.switchWorker'] })],
      ["the committee's way in", page.getByRole('link', { name: words['footer.admin'] })],
    ]) {
      const at = await control.boundingBox()
      expect(at.y + at.height, `${code}: the bottom of ${what}, above today's visits`).toBeLessThanOrEqual(box.y)
    }
  }
})

test('scanning the same point again says it was already recorded', async ({ page }) => {
  await page.goto(scanLink(POINTS.lobby))
  await signIn(page, PEOPLE.ploni)
  await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()

  // The check-in's answer makes the app ask for today's visits again, a moment after the success screen is drawn: the next goto
  // waits for that request before it replaces the page (the `page` fixture, e2e/fixtures.js).
  await page.goto(scanLink(POINTS.lobby)) // still signed in on this phone
  await expect(page.getByRole('heading', { name: he['checkin.duplicate.title'] })).toBeVisible()
})

test('a point that is not assigned to the person is refused with its own message, in the person\'s language', async ({ page }) => {
  allowConsoleErrors(page, /status of 403/) // the browser notes the 403 this test provokes
  await page.goto(scanLink(POINTS.gym)) // the gym is Ploni's only
  // John reads English: he picks it himself on his phone (the committee does not set a language for anyone)
  await page.getByLabel(he['lang.label']).selectOption('en')
  await signIn(page, PEOPLE.john, en)
  await expect(page.getByText(en['error.not_assigned'])).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: en['checkin.retry'] })).toHaveCount(0) // trying again cannot help
})

test('a point that requires the location refuses a phone that is far away', async ({ page, context }) => {
  await context.setGeolocation(FAR)
  await page.goto(scanLink(POINTS.gym))
  await signIn(page, PEOPLE.ploni)
  await expect(page.getByRole('heading', { name: he['checkin.far.title'] })).toBeVisible()
  await expect(page.getByRole('button', { name: he['checkin.retry'] })).toBeVisible()
})

test('a code that is not ours is refused', async ({ page }) => {
  allowConsoleErrors(page, /status of 404/) // the browser notes the 404 this test provokes
  await page.goto(scanLink('BQR-doesnotexist000000000000'))
  await signIn(page, PEOPLE.ploni)
  await expect(page.getByText(he['error.unknown_code'])).toBeVisible()
})

test('a check-in made with no network is kept on the phone and sent when the network returns', async ({ page, context, browserName }) => {
  skipOfflineOnWebKit(browserName)
  allowConsoleErrors(page, OFFLINE_NOISE) // every request that fails while the network is off is logged by the browser
  // first an ordinary check-in, so the person stays signed in and the point is known to the phone
  await page.goto(scanLink(POINTS.basement))
  await signIn(page, PEOPLE.ploni)
  await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
  await page.getByRole('button', { name: he['checkin.done'] }).click()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // controlled by the service worker from here on, so the app can open offline

  await context.setOffline(true)
  await page.goto(scanLink(POINTS.basement))
  await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible()

  await context.setOffline(false)
  await page.getByRole('button', { name: he['checkin.done'] }).click()
  // sent by itself when the network returns (the "online" event, or the 30 second timer), with no "send now" click
  await expect(page.getByText(he['sync.done'])).toBeVisible({ timeout: 40_000 })
})

// ---- no fresh position ------------------------------------------------------------------------------------------------

/**
 * A phone that cannot get a position now: the browser answers "position unavailable" (code 2) to a single request and to a watch,
 * as in a basement. A point that requires the location watches the position for a few seconds before it gives up.
 */
const NO_POSITION_NOW = () => {
  navigator.geolocation.getCurrentPosition = (_done, fail) => fail({ code: 2 })
  navigator.geolocation.watchPosition = (_done, fail) => {
    fail({ code: 2 })
    return 1
  }
}
/** The server cannot be reached (it answers as if it were down), so a check-in is saved on the phone. */
const saveOnThePhone = (page) => page.route('**/api/scan', (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }))
const savedVisits = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('qr.queue.v1') ?? '[]'))

test.describe('with no position now', () => {
  // The server's answer is made up with page.route, which does not see a request that a service worker handles (WebKit does not
  // pass it on once the worker controls the page), so these tests run without the worker, as the other specs that stub the API do.
  test.use({ serviceWorkers: 'block' })

  test('with no fresh position, a check-in is saved with the position of the last one, and the screen does not warn', async ({ page }) => {
    allowConsoleErrors(page, /status of 503/) // the answer this test makes up
    await page.goto(scanLink(POINTS.gym)) // the gym requires the location
    await signIn(page, PEOPLE.ploni)
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('qr.lastfix.v1'))).not.toBeNull() // the reading of that check-in

    await page.addInitScript(NO_POSITION_NOW)
    await saveOnThePhone(page)
    await page.goto(scanLink(POINTS.gym))
    await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(he['checkin.queued.noLocation'])).toHaveCount(0)
    const [visit] = await savedVisits(page)
    expect(visit.gps, 'the visit carries where the phone was a moment ago').toMatchObject({ accuracy: expect.any(Number) })
    expect(visit.gps.age_s).toBeGreaterThanOrEqual(1)
    expect(visit.gps.age_s).toBeLessThan(120)
  })

  test('with no position at all, a check-in is saved and the screen warns that the server may refuse it', async ({ page }) => {
    allowConsoleErrors(page, /status of 503/)
    await page.addInitScript(NO_POSITION_NOW)
    await saveOnThePhone(page)
    await page.goto(scanLink(POINTS.gym))
    await signIn(page, PEOPLE.ploni)
    await expect(page.getByRole('heading', { name: he['checkin.queued.title'] })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(he['checkin.queued.body'])).toBeVisible()
    await expect(page.getByText(he['checkin.queued.noLocation'])).toBeVisible()
    const [visit] = await savedVisits(page)
    expect(visit.gps).toBeNull()
  })

  test('signing out deletes the position that the phone kept', async ({ page }) => {
    await page.goto(scanLink(POINTS.gym))
    await signIn(page, PEOPLE.ploni)
    await expect(page.getByRole('heading', { name: he['checkin.success.title'] })).toBeVisible()
    await page.getByRole('button', { name: he['checkin.done'] }).click()
    expect(await page.evaluate(() => localStorage.getItem('qr.lastfix.v1'))).not.toBeNull()

    await page.getByRole('button', { name: he['home.switchWorker'] }).click()
    await expect(page.getByRole('heading', { name: he['login.title'] })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('qr.lastfix.v1'))).toBeNull()
  })
})
