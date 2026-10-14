// The committee screens on a phone and on a computer: the same icons, nothing spilling off the screen, and deleting.
import { randomUUID } from 'node:crypto'
import {
  test, expect, he, PEOPLE, POINTS, FAR, SAMPLE_POINT, SCREEN_TITLES, SCREEN_NAV, adminSignIn, openScreen, clearScans, allowConsoleErrors,
  changeFilters, isPhoneLayout, openFilters, stubHome, HOME_DAYS, HOME_PROVIDERS, ADMIN_EMAIL, accountButton, openAccountMenu, signOut,
} from './fixtures.js'
import { SCAN_ERROR_POINT_INACTIVE } from '../shared/contract.js'
import { formatDateTime, formatDay } from '../shared/datetime.js'

const COMPUTER = { width: 1280, height: 800 }
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

test('the point tiles offer their actions as icons that have names, and no text buttons', async ({ page }) => {
  await adminSignIn(page, 'points')
  const tile = page.getByRole('article').filter({ hasText: 'לובי' })
  const actions = tile.getByRole('button')
  await expect(actions).toHaveCount(4)
  await expect(actions.nth(0)).toHaveAccessibleName('QR והדפסה')
  await expect(actions.nth(1)).toHaveAccessibleName('עריכה')
  await expect(actions.nth(2)).toHaveAccessibleName('השבתת הנקודה')
  await expect(actions.nth(3)).toHaveAccessibleName('מחיקת הנקודה')
  await expect(actions).toHaveText(['', '', '', '']) // icons only
  // adding a point is the round primary button at the end of the title row
  await expect(page.getByRole('button', { name: 'נקודה חדשה' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'הדפסת כל השלטים' })).toBeVisible()
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

test('every committee screen fits the width, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    for (const [tab, title] of TABS) {
      await page.goto(`/admin#${tab}`)
      // measure the tab itself once its list has arrived, not the previous tab or a loading screen
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
      expect(await noHorizontalScroll(page), `${tab} at ${size ? 'computer' : 'phone'} width`).toBe(true)
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
  const labels = ['בית', 'היסטוריה', 'נקודות', 'ספקים', 'עוד'] // the buttons, in the order of the page (the first is at the right: the page runs right to left)
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
  const last = await page.getByRole('main').evaluate((el) => el.lastElementChild.getBoundingClientRect().bottom)
  expect(last, 'at the end of the page, its last thing is above the bar').toBeLessThanOrEqual((await bar.boundingBox()).y)
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
  // the rail floats: a white card 250 px wide with rounded corners, clear of the screen edges; the current screen is the violet pill
  const side = await page.getByRole('complementary').boundingBox()
  expect(side.width, 'the rail is 250 px wide').toBe(250)
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
  await tile.getByRole('button', { name: 'מחיקת הנקודה' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('נשארת בהיסטוריה')
  await dialog.getByRole('button', { name: 'מחיקת הנקודה' }).click()
  await expect(tile).toHaveCount(0)

  // the scan is still in the history, under the deleted point's name; delete that row too
  await page.goto('/admin#history')
  const row = page.getByRole('listitem').filter({ hasText: name })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: 'מחיקת הנוכחות לצמיתות' }).click()
  await expect(page.getByRole('dialog')).toContainText('אי אפשר לשחזר')
  await page.getByRole('dialog').getByRole('button', { name: 'מחיקה', exact: true }).click()
  await expect(row).toHaveCount(0)
})

// ---- the same actions in the same places on every screen -----------------------------------------------------------

// The screens that have tiles or rows with actions, and the name of the last action of each (the red trash can). The audit log and the help
// have none: they are read only (their tests say so).
const REMOVE = {
  points: 'מחיקת הנקודה',
  providers: 'מחיקת נותן השירות',
  settings: 'מחיקה מהוועד',
  agent: 'מחיקת המפתח',
  history: 'מחיקת הנוכחות לצמיתות',
}
const loaded = async (page, title) => {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}
const near = (values, within, what) => {
  expect(Math.max(...values) - Math.min(...values), `${what}: ${values.map((v) => v.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(within)
}

test('every screen has its actions in the same order and places, with the red trash can last', async ({ page, playwright }) => {
  await adminSignIn(page)
  const tag = randomUUID().slice(0, 6)
  // sample data, so that every kind of tile exists in its different states
  const member = (await (await page.request.post('/api/admin/admins', { data: { email: `parity-${tag}@example.test`, name: `חבר ${tag}` } })).json()).admin
  expect(member?.id, 'the sample committee member was created').toBeTruthy()
  const live = (await (await page.request.post('/api/admin/api-keys', { data: { name: `פעיל ${tag}` } })).json()).api_key
  const dead = (await (await page.request.post('/api/admin/api-keys', { data: { name: `בוטל ${tag}` } })).json()).api_key
  // a write needs a JSON body, even an empty one
  expect((await page.request.post(`/api/admin/api-keys/${dead.id}/revoke`, { data: {} })).ok()).toBe(true)
  // Ploni signs in on a phone (a connected device) and makes one visit that is accepted and one that is refused as too far
  const phone = await playwright.request.newContext({ baseURL: page.url().split('/admin')[0] })
  try {
    const providers = (await (await phone.get('/api/public/providers')).json()).providers
    const ploni = providers.find((p) => p.contact_name === PEOPLE.ploni.name)
    const session = await (await phone.post('/api/session', { data: { provider_id: ploni.id, password: PEOPLE.ploni.password } })).json()
    const scan = (code, gps) => phone.post('/api/scan', { headers: { authorization: `Bearer ${session.token}` }, data: { id: randomUUID(), code, gps } })
    expect((await (await scan(POINTS.basement, null)).json()).scan.outcome).toBe('accepted')
    expect((await (await scan(POINTS.gym, { lat: FAR.latitude, lng: FAR.longitude, accuracy: FAR.accuracy })).json()).scan.outcome).toBe('rejected_far')

    const trashEdge = {} // where the trash can sits, measured from the end of its tile, per screen
    const steps = [] // the distance between the trash can and the icon next to it, on every tile
    for (const size of [null, COMPUTER]) {
      if (size) await page.setViewportSize(size)
      const where = size ? 'computer' : 'phone'
      for (const tab of Object.keys(REMOVE)) {
        const title = SCREEN_TITLES[tab]
        await page.goto(`/admin#${tab}`) // a tab loads its list when it is opened
        await loaded(page, title)
        if (tab === 'history') {
          // the refused visit is listed too: its row keeps the place of the cancel icon, and the trash can does not move
          await changeFilters(page, (filters) => filters.getByLabel('סוג').selectOption('all')) // (on a phone: in the sheet)
          await expect(page.getByText('נדחתה: רחוק מהנקודה')).toBeVisible()
        }
        const remove = page.getByRole('button', { name: REMOVE[tab] })
        const tiles = (tab === 'history' ? page.getByRole('listitem') : page.getByRole('article')).filter({ has: remove })
        const count = await tiles.count()
        // your own committee card has none (you cannot delete yourself), so that screen has just the other member's
        expect(count, `${tab}: tiles that have a trash can`).toBeGreaterThan(tab === 'settings' ? 0 : 1)

        const edges = []
        for (let i = 0; i < count; i++) {
          const tile = tiles.nth(i)
          const buttons = tile.getByRole('button')
          await expect(buttons.last(), `${tab} #${i}: the trash can is the last action`).toHaveAccessibleName(REMOVE[tab])
          const tileBox = await tile.boundingBox()
          const boxes = await Promise.all((await buttons.all()).map((b) => b.boundingBox()))
          const trash = boxes[boxes.length - 1]
          // the text of the page runs right to left, so the end of the tile is its left edge
          expect(trash.x, `${tab} #${i}: the trash can is the icon at the end`).toBeLessThanOrEqual(Math.min(...boxes.map((b) => b.x)) + 0.5)
          edges.push(trash.x - tileBox.x)
          if (boxes.length > 1) steps.push(boxes[boxes.length - 2].x - trash.x)
        }
        near(edges, 1, `${tab} at ${where} width: the trash can is in the same place on every tile`)
        trashEdge[`${tab}/${where}`] = edges[0]
      }
    }
    near(steps, 1, 'the icon next to the trash can is always the same distance from it')
    // the same place from one screen to the next (a card and a history row differ by their own padding, no more)
    for (const where of ['phone', 'computer']) {
      near(['points', 'providers', 'settings', 'agent'].map((tab) => trashEdge[`${tab}/${where}`]), 1, `${where}: the trash can is where it is on every card screen`)
    }

    // providers: the edit icon does not move whether or not a phone is signed in, and committee cards are all the same height
    await page.goto('/admin#providers')
    await loaded(page, 'נותני שירות')
    const edits = page.getByRole('article').filter({ has: page.getByRole('button', { name: 'עריכה' }) })
    const editEdges = []
    for (let i = 0; i < await edits.count(); i++) {
      const tile = edits.nth(i)
      editEdges.push((await tile.getByRole('button', { name: 'עריכה' }).boundingBox()).x - (await tile.boundingBox()).x)
    }
    expect(editEdges.length).toBeGreaterThan(2)
    near(editEdges, 1, 'providers: the edit icon is in the same place on every tile')
    // the icon for signed-in phones is there for some providers and not for others, and nothing else moved because of it
    const phonesButton = page.getByRole('button', { name: 'מכשירים', exact: true })
    const withPhones = await phonesButton.count()
    expect(withPhones, 'some providers have a phone signed in').toBeGreaterThan(0)
    expect(withPhones, 'and some do not').toBeLessThan(editEdges.length)
    // "מכשירים" is a screen action, so on every tile that has it, it is the first icon: before the new password, edit, switch off
    // and delete, in the markup and on the screen (the text runs right to left, so the first icon is the rightmost)
    const phoneTiles = page.getByRole('article').filter({ has: phonesButton })
    for (let i = 0; i < await phoneTiles.count(); i++) {
      const buttons = phoneTiles.nth(i).getByRole('button')
      const names = await Promise.all((await buttons.all()).map((b) => b.getAttribute('aria-label')))
      expect(names, `providers #${i}: the actions in order`).toEqual(['מכשירים', 'סיסמה חדשה', 'עריכה', names[3], 'מחיקת נותן השירות'])
      expect(['השבתה', 'הפעלה']).toContain(names[3])
      const xs = (await Promise.all((await buttons.all()).map((b) => b.boundingBox()))).map((box) => box.x)
      expect(xs, `providers #${i}: each icon is to the left of the one before it`).toEqual([...xs].sort((a, b) => b - a))
    }

    await page.goto('/admin#settings')
    await loaded(page, 'הגדרות')
    const heights = await Promise.all((await page.getByRole('article').all()).map(async (a) => (await a.boundingBox()).height))
    expect(heights.length, 'your own card and the other member').toBeGreaterThan(1)
    near(heights, 1, 'settings: every member card is the same height, also the one with no icons')
  } finally {
    await phone.dispose()
    await page.request.delete(`/api/admin/admins/${member.id}`)
    for (const key of [live, dead]) await page.request.delete(`/api/admin/api-keys/${key.id}`)
  }
})

