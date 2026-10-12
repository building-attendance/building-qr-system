import {
  cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { createPortal } from 'react-dom'
import { IconAlert, IconCheck, IconX } from './icons.jsx'
import { formatDay, parseDay, editDay } from '../../shared/datetime.js'

const appRoot = () => document.querySelector('.a-app') ?? document.body // portals must stay inside .a-app (design tokens)

/* ---------------------------------------------------------- icon button */

/**
 * An action shown as just its icon: the app's way of offering the secondary actions on a tile and in a page header.
 * `label` is both the accessible name and the tooltip. The icon is grey and turns the palette blue on hover, while
 * pressed and on focus; there is no frame or fill.
 *   tone "default": grey.      tone "danger": red, used only for removing something.
 *   tone "primary": a filled blue round button, the single main action of a page (adding something).
 * With `href` it is a link (a download), otherwise a button.
 */
export function IconButton({ icon: Icon, label, onClick, tone = 'default', size = 24, href, download, disabled, ...rest }) {
  const className = `a-icon-btn${tone === 'default' ? '' : ` a-icon-btn--${tone}`}`
  const icon = <Icon size={size} />
  if (href && !disabled) {
    return <a className={className} href={href} download={download} aria-label={label} title={label} {...rest}>{icon}</a>
  }
  return <button type="button" className={className} onClick={onClick} disabled={disabled} aria-label={label} title={label} {...rest}>{icon}</button>
}

/* ------------------------------------------------------------ date field */

/**
 * A date field that always reads DD/MM/YYYY, whatever the phone's region is (the browser's own date field shows the
 * device's format, and on some phones it is month first). The person types the digits and the slashes come by
 * themselves; deleting a slash deletes the digit before it, and the cursor stays by the digit it was at (editDay).
 *
 * `value` and `onChange` use 'YYYY-MM-DD', what the API takes: onChange is called only with a real date, or with '' when
 * the field is emptied, never with half a date typed digit by digit. While the text is not yet a real date the value
 * stays the last good one, so `onPendingChange(true)` tells the screen that what it shows is not what the field says
 * (the history screen holds its export back until the field is finished).
 */
export function DateInput({ value, onChange, onPendingChange, 'aria-invalid': invalid, ...rest }) {
  const [text, setText] = useState(() => (value ? formatDay(value) : ''))
  const inputRef = useRef(null)
  const caretRef = useRef(null)
  // The value can also change from outside (a reset): then the field follows it.
  useEffect(() => {
    if (parseDay(text) !== (value || null)) setText(value ? formatDay(value) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when `value` changes from outside, never when `text` changes (the person typing)
  }, [value])
  const pending = text !== '' && !parseDay(text)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when `pending` changes; the callers pass a new function on every render, so listing it would loop
  useEffect(() => { onPendingChange?.(pending) }, [pending])
  // After the text is re-written (slashes added or taken away) the cursor goes back by the digit it was at.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (caretRef.current !== null && input && document.activeElement === input) input.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  })
  const change = (event) => {
    const input = event.target
    const next = editDay(text, input.value, input.selectionStart ?? input.value.length)
    caretRef.current = next.caret
    setText(next.text)
    if (next.text === '') onChange('')
    else if (parseDay(next.text)) onChange(parseDay(next.text))
  }
  const unfinished = text.length === 10 && !parseDay(text) // 10 characters, and still not a real date: 31/02/2026
  return (
    <input
      ref={inputRef} className="a-input a-input--date" type="text" inputMode="numeric" autoComplete="off" spellCheck="false"
      placeholder="DD/MM/YYYY" maxLength={10} dir="ltr"
      {...rest} value={text} onChange={change} aria-invalid={invalid || unfinished ? true : undefined}
    />
  )
}

/* ---------------------------------------------------------------- modal */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Open dialogs, oldest first. Only the top one reacts to the keyboard, so Esc on a confirmation that sits on top
// of another dialog closes just the confirmation.
const modalStack = []
let bodyOverflow = '' // what the page's scroll was before the first dialog locked it

// What two values of a field are compared as. The database gives a coordinate as a number and a field gives text once it is typed
// over; a name can be missing there and empty here; a list of choices (ids) is in the order they were chosen in. None of those is a
// change the person made, so each is written in one way before the comparison. A false, a 0 and a space still differ from nothing.
const plain = (_key, value) => {
  if (typeof value === 'number') return String(value)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(String).sort()
  return value
}
const snapshot = (value) => JSON.stringify(value, plain)

/**
 * `useDirty(value)` is true once `value` is no longer what it was on the first render: a form passes the object that it
 * keeps its fields in, and the dialog it sits in (`<Modal dirty>`) then asks before Esc or a tap outside closes it (F4).
 * Compared by what the person would call the same (see `plain`), so changing a field and putting it back is not "unsaved".
 */
export function useDirty(value) {
  const [first] = useState(() => snapshot(value))
  return snapshot(value) !== first
}

/**
 * Accessible dialog: focus moves in and is trapped, Esc / backdrop close it, focus returns, page scroll locks.
 *
 * `dirty` says that the person has typed or changed something that is not saved yet (design rule F4). Then Esc and a tap
 * outside the dialog, the two ways to close it by accident, ask first and close it only when the answer is "close without
 * saving"; the question puts the person back in the form otherwise, with everything as it was. The close button and the
 * dialog's own Cancel button are chosen on purpose, so they call `onClose` at once.
 *
 * `size` is the width of the dialog on a computer: "sm", "md" (the default) or "lg". "sheet" is a list of choices with no form (the screens
 * under "עוד" on a phone): it stays at the bottom of the screen at every width and is as wide as the list needs.
 *
 * `busy` says that the form's save is on its way: Esc and a tap outside then do nothing at all, and the close button is
 * disabled (a form disables its own Cancel the same way). The save closes the dialog itself when it works, and leaves the
 * form as it was typed when it fails; a dialog that closed meanwhile would lose the answer (the key that is shown only
 * once) or let the change be saved after the person was told it was discarded.
 *
 * `question` is the words of that question when "save" is not what the dialog does: `{ title, body, confirmLabel, cancelLabel }`, each
 * part optional (the filters of a long list are shown, not saved). `initialFocus` is where the focus goes when the dialog opens: 'field'
 * (the default) is its first field, 'dialog' is the dialog itself, for a dialog whose first field is a text field that would bring up
 * the keyboard of a phone over it at once.
 */
export function Modal({ title, onClose, dirty = false, busy = false, question, initialFocus = 'field', children, footer, size = 'md' }) {
  const ref = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const busyRef = useRef(busy)
  busyRef.current = busy
  const [asking, setAsking] = useState(false)
  // Esc and a tap outside. (Read through a ref: the key listener below is added once.)
  const dismissRef = useRef(null)
  dismissRef.current = () => {
    if (busyRef.current) return
    if (dirtyRef.current) setAsking(true)
    else closeRef.current()
  }

  useEffect(() => {
    const me = Symbol('modal')
    if (!modalStack.length) bodyOverflow = document.body.style.overflow
    modalStack.push(me)
    const opener = document.activeElement
    document.body.style.overflow = 'hidden'
    const el = ref.current
    const items = () => [...el.querySelectorAll(FOCUSABLE)]
    // Prefer the first form field over the close button, unless the dialog asks to start on itself.
    ;(initialFocus === 'dialog' ? el : el.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled])') ?? items()[1] ?? items()[0] ?? el).focus()

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== me) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismissRef.current()
      } else if (e.key === 'Tab') {
        const list = items()
        if (!list.length) return e.preventDefault()
        const first = list[0]
        const last = list[list.length - 1]
        const active = document.activeElement
        // Focus can sit on the dialog itself (after a click on plain text) or, in principle, outside it.
        if (!el.contains(active) || active === el) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        } else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(me), 1)
      if (!modalStack.length) document.body.style.overflow = bodyOverflow
      opener?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the dialog opens: `initialFocus` is read then and never changes
  }, [])

  const onOverlayMouseDown = (e) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault() // a tap outside must not take the focus out of the field that the person was typing in
    dismissRef.current()
  }

  return (
    <>
      {createPortal(
        <div className={`a-overlay${size === 'sheet' ? ' a-overlay--sheet' : ''}`} onMouseDown={onOverlayMouseDown}>
          <div className={`a-modal a-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} inert={asking}>
            {/* Plain <div>s, not <header> and <footer>: inside a role="dialog" (which is not sectioning content) those two
                become the page's banner and contentinfo landmarks, a second banner next to the top bar of the phone layout. */}
            <div className="a-modal__head">
              <h2 id={titleId}>{title}</h2>
              <IconButton icon={IconX} label="סגירה" onClick={onClose} disabled={busy} />
            </div>
            <div className="a-modal__body">{children}</div>
            {footer && <div className="a-modal__foot">{footer}</div>}
          </div>
        </div>,
        appRoot(),
      )}
      {asking && (
        <ConfirmDialog
          title={question?.title ?? 'לסגור בלי לשמור?'}
          body={question?.body ?? 'מה שהקלדתם עדיין לא נשמר. אם תסגרו עכשיו, הוא יאבד.'}
          confirmLabel={question?.confirmLabel ?? 'סגירה בלי לשמור'}
          cancelLabel={question?.cancelLabel ?? 'חזרה לעריכה'}
          danger
          onAnswer={(discard) => { setAsking(false); if (discard) closeRef.current() }}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- toast */

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setItems((list) => [...list, { id, text, tone }])
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), tone === 'error' ? 9000 : 4500)
  }, [])
  const value = useMemo(() => ({ ok: (t) => push(t, 'ok'), error: (t) => push(t, 'error') }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="a-toasts">
        {items.map((i) => (
          <div key={i.id} className={`a-toast a-toast--${i.tone}`} role={i.tone === 'error' ? 'alert' : 'status'}>
            {i.tone === 'error' ? <IconAlert size={20} /> : <IconCheck size={20} />}
            <span>{i.text}</span>
            <button type="button" onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))} aria-label="סגירת ההודעה"><IconX size={18} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)

/* -------------------------------------------------------------- confirm */

const ConfirmContext = createContext(null)

/**
 * A question with two answers, drawn on top of whatever is open. Closing it any other way (Esc, a tap outside, the close
 * button) is the cancel answer, so the safe choice is the one that needs no decision. `onAnswer(true | false)`.
 */
function ConfirmDialog({ title, body, confirmLabel = 'אישור', cancelLabel = 'ביטול', danger, onAnswer }) {
  return (
    <Modal
      size="sm"
      title={title}
      onClose={() => onAnswer(false)}
      footer={(
        <>
          <button className="w-btn w-btn--quiet w-btn--small" onClick={() => onAnswer(false)}>{cancelLabel}</button>
          <button className={`w-btn w-btn--small${danger ? ' w-btn--danger' : ''}`} onClick={() => onAnswer(true)}>{confirmLabel}</button>
        </>
      )}
    >
      <p className="w-lead">{body}</p>
    </Modal>
  )
}

/** `await confirm({ title, body, confirmLabel, cancelLabel, danger })` → true / false. Replaces window.confirm. */
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const confirm = useCallback((opts) => new Promise((resolve) => {
    // A second question while one is open answers the first with "no" instead of leaving it hanging forever.
    setDialog((prev) => {
      prev?.resolve(false)
      return { ...opts, resolve }
    })
  }), [])
  const close = (result) => {
    dialog.resolve(result)
    setDialog(null)
  }
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <ConfirmDialog
          title={dialog.title} body={dialog.body} confirmLabel={dialog.confirmLabel} cancelLabel={dialog.cancelLabel}
          danger={dialog.danger} onAnswer={close}
        />
      )}
    </ConfirmContext.Provider>
  )
}
export const useConfirm = () => useContext(ConfirmContext)

/* ---------------------------------------------------------- small parts */

export function Field({ label, hint, error, className, children }) {
  const id = useId()
  return (
    <div className={className ? `w-field ${className}` : 'w-field'}>
      <label className="w-label" htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined,
      })}
      {hint && <p className="w-small" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="w-error" id={`${id}-err`} role="alert"><IconAlert size={18} />{error}</p>}
    </div>
  )
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`a-badge a-badge--${tone}`}>{children}</span>

export function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`w-switch${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="w-switch__text">
        <span>{label}</span>
        {hint && <span className="w-small">{hint}</span>}
      </span>
    </label>
  )
}

/** An empty list, or a list that could not load. It stands where the cards of a screen would, directly under the page's
 * <h1>, so its title is an <h2>, like the title of a card. */
export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="a-empty">
      {Icon && <span className="a-empty__icon"><Icon size={30} /></span>}
      <h2 className="a-empty__title">{title}</h2>
      {children && <p className="w-lead">{children}</p>}
      {action}
    </div>
  )
}

export const Spinner = ({ label = 'טוען…' }) => (
  <div className="a-loading" role="status"><span className="w-spinner" aria-hidden="true" /><span className="w-sr">{label}</span></div>
)

/** Runs an async action with a busy flag and toast feedback, so every button behaves the same way. */
export function useAction(toast, errorText) {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn, okMessage) => {
    setBusy(true)
    try {
      const result = await fn()
      if (okMessage) toast.ok(okMessage)
      return result
    } catch (err) {
      toast.error(errorText(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [toast, errorText])
  return [busy, run]
}
