// @vitest-environment jsdom
// The add buttons of the committee app get the focus back when their dialog closes, on an iPhone too. A dialog (`Modal` in
// src/admin/ui.jsx) gives the focus back to the element that had it when it opened, and Safari does not focus a button that is tapped
// or clicked (MDN, <button>, "Clicking and focus"), so a dialog opened by a tap gave it back to nothing: the person was left at the top
// of the page. jsdom does not focus a clicked button either, so each test here takes the focus away first and clicks without focusing,
// as Safari does, and then closes the dialog in each of its three ways (the close button, Esc, its own Cancel button).
// The openers: the add button of each screen's heading (Points, Providers, Agent, Settings), and the add button of the empty state of
// Points, Providers and Agent, the one way to add while the list is empty. That one is gone once the first item is saved, and then the
// focus goes to the page's main, as for every opener that is gone. The real screens, with the network (`api`) answered by the test and
// the map (Leaflet, which needs a real layout) replaced by a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PointsView from '../../src/admin/views/PointsView.jsx'
import ProvidersView from '../../src/admin/views/ProvidersView.jsx'
import AgentView from '../../src/admin/views/AgentView.jsx'
import SettingsView from '../../src/admin/views/SettingsView.jsx'
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
const ME = { id: 'a1', name: 'Dana', email: 'dana@example.test', is_active: true, last_login_at: null }

const type = (scope, label, value) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

/**
 * The screens. For each: how it is drawn, the path of its list and how the server answers it (`answer` the list, `created` a new item),
 * the add button of its heading (`pill`) with the item that shows it (`item`), the empty state's own button (`own`, none on Settings,
 * whose list always holds the member who is signed in), the name of the dialog that both open, and how the first item is made in that
 * dialog (`make`), with the dialog that follows the saving (`after`).
 */
const SCREENS = [
  {
    name: 'Points', View: PointsView, listPath: '/admin/points', item: LOBBY,
    answer: (items) => ({ points: items }), created: (options) => ({ point: { ...LOBBY, ...options.body, id: 'p-new' } }),
    pill: 'נקודה חדשה', own: 'הוסיפו את הנקודה הראשונה', dialog: 'נקודה חדשה',
    make: async (form) => {
      type(form, 'שם הנקודה', 'חדר אשפה')
      fireEvent.click(await within(form).findByRole('button', { name: 'סימון במפה' }))
      fireEvent.click(within(form).getByRole('button', { name: 'שמירה' }))
    },
    after: 'QR: חדר אשפה',
  },
  {
    name: 'Providers', View: ProvidersView, listPath: '/admin/providers', item: CLEANER,
    answer: (items) => ({ providers: items }), created: (options) => ({ provider: { ...CLEANER, ...options.body, id: 'pr-new' } }),
    pill: 'נותן שירות חדש', own: 'הוסיפו נותן שירות', dialog: 'נותן שירות חדש',
    make: async (form) => {
      type(form, 'חברה', 'ניקיון אלון')
      fireEvent.click(within(form).getByRole('button', { name: 'שמירה' }))
    },
    after: 'הסיסמה נשמרה',
  },
  {
    name: 'Agent', View: AgentView, listPath: '/admin/api-keys', item: KEY,
    answer: (items) => ({ api_keys: items, limits: { per_minute: 60, per_day: 2000 } }),
    created: (options) => ({ key: 'qrk_sample_key_shown_once', api_key: { ...KEY, name: options.body.name, id: 'k-new' } }),
    pill: 'מפתח חדש', own: 'יצירת מפתח', dialog: 'מפתח גישה חדש',
    make: async (form) => {
      type(form, 'שם המפתח', 'הסוכן של הוועד')
      fireEvent.click(within(form).getByRole('button', { name: 'יצירה' }))
    },
    after: 'המפתח נוצר',
  },
  {
    name: 'Settings', View: () => <SettingsView admin={ME} />, listPath: '/admin/admins', item: ME,
    answer: (items) => ({ admins: items }), pill: 'מנהל מערכת חדש', own: null, dialog: 'מנהל מערכת חדש',
  },
]

