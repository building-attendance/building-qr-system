// The committee screens on a phone and on a computer: the same icons, nothing spilling off the screen, and deleting.
import { randomUUID } from 'node:crypto'
import {
  test, expect, he, PEOPLE, POINTS, FAR, SAMPLE_POINT, SCREEN_TITLES, SCREEN_NAV, BAR_SCREENS, adminSignIn, openScreen, clearScans, allowConsoleErrors,
  changeFilters, isPhoneLayout, openFilters, stubHome, HOME_DAYS, HOME_PROVIDERS, HOME_NOW, ADMIN_EMAIL, accountButton, openAccountMenu, signOut,
  moreButton, openTileMenu, chooseFromMenu, setDate, expectDate, hasDateWheels,
} from './fixtures.js'
import { SCAN_ERROR_POINT_INACTIVE, NAME_MAX_LENGTH, KEY_NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, SERVICE_TYPE_MAX_LENGTH } from '../shared/contract.js'
import { formatDateTime, formatDay } from '../shared/datetime.js'

const COMPUTER = { width: 1280, height: 800 }
// A tablet held upright: the filters are in a sheet (below 1024 px), and its dates take typing (from 640 px; below it, the wheels).
const TABLET = { width: 768, height: 1024 }
// Each screen and the heading of its page (every view renders its own h1 above its content), in the order of the side rail
const TABS = Object.entries(SCREEN_TITLES)

test.beforeEach(async ({ page, request }) => {
  // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
  allowConsoleErrors(page, /status of 401/)
  await clearScans(request)
})

// Compared with the width of the viewport that was set, not with window.innerWidth: Chromium's mobile emulation widens the layout
// viewport to the width of the content, so a page that scrolls sideways still has scrollWidth <= innerWidth there (e2e/reflow.spec.js).
const noHorizontalScroll = (page) => page.evaluate((width) => document.documentElement.scrollWidth <= width, page.viewportSize().width)

test('the point tiles show one "more" button that is named after the point, and keep every action in its menu, edit first', async ({ page }) => {
  await adminSignIn(page, 'points')
  const tile = page.getByRole('article').filter({ hasText: 'לובי' })
  const actions = tile.getByRole('button')
  await expect(actions).toHaveCount(1) // no edit pill beside it: edit is in the menu
  await expect(actions.nth(0)).toHaveAccessibleName('עוד פעולות ללובי')
  await expect(actions.nth(0)).toHaveText('') // the three dots
  // every action is in the menu, edit first and the red delete last; each is still named as it was
  const menu = await openTileMenu(tile)
  await expect(menu.getByRole('menuitem')).toHaveText(['עריכה', 'QR והדפסה', 'השבתת הנקודה', 'מחיקת הנקודה'])
  await page.keyboard.press('Escape')
  // adding a point is a pill that says so, in the heading (the test after this one measures it)
  await expect(page.getByRole('button', { name: 'נקודה חדשה' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'הדפסת כל השלטים' })).toBeVisible()
})

// ---- the heading of a screen that adds something -------------------------------------------------------------------------------
// Points, Providers, the members on the Settings screen and the keys of the Agent screen each have an add button in their heading. It is a
// pill that says what it adds (owner decision of 14/10/2026), not an icon: on a phone it used to be a solid violet circle right under the
// account circle, which was the same solid violet circle, and the two meant different things.

const ADD_BUTTONS = [['points', 'נקודה חדשה'], ['providers', 'נותן שירות חדש'], ['settings', 'מנהל מערכת חדש'], ['agent', 'מפתח חדש']]
// 360 is the phone of the committee's pictures, 320 the narrowest one that the app is checked at (the longest label, "נותן שירות חדש", and the print button of Points)
const HEADING_SIZES = [{ width: 360, height: 740 }, { width: 320, height: 640 }, COMPUTER]

/** The background that a token paints, as the browser resolves it (the colour of the solid primary, to compare with what a button wears). */
const paintOf = (page, token) => page.evaluate((name) => {
  const probe = document.createElement('i')
  probe.style.background = `var(${name})`
  document.querySelector('.a-app').append(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()
  return color
}, token)
const backgroundOf = (locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor)

test('the add button of a heading is a pill with its words, the first action of its heading, and not the same solid violet as the account circle', async ({ page }) => {
  await adminSignIn(page, 'points')
  // a list with nothing in it has no pill in its heading (its empty state has the button, see below): the Agent screen needs a key
  const key = (await (await page.request.post('/api/admin/api-keys', { data: { name: `מפתח ${randomUUID().slice(0, 6)}` } })).json()).api_key
  try {
    const primary = await paintOf(page, '--w-primary')
    const tint = await paintOf(page, '--w-tint-violet')
    for (const [screen, label] of ADD_BUTTONS) {
      await page.goto(`/admin#${screen}`)
      await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[screen], exact: true })).toBeVisible()
      for (const size of HEADING_SIZES) {
        await page.setViewportSize(size)
        const where = `${screen} at ${size.width}`
        const phone = size.width < 1024
        const pill = page.getByRole('button', { name: label, exact: true })
        const head = page.locator('.a-head', { has: pill })
        const text = head.locator(':scope > div').first()
        await expect(pill, `${where}: the words are on the button, not only in its name`).toHaveText(label)
        await expect(pill.locator('svg'), `${where}: the plus is still there`).toHaveCount(1)
        const box = await pill.boundingBox()
        const headBox = await head.boundingBox()
        const textBox = await text.boundingBox()
        expect(box.height, `${where}: the pill is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
        expect(box.x, `${where}: the pill is inside the screen`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, `${where}: the pill is inside the screen`).toBeLessThanOrEqual(size.width)
        expect(await noHorizontalScroll(page), `${where}: no sideways scroll`).toBe(true)
        // the same on a phone and on a computer: the title and the description, then the actions on a row of their own under them, at the start
        // (the right edge, in Hebrew), the title row being the title alone
        expect(box.y, `${where}: the pill is under the description`).toBeGreaterThanOrEqual(textBox.y + textBox.height - 1)
        expect(box.x + box.width, `${where}: the pill is at the start of the heading`).toBeGreaterThanOrEqual(headBox.x + headBox.width - 1)
        expect(textBox.x + textBox.width, `${where}: the text starts where the pill starts`).toBeGreaterThanOrEqual(headBox.x + headBox.width - 1)
        expect(await head.locator('h1, h2').boundingBox().then((h) => h.y + h.height), `${where}: nothing but the title is on the title row`).toBeLessThanOrEqual(box.y)
        // it is the one solid violet near the top of the screen: the account circle is the quiet tint, on a phone and on a computer
        expect(await backgroundOf(pill), `${where}: the pill is the primary colour`).toBe(primary)
        const circle = phone ? accountButton(page) : accountButton(page).locator('.a-avatar')
        expect(await backgroundOf(circle), `${where}: the account circle is not the solid primary`).not.toBe(primary)
        expect(await backgroundOf(circle), `${where}: the account circle is the violet tint`).toBe(tint)
        if (screen !== 'points') continue
        // the print button comes after the pill, in the page and on the screen (it is on its left, in Hebrew), and both fit at this width
        const print = page.getByRole('button', { name: 'הדפסת כל השלטים' })
        const after = await pill.evaluate((element, other) => !!(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING), await print.elementHandle())
        expect(after, `${where}: the pill is first in the page`).toBe(true)
        const printBox = await print.boundingBox()
        expect(printBox.x + printBox.width, `${where}: the print button is on the left of the pill`).toBeLessThanOrEqual(box.x + 1)
        expect(printBox.x, `${where}: the print button is inside the screen`).toBeGreaterThanOrEqual(0)
        expect(printBox.width, `${where}: the print button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
      }
    }
  } finally {
    await page.request.delete(`/api/admin/api-keys/${key.id}`, { data: {} })
  }
})

// A list with nothing in it shows its empty state, and the button of that state is the one next step (S1 of docs/design.md; owner decision of
// 15/10/2026): the heading has no add pill then (and on Points no print button, there is nothing to print), so that the same action is not offered
// twice. The three lists are answered empty here, and the layout is checked where the heading test above checks it.
const EMPTY_LISTS = [
  { screen: 'points', url: '**/api/admin/points', answer: { points: [] }, title: 'עוד אין נקודות', own: 'הוסיפו את הנקודה הראשונה', pill: 'נקודה חדשה' },
  { screen: 'providers', url: '**/api/admin/providers', answer: { providers: [] }, title: 'עוד אין נותני שירות', own: 'הוסיפו נותן שירות', pill: 'נותן שירות חדש' },
  {
    screen: 'agent', url: '**/api/admin/api-keys', answer: { api_keys: [], limits: { per_minute: 60, per_day: 2000 } },
    title: 'עוד אין מפתחות', own: 'יצירת מפתח', pill: 'מפתח חדש',
  },
]

test('an empty list offers to add its first item once: the empty state has the button and the heading has none, on a phone and on a computer', async ({ page }) => {
  for (const { url, answer } of EMPTY_LISTS) {
    await page.route(url, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: answer }) : route.continue()))
  }
  await adminSignIn(page, 'points')
  for (const { screen, title, own, pill } of EMPTY_LISTS) {
    // (the first screen is the one the sign-in opened: going to the address that the page is at would load it again, and once the service
    // worker controls the page the browser may ask for the lists without the test's answers)
    if (!page.url().endsWith(`#${screen}`)) await page.goto(`/admin#${screen}`)
    await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[screen], exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: title }), `${screen}: the empty state`).toBeVisible()
    for (const size of HEADING_SIZES) {
      await page.setViewportSize(size)
      const where = `${screen} at ${size.width}`
      const first = page.getByRole('main').getByRole('button', { name: own, exact: true })
      await expect(page.locator('.a-head').getByRole('button'), `${where}: the heading holds only its title`).toHaveCount(0)
      await expect(page.getByRole('button', { name: pill, exact: true }), `${where}: no add pill`).toHaveCount(0)
      if (screen === 'points') await expect(page.getByRole('button', { name: 'הדפסת כל השלטים' }), `${where}: nothing to print`).toHaveCount(0)
      // the buttons of the screen: the one of the empty state (the agent's screen also has the button that copies the prompt, further down)
      await expect(page.getByRole('main').getByRole('button'), `${where}: one button for the first item`).toHaveCount(screen === 'agent' ? 2 : 1)
      await expect(first, `${where}: the words are on the button`).toHaveText(own)
      const box = await first.boundingBox()
      expect(box.height, `${where}: the button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
      expect(box.x, `${where}: the button is inside the screen`).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, `${where}: the button is inside the screen`).toBeLessThanOrEqual(size.width)
      expect(await noHorizontalScroll(page), `${where}: no sideways scroll`).toBe(true)
    }
  }
})

test('on a phone the focus goes from the account circle to the add button, and then on to the other actions of the heading', async ({ page }) => {
  await adminSignIn(page, 'points')
  await page.setViewportSize({ width: 360, height: 740 })
  // the print button is switched off until the points are loaded, and Tab skips a switched-off button: wait for it, or the test races the load
  await expect(page.getByRole('button', { name: 'הדפסת כל השלטים' })).toBeEnabled()
  await accountButton(page).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'נקודה חדשה', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'הדפסת כל השלטים' })).toBeFocused()
})

// ---- the account menu ---------------------------------------------------------------------------------------------------------
// The three icons of the old top bar (the provider app, light / dark, sign-out) are one account button: the member's initial in the top
// bar of a phone, the name and the e-mail at the foot of the side rail on a computer. It opens a popover (a dialog that is not modal, see
// src/admin/AccountMenu.jsx). The unit test (tests/components/AccountMenu.test.jsx) proves the parts; these prove them in the two real
// browsers, with the real layout.

test('the account button opens the same menu on a phone and on a computer: the member, the mode, the provider app and the sign-out', async ({ page }) => {
  await adminSignIn(page)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    const button = accountButton(page)
    await expect(button, `${where}: closed to begin with`).toHaveAttribute('aria-expanded', 'false')
    const box = await button.boundingBox()
    expect(box.width, `${where}: the button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
    expect(box.height, `${where}: the button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
    // the three icons are gone from the screen: what they did is behind the one button
    await expect(page.getByRole('link', { name: 'אפליקציית נותני השירות' }), `${where}: no link before the menu opens`).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: he['theme.label'] }), `${where}: no light / dark picker before the menu opens`).toHaveCount(0)

    const menu = await openAccountMenu(page)
    await expect(button, `${where}: open`).toHaveAttribute('aria-expanded', 'true')
    await expect(menu, `${where}: it is not modal`).not.toHaveAttribute('aria-modal', /.*/)
    await expect(menu).toContainText('Dev Admin') // the sample member
    await expect(menu).toContainText(ADMIN_EMAIL)
    await expect(menu.getByRole('group', { name: he['theme.label'] }).getByRole('radio')).toHaveCount(3)
    for (const name of [he['theme.light'], he['theme.dark'], he['theme.system']]) await expect(menu.getByRole('radio', { name })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'אפליקציית נותני השירות' })).toHaveAttribute('href', '/')
    await expect(menu.getByRole('button', { name: 'יציאה', exact: true })).toBeVisible()

    // the menu is inside the screen, and it does not cover its own button
    const view = page.viewportSize()
    const pop = await menu.boundingBox()
    expect(pop.x, `${where}: inside the screen`).toBeGreaterThanOrEqual(0)
    expect(pop.x + pop.width, `${where}: inside the screen`).toBeLessThanOrEqual(view.width)
    expect(pop.y, `${where}: inside the screen`).toBeGreaterThanOrEqual(0)
    expect(pop.y + pop.height, `${where}: inside the screen`).toBeLessThanOrEqual(view.height)
    const overlaps = pop.x < box.x + box.width && box.x < pop.x + pop.width && pop.y < box.y + box.height && box.y < pop.y + pop.height
    expect(overlaps, `${where}: the menu stands beside its button, not over it`).toBe(false)
    expect(await noHorizontalScroll(page), `${where}: the open menu does not make the page scroll sideways`).toBe(true)

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button, `${where}: Esc gives the focus back`).toBeFocused()
  }
})

test('the account menu by keyboard: Enter opens it on the chosen mode, the arrows choose, Tab goes on and out and closes it, Esc closes it', async ({ page }) => {
  await adminSignIn(page)
  const button = accountButton(page)
  const menu = page.getByRole('dialog', { name: 'החשבון שלי', exact: true })
  const html = page.locator('html')
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('radio', { name: he['theme.system'] }), 'the focus is on the mode that is chosen').toBeFocused()
  // the arrows of the radio group choose a mode, and the page follows at once (the order is light, dark, like the device; up goes back one: only
  // Chromium wraps at the end of the group, WebKit stops there, so the test goes the way that both go)
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('radio', { name: he['theme.dark'] })).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('radio', { name: he['theme.light'] })).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(menu, 'choosing a mode does not close the menu').toBeVisible()
  // Tab goes on through what is in the menu and out of it, and that closes it (at most the link, the sign-out, and the next control)
  for (let i = 0; i < 4 && (await menu.count()) > 0; i++) await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  // Esc, from a control inside the menu, closes it and the focus goes back to the button
  await button.focus()
  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  // the sign-out is reachable by keyboard: Enter on it signs out
  await page.keyboard.press('Enter')
  await menu.getByRole('button', { name: 'יציאה', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'ניהול נוכחות הבניין' })).toBeVisible()
})

test('a tap outside the account menu closes it, and so does choosing the button again', async ({ page }) => {
  await adminSignIn(page)
  const menu = await openAccountMenu(page)
  await page.mouse.click(page.viewportSize().width / 2, page.viewportSize().height - 2) // the page, outside the menu
  await expect(menu).toHaveCount(0)
  await accountButton(page).click()
  await expect(menu).toBeVisible()
  await accountButton(page).click()
  await expect(menu).toHaveCount(0)
})

test('the mode chosen in the account menu applies at once, survives a reload, and is what the menu shows next time', async ({ page }) => {
  await adminSignIn(page)
  const html = page.locator('html')
  const menu = await openAccountMenu(page)
  const radio = (name) => menu.getByRole('radio', { name })
  await radio(he['theme.dark']).check()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => window.localStorage.getItem('qr.theme'))).toBe('dark')
  await radio(he['theme.light']).check()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await radio(he['theme.dark']).check()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES.history })).toBeVisible()
  await expect(html, 'a reload keeps the mode').toHaveAttribute('data-theme', 'dark')
  await openAccountMenu(page)
  await expect(radio(he['theme.dark'])).toBeChecked()
  await radio(he['theme.system']).check() // back to following the device, as every test starts
  expect(await page.evaluate(() => window.localStorage.getItem('qr.theme'))).toBe('system')
})

test('signing out from the account menu ends the session: the sign-in screen is there, and a reload does not bring the member back', async ({ page }) => {
  await adminSignIn(page)
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1, name: 'ניהול נוכחות הבניין' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'ניהול נוכחות הבניין' })).toBeVisible()
})

// 1024 is the narrowest computer: the side rail (280 px) leaves the page the least room there.
test('every committee screen fits the width, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  for (const size of [null, { width: 1024, height: 800 }, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    for (const [tab, title] of TABS) {
      await page.goto(`/admin#${tab}`)
      // measure the tab itself once its list has arrived, not the previous tab or a loading screen
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
      expect(await noHorizontalScroll(page), `${tab} at ${size ? size.width : 'phone'} px width`).toBe(true)
    }
  }
})

// The tab bar of the phone floats and has five buttons: home, history, points, providers and "עוד" (more), which opens the sheet with the
// other four screens. Each is an icon, and the current one is a pill that also says its name (the other four keep theirs for a screen
// reader). On the narrowest phones that are still in use (360 px, and 320 px for the reflow rule) the longest name, "היסטוריה", has to fit
// beside four buttons of 44 px or more: below 360 px the pill drops its icon to make the room. The button says "ספקים", `nav` in TABS,
// src/pages/AdminApp.jsx, while the top bar, the heading and the title keep the long name. The two E2E devices are 412 and 390 px wide, so
// nothing else measures these two.
test('the tab bar of the phone fits 320 and 360 px screens: five buttons inside the bar, the current one names itself whole on one line, none under 44 px', async ({ page }) => {
  await adminSignIn(page)
  const labels = [...BAR_SCREENS.map((key) => SCREEN_NAV[key]), 'עוד'] // the buttons, in the order of the page (the first is at the right: the page runs right to left)
  const screens = ['home', 'history', 'points', 'providers', 'settings'] // the screen that makes each of them the current one ("עוד" is current on a screen under it)
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 740 })
    for (const [current, screen] of screens.entries()) {
      await page.goto(`/admin#${screen}`)
      await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[screen], exact: true })).toBeVisible()
      const where = `${width} px, "${labels[current]}" is the current button`
      const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
      const buttons = bar.getByRole('button')
      await expect(buttons, where).toHaveCount(labels.length)
      const barBox = await bar.boundingBox()
      expect(barBox.x, `${where}: the bar is inside the screen`).toBeGreaterThanOrEqual(0)
      expect(barBox.x + barBox.width, `${where}: the bar is inside the screen`).toBeLessThanOrEqual(width)
      const heights = []
      const xs = []
      for (const [index, label] of labels.entries()) {
        const button = buttons.nth(index)
        await expect(button, `${where}: button ${index + 1} has the name ${label}`).toHaveAccessibleName(label)
        const box = await button.boundingBox()
        expect(box.width, `${where}: ${label} is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
        expect(box.height, `${where}: ${label} is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
        expect(box.x, `${where}: ${label} is inside the bar`).toBeGreaterThanOrEqual(barBox.x)
        expect(box.x + box.width, `${where}: ${label} is inside the bar`).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5)
        heights.push(box.height)
        xs.push(box.x)
        const { lines, scrollWidth, clientWidth, drawn } = await button.getByText(label, { exact: true }).evaluate((span) => {
          const range = document.createRange()
          range.selectNodeContents(span)
          return { lines: range.getClientRects().length, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth, drawn: span.getBoundingClientRect().width > 2 }
        })
        if (index === current) {
          expect(drawn, `${where}: ${label} says its name`).toBe(true)
          expect(scrollWidth, `${where}: ${label} is not cut (its text is wider than its box)`).toBeLessThanOrEqual(clientWidth)
          expect(lines, `${where}: ${label} is on one line`).toBe(1)
          await expect(button, `${where}: ${label} is the current button`).toHaveAttribute('aria-current', 'page')
        } else {
          expect(drawn, `${where}: ${label} is only an icon (its name is for a screen reader)`).toBe(false)
          await expect(button, `${where}: ${label} is not the current button`).not.toHaveAttribute('aria-current', 'page')
        }
      }
      expect(Math.max(...heights) - Math.min(...heights), `${where}: the heights of the five buttons: ${heights.join(', ')}`).toBeLessThan(0.5)
      expect(xs, `${where}: the first button is at the start of the bar (the right, in right-to-left), "עוד" at the end`).toEqual([...xs].sort((p, q) => q - p))
      expect(await noHorizontalScroll(page), `${where}: the page does not scroll sideways`).toBe(true)
    }
  }
})

