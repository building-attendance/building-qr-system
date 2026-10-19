// @vitest-environment jsdom
// An empty list offers to add its first item once, not twice (design rule S1 in docs/design.md; owner decision of 15/10/2026).
// The Points, Providers and Agent screens each have an add button in their heading and an empty state with a button of its own.
// While the list has loaded and is empty, that empty state is the one next step: the heading holds only its title (on Points no print
// button either, there is nothing to print). With the first item the heading's actions come back; while the list loads, and when it
// could not be loaded, the heading is as it always was. The real screens, with the network (`api`) answered by the test and the map
// (Leaflet, which needs a real layout) replaced by a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PointsView from '../../src/admin/views/PointsView.jsx'
import ProvidersView from '../../src/admin/views/ProvidersView.jsx'
import AgentView from '../../src/admin/views/AgentView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { clearLoadCache } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
vi.mock('../../src/admin/MapPicker.jsx', () => ({
  default: ({ onPick }) => <button type="button" onClick={() => onPick({ lat: 32.0853, lng: 34.7818 })}>סימון במפה</button>,
}))

const WAIT = { timeout: 4000 }

const LOBBY = {
  id: 'p-lobby', name: 'לובי', description: null, is_active: true, gps_mode: 'required', lat: 32.0853, lng: 34.7818,
  radius_m: 40, service_type: null, scan_count: 0, provider_ids: [], qr_url: 'https://example.test/scan?code=x',
}
const CLEANER = {
  id: '00000000-0000-4000-8000-000000000001', company: 'ניקיון', contact_name: 'פלוני', service_type: 'cleaning',
  is_active: true, is_demo: false, created_at: '2026-09-01T08:00:00.000Z', has_password: true, active_devices: 0, last_scan_at: null,
  scan_count: 0, waiting: 0, oldest_waiting_at: null, outdated_devices: 0,
}
const KEY = {
  id: '00000000-0000-4000-8000-000000000002', name: 'הסוכן של הוועד', key_prefix: 'qrk_a1b2', created_at: '2026-09-01T08:00:00.000Z',
  last_used_at: null, revoked_at: null, requests_today: 0, requests_7d: 0, refused_30d: 0,
}

const type = (scope, label, value) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

/**
 * The three screens. For each: its heading, the add button of the heading (`pill`), the empty state's title and its own button (`own`),
 * the name of the dialog that either of them opens, the buttons the heading holds with an item in the list (in the order they stand),
 * all the buttons the screen holds when the list is empty, how the network answers (`answer` the list, `created` a new item), and how
 * the first item is made in the dialog (`make`, then the dialog that follows the saving: `after`).
 */
const SCREENS = [
  {
    name: 'Points', View: PointsView, title: 'נקודות סריקה', listPath: '/admin/points', item: LOBBY,
    answer: (items) => ({ points: items }), created: (options) => ({ point: { ...LOBBY, ...options.body, id: 'p-new' } }),
    emptyTitle: 'עוד אין נקודות', own: 'הוסיפו את הנקודה הראשונה', pill: 'נקודה חדשה', dialog: 'נקודה חדשה',
    headingButtons: ['נקודה חדשה', 'הדפסת כל השלטים'], emptyButtons: ['הוסיפו את הנקודה הראשונה'],
    make: async (form) => {
      type(form, 'שם הנקודה', 'חדר אשפה')
      fireEvent.click(await within(form).findByRole('button', { name: 'סימון במפה' }))
      fireEvent.click(within(form).getByRole('button', { name: 'שמירה' }))
    },
    after: 'QR: חדר אשפה',
  },
  {
    name: 'Providers', View: ProvidersView, title: 'נותני שירות', listPath: '/admin/providers', item: CLEANER,
    answer: (items) => ({ providers: items }), created: (options) => ({ provider: { ...CLEANER, ...options.body, id: 'pr-new' } }),
    emptyTitle: 'עוד אין נותני שירות', own: 'הוסיפו נותן שירות', pill: 'נותן שירות חדש', dialog: 'נותן שירות חדש',
    headingButtons: ['נותן שירות חדש'], emptyButtons: ['הוסיפו נותן שירות'],
    make: async (form) => {
      type(form, 'חברה', 'ניקיון אלון')
      fireEvent.click(within(form).getByRole('button', { name: 'שמירה' }))
    },
    after: 'הסיסמה נשמרה',
  },
  {
    name: 'Agent', View: AgentView, title: "גישה לאייג'נט", listPath: '/admin/api-keys', item: KEY,
    answer: (items) => ({ api_keys: items, limits: { per_minute: 60, per_day: 2000 } }),
    created: (options) => ({ key: 'qrk_sample_key_shown_once', api_key: { ...KEY, name: options.body.name, id: 'k-new' } }),
    emptyTitle: 'עוד אין מפתחות', own: 'יצירת מפתח', pill: 'מפתח חדש', dialog: 'מפתח גישה חדש',
    headingButtons: ['מפתח חדש'], emptyButtons: ['יצירת מפתח', 'העתקת ההנחיה'], // the second is the copy button of the "how the agent connects" card
    make: async (form) => {
      type(form, 'שם המפתח', 'הסוכן של הוועד')
      fireEvent.click(within(form).getByRole('button', { name: 'יצירה' }))
    },
    after: 'המפתח נוצר',
  },
]

/** The names of the buttons inside `scope`, in the order they stand: a button with an icon only is named by its label. */
const buttonNames = (scope) => within(scope).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
/** The heading of the screen: the block of the title (h1) and the actions beside it. */
const head = () => screen.getByRole('heading', { level: 1 }).closest('.a-head')

