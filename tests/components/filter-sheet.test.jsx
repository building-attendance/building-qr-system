// @vitest-environment jsdom
// The filters of the History tab and of the audit log on a phone (src/admin/filters.jsx): a bar above the list (the button, the applied
// dates, a chip for every other filter that is on) and a sheet from the bottom that applies the filters when "show results" is pressed.
// The real views, with the network (`api`) answered by the test and the layout told by a stub of `matchMedia` (jsdom has none, which
// `usePhoneLayout` reads as a computer: every other component test of these two screens runs the computer's inline layout).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import AuditView from '../../src/admin/views/AuditView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { usePhoneLayout } from '../../src/admin/hooks.js'
import { readLoadCache } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

// ---- the layout ------------------------------------------------------------------------------------------------------------------

/**
 * Stands in for `window.matchMedia` with one query whose answer the test changes: `phone()` and `computer()` are a window that is resized
 * across 1024 px. The app asks "is it a computer?" (`(min-width: 1024px)`), so `matches` is the opposite of a phone.
 */
function layout(startAsPhone) {
  let phone = startAsPhone
  const listeners = new Set()
  const query = {
    get matches() { return !phone },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }
  window.matchMedia = vi.fn(() => query)
  const change = (toPhone) => act(() => { phone = toPhone; for (const listener of listeners) listener() })
  return { phone: () => change(true), computer: () => change(false) }
}

// ---- the data --------------------------------------------------------------------------------------------------------------------

const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }
const OTHER_POINT = { id: '22222222-2222-4222-8222-222222222222', name: 'מינוס 1' }
const PROVIDER = { id: '33333333-3333-4333-8333-333333333333', company: 'ניקיון', contact_name: 'פלוני' }
const DANA = { id: '44444444-4444-4444-8444-444444444444', name: 'דנה לוי', email: 'dana@example.test', is_active: true, last_login_at: null }

// A fixed "today", so that the default week is known: 29/09/2026 to 05/10/2026. Only the clock of Date is faked: the pause before a query
// and Testing Library's waiting keep running on real timers.
const FROM = '2026-09-29'
const TO = '2026-10-05'

const scan = {
  id: 's1', local_date: TO, checked_in_at: '2026-10-05T06:00:00Z', point_id: POINT.id, point_name: POINT.name,
  provider_id: PROVIDER.id, provider_name: 'נותן סריקה', outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
  distance_m: null, flags: [], voided: false, void_reason: null,
}

const WAIT = { timeout: 4000 }
const calls = (prefix) => api.mock.calls.map(([path]) => path).filter((path) => path.startsWith(prefix))
const lastParams = (prefix) => new URL(calls(prefix).at(-1), 'http://x').searchParams

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
})
afterEach(() => {
  cleanup()
  delete window.matchMedia
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ---- the History tab -------------------------------------------------------------------------------------------------------------

function historyServer({ refusals = { refusals: [], next_cursor: null } } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/admin/points') return { points: [POINT, OTHER_POINT] }
    if (path === '/admin/providers') return { providers: [PROVIDER] }
    if (path.startsWith('/admin/scans')) return { scans: [scan], next_cursor: null }
    if (path.startsWith('/admin/scan-refusals')) return refusals
    throw new Error(`the test does not expect ${path}`)
  })
}
async function showHistory() {
  const view = render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
  await screen.findByText('נותן סריקה', {}, WAIT)
  return view
}
/** The button of the bar: its name is "סינון", and then how many filters are on. */
const opener = () => screen.getByRole('button', { name: /^סינון/ })
const sheet = () => screen.getByRole('dialog', { name: 'סינון' })
const removers = () => screen.queryAllByRole('button', { name: /^הסרת סינון/ })
const openSheet = () => { fireEvent.click(opener()); return sheet() }
const showResults = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'הצגת תוצאות' }))
const choose = (label, value) => fireEvent.change(within(sheet()).getByLabelText(label), { target: { value } })
const QUESTION = 'לסגור בלי להציג את התוצאות?'

