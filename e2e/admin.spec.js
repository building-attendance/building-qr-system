// The committee screens on a phone and on a computer: the same icons, nothing spilling off the screen, and deleting.
import { randomUUID } from 'node:crypto'
import {
  test, expect, he, PEOPLE, POINTS, FAR, SAMPLE_POINT, SCREEN_TITLES, SCREEN_NAV, adminSignIn, openScreen, clearScans, allowConsoleErrors,
  changeFilters, isPhoneLayout, openFilters,
} from './fixtures.js'
import { SCAN_ERROR_POINT_INACTIVE } from '../shared/contract.js'
import { formatDateTime } from '../shared/datetime.js'

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

test('the provider-app, light/dark and sign-out icons are the same on a phone and on a computer', async ({ page }) => {
  await adminSignIn(page)
  const tools = async () => {
    await expect(page.getByRole('link', { name: 'אפליקציית נותני השירות' })).toBeVisible()
    // both layouts are in the page, one of them hidden: a role query sees only the one that is shown
    await expect(page.getByRole('combobox', { name: he['theme.label'] })).toBeVisible()
    await expect(page.getByRole('button', { name: 'יציאה' })).toBeVisible()
  }
  await tools() // the phone's width, as the project sets it
  await page.setViewportSize(COMPUTER)
  await tools()
  // on a computer there are no text rows left for them in the side rail
  await expect(page.getByRole('complementary').getByRole('button', { name: 'יציאה' })).toHaveText('')
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

// The tab bar of the phone has four equal columns: history, points, providers and "עוד" (more), which opens the sheet with the other four screens.
// On the narrowest phone that is still in use (360 px) each label has about 90 px. "נותני שירות" wrapped onto two lines in the five
// columns this bar had before, which made the bar taller and set its icon higher than the others; the button says "ספקים" (`nav` in
// TABS, src/pages/AdminApp.jsx) while the top bar, the heading and the title keep the long name. The two E2E devices are 412 and 390 px
// wide, so nothing else measures 360.
test('the tab bar of the phone fits a 360 px screen: four buttons, each label on one line and not cut, every button the same height', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await adminSignIn(page)
  const bar = page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
  const labels = ['היסטוריה', 'נקודות', 'ספקים', 'עוד'] // the buttons, in the order of the page (the first is at the right: the page runs right to left)
  await expect(bar.getByRole('button')).toHaveCount(labels.length)
  const heights = []
  const xs = []
  for (const [index, label] of labels.entries()) {
    const button = bar.getByRole('button').nth(index)
    await expect(button, `the name of button ${index + 1} is its visible label`).toHaveAccessibleName(label)
    const text = button.getByText(label, { exact: true })
    const { lines, scrollWidth, clientWidth } = await text.evaluate((span) => {
      const range = document.createRange()
      range.selectNodeContents(span)
      return { lines: range.getClientRects().length, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth }
    })
    expect(scrollWidth, `${label} is not cut (its text is wider than its box)`).toBeLessThanOrEqual(clientWidth)
    expect(lines, `${label} is on one line`).toBe(1)
    const box = await button.boundingBox()
    heights.push(box.height)
    xs.push(box.x)
    expect(box.height, `${label} is a target of 44 px or more`).toBeGreaterThanOrEqual(44)
  }
  expect(Math.max(...heights) - Math.min(...heights), `the heights of the four buttons: ${heights.join(', ')}`).toBeLessThan(0.5)
  expect(xs, 'the first button is at the start of the bar (the right, in right-to-left), "עוד" at the end').toEqual([...xs].sort((p, q) => q - p))
  expect(await noHorizontalScroll(page), 'the page does not scroll sideways at 360 px').toBe(true)
})

// The side rail of a computer has all seven screens in two groups, the work screens and the management screens, with a line between
// them. Every name is whole, on one line. The help is called "עזרה" on its button: its whole name, "איך עובדים עם המערכת", measured 168 px
// against the 157 px that the name of a button has in a rail 248 px wide (the sheet under "עוד" has room for the whole name).
test('the side rail has the seven screens in two groups with a separator, each name whole on one line', async ({ page }) => {
  await page.setViewportSize(COMPUTER)
  await adminSignIn(page)
  const rail = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true })
  const names = Object.values(SCREEN_NAV)
  await expect(rail.getByRole('button')).toHaveText(names)
  await expect(rail.getByRole('separator')).toHaveCount(1)
  // the separator is between the third button and the fourth, and visible (a line, not an empty gap)
  const [third, fourth, separator] = await Promise.all([
    rail.getByRole('button').nth(2).boundingBox(), rail.getByRole('button').nth(3).boundingBox(), rail.getByRole('separator').boundingBox(),
  ])
  expect(separator.y, 'the separator is under the third button').toBeGreaterThanOrEqual(third.y + third.height - 0.5)
  expect(separator.y + separator.height, 'and above the fourth').toBeLessThanOrEqual(fourth.y + 0.5)
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
  // the whole rail is on the screen, also on a short one (it scrolls when it must; the sign-out is reachable)
  await page.setViewportSize({ width: 1280, height: 560 })
  await expect(rail.getByRole('button').last()).toBeVisible()
  await expect(page.getByRole('complementary').getByRole('button', { name: 'יציאה' })).toBeVisible()
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
    await adminSignIn(page) // returns as soon as the first screen is there
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
      await page.getByRole('button', { name: 'יציאה' }).click()
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
  'נקודות ושלטי QR', 'נותני שירות והטלפונים שלהם', "היסטוריה ו'לא נקלטו'", "האייג'נט", 'יומן הפעולות', 'כשמגיעה התראה', 'כשטלפון תקוע',
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
// On a phone the tab bar has four buttons and the fourth, "עוד", opens a sheet with the other four screens: a real dialog (the Modal
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
  await expect(items).toHaveText(['אייג׳נט', 'הגדרות', 'יומן פעולות', 'איך עובדים עם המערכת'])
  // each item has its icon and a target of 44 px or more, and the sheet is at the bottom of the screen
  for (const item of await items.all()) {
    await expect(item.locator('svg')).toHaveCount(1)
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
  await expect(sheet.locator('[aria-current="page"]')).toHaveText(['הגדרות'])
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
    const item = el.querySelector('.a-nav__item:not([aria-current])')
    return { sheet: getComputedStyle(el).backgroundColor, text: getComputedStyle(item).color }
  })
  expect(colours.text).not.toBe(colours.sheet)
})

// The old address of the screen that held the members, the building, the guide and the audit log.
test('the old address #committee lands on the settings, and an address that is no screen lands on the history', async ({ page }) => {
  await adminSignIn(page, 'settings')
  await page.goto('/admin#history')
  await loaded(page, 'היסטוריית נוכחות')
  await page.goto('/admin#committee')
  await loaded(page, 'הגדרות')
  await expect(page.getByLabel('כתובת הבניין', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goto('/admin#nowhere')
  await loaded(page, 'היסטוריית נוכחות')
})

// A new installation has no points, and the history is the first screen: it says to start with the points instead of "widen the dates".
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
