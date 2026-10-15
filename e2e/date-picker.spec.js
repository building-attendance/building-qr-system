// The committee app's own date picker (src/admin/DatePicker.jsx, owner decisions of 14/10/2026 and 15/10/2026) in a real browser: every date
// filter of the History tab and of the audit log has a picker, with the quick ranges under it. From 640 px it is a month grid, a popover beside
// its field (on a computer, and over the sheet of filters of a tablet); below 640 px (a phone, both E2E devices) the field is a button that
// opens three wheels, the year, the month and the day, in a sheet from the bottom, and the two dates share a row of the sheet of filters. The
// component tests (tests/components/date-picker.test.jsx, tests/components/date-wheels.test.jsx) have every key and every state; this spec
// checks what only a browser decides: the keys as the browser sends them in a right-to-left page, the place of the popover and of the sheets,
// a tap, a scroll of a wheel, the reflow at 360 and 320 px, and the list that a range really asks for.
//
// The clock of the page is fixed at 12:00 on 14/10/2026 in the building (a Wednesday), so the grid and the quick ranges are known. The two
// lists are answered here (`stubScans`, `stubAudit`) with a fixed set of days, narrowed by `from` and `to` the way the server narrows them
// (tests/read-filters.test.js covers the server's own filtering): a real visit would be a provider signing in, and the run has a limited
// number of those (e2e/visual.spec.js says why).
import { test, expect, ADMIN_EMAIL, dateWheels, wheel, turnWheels } from './fixtures.js'

// No service worker: this spec answers the lists itself (page.route), and a page that a service worker controls would not give it those requests.
test.use({ serviceWorkers: 'block' })

const NOW = new Date('2026-10-14T09:00:00Z') // 12:00 on 14/10/2026 in the building
const COMPUTER = { width: 1280, height: 800 }
const TABLET = { width: 768, height: 1024 }
// The phone of the committee's pictures, and the narrowest one that the app is checked at.
const PHONES = [{ width: 360, height: 740 }, { width: 320, height: 568 }]
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

// From 640 px the calendar is a popover even over the sheet of filters, which a tablet has below 1024 px.
test.describe('on a tablet', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET)
  })

  test('the calendar is a popover over the sheet of filters; a tap and a quick range set the dates that "show results" applies', async ({ page }) => {
    const asked = await stubScans(page)
    await open(page, 'history', 'היסטוריית נוכחות')
    await page.getByRole('button', { name: /^סינון/ }).click()
    const filters = page.getByRole('dialog', { name: 'סינון', exact: true })
    await expect(filters).toBeVisible()

    await fromButton(filters).click()
    const start = startPicker(page)
    await expect(start).toBeVisible()
    // a popover beside its field: under it, its start (the right edge in Hebrew) at the field's
    const field = await filters.locator('.a-date').first().boundingBox()
    const box = await start.boundingBox()
    expect(box.y, 'under the field').toBeGreaterThanOrEqual(field.y + field.height)
    expect(Math.abs(box.x + box.width - (field.x + field.width)), 'its right edge at the right edge of the field').toBeLessThanOrEqual(1)
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
})

/** Opens the sheet of filters of the screen that is open, and returns it. */
async function openSheet(page) {
  await page.getByRole('button', { name: /^סינון/ }).click()
  const filters = page.getByRole('dialog', { name: 'סינון', exact: true })
  await expect(filters).toBeVisible()
  return filters
}

const fromField = (scope) => scope.getByLabel('מתאריך', { exact: true })
const toField = (scope) => scope.getByLabel('עד תאריך', { exact: true })
const chosenDay = (wheels) => wheel(wheels, 'יום').getByRole('option', { selected: true })
const noSidewaysScroll = (page) => page.evaluate((width) => document.documentElement.scrollWidth <= width, page.viewportSize().width)

