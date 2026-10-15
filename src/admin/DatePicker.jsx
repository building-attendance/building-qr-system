import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { DateInput, Modal, POPOVER_QUERY } from './ui.jsx'
import { IconCalendar, IconChevron } from './icons.jsx'
import { useNarrowerThan } from './hooks.js'
import { dayInitials, formatDay, formatDayNumber, formatMonth, isoDay, monthName } from '../../shared/datetime.js'
import { FIRST_DAY, QUICK_RANGES, addDays, addMonths, clampDay, daysInMonth, endOfWeek, isDay, monthWeeks, setDatePart, startOfWeek } from './calendar.js'

// The committee app's own date picker (owner decisions of 14/10/2026 and 15/10/2026): every date filter opens a picker instead of only taking
// typing. The browser's own date field stays out, because it writes the device's locale (AGENTS.md, the date rule). Which picker is drawn is
// decided by the width of the window (`useNarrowerThan` at 640 px, the width where a dialog stops being a sheet from the bottom):
//
// - From 640 px (a computer, a tablet) it is the WAI-ARIA Authoring Practices "Date Picker Dialog"
//   (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/): the field (`DateInput`, which keeps its typing, its
//   mask and its check of a half-typed date) and a button beside it that opens a dialog with a month grid, a popover beside the field.
// - Below 640 px (a phone) the field is a button that shows the date as DD/MM/YYYY (or the placeholder) with the calendar at its end, so no
//   keyboard comes up, and it opens three wheels in a sheet from the bottom: the year, the month by its Hebrew name and the day, from the right
//   (the owner's picture of an iPhone's wheels). "אישור" chooses the date of the wheels; "ניקוי התאריך" empties the field, as erasing the
//   computer's field does; the close button and Esc leave the field as it was.
//
// Both are the app's `Modal` (its focus trap, Esc, the focus that goes back to the button, the stack of dialogs), and both have the quick
// ranges under them when the field belongs to a pair of dates. The layout that is drawn is held while the picker is open and while the field
// holds a date that is half typed, so that a phone that is turned or a window that is resized takes neither away (as `usePhoneLayout` holds
// the filters).
//
// The grid (written by shared/datetime.js only, the exception of 14/10/2026): its title is the month as MM/YYYY, its columns are headed by
// the initials of the days, Sunday first, and each day is a button that shows its number and is named by its full DD/MM/YYYY. The wheels (the
// exception of 15/10/2026): only the month wheel shows a name, `monthName`, and every option of a wheel has a name that a screen reader reads
// without guessing (a day by its full DD/MM/YYYY, a month by its name and its number, a year by itself). The chosen date goes into the field
// as DD/MM/YYYY. Days after today (the building's day) and before 2000 cannot be chosen: a filter of records that happened has nothing in the
// future, and the field takes no year before 2000 (`parseDay`).
//
// The keys of the grid (the APG's): the arrows move a day, mirrored right to left (in a Hebrew grid the day to the left is the next one), up
// and down a week; Home and End go to the start (Sunday) and the end of the week; PageUp and PageDown change the month (with Shift the year);
// Enter or Space chooses; Esc closes and gives the focus back to the button. The grid keeps one day in the tab order, the chosen day or
// today when it opens. The keys of a wheel are below, with `Wheel`.

/** The quick ranges under the grid and under the wheels: each sets both dates of the filter group, ending today (`onRange({ from, to })`). */
function QuickRanges({ today, onRange }) {
  return (
    <div className="a-cal__quick" role="group" aria-label="טווחי תאריכים מהירים">
      {QUICK_RANGES.map((quick) => (
        <button key={quick.key} type="button" className="w-btn w-btn--quiet w-btn--small a-cal__range" onClick={() => onRange(quick.range(today))}>{quick.label}</button>
      ))}
    </div>
  )
}

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
      {onRange && <QuickRanges today={today} onRange={onRange} />}
    </div>
  )
}

// ---- the wheels of a phone --------------------------------------------------------------------------------------------------------

