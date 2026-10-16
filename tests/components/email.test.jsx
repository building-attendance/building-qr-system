// @vitest-environment jsdom
// An e-mail address in the committee app (src/admin/Email.jsx, owner decision of 16/10/2026): it may break after the "@" and after a dot,
// never in the middle of a word, and the text of the address stays as it is. jsdom has no layout, so what is tested here is the markup
// that gives the browser those places and nothing else (one inline block for each piece, between the "@" and the dots), in the helper and
// in every place that shows an address. Where the lines really break is measured in a browser (e2e/admin.spec.js).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import Email, { emailParts, isEmailAddress } from '../../src/admin/Email.jsx'
import AccountMenu from '../../src/admin/AccountMenu.jsx'
import SettingsView from '../../src/admin/views/SettingsView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { api } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

// The longest kind of address that the server takes (a name of 64 characters before the @, labels of 63 after it), with a hyphen and a plus
// in it: neither of those is a place to break.
const LONG = 'avraham.yitzhak.ben-tzion+committee-chair-notifications@management.maintenance-department.north-region.example.test'
const SHORT = 'dana@example.test'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** The text of each piece of a rendered address, in order. */
const piecesOf = (root) => [...root.querySelectorAll('.a-email__piece')].map((el) => el.textContent)

describe('emailParts', () => {
  it('cuts after each "@" and each dot, and nowhere else', () => {
    expect(emailParts('a.b@c.com')).toEqual(['a.', 'b@', 'c.', 'com'])
    expect(emailParts(SHORT)).toEqual(['dana@', 'example.', 'test'])
    expect(emailParts(LONG)).toEqual([
      'avraham.', 'yitzhak.', 'ben-tzion+committee-chair-notifications@', 'management.', 'maintenance-department.', 'north-region.', 'example.', 'test',
    ])
  })

  it('always gives the address back whole, and every piece but the last ends where a line may break', () => {
    for (const address of [LONG, SHORT, 'a..b@c', 'no-at-no-dot', 'x@y.', '.leading@dot', 'one@']) {
      const parts = emailParts(address)
      expect(parts.join(''), address).toBe(address)
      for (const part of parts.slice(0, -1)) expect(part, `${address}: ${part}`).toMatch(/[@.]$/)
      for (const part of parts) expect(part.slice(0, -1), `${address}: a break inside ${part}`).not.toMatch(/[@.]/)
    }
  })

  it('has nothing to break in an address without an "@" or a dot, in an empty one and in none', () => {
    expect(emailParts('plainword')).toEqual(['plainword'])
    expect(emailParts('')).toEqual([])
    expect(emailParts(null)).toEqual([])
    expect(emailParts(undefined)).toEqual([])
  })
})

describe('isEmailAddress', () => {
  it('is true for a whole address and false for a name, an address with a space, and anything that is not text', () => {
    expect(isEmailAddress(SHORT)).toBe(true)
    expect(isEmailAddress(LONG)).toBe(true)
    for (const text of ['דנה לוי', 'dana@', '@example.test', 'dana @example.test', 'dana@example', '', null, undefined, 5]) expect(isEmailAddress(text), String(text)).toBe(false)
  })
})

