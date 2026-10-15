// @vitest-environment jsdom
// The date picker of the committee app on a phone (src/admin/DatePicker.jsx, owner decision of 15/10/2026): below 640 px a date field is a
// button that shows its date as DD/MM/YYYY and opens three wheels in a sheet, the year, the month by its Hebrew name and the day, with the
// quick ranges under them. "אישור" chooses; the close button and Esc leave the field as it was. Here: the pair of fields of the filters
// (`DateRangeFields` of src/admin/filters.jsx) on their own, then inside the History tab and the audit log on a phone. What a real browser
// decides (the scroll and its snap, a tap, the place of the sheet, the colours, the pictures) is in e2e/date-picker.spec.js,
// e2e/a11y.spec.js and e2e/visual.spec.js.
//
// The clock is fixed: "today" is 14/10/2026 in the building. jsdom has no layout, so a row of a wheel is the 44 px that the CSS gives it
// (the picker's own fallback), and a scroll is the `scrollTop` that the test sets, with the touch around it that a finger makes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react'
import { DateRangeFields } from '../../src/admin/filters.jsx'
import { DatePicker } from '../../src/admin/DatePicker.jsx'
import { Field, ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import AuditView from '../../src/admin/views/AuditView.jsx'
import { daysInMonth, setDatePart } from '../../src/admin/calendar.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const NOW = '2026-10-14T09:00:00Z' // 12:00 on 14/10/2026 in the building
const WAIT = { timeout: 4000 }
const ROW = 44

/**
 * Stands in for `window.matchMedia` as a window `width` px wide: a `(min-width: N px)` query matches from N px, and the device asks for
 * less motion when `reduce` is true. `resize(width)` changes the width and tells every listener, as a phone that is turned does.
 */
function screenOf(width, { reduce = false } = {}) {
  let now = width
  const listeners = new Set()
  window.matchMedia = vi.fn((query) => ({
    get matches() {
      const min = /min-width:\s*(\d+)px/.exec(query)
      if (min) return now >= Number(min[1])
      return /prefers-reduced-motion:\s*reduce/.test(query) ? reduce : false
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }))
  return { resize: (to) => act(() => { now = to; for (const listener of listeners) listener() }) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }) // only the clock of Date: the pause of a wheel and Testing Library's waiting run on real timers
  vi.setSystemTime(new Date(NOW))
  document.documentElement.dir = 'rtl' // the committee app is right to left (index.html)
  screenOf(360)
})
afterEach(() => {
  cleanup()
  delete window.matchMedia
  delete HTMLElement.prototype.scrollTo
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
      <DateRangeFields from={dates.from} to={dates.to} onFrom={set('from')} onTo={set('to')} />
    </div>
  )
}

const fromField = () => screen.getByLabelText('מתאריך')
const toField = () => screen.getByLabelText('עד תאריך')
/** The sheet of the wheels (a dialog named after the date it chooses), or the dialog of that name. */
const sheet = (name) => (name ? screen.getByRole('dialog', { name }) : screen.getAllByRole('dialog').find((dialog) => within(dialog).queryAllByRole('listbox').length))
const wheel = (name) => within(sheet()).getByRole('listbox', { name })
const options = (name) => within(wheel(name)).getAllByRole('option')
const chosen = (name) => within(wheel(name)).getByRole('option', { selected: true })
const option = (name, label) => within(wheel(name)).getByRole('option', { name: label })
/** What the three wheels show as chosen, as DD/MM/YYYY: the name of the chosen day is its full date. */
const shown = () => chosen('יום').getAttribute('aria-label')
const focused = () => document.activeElement
const press = (key, options = {}) => fireEvent.keyDown(focused(), { key, ...options })
const open = (field = fromField()) => { fireEvent.click(field); return sheet() }
const ok = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'אישור' }))

/** A finger that scrolls `name` so that row `index` stands in the band, and lets go: the wheel chooses it when it stops. */
async function scrollTo(name, index) {
  const list = wheel(name)
  fireEvent.touchStart(list)
  list.scrollTop = index * ROW
  fireEvent.scroll(list)
  fireEvent.touchEnd(list)
}