describe('History on a phone: the bar', () => {
  it('draws a button, the dates that are applied, and none of the controls', async () => {
    layout(true)
    historyServer()
    await showHistory()
    expect(opener().getAttribute('aria-haspopup')).toBe('dialog')
    expect(opener().textContent).toBe('סינון') // no filter differs from the defaults, so no count
    expect(screen.getByText('29/09/2026').closest('span.a-filterbar__range').textContent).toBe('טווח התאריכים: 29/09/2026 עד 05/10/2026')
    for (const label of ['מתאריך', 'עד תאריך', 'נקודה', 'נותן שירות', 'סוג', 'כולל מבוטלות', 'כולל חשבון דמו']) {
      expect(screen.queryByLabelText(label), `${label} is not in the page until the sheet opens`).toBeNull()
    }
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(removers()).toHaveLength(0)
  })

  it('asks for the default week at first, once', async () => {
    layout(true)
    historyServer()
    await showHistory()
    expect(Object.fromEntries(lastParams('/admin/scans'))).toEqual({ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' })
    expect(calls('/admin/scans')).toHaveLength(1)
  })
})

describe('History on a phone: the sheet', () => {
  it('opens with every control, on the dialog itself (so that the keyboard of the phone does not come up over it)', async () => {
    layout(true)
    historyServer()
    await showHistory()
    const dialog = openSheet()
    expect(document.activeElement).toBe(dialog)
    for (const label of ['מתאריך', 'עד תאריך', 'נקודה', 'נותן שירות', 'סוג', 'כולל מבוטלות', 'כולל חשבון דמו']) {
      expect(within(dialog).getByLabelText(label), label).toBeTruthy()
    }
    expect(within(dialog).getByLabelText('מתאריך').value).toBe('29/09/2026')
    expect(within(dialog).getByLabelText('עד תאריך').value).toBe('05/10/2026')
    expect(within(dialog).getByRole('button', { name: 'איפוס' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'הצגת תוצאות' })).toBeTruthy()
    expect(screen.getAllByLabelText('מתאריך'), 'each control is in the page once').toHaveLength(1)
  })

  it('applies nothing while the person chooses, and everything when "show results" is pressed', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    choose('סוג', 'all')
    fireEvent.click(within(sheet()).getByLabelText('כולל חשבון דמו'))
    await new Promise((resolve) => setTimeout(resolve, 600)) // longer than the pause before a query on a computer
    expect(calls('/admin/scans'), 'nothing was asked for while choosing').toHaveLength(1)
    showResults()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(2), WAIT)
    expect(Object.fromEntries(lastParams('/admin/scans'))).toEqual({
      from: FROM, to: TO, point_id: OTHER_POINT.id, outcome: 'all', include_demo: 'true', limit: '100',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows what is on in the bar: the count (the dates once), a chip for each other filter, and the dates', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    choose('נותן שירות', PROVIDER.id)
    choose('סוג', 'rejected')
    fireEvent.click(within(sheet()).getByLabelText('כולל מבוטלות'))
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '01092026' } })
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(4), WAIT)
    expect(opener().textContent).toBe('סינון5פעילים') // the four chips and the dates
    expect(opener().getAttribute('aria-expanded')).toBeNull()
    expect(removers().map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'הסרת סינון: נקודה: מינוס 1', 'הסרת סינון: נותן שירות: פלוני', 'הסרת סינון: סוג: ניסיונות שנדחו', 'הסרת סינון: כולל מבוטלות',
    ])
    expect(removers().map((chip) => chip.textContent)).toEqual(['נקודה: מינוס 1', 'נותן שירות: פלוני', 'סוג: ניסיונות שנדחו', 'כולל מבוטלות'])
    expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: 01/09/2026 עד 05/10/2026')
  })

  it('removes a filter at once with its chip, and keeps the others', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    choose('סוג', 'all')
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(2), WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון: נקודה: מינוס 1' }))
    await waitFor(() => expect(removers()).toHaveLength(1), WAIT)
    await waitFor(() => expect(lastParams('/admin/scans').get('point_id')).toBeNull(), WAIT)
    expect(lastParams('/admin/scans').get('outcome')).toBe('all')
    expect(opener().textContent).toBe('סינון1פעילים')
  })

  it('resets the sheet to the defaults, and applies nothing until "show results"', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    choose('סוג', 'all')
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(2), WAIT)
    const asked = calls('/admin/scans').length
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '01012026' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'איפוס' }))
    expect(within(sheet()).getByLabelText('נקודה').value).toBe('')
    expect(within(sheet()).getByLabelText('סוג').value).toBe(OUTCOME_ACCEPTED)
    expect(within(sheet()).getByLabelText('מתאריך').value).toBe('29/09/2026')
    expect(removers(), 'the bar behind the sheet is as it was').toHaveLength(2)
    expect(calls('/admin/scans')).toHaveLength(asked)
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(0), WAIT)
    expect(opener().textContent).toBe('סינון')
    expect(lastParams('/admin/scans').get('point_id')).toBeNull()
  })

  it('asks for nothing when "show results" is pressed and nothing changed', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    showResults()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls('/admin/scans')).toHaveLength(1)
  })

  it('hides the controls that are about scans while the type is the visits that were not counted, and does not count them', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.click(within(sheet()).getByLabelText('כולל מבוטלות'))
    choose('סוג', 'all')
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(2), WAIT)
    openSheet()
    const type = within(sheet()).getByLabelText('סוג')
    choose('סוג', within(sheet()).getByRole('option', { name: 'לא נקלטו' }).getAttribute('value'))
    expect(within(sheet()).queryByLabelText('כולל מבוטלות')).toBeNull()
    expect(within(sheet()).queryByLabelText('כולל חשבון דמו')).toBeNull()
    expect(type.value).toBe('not_counted')
    showResults()
    await waitFor(() => expect(calls('/admin/scan-refusals')).toHaveLength(1), WAIT)
    expect(removers().map((chip) => chip.textContent)).toEqual(['סוג: לא נקלטו']) // the switch that is set but has no control now is not a filter
    expect(opener().textContent).toBe('סינון1פעילים')
    expect(Object.fromEntries(lastParams('/admin/scan-refusals'))).toEqual({ from: FROM, to: TO, limit: '100' })
    expect(screen.queryByRole('link', { name: 'ייצוא ל-Excel' })).toBeNull()
  })

  it('exports the applied filters, not the ones that are being chosen', async () => {
    layout(true)
    historyServer()
    await showHistory()
    const href = () => screen.getByRole('link', { name: 'ייצוא ל-Excel' }).getAttribute('href')
    expect(href()).toBe(`/api/admin/scans?from=${FROM}&to=${TO}&outcome=${OUTCOME_ACCEPTED}&format=csv`)
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    expect(href(), 'the choice is not applied yet').not.toContain('point_id')
    showResults()
    await waitFor(() => expect(href()).toContain(`point_id=${OTHER_POINT.id}`), WAIT)
  })

  it('keeps the first page of each applied set of filters for the session, and none for a draft', async () => {
    layout(true)
    historyServer()
    await showHistory()
    const key = (point) => `history:scans:from=${FROM}&to=${TO}${point ? `&point_id=${point}` : ''}&outcome=${OUTCOME_ACCEPTED}&limit=100`
    expect(readLoadCache(key())).toBeTruthy()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(readLoadCache(key(OTHER_POINT.id)), 'a draft is not a list that was shown').toBeUndefined()
    showResults()
    await waitFor(() => expect(readLoadCache(key(OTHER_POINT.id))).toBeTruthy(), WAIT)
  })
})