// ---- a long name in a tile and in the head of a dialog ---------------------------------------------------------------------

// On a phone, the four icons of a point's tile left its title a column of about 100 px, and a long word of the name (an English
// "Maintenance" or a Russian word) was cut in the middle. Now the icons wrap below the title, at the end of the row, when the title
// does not fit on one line beside them, and the title gets the whole width. The same name in the head of a dialog wraps over several
// lines, and the close button stays at the top of the head instead of the middle of it. 360 px is the narrowest phone in use (the
// two E2E devices are 390 and 412 wide), and the computer shows the tile in a column of its own width.
test('a long point name is readable in its tile and in the head of a dialog: no word is cut across lines, the icons keep their order and end of the row, and the close button is at the top', async ({ page }) => {
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
      expect(await cutWords(title), `${where}: words of the title that are cut across lines`).toEqual([])
      // the order of the icons and the end of the row: the trash can is the last icon, and at the same distance from the end of the tile
      // as on a tile with a short name (the text runs right to left, so the end of a tile is its left edge)
      const edgeOf = async (article) => {
        const buttons = article.getByRole('button')
        await expect(buttons.last(), `${where}: the trash can is the last action`).toHaveAccessibleName('מחיקת הנקודה')
        const boxes = await Promise.all((await buttons.all()).map((b) => b.boundingBox()))
        expect(boxes.map((b) => b.x), `${where}: each icon is to the left of the one before it`).toEqual([...boxes.map((b) => b.x)].sort((a, b) => b - a))
        return boxes[boxes.length - 1].x - (await article.boundingBox()).x
      }
      near([await edgeOf(tile), await edgeOf(page.getByRole('article').filter({ hasText: 'לובי' }).first())], 1, `${where}: the trash can is in the same place on a long and on a short tile`)
      expect(await noHorizontalScroll(page), `${where}: the points do not scroll sideways`).toBe(true)

      // the dialog: its title is "QR: " and the name, which wraps over several lines on a phone
      await tile.getByRole('button', { name: 'QR והדפסה' }).click()
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
    await page.getByRole('article').filter({ hasText: 'לובי' }).first().getByRole('button', { name: 'QR והדפסה' }).click()
    const shortHead = page.getByRole('dialog').getByRole('heading', { level: 2 })
    const [shortBox, shortClose] = await Promise.all([shortHead.boundingBox(), page.getByRole('dialog').getByTitle('סגירה').boundingBox()])
    expect(shortBox.height, 'the title of the lobby is one line').toBeLessThan(shortClose.height)
    expect(shortClose.y + shortClose.height / 2, 'a title of one line is centred against the close button').toBeCloseTo(shortBox.y + shortBox.height / 2, 0)
    await page.keyboard.press('Escape')
  } finally {
    await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
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
    await tile.getByRole('button', { name: 'מכשירים', exact: true }).click()
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
    await expect(tile.getByRole('button', { name: 'מכשירים', exact: true })).toHaveCount(0)
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
      const from = filters.getByLabel('מתאריך')
      const until = filters.getByLabel('עד תאריך')
      await from.fill('')
      await from.pressSequentially('01012020')
      await until.fill('')
      await until.pressSequentially('02012020')
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
    await tile.getByRole('button', { name: button }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(mentions)
    await dialog.getByRole('button', { name: confirmLabel }).click()
    await expect(tile).toHaveCount(0)
  }

  await deleteFrom('providers', 'נותני שירות', page.getByRole('article').filter({ hasText: `עובד ${tag}` }),
    'מחיקת נותן השירות', 'מחיקת נותן השירות', 'בהיסטוריה, תחת השם הזה')
  await deleteFrom('settings', 'הגדרות', page.getByRole('article').filter({ hasText: `חבר ${tag}` }),
    'מחיקה מהוועד', 'מחיקה מהוועד', 'אפשר להוסיף את אותה כתובת שוב')
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

      // history, on a phone and on a computer: the two date fields, the heading of the day, the time of the visit, and the confirmation.
      // The date fields are above the list on a computer and in the sheet that the filter button opens on a phone, so there the sheet is
      // opened to look at them and closed again before the rows are touched (it covers them).
      for (const size of [null, COMPUTER]) {
        if (size) await page.setViewportSize(size)
        const phoneLayout = isPhoneLayout(page)
        await page.goto('/admin#agent') // from another tab, so that History opens with its own filters again
        await loaded(page, "גישה לאייג'נט")
        await page.goto('/admin#history')
        await loaded(page, 'היסטוריית נוכחות')
        let sheet = phoneLayout ? await openFilters(page) : null
        let from = (sheet ?? page).getByLabel('מתאריך')
        let to = (sheet ?? page).getByLabel('עד תאריך')
        await expect(from).toHaveValue(DAY)
        await expect(to).toHaveValue(DAY)
        await sheet?.getByRole('button', { name: 'סגירה' }).click()
        await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ }).first()).toHaveText(/^\d{2}\/\d{2}\/\d{4} · \d+$/)
        const row = page.getByRole('listitem').filter({ hasText: 'מינוס 1' }).first()
        await expect(row).toContainText(/\b\d{2}:\d{2}\b/)
        await row.getByRole('button', { name: 'מחיקת הנוכחות לצמיתות' }).click()
        await expect(page.getByRole('dialog')).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
        await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click() // close without deleting
        await noOtherFormat('history')

        // a date that is half typed: the list does not follow it and the export waits (it would use the last good range, and
        // the file would not match what the field says). Both are back when the date is finished. On a phone nothing follows the field
        // at all: "show results" is what applies, and with a date that is not finished it applies nothing, says so under the field and
        // keeps the sheet open on it.
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
      await changeFilters(page, (filters) => filters.getByLabel('חבר ועד').selectOption({ label: me.name }), log)
      await expect(rowsOfPoint).toHaveCount(3)
      await changeFilters(page, (filters) => filters.getByLabel('חבר ועד').selectOption({ label: 'כל החברים' }), log)

      // a stretch of time in which nothing was done: its own empty state
      await changeFilters(page, async (filters) => {
        const from = filters.getByLabel('מתאריך')
        const until = filters.getByLabel('עד תאריך')
        await from.fill('')
        await from.pressSequentially('01012020')
        await until.fill('')
        await until.pressSequentially('02012020')
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

    // read only: nothing to press in it, and nothing that opens or closes
    await expect(main.getByRole('button')).toHaveCount(0)
    await expect(main.getByRole('link')).toHaveCount(0)
    await expect(main.locator('[aria-expanded]')).toHaveCount(0)

    // it fits: nothing of it is outside the screen, and the page does not scroll sideways
    const outside = await main.evaluate((root) => [...root.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5)
    }).map((el) => el.tagName))
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
  const rows = [['אייג׳נט', 'מפתחות לסוכן ה-AI של הוועד'], ['הגדרות', 'חברי הוועד ופרטי הבניין'], ['יומן פעולות', 'מי שינה מה ומתי'], ['איך עובדים עם המערכת', 'מדריך קצר']]
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
  await bar.getByRole('button', { name: 'נקודות', exact: true }).click()
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