// The bar floats over the page: a pill that stands clear of the bottom edge and of both sides, and the end of every page stands above it.
test('the tab bar of the phone floats clear of the screen edges, and the page ends above it', async ({ page }) => {
  await adminSignIn(page, 'settings') // a long page
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0) // whole: the page grows while its lists load, and the end moves with it
  await expect(page.getByLabel('שם הבניין', { exact: true })).toBeVisible()
  const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
  const view = page.viewportSize()
  const box = await bar.boundingBox()
  expect(box.x, 'clear of the left edge').toBeGreaterThanOrEqual(8)
  expect(view.width - (box.x + box.width), 'clear of the right edge').toBeGreaterThanOrEqual(8)
  expect(view.height - (box.y + box.height), 'clear of the bottom edge (and of the home indicator, which the inset adds)').toBeGreaterThanOrEqual(8)
  expect(await bar.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius)), 'a pill: the corners are at least half its height').toBeGreaterThanOrEqual(box.height / 2)
  expect(await bar.evaluate((el) => getComputedStyle(el).position), 'it stays while the page scrolls').toBe('fixed')
  // the page's own end clears the bar: the room under the last thing of the page is more than the bar and the gap under it take
  const room = await page.getByRole('main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
  expect(room, 'the room under the last thing of the page (--w-layout-tabbar-clearance)').toBeGreaterThanOrEqual(view.height - box.y + 8)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(async () => {
    const last = await page.getByRole('main').evaluate((el) => el.lastElementChild.getBoundingClientRect().bottom)
    return last <= (await bar.boundingBox()).y
  }, { message: 'at the end of the page, its last thing is above the bar' }).toBe(true)
})

// The page fades out behind the bar (D10 of the redesign, owner decision of 14/10/2026). The bar floats, so the page showed under it and around its
// sides. `.a-tabbar-fade` (src/admin/admin.css) is a layer that the shell renders next to the bar: it turns the bottom of the screen into the page
// colour, takes no taps and stays under every overlay. The end of every page stands wholly above its top edge (--w-layout-tabbar-clearance in
// src/ui/base.css), so that the last card is never half-faded. Measured at 360 and 320 px (the narrowest phones in use), at the very end of the
// screens that are long enough to scroll, among them the History with a few visits.
test('the page fades out behind the tab bar of the phone, the end of every page stands above the fade, and a tap on its hidden part reaches nothing', async ({ page, playwright, browserName }) => {
  const fade = page.locator('.a-tabbar-fade')
  const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
  const zIndexOf = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).zIndex))
  const FADE_REACH = 36 // how far above the top of the bar the page starts to fade (the prototype that the owner chose)

  // the fade is part of the bar: the sign-in screen has neither
  await page.goto('/admin')
  await expect(page.getByRole('button', { name: 'כניסת פיתוח' })).toBeVisible()
  await expect(fade, 'the sign-in screen has no fade').toHaveCount(0)

  const tag = randomUUID().slice(0, 6)
  await adminSignIn(page, 'settings') // not the History: the app keeps the list it loaded, and the visits below do not exist yet
  // six visits of Ploni today, at six throwaway points (a second visit at the same point would be in the cooldown), so that the History is long
  const points = []
  for (let n = 1; n <= 6; n++) {
    const created = await page.request.post('/api/admin/points', { data: { name: `נקודת דהייה ${n} ${tag}`, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })
    points.push((await created.json()).point)
  }
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    for (const point of points) {
      const scan = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: point.qr_token, gps: null } })
      expect((await scan.json()).scan.outcome).toBe('accepted')
    }

    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 640 })
      for (const screen of ['history', 'providers', 'settings', 'help']) {
        const where = `${width} px, ${screen}`
        await page.goto(`/admin#${screen}`)
        await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[screen], exact: true })).toBeVisible()
        await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0) // whole: the page grows while its lists load, and the end moves with it
        if (screen === 'history') await expect(historyRows(page), `${where}: the visits are drawn`).not.toHaveCount(0)

        // the layer: fixed to the bottom of the screen and across it, under the bar and above the top row, and it takes no taps
        const { position, pointerEvents, z, box } = await fade.evaluate((el) => {
          const style = getComputedStyle(el)
          const { top, bottom, left, right } = el.getBoundingClientRect()
          return { position: style.position, pointerEvents: style.pointerEvents, z: Number(style.zIndex), box: { top, bottom, left, right } }
        })
        const barBox = await bar.boundingBox()
        expect(position, `${where}: the fade stays while the page scrolls`).toBe('fixed')
        expect(pointerEvents, `${where}: the fade takes no taps`).toBe('none')
        expect(z, `${where}: the fade is under the bar`).toBeLessThan(await zIndexOf(bar))
        expect(z, `${where}: the fade is over the page, its top row included`).toBeGreaterThan(await zIndexOf(page.getByRole('banner')))
        expect(box.bottom, `${where}: it reaches the bottom edge`).toBe(640)
        expect([box.left, box.right], `${where}: and both sides`).toEqual([0, width])
        // the constant (--w-layout-tabbar-fade-height) counts the bar's own height, so it is checked against the bar: the fade starts 36 px above its top
        expect(barBox.y - box.top, `${where}: the fade starts ${FADE_REACH} px above the top of the bar`).toBeCloseTo(FADE_REACH, 0)
        const underFade = await page.evaluate((y) => document.elementFromPoint(2, y)?.closest('.a-tabbar-fade') ?? null, box.top + FADE_REACH / 2)
        expect(underFade, `${where}: a tap on the fade reaches what is under it`).toBeNull()

        // the end of the page: the last thing of the screen stands wholly above the top edge of the fade
        const room = await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight)
          return { scrolls: document.documentElement.scrollHeight - window.innerHeight }
        })
        expect(room.scrolls, `${where}: the screen is long enough to scroll`).toBeGreaterThan(0)
        await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight), { message: `${where}: scrolled to the very end` }).toBe(true)
        await expect.poll(async () => {
          const last = await page.getByRole('main').evaluate((el) => el.lastElementChild.getBoundingClientRect().bottom)
          return Math.round(((await fade.boundingBox()).y - last) * 10) / 10
        }, { message: `${where}: at the end of the page, the room between its last thing and the top of the fade (px, never under 0)` }).toBeGreaterThanOrEqual(0)
      }
    }

    // Taps and scrolling over the part of the fade where the page is hidden (under its first --w-space-10). A tap there must not reach a control that cannot be
    // seen (the "more actions" button of a History row, here), and a wheel or a drag there must still scroll the page. 768 px is the width where the bar (480 px at
    // most) leaves a strip on both sides of it; at 360 px the bar leaves only 12 px at the sides and 10 px under it, and no control reaches the sides, so the
    // tap is in the gap under the bar. The bar's own taps are not affected: it stands over the fade.
    for (const width of [768, 360]) {
      const where = `${width} px`
      await page.setViewportSize({ width, height: 640 })
      await page.goto('/admin#history')
      await expect(historyRows(page), `${where}: the visits are drawn`).not.toHaveCount(0)
      const barBox = await bar.boundingBox()
      const tapY = width === 768 ? 640 - 30 : 640 - 5
      // scroll the page so that the "more actions" button of a row stands at the point to tap, and say where that is
      const target = await page.evaluate((y) => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        for (const button of document.querySelectorAll('main li button')) {
          const rect = button.getBoundingClientRect()
          const to = window.scrollY + rect.top + rect.height / 2 - y
          if (to < 0 || to > max) continue
          window.scrollTo(0, to)
          const now = button.getBoundingClientRect()
          return { x: now.left + now.width / 2, y, name: button.getAttribute('aria-label') ?? '' }
        }
        return null
      }, tapY)
      expect(target, `${where}: a button of a row can be scrolled to the point under the fade`).not.toBeNull()
      const onBar = target.x >= barBox.x && target.x <= barBox.x + barBox.width && target.y >= barBox.y && target.y <= barBox.y + barBox.height
      expect(onBar, `${where}: the point is beside or under the bar, not on it`).toBe(false)
      if (width === 768) expect(target.x < barBox.x || target.x > barBox.x + barBox.width, `${where}: the point is in a strip beside the bar`).toBe(true)

      const expectNothingHappened = async (how) => {
        await expect(page.getByRole('menu'), `${where}: a ${how} on the hidden part of the fade opens no menu`).toHaveCount(0)
        await expect(page.getByRole('dialog'), `${where}: and no dialog`).toHaveCount(0)
        expect(new URL(page.url()).hash, `${where}: and goes nowhere`).toBe('#history')
      }
      await page.mouse.click(target.x, target.y)
      await expectNothingHappened('click')
      // A finger as well, where it is not WebKit's own doing that it lands elsewhere: iOS WebKit moves a touch that lands within a few px of a button to that
      // button, so a touch in the 10 px gap under the bar (360 px) is taken by the bar's nearest button. At 768 px the point is far from the bar.
      if (width === 768 || browserName === 'chromium') {
        await page.touchscreen.tap(target.x, target.y)
        await expectNothingHappened('tap')
      }
      // what is at that point is the fade, and in the gradient above it (the page still shows) it is not
      const hits = await page.evaluate(([x, y, top]) => ({
        hidden: Boolean(document.elementFromPoint(x, y)?.closest('.a-tabbar-fade')),
        gradient: Boolean(document.elementFromPoint(x, top + 10)?.closest('.a-tabbar-fade')),
      }), [target.x, target.y, (await fade.boundingBox()).y])
      expect(hits.hidden, `${where}: the fade is what a tap at that point meets`).toBe(true)
      expect(hits.gradient, `${where}: in its gradient a tap still reaches the page`).toBe(false)
      // the same button, in plain sight, does open its menu: the tap above was a real one
      await page.evaluate((name) => {
        for (const button of document.querySelectorAll('main li button')) {
          if (button.getAttribute('aria-label') === name) button.scrollIntoView({ block: 'center', behavior: 'instant' })
        }
      }, target.name)
      const button = page.getByRole('button', { name: target.name, exact: true })
      const seen = await button.boundingBox()
      await page.touchscreen.tap(seen.x + seen.width / 2, seen.y + seen.height / 2)
      await expect(page.getByRole('menu'), `${where}: the button opens its menu when it is in plain sight`).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // A wheel over the hidden part still scrolls the page, and so does a touch drag. Playwright's mobile WebKit can send neither ("Mouse wheel is not supported
      // in mobile WebKit", and its touchscreen only taps), so there the proof is that nothing on the layer stops the page's pan from chaining through it: the fade
      // and its ::after are no scroller and set no touch-action. Chromium sends both for real.
      for (const pseudo of [null, '::after']) {
        const style = await fade.evaluate((el, p) => { const s = getComputedStyle(el, p); return { touchAction: s.touchAction, overflow: s.overflow } }, pseudo)
        expect(style, `${where}: the fade${pseudo ?? ''} is no scroller and sets no touch-action`).toEqual({ touchAction: 'auto', overflow: 'visible' })
      }
      if (browserName === 'chromium') {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.mouse.move(target.x, tapY)
        await page.mouse.wheel(0, 120)
        await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${where}: a wheel over the fade scrolls the page` }).toBeGreaterThan(0)
        await page.evaluate(() => window.scrollTo(0, 0))
        const cdp = await page.context().newCDPSession(page)
        // a finger down on the fade and up the screen in ten steps (Input.synthesizeScrollGesture does nothing under this emulation, even off the fade)
        const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: target.x, y }] })
        await touch('touchStart', tapY)
        for (let step = 1; step <= 10; step++) {
          await touch('touchMove', tapY - step * 20)
          await page.waitForTimeout(16)
        }
        await page.waitForTimeout(200) // the finger rests before it lifts, so that there is no fling: a tap during a fling only stops it
        await touch('touchEnd', tapY - 200)
        await expect.poll(() => page.evaluate(() => window.scrollY), { message: `${where}: a drag that starts on the fade scrolls the page` }).toBeGreaterThan(0)
        await cdp.detach()
      }

      let lastY = -1
      await expect.poll(async () => {
        const y = await page.evaluate(() => window.scrollY)
        const still = y === lastY
        lastY = y
        return still
      }, { message: `${where}: the page stands still` }).toBe(true)
      // the bar's own taps: a touch on the Points button opens the Points screen
      const pointsButton = await bar.getByRole('button', { name: SCREEN_NAV.points, exact: true }).boundingBox()
      await page.touchscreen.tap(pointsButton.x + pointsButton.width / 2, pointsButton.y + pointsButton.height / 2)
      await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES.points, exact: true }), `${where}: the bar still takes its taps`).toBeVisible()
    }

    // above the fade, whatever opens over the page: the sheet under "עוד" (every dialog and sheet is the same overlay), the account menu, the toasts
    await page.setViewportSize({ width: 360, height: 640 })
    const fadeBox = await fade.boundingBox()
    await bar.getByRole('button', { name: 'עוד', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'עוד', exact: true })).toBeVisible()
    const overlay = await page.evaluate((y) => Boolean(document.elementFromPoint(2, y)?.closest('.a-overlay')), fadeBox.y + 10)
    expect(overlay, 'the sheet under "עוד" is over the fade').toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const fadeZ = await zIndexOf(fade)
    await openAccountMenu(page)
    expect(await zIndexOf(page.getByRole('dialog', { name: 'החשבון שלי' })), 'the account menu is over the fade').toBeGreaterThan(fadeZ)
    await page.keyboard.press('Escape')
    expect(await zIndexOf(page.locator('.a-toasts')), 'the toasts are over the fade').toBeGreaterThan(fadeZ)

    // a computer has the side rail instead of the bar, and no fade
    await page.setViewportSize(COMPUTER)
    await expect(bar).toBeHidden()
    await expect(fade, 'a computer has no fade').toBeHidden()
  } finally {
    await phone.dispose()
    for (const point of points) await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
  }
})

// The side rail of a computer has all eight screens in two groups, the work screens and the management screens, with a line between
// them. Every name is whole, on one line. The help is called "עזרה" on its button: its whole name, "איך עובדים עם המערכת", measured 168 px
// against the 157 px that the name of a button has in a rail 248 px wide (the sheet under "עוד" has room for the whole name).
test('the side rail has the eight screens in two groups with a separator, Home first, each name whole on one line', async ({ page }) => {
  await page.setViewportSize(COMPUTER)
  await adminSignIn(page)
  const rail = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true })
  const names = Object.values(SCREEN_NAV)
  await expect(rail.getByRole('button')).toHaveText(names)
  await expect(rail.getByRole('separator')).toHaveCount(1)
  expect(names[0], 'Home is the first').toBe('בית')
  // the separator is between the fourth button and the fifth, and visible (a line, not an empty gap)
  const [fourth, fifth, separator] = await Promise.all([
    rail.getByRole('button').nth(3).boundingBox(), rail.getByRole('button').nth(4).boundingBox(), rail.getByRole('separator').boundingBox(),
  ])
  expect(separator.y, 'the separator is under the fourth button').toBeGreaterThanOrEqual(fourth.y + fourth.height - 0.5)
  expect(separator.y + separator.height, 'and above the fifth').toBeLessThanOrEqual(fifth.y + 0.5)
  expect(await rail.getByRole('separator').evaluate((hr) => getComputedStyle(hr).borderBlockStartWidth), 'the separator draws a line').toBe('1px')
  for (const [index, name] of names.entries()) {
    const button = rail.getByRole('button').nth(index)
    const { lines, scrollWidth, clientWidth } = await button.getByText(name, { exact: true }).evaluate((span) => {
      const range = document.createRange()
      range.selectNodeContents(span)
      return { lines: range.getClientRects().length, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth }
    })
    expect(scrollWidth, `${name} is not cut`).toBeLessThanOrEqual(clientWidth)
    expect(lines, `${name} is on one line`).toBe(1)
    expect((await button.boundingBox()).height, `${name}: a target of 44 px or more`).toBeGreaterThanOrEqual(44)
  }
  // the two groups look alike (owner decision of 14/10/2026): every item that is not the current one, in either group, has the same size,
  // weight and colour, and so does its icon; the separator is the only difference between the groups
  const look = (button) => button.evaluate((el) => {
    const cs = getComputedStyle(el)
    const icon = el.querySelector('svg').getBoundingClientRect()
    return { height: el.getBoundingClientRect().height, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, icon: `${icon.width}x${icon.height}` }
  })
  const looks = await Promise.all(Object.entries(SCREEN_NAV).filter(([key]) => key !== 'history').map(async ([key, name]) => [key, await look(rail.getByRole('button', { name, exact: true }))]))
  for (const [key, got] of looks) expect(got, `the rail item "${key}" looks like the first one`).toEqual(looks[0][1])
  expect(looks[0][1].fontWeight, 'in the medium weight').toBe('500')
  // the rail floats: a white card 280 px wide with rounded corners, clear of the screen edges; the current screen is the violet pill
  const side = await page.getByRole('complementary').boundingBox()
  expect(side.width, 'the rail is 280 px wide').toBe(280)
  expect(side.x, 'it floats clear of the edge of the screen').toBeGreaterThanOrEqual(8)
  expect(side.y, 'and of the top').toBeGreaterThanOrEqual(8)
  expect(await page.getByRole('complementary').evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius)), 'with rounded corners').toBeGreaterThanOrEqual(24)
  await expect(rail.getByRole('button', { name: SCREEN_NAV.history, exact: true })).toHaveAttribute('aria-current', 'page')
  const pill = await rail.getByRole('button', { name: SCREEN_NAV.history, exact: true }).evaluate((el) => ({ fill: getComputedStyle(el).backgroundColor, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), height: el.getBoundingClientRect().height }))
  expect(pill.fill, 'the current screen is filled').not.toBe('rgba(0, 0, 0, 0)')
  expect(pill.radius, 'and it is a pill').toBeGreaterThanOrEqual(pill.height / 2)
  expect(await rail.getByRole('button', { name: SCREEN_NAV.points, exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor), 'another one is not').toBe('rgba(0, 0, 0, 0)')
  // the account button is at the foot of the rail, with the member's name and e-mail
  const account = await accountButton(page).boundingBox()
  expect(account.y + account.height, 'the account button is at the foot of the rail').toBeGreaterThan(side.y + side.height - 40)
  await expect(accountButton(page)).toContainText('Dev Admin')
  await expect(accountButton(page)).toContainText(ADMIN_EMAIL)
  // the e-mail is one line: an address of the usual length is whole, and a longer one ends in an ellipsis with its start in view (the page
  // is told the address, as the sign-in tells it: the text of the line is replaced here, and the menu below still holds the real one)
  const mail = accountButton(page).locator('.a-who__mail')
  const oneLine = (text) => mail.evaluate((el, value) => {
    el.textContent = value
    const range = document.createRange()
    range.selectNodeContents(el)
    return { lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, cut: el.scrollWidth > el.clientWidth, direction: getComputedStyle(el).direction, overflow: getComputedStyle(el).textOverflow }
  }, text)
  expect(await oneLine('person1988b@gmail.com'), 'a usual address is whole, on one line').toMatchObject({ lines: 1, cut: false, direction: 'ltr', overflow: 'ellipsis' })
  expect(await oneLine(`a-much-longer-mailbox-name-than-usual-${'x'.repeat(30)}@example.test`), 'a longer address is on one line, cut with an ellipsis').toMatchObject({ lines: 1, cut: true })
  await expect(mail, 'the whole address is its title').toHaveAttribute('title', ADMIN_EMAIL)
  const mailBox = await mail.boundingBox()
  const accountBox = await accountButton(page).boundingBox()
  expect(mailBox.x, 'the line stays inside the button').toBeGreaterThanOrEqual(accountBox.x)
  expect(mailBox.x + mailBox.width, 'the line stays inside the button').toBeLessThanOrEqual(accountBox.x + accountBox.width)
  await oneLine(ADMIN_EMAIL) // put the real address back
  // the whole rail is on the screen, also on a short one (it scrolls when it must; the account button is reachable)
  await page.setViewportSize({ width: 1280, height: 560 })
  await expect(rail.getByRole('button').last()).toBeVisible()
  await expect(accountButton(page)).toBeVisible()
  await openAccountMenu(page)
  await expect(page.getByRole('dialog', { name: 'החשבון שלי', exact: true }).getByRole('button', { name: 'יציאה', exact: true })).toBeVisible()
})

// Every screen can be reached from the navigation that is on the screen, by the name on its button (the tab bar and the sheet under "עוד"
// on a phone, the side rail on a computer), and Back goes to the screen before, with nothing left open.
test('every screen opens from the navigation by the name of its button, and Back returns to the screen before, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page, 'home')
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    for (const [key, title] of TABS) {
      await openScreen(page, key)
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true }), `${where}: ${key} opens`).toBeVisible()
      await expect(page.getByRole('dialog'), `${where}: nothing is left open after ${key}`).toHaveCount(0)
    }
    const trail = ['history', 'points', 'providers', 'settings', 'audit']
    for (const key of trail) {
      await openScreen(page, key)
      await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[key], exact: true })).toBeVisible()
    }
    for (const key of trail.slice(0, -1).reverse()) {
      await page.goBack()
      await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[key], exact: true }), `${where}: Back goes to ${key}`).toBeVisible()
    }
  }
})

// The tab is kept in the address. A link to a tab that is opened in the moment after signing in (the shell has just appeared)
// used to be lost: the app read the address once and attached its listener a little later, so it stayed on the first tab.
// Nothing here waits for the title or for anything else of the shell, the way a person who pastes a link does not. A fresh
// sign-in for every tab, because the moment is only there after one. (tests/components/admin-tab.test.jsx makes the moment
// happen on purpose; this checks it in a real browser.)
//
// The next round's sign-in loads the page again, and the `page` fixture lets the last round's requests finish before it does (e2e/fixtures.js).
// That wait is in `page.goto`, not in `adminSignIn`, and it is skipped for the goto below, which changes only the fragment of the address,
// so nothing waits between the sign-in and the address.
test('a tab that is opened by its address right after signing in opens', async ({ page }) => {
  for (const [tab, title] of TABS) {
    await page.context().clearCookies() // signed out again: the next sign-in is a first one
    await adminSignIn(page, 'home') // the app opened with no screen in the address (Home), and it returns as soon as that screen is there
    await page.goto(`/admin#${tab}`)
    await expect(page.getByRole('heading', { level: 1, name: title }), tab).toBeVisible()
  }
})

