// @vitest-environment jsdom
// The "more" menu of a tile (Menu in src/admin/ui.jsx): a tile shows this one button, and every action is in this menu, edit first and the
// red delete last after a separator (AGENTS.md, "Rules for every change"). These are the parts of the menu button pattern of the WAI-ARIA
// Authoring Practices that the component itself decides: its roles and states, the keys, where the focus goes, a click outside, and the
// order of the items. What a real browser decides (Enter and Space on a button, the Tab that goes on from the button, where the menu is
// placed on the screen, the colours in both themes) is checked in e2e/components.spec.js and e2e/a11y.spec.js.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import { Menu, Modal } from '../../src/admin/ui.jsx'
import { IconBan, IconPrinter, IconTrash } from '../../src/admin/icons.jsx'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const LABEL = 'עוד פעולות ללובי'

/** The three actions of a point, in the order of the rule. `on` collects the names of the chosen ones. */
function pointItems(on = vi.fn()) {
  return [
    { label: 'הדפסת שלט QR', icon: IconPrinter, onSelect: () => on('print') },
    { label: 'השבתת הנקודה', icon: IconBan, onSelect: () => on('off') },
    { label: 'מחיקת הנקודה', icon: IconTrash, onSelect: () => on('delete'), danger: true },
  ]
}

const trigger = () => screen.getByRole('button', { name: LABEL })
const menu = () => screen.getByRole('menu', { name: LABEL })
const noMenu = () => expect(screen.queryByRole('menu')).toBeNull()
const items = () => within(menu()).getAllByRole('menuitem')
const names = () => items().map((item) => item.textContent)
const focused = () => document.activeElement
const key = (target, name, options = {}) => fireEvent.keyDown(target, { key: name, ...options }) // false when the default was prevented

function open() {
  fireEvent.click(trigger())
  return menu()
}

describe('the button', () => {
  it('is named by its label, which is its tooltip too, says that it opens a menu, and is closed', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    const button = trigger()
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('title')).toBe(LABEL)
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
    expect(button.textContent).toBe('') // nothing but the three dots
    expect(button.querySelector('svg')).not.toBeNull()
    noMenu()
  })

  it('opens the menu on a click, says so, points at it, and puts the focus on its first item', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    const list = open()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(list.id)
    expect(list.getAttribute('aria-labelledby')).toBe(trigger().id) // the menu is named by its button
    expect(focused()).toBe(items()[0])
    for (const item of items()) expect(item.getAttribute('tabindex')).toBe('-1') // the arrows move between them, not Tab
  })

  it('closes the menu on a second click, and keeps the focus', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    fireEvent.mouseDown(trigger()) // the press itself is not "outside": the click decides
    fireEvent.click(trigger())
    noMenu()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(focused()).toBe(trigger())
  })

  it('opens on its first item with the down arrow, and on its last with the up arrow, without scrolling the page', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    expect(key(trigger(), 'ArrowDown')).toBe(false)
    expect(focused()).toBe(items()[0])
    key(focused(), 'Escape')
    noMenu()
    expect(key(trigger(), 'ArrowUp')).toBe(false)
    expect(focused()).toBe(items()[2])
  })

  it('leaves the other keys to the browser (Enter and Space click it)', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    expect(key(trigger(), 'Enter')).toBe(true)
    expect(key(trigger(), ' ')).toBe(true)
    expect(key(trigger(), 'a')).toBe(true)
    noMenu()
  })
})

