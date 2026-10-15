// The filters of the History tab and of the audit log (src/admin/filters.jsx). On a phone (below 1024 px, which both E2E devices are) they
// are a bar above the list (the button "סינון" with how many filters are on, the dates that are applied, and a chip for every other filter
// that is on) and a sheet from the bottom that holds the controls, which applies them when "הצגת תוצאות" is pressed. On a computer they are
// the block above the list, live, as they were. The other specs reach the controls through `changeFilters` (e2e/fixtures.js); this one is
// about the behaviour of the two layouts themselves.
//
// The History tab's list is answered here (`stubScans`) by what a real server does with the one filter that these tests change, and every
// request is kept, so a test can tell what the screen asked for and when. A real visit would be a provider signing in, and the run has a
// limited number of those (e2e/visual.spec.js says why); the filtering itself is the server's, and tests/read-filters.test.js covers it.
import { test, expect, adminSignIn, allowConsoleErrors, openFilters, setDate, expectDate } from './fixtures.js'
import { OUTCOME_ACCEPTED } from '../shared/contract.js'

const COMPUTER = { width: 1280, height: 800 }
const PHONE_360 = { width: 360, height: 740 }
// A tablet held upright: the filters are the bar and the sheet (below 1024 px), and the dates of the sheet still take typing (from 640 px;
// below it they are buttons that open the wheels, e2e/date-picker.spec.js).
const TABLET = { width: 768, height: 1024 }
const DAY = /^\d{2}\/\d{2}\/\d{4}$/

test.beforeEach(({ page }) => {
  // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
  allowConsoleErrors(page, /status of 401/)
})

const noHorizontalScroll = (page) => page.evaluate((width) => document.documentElement.scrollWidth <= width, page.viewportSize().width)

/** One visit as the list of the History tab holds it (the shape of `scanJson` in server/scans.js), at the point `point`. */
const visit = (n, point, who) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  checked_in_at: '2026-03-02T10:40:00.000Z',
  checked_in_local: '2026-03-02T10:40:00.000Z',
  local_date: '2026-03-02',
  point_id: point.id,
  point_name: point.name,
  provider_id: `00000000-0000-4000-8000-0000000002${n}0`,
  provider_name: who,
  service_type: 'cleaning',
  source: 'online',
  outcome: 'accepted',
  distance_m: null,
  gps_accuracy_m: null,
  flags: [],
  voided: false,
  void_reason: null,
})

/**
 * Answers the History tab's list with one visit at each of two real points ("לובי" and "מינוס 1"), narrowed by `point_id` the way the
 * server does, and keeps the query of every request (`asked`, as URLSearchParams). Call it after signing in and before opening the tab.
 */
async function stubScans(page) {
  const points = (await (await page.request.get('/api/admin/points')).json()).points
  const lobby = points.find((p) => p.name === 'לובי')
  const basement = points.find((p) => p.name === 'מינוס 1')
  const visits = [visit(1, lobby, 'פלוני (ניקיון)'), visit(2, basement, 'אלמוני (גינון)')]
  const asked = []
  await page.route(/\/api\/admin\/scans\?/, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    const scans = visits.filter((v) => !query.get('point_id') || v.point_id === query.get('point_id'))
    return route.fulfill({ json: { scans, next_cursor: null } })
  })
  return { asked, lobby, basement }
}