// A tab that was open before shows the list it showed, at once, and takes the current one in the background (useLoad's cache key,
// src/admin/hooks.js). The server's answer for the points is held back by hand, so that the moment before it comes can be looked at: with no
// cache the loading state would be there. The cache is the member's own: a sign-out and a new sign-in start every tab from the loading
// state again. Both layouts, because the tabs are the tab bar on a phone and the side rail on a computer.
test('a tab that was open before shows its list at once and refreshes it in the background, and after signing out and in the first visit loads again', async ({ page }) => {
  const tag = randomUUID().slice(0, 6)
  const added = `נקודה שנוספה ${tag}`
  let gate = null // while it is set, the answer for the list of points waits for it
  await page.route('**/api/admin/points', async (route) => {
    if (route.request().method() === 'GET' && gate) await gate
    await route.continue()
  })
  const hold = () => {
    let release
    gate = new Promise((resolve) => { release = () => { gate = null; resolve() } })
    return release
  }
  const loading = page.getByRole('status').filter({ hasText: 'טוען' })
  const lobby = page.getByRole('article').filter({ hasText: 'לובי' })
  const addedTile = page.getByRole('article').filter({ hasText: added })
  // the screen's button in the tab bar (phone) or in the side rail (computer); the agent is under "עוד" on a phone
  const open = (key) => openScreen(page, key)
  const AGENT_TITLE = SCREEN_TITLES.agent

  await adminSignIn(page, 'points')
  let created = null
  try {
    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      await expect(lobby, `${where}: the list has arrived`).toBeVisible()

      // two tabs, then back to the first: the server's answer is held back, and the list is there anyway, with no loading state
      await open('agent')
      await expect(page.getByRole('heading', { level: 1, name: AGENT_TITLE })).toBeVisible()
      created = (await (await page.request.post('/api/admin/points', { data: { name: added, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })).json()).point
      const release = hold()
      await open('points')
      await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
      await expect(lobby, `${where}: back on Points, the list of the last visit is there before the server answers`).toBeVisible()
      await expect(loading, `${where}: and there is no loading state`).toHaveCount(0)
      await expect(addedTile, `${where}: what changed meanwhile is not there yet`).toHaveCount(0)
      // the answer comes: the fresh list replaces it, with what changed meanwhile
      release()
      await expect(addedTile, `${where}: the fresh list replaces the old one`).toBeVisible()
      await expect(lobby).toBeVisible()
      expect(await noHorizontalScroll(page), `Points at ${where} width`).toBe(true)
      await page.request.delete(`/api/admin/points/${created.id}`, { data: {} })
      created = null

      // signing out and in again: the first visit of a tab loads from the beginning, as it did
      const again = hold()
      await signOut(page)
      await page.getByRole('button', { name: 'כניסת פיתוח' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' }), `${where}: signed in again`).toBeVisible()
      await expect(loading, `${where}: the first visit after a sign-in has its loading state`).toBeVisible()
      await expect(lobby, `${where}: and none of the last session's list`).toHaveCount(0)
      again()
      await expect(lobby, `${where}: then the list arrives`).toBeVisible()
      await expect(loading).toHaveCount(0)
    }
  } finally {
    if (created) await page.request.delete(`/api/admin/points/${created.id}`, { data: {} })
  }
})

test('the history date fields do not overlap and stay inside the filter bar, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    await page.goto('/admin#history')
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    // The filter bar is the block above the list on a computer, and the sheet that the filter button opens on a phone.
    const sheet = isPhoneLayout(page) ? await openFilters(page) : null
    const from = await page.getByLabel('מתאריך').boundingBox()
    const to = await page.getByLabel('עד תאריך').boundingBox()
    const filters = await page.getByLabel('מתאריך').locator('xpath=ancestor::*[contains(@class,"a-filters") or contains(@class,"a-filter-sheet")]').boundingBox()
    await sheet?.getByRole('button', { name: 'סגירה' }).click()
    const where = size ? 'computer' : 'phone'
    const overlap = !(from.x + from.width <= to.x + 0.5 || to.x + to.width <= from.x + 0.5
      || from.y + from.height <= to.y + 0.5 || to.y + to.height <= from.y + 0.5)
    expect(overlap, `the two date fields overlap at ${where} width`).toBe(false)
    for (const box of [from, to]) {
      expect(box.x, `${where} left edge`).toBeGreaterThanOrEqual(filters.x - 0.5)
      expect(box.x + box.width, `${where} right edge`).toBeLessThanOrEqual(filters.x + filters.width + 0.5)
    }
  }
})

test('deleting a point keeps its scans, and a scan row can be deleted on its own', async ({ page, playwright }) => {
  await adminSignIn(page)
  const name = `בדיקת מחיקה ${randomUUID().slice(0, 6)}`

  // a throwaway point with one scan, made through the API
  const created = await page.request.post('/api/admin/points', { data: { name, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })
  const point = (await created.json()).point
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  const providers = (await (await phone.get('/api/public/providers')).json()).providers
  const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
  const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
  const scan = await phone.post('/api/scan', {
    headers: { authorization: `Bearer ${session.token}` },
    data: { id: randomUUID(), code: point.qr_token, gps: null },
  })
  expect((await scan.json()).scan.outcome).toBe('accepted')
  await phone.dispose()

  // delete the point from its tile: the confirmation says its scan stays in the history
  await page.reload() // the list was loaded before the point existed
  await page.goto('/admin#points')
  const tile = page.getByRole('article').filter({ hasText: name })
  await chooseFromMenu(tile, 'מחיקת הנקודה')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('נשארת בהיסטוריה')
  await dialog.getByRole('button', { name: 'מחיקת הנקודה' }).click()
  await expect(tile).toHaveCount(0)

  // the scan is still in the history, under the deleted point's name; delete that row too
  await page.goto('/admin#history')
  const row = page.getByRole('listitem').filter({ hasText: name })
  await expect(row).toHaveCount(1)
  await chooseFromMenu(row, 'מחיקת הנוכחות לצמיתות')
  await expect(page.getByRole('dialog')).toContainText('אי אפשר לשחזר')
  await page.getByRole('dialog').getByRole('button', { name: 'מחיקה', exact: true }).click()
  await expect(row).toHaveCount(0)
})

// ---- the same actions in the same order on every screen ------------------------------------------------------------------------

// Every tile of the card screens, and every row of the History, shows one "more" button, and every action is in the menu of that button, in one
// order: edit (when it has one), the actions of the screen, then switching off or on, then a separator and the red delete, last (AGENTS.md,
// "Rules for every change"). Each screen lists its menu as slots in that order, edit's slot first. A slot holds the names that it may
// have (the switch reads "off" or "on" by the state of the tile), and an `optional` slot is one that some tiles do not have (the phones of a
// provider that has none signed in; cancelling or restoring a visit, which a refused attempt has not). `edit` says that the screen has an
// edit action, which is the first item of its menu. `tile` is the role of what holds the button: a card is an article, a row of the
// History a list item.
const EDIT = { any: ['עריכה'] }
const CARD_SCREENS = {
  points: { edit: true, menu: [EDIT, { any: ['QR והדפסה'] }, { any: ['השבתת הנקודה', 'הפעלת הנקודה'] }, { any: ['מחיקת הנקודה'] }] },
  providers: { edit: true, menu: [EDIT, { any: ['מכשירים'], optional: true }, { any: ['סיסמה חדשה'] }, { any: ['השבתה', 'הפעלה'] }, { any: ['מחיקת נותן השירות'] }] },
  settings: { edit: false, menu: [{ any: ['הסרת גישה', 'החזרת גישה'] }, { any: ['מחיקת מנהל המערכת'] }] },
  agent: { edit: false, menu: [{ any: ['ביטול המפתח'], optional: true }, { any: ['מחיקת המפתח'] }] },
  history: { tile: 'listitem', edit: false, menu: [{ any: ['ביטול הנוכחות', 'שחזור הנוכחות'], optional: true }, { any: ['מחיקת הנוכחות לצמיתות'] }] },
}

/** Whether the names of a menu are exactly its slots, in their order: no name out of its place, none missing, none extra. */
const inOrder = (names, slots) => {
  let at = 0
  for (const slot of slots) {
    if (names[at] !== undefined && slot.any.includes(names[at])) at++
    else if (!slot.optional) return false
  }
  return at === names.length
}
const loaded = async (page, title) => {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}
const near = (values, within, what) => {
  expect(Math.max(...values) - Math.min(...values), `${what}: ${values.map((v) => v.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(within)
}

// Settings (owner decision of 15/10/2026): the members and the building details stand in two columns from 1200px, the members at the start
// (the right in Hebrew) with a third of the width and the building at the end with two thirds, both from the same top. Up to 1199px they are
// stacked as on a phone, the members first. The split does not start at 1024px because a third is 203px there and a member card gets 61px.
test('Settings: the members and the building details are stacked up to 1199px, and from 1200px they stand in two columns, a third and two thirds', async ({ page }) => {
  await adminSignIn(page, 'settings')
  await loaded(page, 'הגדרות')
  const sections = async () => {
    const members = await page.getByRole('region', { name: 'מנהלי המערכת', exact: true }).boundingBox()
    const building = await page.getByRole('region', { name: 'פרטי הבניין', exact: true }).boundingBox()
    return { members, building }
  }
  for (const width of [1024, 1199]) {
    await page.setViewportSize({ width, height: 800 })
    const { members, building } = await sections()
    const at = `at ${width}px`
    expect(Math.abs(members.x - building.x), `${at}: the sections start at the same edge`).toBeLessThanOrEqual(1)
    expect(Math.abs(members.width - building.width), `${at}: and have the same width`).toBeLessThanOrEqual(1)
    expect(building.y, `${at}: the building is under the members`).toBeGreaterThanOrEqual(members.y + members.height - 1)
    expect(await noHorizontalScroll(page), `${at}: no sideways scroll`).toBe(true)
  }
  for (const width of [1200, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    const { members, building } = await sections()
    const at = `at ${width}px`
    expect(Math.abs(members.y - building.y), `${at}: both columns start at the same height`).toBeLessThanOrEqual(1)
    expect(building.x + building.width, `${at}: the building is at the end (the left in Hebrew), beside the members`).toBeLessThanOrEqual(members.x)
    expect(Math.abs(building.width - 2 * members.width), `${at}: the members have a third and the building two thirds`).toBeLessThanOrEqual(2)
    expect(await noHorizontalScroll(page), `${at}: no sideways scroll`).toBe(true)
  }
})

test('every tile shows one "more" button, and its menu holds every action in the same order on every screen, edit first and the red delete last', async ({ page, playwright }) => {
  await adminSignIn(page)
  const tag = randomUUID().slice(0, 6)
  // sample data, so that every kind of tile exists in its different states
  const member = (await (await page.request.post('/api/admin/admins', { data: { email: `parity-${tag}@example.test`, name: `חבר ${tag}` } })).json()).admin
  expect(member?.id, 'the sample committee member was created').toBeTruthy()
  const live = (await (await page.request.post('/api/admin/api-keys', { data: { name: `פעיל ${tag}` } })).json()).api_key
  const dead = (await (await page.request.post('/api/admin/api-keys', { data: { name: `בוטל ${tag}` } })).json()).api_key
  // a write needs a JSON body, even an empty one
  expect((await page.request.post(`/api/admin/api-keys/${dead.id}/revoke`, { data: {} })).ok()).toBe(true)
  // Ploni signs in on a phone (a connected device) and makes one visit that is accepted, one that is refused as too far, and one that is
  // accepted and then cancelled by the committee, so that the History has a row of each kind (each has its own menu)
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    const scan = (code, gps) => phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code, gps } })
    expect((await (await scan(POINTS.basement, null)).json()).scan.outcome).toBe('accepted')
    expect((await (await scan(POINTS.gym, { lat: FAR.latitude, lng: FAR.longitude, accuracy: FAR.accuracy })).json()).scan.outcome).toBe('rejected_far')
    const lobbyVisit = (await (await scan(POINTS.lobby, null)).json()).scan
    expect(lobbyVisit.outcome).toBe('accepted')
    expect((await page.request.post(`/api/admin/scans/${lobbyVisit.id}/void`, { data: { reason: 'נסרק בטעות' } })).ok(), 'the visit was cancelled').toBe(true)

    const moreEdge = {} // where the "more" button sits, measured from the end of its tile, per screen and width
    const phonesSeen = { with: 0, without: 0 } // provider tiles that have the phones action in their menu, and those that have not
    const historySeen = { cancel: 0, restore: 0, deleteOnly: 0 } // History rows that have cancelling, restoring, and the delete alone in their menu
    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      for (const [tab, spec] of Object.entries(CARD_SCREENS)) {
        await page.goto(`/admin#${tab}`) // a tab loads its list when it is opened
        await loaded(page, SCREEN_TITLES[tab])
        if (tab === 'history') {
          // the refused attempt and the cancelled visit are listed too (on a phone: chosen in the sheet)
          await changeFilters(page, async (filters) => {
            await filters.getByLabel('סוג').selectOption('all')
            await filters.getByLabel('כולל מבוטלות').check()
          })
          await expect(page.getByText('נדחתה: רחוק מהנקודה')).toBeVisible()
          await expect(page.getByText('מבוטלת: נסרק בטעות')).toBeVisible()
        }
        const tiles = page.getByRole(spec.tile ?? 'article').filter({ has: page.getByRole('button', { name: /^עוד פעולות/ }) })
        const count = await tiles.count()
        // your own committee card has no menu (you cannot delete yourself), so that screen has just the other member's
        expect(count, `${tab}: tiles that have a menu`).toBeGreaterThan(tab === 'settings' ? 0 : 1)

        const edges = []
        for (let i = 0; i < count; i++) {
          const tile = tiles.nth(i)
          // What the tile shows with its menu closed: the "more" button, and nothing else (edit is in its menu, not beside it).
          const buttons = tile.getByRole('button')
          await expect(buttons, `${tab} #${i} at ${where} width: the buttons that the tile shows`).toHaveCount(1)
          await expect(buttons.first(), `${tab} #${i}: the "more" button, named after its tile`).toHaveAccessibleName(/^עוד פעולות ל./)
          const more = await buttons.first().boundingBox()
          expect(more.width, `${tab} #${i}: the "more" button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
          // the text of the page runs right to left, so the end of a tile is its left edge, and the button at the end is the left-most
          edges.push(more.x - (await tile.boundingBox()).x)

          // Its menu: the names in the order of the rule (edit first, when the screen has one), the red delete last after one separator, and
          // only that one red.
          const menu = await openTileMenu(tile)
          const names = await menu.getByRole('menuitem').allTextContents()
          expect(inOrder(names, spec.menu), `${tab} #${i}: the actions of the menu, in order (they are: ${names.join(' | ')})`).toBe(true)
          if (spec.edit) expect(names[0], `${tab} #${i}: edit is the first item of the menu`).toBe('עריכה')
          else expect(names, `${tab} #${i}: this screen has no edit`).not.toContain('עריכה')
          if (tab === 'providers') phonesSeen[names.includes('מכשירים') ? 'with' : 'without']++
          if (tab === 'history') historySeen[names.includes('שחזור הנוכחות') ? 'restore' : names.includes('ביטול הנוכחות') ? 'cancel' : 'deleteOnly']++
          const paint = await menu.evaluate((el) => {
            const probe = document.createElement('span') // the colour of the danger token, as this page draws it
            probe.style.color = 'var(--w-danger)'
            el.append(probe)
            const danger = getComputedStyle(probe).color
            probe.remove()
            const items = [...el.querySelectorAll('[role="menuitem"]')]
            return {
              danger,
              colors: items.map((item) => getComputedStyle(item).color),
              tops: items.map((item) => item.getBoundingClientRect().top),
              separators: el.querySelectorAll('[role="separator"]').length,
              separatorBeforeLast: items.at(-1).previousElementSibling?.getAttribute('role') === 'separator',
            }
          })
          expect(paint.colors.at(-1), `${tab} #${i}: the last action is red`).toBe(paint.danger)
          expect(paint.colors.slice(0, -1).filter((color) => color === paint.danger), `${tab} #${i}: and the only red one`).toEqual([])
          expect(paint.separators, `${tab} #${i}: one separator, before the delete (none when the delete is alone)`).toBe(names.length > 1 ? 1 : 0)
          expect(paint.separatorBeforeLast || names.length === 1, `${tab} #${i}: the separator is right before the delete`).toBe(true)
          expect(paint.tops, `${tab} #${i}: the items run down the screen in the order of the page`).toEqual([...paint.tops].sort((a, b) => a - b))
          await page.keyboard.press('Escape')
          await expect(menu).toHaveCount(0)
        }
        near(edges, 1, `${tab} at ${where} width: the "more" button is in the same place on every tile`)
        moreEdge[`${tab}/${where}`] = edges[0]
      }
    }
    // the same place from one screen to the next: the "more" button is where it is on every card screen, at each width
    for (const where of ['phone', 'computer']) {
      near(Object.keys(CARD_SCREENS).map((tab) => moreEdge[`${tab}/${where}`]), 1, `${where}: the "more" button is where it is on every card screen`)
    }
    // providers: some tiles have the phones of the provider in their menu and some do not, and the "more" button does not move because of it
    expect(phonesSeen.with, 'some providers have a phone signed in').toBeGreaterThan(0)
    expect(phonesSeen.without, 'and some do not').toBeGreaterThan(0)

    // history: a visit that counts has cancelling, a cancelled one has restoring, and a refused attempt has the delete alone
    expect(historySeen.cancel, 'some visits can be cancelled').toBeGreaterThan(0)
    expect(historySeen.restore, 'some visits can be restored').toBeGreaterThan(0)
    expect(historySeen.deleteOnly, 'and some rows have the delete alone').toBeGreaterThan(0)

    // committee cards are all the same height, also the one that has no menu. On a computer the members are one third of the width, so a
    // long e-mail wraps there by its own length (a card with a longer address is taller, by design): the structure is what is measured,
    // with the same short words in every card, so that only the menu (or its absence) could make one card taller than another.
    await page.goto('/admin#settings')
    await loaded(page, 'הגדרות')
    const cards = await page.getByRole('article').all()
    expect(cards.length, 'your own card and the other member').toBeGreaterThan(1)
    const heights = await Promise.all(cards.map((a) => a.evaluate((card) => {
      card.querySelector('.a-card__title').textContent = 'x'
      card.querySelector('.a-card__sub').textContent = 'x@y.z'
      return card.getBoundingClientRect().height
    })))
    near(heights, 1, 'settings: every member card is the same height, also the one with no menu')
  } finally {
    await phone.dispose()
    await page.request.delete(`/api/admin/admins/${member.id}`)
    for (const key of [live, dead]) await page.request.delete(`/api/admin/api-keys/${key.id}`)
  }
})

