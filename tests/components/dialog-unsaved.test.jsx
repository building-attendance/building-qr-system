// @vitest-environment jsdom
// The dialogs of the committee app do not throw away what was typed in them by accident. A tap outside a dialog, Esc and the X in its
// corner ask "close without saving?" when the person changed something (`dirty` of Modal, `useDirty` of the forms); going back
// leaves the dialog and everything typed in it as it was. A dialog that nothing was typed in closes at once, and so does the
// dialog's own Cancel button (a decision, not an accident). The real AdminApp, with the network (`api`) answered by the test.
//
// What went wrong: the backdrop and Esc closed any dialog at once, so a committee member who filled in a new point or a new provider
// and touched outside the dialog (or pressed Esc) lost everything and had to start again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AdminApp from '../../src/pages/AdminApp.jsx'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE, GPS_MODE_REQUIRED } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
// Leaflet needs a real layout; the form only needs a map that can be clicked.
vi.mock('../../src/admin/MapPicker.jsx', () => ({
  default: ({ onPick }) => <button type="button" onClick={() => onPick({ lat: 32.0853, lng: 34.7818 })}>סימון במפה</button>,
}))

window.scrollTo = vi.fn() // the shell scrolls to the top on a tab change; jsdom has no scrolling

const WAIT = { timeout: 4000 }
const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sample Member', email: 'member@example.test' }
const QUESTION = 'לסגור בלי לשמור?'
const BACK = 'חזרה לעריכה'
const DISCARD = 'סגירה בלי לשמור'

const PROVIDER = {
  id: '22222222-2222-4222-8222-222222222222', company: 'ניקיון', contact_name: 'פלוני', service_type: 'cleaning', is_active: true, is_demo: false,
  created_at: '2026-09-01T08:00:00.000Z', has_password: true, active_devices: 0, last_scan_at: null, scan_count: 0, waiting: 0,
  oldest_waiting_at: null, outdated_devices: 0,
}
const POINT = {
  id: '11111111-1111-4111-8111-111111111111', name: 'לובי', description: null, is_active: true, gps_mode: GPS_MODE_REQUIRED, lat: 32.0853, lng: 34.7818,
  radius_m: 40, service_type: null, scan_count: 0, provider_ids: [], qr_url: 'https://example.test/scan?code=x',
}
const SCAN = {
  id: 's1', local_date: '2026-10-05', checked_in_at: '2026-10-05T06:00:00Z', point_id: POINT.id, point_name: POINT.name, provider_id: PROVIDER.id,
  provider_name: 'נותן סריקה', outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE, distance_m: 58, gps_accuracy_m: 35, flags: [], voided: false, void_reason: null,
}

/** The calls that wrote something (POST, PATCH, PUT, DELETE), as `[path, options]`. */
const writes = () => api.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')

function answerLikeTheServer() {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/admin/config') return { google_client_id: '', dev_login: false }
    if (path === '/admin/me') return { admin: ADMIN }
    if (path === '/public/building') return { building: { address: '', name: '' } }
    if (path === '/admin/building') return { building: { address: '', name: '' } }
    if (path === '/admin/points' && !options.method) return { points: [POINT] }
    if (path === '/admin/points' && options.method === 'POST') return { point: { ...POINT, ...options.body, id: 'p-new' } }
    if (path === '/admin/providers' && !options.method) return { providers: [PROVIDER] }
    if (path === '/admin/providers' && options.method === 'POST') return { provider: { ...PROVIDER, ...options.body, id: 'pr-new' } }
    if (path.startsWith('/admin/scans')) return { scans: [SCAN], next_cursor: null }
    if (path === '/admin/api-keys') return { api_keys: [] }
    if (path === '/admin/admins') return { admins: [] }
    throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
  })
}

/**
 * The six dialogs that hold something a person types. `open` opens it from its tab, `field` is the field that the test types into
 * (the one that the dialog focuses first), `cancel` is the dialog's own button that leaves it.
 */