async function openHistory(page) {
  await page.goto('/admin#history')
  await expect(page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}

const apply = (sheet) => sheet.getByRole('button', { name: 'הצגת תוצאות' }).click()
/** The button of the bar: its name is "סינון", and then how many filters are on. */
const opener = (page) => page.getByRole('button', { name: /^סינון/ })
const chips = (page) => page.getByRole('button', { name: /^הסרת סינון/ })
const QUESTION = 'לסגור בלי להציג את התוצאות?'

test.describe('on a phone', () => {
  test('the History tab keeps its filters in a sheet, so that the first visit is on the first screen of a 360 px phone', async ({ page }) => {
    await page.setViewportSize(PHONE_360)
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    await stubScans(page)
    await openHistory(page)

    // no field of the filters is on the screen: one button, the dates that are applied, and the list under them
    await expect(page.getByLabel('מתאריך')).toHaveCount(0)
    await expect(page.getByLabel('נקודה')).toHaveCount(0)
    await expect(opener(page)).toHaveAccessibleName('סינון') // nothing differs from the defaults, so no count
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4} עד \d{2}\/\d{2}\/\d{4}/)).toBeVisible() // the range, written as every date is
    const row = page.getByRole('listitem').first()
    await expect(row).toBeVisible()
    const box = await row.boundingBox()
    const tabBar = await page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).boundingBox()
    expect(box.y + box.height, 'the first visit is whole on the first screen, above the tab bar').toBeLessThan(tabBar.y)
    expect(box.y, 'and it starts in the upper part of it (it started at 873 px when the filters were drawn above the list)').toBeLessThan(500)
    expect(await noHorizontalScroll(page), 'the History tab at 360 px').toBe(true)
  })

  test('nothing is applied until "show results"; then the count, the chips, the file, and reset', async ({ page }) => {
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    const { asked, lobby } = await stubScans(page)
    await openHistory(page)
    const rows = page.getByRole('listitem')
    await expect(rows).toHaveCount(2)
    const file = page.getByRole('link', { name: 'ייצוא ל-Excel' })
    await expect(chips(page)).toHaveCount(0)
    const asks = asked.length

    // choosing in the sheet asks for nothing, and the list behind it and the file stay as they were
    let sheet = await openFilters(page)
    await sheet.getByLabel('נקודה').selectOption({ label: 'לובי' })
    await page.waitForTimeout(600) // longer than the pause before a query on a computer, where the list follows the controls
    expect(asked, 'no request while the person chooses').toHaveLength(asks)
    await expect(rows).toHaveCount(2)
    expect(await file.getAttribute('href')).not.toContain('point_id')
    await apply(sheet)
    await expect(sheet).toHaveCount(0)

    // applied: the list, the chip (with a name that says what it removes), the count, and the file of the applied filters
    await expect(rows).toHaveCount(1)
    expect(asked.at(-1).get('point_id')).toBe(lobby.id)
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*1\s*פעילים$/)
    await expect(chips(page)).toHaveCount(1)
    const chip = page.getByRole('button', { name: 'הסרת סינון: נקודה: לובי' })
    await expect(chip).toHaveText('נקודה: לובי')
    expect(await file.getAttribute('href')).toContain(`point_id=${lobby.id}`)

    // more filters, and a range that is not the default: the count says how many differ (the dates count once), the range is in the bar
    sheet = await openFilters(page)
    await sheet.getByLabel('סוג').selectOption({ label: 'הכול' })
    await sheet.getByLabel('כולל חשבון דמו').check()
    await setDate(sheet, 'מתאריך', '01/01/2026') // on a phone, with the wheels
    await apply(sheet)
    await expect(sheet).toHaveCount(0)
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*4\s*פעילים$/)
    await expect(chips(page)).toHaveCount(3) // the point, the type and the demo account: the dates are in the bar, not a chip
    await expect(page.getByText(/01\/01\/2026 עד \d{2}\/\d{2}\/\d{4}/)).toBeVisible()
    expect(asked.at(-1).get('from')).toBe('2026-01-01')
    expect(asked.at(-1).get('outcome')).toBe('all')
    expect(asked.at(-1).get('include_demo')).toBe('true')

    // a chip's remove button applies at once
    await page.getByRole('button', { name: 'הסרת סינון: כולל חשבון דמו' }).click()
    await expect(chips(page)).toHaveCount(2)
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*3\s*פעילים$/)
    expect(asked.at(-1).get('include_demo')).toBeNull()
    expect(asked.at(-1).get('point_id')).toBe(lobby.id) // the others are kept

    // reset puts the defaults in the sheet, and nothing is applied until "show results" says so
    sheet = await openFilters(page)
    await sheet.getByRole('button', { name: 'איפוס' }).click()
    await expect(sheet.getByLabel('נקודה')).toHaveValue('')
    await expect(sheet.getByLabel('סוג')).toHaveValue(OUTCOME_ACCEPTED)
    await expectDate(sheet.getByLabel('מתאריך'), DAY)
    await expect(sheet.getByLabel('מתאריך')).not.toHaveText('01/01/2026')
    await expect(chips(page)).toHaveCount(2) // behind the sheet, as it was
    await apply(sheet)
    await expect(sheet).toHaveCount(0)
    await expect(chips(page)).toHaveCount(0)
    await expect(opener(page)).toHaveAccessibleName('סינון')
    await expect(rows).toHaveCount(2)
    expect(asked.at(-1).get('point_id')).toBeNull()

    // "show results" with nothing changed asks for nothing again (and does not bring up the loading state)
    const before = asked.length
    sheet = await openFilters(page)
    await apply(sheet)
    await expect(sheet).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(asked, 'no new request when nothing changed').toHaveLength(before)
  })

  test('closing the sheet keeps the applied filters; Esc and a tap outside ask first when something was chosen', async ({ page }) => {
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    const { asked, basement } = await stubScans(page)
    await openHistory(page)
    const rows = page.getByRole('listitem')
    await expect(rows).toHaveCount(2)
    const dialogs = page.getByRole('dialog')
    const question = page.getByRole('dialog', { name: QUESTION })

    // a filter is applied: the lobby only
    let sheet = await openFilters(page)
    await sheet.getByLabel('נקודה').selectOption({ label: 'לובי' })
    await apply(sheet)
    await expect(rows).toHaveCount(1)
    const asks = asked.length

    // nothing chosen: Esc closes it at once, with no question
    await openFilters(page)
    await page.keyboard.press('Escape')
    await expect(dialogs).toHaveCount(0)

    // something chosen: the close button is the person's choice, so it closes at once, and the applied filters stay
    sheet = await openFilters(page)
    await sheet.getByLabel('נקודה').selectOption({ label: 'מינוס 1' })
    await sheet.getByRole('button', { name: 'סגירה' }).click()
    await expect(dialogs).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'הסרת סינון: נקודה: לובי' })).toBeVisible()
    await expect(rows).toHaveCount(1)

    // Esc asks, "back to the filters" keeps the sheet and what was chosen in it, and the second Esc asks again
    sheet = await openFilters(page)
    await sheet.getByLabel('נקודה').selectOption({ label: 'מינוס 1' })
    await page.keyboard.press('Escape')
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'חזרה לסינון' }).click()
    await expect(question).toHaveCount(0)
    await expect(sheet.getByLabel('נקודה')).toHaveValue(basement.id)
    await page.keyboard.press('Escape')
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'סגירה בלי להציג' }).click()
    await expect(dialogs).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'הסרת סינון: נקודה: לובי' })).toBeVisible()

    // a tap on the dark part outside the sheet asks the same
    sheet = await openFilters(page)
    await sheet.getByLabel('נקודה').selectOption({ label: 'מינוס 1' })
    await page.mouse.click(5, 5)
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'חזרה לסינון' }).click()
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'סגירה' }).click()
    await expect(dialogs).toHaveCount(0)
    expect(asked, 'closing without applying never asked for anything').toHaveLength(asks)
    await expect(rows).toHaveCount(1)
  })

  // Only a field that takes typing can hold half a date: the sheet of a tablet (on a phone the dates are chosen on the wheels, which give whole
  // dates only).
  test('a date that is not finished is never applied quietly: the sheet says so, under the field, and keeps the focus there', async ({ page }) => {
    await page.setViewportSize(TABLET)
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    const { asked } = await stubScans(page)
    await openHistory(page)
    await expect(page.getByRole('listitem')).toHaveCount(2)
    const sheet = await openFilters(page)
    const from = sheet.getByLabel('מתאריך')
    const original = await from.inputValue()
    const asks = asked.length

    // half a date: "show results" refuses it, the message is tied to the field, and nothing was asked for
    await from.press('End')
    for (let i = 0; i < 6; i++) await from.press('Backspace')
    await expect(from).toHaveValue(/^\d{2}$/)
    await apply(sheet)
    await expect(sheet).toBeVisible()
    const message = sheet.getByRole('alert')
    await expect(message).toContainText('התאריך לא תקין')
    await expect(from).toBeFocused()
    await expect(from).toHaveAttribute('aria-invalid', 'true')
    const described = await from.getAttribute('aria-describedby')
    expect(await message.getAttribute('id'), 'the message is the description of the field').toBe(described)
    await page.waitForTimeout(600)
    expect(asked, 'the half date was not applied').toHaveLength(asks)

    // Enter in the field is "show results": the same refusal
    await from.press('Enter')
    await expect(sheet).toBeVisible()
    await expect(message).toBeVisible()

    // finishing the date takes the message away, and Enter applies it
    await from.pressSequentially(original.replace(/\D/g, '').slice(2))
    await expect(from).toHaveValue(original)
    await expect(sheet.getByRole('alert')).toHaveCount(0)
    await from.fill('')
    await from.pressSequentially('01012026')
    await from.press('Enter')
    await expect(sheet).toHaveCount(0)
    expect(asked.at(-1).get('from')).toBe('2026-01-01')
    await expect(page.getByText(/01\/01\/2026 עד \d{2}\/\d{2}\/\d{4}/)).toBeVisible()

    // a half-typed date is unsaved typing (F4): Esc asks, and reset takes it away with the rest
    const again = await openFilters(page)
    const field = again.getByLabel('מתאריך')
    await field.fill('')
    await field.pressSequentially('0101')
    await expect(field).toHaveValue('01/01')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'חזרה לסינון' }).click()
    await again.getByRole('button', { name: 'איפוס' }).click()
    await expect(field).toHaveValue(original)
    await expect(again.getByRole('alert')).toHaveCount(0)
  })

  // From 640 px a Modal is a centred dialog, but a sheet stays at the bottom of the screen: the sheet under "עוד" does at every width, and
  // the filters' sheet must be the same sheet (a tablet held upright is 768 px wide, a phone held sideways 740).
  test('at 768 px the filters sheet is the same sheet as the one under "עוד": at the bottom, 480 px wide, top corners only', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    await stubScans(page)
    await openHistory(page)
    const measure = (dialog) => dialog.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return { bottom: Math.round(box.bottom), width: Math.round(box.width), middle: Math.round(box.left + box.width / 2), corners: getComputedStyle(el).borderRadius }
    })

    const filters = await openFilters(page)
    const ofFilters = await measure(filters)
    await filters.getByRole('button', { name: 'סגירה' }).click()
    await page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true }).click()
    const more = page.getByRole('dialog', { name: 'עוד', exact: true })
    await expect(more).toBeVisible()
    const ofMore = await measure(more)

    expect(ofMore.bottom, 'the sheet under "עוד" is at the bottom of the screen').toBe(1024)
    expect(ofFilters.bottom, 'so is the filters sheet').toBe(1024)
    expect(ofFilters.width).toBe(480)
    expect(ofFilters.middle, 'in the middle of the screen').toBe(384)
    expect(ofFilters.corners, 'only its top corners are round').toMatch(/^\d+px \d+px 0px 0px$/)
    expect(ofFilters, 'the same width, place and corners as the other sheet').toEqual(ofMore)
  })

  test('on a phone held sideways the filters sheet keeps its buttons on the screen and scrolls its fields', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 360 })
    await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
    await stubScans(page)
    await openHistory(page)
    const sheet = await openFilters(page)
    const box = await sheet.boundingBox()
    expect(box.y + box.height, 'at the bottom of the screen').toBeCloseTo(360, 0)
    expect(box.y, 'and not taller than the screen').toBeGreaterThan(0)
    for (const name of ['הצגת תוצאות', 'איפוס', 'סגירה']) {
      const button = await sheet.getByRole('button', { name }).boundingBox()
      expect(button.y, `${name}: inside the screen, top`).toBeGreaterThanOrEqual(0)
      expect(button.y + button.height, `${name}: inside the screen, bottom`).toBeLessThanOrEqual(360)
    }
    // the fields scroll under the head and above the buttons: the last switch can be reached
    const scrolls = await sheet.locator('form').evaluate((form) => form.parentElement.scrollHeight > form.parentElement.clientHeight)
    expect(scrolls, 'the body of the sheet scrolls').toBe(true)
    const last = sheet.getByLabel('כולל חשבון דמו')
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeVisible()
    const lastBox = await last.boundingBox()
    const apply = await sheet.getByRole('button', { name: 'הצגת תוצאות' }).boundingBox()
    expect(lastBox.y + lastBox.height, 'the last switch ends above the buttons').toBeLessThanOrEqual(apply.y + 0.5)
  })

  test('the audit log has the same bar and sheet', async ({ page }) => {
    await adminSignIn(page, 'audit') // the audit log is a screen of its own
    const me = (await (await page.request.get('/api/admin/me')).json()).admin
    const log = page.getByRole('main')
    await expect(log.getByRole('listitem').first()).toBeVisible()

    // the bar: no filters are on, the range is every date, and the controls are not on the screen
    await expect(log.getByText('כל התאריכים')).toBeVisible()
    await expect(opener(page)).toHaveAccessibleName('סינון')
    await expect(page.getByLabel('סוג פעולה')).toHaveCount(0)
    await expect(page.getByLabel('מנהל מערכת', { exact: true })).toHaveCount(0) // (not the button "מנהל מערכת חדש")

    let sheet = await openFilters(page)
    await sheet.getByLabel('סוג פעולה').selectOption({ label: 'נקודות' })
    await sheet.getByLabel('מנהל מערכת').selectOption({ label: me.name })
    await apply(sheet)
    await expect(sheet).toHaveCount(0)
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*2\s*פעילים$/)
    await expect(page.getByRole('button', { name: 'הסרת סינון: סוג פעולה: נקודות' })).toBeVisible()
    await expect(page.getByRole('button', { name: `הסרת סינון: מנהל מערכת: ${me.name}` })).toBeVisible()

    // a range: the bar says it, and it counts once; a chip removes its filter at once
    sheet = await openFilters(page)
    await setDate(sheet, 'מתאריך', '01/01/2026') // on a phone, with the wheels
    await apply(sheet)
    await expect(log.getByText(/מ-01\/01\/2026/)).toBeVisible()
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*3\s*פעילים$/)
    await page.getByRole('button', { name: 'הסרת סינון: סוג פעולה: נקודות' }).click()
    await expect(chips(page)).toHaveCount(1)
    await expect(opener(page)).toHaveAccessibleName(/^סינון\s*2\s*פעילים$/)

    // reset, then show results: every filter is off again
    sheet = await openFilters(page)
    await sheet.getByRole('button', { name: 'איפוס' }).click()
    await expectDate(sheet.getByLabel('מתאריך'), '')
    await apply(sheet)
    await expect(chips(page)).toHaveCount(0)
    await expect(log.getByText('כל התאריכים')).toBeVisible()
    expect(await noHorizontalScroll(page), 'the audit log on a phone').toBe(true)
  })
})