// The menu of a tile on a real screen, by keyboard and by touch: Enter or Space on the "more" button opens it on its first item, the arrows
// move, Esc closes it and gives the focus back to the button; choosing an action by key or by tap opens its dialog, and when the dialog
// closes the focus is on the "more" button again (the button is the opener, so a person who works by keyboard is where they were). The
// component's own keys are measured on its own page (e2e/components.spec.js); this is the same on the Points and Providers screens.
test('the menu of a tile works by keyboard and by touch, and a dialog opened from it gives the focus back to its button', async ({ page }) => {
  await adminSignIn(page, 'points')
  const lobby = page.getByRole('article').filter({ hasText: 'לובי' })
  const more = moreButton(lobby)
  const menu = lobby.getByRole('menu')
  const items = menu.getByRole('menuitem')

  // keyboard: Enter, then the arrows, then Esc
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(items).toHaveText(['עריכה', 'QR והדפסה', 'השבתת הנקודה', 'מחיקת הנקודה'])
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(items.nth(3)).toBeFocused()
  await page.keyboard.press('ArrowDown') // past the last goes round to the first
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()

  // keyboard: Space opens it, and Enter on the first item (edit) opens the form of the point; Esc closes the form (nothing was typed) and the
  // focus is on the button
  await page.keyboard.press(' ')
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  const edit = page.getByRole('dialog', { name: 'עריכת נקודה: לובי' })
  await expect(edit).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(more, 'the form of the point gave the focus back to the button that opened it').toBeFocused()

  // keyboard: the arrow down and Enter on the second item open the QR dialog; Esc closes it and the focus is on the button
  await page.keyboard.press('ArrowDown') // on the button, the arrow opens the menu on its first item
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  const qr = page.getByRole('dialog', { name: 'QR: לובי' })
  await expect(qr).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(qr).toHaveCount(0)
  await expect(more, 'the dialog gave the focus back to the button that opened it').toBeFocused()

  // keyboard: the question before switching off can be answered "no" with the keyboard, and the focus is back on the button after it
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(2)).toBeFocused()
  await expect(items.nth(2)).toHaveText('השבתת הנקודה')
  await page.keyboard.press('Enter')
  const question = page.getByRole('dialog', { name: 'להשבית את "לובי"?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'ביטול' }).click()
  await expect(question).toHaveCount(0)
  await expect(more, 'the question gave the focus back to the button').toBeFocused()
  await expect(lobby.getByText('פעילה', { exact: true })).toBeVisible() // saying no changed nothing

  // touch: a tap opens the menu, a tap on an item chooses it, a tap outside closes it
  await more.tap()
  await expect(menu).toBeVisible()
  await page.getByRole('heading', { level: 1 }).tap() // plain text: it takes no focus
  await expect(menu).toHaveCount(0)
  await expect(more, 'a tap outside gave the focus back to the button').toBeFocused()
  await more.tap()
  await items.nth(0).tap()
  await expect(menu).toHaveCount(0)
  await expect(edit).toBeVisible()
  await edit.getByTitle('סגירה').tap()
  await expect(edit).toHaveCount(0)
  await expect(more, 'the form of the point gave the focus back to the button').toBeFocused()
  await more.tap()
  await items.nth(1).tap()
  await expect(menu).toHaveCount(0)
  await expect(qr).toBeVisible()
  await qr.getByTitle('סגירה').tap()
  await expect(qr).toHaveCount(0)
  await expect(more).toBeFocused()

  // the Providers screen: the password dialog, from the keyboard, and the focus back on the button of that provider
  await page.goto('/admin#providers')
  await loaded(page, 'נותני שירות')
  const ploni = page.getByRole('article').filter({ hasText: PEOPLE.ploni.name })
  await moreButton(ploni).focus()
  await page.keyboard.press('Enter')
  const ploniItems = ploni.getByRole('menuitem')
  await page.keyboard.press('End')
  await expect(ploniItems.last(), 'the delete is the last item').toHaveText('מחיקת נותן השירות')
  await expect(ploniItems.first(), 'edit is the first item').toHaveText('עריכה')
  // the new password comes after edit, and after the phones when a phone is signed in: arrow down to it, and choose it
  const at = (await ploniItems.allTextContents()).indexOf('סיסמה חדשה')
  expect(at, 'the new password is in the menu').toBeGreaterThanOrEqual(0)
  await page.keyboard.press('Home')
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown')
  await expect(ploniItems.nth(at)).toBeFocused()
  await page.keyboard.press('Enter')
  const password = page.getByRole('dialog', { name: `סיסמה חדשה: ${PEOPLE.ploni.name}` })
  await expect(password).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(password).toHaveCount(0)
  await expect(moreButton(ploni), 'the focus is back on the button of the provider').toBeFocused()
})

// The same on the rows of the History: Enter opens the menu of a row on its first item, the arrows move, Esc closes it and gives the focus back
// to the button of that row; choosing an action by key or by tap opens its dialog (the form of cancelling, the question before deleting), and
// when that closes without an answer the focus is on the button of the same row. Each button is named after its visit, so the rows are told
// apart; cancelling a visit from the menu does what the icon did.
test('the menu of a History row works by keyboard and by touch, a dialog opened from it gives the focus back to the button of that row, and the buttons name their visits', async ({ page, playwright }) => {
  await adminSignIn(page)
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    const scan = (code) => phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code, gps: null } })
    for (const code of [POINTS.basement, POINTS.lobby]) expect((await (await scan(code)).json()).scan.outcome).toBe('accepted')
  } finally {
    await phone.dispose()
  }
  await page.reload() // the list was loaded before the visits existed

  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await page.goto('/admin#agent') // from another tab, so that the History opens its list again
    await loaded(page, SCREEN_TITLES.agent)
    await page.goto('/admin#history')
    await loaded(page, SCREEN_TITLES.history)
    const row = page.getByRole('listitem').filter({ hasText: 'מינוס 1' })
    const other = page.getByRole('listitem').filter({ hasText: 'לובי' })
    await expect(row, `${where}: the visit at the basement`).toHaveCount(1)
    const more = moreButton(row)
    const menu = row.getByRole('menu')
    const items = menu.getByRole('menuitem')

    // the buttons of two rows have two names: the point, the person, and the day and time of the visit
    // (the person is the name that the visit recorded: the contact, and the company in parentheses)
    await expect(more).toHaveAccessibleName(new RegExp(`^עוד פעולות לביקור: מינוס 1 · ${PEOPLE.ploni.name} \\(ניקיון\\) · \\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}$`))
    await expect(moreButton(other)).toHaveAccessibleName(new RegExp(`^עוד פעולות לביקור: לובי · ${PEOPLE.ploni.name} \\(ניקיון\\) · `))
    expect(await more.getAttribute('aria-label'), 'two rows, two names').not.toBe(await moreButton(other).getAttribute('aria-label'))

    // keyboard: Enter, then the arrows, then Esc
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(items).toHaveText(['ביטול הנוכחות', 'מחיקת הנוכחות לצמיתות'])
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowDown') // past the last goes round to the first
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(more, `${where}: Esc gave the focus back to the button`).toBeFocused()

    // keyboard: Space opens it, Enter on the first item opens the form of cancelling, and Esc closes the form (nothing was typed)
    await page.keyboard.press(' ')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    const cancelForm = page.getByRole('dialog', { name: 'ביטול נוכחות' })
    await expect(cancelForm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(cancelForm).toHaveCount(0)
    await expect(more, `${where}: the form gave the focus back to the button of its row`).toBeFocused()

    // keyboard: the red delete is the second item; its question is answered "no" with the keyboard, and the focus is on the button again
    await page.keyboard.press('ArrowUp') // opens it on the last item
    await expect(items.nth(1)).toBeFocused()
    await expect(items.nth(1)).toHaveText('מחיקת הנוכחות לצמיתות')
    await page.keyboard.press('Enter')
    const question = page.getByRole('dialog', { name: 'למחוק את הנוכחות לצמיתות?' })
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'ביטול' }).click()
    await expect(question).toHaveCount(0)
    await expect(more, `${where}: the question gave the focus back to the button`).toBeFocused()
    await expect(row, 'saying no deleted nothing').toHaveCount(1)

    // touch: a tap opens the menu, a tap outside closes it, a tap on an item chooses it
    await more.tap()
    await expect(menu).toBeVisible()
    await page.getByRole('heading', { level: 1 }).tap() // plain text: it takes no focus
    await expect(menu).toHaveCount(0)
    await expect(more, `${where}: a tap outside gave the focus back to the button`).toBeFocused()
    await more.tap()
    await items.nth(0).tap()
    await expect(menu).toHaveCount(0)
    await expect(cancelForm).toBeVisible()
    await cancelForm.getByRole('button', { name: 'סגירה' }).tap()
    await expect(cancelForm).toHaveCount(0)
    await expect(more).toBeFocused()
  }

  // cancelling a visit from its menu does what the icon did: the form takes the reason, the visit is cancelled, and it leaves the list of
  // the visits that count
  const row = page.getByRole('listitem').filter({ hasText: 'מינוס 1' })
  await chooseFromMenu(row, 'ביטול הנוכחות')
  const form = page.getByRole('dialog', { name: 'ביטול נוכחות' })
  await form.getByLabel('סיבה (לא חובה)').fill('נסרק בטעות')
  await form.getByRole('button', { name: 'ביטול הנוכחות' }).click()
  await expect(form).toHaveCount(0)
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'לובי' }), 'the other visit is where it was').toHaveCount(1)
})

// ---- a long name in a tile and in the head of a dialog ---------------------------------------------------------------------

// The "more" button of a point's tile never moves below its title (the next test measures that), so on a phone it leaves the title a
// column of about 100 px, and a long word of the name (an English "Maintenance" or a Russian word) breaks inside that column, which is what
// the owner chose (14/10/2026). The computer shows the tile in a wider column, where no word of the name is cut. The same name in the head
// of a dialog wraps over several lines, with no word cut, and the close button stays at the top of the head instead of the middle of it.
// 360 px is the narrowest phone in use (the two E2E devices are 390 and 412 wide).
test('a long point name is readable in its tile on a computer and in the head of a dialog: no word is cut across lines, the "more" button keeps its end of the row, and the close button is at the top', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await adminSignIn(page)
  const name = `Maintenance switchboard room north ${randomUUID().slice(0, 6)}`
  const created = await page.request.post('/api/admin/points', { data: { name, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })
  expect(created.ok(), 'the long point was created').toBeTruthy()
  const point = (await created.json()).point
  await page.reload() // the list was loaded before the point existed
  /** The words of a text that a line break cuts in the middle (a break at a space is not one). */
  const cutWords = (heading) => heading.evaluate((el) => {
    const node = el.firstChild
    const cut = []
    for (const match of node.textContent.matchAll(/\S+/g)) {
      const range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) cut.push(match[0])
    }
    return cut
  })
  try {
    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      await page.goto('/admin#points')
      await loaded(page, 'נקודות סריקה')
      const tile = page.getByRole('article').filter({ hasText: name })
      const title = tile.getByRole('heading', { name })
      // a word that does not fit beside the button breaks on a phone, by design; on a computer there is room for the whole of each
      if (size) expect(await cutWords(title), `${where}: words of the title that are cut across lines`).toEqual([])
      // the end of the row: the "more" button is at the same distance from the end of the tile as on a tile with a short name (the text runs
      // right to left, so the end of a tile is its left edge)
      const edgeOf = async (article) => {
        const buttons = article.getByRole('button')
        await expect(buttons, `${where}: the "more" button is the only one`).toHaveCount(1)
        await expect(buttons.last(), `${where}: the "more" button is named after its tile`).toHaveAccessibleName(/^עוד פעולות ל./)
        return (await buttons.first().boundingBox()).x - (await article.boundingBox()).x
      }
      near([await edgeOf(tile), await edgeOf(page.getByRole('article').filter({ hasText: 'לובי' }).first())], 1, `${where}: the "more" button is in the same place on a long and on a short tile`)
      expect(await noHorizontalScroll(page), `${where}: the points do not scroll sideways`).toBe(true)

      // the dialog: its title is "QR: " and the name, which wraps over several lines on a phone
      await chooseFromMenu(tile, 'QR והדפסה')
      const dialog = page.getByRole('dialog')
      const head = dialog.getByRole('heading', { level: 2 })
      await expect(head).toContainText(name)
      expect(await cutWords(head), `${where}: words of the dialog title that are cut across lines`).toEqual([])
      const close = dialog.getByTitle('סגירה') // the icon in the head (the button of the footer has the same name but no title)
      const [headBox, closeBox] = await Promise.all([head.boundingBox(), close.boundingBox()])
      if (headBox.height > closeBox.height + 1) {
        expect(closeBox.y, `${where}: a title of several lines has the close button at its top`).toBeCloseTo(headBox.y, 0)
      } else {
        expect(closeBox.y + closeBox.height / 2, `${where}: a title of one line is centred against the close button`).toBeCloseTo(headBox.y + headBox.height / 2, 0)
      }
      if (!size) expect(headBox.height, 'the title wraps over several lines on a phone, so the case above is the one that was measured').toBeGreaterThan(closeBox.height)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    // a title of one line stays where it was: centred against the close button
    await chooseFromMenu(page.getByRole('article').filter({ hasText: 'לובי' }).first(), 'QR והדפסה')
    const shortHead = page.getByRole('dialog').getByRole('heading', { level: 2 })
    const [shortBox, shortClose] = await Promise.all([shortHead.boundingBox(), page.getByRole('dialog').getByTitle('סגירה').boundingBox()])
    expect(shortBox.height, 'the title of the lobby is one line').toBeLessThan(shortClose.height)
    expect(shortClose.y + shortClose.height / 2, 'a title of one line is centred against the close button').toBeCloseTo(shortBox.y + shortBox.height / 2, 0)
    await page.keyboard.press('Escape')
  } finally {
    await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
  }
})

// ---- the "more" button stays beside the title of every card ---------------------------------------------------------------------

// The "more" button of a card is on the row of its title, on a computer and on a phone, however long the title is (owner decision of
// 14/10/2026): the block of the title takes what the button leaves and wraps its own text, and a word with no space in it breaks wherever it
// must. The rule before it let the button drop below the title when the title did not fit beside it, and a row that kept the button beside
// a narrow title once overflowed on a long word with no space. So each card screen is measured, at 320, 360 and 1280 px, with the longest
// title that its field allows (words, and the same length with one long word in it) and with a short title for comparison:
//   - the button is inside the row of the title, centred on it (the mark at the other end is centred the same way) and beside the block of
//     the title, never under it;
//   - the row is as tall as its tallest part and no more (nothing is stacked under the title), and starts where the title block starts;
//   - the card, its title and its second line have no horizontal overflow, the button is inside the card, and the page does not scroll
//     sideways.
// A card with a short title and nothing under it (a point with no description, a key) has a row as tall as the button, and there the top of
// the button is the top of the row; with a second line, or a title of several lines, the row is taller and the button is centred on it.
const LONG_WORDS = ['Maintenance', 'switchboard', 'room', 'north', 'annex', 'corridor', 'elevator', 'lobby']
/** As many of the words, in a ring, as fit in `max` characters. */
function wordsUpTo(max) {
  let out = ''
  for (let i = 0; ; i++) {
    const next = out ? `${out} ${LONG_WORDS[i % LONG_WORDS.length]}` : LONG_WORDS[i % LONG_WORDS.length]
    if (next.length > max) return out
    out = next
  }
}
/** `max` characters in all: words, and then one word of about `max / 2` characters with no space in it. */
const withLongWord = (max) => {
  const word = 'Wxyz'.repeat(Math.floor(max / 8))
  return `${wordsUpTo(max - word.length - 1)} ${word}`
}