describe('History on a phone: a date that is not finished', () => {
  it('is never applied quietly: "show results" keeps the sheet open, says so under the field and puts the focus there', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    const from = within(sheet()).getByLabelText('מתאריך')
    fireEvent.change(from, { target: { value: '2909' } }) // half a date: the field says "29/09", and the filters keep the last good date
    fireEvent.click(within(sheet()).getByLabelText('כולל חשבון דמו')) // something else was chosen as well
    showResults()
    const message = await within(sheet()).findByRole('alert')
    expect(message.textContent).toContain('התאריך לא תקין')
    expect(from.getAttribute('aria-invalid')).toBe('true')
    expect(from.getAttribute('aria-describedby')).toBe(message.id)
    expect(document.activeElement).toBe(from)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(calls('/admin/scans'), 'nothing was applied').toHaveLength(1)
    expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: 29/09/2026 עד 05/10/2026')
  })

  it('takes the message away when the date is finished, and the sheet then applies', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    const from = within(sheet()).getByLabelText('מתאריך')
    fireEvent.change(from, { target: { value: '29/09/20' } })
    showResults()
    await within(sheet()).findByRole('alert')
    fireEvent.change(from, { target: { value: '29/09/2025' } })
    await waitFor(() => expect(within(sheet()).queryByRole('alert')).toBeNull(), WAIT)
    showResults()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(2), WAIT)
    expect(lastParams('/admin/scans').get('from')).toBe('2025-09-29')
  })

  it('says it for a date that does not exist, too (31 February), and for both fields', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '31022026' } })
    fireEvent.change(within(sheet()).getByLabelText('עד תאריך'), { target: { value: '0510' } })
    showResults()
    await waitFor(() => expect(within(sheet()).getAllByRole('alert')).toHaveLength(2), WAIT)
    expect(document.activeElement).toBe(within(sheet()).getByLabelText('מתאריך')) // the first of them
    expect(calls('/admin/scans')).toHaveLength(1)
  })

  it('is taken away by "reset", with the text that was typed', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '2909' } })
    showResults()
    await within(sheet()).findByRole('alert')
    fireEvent.click(within(sheet()).getByRole('button', { name: 'איפוס' }))
    expect(within(sheet()).queryByRole('alert')).toBeNull()
    expect(within(sheet()).getByLabelText('מתאריך').value).toBe('29/09/2026')
  })

  it('does not hold the export back: it is the applied range, which is a finished one', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '2909' } })
    expect(screen.getByRole('link', { name: 'ייצוא ל-Excel' }).getAttribute('href')).toContain(`from=${FROM}`)
  })
})