/**
 * Renders a screen inside the shell's main, with `items` in its list; `state.items` is what the server holds from now on (a new item is
 * added to it).
 */
function show(s, { items = [] } = {}) {
  const state = { items: [...items] }
  api.mockImplementation(async (path, options = {}) => {
    if (path === s.listPath && !options.method) return s.answer(state.items)
    if (path === '/admin/providers' && !options.method) return { providers: [] } // the list of providers that the Points screen also asks for
    if (path === '/admin/building' && !options.method) return { building: { address: '' } } // the building's card on Settings
    if (path === s.listPath && options.method === 'POST') {
      const made = s.created(options)
      state.items.push(Object.values(made).find((v) => v && typeof v === 'object' && v.id))
      return made
    }
    throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
  })
  render(<ToastProvider><ConfirmProvider><main tabIndex={-1} aria-label="מסך"><s.View /></main></ConfirmProvider></ToastProvider>)
  return state
}

/** A tap on an iPhone: nothing is focused before it, and the click itself focuses nothing (jsdom does not either). */
function tap(button) {
  document.activeElement?.blur()
  expect(document.activeElement, 'nothing has the focus before the tap').toBe(document.body)
  fireEvent.click(button)
}

/** The three ways to close a dialog that holds nothing typed: each closes it at once. */
const CLOSES = [
  ['its close button', (dialog) => fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))],
  ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ['its Cancel button', (dialog) => fireEvent.click(within(dialog).getByRole('button', { name: 'ביטול' }))],
]

/** Opens the dialog with a tap on `name`, closes it in each of the three ways, and expects the button focused after each. */
async function expectFocusBack(s, name) {
  const button = await screen.findByRole('button', { name }, WAIT)
  for (const [way, close] of CLOSES) {
    tap(button)
    const dialog = screen.getByRole('dialog', { name: s.dialog })
    expect(dialog.contains(document.activeElement), 'the dialog has taken the focus').toBe(true)
    close(dialog)
    expect(screen.queryByRole('dialog'), `closed by ${way}`).toBeNull()
    expect(document.activeElement, `the focus is back on "${name}" after ${way}`).toBe(button)
  }
}

beforeEach(() => {
  clearLoadCache() // every test stands for a new page load: the screens keep their last answer in memory otherwise
  document.body.style.overflow = ''
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe.each(SCREENS)('$name, the add button of the heading', (s) => {
  it('gets the focus back when its dialog closes, after a tap that focused nothing', async () => {
    show(s, { items: [s.item] })
    await expectFocusBack(s, s.pill)
  })
})

describe.each(SCREENS.filter((s) => s.own))('$name, the add button of the empty state', (s) => {
  it('gets the focus back when its dialog closes, after a tap that focused nothing', async () => {
    show(s)
    await expectFocusBack(s, s.own)
  })

  it('is gone once the first item is saved, and the focus goes to the main of the page when the dialog that follows closes', async () => {
    show(s)
    tap(await screen.findByRole('button', { name: s.own }, WAIT))
    await s.make(screen.getByRole('dialog', { name: s.dialog }))
    const after = await screen.findByRole('dialog', { name: s.after }, WAIT)
    await waitFor(() => expect(after.contains(document.activeElement), 'the dialog has taken the focus').toBe(true), WAIT)
    // The list has loaded again under the dialog: the empty state and its button have given way to the heading's add button.
    expect(await screen.findByRole('button', { name: s.pill }, WAIT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: s.own })).toBeNull()

    fireEvent.click(within(after).getAllByRole('button', { name: 'סגירה' })[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement, 'the top of the screen, whose heading holds the add button again').toBe(screen.getByRole('main'))
  })
})