test('the "more" button of a card stays on the row of its title, however long the title is, at 320, 360 and 1280 px, on every card screen', async ({ page }) => {
  await adminSignIn(page, 'points')
  const tag = randomUUID().slice(0, 6)
  const created = []
  const make = async (url, data, pick) => {
    const response = await page.request.post(url, { data })
    expect(response.ok(), `POST ${url} ${response.status()}`).toBeTruthy()
    created.push(`${url}/${pick(await response.json()).id}`)
  }
  // Each screen: the limit of the field that holds its title, and how a card is made with a title and the other text that sits under it.
  const SCREENS = [
    {
      tab: 'points', max: NAME_MAX_LENGTH,
      add: (title, variant) => make('/api/admin/points', {
        name: title, description: variant === 'short' ? undefined : variant === 'words' ? wordsUpTo(DESCRIPTION_MAX_LENGTH) : 'Desc'.repeat(30),
        lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none',
      }, (r) => r.point),
    },
    {
      tab: 'providers', max: NAME_MAX_LENGTH,
      add: (title, variant) => make('/api/admin/providers', {
        contact_name: title, company: variant === 'short' ? 'ניקיון' : variant === 'words' ? wordsUpTo(NAME_MAX_LENGTH) : 'Corp'.repeat(30), password: 'dev-pass-card-row',
      }, (r) => r.provider),
    },
    {
      tab: 'settings', max: NAME_MAX_LENGTH,
      add: (title, variant) => make('/api/admin/admins', {
        name: title, email: variant === 'long-word' ? `${'a'.repeat(60)}-${tag}@${'b'.repeat(60)}.example.test` : `${variant}-${tag}@example.test`,
      }, (r) => r.admin),
    },
    { tab: 'agent', max: KEY_NAME_MAX_LENGTH, add: (title) => make('/api/admin/api-keys', { name: title }, (r) => r.api_key) },
  ]
  const SHORT = { points: 'חדר', providers: 'אבי', settings: 'דנה', agent: 'מפתח' } // one word of a few letters: one line at every width
  const VARIANTS = (screen) => [['short', SHORT[screen.tab]], ['words', wordsUpTo(screen.max)], ['long-word', withLongWord(screen.max)]]
  try {
    for (const screen of SCREENS) for (const [variant, title] of VARIANTS(screen)) await screen.add(title, variant)
    await page.reload() // the lists were loaded before the cards existed

    for (const width of [320, 360, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      for (const screen of SCREENS) {
        await page.goto(`/admin#${screen.tab}`)
        await loaded(page, SCREEN_TITLES[screen.tab])
        for (const [variant, title] of VARIANTS(screen)) {
          const where = `${width} px, ${screen.tab}, a ${variant} title`
          const heading = page.getByRole('heading', { name: title, exact: true })
          await expect(heading, `${where}: the card is there`).toBeVisible()
          const m = await heading.evaluate((h) => {
            const article = h.closest('article')
            const row = h.closest('.a-card__top')
            const id = row.firstElementChild
            const button = row.querySelector('button[aria-haspopup="menu"]')
            const box = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height } }
            return {
              row: box(row), id: box(id), title: box(h), button: button ? box(button) : null, article: box(article), buttons: row.querySelectorAll('button').length,
              articleOverflow: article.scrollWidth - article.clientWidth, titleOverflow: h.scrollWidth - h.clientWidth,
              subOverflow: Math.max(0, ...[...article.querySelectorAll('.a-card__sub')].map((el) => el.scrollWidth - el.clientWidth)),
            }
          })
          expect(m.buttons, `${where}: the row has the "more" button and no other`).toBe(1)
          expect(m.button, `${where}: the "more" button is there`).toBeTruthy()
          const centre = (b) => (b.top + b.bottom) / 2
          expect(m.button.top, `${where}: the button is inside its row (top)`).toBeGreaterThanOrEqual(m.row.top - 0.5)
          expect(m.button.bottom, `${where}: the button is inside its row (bottom)`).toBeLessThanOrEqual(m.row.bottom + 0.5)
          expect(Math.abs(centre(m.button) - centre(m.row)), `${where}: the button is centred on the row of the title`).toBeLessThanOrEqual(1)
          expect(m.button.top < m.id.bottom && m.button.bottom > m.id.top, `${where}: the button is level with the title block, not under it`).toBe(true)
          expect(m.button.right <= m.id.left + 0.5 || m.button.left >= m.id.right - 0.5, `${where}: the button is beside the title block, not over it`).toBe(true)
          expect(m.row.height, `${where}: the row is as tall as its tallest part: nothing is stacked under the title`).toBeLessThanOrEqual(Math.max(m.id.height, m.button.height) + 1)
          expect(Math.abs(m.id.top - m.row.top), `${where}: the title block starts at the top of the row`).toBeLessThanOrEqual(1)
          // a row that is no taller than its button (a title of one line and no second line under it): the top of the button is the top of the row
          if (m.id.height <= m.button.height + 1) expect(Math.abs(m.button.top - m.row.top), `${where}: the top of the button is the top of the row`).toBeLessThanOrEqual(1)
          expect(m.article.left, `${where}: the card is inside the screen`).toBeGreaterThanOrEqual(-0.5)
          expect(m.article.right, `${where}: the card is inside the screen`).toBeLessThanOrEqual(width + 0.5)
          expect(m.button.left, `${where}: the button is inside the card`).toBeGreaterThanOrEqual(m.article.left - 0.5)
          expect(m.button.right, `${where}: the button is inside the card`).toBeLessThanOrEqual(m.article.right + 0.5)
          expect(m.title.left, `${where}: the title is inside its block`).toBeGreaterThanOrEqual(m.id.left - 0.5)
          expect(m.title.right, `${where}: the title is inside its block`).toBeLessThanOrEqual(m.id.right + 0.5)
          expect(m.articleOverflow, `${where}: the card does not overflow sideways`).toBeLessThanOrEqual(0)
          expect(m.titleOverflow, `${where}: the title does not overflow its box`).toBeLessThanOrEqual(0)
          expect(m.subOverflow, `${where}: the line under the title does not overflow its box`).toBeLessThanOrEqual(0)
        }
        expect(await noHorizontalScroll(page), `${width} px, ${screen.tab}: the page does not scroll sideways`).toBe(true)
      }
    }
  } finally {
    for (const path of created.reverse()) await page.request.delete(path, { data: {} })
  }
})

// ---- a long service name, a long description, many scanners and long names in a card or a button ----------------------------------

// Owner decisions of 16/10/2026, found by `npm run ui-review:pictures` (worst-case data at the limits of the server):
//   - the service-type chip of a Points or Providers card wraps inside the card (it did not wrap: at 360 px it pushed the page sideways by 28 to 42 px,
//     cut the title and left the "more" button hard to hit);
//   - the description of a point stops at two lines with an ellipsis, and the tile "מי סורק" names two providers and then "ועוד N", each
//     name on a line of its own that stops at two lines with an ellipsis too (owner decision of 17/10/2026), and "ועוד N" on its own line (the
//     ellipsis is the browser's, so the whole text stays in the page; the names that the tile does not draw are in a run for screen readers,
//     and a screen reader hears every name once, separated by ", ");
//   - an e-mail breaks only after an "@" or a dot, so no piece of it is cut across lines (a piece longer than the room is the last resort);
//   - the account button of the side rail keeps the name and the address to one line each, and the account menu keeps them whole.
// The data is this run's own (the API, deleted at the end), at 320, 360 and 1280 px. The lines themselves cannot be counted in jsdom.
/** The height of one line of `locator`'s text, from its own font: a line-height of `normal` is taken as 1.4 times the size. */
const lineHeightOf = (locator) => locator.evaluate((el) => {
  const style = getComputedStyle(el)
  const px = parseFloat(style.lineHeight)
  return Number.isNaN(px) ? parseFloat(style.fontSize) * 1.4 : px
})
/** The names that a screen reader hears from a cell of the tile "מי סורק", sorted: its text without the part that is hidden from it (`aria-hidden`, the "ועוד N"), split at the ", " between names. */
const heardNames = (cell) => cell.evaluate((el) => {
  const copy = el.cloneNode(true)
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return copy.textContent.split(', ').sort()
})
/** The pieces of an address that a line break cuts across two lines (a piece is the text up to an "@" or a dot: `.a-email__piece`). */
const cutPieces = (bdi) => bdi.evaluate((el) => {
  const cut = []
  for (const piece of el.querySelectorAll('.a-email__piece')) {
    const range = document.createRange()
    range.selectNodeContents(piece)
    if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) cut.push(piece.textContent)
  }
  return cut
})