describe('History on a phone: closing the sheet', () => {
  it('keeps the applied filters, and the close button closes at once even with something chosen', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(1), WAIT)
    openSheet()
    choose('נקודה', POINT.id)
    fireEvent.click(within(sheet()).getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(removers().map((chip) => chip.textContent)).toEqual(['נקודה: מינוס 1'])
    expect(calls('/admin/scans')).toHaveLength(2)
  })

  it('closes at once on Esc and on a tap outside when nothing was chosen', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(opener())
    fireEvent.mouseDown(sheet().parentElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks on Esc and on a tap outside when something was chosen, in its own words, and "back to the filters" keeps the choice', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    fireEvent.keyDown(document, { key: 'Escape' })
    const question = screen.getByRole('dialog', { name: QUESTION })
    expect(within(question).getByText('בחרתם סינון שעוד לא הוצג. אם תסגרו עכשיו, הרשימה תישאר כמו שהיא והבחירה תאבד.')).toBeTruthy()
    fireEvent.click(within(question).getByRole('button', { name: 'חזרה לסינון' }))
    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull()
    expect(within(sheet()).getByLabelText('נקודה').value).toBe(OTHER_POINT.id)

    fireEvent.mouseDown(sheet().parentElement)
    expect(screen.getByRole('dialog', { name: QUESTION })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'סגירה בלי להציג' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(removers()).toHaveLength(0) // the choice was not applied
    expect(calls('/admin/scans')).toHaveLength(1)
  })

  it('counts a choice that was put back as nothing chosen', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    choose('נקודה', '')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('counts a date that is half typed as typing that would be lost', async () => {
    layout(true)
    historyServer()
    await showHistory()
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '2909' } }) // the filters themselves have not changed
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: QUESTION })).toBeTruthy()
  })
})

