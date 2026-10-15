// @vitest-environment jsdom
// The committee app's own date picker (src/admin/DatePicker.jsx, owner decision of 14/10/2026): a date field that keeps its typing, and a
// button beside it that opens a month grid in a dialog (the WAI-ARIA "Date Picker Dialog"), with the quick ranges under the grid. Here: the
// pair of fields of the filters (`DateRangeFields` of src/admin/filters.jsx) on their own, and then inside the History tab, on a computer
// (the inline block) and on a phone (the sheet). What a real browser decides (where the popover stands, the colours, the keys as the
// browser sends them, the pictures) is in e2e/date-picker.spec.js, e2e/a11y.spec.js and e2e/visual.spec.js.
//
// The clock is fixed: "today" is 14/10/2026 in the building (a Wednesday), so the grid of October 2026 is known: the 1st is a Thursday.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react'
import { DateRangeFields } from '../../src/admin/filters.jsx'
import { DatePicker } from '../../src/admin/DatePicker.jsx'
import { Field, ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import AuditView from '../../src/admin/views/AuditView.jsx'
import { QUICK_RANGES, addMonths, monthWeeks, lastDays } from '../../src/admin/calendar.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const NOW = '2026-10-14T09:00:00Z' // 12:00 on 14/10/2026 in the building
const WAIT = { timeout: 4000 }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }) // only the clock of Date: the pause of the filters and Testing Library's waiting run on real timers
  vi.setSystemTime(new Date(NOW))
  document.documentElement.dir = 'rtl' // the committee app is right to left (index.html)
})
afterEach(() => {
  cleanup()
  delete window.matchMedia
  document.body.style.overflow = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ---- the pair of fields on their own ---------------------------------------------------------------------------------------------

/** The two fields of a filter group, as the screens hold them: `seen` lists every date that each field hands over. */
function Pair({ from = '2026-10-05', to = '2026-10-10', seen = [] }) {
  const [dates, setDates] = useState({ from, to })
  const set = (key) => (value) => { seen.push([key, value]); setDates((d) => ({ ...d, [key]: value })) }
  return (
    <div className="a-app">
      <button type="button">לפני</button>
      <DateRangeFields from={dates.from} to={dates.to} onFrom={set('from')} onTo={set('to')} />
    </div>
  )
}

const fromField = () => screen.getByLabelText('מתאריך')
const toField = () => screen.getByLabelText('עד תאריך')
const fromButton = () => screen.getByRole('button', { name: 'לוח שנה: תאריך התחלה' })
const toButton = () => screen.getByRole('button', { name: 'לוח שנה: תאריך סיום' })
const grid = () => screen.getByRole('grid')
const day = (ddmmyyyy) => within(grid()).getByRole('button', { name: ddmmyyyy })
const focused = () => document.activeElement
const press = (key, options = {}) => fireEvent.keyDown(focused(), { key, ...options })
const open = (button = fromButton()) => { fireEvent.click(button); return screen.getByRole('dialog') }

describe('the field and its button', () => {
  it('the field shows its date as DD/MM/YYYY and still takes typing; the button beside it says that it opens a dialog', () => {
    const seen = []
    render(<Pair seen={seen} />)
    expect(fromField().value).toBe('05/10/2026')
    expect(toField().value).toBe('10/10/2026')
    expect(fromField().type).toBe('text') // never the browser's own date field
    expect(fromButton().getAttribute('aria-haspopup')).toBe('dialog')
    expect(fromButton().getAttribute('title')).toBe('לוח שנה: תאריך התחלה')
    fireEvent.change(fromField(), { target: { value: '01092026' } })
    expect(fromField().value).toBe('01/09/2026')
    expect(seen).toEqual([['from', '2026-09-01']])
    expect(screen.queryByRole('dialog'), 'typing opens nothing').toBeNull()
  })

  it('a half-typed date is not handed over, and says so, as it always did', () => {
    const seen = []
    const pending = []
    render(
      <div className="a-app">
        <Field label="מתאריך"><DatePicker label="תאריך התחלה" value="2026-10-05" onChange={(v) => seen.push(v)} onPendingChange={(p) => pending.push(p)} /></Field>
      </div>,
    )
    fireEvent.change(fromField(), { target: { value: '0110' } })
    expect(fromField().value).toBe('01/10')
    expect(seen).toEqual([])
    expect(pending.at(-1)).toBe(true)
  })
})

describe('opening and closing', () => {
  it('opens a dialog named after the date it chooses, a popover by its field, with the month grid of the date', () => {
    render(<Pair />)
    const dialog = open()
    expect(dialog).toBe(screen.getByRole('dialog', { name: 'תאריך התחלה' }))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('a-modal--popover')).toBe(true)
    expect(dialog.parentElement.classList.contains('a-overlay--popover')).toBe(true)
    expect(within(dialog).getByRole('heading', { level: 3 }).textContent).toBe('10/2026')
    expect(within(dialog).getByRole('grid', { name: '10/2026' })).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Esc closes it and gives the focus back to its button; the field keeps its date', () => {
    render(<Pair />)
    open()
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(fromButton())
    expect(fromField().value).toBe('05/10/2026')
    expect(document.body.style.overflow).toBe('')
  })

  it('the close button and a click outside close it too, the focus back on the button', () => {
    render(<Pair />)
    fireEvent.click(within(open()).getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(fromButton())
    const dialog = open()
    fireEvent.mouseDown(dialog.parentElement) // the overlay: outside the popover
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(fromButton())
  })

  it('gives the focus back to its button even when the opener had no focus (Safari does not focus a tapped button)', () => {
    render(<Pair />)
    document.body.focus()
    fireEvent.click(fromButton()) // jsdom does not focus a clicked button either
    press('Escape')
    expect(focused()).toBe(fromButton())
  })
})

describe('the grid', () => {
  it('every day is a button named by its full DD/MM/YYYY that shows its number, under the initials of the days, Sunday first', () => {
    render(<Pair />)
    open()
    expect(within(grid()).getAllByRole('columnheader').map((head) => head.textContent)).toEqual(['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'])
    const days = within(grid()).getAllByRole('button')
    expect(days).toHaveLength(31)
    days.forEach((button, i) => {
      const name = `${String(i + 1).padStart(2, '0')}/10/2026`
      expect(button.getAttribute('aria-label')).toBe(name)
      expect(button.textContent).toBe(String(i + 1))
      expect(button.getAttribute('type')).toBe('button')
    })
    // the 1st of October 2026 is a Thursday: the fifth column of the first row, after four empty cells
    const firstRow = within(grid()).getAllByRole('row')[1]
    const cells = within(firstRow).getAllByRole('gridcell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['', '', '', '', '1', '2', '3'])
    expect(within(grid()).getAllByRole('row'), 'six weeks always, so the grid keeps its height').toHaveLength(7)
  })

  it('the focus goes to the chosen day, which is the one day in the tab order', () => {
    render(<Pair />)
    open()
    expect(focused()).toBe(day('05/10/2026'))
    expect(within(grid()).getAllByRole('button').filter((b) => b.tabIndex === 0)).toEqual([day('05/10/2026')])
  })

  it('the focus goes to today when the field is empty, and today is marked as the current date', () => {
    render(<Pair from="" to="" />)
    open()
    expect(focused()).toBe(day('14/10/2026'))
    expect(day('14/10/2026').getAttribute('aria-current')).toBe('date')
    expect(within(grid()).getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('draws the range: both ends chosen, the days between them on the band, the field\'s own date selected', () => {
    render(<Pair />)
    open(toButton())
    expect(focused()).toBe(day('10/10/2026'))
    const cell = (name) => day(name).closest('td')
    expect(cell('05/10/2026').className).toBe('is-in is-start')
    expect(cell('07/10/2026').className).toBe('is-in')
    expect(cell('10/10/2026').className).toBe('is-in is-end')
    expect(cell('04/10/2026').className).toBe('')
    expect(cell('11/10/2026').className).toBe('')
    expect(day('05/10/2026').classList.contains('is-chosen')).toBe(true)
    expect(day('10/10/2026').classList.contains('is-chosen')).toBe(true)
    expect(day('07/10/2026').classList.contains('is-chosen')).toBe(false)
    expect(cell('10/10/2026').getAttribute('aria-selected')).toBe('true')
    expect(cell('05/10/2026').hasAttribute('aria-selected'), 'only the date of this field is selected').toBe(false)
  })

  it('a day after today cannot be chosen (a filter of what happened), and neither can a month after this one be shown', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    for (const name of ['15/10/2026', '31/10/2026']) expect(day(name).getAttribute('aria-disabled'), name).toBe('true')
    for (const name of ['14/10/2026', '01/10/2026']) expect(day(name).hasAttribute('aria-disabled'), name).toBe(false)
    fireEvent.click(day('20/10/2026'))
    expect(screen.getByRole('dialog'), 'the dialog stays open').toBeTruthy()
    expect(seen).toEqual([])
    const next = screen.getByRole('button', { name: 'החודש הבא' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(next)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('10/2026')
  })
})

describe('the keys (right to left: the day on the left is the next one)', () => {
  const title = () => screen.getByRole('heading', { level: 3 }).textContent
  const at = () => focused().getAttribute('aria-label')

  it('the arrows move by a day, mirrored, and by a week', () => {
    render(<Pair from="2026-10-07" />)
    open()
    expect(at()).toBe('07/10/2026')
    press('ArrowLeft')
    expect(at()).toBe('08/10/2026')
    press('ArrowRight')
    press('ArrowRight')
    expect(at()).toBe('06/10/2026')
    press('ArrowDown')
    expect(at()).toBe('13/10/2026')
    press('ArrowUp')
    press('ArrowUp')
    expect(at()).toBe('29/09/2026')
    expect(title(), 'the grid follows the focus into September').toBe('09/2026')
    expect(focused().tabIndex).toBe(0)
  })

  it('left to right, the arrows are not mirrored', () => {
    document.documentElement.dir = 'ltr'
    render(<Pair from="2026-10-07" />)
    open()
    press('ArrowRight')
    expect(at()).toBe('08/10/2026')
    press('ArrowLeft')
    press('ArrowLeft')
    expect(at()).toBe('06/10/2026')
  })

  it('Home and End go to the Sunday and the Saturday of the week', () => {
    render(<Pair from="2026-10-07" />)
    open()
    press('Home')
    expect(at()).toBe('04/10/2026')
    press('End')
    expect(at()).toBe('10/10/2026')
  })

  it('PageUp and PageDown change the month, and with Shift the year', () => {
    render(<Pair from="2026-10-07" />)
    open()
    press('PageUp')
    expect([at(), title()]).toEqual(['07/09/2026', '09/2026'])
    press('PageDown')
    expect([at(), title()]).toEqual(['07/10/2026', '10/2026'])
    press('PageUp', { shiftKey: true })
    expect([at(), title()]).toEqual(['07/10/2025', '10/2025'])
    press('PageDown', { shiftKey: true })
    expect([at(), title()]).toEqual(['07/10/2026', '10/2026'])
  })

  it('a key never goes past today, nor before 2000 (the first year that the field takes)', () => {
    render(<Pair from="2026-10-10" />)
    open()
    press('ArrowDown') // the 17th
    expect(at()).toBe('14/10/2026')
    press('PageDown')
    expect(at()).toBe('14/10/2026')
    for (let i = 0; i < 30; i++) press('PageUp', { shiftKey: true })
    expect([at(), title()]).toEqual(['01/01/2000', '01/2000'])
    expect(screen.getByRole('button', { name: 'החודש הקודם' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('the keys that move are kept from the page (no scrolling); other keys are left alone', () => {
    render(<Pair from="2026-10-07" />)
    open()
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(press(key), key).toBe(false) // false: the default was prevented
    }
    expect(press('a')).toBe(true)
  })

  it('Enter chooses the day: the dialog closes, the field shows it as DD/MM/YYYY, and the focus is back on the button', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    press('ArrowRight') // the 4th
    press('Enter')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fromField().value).toBe('04/10/2026')
    expect(seen).toEqual([['from', '2026-10-04']])
    expect(focused()).toBe(fromButton())
  })

  it('Space chooses the day as well', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open(toButton())
    press('ArrowRight') // the 9th
    press(' ')
    expect(toField().value).toBe('09/10/2026')
    expect(seen).toEqual([['to', '2026-10-09']])
    expect(focused()).toBe(toButton())
  })

  it('Enter on a day after today chooses nothing', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    day('20/10/2026').focus()
    press('Enter')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(seen).toEqual([])
  })

  it('the arrows of the month change the month and leave the focus on themselves', () => {
    render(<Pair from="2026-10-07" />)
    open()
    const back = screen.getByRole('button', { name: 'החודש הקודם' })
    back.focus()
    fireEvent.click(back)
    expect(title()).toBe('09/2026')
    expect(focused()).toBe(back)
    expect(day('07/09/2026').tabIndex, 'the day of the tab order moved with the month').toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'החודש הבא' }))
    expect(title()).toBe('10/2026')
  })

  it('Tab stays in the dialog: from the last quick range to the close button, and back', () => {
    render(<Pair />)
    const dialog = open()
    const last = within(dialog).getByRole('button', { name: 'החודש' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(focused()).toBe(within(dialog).getByRole('button', { name: 'סגירה' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(focused()).toBe(last)
  })
})

describe('a click on a day', () => {
  it('chooses it, closes the dialog, and the field shows it as DD/MM/YYYY', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    fireEvent.click(day('01/10/2026'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fromField().value).toBe('01/10/2026')
    expect(seen).toEqual([['from', '2026-10-01']])
  })

  it('replaces a date that was half typed in the field, even with the date the field already had', () => {
    const pending = []
    const seen = []
    function One() {
      const [value, setValue] = useState('2026-10-05')
      return (
        <div className="a-app">
          <Field label="מתאריך">
            <DatePicker label="תאריך התחלה" value={value} onChange={(v) => { seen.push(v); setValue(v) }} onPendingChange={(p) => pending.push(p)} />
          </Field>
        </div>
      )
    }
    render(<One />)
    fireEvent.change(fromField(), { target: { value: '0510' } })
    expect(pending.at(-1)).toBe(true)
    open()
    fireEvent.click(day('05/10/2026'))
    expect(fromField().value).toBe('05/10/2026')
    expect(pending.at(-1), 'the field is finished again').toBe(false)
  })
})

describe('the quick ranges, by the building\'s day', () => {
  // 01:30 on 14/10/2026 in the building, and still 13/10 in UTC and on a device in New York: the ranges end on the building's day.
  const NIGHT = '2026-10-13T22:30:00Z'
  let zone
  beforeEach(() => {
    zone = process.env.TZ
    process.env.TZ = 'America/New_York'
    vi.setSystemTime(new Date(NIGHT))
  })
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  const cases = [
    ['היום', '14/10/2026', '14/10/2026'],
    ['7 ימים', '08/10/2026', '14/10/2026'],
    ['30 יום', '15/09/2026', '14/10/2026'],
    ['החודש', '01/10/2026', '14/10/2026'],
  ]

  it('the device is a day behind the building here (the clock of the test)', () => {
    expect(new Date().getDate()).toBe(13)
    expect(QUICK_RANGES.map((quick) => quick.label)).toEqual(cases.map(([label]) => label))
  })

  for (const [label, start, end] of cases) {
    it(`"${label}" sets both dates at once, ${start} to ${end}, from either field`, () => {
      for (const which of ['from', 'to']) {
        const seen = []
        render(<Pair seen={seen} />)
        const dialog = open(which === 'from' ? fromButton() : toButton())
        const group = within(dialog).getByRole('group', { name: 'טווחי תאריכים מהירים' })
        fireEvent.click(within(group).getByRole('button', { name: label }))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect([fromField().value, toField().value], which).toEqual([start, end])
        const iso = (ddmmyyyy) => ddmmyyyy.split('/').reverse().join('-')
        expect(seen, which).toEqual([['from', iso(start)], ['to', iso(end)]])
        expect(focused()).toBe(which === 'from' ? fromButton() : toButton())
        cleanup()
      }
    })
  }

  it('a quick range also replaces a date that was half typed in the other field', () => {
    render(<Pair />)
    fireEvent.change(toField(), { target: { value: '1410' } }) // half of 14/10/2026, which is the end of the range
    fireEvent.click(within(open()).getByRole('button', { name: 'היום' }))
    expect([fromField().value, toField().value]).toEqual(['14/10/2026', '14/10/2026'])
  })

  it('today in the grid is the building\'s day too', () => {
    render(<Pair from="" to="" />)
    open()
    expect(focused().getAttribute('aria-label')).toBe('14/10/2026')
    expect(day('14/10/2026').hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('the arithmetic of the calendar', () => {
  it('a month is always six weeks of seven, Sunday first, the days of other months empty', () => {
    const weeks = monthWeeks('2026-02-11') // February 2026 starts on a Sunday and has 28 days: four full weeks and two empty
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toEqual(['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07'])
    expect(weeks[4].every((d) => d === null) && weeks[5].every((d) => d === null)).toBe(true)
  })

  it('a month later keeps the day, or takes the last day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-10-14', 12)).toBe('2027-10-14')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('the last days cross the clock change of October without losing a day', () => {
    expect(lastDays(7, '2026-10-28')).toEqual({ from: '2026-10-22', to: '2026-10-28' })
    expect(lastDays(30, '2026-03-30')).toEqual({ from: '2026-03-01', to: '2026-03-30' })
  })
})

// ---- inside the screens ----------------------------------------------------------------------------------------------------------

/** Stands in for `window.matchMedia`: every query answers as a computer (1024 px and more) or as a phone. */
function layout(phone) {
  window.matchMedia = vi.fn(() => ({ matches: !phone, addEventListener: () => {}, removeEventListener: () => {} }))
}

const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }
const scan = {
  id: 's1', local_date: '2026-10-14', checked_in_at: '2026-10-14T06:00:00Z', point_id: POINT.id, point_name: POINT.name,
  provider_id: '33333333-3333-4333-8333-333333333333', provider_name: 'נותן סריקה', outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
  distance_m: null, flags: [], voided: false, void_reason: null,
}
const calls = (prefix) => api.mock.calls.map(([path]) => path).filter((path) => path.startsWith(prefix))
const lastParams = (prefix) => Object.fromEntries(new URL(calls(prefix).at(-1), 'http://x').searchParams)

function server() {
  api.mockImplementation(async (path) => {
    if (path === '/admin/points') return { points: [POINT] }
    if (path === '/admin/providers') return { providers: [] }
    if (path === '/admin/admins') return { admins: [] }
    if (path.startsWith('/admin/scans')) return { scans: [scan], next_cursor: null }
    if (path.startsWith('/admin/audit')) return { entries: [], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}
const history = () => render(<div className="a-app"><ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider></div>)

describe('in the History tab', () => {
  it('on a computer: a quick range is applied to the list after the pause, as typed dates are', async () => {
    layout(false)
    server()
    history()
    await screen.findByText('נותן סריקה', {}, WAIT)
    expect(lastParams('/admin/scans')).toMatchObject({ from: '2026-10-08', to: '2026-10-14' }) // the default week is "7 ימים"
    fireEvent.click(within(open()).getByRole('button', { name: '30 יום' }))
    expect([fromField().value, toField().value]).toEqual(['15/09/2026', '14/10/2026'])
    await waitFor(() => expect(lastParams('/admin/scans')).toMatchObject({ from: '2026-09-15', to: '2026-10-14' }), WAIT)
    expect(calls('/admin/scans'), 'one query for the two dates').toHaveLength(2)
  })

  it('on a computer: a day chosen in the grid is applied the same way', async () => {
    layout(false)
    server()
    history()
    await screen.findByText('נותן סריקה', {}, WAIT)
    open(toButton())
    fireEvent.click(day('12/10/2026'))
    await waitFor(() => expect(lastParams('/admin/scans')).toMatchObject({ from: '2026-10-08', to: '2026-10-12' }), WAIT)
  })

  it('on a phone: the calendar opens over the sheet of filters, Esc closes only the calendar, and "show results" applies its range', async () => {
    layout(true)
    server()
    history()
    await screen.findByText('נותן סריקה', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: /^סינון/ }))
    const sheet = screen.getByRole('dialog', { name: 'סינון' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'לוח שנה: תאריך התחלה' }))
    expect(focused()).toBe(day('08/10/2026'))
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'תאריך התחלה' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'סינון' }), 'the sheet is still open').toBeTruthy()
    expect(focused()).toBe(within(sheet).getByRole('button', { name: 'לוח שנה: תאריך התחלה' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'לוח שנה: תאריך התחלה' }))
    fireEvent.click(screen.getByRole('button', { name: 'החודש' }))
    expect(within(sheet).getByLabelText('מתאריך').value).toBe('01/10/2026')
    expect(calls('/admin/scans'), 'nothing is applied before "show results"').toHaveLength(1)
    fireEvent.click(within(sheet).getByRole('button', { name: 'הצגת תוצאות' }))
    await waitFor(() => expect(lastParams('/admin/scans')).toMatchObject({ from: '2026-10-01', to: '2026-10-14' }), WAIT)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('on a phone: a range chosen in the sheet makes its question ask before Esc closes it (the choice is not shown yet)', async () => {
    layout(true)
    server()
    history()
    await screen.findByText('נותן סריקה', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: /^סינון/ }))
    const sheet = screen.getByRole('dialog', { name: 'סינון' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'לוח שנה: תאריך סיום' }))
    fireEvent.click(screen.getByRole('button', { name: 'היום' }))
    await act(async () => {})
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'לסגור בלי להציג את התוצאות?' })).toBeTruthy()
  })
})

describe('in the audit log', () => {
  it('on a computer: a quick range fills the two empty fields and is asked for', async () => {
    layout(false)
    server()
    render(<div className="a-app"><ToastProvider><AuditView /></ToastProvider></div>)
    await screen.findByText('עוד לא נרשמו פעולות', {}, WAIT)
    expect([fromField().value, toField().value]).toEqual(['', ''])
    fireEvent.click(within(open()).getByRole('button', { name: '7 ימים' }))
    expect([fromField().value, toField().value]).toEqual(['08/10/2026', '14/10/2026'])
    await waitFor(() => expect(lastParams('/admin/audit')).toMatchObject({ from: '2026-10-08', to: '2026-10-14' }), WAIT)
  })
})
