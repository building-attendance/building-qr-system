import { useId, useLayoutEffect, useRef, useState } from 'react'
import { DateInput, Modal } from './ui.jsx'
import { IconCalendar, IconChevron } from './icons.jsx'
import { dayInitials, formatDay, formatDayNumber, formatMonth, isoDay } from '../../shared/datetime.js'
import { FIRST_DAY, QUICK_RANGES, addDays, addMonths, clampDay, endOfWeek, isDay, monthWeeks, startOfWeek } from './calendar.js'

// The committee app's own date picker (owner decision of 14/10/2026): every date filter opens a calendar instead of only taking typing.
// The browser's own date field stays out, because it writes the device's locale (AGENTS.md, the date rule).
//
// It is the WAI-ARIA Authoring Practices "Date Picker Dialog" (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/):
// the field (`DateInput`, which keeps its typing, its mask and its check of a half-typed date) and a button beside it that opens a dialog
// with a month grid. The dialog is the app's `Modal` (its focus trap, Esc, the focus that goes back to the button, the stack of dialogs):
// a sheet from the bottom on a phone, as every dialog is there (D7 of the redesign), and from 640 px a popover beside the field.
//
// The grid (written by shared/datetime.js only, the exception of 14/10/2026): its title is the month as MM/YYYY, its columns are headed by
// the initials of the days, Sunday first, and each day is a button that shows its number and is named by its full DD/MM/YYYY. The chosen
// date goes into the field as DD/MM/YYYY. Days after today (the building's day) and before 2000 cannot be chosen: a filter of records
// that happened has nothing in the future, and the field takes no year before 2000 (`parseDay`).
//
// The keys (the APG's): the arrows move a day, mirrored right to left (in a Hebrew grid the day to the left is the next one), up and down
// a week; Home and End go to the start (Sunday) and the end of the week; PageUp and PageDown change the month (with Shift the year);
// Enter or Space chooses; Esc closes and gives the focus back to the button. The grid keeps one day in the tab order, the chosen day or
// today when it opens.

/**
 * The month grid and, when the field belongs to a pair of dates, the quick ranges under it. `value` is the date of this field ('' for
 * none), `range` the two dates of its filter group (`{ from, to }`, drawn as a band from one to the other), `today` the building's day.
 * `onChoose(day)` takes a day; `onRange({ from, to })`, when given, takes a quick range.
 */