describe('the field on a phone', () => {
  it('is a button that shows the date as DD/MM/YYYY, named by its label and that date, and opens a dialog: no text field, so no keyboard', () => {
    render(<Pair />)
    expect(fromField().tagName).toBe('BUTTON')
    expect(fromField().getAttribute('type')).toBe('button')
    expect(fromField().getAttribute('aria-haspopup')).toBe('dialog')
    expect(fromField().textContent).toBe('05/10/2026')
    expect(screen.getByRole('button', { name: 'מתאריך 05/10/2026' })).toBe(fromField())
    expect(screen.getByRole('button', { name: 'עד תאריך 10/10/2026' })).toBe(toField())
    expect(screen.queryByRole('textbox'), 'no text field').toBeNull()
    expect(document.querySelector('input'), 'no input of any kind').toBeNull()
    expect(screen.queryByRole('button', { name: /^לוח שנה/ }), 'the calendar is inside the field, not a button of its own').toBeNull()
  })

  it('shows the placeholder when it is empty, and a screen reader hears that nothing is chosen', () => {
    render(<Pair from="" to="" />)
    expect(fromField().querySelector('[aria-hidden="true"]').textContent).toBe('DD/MM/YYYY')
    expect(screen.getByRole('button', { name: 'מתאריך לא נבחר' })).toBe(fromField())
  })

  it('from 640 px it is the field that takes typing, with the calendar button beside it (the computer\'s picker, as it was)', () => {
    screenOf(640)
    render(<Pair />)
    expect(fromField().tagName).toBe('INPUT')
    expect(fromField().value).toBe('05/10/2026')
    expect(screen.getByRole('button', { name: 'לוח שנה: תאריך התחלה' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'לוח שנה: תאריך התחלה' }))
    expect(screen.getByRole('grid')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('keeps what it drew while the wheels are open, and follows the window once they close (a phone that is turned)', () => {
    const window = screenOf(360)
    render(<Pair />)
    open()
    window.resize(800)
    expect(sheet(), 'the wheels stay open').toBeTruthy()
    expect(fromField().tagName).toBe('BUTTON')
    press('Escape')
    expect(fromField().tagName, 'closed: the computer\'s field').toBe('INPUT')
  })

  it('keeps a date that is half typed in the computer\'s field when the window narrows, until it is finished', () => {
    const window = screenOf(800)
    render(<Pair />)
    fireEvent.change(fromField(), { target: { value: '0110' } })
    window.resize(360)
    expect(fromField().tagName).toBe('INPUT')
    expect(fromField().value).toBe('01/10')
    fireEvent.change(fromField(), { target: { value: '01/102026' } })
    expect(fromField().tagName, 'finished: the phone\'s field').toBe('BUTTON')
    expect(fromField().textContent).toBe('01/10/2026')
  })
})

describe('the wheels', () => {
  it('open in a sheet named after the date they choose: the year, the month and the day, from the right, on the field\'s date', () => {
    render(<Pair />)
    const dialog = open()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('a-modal--sheet')).toBe(true)
    expect(within(dialog).getAllByRole('listbox').map((list) => list.getAttribute('aria-label')), 'in the order of reading, right to left').toEqual(['שנה', 'חודש', 'יום'])
    expect(chosen('שנה').textContent).toBe('2026')
    expect(chosen('חודש').textContent).toBe('אוקטובר')
    expect(chosen('יום').textContent).toBe('5')
    expect(focused(), 'the focus starts on the chosen day').toBe(chosen('יום'))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('open on today when the field is empty', () => {
    render(<Pair from="" to="" />)
    open()
    expect(shown()).toBe('14/10/2026')
  })

  it('name every option so that a screen reader reads it without guessing: a year by itself, a month by its name and its number, a day by its full date', () => {
    render(<Pair />)
    open()
    expect(options('שנה').map((o) => o.textContent)).toEqual(Array.from({ length: 27 }, (_, i) => String(2000 + i)))
    for (const year of options('שנה')) expect(year.hasAttribute('aria-label'), 'a year is named by its own digits').toBe(false)
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
    expect(options('חודש').map((o) => o.textContent)).toEqual(months)
    expect(options('חודש').map((o) => o.getAttribute('aria-label'))).toEqual(months.map((name, i) => `${name}, חודש ${i + 1}`))
    expect(options('יום').map((o) => o.textContent)).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1)))
    expect(options('יום').map((o) => o.getAttribute('aria-label'))).toEqual(Array.from({ length: 31 }, (_, i) => `${String(i + 1).padStart(2, '0')}/10/2026`))
    expect(option('חודש', 'אוקטובר, חודש 10').getAttribute('aria-selected')).toBe('true')
    expect(option('חודש', 'ספטמבר, חודש 9').getAttribute('aria-selected')).toBe('false')
  })

  it('keep one option of each wheel in the tab order, the chosen one; Tab goes round the close button, the wheels, the quick ranges and "אישור"', () => {
    render(<Pair />)
    const dialog = open()
    for (const name of ['שנה', 'חודש', 'יום']) expect(options(name).filter((o) => o.tabIndex === 0), name).toEqual([chosen(name)])
    const okButton = within(dialog).getByRole('button', { name: 'אישור' })
    okButton.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(focused()).toBe(within(dialog).getByRole('button', { name: 'סגירה' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(focused()).toBe(okButton)
  })
})

describe('the days of the month follow the month and the year', () => {
  const cases = [['2026-01-15', 31], ['2026-02-10', 28], ['2024-02-10', 29], ['2020-02-10', 29], ['2000-02-10', 29], ['2026-04-10', 30], ['2025-09-30', 30], ['2025-12-01', 31]]
  for (const [day, count] of cases) {
    it(`${day.slice(5, 7)}/${day.slice(0, 4)} has ${count} days`, () => {
      render(<Pair from={day} />)
      open()
      expect(options('יום')).toHaveLength(count)
      expect(daysInMonth(day)).toBe(count)
    })
  }

  it('a month that is shorter cuts the day to its last: 31/01 becomes 28/02, and 29/02 in a leap year', () => {
    render(<Pair from="2026-01-31" />)
    open()
    fireEvent.click(option('חודש', 'פברואר, חודש 2'))
    expect(shown()).toBe('28/02/2026')
    expect(options('יום')).toHaveLength(28)
    fireEvent.click(option('שנה', '2024'))
    expect(shown(), 'the day stays the 28th when the year changes').toBe('28/02/2024')
    expect(options('יום'), 'February of a leap year').toHaveLength(29)
    fireEvent.click(option('יום', '29/02/2024'))
    fireEvent.click(option('שנה', '2025'))
    expect(shown(), 'no 29 February in 2025').toBe('28/02/2025')
  })

  it('the arithmetic: a part is set, the others kept, the day cut to the month and kept from 2000 to today', () => {
    expect(setDatePart('2026-01-31', 'month', 2)).toBe('2026-02-28')
    expect(setDatePart('2028-03-31', 'month', 2)).toBe('2028-02-29')
    expect(setDatePart('2024-02-29', 'year', 2023)).toBe('2023-02-28')
    expect(setDatePart('2025-12-20', 'year', 2026, '2000-01-01', '2026-10-14')).toBe('2026-10-14')
    expect(setDatePart('2026-10-05', 'day', 20, '2000-01-01', '2026-10-14')).toBe('2026-10-14')
    expect(setDatePart('2026-10-05', 'day', 9)).toBe('2026-10-09')
  })
})

describe('nothing after today', () => {
  it('the years end at this year, and the months and days after today are drawn and cannot be chosen', () => {
    render(<Pair />)
    open()
    expect(options('שנה').at(-1).textContent).toBe('2026')
    expect(options('חודש').filter((o) => o.getAttribute('aria-disabled') === 'true').map((o) => o.textContent)).toEqual(['נובמבר', 'דצמבר'])
    expect(options('יום').filter((o) => o.getAttribute('aria-disabled') === 'true')).toHaveLength(31 - 14)
    expect(option('יום', '14/10/2026').hasAttribute('aria-disabled')).toBe(false)
    expect(option('יום', '15/10/2026').getAttribute('aria-disabled')).toBe('true')
  })

  it('a tap on a day after today takes the last day that can be chosen, and so does a month after this one', () => {
    render(<Pair />)
    open()
    fireEvent.click(option('יום', '20/10/2026'))
    expect(shown()).toBe('14/10/2026')
    fireEvent.click(option('יום', '03/10/2026'))
    fireEvent.click(option('חודש', 'דצמבר, חודש 12'))
    expect(shown(), 'October, the last month that can be chosen, keeps its day').toBe('03/10/2026')
  })

  it('a year that would put the date after today brings it back to today', () => {
    render(<Pair from="2025-12-20" />)
    open()
    fireEvent.click(option('שנה', '2026'))
    expect(shown()).toBe('14/10/2026')
  })

  it('a scroll that stops on a day after today goes back to the last day that can be chosen', async () => {
    render(<Pair from="2026-10-10" />)
    open()
    await scrollTo('יום', 25) // the 26th
    await waitFor(() => expect(shown()).toBe('14/10/2026'), WAIT)
    await waitFor(() => expect(wheel('יום').scrollTop, 'the wheel is back on the 14th').toBe(13 * ROW), WAIT)
  })
})

describe('the keys', () => {
  it('Up and Down move one row, PageUp and PageDown five, Home and End to the first and the last that can be chosen; the focus moves with them', () => {
    render(<Pair from="2026-10-07" />)
    open()
    expect(focused()).toBe(chosen('יום'))
    const steps = [
      ['ArrowDown', '08/10/2026'], ['ArrowUp', '07/10/2026'], ['ArrowUp', '06/10/2026'], ['PageUp', '01/10/2026'], ['PageDown', '06/10/2026'],
      ['PageDown', '11/10/2026'], ['PageDown', '14/10/2026'], ['ArrowDown', '14/10/2026'], ['Home', '01/10/2026'], ['ArrowUp', '01/10/2026'],
      ['End', '14/10/2026'],
    ]
    for (const [key, day] of steps) {
      press(key)
      expect(shown(), `${key} goes to ${day}`).toBe(day)
      expect(focused(), `${key}: the focus is on the chosen day`).toBe(chosen('יום'))
      expect(focused().tabIndex).toBe(0)
    }
  })

  it('on the month wheel: by one, by five, the first and the last month that can be chosen (October in this year)', () => {
    render(<Pair from="2026-07-07" />)
    open()
    chosen('חודש').focus()
    const steps = [['ArrowUp', 'יוני'], ['PageUp', 'ינואר'], ['ArrowUp', 'ינואר'], ['PageDown', 'יוני'], ['End', 'אוקטובר'], ['ArrowDown', 'אוקטובר'], ['Home', 'ינואר']]
    for (const [key, month] of steps) {
      press(key)
      expect(chosen('חודש').textContent, `${key} goes to ${month}`).toBe(month)
      expect(focused()).toBe(chosen('חודש'))
    }
  })

  it('on the year wheel: by one, by five, 2000 and this year', () => {
    render(<Pair from="2020-03-03" />)
    open()
    chosen('שנה').focus()
    const steps = [['ArrowDown', '2021'], ['PageDown', '2026'], ['ArrowDown', '2026'], ['PageUp', '2021'], ['Home', '2000'], ['ArrowUp', '2000'], ['End', '2026']]
    for (const [key, year] of steps) {
      press(key)
      expect(chosen('שנה').textContent, `${key} goes to ${year}`).toBe(year)
      expect(focused()).toBe(chosen('שנה'))
    }
  })

  it('the keys of a wheel are kept from the page (no scrolling); other keys are left alone', () => {
    render(<Pair />)
    open()
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) expect(press(key), key).toBe(false) // false: the default was prevented
    expect(press('a')).toBe(true)
  })

  it('Enter is "אישור": the field takes the date of the wheels, and the focus is back on it', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    press('ArrowUp') // the 4th
    press('Enter')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fromField().textContent).toBe('04/10/2026')
    expect(seen).toEqual([['from', '2026-10-04']])
    expect(focused()).toBe(fromField())
  })
})

describe('touch', () => {
  it('a scroll that the person makes chooses the row that stops in the band', async () => {
    render(<Pair />)
    open()
    await scrollTo('יום', 1) // the 2nd
    await waitFor(() => expect(shown()).toBe('02/10/2026'), WAIT)
    await scrollTo('חודש', 2) // March
    await waitFor(() => expect(shown()).toBe('02/03/2026'), WAIT)
    await scrollTo('שנה', 20) // 2020
    await waitFor(() => expect(shown()).toBe('02/03/2020'), WAIT)
  })

  it('a scroll that the person did not make (a screen reader brings an option into view) chooses nothing', async () => {
    render(<Pair />)
    open()
    const list = wheel('יום')
    list.scrollTop = 20 * ROW
    fireEvent.scroll(list)
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(shown()).toBe('05/10/2026')
  })

  it('nothing is chosen while the finger is still on the wheel', async () => {
    render(<Pair />)
    open()
    const list = wheel('יום')
    fireEvent.touchStart(list)
    list.scrollTop = 2 * ROW
    fireEvent.scroll(list)
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(shown(), 'held').toBe('05/10/2026')
    fireEvent.touchEnd(list)
    await waitFor(() => expect(shown()).toBe('03/10/2026'), WAIT)
  })

  it('a tap on a row chooses it and brings it into the band, smoothly, or at once when the device asks for less motion', () => {
    HTMLElement.prototype.scrollTo = vi.fn()
    render(<Pair />)
    open()
    fireEvent.click(option('יום', '09/10/2026'))
    expect(shown()).toBe('09/10/2026')
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 8 * ROW, behavior: 'smooth' })
    press('Escape')
    cleanup()

    screenOf(360, { reduce: true })
    HTMLElement.prototype.scrollTo = vi.fn()
    render(<Pair />)
    open()
    fireEvent.click(option('יום', '09/10/2026'))
    expect(HTMLElement.prototype.scrollTo, 'no smooth scroll').not.toHaveBeenCalled()
    expect(wheel('יום').scrollTop, 'at once').toBe(8 * ROW)
  })

  it('opens with each chosen row already in the band, at once', () => {
    HTMLElement.prototype.scrollTo = vi.fn()
    render(<Pair from="2024-03-09" />)
    open()
    expect(wheel('שנה').scrollTop).toBe(24 * ROW)
    expect(wheel('חודש').scrollTop).toBe(2 * ROW)
    expect(wheel('יום').scrollTop).toBe(8 * ROW)
    expect(HTMLElement.prototype.scrollTo, 'nothing slides as it opens').not.toHaveBeenCalled()
  })
})