const homeTable = (page) => page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).getByRole('table')
/** The row of the week table of one provider (by a word of its name), and the cells of a row, in the order of the page. */
const homeRow = (page, name) => homeTable(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name }) })
const homeTotals = (page) => homeTable(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'סך הכול' }) })
const historyRows = (page) => page.getByRole('main').getByRole('listitem')
const box = async (locator) => {
  const found = await locator.boundingBox()
  expect(found, 'the element has a box').not.toBeNull()
  return found
}

test('the app opens on Home when the address names no screen, greets the member, and keeps Home through a reload and Back', async ({ page }) => {
  await adminSignIn(page, 'home')
  await expect(page).toHaveURL(/\/admin$/)
  // the sample member is "Dev Admin": the greeting is by the hour of the building, and the first word of the name
  await expect(page.getByRole('heading', { level: 1, name: /^(בוקר טוב|צהריים טובים|ערב טוב), Dev$/ })).toBeVisible()
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

test('the week table of Home runs from the right (the oldest day) to the left (today), its cells are at least 24 by 24, and the page does not scroll sideways, on a phone and on a computer', async ({ page }) => {
  await stubHome(page)
  await adminSignIn(page, 'home')
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await expect(homeTable(page)).toBeVisible()

    // The columns: the days in the order the server gives them, and the page is right to left, so the oldest is the right-most day.
    // The range stands above the table in full (its caption, the name of the table), the heads write DD/MM and are named by the full date,
    // and the heading names the box once: no second caption says it again.
    const range = `${formatDay(HOME_DAYS[0])} עד ${formatDay(HOME_DAYS.at(-1))}`
    await expect(homeTable(page), `${where}: the table is named by its range`).toHaveAccessibleName(range)
    const caption = homeTable(page).getByText(range, { exact: true })
    await expect(caption, `${where}: the range is written, in DD/MM/YYYY`).toBeVisible()
    await expect(page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).getByText('נוכחות ב-7 הימים האחרונים'), `${where}: the heading is not said again in the table`).toHaveCount(0)
    const dayHeads = HOME_DAYS.map((day) => formatDay(day)) // the name of a head is its full date, for a screen reader
    for (const day of HOME_DAYS) await expect(homeTable(page).getByText(`${day.slice(8)}/${day.slice(5, 7)}`, { exact: true }), `${where}: the head writes DD/MM`).toBeVisible()
    const heads = await Promise.all(dayHeads.map((name) => box(homeTable(page).getByRole('columnheader', { name, exact: true }))))
    for (let i = 1; i < heads.length; i++) {
      expect(heads[i - 1].x, `${where}: ${dayHeads[i - 1]} is to the right of ${dayHeads[i]}`).toBeGreaterThan(heads[i].x)
    }
    expect((await box(caption)).y + (await box(caption)).height, `${where}: the range is right above the heads`).toBeLessThanOrEqual(heads[0].y + 1)
    const names = await box(homeRow(page, 'פלוני').getByRole('rowheader'))
    expect(names.x, `${where}: the names are at the right, before the oldest day`).toBeGreaterThan(heads[0].x)

    // The cells line up under their days, in a provider's row and in the totals.
    for (const row of [homeRow(page, 'פלוני'), homeTotals(page)]) {
      const cells = await row.getByRole('cell').all()
      expect(cells, `${where}: a cell for each day`).toHaveLength(HOME_DAYS.length)
      for (const [i, cell] of cells.entries()) {
        const found = await box(cell)
        expect(Math.abs(found.x + found.width / 2 - (heads[i].x + heads[i].width / 2)), `${where}: the cell of ${dayHeads[i]} is under its head`).toBeLessThanOrEqual(1)
      }
    }

    // Every cell that has visits is a target of at least 24 by 24 (T1), and 44 high.
    const links = await homeTable(page).getByRole('link').all()
    expect(links.length, `${where}: cells with visits`).toBeGreaterThan(10)
    for (const link of links) {
      const found = await box(link)
      expect(found.width, `${where}: the width of a cell link`).toBeGreaterThanOrEqual(24)
      expect(found.height, `${where}: the height of a cell link`).toBeGreaterThanOrEqual(44)
    }
    // the six cards (the stub has phones that wait, so the sixth is there): each is one link, and at least 44 high
    for (const label of [/נותני שירות פעילים/, /נקודות פעילות/, /ביקורים שלא נקלטו/, /טלפונים עם ביקורים/, /חברי הוועד/, /מפתחות אייג'נט פעילים/]) {
      expect((await box(page.getByRole('main').getByRole('link', { name: label }))).height, `${where}: the card ${label}`).toBeGreaterThanOrEqual(44)
    }

    // Nothing scrolls sideways, the box of the table included: it fits, and its own scrolling is only for what could not.
    expect(await noHorizontalScroll(page), `${where}: the page`).toBe(true)
    const { scrollWidth, clientWidth } = await page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(scrollWidth, `${where}: the box of the table`).toBeLessThanOrEqual(clientWidth + 1)
  }
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
  for (const width of [1280, 800, 1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(homeTable(page)).toBeVisible()
    await expect(loading).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: width < 1024 ? 'ניווט ראשי (טלפון)' : 'ניווט ראשי', exact: true }).getByRole('button', { name: 'בית', exact: true })).toHaveAttribute('aria-current', 'page')
  }
  expect(await table.evaluate((el) => el.isConnected), 'the table is the same element, not drawn again').toBe(true)
  expect(requests, 'no request for the numbers').toBe(before)
})

