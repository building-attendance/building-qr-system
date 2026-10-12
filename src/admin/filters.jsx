import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Modal, Field, Badge, DateInput, useDirty } from './ui.jsx'
import { IconFilter, IconX } from './icons.jsx'
import { formatDay } from '../../shared/datetime.js'

// The filters of the two long lists of the committee app (the History tab and the audit log), as the phone shows them.
//
// On a computer the filters are a block of fields above the list, and the list follows them as they change: there is room, and nothing is
// hidden. On a phone that block was most of a screen (about 600px at 360 wide), so the first visit started below the fold. There the list
// is topped by one short bar (`FilterBar`: the button, the dates that are applied, and a chip for every other filter that is on), and the
// fields are in a sheet that pops up from the bottom (`FilterSheet`). The list is hidden behind the sheet, so nothing is asked of the
// server while the person chooses: the filters are applied when they press "show results". Which of the two layouts is drawn is decided by
// `usePhoneLayout` (hooks.js), and only that one is rendered, with one exception: a sheet that is open when the window crosses 1024 px (a
// tablet that is turned) stays open until the person applies, resets or closes it, because closing it would drop what they chose and a date
// that they half typed without the question that every other way of closing it asks (F4 of docs/design.md). The screen behind a modal is
// out of reach, so the inline controls that appear behind it do no harm, and the sheet is one component in one place of the tree, so it
// keeps its draft through the change.
//
// The other direction waits for the person's input too. On a computer the dates are typed in the inline fields, and a date that is half
// typed there lives in the text of its own field (`DateInput`), which unmounts with the inline block when the window goes below 1024 px. So
// while an inline date is unfinished (`useUnfinishedDates`) the screen holds the computer layout (`usePhoneLayout({ hold })`), which has
// worked at any width, and it switches to the bar once the date is finished or cleared.

/** A date that a list is asked for: a complete, sensible one. A date typed digit by digit passes through nonsense ("0002-..."). */
export const goodDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000

/**
 * Where the focus goes when the sheet closes and the button that opened it is gone (the window crossed 1024 px while it was open): as
 * `[ref, returnFocus]`. `ref` goes on whichever of the bar (`FilterBar`) and the inline block is drawn, and `returnFocus` (for
 * `FilterSheet`) gives the first control in it: the "סינון" button of the bar, or the first field of the inline block.
 */
export function useFilterFocus() {
  const ref = useRef(null)
  const returnFocus = useCallback(() => ref.current?.querySelector('button, input, select') ?? null, [])
  return [ref, returnFocus]
}

/**
 * Which of the two inline date fields hold a date that is not finished, as `[{ from, to }, onPending]`: `onPending` is for
 * `DateRangeFields`. The History tab holds its export back while one is unfinished, and both screens hold their layout.
 */
export function useUnfinishedDates() {
  const [unfinished, setUnfinished] = useState({ from: false, to: false })
  const onPending = (key) => (pending) => setUnfinished((u) => (u[key] === pending ? u : { ...u, [key]: pending }))
  return [unfinished, onPending]
}

/** True when two sets of filters say the same. */
export function sameFilters(a, b) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[key] !== b[key]) return false
  return true
}

/**
 * The two date fields. They are two direct children of whatever holds them (a fragment), so the block of the computer layout, a grid of
 * its own, keeps its cells. `onPending(key)` gives the function that is told when a field holds a date that is not finished (see
 * `DateInput`); `errors` is `{ from, to }`, the messages under the fields.
 */
export function DateRangeFields({ from, to, onFrom, onTo, onPending, errors = {} }) {
  return (
    <>
      <Field label="מתאריך" className="a-filter-date" error={errors.from}>
        <DateInput value={from} onChange={onFrom} onPendingChange={onPending?.('from')} />
      </Field>
      <Field label="עד תאריך" className="a-filter-date" error={errors.to}>
        <DateInput value={to} onChange={onTo} onPendingChange={onPending?.('to')} />
      </Field>
    </>
  )
}

/** The dates that the list is asked for, in words. The bar always shows them: a list with a range that nobody sees looks like missing data. */
function Range({ from, to }) {
  const start = goodDate(from) ? formatDay(from) : ''
  const end = goodDate(to) ? formatDay(to) : ''
  let text = 'כל התאריכים'
  if (start && end) text = <><span className="a-stamp">{start}</span> עד <span className="a-stamp">{end}</span></>
  else if (start) text = <>מ-<span className="a-stamp">{start}</span></>
  else if (end) text = <>עד <span className="a-stamp">{end}</span></>
  return <span className="a-filterbar__range"><span className="w-sr">טווח התאריכים: </span>{text}</span>
}