describe('choosing and cancelling', () => {
  it('"אישור" puts the date of the wheels into the field as DD/MM/YYYY, and gives the focus back to the field', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open(toField())
    fireEvent.click(option('שנה', '2025'))
    fireEvent.click(option('חודש', 'מרץ, חודש 3'))
    fireEvent.click(option('יום', '31/03/2025'))
    ok()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toField().textContent).toBe('31/03/2025')
    expect(screen.getByRole('button', { name: 'עד תאריך 31/03/2025' })).toBe(toField())
    expect(seen).toEqual([['to', '2025-03-31']])
    expect(focused()).toBe(toField())
  })

  it('"אישור" with nothing moved chooses the date that the wheels opened on (today for an empty field)', () => {
    const seen = []
    render(<Pair from="" to="" seen={seen} />)
    open()
    ok()
    expect(fromField().textContent).toBe('14/10/2026')
    expect(seen).toEqual([['from', '2026-10-14']])
  })

  it('Esc and the close button leave the field as it was, and give the focus back to it', () => {
    const seen = []
    render(<Pair seen={seen} />)
    open()
    fireEvent.click(option('יום', '01/10/2026'))
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fromField().textContent).toBe('05/10/2026')
    expect(focused()).toBe(fromField())
    open()
    expect(shown(), 'the wheels open on the field\'s date again, not on the one that was dropped').toBe('05/10/2026')
    fireEvent.click(option('יום', '01/10/2026'))
    fireEvent.click(within(sheet()).getByRole('button', { name: 'סגירה' }))
    expect(fromField().textContent).toBe('05/10/2026')
    expect(seen).toEqual([])
    expect(focused()).toBe(fromField())
  })

  it('a field outside a pair has the wheels and no quick ranges', () => {
    const seen = []
    render(<div className="a-app"><Field label="מתאריך"><DatePicker label="תאריך התחלה" value="2026-10-05" onChange={(v) => seen.push(v)} /></Field></div>)
    open()
    expect(within(sheet()).queryByRole('group', { name: 'טווחי תאריכים מהירים' })).toBeNull()
    ok()
    expect(seen).toEqual(['2026-10-05'])
  })
})