const ROW_PX = 44 // the height of a row of a wheel (--w-layout-wheel-row in src/ui/base.css, a 44 px target), when the page has no layout to measure (jsdom)
const PAGE_ROWS = 5 // PageUp and PageDown move a wheel by five rows, as the WAI-ARIA example of three date wheels does
const SETTLE_MS = 120 // a wheel that has not scrolled for this long has stopped: the row in the band is chosen

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
const rowHeight = (list) => list.querySelector('[role="option"]')?.offsetHeight || ROW_PX

/**
 * One wheel: a list of options that scrolls through a band, the chosen option in the band. It is a WAI-ARIA listbox
 * (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/), single choice, the choice following the focus, and not a spin button: each option is
 * an element of its own with its own name, so VoiceOver and TalkBack reach it by a swipe and choose it by a double tap, the gestures that
 * they always pass to the page as a click. A spin button changes its value only by an "adjust" gesture that the browser must turn into
 * an arrow key, which the APG marks as having gaps on touch devices, and TalkBack may read a percentage instead of `aria-valuetext`.
 *
 * `options` is `[{ value, text, name, disabled }]`: `text` is what the row shows, `name` (optional) what a screen reader reads instead. The
 * options that cannot be chosen (after today) are always the last ones. `selected` is the value of the chosen one, and `onSelect(value)` is
 * told the value that the person chose.
 *
 * - Touch: the wheel scrolls (a drag, a flick), each row snaps into the band (CSS scroll snap), and when it stops the row in the band is
 *   chosen. A scroll that the person did not make (the wheel's own, or a screen reader's that brings an option into view) chooses nothing.
 *   A tap on a row chooses it. A row that cannot be chosen sends the wheel back to the last one that can.
 * - Keys: Up and Down move one row, PageUp and PageDown five, Home to the first and End to the last that can be chosen; the focus moves with
 *   the choice. The wheel keeps one option in the tab order, the chosen one.
 * - The wheel moves to the chosen row smoothly, or at once when the person asks the device for less motion (and when it first opens).
 */
function Wheel({ kind, label, options, selected, onSelect }) {
  const listRef = useRef(null)
  const placed = useRef(false)
  const gesture = useRef({ down: false, moved: false }) // a finger or a button is on the wheel; the person scrolled it since it was last chosen
  const timer = useRef(0)
  const [align, setAlign] = useState(0) // asks the wheel to bring the chosen row back into the band
  const index = Math.max(0, options.findIndex((option) => option.value === selected))
  const last = Math.max(0, options.filter((option) => !option.disabled).length - 1) // the options after today are the last ones (and Safari 14 has no findLastIndex)

  // The chosen row stands in the band, and the focus, when it is in this wheel, is on it.
  useLayoutEffect(() => {
    const list = listRef.current
    const top = index * rowHeight(list)
    if (Math.abs(list.scrollTop - top) >= 1) {
      if (!placed.current || reducedMotion() || typeof list.scrollTo !== 'function') list.scrollTop = top
      else list.scrollTo({ top, behavior: 'smooth' })
    }
    placed.current = true
    const active = document.activeElement
    if (list.contains(active) && active.getAttribute('aria-selected') !== 'true') list.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true })
  }, [index, align])
  useEffect(() => () => clearTimeout(timer.current), [])

  const choose = (i) => {
    const to = Math.max(0, Math.min(i, last))
    if (options[to].value !== selected) onSelect(options[to].value)
    setAlign((n) => n + 1)
  }
  const settle = () => {
    const { down, moved } = gesture.current
    if (down || !moved) return // a finger is still on it, or the person did not scroll it
    gesture.current.moved = false
    const list = listRef.current
    choose(Math.round(list.scrollTop / rowHeight(list)))
  }
  const wait = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(settle, SETTLE_MS)
  }
  const press = () => { gesture.current = { down: true, moved: true } }
  const lift = () => {
    gesture.current.down = false
    wait() // the wheel may have stopped before the finger left it
  }
  const onKeyDown = (event) => {
    const moves = { ArrowUp: index - 1, ArrowDown: index + 1, PageUp: index - PAGE_ROWS, PageDown: index + PAGE_ROWS, Home: 0, End: last }
    if (!(event.key in moves)) return
    event.preventDefault() // the keys move the wheel, not the page
    gesture.current.moved = false
    choose(moves[event.key])
  }

  return (
    <div
      ref={listRef} role="listbox" aria-label={label} className={`a-wheel a-wheel--${kind}`} data-wheel={kind} onKeyDown={onKeyDown} onScroll={wait}
      onTouchStart={press} onTouchEnd={lift} onTouchCancel={lift} onWheel={() => { gesture.current.moved = true }}
      onPointerDown={(event) => { if (event.pointerType !== 'touch') press() }}
      onPointerUp={(event) => { if (event.pointerType !== 'touch') lift() }}
      onPointerCancel={(event) => { if (event.pointerType !== 'touch') lift() }}
    >
      {options.map((option, i) => (
        <div
          key={option.value} role="option" className="a-wheel__row" aria-selected={i === index} aria-disabled={option.disabled || undefined}
          aria-label={option.name} tabIndex={i === index ? 0 : -1}
          onClick={() => { gesture.current.moved = false; choose(i) }}
        >
          {option.text}
        </div>
      ))}
    </div>
  )
}

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * The three wheels, from the right: the year (2000 to this year), the month by its name, and the day (as many as the month has). `day` is
 * the date that they show, and `onChange(update)` takes a function from the date to the new one. A part that is changed keeps the others,
 * cuts the day to the last of a shorter month, and never goes past today (`setDatePart`), so a month or a day after today is drawn and cannot
 * be chosen. Enter, on any wheel, is "אישור" (`onEnter`).
 */
