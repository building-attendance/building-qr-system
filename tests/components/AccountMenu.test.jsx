// @vitest-environment jsdom
// The account button of the committee app and the popover it opens (src/admin/AccountMenu.jsx). The popover is a non-modal dialog that
// holds the member's name and e-mail, the light / dark choice (a radio group), the link to the provider app and the sign-out. These are
// the parts that the component itself decides: its roles and states, the keys, where the focus goes, a click outside, the choice of the
// mode. Where it is drawn on the screen and the colours in both themes are checked in a real browser (e2e/admin.spec.js, e2e/a11y.spec.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup, act } from '@testing-library/react'
import AccountMenu from '../../src/admin/AccountMenu.jsx'
import { THEME_KEY, setTheme } from '../../src/ui/theme.js'

const ADMIN = { name: 'Dana Cohen', email: 'dana@example.test' }

// The theme store lives at module level (one per page), so each test starts from "follow the device"
beforeEach(() => act(() => setTheme('system')))
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

const show = (props = {}) => {
  const onSignOut = vi.fn()
  const view = render(<AccountMenu admin={ADMIN} onSignOut={onSignOut} where="top" {...props} />)
  return { onSignOut, ...view }
}
const button = () => screen.getByRole('button', { name: /החשבון שלי והגדרות/ })
const popover = () => screen.getByRole('dialog', { name: 'החשבון שלי' })
const noPopover = () => expect(screen.queryByRole('dialog')).toBeNull()
const radio = (name) => within(popover()).getByRole('radio', { name })
const key = (target, name) => fireEvent.keyDown(target, { key: name })