describe('History: the two layouts', () => {
  it('on a computer draws the controls inline, once, and live, with no bar and no sheet', async () => {
    layout(false)
    historyServer()
    await showHistory()
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'הצגת תוצאות' })).toBeNull()
    for (const label of ['מתאריך', 'עד תאריך', 'נקודה', 'נותן שירות', 'סוג', 'כולל מבוטלות', 'כולל חשבון דמו']) {
      expect(screen.getAllByLabelText(label), `${label} is in the page once`).toHaveLength(1)
    }
    expect(document.querySelector('.a-filters')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('נקודה'), { target: { value: OTHER_POINT.id } })
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(2), WAIT) // after the pause: nothing was pressed
    expect(lastParams('/admin/scans').get('point_id')).toBe(OTHER_POINT.id)
  })

  it('follows the window across 1024 px: the bar and the inline controls change places, and keep what was applied', async () => {
    const window1024 = layout(true)
    historyServer()
    await showHistory()
    openSheet()
    choose('נקודה', OTHER_POINT.id)
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(1), WAIT)
    await window1024.computer()
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
    expect(screen.getByLabelText('נקודה').value).toBe(OTHER_POINT.id)
    await window1024.phone()
    expect(screen.queryByLabelText('נקודה')).toBeNull()
    expect(removers().map((chip) => chip.textContent)).toEqual(['נקודה: מינוס 1'])
  })

  // A tablet that is turned crosses 1024 px with the sheet open. Closing it then would drop what was chosen, and a date that is half typed,
  // without the question that Esc and a tap outside ask (F4). So it stays open, with its draft, whichever way the window goes.
  describe('a sheet that is open when the window crosses 1024 px', () => {
    /** Opens the sheet on a phone, chooses a point, half types a date, and turns the window into a computer's. */
    async function crossWithDraft() {
      const window1024 = layout(true)
      historyServer()
      await showHistory()
      openSheet()
      choose('נקודה', OTHER_POINT.id)
      fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '2909' } }) // half a date: "29/09"
      await window1024.computer()
      return window1024
    }

    it('stays open with what was chosen and the date that was half typed, on a computer as on a phone', async () => {
      const window1024 = await crossWithDraft()
      expect(sheet()).toBeTruthy()
      expect(within(sheet()).getByLabelText('נקודה').value).toBe(OTHER_POINT.id)
      expect(within(sheet()).getByLabelText('מתאריך').value).toBe('29/09')
      // the inline controls are behind it, with what is applied: nothing that was chosen in the sheet
      expect(screen.getAllByLabelText('נקודה')).toHaveLength(2)
      expect(screen.getAllByLabelText('נקודה').filter((field) => !sheet().contains(field))[0].value).toBe('')
      await window1024.phone()
      expect(within(sheet()).getByLabelText('נקודה').value).toBe(OTHER_POINT.id)
      expect(within(sheet()).getByLabelText('מתאריך').value).toBe('29/09')
      expect(screen.getAllByLabelText('נקודה'), 'one copy again: the bar has no controls').toHaveLength(1)
      expect(calls('/admin/scans'), 'nothing was applied by the change').toHaveLength(1)
    })

    it('can still be applied: the date is finished, "show results" applies the draft, and the inline controls show it', async () => {
      await crossWithDraft()
      showResults() // the date is half typed: refused, as on a phone
      expect((await within(sheet()).findByRole('alert')).textContent).toContain('התאריך לא תקין')
      expect(calls('/admin/scans')).toHaveLength(1)
      fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '29/09/2025' } })
      showResults()
      await waitFor(() => expect(calls('/admin/scans')).toHaveLength(2), WAIT)
      expect(Object.fromEntries(lastParams('/admin/scans'))).toEqual({ from: '2025-09-29', to: TO, point_id: OTHER_POINT.id, outcome: OUTCOME_ACCEPTED, limit: '100' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByLabelText('נקודה').value).toBe(OTHER_POINT.id)
      expect(screen.getByLabelText('מתאריך').value).toBe('29/09/2025')
    })

    it('can still be discarded, through the same question as on a phone, and the applied filters stay', async () => {
      await crossWithDraft()
      fireEvent.keyDown(document, { key: 'Escape' })
      const question = screen.getByRole('dialog', { name: QUESTION })
      fireEvent.click(within(question).getByRole('button', { name: 'חזרה לסינון' }))
      expect(within(sheet()).getByLabelText('מתאריך').value, 'asked, and kept').toBe('29/09')
      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.click(within(screen.getByRole('dialog', { name: QUESTION })).getByRole('button', { name: 'סגירה בלי להציג' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByLabelText('נקודה').value, 'the applied filters are the same').toBe('')
      expect(calls('/admin/scans')).toHaveLength(1)
    })

    it('can still be reset, and the audit log keeps its sheet the same way', async () => {
      const window1024 = layout(true)
      api.mockImplementation(async (path) => {
        if (path === '/admin/admins') return { admins: [DANA] }
        if (path.startsWith('/admin/audit')) return { entries: [entry()], next_cursor: null }
        throw new Error(`the test does not expect ${path}`)
      })
      await showAudit()
      openSheet()
      choose('סוג פעולה', 'point')
      fireEvent.change(within(sheet()).getByLabelText('עד תאריך'), { target: { value: '0510' } })
      await window1024.computer()
      expect(within(sheet()).getByLabelText('סוג פעולה').value).toBe('point')
      expect(within(sheet()).getByLabelText('עד תאריך').value).toBe('05/10')
      fireEvent.click(within(sheet()).getByRole('button', { name: 'איפוס' }))
      expect(within(sheet()).getByLabelText('סוג פעולה').value).toBe('')
      expect(within(sheet()).getByLabelText('עד תאריך').value).toBe('')
      showResults()
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(calls('/admin/audit'), 'reset to what was applied: nothing to ask').toHaveLength(1)
    })
  })

  // The other direction: on a computer the dates are typed in the inline fields, and a date that is half typed lives in the text of its own
  // field, which would unmount with the inline block when a tablet is turned below 1024 px. The layout waits for the person's input.
  describe('a date that is half typed in the inline fields when the window goes below 1024 px', () => {
    it('keeps the computer layout, with the same field and the half text, until the date is finished', async () => {
      const window1024 = layout(false)
      historyServer()
      await showHistory()
      const from = screen.getByLabelText('מתאריך')
      fireEvent.change(from, { target: { value: '2909' } }) // half a date: "29/09"
      expect(from.value).toBe('29/09')
      await window1024.phone()
      expect(screen.getByLabelText('מתאריך'), 'the very same field').toBe(from)
      expect(from.value).toBe('29/09')
      expect(screen.queryByRole('button', { name: /^סינון/ }), 'no bar yet').toBeNull()
      expect(screen.getByRole('button', { name: 'ייצוא ל-Excel' }).hasAttribute('disabled'), 'the file waits, as it does on a computer').toBe(true)
      fireEvent.change(from, { target: { value: '29/09/2025' } }) // finished: the layout follows the window
      await waitFor(() => expect(opener()).toBeTruthy(), WAIT)
      expect(screen.queryByLabelText('מתאריך')).toBeNull()
      await waitFor(() => expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: 29/09/2025 עד 05/10/2026'), WAIT)
      expect(Object.fromEntries(lastParams('/admin/scans')).from, 'the finished date is what the list was asked for').toBe('2025-09-29')
    })

    it('switches once the date is cleared', async () => {
      const window1024 = layout(false)
      historyServer()
      await showHistory()
      const from = screen.getByLabelText('מתאריך')
      fireEvent.change(from, { target: { value: '2909' } })
      await window1024.phone()
      expect(screen.getByLabelText('מתאריך')).toBe(from)
      fireEvent.change(from, { target: { value: '' } })
      await waitFor(() => expect(opener()).toBeTruthy(), WAIT)
      expect(screen.queryByLabelText('מתאריך')).toBeNull()
    })

    it('holds for the date that is "to" as well, and for a date that does not exist (31/02)', async () => {
      const window1024 = layout(false)
      historyServer()
      await showHistory()
      const until = screen.getByLabelText('עד תאריך')
      fireEvent.change(until, { target: { value: '31022026' } })
      await window1024.phone()
      expect(screen.getByLabelText('עד תאריך')).toBe(until)
      expect(until.value).toBe('31/02/2026')
      fireEvent.change(until, { target: { value: '28/02/2026' } })
      await waitFor(() => expect(opener()).toBeTruthy(), WAIT)
    })

    it('does not hold anything when no date is half typed: the window decides at once', async () => {
      const window1024 = layout(false)
      historyServer()
      await showHistory()
      fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '29/09/2025' } }) // a finished date
      await window1024.phone()
      expect(opener()).toBeTruthy()
      expect(screen.queryByLabelText('מתאריך')).toBeNull()
    })

    it('is the same in the audit log', async () => {
      const window1024 = layout(false)
      api.mockImplementation(async (path) => {
        if (path === '/admin/admins') return { admins: [DANA] }
        if (path.startsWith('/admin/audit')) return { entries: [entry()], next_cursor: null }
        throw new Error(`the test does not expect ${path}`)
      })
      await showAudit()
      const from = screen.getByLabelText('מתאריך')
      fireEvent.change(from, { target: { value: '2909' } })
      await window1024.phone()
      expect(screen.getByLabelText('מתאריך'), 'the very same field').toBe(from)
      expect(from.value).toBe('29/09')
      expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
      fireEvent.change(from, { target: { value: '' } }) // cleared
      await waitFor(() => expect(opener()).toBeTruthy(), WAIT)
      expect(screen.queryByLabelText('מתאריך')).toBeNull()
      expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: כל התאריכים')
    })
  })

  it('is a computer where the browser has no matchMedia', async () => {
    historyServer()
    await showHistory()
    expect(screen.getByLabelText('נקודה')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
  })
})