function Wheels({ day, today, onChange, onEnter }) {
  const set = (part) => (n) => onChange((current) => setDatePart(current, part, n, FIRST_DAY, today))
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))]
  const [lastYear, lastMonth] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]
  const years = Array.from({ length: lastYear - Number(FIRST_DAY.slice(0, 4)) + 1 }, (_, i) => {
    const n = Number(FIRST_DAY.slice(0, 4)) + i
    return { value: n, text: String(n) }
  })
  const months = Array.from({ length: 12 }, (_, i) => {
    const first = `${day.slice(0, 5)}${pad2(i + 1)}-01`
    return { value: i + 1, text: monthName(first), name: `${monthName(first)}, חודש ${i + 1}`, disabled: year === lastYear && i + 1 > lastMonth }
  })
  const days = Array.from({ length: daysInMonth(day) }, (_, i) => {
    const date = `${day.slice(0, 8)}${pad2(i + 1)}`
    return { value: i + 1, text: formatDayNumber(date), name: formatDay(date), disabled: date > today }
  })
  const onKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onEnter()
  }
  return (
    <div className="a-wheels" onKeyDown={onKeyDown}>
      <Wheel kind="year" label="שנה" options={years} selected={year} onSelect={set('year')} />
      <Wheel kind="month" label="חודש" options={months} selected={month} onSelect={set('month')} />
      <Wheel kind="day" label="יום" options={days} selected={Number(day.slice(8, 10))} onSelect={set('day')} />
    </div>
  )
}

/**
 * The sheet of the wheels. It keeps its own date (`draft`, the field's date or today, kept from 2000 to today) until "אישור" hands it to
 * `onChoose(day)`; the close button and Esc (`onClose`) leave the field as it was. The focus starts on the chosen day.
 *
 * A field that holds a date can be emptied, as the computer's field can by erasing its text (every date filter may be empty: the list then
 * has no limit on that side): "ניקוי התאריך", beside "אישור", hands `onChoose` an empty date. It empties this field only, so the other date
 * and the other filters stay. It is a button of the sheet's foot and not of the field, which is a button itself.
 */