test('a long service name, a long description and many scanners fit the cards of Points and Providers at 320, 360 and 1280 px: the chip wraps inside its card, the description stops at two lines, the tile names two providers, each on a line of its own that stops at two lines, and then "ועוד N", and nothing makes the page scroll sideways', async ({ page }) => {
  await adminSignIn(page, 'points')
  const tag = randomUUID().slice(0, 6)
  const created = []
  const make = async (url, data, pick) => {
    const response = await page.request.post(url, { data })
    expect(response.ok(), `POST ${url} ${response.status()}`).toBeTruthy()
    const item = pick(await response.json())
    created.push(`${url}/${item.id}`)
    return item
  }
  const words = wordsUpTo(SERVICE_TYPE_MAX_LENGTH) // the longest service name of words (60 characters)
  const oneWord = withLongWord(SERVICE_TYPE_MAX_LENGTH) // and one that has a very long word in it
  const description = wordsUpTo(DESCRIPTION_MAX_LENGTH)
  try {
    // three providers, the first two with the long service names (the cards of the Providers screen), and two points
    const providers = []
    for (const [i, service] of [words, oneWord, 'cleaning'].entries()) {
      providers.push(await make('/api/admin/providers', {
        contact_name: `Scanner ${tag} ${'ABC'[i]}`, company: `Co ${tag}`, service_type: service, password: 'dev-pass-card-row',
      }, (r) => r.provider))
    }
    const ids = providers.map((p) => p.id)
    // and two with the longest name that the server accepts (120 characters): words, and the same length with one long word in it
    const longProviders = []
    for (const name of [wordsUpTo(NAME_MAX_LENGTH), withLongWord(NAME_MAX_LENGTH)]) {
      longProviders.push(await make('/api/admin/providers', { contact_name: name, company: `Co ${tag}`, service_type: 'cleaning', password: 'dev-pass-card-row' }, (r) => r.provider))
    }
    const points = [
      { name: `Chip words ${tag}`, service: words, description, provider_ids: ids }, // three scanners: "ועוד 1"
      { name: `Chip word ${tag}`, service: oneWord, description: 'Wxyz'.repeat(DESCRIPTION_MAX_LENGTH / 4), provider_ids: ids.slice(0, 2) }, // two: no "ועוד"
      { name: `Long names ${tag}`, service: undefined, description: undefined, provider_ids: longProviders.map((p) => p.id) }, // two names of 120 characters: each stops at two lines
    ]
    for (const p of points) {
      await make('/api/admin/points', {
        name: p.name, description: p.description, service_type: p.service, provider_ids: p.provider_ids, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none',
      }, (r) => r.point)
    }
    await page.reload() // the lists were loaded before the data existed
    const cardOf = (title) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

    /** What a card shows of its chip and its button, measured in the page. */
    const measure = (article, service) => article.evaluate((a, text) => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height } }
      const chip = [...a.querySelectorAll('.a-badge')].find((el) => el.textContent === text)
      const first = a.querySelector('.a-badge')
      const more = a.querySelector('button[aria-haspopup="menu"]')
      more.scrollIntoView({ block: 'center', inline: 'center' }) // a person scrolls to it; a card can be taller than the screen
      const mid = more.getBoundingClientRect()
      const hit = document.elementFromPoint(mid.left + mid.width / 2, mid.top + mid.height / 2)
      return {
        article: box(a), chip: chip ? box(chip) : null, first: box(first), more: box(more), reached: more.contains(hit),
        chipClipped: chip ? chip.scrollWidth > chip.clientWidth || chip.scrollHeight > chip.clientHeight : null, articleOverflow: a.scrollWidth - a.clientWidth,
      }
    }, service)

    for (const width of [320, 360, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      for (const [screen, cards] of [
        ['points', points.slice(0, 2).map((p) => ({ title: p.name, service: p.service }))],
        ['providers', providers.slice(0, 2).map((p) => ({ title: p.contact_name, service: p.service_type }))],
      ]) {
        await page.goto(`/admin#${screen}`)
        await loaded(page, SCREEN_TITLES[screen])
        for (const { title, service } of cards) {
          const where = `${width} px, ${screen}, "${title}"`
          const article = cardOf(title)
          await expect(article, `${where}: the card is there`).toBeVisible()
          await expect(article.locator('.a-badge', { hasText: service }), `${where}: the whole service name is in the chip`).toHaveText(service)
          const m = await measure(article, service)
          expect(m.chip, `${where}: the chip is there`).toBeTruthy()
          expect(m.chip.left, `${where}: the chip is inside the card`).toBeGreaterThanOrEqual(m.article.left - 0.5)
          expect(m.chip.right, `${where}: the chip is inside the card`).toBeLessThanOrEqual(m.article.right + 0.5)
          expect(m.chipClipped, `${where}: no text of the chip is clipped`).toBe(false)
          // at a phone's width the sixty characters do not fit one line: the chip is taller than a one-line chip, so it did wrap
          if (width <= 360) expect(m.chip.height, `${where}: the chip wraps onto more lines`).toBeGreaterThan(m.first.height * 1.5)
          expect(m.more.left, `${where}: the "more" button is inside the card`).toBeGreaterThanOrEqual(m.article.left - 0.5)
          expect(m.more.right, `${where}: the "more" button is inside the screen`).toBeLessThanOrEqual(width)
          expect(m.reached, `${where}: a finger at the middle of the "more" button reaches it`).toBe(true)
          expect(m.more.height, `${where}: the "more" button is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
          expect(m.articleOverflow, `${where}: the card does not overflow sideways`).toBeLessThanOrEqual(0)
        }
        expect(await noHorizontalScroll(page), `${width} px, ${screen}: the page does not scroll sideways`).toBe(true)
      }

      // the point with a long description and three scanners
      await page.goto('/admin#points')
      await loaded(page, SCREEN_TITLES.points)
      const card = cardOf(points[0].name)
      const text = card.locator('.a-card__sub')
      await expect(text, `${width} px: the whole description is in the page`).toHaveText(description)
      const [lineHeight, shape] = await Promise.all([lineHeightOf(text), text.evaluate((el) => ({ shown: el.clientHeight, whole: el.scrollHeight, clamp: getComputedStyle(el).webkitLineClamp, direction: getComputedStyle(el).direction }))])
      expect(shape.clamp, `${width} px: the description is clamped to two lines`).toBe('2')
      expect(shape.direction, `${width} px: a description in Latin letters takes its own direction (the page is right to left), so that its ellipsis is at its end`).toBe('ltr')
      expect(shape.shown, `${width} px: it shows two lines or fewer`).toBeLessThanOrEqual(lineHeight * 2 + 1)
      expect(shape.whole, `${width} px: it holds more than it shows, so the clamp cut it`).toBeGreaterThan(shape.shown + 1)
      const long = cardOf(points[1].name).locator('.a-card__sub')
      expect(await long.evaluate((el) => el.clientHeight), `${width} px: a description that is one long word is cut at two lines too`).toBeLessThanOrEqual(lineHeight * 2 + 1)

      // "מי סורק": two names, each in an element of its own, and "ועוד 1" for the third on a line of its own, every name still in the page;
      // two names alone say no "ועוד"
      const who = card.locator('.a-facts dd').first()
      await expect(who.locator(':scope > bdi.a-clamp-2'), `${width} px: two names are drawn, each in a bdi of its own that is the clamped box`).toHaveCount(2)
      await expect(who.locator('.w-sr bdi'), `${width} px: the third name is in the run for a screen reader, isolated like the others`).toHaveCount(1)
      await expect(who.getByText('ועוד 1', { exact: true }), `${width} px: the third is "ועוד 1"`).toBeVisible()
      for (const p of providers) await expect(who, `${width} px: ${p.contact_name} is in the page`).toContainText(p.contact_name)
      expect(await heardNames(who), `${width} px: a screen reader hears every name once, separated by ", ", and no count`).toEqual(providers.map((p) => p.contact_name).sort())
      const stack = await who.evaluate((el) => {
        const box = (n) => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } }
        return { names: [...el.querySelectorAll(':scope > .a-clamp-2')].map(box), more: box(el.querySelector(':scope > [aria-hidden="true"]')) }
      })
      expect(stack.names[1].top, `${width} px: the second name is under the first, not beside it`).toBeGreaterThanOrEqual(stack.names[0].bottom - 0.5)
      expect(stack.more.top, `${width} px: "ועוד 1" is on a line of its own, under the last name`).toBeGreaterThanOrEqual(stack.names[1].bottom - 0.5)
      const two = cardOf(points[1].name).locator('.a-facts dd').first()
      await expect(two.locator('bdi'), `${width} px: two names`).toHaveCount(2)
      await expect(two, `${width} px: two names say no "ועוד"`).not.toContainText('ועוד')
      expect(await heardNames(two), `${width} px: two names are heard once each, separated by ", "`).toEqual(providers.slice(0, 2).map((p) => p.contact_name).sort())

      // two names of 120 characters (words, and one long word): each stops at two lines and is cut, so the tile is four lines or fewer
      const longWho = cardOf(points[2].name).locator('.a-facts dd').first()
      const longNames = longWho.locator(':scope > bdi.a-clamp-2')
      await expect(longNames, `${width} px: two long names are drawn, each in an element of its own`).toHaveCount(2)
      await expect(longWho, `${width} px: two names say no "ועוד"`).not.toContainText('ועוד')
      const wanted = longProviders.map((p) => p.contact_name)
      expect((await longNames.allTextContents()).sort(), `${width} px: the whole of each long name is in the page`).toEqual([...wanted].sort())
      const longLineHeight = await lineHeightOf(longNames.first())
      for (const i of [0, 1]) {
        const shape = await longNames.nth(i).evaluate((el) => ({ shown: el.clientHeight, whole: el.scrollHeight, clamp: getComputedStyle(el).webkitLineClamp, direction: getComputedStyle(el).direction }))
        expect(shape.clamp, `${width} px: long name ${i + 1} is clamped to two lines`).toBe('2')
        expect(shape.direction, `${width} px: long name ${i + 1} is in Latin letters, so its box is left to right in the right-to-left page and its ellipsis lands at its end`).toBe('ltr')
        expect(shape.shown, `${width} px: long name ${i + 1} shows two lines or fewer`).toBeLessThanOrEqual(longLineHeight * 2 + 1)
        expect(shape.whole, `${width} px: long name ${i + 1} holds more than it shows, so the clamp cut it`).toBeGreaterThan(shape.shown + 1)
      }
      expect(await longWho.evaluate((el) => el.getBoundingClientRect().height), `${width} px: the two names make four lines or fewer`).toBeLessThanOrEqual(longLineHeight * 4 + 2)
      expect(await heardNames(longWho), `${width} px: the long names are heard once each, separated by ", "`).toEqual([...wanted].sort())
    }

    // the edit dialog holds all of it: the whole description, and every provider who may scan
    await chooseFromMenu(cardOf(points[0].name), 'עריכה')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('תיאור (לא חובה)'), 'the form has the whole description').toHaveValue(description)
    for (const p of providers) await expect(dialog.getByText(`${p.contact_name} · ${p.company}`), `the form lists ${p.contact_name}`).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    for (const path of created.reverse()) await page.request.delete(path, { data: {} })
  }
})

test('an e-mail address breaks only after "@" or a dot, in a member card of Settings and in the account menu, and the account button of the side rail keeps the name and the address to one line each', async ({ page }) => {
  await adminSignIn(page, 'settings')
  const tag = randomUUID().slice(0, 6)
  // pieces of 13 characters or fewer, each of which fits the narrowest place that an address is drawn in (a member's card at 1280 px has about 146 px)
  const email = `committee.chair.${tag}@management.north-region.example.test`
  const name = `גילה ${tag} יושבת ראש הוועד ואחראית על מערכות הבניין, החניון והגגות המשותפים של הבית` // a long one: it also heads the member's card
  const created = await page.request.post('/api/admin/admins', { data: { name, email } })
  expect(created.ok(), 'the member was created').toBeTruthy()
  const member = (await created.json()).admin
  try {
    await page.reload() // the list was loaded before the member existed
    for (const width of [320, 360, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/admin#settings')
      await loaded(page, SCREEN_TITLES.settings)
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: new RegExp(`^גילה ${tag}`), level: 3 }) })
      const address = card.locator('bdi')
      await expect(address, `${width} px: the whole address is in the card`).toHaveText(email)
      expect(await cutPieces(address), `${width} px: pieces of the address that a line break cuts in two`).toEqual([])
      expect(await address.locator('.a-email__piece').count(), `${width} px: a piece for each stretch up to an "@" or a dot`).toBe(email.match(/[@.]/g).length + 1)
      expect(await noHorizontalScroll(page), `${width} px: Settings does not scroll sideways`).toBe(true)
    }

    // the account button and its menu, for that member, who has a long name and an address that does not fit: the page signs in as the member
    // (the dev sign-in takes any active member's address; the cookie is shared with the page's requests, and the finally below signs back in)
    const login = await page.request.post('/api/admin/dev-login', { data: { email } })
    expect(login.ok(), 'the member signed in').toBeTruthy()
    await page.reload() // the app asks who is signed in when it starts
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/admin#points')
      await loaded(page, SCREEN_TITLES.points)
      if (width >= 1024) {
        const button = accountButton(page)
        const oneLine = async (locator, what) => {
          const lineHeight = await lineHeightOf(locator)
          const shape = await locator.evaluate((el) => ({ shown: el.getBoundingClientRect().height, wide: el.scrollWidth > el.clientWidth, text: el.textContent }))
          expect(shape.shown, `${width} px: the ${what} of the button is one line`).toBeLessThanOrEqual(lineHeight + 1)
          expect(shape.wide, `${width} px: the ${what} is longer than its room, and the CSS cut it`).toBe(true)
          return shape.text
        }
        expect(await oneLine(button.locator('strong'), 'name'), `${width} px: the whole name is in the page`).toBe(name)
        expect(await oneLine(button.locator('.a-who__mail'), 'address'), `${width} px: the whole address is in the page`).toBe(email)
        expect((await button.boundingBox()).height, `${width} px: the button is not taller than a name and an address`).toBeLessThan(100)
      }
      await openAccountMenu(page)
      const menu = page.getByRole('dialog', { name: 'החשבון שלי', exact: true })
      const shown = menu.locator('.a-who strong')
      await expect(shown, `${width} px: the menu has the whole name`).toHaveText(name)
      expect(await shown.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight), `${width} px: the whole name is drawn, nothing is cut`).toBe(true)
      const address = menu.locator('.a-who bdi')
      await expect(address, `${width} px: the menu has the whole address`).toHaveText(email)
      expect(await cutPieces(address), `${width} px: pieces of the address in the menu that a line break cuts in two`).toEqual([])
      expect(await noHorizontalScroll(page), `${width} px: the open menu does not scroll the page sideways`).toBe(true)
      await page.keyboard.press('Escape')
    }
  } finally {
    await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } }) // a member cannot delete themselves
    await page.request.delete(`/api/admin/admins/${member.id}`, { data: {} })
  }
})

// ---- the phones of a provider --------------------------------------------------------------------------------------------

test("a provider's phones: the card says what waits on them, and a dialog lists each phone, on a phone and on a computer", async ({ page, playwright }) => {
  await adminSignIn(page)
  const LABEL = 'Fake Browser Label' // what the app sends as the label of a phone: the committee never sees it
  const HOUR = 3600 * 1000
  const oldest = new Date(Date.now() - 30 * HOUR).toISOString() // a visit that has waited 30 hours on one phone
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  const providers = (await (await phone.get('/api/public/providers')).json()).providers
  const john = providers.find((p) => p.contact_name === PEOPLE.john.name)
  try {
    // An earlier test may have signed John in on a phone: start from none, so that the two below are all he has.
    expect((await page.request.post(`/api/admin/providers/${john.id}/revoke-devices`, { data: {} })).ok()).toBeTruthy()
    // John signs in on two phones. The first reports what waits in its queue and uploads it; the second is an old version of the app: it reports nothing.
    const signInPhone = async () =>
      (await (await phone.post('/api/session', { data: { provider_id: john.id, password: PEOPLE.john.password, device_label: LABEL } })).json()).token
    const reporting = { authorization: `Bearer ${await signInPhone()}` }
    await signInPhone()
    const report = await phone.post('/api/my/device-status', {
      headers: reporting, data: { build: 'abcdef1', waiting: 3, oldest_waiting_at: oldest, not_accepted_total: 2, overflowed_total: 1 },
    })
    expect(report.ok(), 'the phone reports').toBeTruthy()
    const upload = await phone.post('/api/scans/sync', {
      headers: reporting, data: { scans: [{ id: randomUUID(), code: POINTS.lobby, client_time: new Date(Date.now() - HOUR).toISOString() }] },
    })
    expect(upload.ok(), 'the phone uploads its queue').toBeTruthy()

    // the card: how many wait and since when (DD/MM/YYYY HH:MM), and the warning for a visit that has waited more than 24 hours
    await page.goto('/admin#providers')
    await loaded(page, 'נותני שירות')
    const tile = page.getByRole('article').filter({ hasText: PEOPLE.john.name })
    await expect(tile.locator('dt:has-text("ממתינות בטלפון") + dd')).toHaveText(`3, מאז ${formatDateTime(oldest)}`)
    await expect(tile.locator('dt:has-text("ממתינות בטלפון") + dd')).toHaveText(/^3, מאז \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
    await expect(tile.getByText('ממתינות מעל 24 שעות')).toBeVisible()
    await expect(tile.locator('dt:has-text("מכשירים מחוברים") + dd')).toHaveText('2')
    expect(await noHorizontalScroll(page), 'the card at phone width').toBe(true)

    // the dialog: both phones, the one that reported with everything it said, the other as "not reporting"; never the label
    await chooseFromMenu(tile, 'מכשירים')
    const dialog = page.getByRole('dialog', { name: `מכשירים: ${PEOPLE.john.name}` })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(2)
    const DATE_TIME = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/
    const fact = (row, label) => row.locator(`dt:has-text("${label}") + dd`)
    const reported = dialog.getByRole('listitem').filter({ hasText: 'abcdef1' })
    await expect(reported).toHaveCount(1)
    await expect(fact(reported, 'ממתינות בטלפון')).toHaveText(`3, מאז ${formatDateTime(oldest)}`)
    await expect(fact(reported, 'לא נקלטו')).toContainText('2')
    await expect(fact(reported, 'נזרקו כי התור התמלא')).toContainText('1')
    await expect(fact(reported, 'דיווח אחרון')).toHaveText(DATE_TIME)
    await expect(fact(reported, 'העלאה אחרונה מהתור')).toHaveText(DATE_TIME)
    await expect(fact(reported, 'קשר אחרון עם השרת')).toContainText('מדויק עד כ-5 דקות')
    await expect(fact(reported, 'התחברות')).toHaveText(DATE_TIME)
    const silent = dialog.getByRole('listitem').filter({ hasText: 'לא מדווח' })
    await expect(silent).toHaveCount(1)
    await expect(fact(silent, 'ממתינות בטלפון')).toHaveText('-')
    await expect(fact(silent, 'גרסה')).toHaveText('לא ידועה')
    await expect(dialog.locator('li')).toHaveCount(2)
    await expect(page.locator('body')).not.toContainText(LABEL)

    // it fits on a phone and on a computer, and the way to sign everyone out stays on the screen at the bottom
    const fits = async (where) => {
      const view = page.viewportSize()
      const box = await dialog.boundingBox()
      expect(box.x, `${where}: the dialog starts inside the screen`).toBeGreaterThanOrEqual(-0.5)
      expect(box.x + box.width, `${where}: the dialog ends inside the screen`).toBeLessThanOrEqual(view.width + 0.5)
      expect(await noHorizontalScroll(page), `${where}: no sideways scroll`).toBe(true)
      const sticking = await dialog.evaluate((el) => {
        const edge = el.getBoundingClientRect()
        return [...el.querySelectorAll('*')].filter((c) => {
          const r = c.getBoundingClientRect()
          return r.width > 0 && (r.right > edge.right + 1 || r.left < edge.left - 1)
        }).length
      })
      expect(sticking, `${where}: nothing sticks out of the dialog`).toBe(0)
      await expect(dialog.getByRole('button', { name: 'ניתוק כל המכשירים' }), `${where}: the sign-out of all phones is in view`).toBeInViewport()
    }
    await fits('phone')
    await page.setViewportSize(COMPUTER)
    await fits('computer')
    expect((await dialog.boundingBox()).width, 'on a computer the dialog is a window, not the width of the screen').toBeLessThan(COMPUTER.width / 2)

    // signing everyone out from the dialog: the question first (saying no keeps everything), then it is done and the card shows it
    await dialog.getByRole('button', { name: 'ניתוק כל המכשירים' }).click()
    const question = page.getByRole('dialog', { name: 'לנתק את כל המכשירים?' })
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'ביטול' }).click()
    await expect(question).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'ניתוק כל המכשירים' }).click()
    await question.getByRole('button', { name: 'ניתוק', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'המכשירים נותקו' })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(moreButton(tile), 'the dialog that was opened from the menu gave the focus back to its button').toBeFocused()
    const menu = await openTileMenu(tile)
    await expect(menu.getByRole('menuitem', { name: 'מכשירים', exact: true }), 'no phone is signed in: the menu has no phones action').toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'סיסמה חדשה', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tile.getByText('ממתינות בטלפון')).toHaveCount(0)
    await expect(tile.getByText('ממתינות מעל 24 שעות')).toHaveCount(0)
    // and the phone really is signed out: the server refuses its next report
    expect((await phone.post('/api/my/device-status', { headers: reporting, data: {} })).status()).toBe(401)
  } finally {
    await page.request.post(`/api/admin/providers/${john.id}/revoke-devices`, { data: {} }) // in case the test stopped before that
    await phone.dispose()
  }
})

// ---- the visits that the server did not count ------------------------------------------------------------------------

test('History lists the visits that were not counted, with no action on them, on a phone and on a computer', async ({ page, playwright }) => {
  await adminSignIn(page)
  // One visit that is refused online, through the real route, so that the list has a row that came the way a person's visit
  // does. The seed (scripts/dev-seed.mjs) has the others: from a phone's queue, a person who is not assigned, a code of no point.
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    const refused = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: POINTS.switchedOff, gps: null } })
    expect((await refused.json()).error.code).toBe(SCAN_ERROR_POINT_INACTIVE)
  } finally {
    await phone.dispose()
  }

  // a row of the list, by what it says (the reasons and the two sources are the words of the screen)
  const rows = page.getByRole('listitem').filter({ hasText: /מהתור בטלפון|בזמן אמת/ })
  const withReason = (reason) => rows.filter({ hasText: reason })
  const stamp = /נסרק בטלפון: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/

  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    // from another tab, so that History opens with its own filters again (the same address would keep the ones of the last round)
    await page.goto('/admin#points')
    await loaded(page, 'נקודות סריקה')
    await page.goto('/admin#history')
    await loaded(page, 'היסטוריית נוכחות')
    // (on a phone the filters are in a sheet: changeFilters opens it, and presses "show results" after the change)
    await changeFilters(page, (filters) => filters.getByLabel('סוג').selectOption({ label: 'לא נקלטו' }))

    // the visit from the queue: when the phone scanned it, next to the time of the server
    const queued = withReason('נקודה כבויה').filter({ hasText: 'מהתור בטלפון' }).first()
    await expect(queued).toBeVisible()
    await expect(queued).toContainText('נקודה ישנה')
    await expect(queued).toContainText(PEOPLE.ploni.name)
    await expect(queued).toContainText(stamp)
    // the visit that came online, a moment ago
    const online = withReason('נקודה כבויה').filter({ hasText: 'בזמן אמת' }).first()
    await expect(online).toBeVisible()
    await expect(online).toContainText(PEOPLE.ploni.name)
    // the other reasons of the seed: a person who is not assigned, and a code that names no point
    await expect(withReason('לא משויך לנקודה').first()).toContainText('גימבורי')
    await expect(withReason('נתונים לא תקינים').first()).toContainText('קוד לא מוכר') // no point: its name is "unknown code"
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /^\d{2}\/\d{2}\/\d{4} · \d+$/ }).first()).toBeVisible()

    // read only: no action on any row, no file, and none of the filters that are about scans
    for (const row of await rows.all()) await expect(row.getByRole('button'), `${where}: an action on a row`).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'ייצוא ל-Excel' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ייצוא ל-Excel' })).toHaveCount(0)
    await changeFilters(page, async (filters) => { // on a phone the sheet opens for this, and its controls are looked at
      await expect(filters.getByLabel('כולל מבוטלות')).toHaveCount(0)
      await expect(filters.getByLabel('כולל חשבון דמו')).toHaveCount(0)
    })
    expect(await noHorizontalScroll(page), `the list of visits not counted at ${where} width`).toBe(true)

    // the point filter applies: only the point that was switched off is left
    await changeFilters(page, (filters) => filters.getByLabel('נקודה').selectOption({ label: 'נקודה ישנה' }))
    await expect(withReason('לא משויך לנקודה')).toHaveCount(0)
    await expect(withReason('נקודה כבויה').first()).toBeVisible()
    await changeFilters(page, (filters) => filters.getByLabel('נקודה').selectOption({ label: 'כל הנקודות' }))
    await expect(withReason('לא משויך לנקודה').first()).toBeVisible()

    // a stretch of time with none of them: the empty state, and the filter can go back to the scans (and their file)
    await changeFilters(page, async (filters) => {
      await setDate(filters, 'מתאריך', '01/01/2020') // on a phone, with the wheels
      await setDate(filters, 'עד תאריך', '02/01/2020')
    })
    await expect(page.getByRole('heading', { level: 2, name: 'אין ביקורים שלא נקלטו בטווח הזה' })).toBeVisible()
    await changeFilters(page, (filters) => filters.getByLabel('סוג').selectOption({ label: 'נוכחויות שנרשמו' }))
    await expect(page.getByRole('link', { name: 'ייצוא ל-Excel' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'אין נוכחויות בטווח הזה' })).toBeVisible()
  }
})

test('a provider, a committee member and an agent key can each be deleted from their tile, after a confirmation', async ({ page, playwright }) => {
  await adminSignIn(page)
  const tag = randomUUID().slice(0, 6)
  const post = async (url, data) => (await page.request.post(url, { data })).json()
  const password = `pw-${tag}-1234`
  const provider = (await post('/api/admin/providers', { company: `חברה ${tag}`, contact_name: `עובד ${tag}`, password })).provider
  await post('/api/admin/admins', { email: `gone-${tag}@example.test`, name: `חבר ${tag}` })
  await post('/api/admin/api-keys', { name: `מפתח ${tag}` })

  // the provider has one visit on record
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  const session = await (await phone.post('/api/session', { data: { provider_id: provider.id, password } })).json()
  const visit = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: POINTS.basement, gps: null } })
  expect((await visit.json()).scan.outcome).toBe('accepted')
  await phone.dispose()

  const deleteFrom = async (tab, title, tile, button, confirmLabel, mentions) => {
    await page.goto(`/admin#${tab}`)
    await loaded(page, title)
    await chooseFromMenu(tile, button)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(mentions)
    await dialog.getByRole('button', { name: confirmLabel }).click()
    await expect(tile).toHaveCount(0)
  }

  await deleteFrom('providers', 'נותני שירות', page.getByRole('article').filter({ hasText: `עובד ${tag}` }),
    'מחיקת נותן השירות', 'מחיקת נותן השירות', 'בהיסטוריה, תחת השם הזה')
  await deleteFrom('settings', 'הגדרות', page.getByRole('article').filter({ hasText: `חבר ${tag}` }),
    'מחיקת מנהל המערכת', 'מחיקת מנהל המערכת', 'אפשר להוסיף את אותה כתובת שוב')
  await deleteFrom('agent', 'גישה לאייג\'נט', page.getByRole('article').filter({ hasText: `מפתח ${tag}` }),
    'מחיקת המפתח', 'מחיקת המפתח', 'נמחק מהרשימה לצמיתות')

  // the provider's visit is still in the history, under their name
  await page.goto('/admin#history')
  await loaded(page, 'היסטוריית נוכחות')
  await expect(page.getByRole('listitem').filter({ hasText: `עובד ${tag}` })).toHaveCount(1)
  // and the deleted provider is gone from the sign-in list of the provider app
  const list = (await (await page.request.get('/api/public/providers')).json()).providers
  expect(list.find((p) => p.id === provider.id)).toBeUndefined()
})

test('the provider form and card have no language: each person chooses theirs on their own phone', async ({ page }) => {
  await adminSignIn(page)
  await page.goto('/admin#providers')
  await loaded(page, 'נותני שירות')
  // no language label on any card
  for (const label of ['עברית', 'English', 'Русский', 'العربية']) {
    await expect(page.getByRole('article').getByText(label, { exact: true }), `a card shows the language ${label}`).toHaveCount(0)
  }
  // and none to pick in the form, for a new provider or for an existing one
  await page.getByRole('button', { name: 'נותן שירות חדש' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('סוג שירות')).toBeVisible()
  await expect(dialog.getByText('שפת הממשק')).toHaveCount(0)
  await expect(dialog.getByRole('option', { name: 'Русский' })).toHaveCount(0)
})

// F4 (docs/design.md): typed input is never lost. A tap beside a dialog or an Esc by accident must not throw away a form that was
// filled in; a form that holds nothing new still closes at once, and the question is answered by Esc too ("keep editing").
test('a form that was filled in asks before a tap outside or Esc closes it, and an untouched one closes at once, on a phone and on a computer', async ({ page }) => {
  const writes = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/admin/points')) writes.push(request.url())
  })
  await adminSignIn(page, 'points')
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const form = page.getByRole('dialog', { name: 'נקודה חדשה' })
    const question = page.getByRole('dialog', { name: 'לסגור בלי לשמור?' })
    const name = form.getByLabel('שם הנקודה')

    await page.getByRole('button', { name: 'נקודה חדשה' }).click()
    await expect(form).toBeVisible()
    await page.keyboard.press('Escape') // nothing typed yet: it closes at once
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'נקודה חדשה' }).click()
    await name.fill('חדר אשפה')
    await page.mouse.click(4, 4) // a tap outside the dialog, on the dimmed page
    await expect(question).toBeVisible()
    await expect(question.getByRole('button', { name: 'חזרה לעריכה' })).toBeFocused() // the safe answer is the one in reach
    await expect(page.locator('[inert]')).toHaveCount(1) // the form under the question cannot be reached, by a screen reader either
    await question.getByRole('button', { name: 'חזרה לעריכה' }).click()
    await expect(question).toHaveCount(0)
    await expect(page.locator('[inert]')).toHaveCount(0)
    await expect(name).toHaveValue('חדר אשפה')
    await expect(name).toBeFocused() // and the cursor is where it was

    await page.keyboard.press('Escape')
    await expect(question).toBeVisible()
    await page.keyboard.press('Escape') // Esc on the question is "keep editing": it does not reach the form under it
    await expect(question).toHaveCount(0)
    await expect(name).toHaveValue('חדר אשפה')

    await page.keyboard.press('Escape')
    await question.getByRole('button', { name: 'סגירה בלי לשמור' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect(writes, 'nothing was saved').toEqual([])
})

// ---- dates and times: DD/MM/YYYY and HH:MM everywhere ---------------------------------------------------------------

test.describe('dates on the committee screens', () => {
  // An English device: the browser's own date field would show month first here. Ours reads DD/MM/YYYY anyway.
  test.use({ locale: 'en-US' })

  const DAY = /^\d{2}\/\d{2}\/\d{4}$/
  const DAY_TIME = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/
  // what must never be on a screen: a day with a month name ("1 באוק׳", not a word that happens to contain one), a weekday,
  // an ISO date, a 12-hour clock
  const OTHER_FORMATS = /\d{1,2}\s*ב?(ינו|פבר|מרץ|אפר|מאי|יוני|יולי|אוג|ספט|אוק|נוב|דצמ)|יום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)|\d{4}-\d{2}-\d{2}|\b[AP]M\b|\d{2}:\d{2}:\d{2}|\b24:\d{2}|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,? \d|\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i

  test('every date and time is DD/MM/YYYY and HH:MM, and the date fields read the same on an English device', async ({ page, playwright }) => {
    await adminSignIn(page)
    const tag = randomUUID().slice(0, 6)
    const key = (await (await page.request.post('/api/admin/api-keys', { data: { name: `מפתח ${tag}` } })).json()).api_key
    // Ploni makes a visit, so there is a "last visit" for him and a row in the history
    const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
    try {
      const providers = (await (await phone.get('/api/public/providers')).json()).providers
      const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
      const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
      const visit = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: POINTS.basement, gps: null } })
      expect((await visit.json()).scan.outcome).toBe('accepted')

      const noOtherFormat = async (what) => {
        const text = await page.getByRole('main').innerText()
        expect(text, `${what}: another way of writing a date`).not.toMatch(OTHER_FORMATS)
      }

      // providers: the last visit
      await page.goto('/admin#providers')
      await loaded(page, 'נותני שירות')
      const ploniCard = page.getByRole('article').filter({ hasText: PEOPLE.ploni.name })
      await expect(ploniCard.locator('dd').nth(0)).toHaveText(DAY_TIME) // "last visit"
      await noOtherFormat('providers')

      // settings: the last sign-in of the member who is signed in now
      await page.goto('/admin#settings')
      await loaded(page, 'הגדרות')
      await expect(page.getByRole('article').filter({ hasText: '(אתם)' }).locator('dd').first()).toHaveText(DAY_TIME) // the member who is signed in
      await noOtherFormat('settings')

      // agent keys: created
      await page.goto('/admin#agent')
      await loaded(page, "גישה לאייג'נט")
      const keyCard = page.getByRole('article').filter({ hasText: `מפתח ${tag}` })
      await expect(keyCard.locator('dd').nth(1)).toHaveText(DAY_TIME) // "created"
      await noOtherFormat('agent keys')

      // history, on a phone, a tablet and a computer: the two date fields, the heading of the day, the time of the visit, and the
      // confirmation. The date fields are above the list on a computer and in the sheet that the filter button opens below 1024 px, so there
      // the sheet is opened to look at them and closed again before the rows are touched (it covers them). On a phone (below 640 px) each
      // date is a button that shows it and opens the wheels; from 640 px it is a field that takes typing.
      for (const size of [null, TABLET, COMPUTER]) {
        if (size) await page.setViewportSize(size)
        const phoneLayout = isPhoneLayout(page)
        await page.goto('/admin#agent') // from another tab, so that History opens with its own filters again
        await loaded(page, "גישה לאייג'נט")
        await page.goto('/admin#history')
        await loaded(page, 'היסטוריית נוכחות')
        let sheet = phoneLayout ? await openFilters(page) : null
        let from = (sheet ?? page).getByLabel('מתאריך')
        let to = (sheet ?? page).getByLabel('עד תאריך')
        await expectDate(from, DAY)
        await expectDate(to, DAY)
        await sheet?.getByRole('button', { name: 'סגירה' }).click()
        await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ }).first()).toHaveText(/^\d{2}\/\d{2}\/\d{4} · \d+$/)
        const row = page.getByRole('listitem').filter({ hasText: 'מינוס 1' }).first()
        await expect(row).toContainText(/\b\d{2}:\d{2}\b/)
        await chooseFromMenu(row, 'מחיקת הנוכחות לצמיתות')
        await expect(page.getByRole('dialog')).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
        await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click() // close without deleting
        await noOtherFormat('history')

        // a date that is half typed: the list does not follow it and the export waits (it would use the last good range, and
        // the file would not match what the field says). Both are back when the date is finished. In the sheet nothing follows the field
        // at all: "show results" is what applies, and with a date that is not finished it applies nothing, says so under the field and
        // keeps the sheet open on it. A phone has no field to type in: the wheels give whole dates only.
        if (hasDateWheels(page)) continue
        sheet = phoneLayout ? await openFilters(page) : null
        from = (sheet ?? page).getByLabel('מתאריך')
        to = (sheet ?? page).getByLabel('עד תאריך')
        const original = await from.inputValue()
        const listed = await page.getByRole('listitem').count()
        await from.press('End')
        for (let i = 0; i < 6; i++) await from.press('Backspace')
        await expect(from).toHaveValue(/^\d{2}$/)
        if (sheet) {
          await sheet.getByRole('button', { name: 'הצגת תוצאות' }).click()
          await expect(sheet.getByRole('alert')).toContainText('התאריך לא תקין')
          await expect(from).toBeFocused()
          await expect(page.getByRole('link', { name: 'ייצוא ל-Excel' })).toBeVisible() // the file is still the applied range
        } else {
          await expect(page.getByRole('button', { name: 'ייצוא ל-Excel' })).toBeDisabled()
          await expect(page.getByRole('link', { name: 'ייצוא ל-Excel' })).toHaveCount(0)
        }
        await page.waitForTimeout(600) // longer than the pause before a query: the list must not have followed half a date
        expect(await page.getByRole('listitem').count()).toBe(listed)
        await from.pressSequentially(original.replace(/\D/g, '').slice(2))
        await expect(from).toHaveValue(original)
        await expect(page.getByRole('link', { name: 'ייצוא ל-Excel' })).toBeVisible()

        // typing a whole date: the slashes come by themselves
        await from.fill('')
        await from.pressSequentially('01012026')
        await expect(from).toHaveValue('01/01/2026')
        // deleting a slash deletes the digit before it, and the cursor stays by it
        await from.fill('')
        await from.pressSequentially('01102026')
        await from.press('Home')
        for (let i = 0; i < 3; i++) await from.press('ArrowRight')
        await from.press('Backspace')
        await expect(from).toHaveValue('01/02/026')
        expect(await from.evaluate((el) => el.selectionStart)).toBe(1)
        await from.fill('')
        await from.pressSequentially('01012026')
        await to.fill('')
        await to.pressSequentially('3102')
        await expect(to).toHaveValue('31/02')
        await to.pressSequentially('2026')
        await expect(to).toHaveValue('31/02/2026')
        await expect(to).toHaveAttribute('aria-invalid', 'true') // there is no 31 February
        await to.fill('')
        await to.pressSequentially('15112026')
        await expect(to).toHaveValue('15/11/2026')
        await expect(to).not.toHaveAttribute('aria-invalid', 'true')
        await sheet?.getByRole('button', { name: 'סגירה' }).click() // the filters that were typed are not applied
      }
    } finally {
      await phone.dispose()
      await page.request.delete(`/api/admin/api-keys/${key.id}`)
    }
  })

  test('the committee file has DD/MM/YYYY dates, with the exact moment in UTC beside the building time', async ({ page, playwright }) => {
    await adminSignIn(page)
    // a visit to export: every test starts with an empty history
    const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
    try {
      const providers = (await (await phone.get('/api/public/providers')).json()).providers
      const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
      const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
      const visit = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: POINTS.basement, gps: null } })
      expect((await visit.json()).scan.outcome).toBe('accepted')
    } finally {
      await phone.dispose()
    }
    const csv = await (await page.request.get('/api/admin/scans?format=csv&outcome=all&include_voided=true')).text()
    const lines = csv.replace('\ufeff', '').trim().split('\r\n')
    expect(lines.length, 'a header and at least the visit').toBeGreaterThan(1)
    expect(lines[0].split(',').slice(0, 4)).toEqual(['id', 'checked_in_utc', 'checked_in_local', 'local_date'])
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/,\d{2}\/\d{2}\/\d{4} \d{2}:\d{2},\d{2}\/\d{2}\/\d{4} \d{2}:\d{2},\d{2}\/\d{2}\/\d{4},/)
    }
  })
})

