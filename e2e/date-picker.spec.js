// The committee app's own date picker (src/admin/DatePicker.jsx, owner decision of 14/10/2026) in a real browser: every date filter of the
// History tab and of the audit log opens a month grid, a popover beside its field on a computer and a sheet from the bottom on a phone, with
// the quick ranges under the grid. The component test (tests/components/date-picker.test.jsx) has every key and every state; this spec
// checks what only a browser decides: the keys as the browser sends them in a right-to-left page, the place of the popover and of the sheet,
// a tap, the reflow at 320 px, and the list that a range really asks for.
//
// The clock of the page is fixed at 12:00 on 14/10/2026 in the building (a Wednesday), so the grid and the quick ranges are known. The two
// lists are answered here (`stubScans`, `stubAudit`) with a fixed set of days, narrowed by `from` and `to` the way the server narrows them
// (tests/read-filters.test.js covers the server's own filtering): a real visit would be a provider signing in, and the run has a limited
// number of those (e2e/visual.spec.js says why).
import { test, expect, ADMIN_EMAIL } from './fixtures.js'

// No service worker: this spec answers the lists itself (page.route), and a page that a service worker controls would not give it those requests.
test.use({ serviceWorkers: 'block' })

const NOW = new Date('2026-10-14T09:00:00Z') // 12:00 on 14/10/2026 in the building
const COMPUTER = { width: 1280, height: 800 }
const PHONE_320 = { width: 320, height: 568 }
// The days that have a visit (and an entry of the audit log), newest first, as the API answers.
const DAYS = ['2026-10-14', '2026-10-12', '2026-10-09', '2026-10-07', '2026-10-05', '2026-10-01', '2026-09-20', '2026-09-10']
const shown = (days) => days.map((day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)} · 1`)
const between = (from, to) => DAYS.filter((day) => (!from || day >= from) && (!to || day <= to))

/** One visit on `day`, as the list of the History tab holds it (the shape of `scanJson` in server/scans.js). */
const visit = (day, i) => ({
  id: `00000000-0000-4000-8000-0000000000${10 + i}`,
  checked_in_at: `${day}T07:00:00.000Z`,
  checked_in_local: `${day}T07:00:00.000Z`,
  local_date: day,
  point_id: '00000000-0000-4000-8000-000000000a01',
  point_name: 'לובי',
  provider_id: '00000000-0000-4000-8000-000000000b01',
  provider_name: 'נותן לדוגמה',
  service_type: 'cleaning',
  source: 'online',
  outcome: 'accepted',
  distance_m: null,
  gps_accuracy_m: null,
  flags: [],
  voided: false,
  void_reason: null,
})

/** One entry of the audit log on `day` (the shape of `AuditEntry` in shared/types.js). */
const entry = (day, i) => ({
  id: i + 1, at: `${day}T07:00:00.000Z`, action: 'session.sign_in', entity: null, entity_id: null, entity_name: null,
  actor_type: 'admin', actor_id: '00000000-0000-4000-8000-0000000003a0', actor_name: 'דנה לוי', actor_deleted: false, detail: null,
})

/** Answers the list at `pattern` with the item of every day of DAYS between `from` and `to`, and keeps the query of every request. */
async function stubList(page, pattern, key, item) {
  const asked = []
  await page.route(pattern, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const query = new URL(route.request().url()).searchParams
    asked.push(Object.fromEntries(query))
    const days = between(query.get('from'), query.get('to'))
    return route.fulfill({ json: { [key]: days.map((day) => item(day, DAYS.indexOf(day))), next_cursor: null } })
  })
  return asked
}
const stubScans = (page) => stubList(page, /\/api\/admin\/scans\?/, 'scans', visit)
const stubAudit = (page) => stubList(page, /\/api\/admin\/audit\?/, 'entries', entry)

/** Signs the committee in through the API (no sign-in screen, so no 401 in the console) and opens `screen` at the fixed time. */
async function open(page, screen, title) {
  await page.clock.setFixedTime(NOW)
  const login = await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
  expect(login.ok(), 'dev admin sign-in').toBeTruthy()
  await page.goto(`/admin#${screen}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}

