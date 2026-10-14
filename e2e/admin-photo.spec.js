// The committee member's Google photo (owner decision of 14/10/2026) in the two real browsers, on a phone and on a computer: it fills the
// account circle (the top bar's button on a phone, the rail's button on a computer, the head of the account menu) and the mark of the
// member's card in Settings, it is loaded under the Content-Security-Policy of production (vite preview sends it) with no referrer, and
// the initial comes back when the photo cannot load. The photo is a made-up picture answered by the test (`stubMemberPhoto` in
// e2e/fixtures.js): never a person, and nothing is asked of Google. The parts of the component are proved in
// tests/components/member-face.test.jsx, the server's side in tests/admin-photo.test.js, the look in e2e/visual.spec.js.
import {
  test, expect, adminSignIn, allowConsoleErrors, accountButton, openAccountMenu, expectNoA11yViolations, stubMemberPhoto, photoLoaded,
  MEMBER_PHOTO_URL, ADMIN_EMAIL,
} from './fixtures.js'

const COMPUTER = { width: 1280, height: 800 }
const PHONE = { width: 360, height: 740 }

// The test answers the photo itself (page.route), which a service worker would bypass.
test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
  allowConsoleErrors(page, /status of 401/)
})

const memberCard = (page) => page.getByRole('article').filter({ hasText: ADMIN_EMAIL })
const circleOfCard = (page) => memberCard(page).locator('.a-card__icon--round')

/** Checks one picture of the member: the photo's address, an empty alt, no referrer, filling its 44px circle, and loaded. */
async function expectPhoto(img, where) {
  await img.scrollIntoViewIfNeeded() // the cards load their photo when it comes into view (loading="lazy")
  await expect(img, where).toHaveAttribute('src', MEMBER_PHOTO_URL)
  await expect(img, where).toHaveAttribute('alt', '')
  await expect(img, where).toHaveAttribute('referrerpolicy', 'no-referrer')
  await expect.poll(() => photoLoaded(img), { message: `${where}: the photo has loaded` }).toBe(true)
  const box = await img.boundingBox()
  expect(Math.round(box.width), `${where}: the photo fills the circle`).toBe(44)
  expect(Math.round(box.height), `${where}: the photo fills the circle`).toBe(44)
  expect(await img.evaluate((el) => getComputedStyle(el).objectFit), where).toBe('cover')
}

test('the photo fills the account circle, the head of the account menu and the member\'s card, on a phone and on a computer', async ({ page }) => {
  const requests = await stubMemberPhoto(page)
  await adminSignIn(page, 'settings') // the answer of the sign-in carries the photo: it is drawn at once, with no reload
  for (const size of [PHONE, COMPUTER]) {
    await page.setViewportSize(size)
    const where = size === PHONE ? 'phone' : 'computer'
    const button = accountButton(page)
    await expectPhoto(button.locator('img'), `${where}: the account circle`)
    const box = await button.boundingBox()
    expect(box.width, `${where}: the button is still a target of 44 px or more`).toBeGreaterThanOrEqual(44)
    expect(box.height, `${where}: the button is still a target of 44 px or more`).toBeGreaterThanOrEqual(44)
    if (where === 'phone') await expect(button, 'the top bar\'s button has no initial beside the photo').toHaveText('')
    else await expect(button, 'the rail still names the member').toContainText('Dev Admin')
    await expectPhoto(circleOfCard(page).locator('img'), `${where}: the member's card`)
    await expect(circleOfCard(page).locator('img')).toHaveAttribute('loading', 'lazy')

    const menu = await openAccountMenu(page)
    await expectPhoto(menu.locator('img'), `${where}: the head of the menu`)
    await expect(menu).toContainText('Dev Admin')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
  // Every request for the photo went to Google's photo host with no referrer: the app's address is not sent along.
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) {
    expect(request.url()).toBe(MEMBER_PHOTO_URL)
    expect(await request.headerValue('referer')).toBeNull()
  }
})

test('the initial comes back when the photo cannot load, in the account circle, the menu and the card', async ({ page }) => {
  // The photo's address is refused (blocked, offline, an expired photo): Chromium notes each failed picture as a console error (WebKit
  // says nothing). Only that message, of a request that failed in the network.
  allowConsoleErrors(page, /^Failed to load resource: net::ERR_FAILED$/)
  const requests = await stubMemberPhoto(page, { blocked: true })
  await adminSignIn(page, 'settings')
  for (const size of [PHONE, COMPUTER]) {
    await page.setViewportSize(size)
    const where = size === PHONE ? 'phone' : 'computer'
    const circle = where === 'phone' ? accountButton(page) : accountButton(page).locator('.a-avatar')
    await expect(circle.locator('img'), `${where}: no broken picture in the account circle`).toHaveCount(0)
    await expect(circle, `${where}: the initial`).toHaveText('D')
    await expect(circleOfCard(page).locator('img'), `${where}: no broken picture on the card`).toHaveCount(0)
    await expect(circleOfCard(page), `${where}: the initial on the card`).toHaveText('D')
    const menu = await openAccountMenu(page)
    await expect(menu.locator('.a-avatar img')).toHaveCount(0)
    await expect(menu.locator('.a-avatar')).toHaveText('D')
    await page.keyboard.press('Escape')
  }
  expect(requests.length, 'the app did ask for the photo').toBeGreaterThan(0)
})

test('with a photo, the account button works by keyboard as before, and its ring shows around the photo', async ({ page }) => {
  await stubMemberPhoto(page)
  await adminSignIn(page, 'settings')
  await page.setViewportSize(PHONE)
  const button = accountButton(page)
  await expectPhoto(button.locator('img'), 'the account circle')
  await button.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('dialog', { name: 'החשבון שלי', exact: true })
  await expect(menu).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  // While the menu is open the photo draws 2px in from the edge, so that the ring of the open state, painted inside the circle, is seen.
  const open = await button.locator('img').boundingBox()
  expect(Math.round(open.width)).toBe(40)
  expect(await button.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect.poll(async () => Math.round((await button.locator('img').boundingBox()).width)).toBe(44)
  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
})

test('with a photo, the account circle, the menu and the members pass the accessibility scan, light and dark', async ({ page }) => {
  await stubMemberPhoto(page)
  await adminSignIn(page, 'settings')
  for (const size of [PHONE, COMPUTER]) {
    await page.setViewportSize(size)
    const where = size === PHONE ? 'phone' : 'computer'
    await expectPhoto(circleOfCard(page).locator('img'), `${where}: the member's card`)
    await openAccountMenu(page)
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      await expectNoA11yViolations(page, { context: `committee ${where}: settings and the account menu, with the member's photo [${scheme}]` })
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await page.keyboard.press('Escape')
  }
})