function Calendar({ value, range, today, onChoose, onRange }) {
  const last = today
  const [focused, setFocused] = useState(() => clampDay(isDay(value) ? value : today, FIRST_DAY, last))
  const move = useRef(false) // the focus follows `focused` after a key, never after a click on the arrows of the month
  const gridRef = useRef(null)
  const monthId = useId()

  useLayoutEffect(() => {
    if (!move.current) return
    move.current = false
    gridRef.current?.querySelector('[data-focus]')?.focus()
  }, [focused])

  const off = (day) => day < FIRST_DAY || day > last
  const go = (day) => {
    const next = clampDay(day, FIRST_DAY, last)
    if (next === focused) {
      gridRef.current?.querySelector('[data-focus]')?.focus() // the same day: no new render to move the focus there
      return
    }
    move.current = true
    setFocused(next)
  }
  const choose = (day) => {
    if (!off(day)) onChoose(day)
  }
  const onKey = (event) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    // The day that has the focus: the one of the tab order, or one that a click focused without choosing it (a day after today).
    const at = event.target.dataset?.day ?? focused
    const keys = {
      ArrowRight: () => addDays(at, rtl ? -1 : 1),
      ArrowLeft: () => addDays(at, rtl ? 1 : -1),
      ArrowUp: () => addDays(at, -7),
      ArrowDown: () => addDays(at, 7),
      Home: () => startOfWeek(at),
      End: () => endOfWeek(at),
      PageUp: () => addMonths(at, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(at, event.shiftKey ? 12 : 1),
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault() // the browser would click the button too
      choose(at)
    } else if (keys[event.key]) {
      event.preventDefault() // the arrows, Home, End and the page keys must not scroll the page
      go(keys[event.key]())
    }
  }
  // The arrows of the month leave the focus on themselves, and the day of the tab order moves with the month.
  const month = (n) => setFocused(clampDay(addMonths(focused, n), FIRST_DAY, last))
  const firstMonth = focused.slice(0, 7) === FIRST_DAY.slice(0, 7)
  const lastMonth = focused.slice(0, 7) === last.slice(0, 7)

  const { from, to } = range ?? {}
  const band = isDay(from) && isDay(to) && from < to
  const ends = new Set([from, to, value].filter(isDay))
  return (
    <div className="a-cal">
      <div className="a-cal__head">
        <button type="button" className="a-cal__nav a-cal__nav--back" aria-label="החודש הקודם" title="החודש הקודם"
          aria-disabled={firstMonth || undefined} onClick={() => { if (!firstMonth) month(-1) }}>
          <IconChevron size={22} />
        </button>
        <h3 className="a-cal__month" id={monthId} aria-live="polite">{formatMonth(focused)}</h3>
        <button type="button" className="a-cal__nav a-cal__nav--next" aria-label="החודש הבא" title="החודש הבא"
          aria-disabled={lastMonth || undefined} onClick={() => { if (!lastMonth) month(1) }}>
          <IconChevron size={22} className="w-flip" />
        </button>
      </div>
      <table className="a-cal__grid" role="grid" aria-labelledby={monthId} ref={gridRef} onKeyDown={onKey}>
        <thead>
          <tr>{dayInitials().map((initial, i) => <th key={i} scope="col">{initial}</th>)}</tr>
        </thead>
        <tbody>
          {monthWeeks(focused).map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                if (!day) return <td key={i} role="gridcell" />
                const inBand = band && day >= from && day <= to
                const cell = [inBand && 'is-in', inBand && day === from && 'is-start', inBand && day === to && 'is-end'].filter(Boolean).join(' ')
                return (
                  <td key={day} role="gridcell" className={cell || undefined} aria-selected={day === value || undefined}>
                    <button
                      type="button" className={`a-cal__day${ends.has(day) ? ' is-chosen' : ''}`} tabIndex={day === focused ? 0 : -1} data-day={day}
                      data-focus={day === focused || undefined} aria-label={formatDay(day)} aria-current={day === today ? 'date' : undefined}
                      aria-disabled={off(day) || undefined} onClick={() => choose(day)}
                    >
                      {formatDayNumber(day)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {onRange && (
        <div className="a-cal__quick" role="group" aria-label="טווחי תאריכים מהירים">
          {QUICK_RANGES.map((quick) => (
            <button key={quick.key} type="button" className="w-btn w-btn--quiet w-btn--small a-cal__range" onClick={() => onRange(quick.range(today))}>{quick.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A date field with its calendar. `value` and `onChange` use 'YYYY-MM-DD' (what the API takes) and the typing is `DateInput`'s, with its
 * `onPendingChange`; `id` and the `aria-*` that a `Field` gives are the field's. `label` names what is chosen (the dialog's title, and the
 * button's name with "לוח שנה"). `range` and `onRange(from, to)` are for a pair of dates (see `DateRangeFields`): the band of the range,
 * and the quick ranges, which set both. `revision` draws the field again from its value when it changes (a quick range chosen in the
 * other field of the pair), so that a date half typed in it goes; a day chosen here does the same for this field.
 */
export function DatePicker({ value, onChange, onPendingChange, label, range, onRange, revision = 0, ...field }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState(0) // a day chosen in the calendar: the field is drawn again from it
  const boxRef = useRef(null)
  const buttonRef = useRef(null)
  const today = isoDay()
  const name = `לוח שנה: ${label}`

  // The button takes the focus as it opens the calendar, so that the dialog gives it back to the button when it closes: Safari does not
  // focus a button that is tapped, and the dialog gives the focus back to whatever had it when it opened (in the sheet of the filters,
  // the sheet itself).
  const openCalendar = () => {
    buttonRef.current?.focus()
    setOpen(true)
  }
  const choose = (day) => {
    setOpen(false)
    setChosen((n) => n + 1)
    onChange(day)
  }
  const chooseRange = onRange && (({ from, to }) => {
    setOpen(false)
    onRange(from, to)
  })

  return (
    <div className="a-date" ref={boxRef}>
      <DateInput key={`${chosen}.${revision}`} value={value} onChange={onChange} onPendingChange={onPendingChange} {...field} />
      <button ref={buttonRef} type="button" className="a-date__btn" aria-label={name} title={name} aria-haspopup="dialog" onClick={openCalendar}>
        <IconCalendar size={22} />
      </button>
      {open && (
        <Modal
          title={label} size="popover" anchor={() => boxRef.current} returnFocus={() => buttonRef.current}
          initialFocus={(dialog) => dialog.querySelector('[data-focus]')} onClose={() => setOpen(false)}
        >
          <Calendar value={value} range={range} today={today} onChoose={choose} onRange={chooseRange} />
        </Modal>
      )}
    </div>
  )
}