const dayHeads = (page) => page.getByRole('main').getByRole('heading', { level: 2 })
const fromButton = (scope) => scope.getByRole('button', { name: 'לוח שנה: תאריך התחלה' })
const toButton = (scope) => scope.getByRole('button', { name: 'לוח שנה: תאריך סיום' })
const startPicker = (page) => page.getByRole('dialog', { name: 'תאריך התחלה', exact: true })
const endPicker = (page) => page.getByRole('dialog', { name: 'תאריך סיום', exact: true })
const day = (picker, name) => picker.getByRole('button', { name, exact: true })

/** Presses the keys one after another, and checks where the focus is after each: `[key, the day that has the focus after it]`. */
async function walk(page, picker, steps) {
  for (const [key, name] of steps) {
    await page.keyboard.press(key)
    await expect(day(picker, name), `${key} goes to ${name}`).toBeFocused()
  }
}

test.describe('the History tab on a computer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(COMPUTER)
  })

  test('a range chosen with the mouse: a popover under each field, and the list shows exactly the visits of the range', async ({ page }) => {
    const asked = await stubScans(page)
    await open(page, 'history', 'היסטוריית נוכחות')
    await expect(dayHeads(page)).toHaveText(shown(between('2026-10-08', '2026-10-14'))) // the default: the last 7 days

    await fromButton(page).click()
    const start = startPicker(page)
    await expect(start).toBeVisible()
    await expect(start.getByRole('heading', { level: 3 })).toHaveText('10/2026')
    // a popover beside its field: under it, its start (the right edge in Hebrew) at the field's, inside the screen
    const field = await page.locator('.a-date').first().boundingBox()
    const box = await start.boundingBox()
    expect(box.y, 'under the field').toBeGreaterThanOrEqual(field.y + field.height)
    expect(Math.abs(box.x + box.width - (field.x + field.width)), 'its right edge at the right edge of the field').toBeLessThanOrEqual(1)
    expect(box.x).toBeGreaterThanOrEqual(0)
    await day(start, '05/10/2026').click()
    await expect(start).toHaveCount(0)
    await expect(page.getByLabel('מתאריך', { exact: true })).toHaveValue('05/10/2026')

    await toButton(page).click()
    const end = endPicker(page)
    // the range is drawn: both ends chosen, the days between them on the band, the days after today out of reach
    await expect(day(end, '05/10/2026')).toHaveClass(/is-chosen/)
    await expect(day(end, '14/10/2026')).toHaveClass(/is-chosen/)
    await expect(day(end, '09/10/2026').locator('xpath=..')).toHaveClass('is-in')
    await expect(day(end, '15/10/2026')).toHaveAttribute('aria-disabled', 'true')
    await day(end, '09/10/2026').click()
    await expect(page.getByLabel('עד תאריך', { exact: true })).toHaveValue('09/10/2026')

    await expect(dayHeads(page)).toHaveText(shown(between('2026-10-05', '2026-10-09')))
    expect(asked.at(-1)).toMatchObject({ from: '2026-10-05', to: '2026-10-09' })
  })

  test('a range chosen with the keyboard: right to left the arrows are mirrored, and Esc and Enter give the focus back', async ({ page }) => {
    const asked = await stubScans(page)
    await open(page, 'history', 'היסטוריית נוכחות')

    const opener = fromButton(page)
    await opener.focus()
    await page.keyboard.press('Enter')
    const start = startPicker(page)
    await expect(day(start, '08/10/2026'), 'the focus is on the chosen day').toBeFocused()
    await page.keyboard.press('Escape')
    await expect(start).toHaveCount(0)
    await expect(opener).toBeFocused()

    await page.keyboard.press('Space')
    await expect(day(start, '08/10/2026')).toBeFocused()
    // in Hebrew the day on the right is the one before: Thursday 08/10, back three days to Monday 05/10
    await walk(page, start, [['ArrowRight', '07/10/2026'], ['ArrowRight', '06/10/2026'], ['ArrowLeft', '07/10/2026'], ['ArrowRight', '06/10/2026'], ['ArrowRight', '05/10/2026']])
    await page.keyboard.press('Enter')
    await expect(start).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect(page.getByLabel('מתאריך', { exact: true })).toHaveValue('05/10/2026')

    await toButton(page).focus()
    await page.keyboard.press('Enter')
    const end = endPicker(page)
    await expect(day(end, '14/10/2026')).toBeFocused()
    await walk(page, end, [
      ['PageUp', '14/09/2026'], ['PageDown', '14/10/2026'], ['Home', '11/10/2026'], ['ArrowUp', '04/10/2026'],
      ['End', '10/10/2026'], ['ArrowDown', '14/10/2026'], ['ArrowUp', '07/10/2026'], ['ArrowLeft', '08/10/2026'], ['ArrowLeft', '09/10/2026'],
    ])
    await expect(end.getByRole('heading', { level: 3 })).toHaveText('10/2026')
    await page.keyboard.press('Enter')
    await expect(toButton(page)).toBeFocused()
    await expect(page.getByLabel('עד תאריך', { exact: true })).toHaveValue('09/10/2026')

    await expect(dayHeads(page)).toHaveText(shown(between('2026-10-05', '2026-10-09')))
    expect(asked.at(-1)).toMatchObject({ from: '2026-10-05', to: '2026-10-09' })
  })

  test('a link to the History tab still sets the two fields, and the calendar opens on its range', async ({ page }) => {
    const asked = await stubScans(page)
    await page.clock.setFixedTime(NOW)
    const login = await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
    expect(login.ok()).toBeTruthy()
    await page.goto('/admin#history?from=2026-09-01&to=2026-09-30')
    await expect(page.getByLabel('מתאריך', { exact: true })).toHaveValue('01/09/2026')
    await expect(page.getByLabel('עד תאריך', { exact: true })).toHaveValue('30/09/2026')
    await expect(dayHeads(page)).toHaveText(shown(between('2026-09-01', '2026-09-30')))
    expect(asked[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    await fromButton(page).click()
    const start = startPicker(page)
    await expect(start.getByRole('heading', { level: 3 })).toHaveText('09/2026')
    await expect(day(start, '01/09/2026')).toBeFocused()
    await expect(day(start, '30/09/2026')).toHaveClass(/is-chosen/)
    await expect(day(start, '15/09/2026').locator('xpath=..')).toHaveClass('is-in')
  })
})