test('a cell of Home opens the History of exactly those visits, a total opens everyone\'s, and Back returns to Home, on a phone and on a computer', async ({ page, playwright }) => {
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

      // Ploni's cell for today (the last column) says 2, and opens the History of Ploni on that day: two rows, nothing else
      await page.goto('/admin#home')
      await expect(homeTable(page)).toBeVisible()
      const cell = homeRow(page, PEOPLE.ploni.name).getByRole('cell').last()
      await expect(cell, `${where}: today's cell of Ploni`).toHaveText('2')
      await cell.getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
      await expect(historyRows(page).filter({ hasText: tag }), `${where}: the two visits`).toHaveCount(2)
      await expect(historyRows(page), `${where}: and no other row`).toHaveCount(2)
      await expect(page, `${where}: the address of the link is tidied`).toHaveURL(/#history$/)
      if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: /^הסרת סינון: נותן שירות/ })).toBeVisible()
      else await expect(page.getByLabel('נותן שירות')).toHaveValue(ploni.id)

      // Back is Home, and the total of today opens everyone's visits of that day: the same two
      await page.goBack()
      await expect(homeTable(page)).toBeVisible()
      const total = homeTotals(page).getByRole('cell').last()
      await expect(total, `${where}: today's total`).toHaveText('2')
      await total.getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
      await expect(historyRows(page), `${where}: the visits of the day`).toHaveCount(2)
      if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: /^הסרת סינון: נותן שירות/ })).toHaveCount(0)
      else await expect(page.getByLabel('נותן שירות')).toHaveValue('')
    }
  } finally {
    await phone.dispose()
    for (const point of points) await page.request.delete(`/api/admin/points/${point.id}`, { data: {} })
  }
})

