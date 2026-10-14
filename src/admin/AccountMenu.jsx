import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTheme } from '../ui/theme.js'
import { HEBREW_THEME_LABELS as THEME_LABELS } from '../ui/ThemeSwitch.jsx'
import { IconChevron, IconDevice, IconLogout } from './icons.jsx'
import MemberFace from './MemberFace.jsx'

const THEME_ORDER = ['light', 'dark', 'system'] // the order of the design canvas; the choice "system" follows the device
const GAP = 4 // px between the button and its popover
const EDGE = 8 // px that the popover keeps from the edges of the screen

/**
 * The account of the signed-in member: one button (the member's initial in the top bar of a phone, the name and the e-mail at the foot of
 * the side rail on a computer) and what it opens. The popover holds the member's name and e-mail, the light / dark choice, the link to the
 * provider app and the sign-out: what the three icons of the old top bar did.
 *
 * The pattern is a non-modal dialog opened by a button (aria-haspopup="dialog"), not a menu. A menu (the `Menu` of ui.jsx, which follows
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) holds a list of actions and nothing else, moves between its items with the up and
 * down arrows, and a row of three choices is a radio group, not three items to go down through. The native radios give the group its
 * name, its arrow keys and its one tab stop for free, and the dialog can hold the name, the link and the button beside them.
 *
 * The keyboard: Enter or Space opens it and the focus goes to the chosen mode; Tab goes on through the link and the sign-out and then
 * out of the popover, which closes it; Esc closes it and gives the focus back to the button (also from the button itself); the arrows
 * choose a mode, and the choice applies at once (setTheme saves it on this device). A tap or a click outside closes it.
 *
 * The popover is in the page right after its button (so Tab reaches it in order) and its position is fixed, worked out when it opens:
 * under the button when there is room, over it when not (the rail's button is at the bottom of the screen). `where` is "top" (the end of
 * the popover at the end of the button) or "rail" (its start at the start of the button).
 *
 * The member's circle (the top bar's button, and the circles of the rail's button and of the popover's head) holds the member's Google
 * photo when the server gives one, else the initial (MemberFace).
 *
 * @param {{ admin: { name?: string, email?: string, picture_url?: string | null }, onSignOut: () => void, where: 'top' | 'rail' }} props
 */
export default function AccountMenu({ admin, onSignOut, where }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const popRef = useRef(null)
  const popId = useId()
  const groupName = useId()
  const { theme, setTheme } = useTheme()
  const rail = where === 'rail'
  const name = admin.name || 'חבר ועד'

  /** Closes the popover; `refocus` gives the focus back to the button. */
  const hide = (refocus) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  // Where the popover stands, and the choice that takes the focus: before it is painted. A change of the window's size closes it: both layouts
  // are in the page and CSS hides one, so a window that crosses 1024 px would leave it with a button that is not drawn.
  useLayoutEffect(() => {
    if (!open) return undefined
    const pop = popRef.current
    const button = buttonRef.current
    const b = button.getBoundingClientRect()
    const { width, height } = pop.getBoundingClientRect()
    const rtl = getComputedStyle(pop).direction === 'rtl'
    const left = rail !== rtl ? b.left : b.right - width // rail: start edges together; top: end edges together
    const below = b.bottom + GAP
    const above = b.top - GAP - height
    pop.style.left = `${Math.max(EDGE, Math.min(left, document.documentElement.clientWidth - EDGE - width))}px`
    pop.style.top = `${below + height <= window.innerHeight - EDGE || above < EDGE ? below : above}px`
    pop.querySelector('input:checked').focus()
    // A press outside the popover and its button closes it. On something that takes no focus the focus goes back to the button, and the
    // press is kept from taking it away again (the browser moves the focus to the page on a press there).
    const outside = (e) => {
      if (pop.contains(e.target) || button.contains(e.target)) return
      setOpen(false)
      if (e.target.closest?.('a[href],button,input,select,textarea,[tabindex]')) return
      e.preventDefault()
      button.focus()
    }
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    document.addEventListener('mousedown', outside)
    return () => {
      window.removeEventListener('resize', close)
      document.removeEventListener('mousedown', outside)
    }
  }, [open, rail])

  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation() // only the popover closes, not a dialog that it may be in
    hide(true)
  }
  // The focus left the popover for something other than its button (Tab past the last control): it closes and lets the focus stay there.
  const onBlur = (e) => {
    const to = e.relatedTarget
    if (to && !popRef.current.contains(to) && to !== buttonRef.current) setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef} type="button" className={rail ? 'a-account-btn' : 'a-avatar a-avatar--btn'} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? popId : undefined} aria-label={rail ? undefined : 'החשבון שלי והגדרות'} title={rail ? undefined : 'החשבון שלי והגדרות'}
        onClick={() => (open ? hide(true) : setOpen(true))} onKeyDown={onKeyDown}
      >
        {rail ? (
          <>
            <span className="a-avatar" aria-hidden="true"><MemberFace member={admin} /></span>
            <span className="a-who">
              <span className="w-sr">החשבון שלי והגדרות: </span>
              <strong>{name}</strong>
              <span className="a-who__mail" dir="ltr" title={admin.email}>{admin.email}</span>
            </span>
            <IconChevron size={18} />
          </>
        ) : <MemberFace member={admin} />}
      </button>
      {open && (
        <div ref={popRef} id={popId} className="a-menu a-account" role="dialog" aria-label="החשבון שלי" tabIndex={-1} onKeyDown={onKeyDown} onBlur={onBlur}>
          <div className="a-account__who">
            <span className="a-avatar" aria-hidden="true"><MemberFace member={admin} /></span>
            <div className="a-who"><strong>{name}</strong><span dir="ltr">{admin.email}</span></div>
          </div>
          <fieldset className="a-account__theme">
            <legend>{THEME_LABELS.label}</legend>
            <div className="a-seg">
              {THEME_ORDER.map((value) => (
                <label key={value}>
                  <input type="radio" name={groupName} value={value} checked={theme === value} onChange={() => setTheme(value)} />
                  <span>{THEME_LABELS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <a className="a-menu__item" href="/"><IconDevice size={20} /><span>אפליקציית נותני השירות</span></a>
          <button type="button" className="a-menu__item" onClick={() => { hide(true); onSignOut() }}><IconLogout size={20} /><span>יציאה</span></button>
        </div>
      )}
    </>
  )
}