// ---- the audit log -------------------------------------------------------------------------------------------------
// A screen of its own, "יומן פעולות" (under "עוד" on a phone). It used to be a section at the foot of the Committee screen that a button
// opened. Read only, so there are no row actions to measure: the order of the actions of every tile is still measured by the test above,
// for the five screens that have tiles.

test('the audit log is a screen: it lists what was done and by whom, filters, and has no actions, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  const tag = randomUUID().slice(0, 6)
  const name = `נקודת יומן ${tag}`
  const me = (await (await page.request.get('/api/admin/me')).json()).admin
  // A throwaway point that is created, switched off and on again: three entries of the committee's own, with the point's name.
  const created = await page.request.post('/api/admin/points', { data: { name, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })
  const point = (await created.json()).point
  try {
    expect((await page.request.patch(`/api/admin/points/${point.id}`, { data: { is_active: false } })).ok()).toBe(true)
    expect((await page.request.patch(`/api/admin/points/${point.id}`, { data: { is_active: true } })).ok()).toBe(true)

    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      // from another screen, so that the log opens with its own filters again (the same address would keep the ones of the last round)
      await page.goto('/admin#points')
      await loaded(page, 'נקודות סריקה')
      await openScreen(page, 'audit')
      await loaded(page, 'יומן פעולות')
      await expect(page).toHaveURL(/#audit$/)

      // no button to open it, no section: the log is the screen
      const log = page.getByRole('main')
      await expect(log.locator('[aria-expanded]')).toHaveCount(0)
      const rowsOfPoint = log.getByRole('listitem').filter({ hasText: name })
      await expect(rowsOfPoint).toHaveCount(3) // created, switched off, switched on
      // what the actions were, in words: the switch off and the switch on say from what to what
      await expect(rowsOfPoint.filter({ hasText: 'יצירת נקודה' })).toHaveCount(1)
      await expect(rowsOfPoint.filter({ hasText: 'עדכון נקודה' }).filter({ hasText: 'פעיל: כן ← לא' })).toHaveCount(1)
      await expect(rowsOfPoint.filter({ hasText: 'עדכון נקודה' }).filter({ hasText: 'פעיל: לא ← כן' })).toHaveCount(1)
      // by whom: the signed-in member, and the time of the building
      for (const row of await rowsOfPoint.all()) {
        await expect(row).toContainText(`על ידי ${me.name}`)
        await expect(row).toContainText(/\d{2}:\d{2}/)
      }
      // the days are <h2>, under the <h1> of the screen
      await expect(log.getByRole('heading', { level: 2 }).filter({ hasText: /^\d{2}\/\d{2}\/\d{4} · \d+$/ }).first()).toBeVisible()

      // read only: no action on any row, and no file
      for (const row of await log.getByRole('listitem').all()) {
        await expect(row.getByRole('button'), `${where}: an action on a row`).toHaveCount(0)
        await expect(row.getByRole('link'), `${where}: a link on a row`).toHaveCount(0)
      }
      await expect(log.getByRole('link', { name: /ייצוא/ })).toHaveCount(0)
      await expect(log.getByRole('button', { name: /ייצוא/ })).toHaveCount(0)

      // the group: the entries of another group leave, and come back with their own
      // (on a phone the controls are in a sheet that opens for each change; on a computer they are in the section, as they were)
      await changeFilters(page, (filters) => filters.getByLabel('סוג פעולה').selectOption({ label: 'נותני שירות' }), log)
      await expect(rowsOfPoint).toHaveCount(0)
      await changeFilters(page, (filters) => filters.getByLabel('סוג פעולה').selectOption({ label: 'נקודות' }), log)
      await expect(rowsOfPoint).toHaveCount(3)
      // the member: the entries of the signed-in member are these
      await changeFilters(page, (filters) => filters.getByLabel('מנהל מערכת').selectOption({ label: me.name }), log)
      await expect(rowsOfPoint).toHaveCount(3)
      await changeFilters(page, (filters) => filters.getByLabel('מנהל מערכת').selectOption({ label: 'כל המנהלים' }), log)

      // a stretch of time in which nothing was done: its own empty state
      await changeFilters(page, async (filters) => {
        await setDate(filters, 'מתאריך', '01/01/2020') // on a phone, with the wheels
        await setDate(filters, 'עד תאריך', '02/01/2020')
      }, log)
      await expect(page.getByRole('heading', { level: 2, name: 'אין פעולות בטווח הזה' })).toBeVisible()
      expect(await noHorizontalScroll(page), `the audit log at ${where} width`).toBe(true)
    }
  } finally {
    await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
  }
})

// ---- the help ------------------------------------------------------------------------------------------------------------
// A short guide, a screen of its own, "איך עובדים עם המערכת" (src/admin/views/HelpView.jsx; under "עוד" on a phone). It used to be a
// section of the Committee screen that a button opened. It is text only, so there is nothing to measure but that every topic is
// there at once, that nothing can be pressed in it, and that it fits the width.

const HELP = 'איך עובדים עם המערכת'
const HELP_TOPICS = [
  'מסך הבית', 'נקודות ושלטי QR', 'נותני שירות והטלפונים שלהם', "היסטוריה ו'לא נקלטו'", "האייג'נט", 'יומן הפעולות', 'כשמגיעה התראה', 'כשטלפון תקוע',
]

test('the help is a screen of its own with every topic on it, nothing to press, and fits the width, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await openScreen(page, 'help')
    await loaded(page, HELP)
    await expect(page).toHaveURL(/#help$/)
    const main = page.getByRole('main')

    // every topic is there at once, as an <h2> under the <h1>, with its sentences
    const topics = main.getByRole('heading', { level: 2 })
    await expect(topics).toHaveText(HELP_TOPICS)
    for (const title of HELP_TOPICS) await expect(main.getByRole('heading', { level: 2, name: title, exact: true }), `${where}: ${title}`).toBeVisible()
    await expect(main.locator('p')).toHaveCount(HELP_TOPICS.length)
    for (const paragraph of await main.locator('p').all()) await expect(paragraph).not.toBeEmpty()

    // the cards: one column on a phone; on a computer two equal columns that each flow on their own (owner decision of 15/10/2026), in the order of
    // the page (the first half in the right column, then the second half in the left one, top to bottom), each card right under the one above it
    // with the gap of its column and no empty space under a short one, and the two columns start on the same line
    const cards = await topics.locator('xpath=..').evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect()
      const stack = getComputedStyle(el.parentElement).display === 'contents' ? el.parentElement.parentElement : el.parentElement // the one whose gap it is
      return { left: box.left, top: box.top, bottom: box.bottom, width: box.width, gap: parseFloat(getComputedStyle(stack).rowGap), shadow: getComputedStyle(el).boxShadow !== 'none' }
    }))
    expect(cards, `${where}: a card for every topic`).toHaveLength(HELP_TOPICS.length)
    expect(cards.every((card) => card.shadow), `${where}: every topic is a card`).toBe(true)
    const lefts = [...new Set(cards.map((card) => Math.round(card.left)))]
    expect(lefts, `${where}: the columns`).toHaveLength(size ? 2 : 1)
    for (const card of cards) expect(card.width, `${where}: the columns are equal`).toBeCloseTo(cards[0].width, 0)
    const reading = lefts.sort((a, b) => b - a).flatMap((left) => cards.filter((card) => Math.round(card.left) === left)) // right to left, each from the top
    expect(reading.map((card) => cards.indexOf(card)), `${where}: the reading order is the order of the page`).toEqual(cards.map((_, i) => i))
    for (const [i, card] of cards.entries()) {
      expect(card.gap, `${where}: a gap between the cards of a column`).toBeGreaterThan(0)
      const above = cards[i - 1]
      if (above && Math.round(above.left) === Math.round(card.left)) expect(card.top - above.bottom, `${where}: the gap under "${HELP_TOPICS[i - 1]}"`).toBeCloseTo(card.gap, 0)
    }
    const other = cards.find((card) => Math.round(card.left) !== Math.round(cards[0].left)) // the first card of the second column
    if (other) expect(Math.abs(cards[0].top - other.top), `${where}: the columns start on the same line`).toBeLessThan(1)

    // read only: nothing to press in it, and nothing that opens or closes
    await expect(main.getByRole('button')).toHaveCount(0)
    await expect(main.getByRole('link')).toHaveCount(0)
    await expect(main.locator('[aria-expanded]')).toHaveCount(0)

    // it fits: nothing of it is outside the screen, and the page does not scroll sideways
    const outside = await main.evaluate((root, width) => [...root.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && (r.left < -0.5 || r.right > width + 0.5)
    }).map((el) => el.tagName), page.viewportSize().width) // the width that was set, not innerWidth (as noHorizontalScroll)
    expect(outside, `${where}: elements of the help outside the screen`).toEqual([])
    expect(await noHorizontalScroll(page), `the help at ${where} width`).toBe(true)
    await page.goto('/admin#points') // the next round opens it again from another screen
    await loaded(page, 'נקודות סריקה')
  }
})

// ---- the sheet under "עוד" and the first screen --------------------------------------------------------------------------
// On a phone the tab bar has five buttons and the last, "עוד", opens a sheet with the other four screens: a real dialog (the Modal
// of every form of the app), so focus goes in, Esc and a tap outside close it, and the focus goes back to the button. The unit test
// (tests/components/admin-tab.test.jsx) proves the behaviour in jsdom; this proves it in the two real browsers.

test('the "עוד" sheet: opens, lists the four other screens, marks the current one, goes to a screen and closes, and Esc gives the focus back', async ({ page }) => {
  await adminSignIn(page)
  const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
  const more = bar.getByRole('button', { name: 'עוד', exact: true })
  const sheet = page.getByRole('dialog', { name: 'עוד', exact: true })
  const items = sheet.getByRole('navigation', { name: 'מסכים נוספים' }).getByRole('button')

  await expect(more).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more, 'on the history, "עוד" is not the current item').not.toHaveAttribute('aria-current', 'page')
  await more.click()
  await expect(sheet).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(sheet).toHaveAttribute('aria-modal', 'true')
  // each row is named by the screen's name and described by the line under it, so a button is still found by its name
  const rows = [['אייג׳נט', 'מפתחות לסוכן ה-AI של הוועד'], ['הגדרות', 'מנהלי המערכת ופרטי הבניין'], ['יומן פעולות', 'מי שינה מה ומתי'], ['איך עובדים עם המערכת', 'מדריך קצר']]
  await expect(items).toHaveCount(rows.length)
  for (const [index, [name, line]] of rows.entries()) {
    await expect(items.nth(index)).toHaveAccessibleName(name)
    await expect(items.nth(index)).toHaveAccessibleDescription(line)
    await expect(items.nth(index)).toContainText(line) // and the line is drawn
  }
  // each item has its icon (and a chevron) and a target of 44 px or more, and the sheet is at the bottom of the screen
  for (const item of await items.all()) {
    await expect(item.locator('svg')).toHaveCount(2)
    expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
  const [sheetBox, view] = [await sheet.boundingBox(), page.viewportSize()]
  expect(sheetBox.y + sheetBox.height, 'the sheet sits on the bottom edge of the screen').toBeGreaterThanOrEqual(view.height - 1)
  expect(await noHorizontalScroll(page), 'the sheet does not make the page scroll sideways').toBe(true)
  // the focus is inside, and Tab keeps it there
  await expect(sheet.locator(':focus')).toHaveCount(1)
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    await expect(sheet.locator(':focus'), 'the focus stays in the sheet after Tab').toHaveCount(1)
  }

  // Esc closes it and the focus goes back to the button that opened it
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  // a tap outside closes it too
  await more.click()
  await expect(sheet).toBeVisible()
  await page.mouse.click(view.width / 2, 4) // on the dimmed page above the sheet
  await expect(sheet).toHaveCount(0)
  await expect(more).toBeFocused()

  // choosing a screen goes there, closes the sheet, makes "עוד" the current item, and marks the screen in the sheet next time
  await more.click()
  await items.filter({ hasText: 'הגדרות' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'הגדרות', exact: true })).toBeVisible()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/#settings$/)
  await expect(more).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('main'), 'the focus moved to the content, as for any change of screen').toBeFocused()
  expect(await page.title()).toMatch(/^הגדרות · /)
  await more.click()
  await expect(sheet.locator('[aria-current="page"]')).toHaveText([/^הגדרות/])
  await expect(items.filter({ hasText: 'אייג׳נט' })).not.toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()

  // a screen of the bar: "עוד" is not the current item any more
  await bar.getByRole('button', { name: SCREEN_NAV.points, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
  await expect(more).not.toHaveAttribute('aria-current', 'page')
})

test('each screen under "עוד" opens from the sheet with its title and its address, and the sheet is readable in the dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await adminSignIn(page)
  for (const [key, label] of [['agent', 'אייג׳נט'], ['settings', 'הגדרות'], ['audit', 'יומן פעולות'], ['help', 'איך עובדים עם המערכת']]) {
    await page.goto('/admin#points')
    await loaded(page, 'נקודות סריקה')
    await openScreen(page, key)
    await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES[key], exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#${key}$`))
    expect(await page.title(), `${key}: the title of the window`).toMatch(new RegExp(`^${label} · `))
  }
  // the sheet is readable in the dark theme: the text is not the colour of the sheet
  await page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'עוד', exact: true })
  const colours = await sheet.evaluate((el) => {
    const item = el.querySelector('.a-more__row:not([aria-current])')
    return { sheet: getComputedStyle(el).backgroundColor, text: getComputedStyle(item).color }
  })
  expect(colours.text).not.toBe(colours.sheet)
})