test.describe('the audit log on a computer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(COMPUTER)
  })

  test('a range chosen with the mouse, then with the keyboard, then a quick range: the log shows exactly the entries of each', async ({ page }) => {
    const asked = await stubAudit(page)
    await open(page, 'audit', 'יומן פעולות')
    await expect(dayHeads(page)).toHaveText(shown(DAYS)) // no date: every entry

    await fromButton(page).click()
    await expect(day(startPicker(page), '14/10/2026'), 'an empty field opens on today').toBeFocused()
    await day(startPicker(page), '07/10/2026').click()
    await toButton(page).click()
    await day(endPicker(page), '12/10/2026').click()
    await expect(dayHeads(page)).toHaveText(shown(between('2026-10-07', '2026-10-12')))
    expect(asked.at(-1)).toMatchObject({ from: '2026-10-07', to: '2026-10-12' })

    await fromButton(page).focus()
    await page.keyboard.press('Enter')
    await walk(page, startPicker(page), [['PageUp', '07/09/2026'], ['ArrowDown', '14/09/2026'], ['ArrowDown', '21/09/2026'], ['ArrowLeft', '22/09/2026'], ['ArrowRight', '21/09/2026']])
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('מתאריך', { exact: true })).toHaveValue('21/09/2026')
    await expect(dayHeads(page)).toHaveText(shown(between('2026-09-21', '2026-10-12')))

    await toButton(page).click()
    await endPicker(page).getByRole('button', { name: 'החודש', exact: true }).click()
    await expect(page.getByLabel('מתאריך', { exact: true })).toHaveValue('01/10/2026')
    await expect(page.getByLabel('עד תאריך', { exact: true })).toHaveValue('14/10/2026')
    await expect(dayHeads(page)).toHaveText(shown(between('2026-10-01', '2026-10-14')))
    expect(asked.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-14' })
  })
})