describe('the button', () => {
  it('on the top bar is the initial of the member, named "החשבון שלי והגדרות", and says that it opens a dialog', () => {
    show()
    expect(button().textContent).toBe('D')
    expect(button().getAttribute('aria-label')).toBe('החשבון שלי והגדרות')
    expect(button().getAttribute('title')).toBe('החשבון שלי והגדרות')
    expect(button().getAttribute('type')).toBe('button')
    expect(button().getAttribute('aria-haspopup')).toBe('dialog')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(button().hasAttribute('aria-controls')).toBe(false)
    noPopover()
  })

  it('in the side rail shows the name and the e-mail, and its name starts with the same words (the name contains what is drawn)', () => {
    show({ where: 'rail' })
    expect(button().textContent).toContain('Dana Cohen')
    expect(button().textContent).toContain('dana@example.test')
    expect(screen.getByRole('button', { name: /^החשבון שלי והגדרות:.*Dana Cohen.*dana@example\.test$/ })).toBe(button())
    expect(button().querySelector('[dir="ltr"]')?.textContent).toBe('dana@example.test') // the e-mail keeps its order inside the right-to-left page
  })

  it('takes the first letter of the name, or of the e-mail when there is no name, and says "חבר ועד" for a member with neither name', () => {
    const { unmount } = show({ admin: { name: '', email: 'zoe@example.test' } })
    expect(button().textContent).toBe('Z')
    unmount()
    show({ admin: { name: 'דנה כהן', email: 'dana@example.test' } })
    expect(button().textContent).toBe('ד')
    cleanup()
    show({ admin: { name: '', email: 'x@example.test' }, where: 'rail' })
    expect(button().textContent).toContain('חבר ועד')
  })

  it('opens the popover, which is a dialog that is not modal, and says which one it controls', () => {
    show()
    fireEvent.click(button())
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(button().getAttribute('aria-controls')).toBe(popover().id)
    expect(popover().hasAttribute('aria-modal')).toBe(false) // the page behind it stays reachable
    fireEvent.click(button()) // the same button closes it
    noPopover()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the popover', () => {
  it('holds the name and the e-mail, the light / dark choice, the link to the provider app and the sign-out, in this order', () => {
    show()
    fireEvent.click(button())
    const pop = popover()
    expect(pop.textContent).toContain('Dana Cohen')
    expect(pop.textContent).toContain('dana@example.test')
    const group = within(pop).getByRole('group', { name: 'מצב תצוגה' })
    expect(within(group).getAllByRole('radio').map((r) => r.parentElement.textContent)).toEqual(['בהיר', 'כהה', 'לפי המכשיר'])
    const link = within(pop).getByRole('link', { name: 'אפליקציית נותני השירות' })
    expect(link.getAttribute('href')).toBe('/')
    const signOut = within(pop).getByRole('button', { name: 'יציאה' })
    const order = [group, link, signOut].map((el) => [...pop.querySelectorAll('*')].indexOf(el))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('moves the focus to the chosen mode when it opens, and gives the focus back to the button when it closes with Esc', () => {
    show()
    fireEvent.click(button())
    expect(document.activeElement).toBe(radio('לפי המכשיר')) // "system" is the mode at the start
    key(document.activeElement, 'Escape')
    noPopover()
    expect(document.activeElement).toBe(button())
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes with Esc from the button too, and only the popover closes (a dialog around it does not hear it)', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><AccountMenu admin={ADMIN} onSignOut={() => {}} where="top" /></div>)
    fireEvent.click(button())
    button().focus()
    key(button(), 'Escape')
    noPopover()
    expect(outer).not.toHaveBeenCalled()
    key(button(), 'Escape') // with nothing open it is not the popover's key
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('closes on a press outside it, and gives the focus back to the button when that press lands on something that takes no focus', () => {
    render(<div><p data-testid="text">some text</p><button type="button">another button</button><AccountMenu admin={ADMIN} onSignOut={() => {}} where="top" /></div>)
    fireEvent.click(button())
    fireEvent.mouseDown(popover()) // a press inside does not close it
    expect(popover()).toBeTruthy()
    fireEvent.mouseDown(screen.getByTestId('text'))
    noPopover()
    expect(document.activeElement).toBe(button())

    fireEvent.click(button())
    fireEvent.mouseDown(screen.getByRole('button', { name: 'another button' })) // something that takes the focus keeps it
    noPopover()
    expect(document.activeElement).not.toBe(button())
  })

  it('closes when the focus leaves it for something else (Tab past the sign-out), and not when it goes to its own button', () => {
    render(<div><AccountMenu admin={ADMIN} onSignOut={() => {}} where="top" /><button type="button">after</button></div>)
    fireEvent.click(button())
    fireEvent.blur(radio('כהה'), { relatedTarget: button() })
    expect(popover()).toBeTruthy()
    fireEvent.blur(within(popover()).getByRole('button', { name: 'יציאה' }), { relatedTarget: screen.getByRole('button', { name: 'after' }) })
    noPopover()
  })

  it('closes when the window changes its size (a layout that hides its button must not leave it standing)', () => {
    show()
    fireEvent.click(button())
    act(() => { window.dispatchEvent(new Event('resize')) })
    noPopover()
  })

  it('signs out: it closes, the focus is on the button and the sign-out is asked for once', () => {
    const { onSignOut } = show()
    fireEvent.click(button())
    fireEvent.click(within(popover()).getByRole('button', { name: 'יציאה' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    noPopover()
    expect(document.activeElement).toBe(button()) // when the sign-out fails the person is back where they were
  })

  it('says only the member of its own instance: the rail and the top bar each have one button, and one open popover at a time', () => {
    render(<><AccountMenu admin={ADMIN} onSignOut={() => {}} where="rail" /><AccountMenu admin={ADMIN} onSignOut={() => {}} where="top" /></>)
    const [rail, top] = screen.getAllByRole('button', { name: /החשבון שלי והגדרות/ })
    fireEvent.click(rail)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.mouseDown(top) // a press on the other button is a press outside this popover
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(top)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('the light / dark choice', () => {
  it('is a radio group with the mode that is in force checked, and the modes in the order of the design: light, dark, like the device', () => {
    show()
    fireEvent.click(button())
    expect(radio('לפי המכשיר').checked).toBe(true)
    expect(radio('בהיר').checked).toBe(false)
    expect(radio('כהה').checked).toBe(false)
    const names = new Set(within(popover()).getAllByRole('radio').map((r) => r.getAttribute('name')))
    expect(names.size).toBe(1) // one group: the arrow keys of the browser move through the three
  })

  it('applies a choice to the page at once, remembers it, and keeps the popover open (the page changes behind it)', () => {
    show()
    fireEvent.click(button())
    fireEvent.click(radio('כהה'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(radio('כהה').checked).toBe(true)
    fireEvent.click(radio('בהיר'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light')
    expect(popover()).toBeTruthy()
  })

  it('opens with the mode that was saved before, and puts the focus on it', () => {
    act(() => setTheme('light'))
    show()
    fireEvent.click(button())
    expect(radio('בהיר').checked).toBe(true)
    expect(document.activeElement).toBe(radio('בהיר'))
  })
})