const DIALOGS = [
  {
    name: 'a new point', tab: 'points', dialog: 'נקודה חדשה', field: 'שם הנקודה', cancel: 'ביטול',
    open: async () => fireEvent.click((await screen.findAllByRole('button', { name: 'נקודה חדשה' }, WAIT))[0]),
  },
  {
    name: 'a point that is edited', tab: 'points', dialog: 'עריכת נקודה: לובי', field: 'שם הנקודה', cancel: 'ביטול',
    open: async () => fireEvent.click(within((await screen.findByRole('heading', { name: 'לובי', level: 2 }, WAIT)).closest('article')).getByRole('button', { name: 'עריכה' })),
  },
  {
    name: 'a new provider', tab: 'providers', dialog: 'נותן שירות חדש', field: 'חברה', cancel: 'ביטול',
    open: async () => fireEvent.click((await screen.findAllByRole('button', { name: 'נותן שירות חדש' }, WAIT))[0]),
  },
  {
    name: 'a provider that is edited', tab: 'providers', dialog: 'עריכה: פלוני', field: 'חברה', cancel: 'ביטול',
    open: async () => fireEvent.click(within((await screen.findByRole('heading', { name: 'פלוני', level: 2 }, WAIT)).closest('article')).getByRole('button', { name: 'עריכה' })),
  },
  {
    name: 'a new password for a provider', tab: 'providers', dialog: 'סיסמה חדשה: פלוני', field: 'סיסמה', cancel: 'ביטול',
    open: async () => fireEvent.click(within((await screen.findByRole('heading', { name: 'פלוני', level: 2 }, WAIT)).closest('article')).getByRole('button', { name: 'סיסמה חדשה' })),
  },
  {
    name: 'the cancelling of a visit', tab: 'history', dialog: 'ביטול נוכחות', field: 'סיבה (לא חובה)', cancel: 'חזרה',
    open: async () => fireEvent.click(within((await screen.findByText('נותן סריקה', {}, WAIT)).closest('li')).getByRole('button', { name: 'ביטול הנוכחות' })),
  },
  {
    name: 'a new agent key', tab: 'agent', dialog: 'מפתח גישה חדש', field: 'שם המפתח', cancel: 'ביטול',
    open: async () => fireEvent.click((await screen.findAllByRole('button', { name: 'מפתח חדש' }, WAIT))[0]),
  },
  {
    name: 'a new committee member', tab: 'committee', dialog: 'חבר ועד חדש', field: 'כתובת Gmail', cancel: 'ביטול',
    open: async () => fireEvent.click((await screen.findAllByRole('button', { name: 'חבר ועד חדש' }, WAIT))[0]),
  },
]

const askedToClose = () => screen.queryByRole('dialog', { name: QUESTION })
const escape = () => fireEvent.keyDown(document, { key: 'Escape' })
/** The dark strip around the dialog: a press there is what "tapping outside" is. */
const backdropOf = (dialog) => dialog.parentElement
const type = (field, value) => fireEvent.change(field, { target: { value } })

/** Opens `spec`'s dialog in the real app and returns it with the field that gets typed into. */
async function openDialog(spec) {
  window.history.replaceState(null, '', `/#${spec.tab}`)
  render(<AdminApp />)
  await spec.open()
  const dialog = await screen.findByRole('dialog', { name: spec.dialog }, WAIT)
  return { dialog, field: within(dialog).getByLabelText(spec.field) }
}