// The wheels of a phone (owner decision of 15/10/2026), at the two widths of a phone that the app is checked at.
for (const size of PHONES) {
  test.describe(`on a phone, ${size.width} px wide`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size)
    })

    test('the two dates share a row of the sheet of filters, each a button with its date and the calendar inside it: no text field, no keyboard', async ({ page }) => {
      await stubScans(page)
      await open(page, 'history', 'היסטוריית נוכחות')
      const filters = await openSheet(page)
      const [from, to] = [fromField(filters), toField(filters)]
      await expect(from).toHaveText('08/10/2026') // the default week
      await expect(to).toHaveText('14/10/2026')
      await expect(from).toHaveAccessibleName('מתאריך 08/10/2026')
      await expect(to).toHaveAccessibleName('עד תאריך 14/10/2026')
      // a button, not a field to type in: nothing in the sheet takes text, so no keyboard comes up
      for (const field of [from, to]) {
        expect(await field.evaluate((el) => [el.tagName, el.getAttribute('type'), el.getAttribute('aria-haspopup')])).toEqual(['BUTTON', 'button', 'dialog'])
      }
      await expect(filters.locator('input:not([type="checkbox"])')).toHaveCount(0)
      // one row: the same height on the screen, "מתאריך" at the right (Hebrew), each about half of the sheet, inside it
      const sheetBox = await filters.locator('form').boundingBox()
      const [a, b] = [await from.boundingBox(), await to.boundingBox()]
      expect(Math.abs(a.y - b.y), 'in one row').toBeLessThanOrEqual(0.5)
      expect(a.x, '"מתאריך" first, at the right').toBeGreaterThan(b.x + b.width)
      for (const box of [a, b]) {
        expect(box.width, 'about half of the sheet').toBeGreaterThan(sheetBox.width * 0.45)
        expect(box.width).toBeLessThan(sheetBox.width * 0.5)
        expect(box.height, 'a 44 px target').toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(sheetBox.x - 0.5)
        expect(box.x + box.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 0.5)
      }
      // the whole date fits beside the calendar, which is inside the field at its end (the left in Hebrew)
      for (const field of [from, to]) {
        const parts = await field.evaluate((el) => {
          const box = el.getBoundingClientRect()
          const text = el.firstElementChild
          const icon = el.querySelector('svg').getBoundingClientRect()
          const shown = text.getBoundingClientRect()
          return { cut: text.scrollWidth > text.clientWidth + 0.5, box: [box.left, box.right], icon: [icon.left, icon.right], text: [shown.left, shown.right] }
        })
        expect(parts.cut, 'the date is not cut').toBe(false)
        expect(parts.icon[0], 'the calendar is inside the field').toBeGreaterThanOrEqual(parts.box[0])
        expect(parts.icon[1], 'at its end, left of the date').toBeLessThanOrEqual(parts.text[0])
        expect(parts.text[1]).toBeLessThanOrEqual(parts.box[1])
      }
      expect(await noSidewaysScroll(page), 'the sheet of filters').toBe(true)

      // a tap on the field opens the wheels and puts the focus on an option, never on a field that takes text
      await from.tap()
      const wheels = dateWheels(page)
      await expect(chosenDay(wheels)).toBeFocused()
      expect(await page.evaluate(() => document.activeElement.matches('input, textarea, [contenteditable]'))).toBe(false)
    })

    test('the wheels fit: a sheet at the bottom, the whole width, every row and button a 44 px target on the screen, and no sideways scroll', async ({ page }) => {
      await stubScans(page)
      await open(page, 'history', 'היסטוריית נוכחות')
      const filters = await openSheet(page)
      await toField(filters).click()
      const wheels = dateWheels(page)
      await expect(wheels).toBeVisible()
      await expect(wheels).toHaveAccessibleName('תאריך סיום')
      const box = await wheels.boundingBox()
      expect(box.x, 'the whole width').toBeCloseTo(0, 0)
      expect(box.width).toBeCloseTo(size.width, 0)
      expect(box.y + box.height, 'at the bottom of the screen').toBeCloseTo(size.height, 0)
      expect(box.y, 'and all of it on the screen').toBeGreaterThanOrEqual(0)
      expect(await noSidewaysScroll(page), 'the wheels').toBe(true)
      // the three wheels, from the right: the year, the month, the day
      const lists = await wheels.getByRole('listbox').evaluateAll((all) => all.map((el) => ({ name: el.getAttribute('aria-label'), left: el.getBoundingClientRect().left })))
      expect(lists.map((l) => l.name)).toEqual(['שנה', 'חודש', 'יום'])
      expect(lists[0].left > lists[1].left && lists[1].left > lists[2].left, 'right to left').toBe(true)
      // the chosen rows stand in the band, in one line across the three wheels, and every target is 44 px and on the screen
      const chosen = await wheels.getByRole('option', { selected: true }).evaluateAll((all) => all.map((el) => el.getBoundingClientRect().top))
      expect(Math.max(...chosen) - Math.min(...chosen), 'the chosen rows in one line').toBeLessThanOrEqual(0.5)
      const targets = await wheels.locator('[role="option"][aria-selected="true"], button').evaluateAll((all) => all.map((el) => {
        const r = el.getBoundingClientRect()
        return { name: el.getAttribute('aria-label') || el.textContent, left: r.left, right: r.right, width: r.width, height: r.height }
      }))
      expect(targets.length).toBe(3 + 1 + 4 + 2) // the chosen rows, the close button, the quick ranges, "ניקוי התאריך" and "אישור"
      for (const target of targets) {
        expect(target.width, `${target.name} is wide enough`).toBeGreaterThanOrEqual(44)
        expect(target.height, `${target.name} is tall enough`).toBeGreaterThanOrEqual(44)
        expect(target.left, `${target.name} is on the screen`).toBeGreaterThanOrEqual(0)
        expect(target.right, `${target.name} is on the screen`).toBeLessThanOrEqual(size.width)
      }
    })

    test('History: a range chosen with the wheels by touch, and the list shows exactly the visits of the range', async ({ page }) => {
      const asked = await stubScans(page)
      await open(page, 'history', 'היסטוריית נוכחות')
      const filters = await openSheet(page)

      await fromField(filters).tap()
      let wheels = dateWheels(page)
      await turnWheels(wheels, '20/09/2026', 'tap')
      await wheels.getByRole('button', { name: 'אישור', exact: true }).tap()
      await expect(wheels).toHaveCount(0)
      await expect(fromField(filters)).toHaveText('20/09/2026')
      await expect(fromField(filters)).toBeFocused()

      await toField(filters).tap()
      wheels = dateWheels(page)
      await expect(chosenDay(wheels)).toHaveAccessibleName('14/10/2026')
      await turnWheels(wheels, '07/10/2026', 'tap')
      await wheels.getByRole('button', { name: 'אישור', exact: true }).tap()
      await expect(toField(filters)).toHaveText('07/10/2026')
      expect(asked, 'nothing is asked for before "show results"').toHaveLength(1)

      await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
      await expect(filters).toHaveCount(0)
      await expect(page.getByText('20/09/2026 עד 07/10/2026')).toBeVisible() // the bar says the range
      await expect(dayHeads(page)).toHaveText(shown(between('2026-09-20', '2026-10-07')))
      expect(asked.at(-1)).toMatchObject({ from: '2026-09-20', to: '2026-10-07' })
      expect(await noSidewaysScroll(page)).toBe(true)
    })

    test('the audit log: a range chosen with the keyboard and a quick range, and the log shows exactly the entries of each', async ({ page }) => {
      const asked = await stubAudit(page)
      await open(page, 'audit', 'יומן פעולות')
      await expect(dayHeads(page)).toHaveText(shown(DAYS)) // no date: every entry
      let filters = await openSheet(page)
      await expect(fromField(filters)).toHaveAccessibleName('מתאריך לא נבחר')

      // an empty field opens on today; the keys move the day (up is earlier), Shift+Tab reaches the month, and Enter is "אישור"
      await fromField(filters).focus()
      await page.keyboard.press('Enter')
      let wheels = dateWheels(page)
      await expect(chosenDay(wheels)).toBeFocused()
      await expect(chosenDay(wheels)).toHaveAccessibleName('14/10/2026')
      for (const [key, name] of [['PageUp', '09/10/2026'], ['ArrowUp', '08/10/2026'], ['ArrowUp', '07/10/2026'], ['ArrowDown', '08/10/2026'], ['ArrowUp', '07/10/2026']]) {
        await page.keyboard.press(key)
        await expect(chosenDay(wheels), `${key} goes to ${name}`).toHaveAccessibleName(name)
        await expect(chosenDay(wheels)).toBeFocused()
      }
      await page.keyboard.press('End')
      await expect(chosenDay(wheels), 'End: the last day that can be chosen, today').toHaveAccessibleName('14/10/2026')
      await page.keyboard.press('Home')
      await expect(chosenDay(wheels)).toHaveAccessibleName('01/10/2026')
      await page.keyboard.press('Shift+Tab')
      const month = wheel(wheels, 'חודש').getByRole('option', { selected: true })
      await expect(month).toBeFocused()
      await expect(month).toHaveAccessibleName('אוקטובר, חודש 10')
      await page.keyboard.press('ArrowUp')
      await expect(month).toHaveAccessibleName('ספטמבר, חודש 9')
      await expect(chosenDay(wheels)).toHaveAccessibleName('01/09/2026')
      await page.keyboard.press('Enter')
      await expect(wheels).toHaveCount(0)
      await expect(fromField(filters)).toBeFocused()
      await expect(fromField(filters)).toHaveText('01/09/2026')
      await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
      await expect(dayHeads(page)).toHaveText(shown(between('2026-09-01', '')))
      expect(asked.at(-1)).toMatchObject({ from: '2026-09-01' })

      // Esc leaves the field as it was
      filters = await openSheet(page)
      await fromField(filters).focus()
      await page.keyboard.press('Enter')
      wheels = dateWheels(page)
      await page.keyboard.press('ArrowDown')
      await expect(chosenDay(wheels)).toHaveAccessibleName('02/09/2026')
      await page.keyboard.press('Escape')
      await expect(wheels).toHaveCount(0)
      await expect(fromField(filters)).toHaveText('01/09/2026')
      await expect(fromField(filters)).toBeFocused()

      // a quick range sets both dates at once
      await toField(filters).tap()
      await dateWheels(page).getByRole('button', { name: '7 ימים', exact: true }).tap()
      await expect(dateWheels(page)).toHaveCount(0)
      await expect(fromField(filters)).toHaveText('08/10/2026')
      await expect(toField(filters)).toHaveText('14/10/2026')
      await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
      await expect(dayHeads(page)).toHaveText(shown(between('2026-10-08', '2026-10-14')))
      expect(asked.at(-1)).toMatchObject({ from: '2026-10-08', to: '2026-10-14' })
    })

    // A drag of a finger. Chromium moves one through the touch events of the DevTools protocol, and turns a wheel of a mouse too. Playwright moves
    // no finger in WebKit and has no mouse wheel on a phone there, so in WebKit the page sends the wheel the two touches that frame a scroll and
    // makes the scroll itself: the snap to a row and the choice of the row in the band are still the browser's and the picker's.
    test('a drag of a wheel chooses the row that stops in the band, and a row after today sends it back', async ({ page, browserName }) => {
      await stubScans(page)
      await open(page, 'history', 'היסטוריית נוכחות')
      const filters = await openSheet(page)
      await fromField(filters).tap()
      const wheels = dateWheels(page)
      const days = wheel(wheels, 'יום')
      await expect(chosenDay(wheels)).toHaveAccessibleName('08/10/2026')
      const inBand = () => days.evaluate((list) => {
        const band = list.getBoundingClientRect().top + list.clientHeight / 2
        const row = [...list.querySelectorAll('[role="option"]')].find((el) => {
          const r = el.getBoundingClientRect()
          return r.top <= band && r.bottom > band
        })
        return row?.getAttribute('aria-label')
      })
      const box = await days.boundingBox()
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
      /** Turns the day wheel by about `rows` rows: up the list (earlier days) when it is negative. A finger stays on the wheel (220 px), so three rows at a time. */
      const drag = async (rows) => {
        if (Math.abs(rows) > 3) {
          for (let left = rows; left !== 0; left -= Math.sign(left) * Math.min(3, Math.abs(left))) await drag(Math.sign(left) * Math.min(3, Math.abs(left)))
          return
        }
        if (browserName === 'chromium') {
          const cdp = await page.context().newCDPSession(page)
          const touch = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: at }] })
          const distance = -rows * 44 // a finger that moves down brings the earlier days down into the band
          await touch('touchStart', y - distance / 2)
          for (let step = 1; step <= 10; step++) {
            await touch('touchMove', y - distance / 2 + (distance * step) / 10)
            await page.waitForTimeout(16)
          }
          await page.waitForTimeout(200) // the finger rests before it lifts: no fling
          await touch('touchEnd', y + distance / 2)
          await cdp.detach()
        } else {
          await days.dispatchEvent('touchstart')
          await days.evaluate((list, by) => { list.scrollTop += by }, rows * 44)
          await days.dispatchEvent('touchend')
        }
      }

      await drag(-3)
      await expect.poll(async () => (await chosenDay(wheels).getAttribute('aria-label')) !== '08/10/2026', { message: 'the wheel chose another day' }).toBe(true)
      await expect.poll(async () => (await inBand()) === (await chosenDay(wheels).getAttribute('aria-label')), { message: 'the chosen day is the one in the band' }).toBe(true)
      expect(await chosenDay(wheels).getAttribute('aria-label') < '08/10/2026', 'an earlier day').toBe(true)
      // down past today: the 14th is the last day that can be chosen, and the wheel comes back to it
      await drag(12)
      await expect(chosenDay(wheels)).toHaveAccessibleName('14/10/2026')
      await expect.poll(inBand, { message: 'back in the band' }).toBe('14/10/2026')
      if (browserName === 'chromium') { // a wheel of a mouse turns it too (a computer's window narrower than 640 px)
        await page.mouse.move(x, y)
        await page.mouse.wheel(0, -2 * 44)
        await expect(chosenDay(wheels)).not.toHaveAccessibleName('14/10/2026')
        await expect.poll(async () => (await inBand()) === (await chosenDay(wheels).getAttribute('aria-label')), { message: 'the chosen day is the one in the band' }).toBe(true)
      }
      const chosen = await chosenDay(wheels).getAttribute('aria-label')
      await wheels.getByRole('button', { name: 'אישור', exact: true }).click()
      await expect(fromField(filters)).toHaveText(chosen)
    })

    test('the audit log: a date is chosen, then cleared alone, and the log widens back with the other filters kept', async ({ page }) => {
      const asked = await stubAudit(page)
      await open(page, 'audit', 'יומן פעולות')
      await expect(dayHeads(page)).toHaveText(shown(DAYS)) // no date: every entry
      // an empty field has nothing to clear
      let filters = await openSheet(page)
      await fromField(filters).tap()
      let wheels = dateWheels(page)
      await expect(wheels.getByRole('button', { name: 'ניקוי התאריך', exact: true })).toHaveCount(0)
      await turnWheels(wheels, '09/10/2026', 'tap')
      await wheels.getByRole('button', { name: 'אישור', exact: true }).tap()
      await filters.getByLabel('מנהל מערכת', { exact: true }).selectOption({ index: 1 }) // another filter, which clearing the date must keep
      const member = await filters.getByLabel('מנהל מערכת', { exact: true }).inputValue()
      await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
      await expect(dayHeads(page)).toHaveText(shown(between('2026-10-09', '')))
      expect(asked.at(-1)).toMatchObject({ from: '2026-10-09', actor_id: member })

      // the date is cleared: the field shows its placeholder again, the member stays, and the log has every day again
      filters = await openSheet(page)
      await fromField(filters).tap()
      wheels = dateWheels(page)
      const clear = wheels.getByRole('button', { name: 'ניקוי התאריך', exact: true })
      const ok = wheels.getByRole('button', { name: 'אישור', exact: true })
      const [a, b] = [await clear.boundingBox(), await ok.boundingBox()]
      expect(Math.abs(a.y - b.y), 'beside "אישור", in one row').toBeLessThanOrEqual(0.5)
      expect(a.x, 'before it, at the right').toBeGreaterThan(b.x)
      await clear.tap()
      await expect(wheels).toHaveCount(0)
      await expect(fromField(filters)).toHaveAccessibleName('מתאריך לא נבחר')
      await expect(fromField(filters)).toBeFocused()
      await expect(filters.getByLabel('מנהל מערכת', { exact: true })).toHaveValue(member)
      await filters.getByRole('button', { name: 'הצגת תוצאות' }).click()
      await expect(dayHeads(page)).toHaveText(shown(DAYS))
      expect(asked.at(-1)).toMatchObject({ actor_id: member })
      expect(asked.at(-1)).not.toHaveProperty('from')
      await expect(page.getByText('כל התאריכים')).toBeVisible()
    })

    test('a link to the History tab still sets the two dates, and the wheels open on them', async ({ page }) => {
      const asked = await stubScans(page)
      await page.clock.setFixedTime(NOW)
      const login = await page.request.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })
      expect(login.ok()).toBeTruthy()
      await page.goto('/admin#history?from=2026-09-01&to=2026-09-30')
      await expect(page.getByText('01/09/2026 עד 30/09/2026')).toBeVisible() // the bar
      await expect(dayHeads(page)).toHaveText(shown(between('2026-09-01', '2026-09-30')))
      expect(asked[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
      const filters = await openSheet(page)
      await expect(fromField(filters)).toHaveText('01/09/2026')
      await expect(toField(filters)).toHaveText('30/09/2026')
      await toField(filters).tap()
      const wheels = dateWheels(page)
      await expect(chosenDay(wheels)).toHaveAccessibleName('30/09/2026')
      await expect(wheel(wheels, 'חודש').getByRole('option', { selected: true })).toHaveText('ספטמבר')
      await expect(wheel(wheels, 'שנה').getByRole('option', { selected: true })).toHaveText('2026')
    })
  })
}