describe('the quick ranges under the wheels, by the building\'s day', () => {
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
  })

  for (const [label, start, end] of cases) {
    it(`"${label}" sets both dates at once, ${start} to ${end}, from either field, with no "אישור"`, () => {
      for (const which of ['from', 'to']) {
        const seen = []
        render(<Pair seen={seen} />)
        const dialog = open(which === 'from' ? fromField() : toField())
        fireEvent.click(within(within(dialog).getByRole('group', { name: 'טווחי תאריכים מהירים' })).getByRole('button', { name: label }))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect([fromField().textContent, toField().textContent], which).toEqual([start, end])
        const iso = (ddmmyyyy) => ddmmyyyy.split('/').reverse().join('-')
        expect(seen, which).toEqual([['from', iso(start)], ['to', iso(end)]])
        expect(focused()).toBe(which === 'from' ? fromField() : toField())
        cleanup()
      }
    })
  }

  it('the wheels end on the building\'s day too', () => {
    render(<Pair from="" to="" />)
    open()
    expect(shown()).toBe('14/10/2026')
    expect(option('יום', '15/10/2026').getAttribute('aria-disabled')).toBe('true')
  })
})

// ---- inside the screens ----------------------------------------------------------------------------------------------------------

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

describe('in the History tab on a phone', () => {
  it('the wheels open over the sheet of filters, Esc closes only them, and "show results" applies what "אישור" chose', async () => {
    server()
    render(<div className="a-app"><ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider></div>)
    await screen.findByText('נותן סריקה', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: /^סינון/ }))
    const filters = screen.getByRole('dialog', { name: 'סינון' })
    const from = within(filters).getByLabelText('מתאריך')
    expect(from.tagName).toBe('BUTTON')
    expect(from.textContent, 'the default week').toBe('08/10/2026')
    fireEvent.click(from)
    expect(focused()).toBe(chosen('יום'))
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'תאריך התחלה' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'סינון' }), 'the sheet is still open').toBeTruthy()
    expect(focused()).toBe(from)

    fireEvent.click(from)
    fireEvent.click(option('חודש', 'ספטמבר, חודש 9'))
    fireEvent.click(option('יום', '20/09/2026'))
    ok()
    expect(within(filters).getByLabelText('מתאריך').textContent).toBe('20/09/2026')
    expect(calls('/admin/scans'), 'nothing is applied before "show results"').toHaveLength(1)
    // a choice that is not shown yet is unsaved (F4): Esc on the sheet asks
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'לסגור בלי להציג את התוצאות?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לסינון' }))
    fireEvent.click(within(filters).getByRole('button', { name: 'הצגת תוצאות' }))
    await waitFor(() => expect(lastParams('/admin/scans')).toMatchObject({ from: '2026-09-20', to: '2026-10-14' }), WAIT)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('in the audit log on a phone', () => {
  it('a quick range fills the two empty fields of the sheet, and "show results" asks for them', async () => {
    server()
    render(<div className="a-app"><ToastProvider><AuditView /></ToastProvider></div>)
    await screen.findByText('עוד לא נרשמו פעולות', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: /^סינון/ }))
    const filters = screen.getByRole('dialog', { name: 'סינון' })
    expect(within(filters).getByRole('button', { name: 'מתאריך לא נבחר' })).toBeTruthy()
    fireEvent.click(within(filters).getByLabelText('עד תאריך'))
    fireEvent.click(within(sheet('תאריך סיום')).getByRole('button', { name: '7 ימים' }))
    expect([within(filters).getByLabelText('מתאריך').textContent, within(filters).getByLabelText('עד תאריך').textContent]).toEqual(['08/10/2026', '14/10/2026'])
    fireEvent.click(within(filters).getByRole('button', { name: 'הצגת תוצאות' }))
    await waitFor(() => expect(lastParams('/admin/audit')).toMatchObject({ from: '2026-10-08', to: '2026-10-14' }), WAIT)
  })
})