describe('usePhoneLayout', () => {
  it('answers in the very first render, so that the wrong layout is never drawn first', () => {
    layout(true)
    const seen = []
    renderHook(() => { const phone = usePhoneLayout(); seen.push(phone); return phone })
    expect(seen[0]).toBe(true)
    expect(new Set(seen)).toEqual(new Set([true]))
  })

  it('follows the window, and lets go of the query when the screen goes', async () => {
    const window1024 = layout(true)
    const { result, unmount } = renderHook(() => usePhoneLayout())
    expect(result.current).toBe(true)
    await window1024.computer()
    expect(result.current).toBe(false)
    await window1024.phone()
    expect(result.current).toBe(true)
    unmount()
    await expect(window1024.computer()).resolves.not.toThrow()
  })

  it('is false where there is no matchMedia', () => {
    const { result } = renderHook(() => usePhoneLayout())
    expect(result.current).toBe(false)
  })
})

// ---- the audit log ---------------------------------------------------------------------------------------------------------------

const entry = (over = {}) => ({
  id: 1, at: '2026-10-05T07:14:00.000Z', action: 'point.update', entity: 'point', entity_id: POINT.id, entity_name: 'לובי',
  actor_type: 'admin', actor_id: DANA.id, actor_name: 'דנה לוי', actor_deleted: false, detail: null, ...over,
})
function auditServer() {
  api.mockImplementation(async (path) => {
    if (path === '/admin/admins') return { admins: [DANA] }
    if (path.startsWith('/admin/audit')) return { entries: [entry()], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}
async function showAudit() {
  render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
  await screen.findByText('עדכון נקודה', {}, WAIT)
}

describe('the audit log on a phone', () => {
  it('draws the bar with "all dates", and the controls only in the sheet', async () => {
    layout(true)
    auditServer()
    await showAudit()
    expect(opener().textContent).toBe('סינון')
    expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: כל התאריכים')
    expect(screen.queryByLabelText('סוג פעולה')).toBeNull()
    expect(screen.queryByLabelText('חבר ועד')).toBeNull()
    const dialog = openSheet()
    expect(document.activeElement).toBe(dialog)
    for (const label of ['מתאריך', 'עד תאריך', 'סוג פעולה', 'חבר ועד']) expect(within(dialog).getByLabelText(label), label).toBeTruthy()
  })

  it('applies group, member and dates on "show results" only, with a chip for the two selects and the dates in the bar', async () => {
    layout(true)
    auditServer()
    await showAudit()
    openSheet()
    choose('סוג פעולה', 'api_key')
    choose('חבר ועד', DANA.id)
    fireEvent.change(within(sheet()).getByLabelText('מתאריך'), { target: { value: '01102026' } })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(calls('/admin/audit'), 'nothing was asked for while choosing').toHaveLength(1)
    showResults()
    await waitFor(() => expect(calls('/admin/audit')).toHaveLength(2), WAIT)
    expect(Object.fromEntries(lastParams('/admin/audit'))).toEqual({ from: '2026-10-01', group: 'api_key', actor_id: DANA.id, limit: '50' })
    expect(opener().textContent).toBe('סינון3פעילים')
    expect(removers().map((chip) => chip.getAttribute('aria-label'))).toEqual(['הסרת סינון: סוג פעולה: מפתחות אייג\'נט', 'הסרת סינון: חבר ועד: דנה לוי'])
    expect(document.querySelector('.a-filterbar__range').textContent).toBe('טווח התאריכים: מ-01/10/2026')
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון: חבר ועד: דנה לוי' }))
    await waitFor(() => expect(calls('/admin/audit')).toHaveLength(3), WAIT)
    expect(Object.fromEntries(lastParams('/admin/audit'))).toEqual({ from: '2026-10-01', group: 'api_key', limit: '50' })
    expect(opener().textContent).toBe('סינון2פעילים')
  })

  it('resets to no filter at all, and does not apply a date that is not finished', async () => {
    layout(true)
    auditServer()
    await showAudit()
    openSheet()
    choose('סוג פעולה', 'point')
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(1), WAIT)
    openSheet()
    fireEvent.change(within(sheet()).getByLabelText('עד תאריך'), { target: { value: '0510' } })
    showResults()
    expect((await within(sheet()).findByRole('alert')).textContent).toContain('התאריך לא תקין')
    expect(calls('/admin/audit')).toHaveLength(2)
    fireEvent.click(within(sheet()).getByRole('button', { name: 'איפוס' }))
    expect(within(sheet()).getByLabelText('סוג פעולה').value).toBe('')
    showResults()
    await waitFor(() => expect(removers()).toHaveLength(0), WAIT)
    expect(Object.fromEntries(lastParams('/admin/audit'))).toEqual({ limit: '50' })
  })

  it('on a computer keeps the inline controls, once', async () => {
    layout(false)
    auditServer()
    await showAudit()
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
    for (const label of ['מתאריך', 'עד תאריך', 'סוג פעולה', 'חבר ועד']) expect(screen.getAllByLabelText(label), label).toHaveLength(1)
  })
})
