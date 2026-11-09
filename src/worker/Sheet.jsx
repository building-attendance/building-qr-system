import { useEffect, useId, useRef } from 'react'
import { IconX } from './icons.jsx'

/** What Tab can reach inside the sheet. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog of the provider app: on a phone a sheet that rises from the bottom of the screen, on a computer a box in the middle, as the
 * committee app's dialogs are (Modal in src/admin/ui.jsx, D7 of the redesign). Only what a sheet of text needs: the close button
 * (`closeLabel`, in the person's language), Esc and a tap outside close it, Tab stays inside it, the page under it does not scroll,
 * and the focus goes to the sheet when it opens (a screen reader reads its title) and back to what opened it when it closes.
 *
 * `opener` is a function that gives the button that opened the sheet, and the focus goes back to it. Safari does not focus a button
 * that is tapped or clicked (WebKit makes a button focusable by the mouse only in its Linux builds, which is why CI's WebKit does not
 * show it), so on an iPhone the page's body had the focus when the sheet opened. Without `opener`, or when it gives nothing, the focus
 * goes back to the element that had it when the sheet opened.
 *
 * It is drawn inside the app's root, not in a portal: the colours are tokens of `.w-app` (src/ui/ui.css), and a fixed box needs no
 * other parent.
 */
export function Sheet({ title, closeLabel, onClose, opener, children }) {
  const ref = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const openerRef = useRef(opener)
  openerRef.current = opener

  useEffect(() => {
    const el = ref.current
    const focused = /** @type {HTMLElement | null} */ (document.activeElement)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const list = [...el.querySelectorAll(FOCUSABLE)]
        if (!list.length) return e.preventDefault()
        const first = list[0]
        const last = list[list.length - 1]
        const active = document.activeElement
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
      document.body.style.overflow = overflow
      const back = openerRef.current?.() ?? focused
      if (back && back !== document.body && back.isConnected) back.focus()
    }
  }, [])

  const onOverlayMouseDown = (e) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault() // the tap must not move the focus before the sheet gives it back to its opener
    closeRef.current()
  }

  return (
    <div className="w-overlay" onMouseDown={onOverlayMouseDown}>
      <div className="w-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="w-sheet__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="w-sheet__close" onClick={onClose} aria-label={closeLabel}>
            <IconX size={20} />
          </button>
        </div>
        <div className="w-sheet__body">{children}</div>
      </div>
    </div>
  )
}