// The old address of the screen that held the members, the building, the guide and the audit log.
test('the old address #committee lands on the settings, and an address that is no screen lands on Home', async ({ page }) => {
  await adminSignIn(page, 'settings')
  await page.goto('/admin#history')
  await loaded(page, 'היסטוריית נוכחות')
  await page.goto('/admin#committee')
  await loaded(page, 'הגדרות')
  await expect(page.getByLabel('כתובת הבניין', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goto('/admin#nowhere')
  await loaded(page, SCREEN_TITLES.home)
})

// A new installation has no points: the history says to start with the points instead of "widen the dates".
test('the history of a building with no points says to add points, with a button to the Points screen', async ({ page }) => {
  await page.route('**/api/admin/points', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { points: [] } })
    return route.continue()
  })
  await adminSignIn(page)
  await expect(page.getByRole('heading', { level: 2, name: 'עוד אין נקודות' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'אין נוכחויות בטווח הזה' })).toHaveCount(0)
  await page.getByRole('button', { name: 'מעבר לנקודות' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
  await expect(page).toHaveURL(/#points$/)
})

// ---- the Home screen ------------------------------------------------------------------------------------------------------------
// What Home shows and where each of its links goes is in tests/components/home.test.jsx, with the network answered by the test. These run in
// real browsers, on a phone and on a computer, and where it matters with real visits through the real server.

const HOME_TITLE = 'השבוע בבניין'
const HOME_PROVIDERS_TITLE = 'נותני שירות השבוע'
/** The summary card, the table of its bars (named by the range), and the section of the providers. */
const homeCard = (page) => page.getByRole('region', { name: HOME_TITLE })
const homeTable = (page) => homeCard(page).getByRole('table')
const homeProviders = (page) => page.getByRole('region', { name: HOME_PROVIDERS_TITLE })
/** The row of one provider (by a word of its name): a list item with one link. */
const homeRow = (page, name) => homeProviders(page).getByRole('listitem').filter({ hasText: name })
/** The bar of a day that has visits: a link named by its full date and its count. */
const homeBar = (page, day) => homeTable(page).getByRole('link', { name: new RegExp(`^${formatDay(day)}:`) })
const historyRows = (page) => page.getByRole('main').getByRole('listitem')
const box = async (locator) => {
  const found = await locator.boundingBox()
  expect(found, 'the element has a box').not.toBeNull()
  return found
}

test('the app opens on Home when the address names no screen, greets the member with the date, and keeps Home through a reload and Back', async ({ page }) => {
  await adminSignIn(page, 'home')
  await expect(page).toHaveURL(/\/admin$/)
  // the sample member is "Dev Admin": the greeting is by the hour of the building, and the first word of the name
  const greeting = page.getByRole('heading', { level: 1, name: /^(בוקר טוב|צהריים טובים|ערב טוב), Dev$/ })
  await expect(greeting).toBeVisible()
  await expect(page.getByRole('main').getByText(/^\d{2}\/\d{2}\/\d{4}$/).first(), 'the date of the day, under the greeting').toBeVisible()
  await expect(homeTable(page)).toBeVisible()
  await expect(page).toHaveTitle(/^בית · /)
  const nav = page.getByRole('navigation', { name: isPhoneLayout(page) ? 'ניווט ראשי (טלפון)' : 'ניווט ראשי', exact: true })
  await expect(nav.getByRole('button', { name: 'בית', exact: true })).toHaveAttribute('aria-current', 'page')

  await page.reload() // a reload on Home is Home again
  await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES.home })).toBeVisible()
  await expect(homeTable(page)).toBeVisible()

  await page.goto('/admin#history') // an address that names a screen still opens it (a bookmark of History keeps working)
  await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
  await page.goBack() // and Back is Home
  await expect(page.getByRole('heading', { level: 1, name: SCREEN_TITLES.home })).toBeVisible()
  await expect(homeTable(page)).toBeVisible()
})

test('the summary card of Home draws its bars from the right (the oldest day) to the left (today), each under its date, with targets that are big enough and no sideways scroll, on a phone and on a computer', async ({ page }) => {
  await page.clock.setFixedTime(new Date(HOME_NOW)) // the last day of the stub is today, so that its head and its bar are the ones that say so
  await stubHome(page)
  await adminSignIn(page, 'home')
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await expect(homeTable(page)).toBeVisible()

    // The range stands right above the bars in full, the element just before the table with nothing between them, and is the name of the table;
    // each head writes DD/MM and is named by the full date (the exception of AGENTS.md: both conditions are in the page).
    const range = `${formatDay(HOME_DAYS[0])} עד ${formatDay(HOME_DAYS.at(-1))}`
    await expect(homeTable(page), `${where}: the table is named by its range`).toHaveAccessibleName(range)
    const written = homeCard(page).getByText(range, { exact: true })
    await expect(written, `${where}: the range is written, in DD/MM/YYYY`).toBeVisible()
    const dayHeads = HOME_DAYS.map((day) => formatDay(day)) // the name of a head is its full date, for a screen reader
    for (const day of HOME_DAYS) await expect(homeTable(page).getByText(`${day.slice(8)}/${day.slice(5, 7)}`, { exact: true }), `${where}: the head writes DD/MM`).toBeVisible()
    const heads = await Promise.all(dayHeads.map((name) => box(homeTable(page).getByRole('columnheader', { name, exact: true }))))
    for (let i = 1; i < heads.length; i++) {
      expect(heads[i - 1].x, `${where}: ${dayHeads[i - 1]} is to the right of ${dayHeads[i]}`).toBeGreaterThan(heads[i].x)
    }
    const writtenBox = await box(written)
    expect(writtenBox.y + writtenBox.height, `${where}: the range is above the heads`).toBeLessThanOrEqual(heads[0].y)
    expect(await written.evaluate((el) => el.nextElementSibling?.tagName), `${where}: the table is the next thing after the range`).toBe('TABLE')
    const tableBox = await box(homeTable(page))
    expect(tableBox.y - (writtenBox.y + writtenBox.height), `${where}: the range is right above the bars (no total between them)`).toBeGreaterThanOrEqual(0)
    expect(tableBox.y - (writtenBox.y + writtenBox.height), `${where}: and close to them`).toBeLessThanOrEqual(10)
    const totalBox = await box(homeCard(page).getByText(/^\d+ ביקור(ים)?$/))
    expect(totalBox.y + totalBox.height, `${where}: the total is above the range`).toBeLessThanOrEqual(writtenBox.y)
    await expect(homeTable(page).getByRole('columnheader', { name: dayHeads.at(-1), exact: true }), `${where}: today's head says so`).toHaveAttribute('aria-current', 'date')

    // The bars: one for each day (the stub has visits every day), each under its own head, which is under the bar (the heads are drawn last).
    const bars = await Promise.all(HOME_DAYS.map((day) => box(homeBar(page, day))))
    for (const [i, found] of bars.entries()) {
      expect(Math.abs(found.x + found.width / 2 - (heads[i].x + heads[i].width / 2)), `${where}: the bar of ${dayHeads[i]} is over its head`).toBeLessThanOrEqual(1)
      expect(found.y + found.height, `${where}: the bar of ${dayHeads[i]} ends where its head begins`).toBeLessThanOrEqual(heads[i].y + 1)
      expect(found.width, `${where}: the width of a bar`).toBeGreaterThanOrEqual(24)
      expect(found.height, `${where}: the height of a bar`).toBeGreaterThanOrEqual(44)
    }
    // the count is written in each bar: 4 6 6 7 10 15 2 (the totals of the stub)
    const totals = HOME_DAYS.map((_, i) => HOME_PROVIDERS.reduce((sum, p) => sum + p.counts[i], 0))
    for (const [i, day] of HOME_DAYS.entries()) await expect(homeBar(page, day), `${where}: the count of ${dayHeads[i]}`).toContainText(String(totals[i]))
    await expect(homeCard(page).getByText(`${totals.reduce((a, b) => a + b, 0)} ביקורים`, { exact: true }), `${where}: the total of the seven days`).toBeVisible()

    // Every provider is one row and one link, at least 44 high; so is every tile and every row of the short list.
    for (const p of HOME_PROVIDERS) {
      const row = homeRow(page, p.name)
      await expect(row.getByRole('link'), `${where}: the row of ${p.name} is one link`).toHaveCount(1)
      expect((await box(row.getByRole('link'))).height, `${where}: the row of ${p.name}`).toBeGreaterThanOrEqual(44)
    }
    // the four tiles (the stub has phones that wait, so the fourth is there) and the two rows: each is one link, and at least 44 high
    for (const label of [/נותני שירות פעילים/, /נקודות פעילות/, /ביקורים שלא נקלטו/, /טלפונים עם ביקורים/, /מנהלי המערכת/, /מפתחות אייג'נט פעילים/]) {
      expect((await box(page.getByRole('main').getByRole('link', { name: label }))).height, `${where}: the link ${label}`).toBeGreaterThanOrEqual(44)
    }

    // Nothing scrolls sideways, and nothing in the card is wider than the card.
    expect(await noHorizontalScroll(page), `${where}: the page`).toBe(true)
    const card = await box(homeCard(page))
    for (const found of [...heads, ...bars]) {
      expect(found.x, `${where}: inside the card, at the right`).toBeGreaterThanOrEqual(card.x - 1)
      expect(found.x + found.width, `${where}: inside the card, at the left`).toBeLessThanOrEqual(card.x + card.width + 1)
    }
  }
})

test('the focus ring of a bar of Home is the colour of the text on the card, the one that can be seen on it, in the light theme and the dark one', async ({ page }) => {
  await stubHome(page)
  await adminSignIn(page, 'home')
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    const bar = homeBar(page, HOME_DAYS[2])
    // The Tab key goes first, so that the focus that follows is a keyboard's and :focus-visible applies (WebKit's Tab key does not stop at
    // links, as Safari's does not, so the focus of the bar itself is given by the script).
    await page.keyboard.press('Tab')
    await bar.focus()
    await expect(bar).toBeFocused()
    expect(await bar.evaluate((el) => el.matches(':focus-visible')), `${scheme}: the ring is drawn for a keyboard`).toBe(true)
    const { ring, text, card } = await bar.evaluate((el) => {
      const hero = el.closest('section')
      return { ring: getComputedStyle(el).outlineColor, text: getComputedStyle(hero).color, card: getComputedStyle(hero).backgroundColor }
    })
    expect(ring, `${scheme}: the ring is the colour of the text on the card`).toBe(text)
    expect(ring, `${scheme}: and it is not the colour of the card (the light theme's --w-focus is, 1:1)`).not.toBe(card)
    expect(await bar.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  }
  await page.emulateMedia({ colorScheme: 'light' })
})

test('the window crossing 1024 px while on Home keeps the screen as it is: the same table, no loading state, no new request', async ({ page }) => {
  let requests = 0
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/admin/home') requests += 1 })
  await stubHome(page)
  await page.setViewportSize({ width: 800, height: 900 })
  await adminSignIn(page, 'home')
  await expect(homeTable(page)).toBeVisible()
  const table = await homeTable(page).elementHandle()
  const before = requests
  const loading = page.getByRole('status').filter({ hasText: 'טוען' })
  for (const width of [1280, 1024, 1023, 800, 1280, 360, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(homeTable(page)).toBeVisible()
    await expect(loading).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: width < 1024 ? 'ניווט ראשי (טלפון)' : 'ניווט ראשי', exact: true }).getByRole('button', { name: 'בית', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await noHorizontalScroll(page), `no sideways scroll at ${width}`).toBe(true)
    // the card and the providers: side by side from 1024 px, one under the other below it
    const [card, providers] = await Promise.all([box(homeCard(page)), box(homeProviders(page))])
    if (width >= 1024) expect(Math.abs(card.y - providers.y), `side by side at ${width}`).toBeLessThanOrEqual(1)
    else expect(providers.y, `one under the other at ${width}`).toBeGreaterThan(card.y + card.height)
  }
  expect(await table.evaluate((el) => el.isConnected), 'the table is the same element, not drawn again').toBe(true)
  expect(requests, 'no request for the numbers').toBe(before)
})

test('a bar of Home opens the History of exactly those visits, a provider opens its week, "לכל ההיסטוריה" opens everyone\'s, and Back returns to Home, on a phone and on a computer', async ({ page, playwright }) => {
  const tag = randomUUID().slice(0, 6)
  await adminSignIn(page)
  // two visits of Ploni today, at two throwaway points (a second visit at the same point would be in the cooldown), through the real server
  const points = []
  for (const n of [1, 2]) {
    const created = await page.request.post('/api/admin/points', { data: { name: `נקודת בית ${n} ${tag}`, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, gps_mode: 'none' } })
    points.push((await created.json()).point)
  }
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    for (const point of points) {
      const scan = await phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code: point.qr_token, gps: null } })
      expect((await scan.json()).scan.outcome).toBe('accepted')
    }

    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      const providerFilterOn = async () => {
        if (isPhoneLayout(page)) return (await page.getByRole('button', { name: /^הסרת סינון: נותן שירות/ }).count()) > 0
        return (await page.getByLabel('נותן שירות').inputValue()) !== ''
      }

      // Today's bar (the last link of the card) says 2 and opens the History of that day for everyone: the two visits, nothing else
      await page.goto('/admin#home')
      await expect(homeTable(page)).toBeVisible()
      const today = homeTable(page).getByRole('link').last()
      await expect(today, `${where}: today's bar of the building`).toContainText('2')
      await expect(today).toHaveAccessibleName(/: 2 ביקורים$/)
      await today.click()
      await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
      await expect(historyRows(page).filter({ hasText: tag }), `${where}: the two visits`).toHaveCount(2)
      await expect(historyRows(page), `${where}: and no other row`).toHaveCount(2)
      await expect(page, `${where}: the address of the link is tidied`).toHaveURL(/#history$/)
      expect(await providerFilterOn(), `${where}: a day is for everyone, no provider filter`).toBe(false)

      // Back is Home, and the row of Ploni opens the History of Ploni for the seven days: exactly as many rows as the row counts
      await page.goBack()
      await expect(homeTable(page)).toBeVisible()
      const row = homeRow(page, PEOPLE.ploni.name)
      const counted = Number(/(\d+)(?:ביקורים|ביקור)$/.exec((await row.textContent()) ?? '')?.[1])
      expect(counted, `${where}: the total of Ploni's row`).toBeGreaterThanOrEqual(2)
      await row.getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
      await expect(historyRows(page).filter({ hasText: tag }), `${where}: the two visits, and the rows are all Ploni's`).toHaveCount(2)
      await expect(historyRows(page), `${where}: as many rows as the total of the row`).toHaveCount(counted)
      if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: /^הסרת סינון: נותן שירות/ })).toBeVisible()
      else await expect(page.getByLabel('נותן שירות')).toHaveValue(ploni.id)

      // Back is Home, and "לכל ההיסטוריה" opens everyone's visits of the seven days: as many rows as the total of the card
      await page.goBack()
      await expect(homeTable(page)).toBeVisible()
      const total = Number(/^(\d+) ביקור/.exec((await homeCard(page).getByText(/^\d+ ביקור(ים)?$/).textContent()) ?? '')?.[1])
      expect(total, `${where}: the total of the card`).toBeGreaterThanOrEqual(2)
      await homeProviders(page).getByRole('link', { name: 'לכל ההיסטוריה' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
      await expect(historyRows(page), `${where}: as many rows as the total of the card`).toHaveCount(total)
      expect(await providerFilterOn(), `${where}: everyone's, no provider filter`).toBe(false)
    }
  } finally {
    await phone.dispose()
    for (const point of points) await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
  }
})

test('the tiles and the rows of Home open their screens, and each number is the one that screen shows, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page, 'home')
  // A tile reads "<number><label>[מתוך <total>]", a row of the short list "<label><number>".
  const numbers = async (label) => {
    const text = (await page.getByRole('main').getByRole('link', { name: label }).textContent()) ?? ''
    const [, number, total] = /^(\d+).*?(?:מתוך (\d+))?$/.exec(text) ?? /(\d+)$/.exec(text) ?? []
    return { number: Number(number), total: total === undefined ? undefined : Number(total) }
  }
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    const openCard = async (label) => {
      await page.goto('/admin#home')
      await expect(homeTable(page)).toBeVisible()
      const card = page.getByRole('main').getByRole('link', { name: label })
      const shown = await numbers(label)
      await card.click()
      return shown
    }

    let shown = await openCard(/נותני שירות פעילים/)
    await expect(page.getByRole('heading', { level: 1, name: 'נותני שירות' })).toBeVisible()
    await expect(page.getByRole('article'), `${where}: every provider the tile counts`).toHaveCount(shown.total)
    await expect(page.getByRole('article').getByText('פעיל', { exact: true }), `${where}: the active ones`).toHaveCount(shown.number)

    shown = await openCard(/נקודות פעילות/)
    await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
    await expect(page.getByRole('article'), `${where}: every point the tile counts`).toHaveCount(shown.total)
    await expect(page.getByRole('article').getByText('פעילה', { exact: true }), `${where}: the active ones`).toHaveCount(shown.number)

    shown = await openCard(/מנהלי המערכת/)
    await expect(page.getByRole('heading', { level: 1, name: 'הגדרות' })).toBeVisible()
    await expect(page.getByRole('main').getByText('פעיל', { exact: true }), `${where}: the members that are on`).toHaveCount(shown.number)

    shown = await openCard(/מפתחות אייג'נט פעילים/)
    await expect(page.getByRole('heading', { level: 1, name: "גישה לאייג'נט" })).toBeVisible()
    await expect(page.getByRole('article').getByText('פעיל', { exact: true }), `${where}: the keys that are not cancelled`).toHaveCount(shown.number)

    // the visits that were not counted: the History of the seven days, of the type "not counted", with exactly the rows the tile says
    shown = await openCard(/ביקורים שלא נקלטו/)
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    if (shown.number === 0) await expect(page.getByRole('heading', { level: 2, name: 'אין ביקורים שלא נקלטו בטווח הזה' })).toBeVisible()
    else await expect(historyRows(page), `${where}: the visits that were not counted`).toHaveCount(shown.number)
    if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: /^הסרת סינון: סוג/ })).toBeVisible()
    else await expect(page.getByLabel('סוג')).toHaveValue('not_counted')
  }
})

test('the row of a provider that was deleted opens the History filtered to it, and the filter says so, on a phone and on a computer', async ({ page }) => {
  await stubHome(page) // its week has a provider that is no longer in the list of providers (its visits stay), and one that is switched off
  await adminSignIn(page, 'home')
  const gone = HOME_PROVIDERS.find((p) => p.company === null)
  const off = HOME_PROVIDERS.find((p) => p.company !== null && !p.is_active)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await page.goto('/admin#home')
    await expect(homeRow(page, off.name), `${where}: the row of the provider that is off says so`).toContainText('מושבת')
    const row = homeRow(page, gone.name)
    await expect(row, `${where}: the row says it was deleted`).toContainText('נותן שירות שנמחק')
    await expect(row.getByRole('link'), `${where}: its total`).toContainText(String(gone.counts.reduce((a, b) => a + b, 0)))
    await row.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    // the filter is on, in plain sight, and never widened to everyone's visits
    if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: 'הסרת סינון: נותן שירות שנמחק' })).toBeVisible()
    else await expect(page.getByLabel('נותן שירות')).toHaveValue(gone.id)
    await expect(page.getByRole('main').getByRole('listitem'), `${where}: no visit of anyone else`).toHaveCount(0)
  }
})