describe('Email', () => {
  it('is a left-to-right isolate whose text is exactly the address, so that copying it gives the address', () => {
    const { container } = render(<p><Email address={LONG} /></p>)
    const el = container.querySelector('bdi')
    expect(el.getAttribute('dir')).toBe('ltr')
    expect(el.textContent).toBe(LONG)
  })

  it('is one piece for each stretch up to an "@" or a dot, and nothing else: a hyphen or a plus is inside a piece, not a place to break', () => {
    const { container } = render(<Email address={LONG} />)
    const el = container.querySelector('bdi')
    const parts = piecesOf(el)
    expect(parts).toEqual(emailParts(LONG))
    expect(parts.length).toBe((LONG.match(/[@.]/g) ?? []).length + 1) // one after each "@" and dot, and the end
    expect(parts.join('')).toBe(LONG)
    for (const part of parts.slice(0, -1)) expect(part).toMatch(/[@.]$/)
    for (const part of parts) expect(part.slice(0, -1), `a break inside ${part}`).not.toMatch(/[@.]/)
    expect(parts).toContain('ben-tzion+committee-chair-notifications@')
    expect(parts).toContain('north-region.')
    expect(el.children.length, 'nothing but the pieces inside').toBe(parts.length)
    expect([...el.children].every((child) => child.tagName === 'SPAN'), 'each piece is a span').toBe(true)
  })

  it('is one piece for an address that has no place to break, and none for no address', () => {
    const { container } = render(<><Email address="plainword" /><Email address="" /><Email address={null} /></>)
    const [plain, empty, none] = container.querySelectorAll('bdi')
    expect(piecesOf(plain)).toEqual(['plainword'])
    expect(piecesOf(empty)).toEqual([])
    expect(none.textContent).toBe('')
  })

  it('is plain text when it is one line (the button of the side rail): nothing to break at, and the text is whole', () => {
    const { container } = render(<Email address={LONG} oneLine />)
    const el = container.querySelector('bdi')
    expect(el.children.length).toBe(0)
    expect(el.textContent).toBe(LONG)
    expect(el.getAttribute('dir')).toBe('ltr')
  })

  it('gives its class, its title and any other attribute to the element', () => {
    const { container } = render(<Email address={SHORT} className="x" title={SHORT} data-k="1" />)
    const el = container.querySelector('bdi')
    expect(el.getAttribute('class')).toBe('x')
    expect(el.getAttribute('title')).toBe(SHORT)
    expect(el.getAttribute('data-k')).toBe('1')
  })
})

describe('the stylesheet (src/admin/admin.css)', () => {
  const CSS = fs.readFileSync(path.join(process.cwd(), 'src', 'admin', 'admin.css'), 'utf8')

  it('a piece is an inline block no wider than its line: a line breaks between pieces, and inside one only when it alone is wider than the line', () => {
    const rule = CSS.match(/(?:^|\})\s*\.a-email__piece\s*\{([^}]*)\}/m)?.[1]
    expect(rule, 'admin.css has no rule for .a-email__piece').toBeTruthy()
    expect(rule).toMatch(/display:\s*inline-block/)
    expect(rule).toMatch(/max-width:\s*100%/)
  })
})

describe('every place that shows an address uses it', () => {
  const ADMIN = { id: 'a1', name: 'דנה לוי', email: LONG }

  it('the account button of the side rail: one line, and its whole address stays in the page', () => {
    render(<AccountMenu admin={ADMIN} onSignOut={() => {}} where="rail" />)
    const button = screen.getByRole('button', { name: /החשבון שלי והגדרות/ })
    const shown = button.querySelector('.a-who__mail')
    expect(shown.tagName).toBe('BDI')
    expect(shown.textContent).toBe(LONG) // cut by the CSS only (one line and an ellipsis), so the whole address is there for a screen reader
    expect(shown.getAttribute('title')).toBe(LONG)
    expect(shown.children.length, 'one line that ends in an ellipsis: plain text, nothing to break at').toBe(0)
  })

  it('the menu that the button opens names the member in full: the whole name, and the address in its pieces', async () => {
    render(<AccountMenu admin={{ ...ADMIN, name: 'א'.repeat(120) }} onSignOut={() => {}} where="top" />)
    fireEvent.click(screen.getByRole('button', { name: 'החשבון שלי והגדרות' }))
    const menu = await screen.findByRole('dialog', { name: 'החשבון שלי' })
    const who = menu.querySelector('.a-who')
    expect(who.querySelector('strong').textContent).toBe('א'.repeat(120))
    expect(who.querySelector('bdi').textContent).toBe(LONG)
    expect(piecesOf(who)).toEqual(emailParts(LONG))
  })

  it('the card of a member in Settings', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/admin/admins') return { admins: [{ id: 'a2', name: 'גילה', email: LONG, is_active: true, last_login_at: null, picture_url: null }] }
      if (path === '/admin/building') return { building: { name: '', address: '' } }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><SettingsView admin={{ id: 'me' }} /></ConfirmProvider></ToastProvider>)
    const card = (await screen.findByRole('heading', { name: 'גילה', level: 3 })).closest('article')
    const address = within(card).getByText((_, el) => el.tagName === 'BDI')
    expect(address.getAttribute('dir')).toBe('ltr')
    expect(address.textContent).toBe(LONG)
    expect(piecesOf(address)).toEqual(emailParts(LONG))
  })
})