describe('the items', () => {
  it('are the actions in the order given, with the delete last, after a separator, in red', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    expect(names()).toEqual(['הדפסת שלט QR', 'השבתת הנקודה', 'מחיקת הנקודה'])
    const separators = within(menu()).getAllByRole('separator')
    expect(separators).toHaveLength(1)
    expect(separators[0].previousElementSibling).toBe(items()[1])
    expect(separators[0].nextElementSibling).toBe(items()[2])
    expect(items()[2].className).toBe('a-menu__item a-menu__item--danger')
    expect(items()[0].className).toBe('a-menu__item')
    expect(items()[1].className).toBe('a-menu__item')
  })

  it('keep the delete last whatever its place in the list, so that no screen can break the order', () => {
    const [print, off, remove] = pointItems()
    render(<Menu label={LABEL} items={[remove, print, off]} />)
    open()
    expect(names()).toEqual(['הדפסת שלט QR', 'השבתת הנקודה', 'מחיקת הנקודה'])
    expect(within(menu()).getAllByRole('separator')).toHaveLength(1)
  })

  it('have no separator when nothing deletes, or when deleting is all there is', () => {
    const [print, off, remove] = pointItems()
    const { unmount } = render(<Menu label={LABEL} items={[print, off]} />)
    open()
    expect(within(menu()).queryByRole('separator')).toBeNull()
    unmount()
    render(<Menu label={LABEL} items={[remove]} />)
    open()
    expect(names()).toEqual(['מחיקת הנקודה'])
    expect(within(menu()).queryByRole('separator')).toBeNull()
  })

  it('leave out an entry that is false or null (an action that this tile has not), and with none at all there is no button', () => {
    const [print, off] = pointItems()
    const { unmount } = render(<Menu label={LABEL} items={[false, print, null, off, undefined]} />)
    open()
    expect(names()).toEqual(['הדפסת שלט QR', 'השבתת הנקודה'])
    unmount()
    render(<Menu label={LABEL} items={[false, null]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('show their icon beside their words, and only the words name them', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    for (const item of items()) expect(item.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
    expect(within(menu()).getByRole('menuitem', { name: 'השבתת הנקודה' })).toBe(items()[1])
  })
})

describe('the keys in the menu', () => {
  it('the arrows go from item to item, past the last to the first and back, and do not scroll the page', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    const [first, second, third] = items()
    expect(key(focused(), 'ArrowDown')).toBe(false)
    expect(focused()).toBe(second)
    key(focused(), 'ArrowDown')
    expect(focused()).toBe(third)
    key(focused(), 'ArrowDown')
    expect(focused()).toBe(first)
    expect(key(focused(), 'ArrowUp')).toBe(false)
    expect(focused()).toBe(third)
    key(focused(), 'ArrowUp')
    expect(focused()).toBe(second)
  })

  it('Home and End go to the first and the last item', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    expect(key(focused(), 'End')).toBe(false)
    expect(focused()).toBe(items()[2])
    expect(key(focused(), 'Home')).toBe(false)
    expect(focused()).toBe(items()[0])
  })

  it('Esc closes the menu and gives the focus back to the button', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    key(focused(), 'ArrowDown')
    expect(key(focused(), 'Escape')).toBe(false)
    noMenu()
    expect(focused()).toBe(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('Tab closes the menu and leaves the key to the browser, from the button: the focus goes on to what comes after it', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    expect(key(focused(), 'Tab')).toBe(true)
    noMenu()
    expect(focused()).toBe(trigger())
    open()
    expect(key(focused(), 'Tab', { shiftKey: true })).toBe(true)
    noMenu()
    expect(focused()).toBe(trigger())
  })

  it('another key does nothing', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    expect(key(focused(), 'x')).toBe(true)
    expect(focused()).toBe(items()[0])
    expect(menu()).toBeTruthy()
  })
})

describe('choosing an item', () => {
  it('runs its action once, closes the menu, and gives the focus back to the button before the action runs', () => {
    const seen = []
    const on = vi.fn((what) => seen.push([what, document.activeElement]))
    render(<Menu label={LABEL} items={pointItems(on)} />)
    open()
    fireEvent.click(items()[1])
    expect(on).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([['off', trigger()]]) // so a dialog that the action opens takes the button as the place to return to
    noMenu()
    expect(focused()).toBe(trigger())
  })

  it('a disabled item can be read and reached, but choosing it does nothing and the menu stays open', () => {
    const on = vi.fn()
    const [print, off, remove] = pointItems(on)
    render(<Menu label={LABEL} items={[print, { ...off, disabled: true }, remove]} />)
    open()
    const disabled = items()[1]
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
    expect(items()[0].hasAttribute('aria-disabled')).toBe(false)
    key(focused(), 'ArrowDown')
    expect(focused()).toBe(disabled)
    fireEvent.click(disabled)
    expect(on).not.toHaveBeenCalled()
    expect(menu()).toBeTruthy()
  })
})

describe('a tap or a click outside', () => {
  it('closes the menu, and gives the focus back to the button when what was tapped does not take it', () => {
    render(<><p>טקסט של הדף</p><Menu label={LABEL} items={pointItems()} /></>)
    open()
    // false: the press is kept from moving the focus to the page, which a browser does on a press on something that takes no focus
    expect(fireEvent.mouseDown(screen.getByText('טקסט של הדף'))).toBe(false)
    noMenu()
    expect(focused()).toBe(trigger())
  })

  it('closes the menu, and leaves the focus to a control that was tapped', () => {
    render(<><button type="button">אחר</button><Menu label={LABEL} items={pointItems()} /></>)
    open()
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'אחר' }))).toBe(true) // the press goes on: the control takes the focus
    noMenu()
    expect(focused()).not.toBe(trigger())
  })

  it('a press inside the menu does not close it', () => {
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    fireEvent.mouseDown(items()[2])
    expect(menu()).toBeTruthy()
  })

  it('stops listening once the menu is closed', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    render(<Menu label={LABEL} items={pointItems()} />)
    open()
    key(focused(), 'Escape')
    const added = add.mock.calls.filter(([type]) => type === 'mousedown').map(([, fn]) => fn)
    const removed = remove.mock.calls.filter(([type]) => type === 'mousedown').map(([, fn]) => fn)
    expect(added).toHaveLength(1)
    expect(removed).toEqual(added)
    add.mockRestore()
    remove.mockRestore()
  })
})

describe('a menu inside a dialog', () => {
  function DialogWithMenu({ onClose }) {
    const [open, setOpen] = useState(true)
    return open && (
      <Modal title="עריכת נקודה" onClose={() => { onClose(); setOpen(false) }}>
        <Menu label={LABEL} items={pointItems()} />
      </Modal>
    )
  }

  it('is drawn inside the dialog, where a screen reader can reach it (the rest of the page is aria-modal\'s outside)', () => {
    render(<DialogWithMenu onClose={() => {}} />)
    open()
    expect(screen.getByRole('dialog', { name: 'עריכת נקודה' }).contains(menu())).toBe(true)
  })

  it('Esc closes only the menu, and the next Esc the dialog', () => {
    const onClose = vi.fn()
    render(<DialogWithMenu onClose={onClose} />)
    open()
    key(focused(), 'Escape')
    noMenu()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'עריכת נקודה' })).toBeTruthy()
    key(focused(), 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