test('the cards of Home open their screens, and each number is the one that screen shows, on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page, 'home')
  const numbers = async (label) => {
    const text = (await page.getByRole('main').getByRole('link', { name: label }).textContent()) ?? ''
    const [, number, total] = /^(\d+).*?(?:מתוך (\d+))?$/.exec(text) ?? []
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
    await expect(page.getByRole('article'), `${where}: every provider the card counts`).toHaveCount(shown.total)
    await expect(page.getByRole('article').getByText('פעיל', { exact: true }), `${where}: the active ones`).toHaveCount(shown.number)

    shown = await openCard(/נקודות פעילות/)
    await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
    await expect(page.getByRole('article'), `${where}: every point the card counts`).toHaveCount(shown.total)
    await expect(page.getByRole('article').getByText('פעילה', { exact: true }), `${where}: the active ones`).toHaveCount(shown.number)

    shown = await openCard(/חברי הוועד/)
    await expect(page.getByRole('heading', { level: 1, name: 'הגדרות' })).toBeVisible()
    await expect(page.getByRole('main').getByText('פעיל', { exact: true }), `${where}: the members that are on`).toHaveCount(shown.number)

    shown = await openCard(/מפתחות אייג'נט פעילים/)
    await expect(page.getByRole('heading', { level: 1, name: "גישה לאייג'נט" })).toBeVisible()
    await expect(page.getByRole('article').getByText('פעיל', { exact: true }), `${where}: the keys that are not cancelled`).toHaveCount(shown.number)

    // the visits that were not counted: the History of the seven days, of the type "not counted", with exactly the rows the card says
    shown = await openCard(/ביקורים שלא נקלטו/)
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    if (shown.number === 0) await expect(page.getByRole('heading', { level: 2, name: 'אין ביקורים שלא נקלטו בטווח הזה' })).toBeVisible()
    else await expect(historyRows(page), `${where}: the visits that were not counted`).toHaveCount(shown.number)
    if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: /^הסרת סינון: סוג/ })).toBeVisible()
    else await expect(page.getByLabel('סוג')).toHaveValue('not_counted')
  }
})

