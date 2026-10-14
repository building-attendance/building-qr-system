// @vitest-environment jsdom
// The committee member's Google photo in the committee app (owner decision of 14/10/2026): MemberFace (src/admin/MemberFace.jsx) fills
// the member's circle with the photo that the server gives (`picture_url`), and with the initial when there is none or when the photo
// does not load. It is used in four places: the account button of the top bar, the circles of the rail's button and of the head of the
// account menu (src/admin/AccountMenu.jsx), and the mark of each member's card in Settings (src/admin/views/SettingsView.jsx). The real
// AdminApp, with the network (`api`) answered by the test like the server. The photo is a made-up data URL (one pixel), never a real
// address: jsdom loads no picture, so a failed load is fired by the test. How it looks, and the fallback in a real browser when the
// photo's address is blocked, are in e2e/admin-photo.spec.js and e2e/visual.spec.js.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import AdminApp from '../../src/pages/AdminApp.jsx'
import MemberFace, { initialOf } from '../../src/admin/MemberFace.jsx'
import { api } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OTHER_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ME = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Dana Cohen', email: 'dana@example.test', picture_url: PHOTO }
const MEMBERS = [
  { ...ME, is_active: true, last_login_at: null, created_at: '2026-01-01T08:00:00.000Z' },
  { id: '00000000-0000-4000-8000-0000000000a2', name: 'Yossi Levi', email: 'yossi@example.test', picture_url: null, is_active: true, last_login_at: null, created_at: '2026-01-02T08:00:00.000Z' },
  { id: '00000000-0000-4000-8000-0000000000a3', name: 'Rina Off', email: 'rina@example.test', picture_url: OTHER_PHOTO, is_active: false, last_login_at: null, created_at: '2026-01-03T08:00:00.000Z' },
]

window.scrollTo = vi.fn() // the shell scrolls to the top on a tab change; jsdom has no scrolling

const server = { me: ME, signedIn: true }
beforeEach(() => {
  Object.assign(server, { me: ME, signedIn: true })
  window.history.replaceState(null, '', '/#settings')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  document.title = ''
})

function answerLikeTheServer() {
  api.mockImplementation(async (path) => {
    if (path === '/admin/config') return { google_client_id: '', dev_login: true }
    if (path === '/admin/me') {
      if (!server.signedIn) throw Object.assign(new Error('no session'), { status: 401, code: 'admin_required' })
      return { admin: server.me }
    }
    if (path === '/admin/dev-login') return { admin: server.me }
    if (path === '/public/building' || path === '/admin/building') return { building: { address: '', name: '' } }
    if (path === '/admin/admins') return { admins: MEMBERS }
    throw new Error(`the test does not expect ${path}`)
  })
}

const topButton = () => within(screen.getByRole('banner')).getByRole('button', { name: 'החשבון שלי והגדרות' })
const railButton = () => within(screen.getByRole('complementary')).getByRole('button', { name: /^החשבון שלי והגדרות:/ })
const cardOf = async (name) => (await screen.findByRole('heading', { level: 3, name: new RegExp(name) })).closest('article')
const photoIn = (element) => element.querySelector('img')

/** Checks the picture that fills a circle: the photo, with no text of its own, no referrer and an empty alt. */
function expectPhoto(img, src) {
  expect(img, 'a photo').not.toBeNull()
  expect(img.getAttribute('src')).toBe(src)
  expect(img.getAttribute('alt')).toBe('') // the button, or the name beside the circle, says who it is
  expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(img.className).toBe('a-face')
}