/**
 * The bar above a list on a phone. `count` is how many filters differ from the defaults (the dates count once); `from` and `to` are the
 * applied dates; `chips` is `[{ key, label, value, onRemove }]`, one for each filter that is on except the dates, and removing one applies
 * at once. Tapping the button opens the sheet (`onOpen`). `ref` is the element that holds it (see `useFilterFocus`).
 */
export function FilterBar({ count, from, to, chips, onOpen, ref }) {
  return (
    <div className="a-filterbar" ref={ref}>
      <div className="a-filterbar__main">
        <button type="button" className="w-btn w-btn--quiet w-btn--small" aria-haspopup="dialog" onClick={onOpen}>
          <IconFilter size={20} />
          <span>סינון</span>
          {count > 0 && <Badge tone="info">{count}</Badge>}
          {count > 0 && <span className="w-sr">פעילים</span>}
        </button>
        <Range from={from} to={to} />
      </div>
      {chips.length > 0 && (
        <div className="a-chips">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="a-chip" onClick={chip.onRemove}
              aria-label={`הסרת סינון: ${chip.label}${chip.value ? `: ${chip.value}` : ''}`}>
              <span>{chip.value ? <>{chip.label}: <bdi>{chip.value}</bdi></> : chip.label}</span>
              <IconX size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const DATE_ERROR = 'התאריך לא תקין. כתבו אותו בצורה DD/MM/YYYY.'
// What closing the sheet by accident asks (F4 of docs/design.md): the filters are shown, not saved, so the words are about the results.
const QUESTION = {
  title: 'לסגור בלי להציג את התוצאות?',
  body: 'בחרתם סינון שעוד לא הוצג. אם תסגרו עכשיו, הרשימה תישאר כמו שהיא והבחירה תאבד.',
  confirmLabel: 'סגירה בלי להציג',
  cancelLabel: 'חזרה לסינון',
}

/**
 * The sheet that holds the controls on a phone: a dialog from the bottom (`Modal`). It works on a draft that starts as the applied
 * filters, and nothing reaches the screen behind it until "show results" (`onApply(draft)`); "reset" puts the defaults in the draft, and
 * the close button leaves the applied filters as they were. `children` is a function of `{ values, set, errors, watch }` that draws the
 * controls, so the sheet and the computer's inline block share one set of controls.
 *
 * A date that is not finished (a half-typed one, or 31/02) is never applied quietly: "show results" keeps the sheet open, says so under the
 * field and moves the focus to it (F2). And since a typed date is the one thing here that costs something to type again, the sheet counts
 * as having unsaved changes (F4) when the draft differs from what is applied or a date is half typed: Esc and a tap outside then ask first.
 * `returnFocus` (see `useFilterFocus`) is where the focus goes when it closes if its opener is gone.
 */
export function FilterSheet({ initial, defaults, onApply, onClose, returnFocus, children }) {
  const formId = useId()
  const formRef = useRef(null)
  const [draft, setDraft] = useState(initial)
  const [pending, setPending] = useState({ from: false, to: false }) // which date fields hold a date that is not finished
  const [shown, setShown] = useState({ from: false, to: false }) // for which of them "show results" has said so
  const [attempt, setAttempt] = useState(0)
  const [round, setRound] = useState(0) // a reset draws the fields again, so that a half-typed date goes too
  const changed = useDirty(draft)

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }))
  const watch = (key) => (value) => setPending((p) => (p[key] === value ? p : { ...p, [key]: value }))
  // The message goes when its date is finished, and comes again only when "show results" is pressed with the date unfinished.
  useEffect(() => {
    setShown((s) => (s.from && !pending.from) || (s.to && !pending.to) ? { from: s.from && pending.from, to: s.to && pending.to } : s)
  }, [pending])
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector('[aria-invalid="true"]')?.focus()
  }, [attempt])

  const submit = (event) => {
    event.preventDefault()
    if (pending.from || pending.to) {
      setShown({ ...pending })
      setAttempt((n) => n + 1)
      return
    }
    onApply(draft)
  }
  const reset = () => {
    setDraft(defaults)
    setPending({ from: false, to: false })
    setShown({ from: false, to: false })
    setRound((n) => n + 1)
  }
  const errors = { from: shown.from && pending.from ? DATE_ERROR : undefined, to: shown.to && pending.to ? DATE_ERROR : undefined }

  return (
    <Modal
      title="סינון" size="sm" initialFocus="dialog" onClose={onClose} question={QUESTION} dirty={changed || pending.from || pending.to} returnFocus={returnFocus}
      footer={(
        <>
          <button type="button" className="w-btn w-btn--quiet w-btn--small" onClick={reset}>איפוס</button>
          <button type="submit" form={formId} className="w-btn w-btn--small">הצגת תוצאות</button>
        </>
      )}>
      <form id={formId} key={round} ref={formRef} className="a-filter-sheet" onSubmit={submit} noValidate>
        {children({ values: draft, set, errors, watch })}
      </form>
    </Modal>
  )
}