/**
 * Renders a screen whose list is `items`, and `state.items` is what the server holds from now on (a new item is added to it).
 * `list` replaces the answer of the list itself (a request that does not answer, or fails).
 */
function show(s, { items = [], list = null } = {}) {
  const state = { items: [...items] }
  api.mockImplementation(async (path, options = {}) => {
    if (path === s.listPath && !options.method) return list ? list() : s.answer(state.items)
    if (path === '/admin/providers' && !options.method) return { providers: [] } // the list of providers that the Points screen also asks for
    if (path === s.listPath && options.method === 'POST') {
      const made = s.created(options)
      state.items.push(Object.values(made).find((v) => v && typeof v === 'object' && v.id))
      return made
    }
    throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
  })
  render(<ToastProvider><ConfirmProvider><s.View /></ConfirmProvider></ToastProvider>)
  return state
}

beforeEach(() => {
  clearLoadCache() // every test stands for a new page load: the screens keep their last answer in memory otherwise
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe.each(SCREENS)('$name, with the list empty', (s) => {
  it('has the empty state\'s button as the only way to add, and nothing in the heading but its title', async () => {
    show(s)
    expect(await screen.findByRole('heading', { level: 2, name: s.emptyTitle }, WAIT)).toBeTruthy()

    expect(screen.queryByRole('button', { name: s.pill }), 'no add pill in the heading').toBeNull()
    expect(buttonNames(head()), 'the heading holds only its title: no button at all').toEqual([])
    expect(screen.getByRole('heading', { level: 1, name: s.title })).toBeTruthy()
    expect(buttonNames(document.body), 'one button for the first item, and nothing else (the print button of Points is gone too)').toEqual(s.emptyButtons)
  })

  it('opens the dialog of a new item with that one button', async () => {
    show(s)
    fireEvent.click(await screen.findByRole('button', { name: s.own }, WAIT))
    expect(screen.getByRole('dialog', { name: s.dialog })).toBeTruthy()
  })

  it('brings the actions of the heading back with the first item', async () => {
    show(s)
    fireEvent.click(await screen.findByRole('button', { name: s.own }, WAIT))
    await s.make(screen.getByRole('dialog', { name: s.dialog }))
    // the dialog that follows the saving (the QR of the new point, the password, the key that is shown once), closed by Esc. The key is
    // pressed where a person's key lands, on what has the focus, once the dialog has taken it: the dialog takes the focus and starts to
    // listen to the keyboard in one effect, which React can run after `findByRole` has already found the dialog in the page.
    const after = await screen.findByRole('dialog', { name: s.after }, WAIT)
    await waitFor(() => expect(after.contains(document.activeElement), 'the dialog has taken the focus').toBe(true), WAIT)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT)

    expect(await screen.findByRole('button', { name: s.pill }, WAIT), 'the add pill is back in the heading').toBeTruthy()
    expect(buttonNames(head())).toEqual(s.headingButtons)
    expect(screen.queryByRole('heading', { level: 2, name: s.emptyTitle }), 'and the empty state is gone').toBeNull()
    expect(screen.queryByRole('button', { name: s.own }), 'with its button').toBeNull()
  })
})

describe.each(SCREENS)('$name, with an item in the list', (s) => {
  it('has the add button in the heading, as before, and no empty state', async () => {
    show(s, { items: [s.item] })
    expect(await screen.findByRole('button', { name: s.pill }, WAIT)).toBeTruthy()
    expect(buttonNames(head())).toEqual(s.headingButtons)
    expect(screen.queryByRole('heading', { level: 2, name: s.emptyTitle })).toBeNull()
    expect(screen.queryByRole('button', { name: s.own })).toBeNull()
    if (s.name === 'Points') expect(screen.getByRole('button', { name: 'הדפסת כל השלטים' }).disabled, 'there is a sign to print').toBe(false)

    fireEvent.click(screen.getByRole('button', { name: s.pill }))
    expect(screen.getByRole('dialog', { name: s.dialog })).toBeTruthy()
  })
})

describe.each(SCREENS)('$name, while the list loads and when it cannot be loaded', (s) => {
  it('keeps its heading as it was: the add button is there, and the empty state is not', async () => {
    let answer
    show(s, { list: () => new Promise((resolve) => { answer = resolve }) })
    expect(await screen.findByRole('status'), 'it is loading').toBeTruthy()
    expect(buttonNames(head())).toEqual(s.headingButtons)
    expect(screen.queryByRole('heading', { level: 2, name: s.emptyTitle })).toBeNull()
    if (s.name === 'Points') expect(screen.getByRole('button', { name: 'הדפסת כל השלטים' }).disabled, 'nothing to print yet').toBe(true)

    answer(s.answer([]))
    expect(await screen.findByRole('heading', { level: 2, name: s.emptyTitle }, WAIT), 'the list is empty: the heading gives way to the empty state').toBeTruthy()
    expect(buttonNames(head())).toEqual([])
  })

  it('keeps its heading as it was when the request fails, and offers to try again, not to add', async () => {
    show(s, { list: () => Promise.reject(Object.assign(new Error('boom'), { status: 500, code: 'server_error' })) })
    expect(await screen.findByRole('button', { name: 'נסו שוב' }, WAIT)).toBeTruthy()
    expect(buttonNames(head())).toEqual(s.headingButtons)
    expect(screen.queryByRole('heading', { level: 2, name: s.emptyTitle }), 'a failed request is not an empty list').toBeNull()
    expect(screen.queryByRole('button', { name: s.own })).toBeNull()
  })
})