// The same fixed "today" as the other History tests: only the clock of Date is faked.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
  answerLikeTheServer()
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  document.title = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe.each(DIALOGS)('$name', (spec) => {
  it('closes at once with Esc when nothing was changed', async () => {
    const { dialog } = await openDialog(spec)
    escape()
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(askedToClose()).toBeNull()
  })

  it('asks before Esc closes it once something was typed, and going back keeps the dialog and what was typed', async () => {
    const { dialog, field } = await openDialog(spec)
    type(field, 'טקסט שהוקלד')
    escape()

    const question = await screen.findByRole('dialog', { name: QUESTION })
    expect(within(question).getByText(/עוד לא נשמר/)).toBeTruthy()
    expect(dialog.isConnected, 'the dialog is still open under the question').toBe(true)
    // the answer that keeps everything has the focus, so that Enter is the safe key
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: BACK }))

    fireEvent.click(within(question).getByRole('button', { name: BACK }))
    await waitFor(() => expect(askedToClose()).toBeNull())
    expect(dialog.isConnected).toBe(true)
    expect(field.value).toBe('טקסט שהוקלד')
    expect(document.activeElement, 'the person is back in the field they were typing in').toBe(field)
    expect(writes()).toEqual([])
  })

  it('asks before a tap outside it closes it, and closes it only when the person says so', async () => {
    const { dialog, field } = await openDialog(spec)
    type(field, 'טקסט שהוקלד')
    // a press inside the dialog is not a tap outside it
    fireEvent.mouseDown(within(dialog).getByRole('heading', { name: spec.dialog }))
    expect(askedToClose()).toBeNull()

    // the press on the backdrop does not take the focus out of the field (the browser's default for a press on a plain area)
    expect(fireEvent.mouseDown(backdropOf(dialog))).toBe(false)
    const question = await screen.findByRole('dialog', { name: QUESTION })
    expect(dialog.isConnected).toBe(true)

    fireEvent.click(within(question).getByRole('button', { name: DISCARD }))
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(askedToClose()).toBeNull()
    expect(writes()).toEqual([])
  })

  it('asks before the X in its corner closes it', async () => {
    const { dialog, field } = await openDialog(spec)
    type(field, 'טקסט שהוקלד')
    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))
    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy()
    expect(dialog.isConnected).toBe(true)
  })

  it('keeps the dialog when Esc answers the question: Esc closes the question, not the dialog', async () => {
    const { dialog, field } = await openDialog(spec)
    type(field, 'טקסט שהוקלד')
    escape()
    await screen.findByRole('dialog', { name: QUESTION })
    escape()
    await waitFor(() => expect(askedToClose()).toBeNull())
    expect(dialog.isConnected).toBe(true)
    expect(field.value).toBe('טקסט שהוקלד')
  })

  it('does not ask when the typed text is taken back out: nothing is at stake', async () => {
    const { dialog, field } = await openDialog(spec)
    const original = field.value
    type(field, 'טקסט שהוקלד')
    type(field, original)
    escape()
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(askedToClose()).toBeNull()
  })

  it('closes at once with its own button, even with something typed: pressing it is the decision', async () => {
    const { dialog, field } = await openDialog(spec)
    type(field, 'טקסט שהוקלד')
    fireEvent.click(within(dialog).getByRole('button', { name: spec.cancel }))
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(askedToClose()).toBeNull()
    expect(writes()).toEqual([])
  })
})

describe('a dialog that was saved', () => {
  it('a new provider closes without a question once it is saved, and shows the password', async () => {
    const { dialog, field } = await openDialog(DIALOGS.find((d) => d.name === 'a new provider'))
    type(field, 'גינון')
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }))

    expect(await screen.findByRole('dialog', { name: 'הסיסמה נשמרה' }, WAIT)).toBeTruthy()
    expect(dialog.isConnected).toBe(false)
    expect(askedToClose()).toBeNull()
    expect(writes().map(([path, options]) => [options.method, path])).toEqual([['POST', '/admin/providers']])
  })

  it('a new point closes without a question once it is saved', async () => {
    const { dialog, field } = await openDialog(DIALOGS.find((d) => d.name === 'a new point'))
    type(field, 'חדר מדרגות')
    fireEvent.click(within(dialog).getByRole('button', { name: 'סימון במפה' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(dialog.isConnected).toBe(false), WAIT)
    expect(askedToClose()).toBeNull()
    expect(writes().map(([path, options]) => [options.method, path])).toEqual([['POST', '/admin/points']])
  })
})

describe('a dialog that only shows something', () => {
  it('closes at once with Esc, with no question', async () => {
    window.history.replaceState(null, '', '/#points')
    render(<AdminApp />)
    fireEvent.click(within((await screen.findByRole('heading', { name: 'לובי', level: 2 }, WAIT)).closest('article')).getByRole('button', { name: 'QR והדפסה' }))
    const dialog = await screen.findByRole('dialog', { name: 'QR: לובי' }, WAIT)
    escape()
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(askedToClose()).toBeNull()
  })
})