test.describe('on a phone', () => {
  test('the calendar is a sheet from the bottom over the sheet of filters; a tap and a quick range set the dates that "show results" applies', async ({ page }) => {
    const asked = await stubScans(page)
    await open(page, 'history', 'היסטוריית נוכחות')
    await page.getByRole('button', { name: /^סינון/ }).click()
    const filters = page.getByRole('dialog', { name: 'סינון', exact: true })
    await expect(filters).toBeVisible()

    await fromButton(filters).click()
    const start = startPicker(page)
    await expect(start).toBeVisible()
    const { width, height } = page.viewportSize()
    const box = await start.boundingBox()
    expect(box.x, 'the whole width').toBeCloseTo(0, 0)
    expect(box.width).toBeCloseTo(width, 0)
    expect(box.y + box.height, 'at the bottom of the screen').toBeCloseTo(height, 0)
    await start.getByRole('button', { name: '30 יום', exact: true }).tap()
    await expect(start).toHaveCount(0)
    await expect(filters.getByLabel('מתאריך', { exact: true })).toHaveValue('15/09/2026')
    await expect(filters.getByLabel('עד תאריך', { exact: true })).toHaveValue('14/10/2026')

    await toButton(filters).click()
    await day(endPicker(page), '12/10/2026').tap()
    await expect(filters.getByLabel('עד תאריך', { exact: true })).toHaveValue('12/10/2026')
    expect(asked, 'nothing is asked for before "show results"').toHaveLength(1)
    await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
    await expect(filters).toHaveCount(0)
    await expect(dayHeads(page)).toHaveText(shown(between('2026-09-15', '2026-10-12')))
    expect(asked.at(-1)).toMatchObject({ from: '2026-09-15', to: '2026-10-12' })
  })

  test('at 320 px the open calendar fits: no sideways scroll, and every day is a 44 px target on the screen', async ({ page }) => {
    await page.setViewportSize(PHONE_320)
    await stubScans(page)
    await open(page, 'history', 'היסטוריית נוכחות')
    await page.getByRole('button', { name: /^סינון/ }).click()
    const filters = page.getByRole('dialog', { name: 'סינון', exact: true })
    await expect(filters).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the sheet of filters').toBeLessThanOrEqual(320)
    await toButton(filters).click()
    const end = endPicker(page)
    await expect(end).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the calendar').toBeLessThanOrEqual(320)
    const targets = await end.locator('.a-cal__day, .a-cal__nav, .a-cal__quick button').evaluateAll((all) => all.map((el) => {
      const r = el.getBoundingClientRect()
      return { name: el.getAttribute('aria-label') || el.textContent, left: r.left, right: r.right, width: r.width, height: r.height }
    }))
    expect(targets.length).toBe(31 + 2 + 4)
    for (const target of targets) {
      expect(target.width, `${target.name} is wide enough`).toBeGreaterThanOrEqual(44)
      expect(target.height, `${target.name} is tall enough`).toBeGreaterThanOrEqual(44)
      expect(target.left, `${target.name} is on the screen`).toBeGreaterThanOrEqual(0)
      expect(target.right, `${target.name} is on the screen`).toBeLessThanOrEqual(320)
    }
  })
})
