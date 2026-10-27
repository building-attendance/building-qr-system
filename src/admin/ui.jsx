import {
  Fragment, cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { createPortal } from 'react-dom'
import { IconAlert, IconCheck, IconMore, IconPlus, IconX } from './icons.jsx'
import { formatDay, parseDay, editDay } from '../../shared/datetime.js'

const appRoot = () => document.querySelector('.a-app') ?? document.body // portals must stay inside .a-app (design tokens)

/* ---------------------------------------------------------- icon button */

/**
 * An action shown as just its icon: the app's way of offering the secondary actions on a tile and in a page header.
 * `label` is both the accessible name and the tooltip. The icon is grey and turns violet on hover, while pressed and on
 * focus; there is no frame or fill. It has one look: red is only for deleting, which is an item of the "more" menu (`Menu`), and the add
 * button of a heading is a pill with its words (`w-btn w-btn--small`, see `.a-head--add` in admin.css), so no icon button is red or filled.
 * With `href` it is a link (a download), otherwise a button.
 */
export function IconButton({ icon: Icon, label, onClick, size = 24, href, download, disabled, ...rest }) {
  const className = 'a-icon-btn'
  const icon = <Icon size={size} />
  if (href && !disabled) {
    return <a className={className} href={href} download={download} aria-label={label} title={label} {...rest}>{icon}</a>
  }
  return <button type="button" className={className} onClick={onClick} disabled={disabled} aria-label={label} title={label} {...rest}>{icon}</button>
}

/**
 * The add button of a screen heading: a pill with the plus and the words for what it adds, the first action of its heading
 * (`a-head a-head--add` in admin.css). The words are on the button, so what a person reads and what a screen reader says are one thing.
 */
export function AddButton({ label, onClick }) {
  return <button type="button" className="w-btn w-btn--small" onClick={onClick}><IconPlus size={20} />{label}</button>
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
    // Told with the change itself, and not only by the effect above, which runs a render later: a screen that reads it on a key press
    // (Enter in the filters' sheet) must not see the state of the key before.
    onPendingChange?.(next.text !== '' && !parseDay(next.text))
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

const POPOVER_EDGE = 8 // px that a popover keeps from the edges of the screen, as the menu does (MENU_EDGE)
const POPOVER_GAP = 4 // px between the field and its popover, as between a button and its menu (MENU_GAP)
// From this width a dialog is no longer a sheet from the bottom (admin.css, the rules of .a-modal), and a popover stands beside its field.
// The date picker changes at the same width: below it a date field opens the wheels of a phone, from it the calendar (src/admin/DatePicker.jsx).
export const POPOVER_QUERY = '(min-width: 640px)'

/**
 * Puts a popover (`box`, a fixed dialog) beside the element that it belongs to (`anchor`): under it with its start at the start of the
 * anchor, over it when there is no room under it, and always inside the screen, even when that means covering a part of the anchor (a
 * low window). Below 640 px it stands nowhere in particular: it is a sheet from the bottom, as every dialog is there (the CSS of
 * .a-modal--popover is fixed only from 640 px, so the place written here does nothing below it).
 */
function placePopover(box, anchor) {
  if (!anchor || !window.matchMedia?.(POPOVER_QUERY)?.matches) {
    box.style.left = ''
    box.style.top = ''
    return
  }
  const at = anchor.getBoundingClientRect()
  const { width, height } = box.getBoundingClientRect()
  const start = getComputedStyle(anchor).direction === 'rtl' ? at.right - width : at.left
  const below = at.bottom + POPOVER_GAP
  const above = at.top - POPOVER_GAP - height
  const top = below + height <= window.innerHeight - POPOVER_EDGE || above < POPOVER_EDGE ? below : above
  box.style.left = `${Math.max(POPOVER_EDGE, Math.min(start, document.documentElement.clientWidth - POPOVER_EDGE - width))}px`
  box.style.top = `${Math.max(POPOVER_EDGE, Math.min(top, window.innerHeight - POPOVER_EDGE - height))}px`
}

// Open dialogs, oldest first. Only the top one reacts to the keyboard, so Esc on a confirmation that sits on top
// of another dialog closes just the confirmation.
const modalStack = []
let bodyOverflow = '' // what the page's scroll was before the first dialog locked it

// The longest that a dialog waits for a stylesheet before it puts the focus in its first field anyway (Modal, below). A stylesheet that
// failed before the dialog opened looks like one that is loading (it has no `sheet`) and sends no more events, so the wait has a limit.
const STYLESHEET_WAIT_MS = 5000

/** The stylesheets of the page that are still loading: a <link> whose sheet has not arrived. */
const loadingStylesheets = () => [...document.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet)

/** Calls `then` once each of `links` has loaded or failed, or after STYLESHEET_WAIT_MS, whichever comes first. Returns what cancels it. */
function afterStylesheets(links, then) {
  let left = links.length
  const cancel = () => {
    clearTimeout(timer)
    for (const link of links) {
      link.removeEventListener('load', one)
      link.removeEventListener('error', one)
    }
  }
  const finish = () => {
    cancel()
    then()
  }
  const one = () => { if (--left === 0) finish() }
  const timer = setTimeout(finish, STYLESHEET_WAIT_MS)
  for (const link of links) {
    link.addEventListener('load', one)
    link.addEventListener('error', one)
  }
  return cancel
}

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
 * On a phone (below 640 px) every dialog is a sheet that rises from the bottom of the screen, with a handle at its top and the close
 * button in its head (owner decision of 14/10/2026); on a computer it stands in the middle of the screen. `size` is its width there: "sm"
 * or "md" (the default). "sheet" stays at the bottom at every width (the screens under "עוד", and the filters of the History tab and
 * the audit log), at most 480 px wide. A sheet with a footer (the filters) clears the home indicator under the footer, one without under
 * its body. The handle is only drawn (admin.css): the close button and a tap outside close the sheet, a swipe does not.
 *
 * `busy` says that the form's save is on its way: Esc and a tap outside then do nothing at all, and the close button is
 * disabled (a form disables its own Cancel the same way). The save closes the dialog itself when it works, and leaves the
 * form as it was typed when it fails; a dialog that closed meanwhile would lose the answer (the key that is shown only
 * once) or let the change be saved after the person was told it was discarded.
 *
 * `size="popover"` is a dialog that belongs to one field (the date picker, src/admin/DatePicker.jsx): a sheet like every dialog on a
 * phone, and from 640 px a small box beside the element that `anchor()` gives (`placePopover`), with no dimmed page behind it. It is
 * still modal: a click outside it closes it, as a tap outside a sheet does.
 *
 * `question` is the words of that question when "save" is not what the dialog does: `{ title, body, confirmLabel, cancelLabel }`, each
 * part optional (the filters of a long list are shown, not saved). `initialFocus` is where the focus goes when the dialog opens: 'field'
 * (the default) is its first field, 'dialog' is the dialog itself, for a dialog whose first field is a text field that would bring up
 * the keyboard of a phone over it at once, and a function of the dialog's element gives the element itself (the day of the date picker).
 * Tab and Shift+Tab go round the elements of the dialog that are in the tab order (a grid that moves its own focus with the arrows has
 * one there).
 *
 * When it closes, the focus goes back to the element that had it when the dialog opened (the opener). That element can be gone by then (the
 * screen drew another layout meanwhile), or there can have been none (Safari does not focus a button that is tapped, so the page's body
 * had the focus). `returnFocus` is a function that gives the element to focus instead, for a dialog whose screen knows its own opener: it is
 * asked when the opener is gone or there was none, and an opener that is still in the page keeps the focus as it always had. Without it, a
 * dialog whose opener is gone puts the focus on the page's `main` (the shell's own target when a screen changes), but only while nothing else
 * has taken it: two dialogs that close together, one of them opened from the other, must not fight over it.
 */
export function Modal({ title, onClose, dirty = false, busy = false, question, initialFocus = 'field', returnFocus, anchor, children, footer, size = 'md' }) {
  const ref = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
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

  // A popover stands beside its anchor before it is first painted, and again when the window or a box of the page moves under it (a fixed
  // box does not move with the page). The effect below places it once more after it has locked the page's scroll, which can widen the page.
  const placeRef = useRef(null)
  useLayoutEffect(() => {
    if (!anchorRef.current) return undefined
    const place = () => placePopover(ref.current, anchorRef.current?.())
    placeRef.current = place
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // true: the scroll of a box inside the page moves the anchor too
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [])

  useEffect(() => {
    const me = Symbol('modal')
    if (!modalStack.length) bodyOverflow = document.body.style.overflow
    modalStack.push(me)
    const opener = document.activeElement
    document.body.style.overflow = 'hidden'
    placeRef.current?.()
    const el = ref.current
    const items = () => [...el.querySelectorAll(FOCUSABLE)].filter((item) => item.tabIndex >= 0) // what Tab reaches
    // Prefer the first form field over the close button, unless the dialog asks to start on itself or names where to start.
    const first = typeof initialFocus === 'function' ? initialFocus(el) : null
    const target = first ?? (initialFocus === 'dialog' ? el : el.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled])') ?? items()[1] ?? items()[0] ?? el)
    // A field does not take the focus while a stylesheet of the page is still loading: the dialog holds it until the stylesheet has
    // arrived. WebKit gives an element that is put in the page then no box until it arrives, and a field focused without a box tells iOS
    // a font size of 0, so iOS zooms the page in to its limit (5 times) on its top left corner, and the page stays zoomed (the owner's
    // iPhone, 27/10/2026). The map's stylesheet loads that way the first time the point form opens: it comes with the map's own file
    // (src/admin/views/PointsView.jsx). The focus moves to the field afterwards only if it is still where the dialog left it and the
    // dialog is the top one (the person may have tapped a field meanwhile, or opened a confirmation).
    const loading = target.matches('input, select, textarea') ? loadingStylesheets() : []
    let stopWaiting = null
    if (!loading.length) target.focus()
    else {
      el.focus()
      stopWaiting = afterStylesheets(loading, () => {
        const active = document.activeElement
        if (modalStack[modalStack.length - 1] === me && (active === el || !el.contains(active))) target.focus()
      })
    }

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
      stopWaiting?.()
      document.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(me), 1)
      if (!modalStack.length) document.body.style.overflow = bodyOverflow
      if (opener && opener !== document.body && opener.isConnected) opener.focus?.()
      else {
        // The opener is gone, or there was none: the screen's own choice, if it gave one, and else the page's main, but only for an opener that
        // was there and went (not for a dialog opened with nothing focused, which has always left the focus where the browser put it) and
        // only while nothing holds the focus (the dialog's own element is already out of the page, so the browser has put it on the body).
        const next = returnFocusRef.current?.()
        const lost = !document.activeElement || document.activeElement === document.body
        if (next && next.isConnected) next.focus?.()
        else if (opener && opener !== document.body && lost) document.querySelector('main')?.focus?.()
      }
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
        <div className={`a-overlay${size === 'sheet' || size === 'popover' ? ` a-overlay--${size}` : ''}`} onMouseDown={onOverlayMouseDown}>
          <div className={`a-modal a-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} inert={asking}>
            {/* Plain <div>s, not <header> and <footer>: inside a role="dialog" (which is not sectioning content) those two
                become the page's banner and contentinfo landmarks, a second banner next to the top bar of the phone layout. */}
            <div className="a-modal__head">
              <h2 id={titleId}>{title}</h2>
              <IconButton icon={IconX} label="סגירה" onClick={onClose} disabled={busy} size={20} />
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

/* ------------------------------------------------------------ more menu */

const MENU_GAP = 4 // px between the button and its menu
const MENU_EDGE = 8 // px that the menu keeps from the edges of the screen

/**
 * The "more" button of a tile or a row, and the menu of actions that it opens: a tile shows this one button, and every action, edit
 * first, is in this menu (AGENTS.md, "Rules for every change"). It follows the menu button pattern of the WAI-ARIA Authoring Practices
 * (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/).
 *
 * `label` names the button and its menu with the thing they act on ("עוד פעולות ללובי"): a screen reader goes through tiles that look
 * alike, and the name tells them apart. It is the tooltip too. `items` are the actions, each `{ label, icon, onSelect, danger, disabled }`,
 * in the order of the rule (edit, the actions of the screen, then switch off / on); an entry that is false or null is left out, for an action
 * that one tile has and another has not. The action that deletes is marked `danger`: it is red, after a separator and last, wherever it
 * stands in `items`, so that no screen can put it anywhere else. A `disabled` item stays in the menu and takes the focus (a person can
 * still read it), but choosing it does nothing. With no item at all there is no button.
 *
 * The keyboard: Enter, Space or the down arrow on the button opens the menu on its first item, the up arrow on its last. In the menu the
 * up and down arrows go from item to item (past the last to the first, and back), Home and End to the first and the last, Enter and
 * Space choose, Esc closes the menu and gives the focus back to the button (and closes nothing else: not the dialog that the menu may be
 * in), and Tab closes it and goes on from the button. A tap or a click outside closes it as well, and gives the focus back to the button
 * unless what was tapped takes the focus itself. Choosing an item closes the menu and gives the focus back to the button before the
 * action runs, so the dialog that an action opens (a question before deleting) gives the focus back to the button when it closes.
 *
 * The menu is in the page right after its button, not in a portal: inside a dialog (aria-modal) a menu out of the dialog would be out of
 * the reach of a screen reader. Its position is fixed, so a box that clips what it holds (the rounded list of the History) cannot cut
 * it: it stands under the button with its end at the end of the button, over the button when there is no room under it, inside the screen.
 */
export function Menu({ label, items, icon: Icon = IconMore }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const firstRef = useRef(0) // the item that takes the focus when the menu opens: 0 the first, -1 the last
  const buttonId = useId()
  const menuId = useId()
  const listed = items.filter(Boolean)
  const actions = [...listed.filter((item) => !item.danger), ...listed.filter((item) => item.danger)]

  /** Closes the menu; `refocus` gives the focus back to the button. */
  const hide = (refocus) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const show = (first) => {
    firstRef.current = first
    setOpen(true)
  }

  // Where the menu stands, and the item that takes the focus: before the menu is painted. The place is worked out again when the page
  // (or a box in it) scrolls or the window changes its size while the menu is open, because a fixed box does not move with the page.
  useLayoutEffect(() => {
    if (!open) return undefined
    const menu = menuRef.current
    const place = () => {
      const button = buttonRef.current.getBoundingClientRect()
      const { width, height } = menu.getBoundingClientRect()
      const start = getComputedStyle(menu).direction === 'rtl' ? button.left : button.right - width // the end of the menu at the end of the button
      const below = button.bottom + MENU_GAP
      const above = button.top - MENU_GAP - height
      menu.style.left = `${Math.max(MENU_EDGE, Math.min(start, document.documentElement.clientWidth - MENU_EDGE - width))}px`
      menu.style.top = `${below + height <= window.innerHeight - MENU_EDGE || above < MENU_EDGE ? below : above}px`
    }
    place()
    const entries = menu.querySelectorAll('[role="menuitem"]')
    entries[firstRef.current < 0 ? entries.length - 1 : 0].focus()
    // A tap or a click outside the menu and its button closes the menu. On something that takes no focus (text, the page) the focus goes
    // back to the button, and the press is kept from taking it away again: the browser moves the focus to the page on a press there.
    // (mousedown and not pointerdown: a phone sends it for a tap and not for the touch that starts a scroll, and it is the event whose
    // default moves the focus.)
    const outside = (e) => {
      if (menu.contains(e.target) || buttonRef.current.contains(e.target)) return
      setOpen(false)
      if (e.target.closest?.(FOCUSABLE)) return
      e.preventDefault()
      buttonRef.current.focus()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // true: the scroll of a box inside the page moves the button too
    document.addEventListener('mousedown', outside)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', outside)
    }
  }, [open])

  const onButtonKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return // Enter and Space click the button
    e.preventDefault()
    show(e.key === 'ArrowUp' ? -1 : 0)
  }
  const onMenuKey = (e) => {
    const entries = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const at = entries.indexOf(document.activeElement)
    const go = (i) => {
      e.preventDefault() // the arrows, Home and End must not scroll the page
      entries[(i + entries.length) % entries.length].focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // the dialog that the menu may sit in listens for Esc on the document: only the menu closes
      hide(true)
    } else if (e.key === 'Tab') hide(true) // not prevented: the browser moves the focus on from the button
  }
  const choose = (item) => {
    if (item.disabled) return
    hide(true)
    item.onSelect()
  }

  if (!actions.length) return null
  return (
    <>
      <button
        ref={buttonRef} type="button" id={buttonId} className="a-menu-btn" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? hide(true) : show(0))} onKeyDown={onButtonKey}
      >
        <Icon size={22} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="a-menu" role="menu" aria-labelledby={buttonId} onKeyDown={onMenuKey}>
          {actions.map((item, i) => (
            <Fragment key={item.label}>
              {item.danger && i > 0 && !actions[i - 1].danger && <div className="a-menu__sep" role="separator" />}
              <button
                type="button" role="menuitem" tabIndex={-1} className={`a-menu__item${item.danger ? ' a-menu__item--danger' : ''}`}
                aria-disabled={item.disabled || undefined} onClick={() => choose(item)}
              >
                {item.icon && <item.icon size={20} />}
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
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
      <label className="w-label" htmlFor={id} id={`${id}-label`}>{label}</label>
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