function WheelsSheet({ label, value, today, onChoose, onRange, onClose, returnFocus }) {
  const [draft, setDraft] = useState(() => clampDay(isDay(value) ? value : today, FIRST_DAY, today))
  return (
    <Modal
      title={label} size="sheet" onClose={onClose} returnFocus={returnFocus}
      initialFocus={(dialog) => dialog.querySelector('[data-wheel="day"] [aria-selected="true"]')}
      footer={(
        <div className="a-wheels__foot">
          {isDay(value) && <button type="button" className="w-btn w-btn--quiet" onClick={() => onChoose('')}>ניקוי התאריך</button>}
          <button type="button" className="w-btn" onClick={() => onChoose(draft)}>אישור</button>
        </div>
      )}
    >
      <Wheels day={draft} today={today} onChange={setDraft} onEnter={() => onChoose(draft)} />
      {onRange && <QuickRanges today={today} onRange={onRange} />}
    </Modal>
  )
}

/**
 * A date field with its picker. `value` and `onChange` use 'YYYY-MM-DD' (what the API takes); on a computer the typing is `DateInput`'s, with
 * its `onPendingChange`. `id` and the `aria-*` that a `Field` gives are the field's (on a phone its name is the label of the `Field` and the
 * date). `label` names what is chosen (the dialog's title, and the name of the calendar's button with "לוח שנה"). `range` and
 * `onRange(from, to)` are for a pair of dates (see `DateRangeFields`): the band of the range, and the quick ranges, which set both.
 * `revision` draws the field again from its value when it changes (a quick range chosen in the other field of the pair), so that a date half
 * typed in it goes; a day chosen here does the same for this field.
 */
export function DatePicker({ value, onChange, onPendingChange, label, range, onRange, revision = 0, ...field }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false) // the field holds a date that is half typed
  const [chosen, setChosen] = useState(0) // a day chosen in the calendar: the field is drawn again from it
  const phone = useNarrowerThan(POPOVER_QUERY, { hold: open || pending })
  const boxRef = useRef(null)
  const buttonRef = useRef(null)
  const valueId = useId()
  const today = isoDay()
  const name = `לוח שנה: ${label}`

  // The button takes the focus as it opens the picker, so that the dialog gives it back to the button when it closes: Safari does not
  // focus a button that is tapped, and the dialog gives the focus back to whatever had it when it opened (in the sheet of the filters,
  // the sheet itself).
  const openPicker = () => {
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
  const pendingChange = (now) => {
    setPending(now)
    onPendingChange?.(now)
  }

  if (phone) {
    // On a phone the field is a button: it shows the date as DD/MM/YYYY (or the placeholder), is named by the label of its field and that
    // date, and opens the wheels. No keyboard comes up.
    return (
      <div className="a-date" ref={boxRef}>
        <button
          ref={buttonRef} type="button" id={field.id} className="a-input a-date__field" aria-haspopup="dialog"
          aria-labelledby={field.id ? `${field.id}-label ${valueId}` : undefined} aria-describedby={field['aria-describedby']} onClick={openPicker}
        >
          <span id={valueId} className="a-date__value">
            {isDay(value) ? formatDay(value) : <><span className="a-date__placeholder" aria-hidden="true">DD/MM/YYYY</span><span className="w-sr">לא נבחר</span></>}
          </span>
          <IconCalendar size={20} />
        </button>
        {open && (
          <WheelsSheet label={label} value={value} today={today} onChoose={choose} onRange={chooseRange} onClose={() => setOpen(false)} returnFocus={() => buttonRef.current} />
        )}
      </div>
    )
  }

  return (
    <div className="a-date" ref={boxRef}>
      <DateInput key={`${chosen}.${revision}`} value={value} onChange={onChange} onPendingChange={pendingChange} {...field} />
      <button ref={buttonRef} type="button" className="a-date__btn" aria-label={name} title={name} aria-haspopup="dialog" onClick={openPicker}>
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