describe('MemberFace on its own', () => {
  it('is the initial when there is no photo (none, null, empty), and the photo when there is one', () => {
    for (const picture_url of [undefined, null, '']) {
      const { container, unmount } = render(<span>{<MemberFace member={{ name: 'Dana', email: 'd@example.test', picture_url }} />}</span>)
      expect(container.textContent).toBe('D')
      expect(photoIn(container)).toBeNull()
      unmount()
    }
    const { container } = render(<span><MemberFace member={{ name: 'Dana', picture_url: PHOTO }} /></span>)
    expectPhoto(photoIn(container), PHOTO)
    expect(container.textContent).toBe('')
    expect(photoIn(container).hasAttribute('loading')).toBe(false) // the account circle: loaded at once
  })

  it('falls back to the initial when the photo does not load, and tries a new address again', () => {
    const { container, rerender } = render(<span><MemberFace member={{ name: 'Dana', picture_url: PHOTO }} /></span>)
    fireEvent.error(photoIn(container))
    expect(photoIn(container)).toBeNull()
    expect(container.textContent).toBe('D')
    rerender(<span><MemberFace member={{ name: 'Dana', picture_url: OTHER_PHOTO }} /></span>)
    expectPhoto(photoIn(container), OTHER_PHOTO)
  })

  it('loads lazily where it is asked to (the cards)', () => {
    const { container } = render(<span><MemberFace member={{ name: 'Dana', picture_url: PHOTO }} lazy /></span>)
    expect(photoIn(container).getAttribute('loading')).toBe('lazy')
  })

  it('takes the first letter of the name, else of the e-mail, in upper case', () => {
    expect(initialOf({ name: 'dana', email: 'x@example.test' })).toBe('D')
    expect(initialOf({ name: '', email: 'zoe@example.test' })).toBe('Z')
    expect(initialOf({ name: 'דנה כהן' })).toBe('ד')
    expect(initialOf({})).toBe('?')
  })
})

describe('the account circle', () => {
  it('holds the photo in the top bar, in the rail and in the head of the menu, and the buttons keep their names', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await screen.findByRole('heading', { level: 1, name: 'הגדרות' })
    expectPhoto(photoIn(topButton()), PHOTO)
    expect(topButton().textContent).toBe('') // no initial beside the photo
    expectPhoto(photoIn(railButton()), PHOTO)
    expect(railButton().textContent).toContain('Dana Cohen') // the rail still names the member
    fireEvent.click(topButton())
    const menu = screen.getByRole('dialog', { name: 'החשבון שלי' })
    expectPhoto(photoIn(menu), PHOTO)
    expect(photoIn(menu).closest('[aria-hidden="true"]')).not.toBeNull() // the head's circle is hidden from a screen reader, next to the name
  })

  it('shows the initial when the photo fails to load, in each place on its own', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await screen.findByRole('heading', { level: 1, name: 'הגדרות' })
    fireEvent.error(photoIn(topButton()))
    expect(topButton().textContent).toBe('D')
    expect(photoIn(topButton())).toBeNull()
    expectPhoto(photoIn(railButton()), PHOTO) // a failure is the circle's own
  })

  it('shows the initial for a member with no photo, as before', async () => {
    server.me = { ...ME, picture_url: null }
    answerLikeTheServer()
    render(<AdminApp />)
    await screen.findByRole('heading', { level: 1, name: 'הגדרות' })
    expect(topButton().textContent).toBe('D')
    expect(photoIn(topButton())).toBeNull()
    expect(photoIn(railButton())).toBeNull()
  })

  it('shows the photo of the answer of the sign-in at once, with no reload', async () => {
    server.signedIn = false
    answerLikeTheServer()
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'כניסת פיתוח' }))
    await screen.findByRole('heading', { level: 1, name: 'הגדרות' })
    expectPhoto(photoIn(topButton()), PHOTO)
  })
})

describe('the member cards in Settings', () => {
  it('hold the photo of each member who has one (lazily), and the initial of one who has none', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    const dana = await cardOf('Dana Cohen')
    const mark = dana.querySelector('.a-card__icon--round')
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    expectPhoto(photoIn(mark), PHOTO)
    expect(photoIn(mark).getAttribute('loading')).toBe('lazy')
    const yossi = await cardOf('Yossi Levi')
    expect(photoIn(yossi)).toBeNull()
    expect(yossi.querySelector('.a-card__icon--round').textContent).toBe('Y')
    const rina = await cardOf('Rina Off')
    expect(rina.className).toContain('is-off') // the CSS draws the photo of a member who is switched off in grey
    expectPhoto(photoIn(rina), OTHER_PHOTO)
  })

  it('fall back to the initial when a photo fails to load', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    const rina = await cardOf('Rina Off')
    fireEvent.error(photoIn(rina))
    await waitFor(() => expect(photoIn(rina)).toBeNull())
    expect(rina.querySelector('.a-card__icon--round').textContent).toBe('R')
  })
})