test('the cell of a provider that was deleted opens the History filtered to it, and the filter says so, on a phone and on a computer', async ({ page }) => {
  await stubHome(page) // its week has a provider that is no longer in the list of providers (its visits stay), and one that is switched off
  await adminSignIn(page, 'home')
  const gone = HOME_PROVIDERS.find((p) => p.company === null)
  for (const size of [null, COMPUTER]) {
    if (size) await page.setViewportSize(size)
    const where = size ? 'computer' : 'phone'
    await page.goto('/admin#home')
    const row = homeRow(page, gone.name)
    await expect(row.getByRole('rowheader'), `${where}: the row says it was deleted`).toContainText('נותן שירות שנמחק')
    const cell = row.getByRole('cell').nth(gone.counts.findIndex((n) => n > 0))
    await expect(cell).toHaveText(String(Math.max(...gone.counts)))
    await cell.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
    // the filter is on, in plain sight, and never widened to everyone's visits
    if (isPhoneLayout(page)) await expect(page.getByRole('button', { name: 'הסרת סינון: נותן שירות שנמחק' })).toBeVisible()
    else await expect(page.getByLabel('נותן שירות')).toHaveValue(gone.id)
    await expect(page.getByRole('main').getByRole('listitem'), `${where}: no visit of anyone else`).toHaveCount(0)
  }
})
