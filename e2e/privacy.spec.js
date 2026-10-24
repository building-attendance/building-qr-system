// The privacy notice of the provider app (src/worker/PrivacyView.jsx, at /privacy): the sign-in screen gives the short notice and
// the way to the whole of it, before anyone signs in or scans; the notice names the committee and how to reach it from the
// building settings that the committee saved; it opens with no session, and from the home screen at any time; and going back from
// it keeps a scanned code. The building's name and address are the invented ones of the scratch schema (scripts/dev-seed.mjs).
import ar from '../src/i18n/ar.js'
import { test, expect, he, en, ru, POINTS, PEOPLE, BUILDING_ADDRESS, BUILDING_NAME, ADMIN_EMAIL, signIn } from './fixtures.js'

const CONTACT = 'ועד הבית, vaad@example.test'
const strip = (text) => text.replace(/[⁨⁩]/g, '') // translate() wraps every value in direction isolates
const noticeText = async (page) => strip(await page.getByRole('article').innerText())
// The phone never keeps the committee's contact (src/worker/buildingCache.js): the notice draws the fallback line first and the
// contact once the server's answer has come. A test that reads the contact waits for that answer.
const buildingAnswer = (page) => page.waitForResponse((r) => r.url().endsWith('/api/public/building') && r.ok())

/** Saves the committee's contact for privacy requests through the committee's own route, as the settings screen does. */
async function setContact(page, privacy_contact) {
  expect((await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })).ok(), 'dev admin sign-in').toBe(true)
  const saved = await page.request.put('/api/admin/building', { data: { address: BUILDING_ADDRESS, name: BUILDING_NAME, privacy_contact } })
  expect(saved.ok(), 'the contact is saved').toBe(true)
  await page.context().clearCookies() // the provider app is used signed out of the committee
}

test.afterEach(async ({ page }) => {
  await setContact(page, '') // the scratch schema has no contact, and the specs after this one expect none
})

test('the sign-in screen gives the short notice and the way to the whole of it, which names the committee and how to reach it', async ({ page }) => {
  await setContact(page, CONTACT)
  const scan = `/scan?code=${POINTS.lobby}`
  await page.goto(scan)
  await expect(page.getByRole('heading', { level: 1, name: he['login.title'] })).toBeVisible()
  await expect(page.getByText(he['login.privacy'])).toBeVisible()

  const answered = buildingAnswer(page)
  await page.getByRole('link', { name: he['privacy.open'] }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeFocused()
  await answered
  await expect(page.getByRole('article')).toContainText(CONTACT) // drawn from the answer, not from the phone
  const text = await noticeText(page)
  expect(text).toContain(`ועד הבית של ${BUILDING_NAME}, ${BUILDING_ADDRESS}, אחראי למידע`)
  expect(text).toContain(`לשאלות ולבקשות על המידע שלכם: ${CONTACT}.`)
  expect(text).toMatch(/עודכן: \d{2}\/\d{2}\/\d{4}/)
  await expect(page.getByRole('banner').getByText(BUILDING_NAME)).toBeVisible() // the header of the app, as on every screen

  // Back to the app: to the very address it came from, so the scanned code is still there for the sign-in
  await page.getByRole('link', { name: he['privacy.back'] }).click()
  await expect(page).toHaveURL(new RegExp(`/scan\\?code=${POINTS.lobby}$`))
  await expect(page.getByRole('heading', { level: 1, name: he['login.title'] })).toBeVisible()
})

test('opens with no session, straight from its address, and asks the committee members when no contact is set', async ({ page }) => {
  const answered = buildingAnswer(page)
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeVisible()
  await answered // the fallback stays after the answer too, since no contact is set
  const text = await noticeText(page)
  expect(text).toContain(he['privacy.who.noContact'])
  expect(text).toContain(he['privacy.rights.noContact'])
  expect(text).not.toMatch(/\{\w+\}/)
  // Opened directly, "back to the app" is a link to the app itself
  await page.getByRole('link', { name: he['privacy.back'] }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: he['login.title'] })).toBeVisible()
})

for (const [where, size] of [['on a phone', null], ['on a computer', { width: 1280, height: 800 }]]) {
  test(`fits the screen ${where}: no sideways scroll, and the notice stays in the column of the app`, async ({ page }) => {
    if (size) await page.setViewportSize(size)
    const contact = 'committee.of.the.building.with.one.long.word.for.its.contact@example.test'
    await setContact(page, contact)
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeVisible()
    await expect(page.getByRole('article')).toContainText(contact) // the long word is on the screen before anything is measured
    const width = page.viewportSize().width
    expect(await page.evaluate((w) => document.documentElement.scrollWidth <= w, width), 'no sideways scroll').toBe(true)
    const notice = await page.getByRole('article').boundingBox()
    const header = await page.getByRole('banner').boundingBox()
    expect(notice.x, 'the notice starts inside the screen').toBeGreaterThanOrEqual(0)
    expect(notice.x + notice.width, 'the notice ends inside the screen').toBeLessThanOrEqual(width)
    expect(Math.abs(notice.width - header.width), 'the notice is as wide as the header of the app, in the same column').toBeLessThanOrEqual(1)
  })
}

test('is on the home screen at any time after the sign-in, and the person stays signed in', async ({ page }) => {
  await page.goto('/')
  await signIn(page, PEOPLE.ploni)
  const greeting = page.getByRole('heading', { level: 1, name: new RegExp(PEOPLE.ploni.name) })
  await expect(greeting).toBeVisible()
  await page.getByRole('link', { name: he['privacy.title'] }).click()
  await expect(page.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeVisible()
  await page.getByRole('link', { name: he['privacy.back'] }).click()
  await expect(greeting).toBeVisible()
})

test('is in the language the person chose, in each of the four', async ({ page }) => {
  await page.goto('/')
  let shown = he // the language picker is labelled in the language that is shown now
  for (const [code, words] of [['en', en], ['ru', ru], ['ar', ar], ['he', he]]) {
    await page.getByLabel(shown['lang.label']).selectOption(code)
    shown = words
    await expect(page.locator('html')).toHaveAttribute('lang', code)
    await page.getByRole('link', { name: words['privacy.open'] }).click()
    await expect(page.getByRole('heading', { level: 1, name: words['privacy.title'] })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(7)
    await page.getByRole('link', { name: words['privacy.back'] }).click()
    await expect(page.getByRole('heading', { level: 1, name: words['login.title'] })).toBeVisible()
  }
})