test('on a computer the filters stay inline and live, each control is in the page once, and the layout follows the width of the window', async ({ page }) => {
  await adminSignIn(page, 'points') // not on the History tab: its list is asked for after the stub is in place
  await page.setViewportSize(COMPUTER)
  const { asked, lobby, basement } = await stubScans(page)
  await openHistory(page)
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveCount(2)

  // the block above the list, and nothing of the phone's: no button, no sheet, and every control once (the page has no second copy)
  await expect(opener(page)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  for (const label of ['מתאריך', 'עד תאריך', 'נקודה', 'נותן שירות', 'סוג', 'כולל מבוטלות', 'כולל חשבון דמו']) {
    await expect(page.getByLabel(label, { exact: true }), `${label} is in the page once`).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: 'הצגת תוצאות' })).toHaveCount(0)

  // live: the list follows the control, with nothing to press
  await page.getByLabel('נקודה').selectOption({ label: 'לובי' })
  await expect(rows).toHaveCount(1)
  expect(asked.at(-1).get('point_id')).toBe(lobby.id)

  // a date that is half typed in the inline fields keeps the computer's layout below 1024 px, with the same field and its text, until it is
  // finished: the text lives in the field, which the phone's layout would unmount
  const inlineFrom = page.getByLabel('מתאריך')
  const original = await inlineFrom.inputValue()
  await inlineFrom.press('End')
  for (let i = 0; i < 6; i++) await inlineFrom.press('Backspace')
  await expect(inlineFrom).toHaveValue(/^\d{2}$/)
  await page.setViewportSize({ width: 390, height: 800 })
  await expect(inlineFrom).toHaveValue(/^\d{2}$/)
  await expect(opener(page)).toHaveCount(0)
  await inlineFrom.pressSequentially(original.replace(/\D/g, '').slice(2))
  await expect(opener(page)).toBeVisible() // finished: the layout follows the window
  await expect(page.getByLabel('מתאריך')).toHaveCount(0)
  await page.setViewportSize(COMPUTER)
  await expect(page.getByLabel('מתאריך')).toHaveValue(original)

  // narrower than 1024 px, with no reload: the controls go, and the bar says what is applied (a tablet held upright, whose sheet takes typed
  // dates: below 640 px the dates of the sheet are the buttons of the wheels, which hold no half-typed date)
  await page.setViewportSize(TABLET)
  await expect(page.getByLabel('מתאריך')).toHaveCount(0)
  await expect(opener(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'הסרת סינון: נקודה: לובי' })).toBeVisible()
  await expect(rows).toHaveCount(1)
  // a sheet that is open when the window crosses 1024 px (a tablet that is turned) stays, with what was chosen and a date that was half
  // typed: closing it would lose both without the question that Esc asks (F4). The inline controls are behind it.
  const sheet = await openFilters(page)
  await sheet.getByLabel('נקודה').selectOption({ label: 'מינוס 1' })
  const from = sheet.getByLabel('מתאריך')
  await from.press('End')
  for (let i = 0; i < 6; i++) await from.press('Backspace')
  await expect(from).toHaveValue(/^\d{2}$/)
  await page.setViewportSize(COMPUTER)
  await expect(sheet).toBeVisible()
  await expect(sheet.getByLabel('נקודה')).toHaveValue(basement.id)
  await expect(from).toHaveValue(/^\d{2}$/)
  await expect(opener(page)).toHaveCount(0) // the bar is gone, the inline controls are behind the sheet
  await expect(page.getByLabel('נקודה')).toHaveCount(2)
  await page.setViewportSize(TABLET)
  await expect(sheet.getByLabel('נקודה')).toHaveValue(basement.id) // and back: still there
  await page.setViewportSize(COMPUTER)
  await page.keyboard.press('Escape') // it is as unsaved as on a phone: Esc asks first
  const question = page.getByRole('dialog', { name: QUESTION })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'סגירה בלי להציג' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('נקודה')).toHaveValue(lobby.id) // the same filters, inline again, one copy
  await expect(page.getByLabel('מתאריך', { exact: true })).toHaveCount(1)
  // the button that opened the sheet went with the bar: the focus is not lost on the body. It is on the first inline field where the browser
  // focused that button when it was clicked (Chromium), and on the main of the page where it had not (WebKit does not focus a clicked button,
  // so the element that had the focus when the sheet opened was the main, which is still there: tests/components/filter-sheet.test.jsx has the
  // exact place for each case)
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  if (test.info().project.name === 'android-chrome') await expect(page.getByLabel('מתאריך', { exact: true })).toBeFocused()

  // the audit log, on a computer: inline, once
  await page.goto('/admin#audit')
  await expect(page.getByRole('heading', { level: 1, name: 'יומן פעולות', exact: true })).toBeVisible()
  const log = page.getByRole('main')
  await expect(log.getByRole('listitem').first()).toBeVisible()
  await expect(opener(page)).toHaveCount(0)
  for (const label of ['מתאריך', 'עד תאריך', 'סוג פעולה', 'מנהל מערכת']) await expect(page.getByLabel(label, { exact: true })).toHaveCount(1)
  expect(await noHorizontalScroll(page), 'the audit log on a computer').toBe(true)
})
