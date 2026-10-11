// @vitest-environment jsdom
// Design rule F4 (docs/design.md): typed input is never lost. A dialog of the committee app that holds something the person typed
// does not close on Esc or on a tap outside it without asking first; a dialog that holds nothing new closes at once, and the close
// button and the dialog's own Cancel button, which are chosen on purpose, never ask. First the dialog itself (`Modal` with `dirty`,
// and what `useDirty` counts as a change), then every real form of the committee app that has one: the point, the provider, the
// provider's new password, the agent key, the committee member and the cancelling of a visit, with the network (`api`) answered by
// the test and the map (Leaflet, which needs a real layout) replaced by a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Modal, useDirty, ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import PointsView from '../../src/admin/views/PointsView.jsx'
import ProvidersView from '../../src/admin/views/ProvidersView.jsx'
import AgentView from '../../src/admin/views/AgentView.jsx'
import CommitteeView from '../../src/admin/views/CommitteeView.jsx'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import { clearLoadCache } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
vi.mock('../../src/admin/MapPicker.jsx', () => ({
  default: ({ onPick }) => <button type="button" onClick={() => onPick({ lat: 32.0853, lng: 34.7818 })}>סימון במפה</button>,
}))

const WAIT = { timeout: 4000 }
const QUESTION = 'לסגור בלי לשמור?'
const KEEP = 'חזרה לעריכה'
const DISCARD = 'סגירה בלי לשמור'

const esc = () => fireEvent.keyDown(document, { key: 'Escape' })
/** A tap outside: the dialog sits inside its overlay, which is what covers the page. */
const tapOutside = (dialog) => fireEvent.mouseDown(dialog.parentElement)
const dialogNamed = (name) => screen.getByRole('dialog', { name })
const noDialog = (name) => expect(screen.queryByRole('dialog', { name })).toBeNull()
const type = (scope, label, value) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

beforeEach(() => {
  clearLoadCache() // every test stands for a new page load: the screens keep their last answer in memory otherwise
  document.body.style.overflow = ''
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/* ------------------------------------------------------------- the dialog */

/** A dialog with one field, the way a form uses it. `onClose` is what the screen does to close it. */
function Harness({ onClose, start = '' }) {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState(start)
  const dirty = useDirty(text)
  const close = () => { setOpen(false); onClose() }
  if (!open) return <p>closed</p>
  return (
    <Modal title="טופס" onClose={close} dirty={dirty} footer={<button type="button" onClick={close}>ביטול</button>}>
      <label>שם<input value={text} onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  )
}

describe('a dialog with nothing typed in it', () => {
  it('closes at once on Esc', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    noDialog('לסגור בלי לשמור?')
  })

  it('closes at once on a tap outside, and stays open on a tap inside', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'טופס' }))
    expect(onClose).not.toHaveBeenCalled()
    tapOutside(dialogNamed('טופס'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('a dialog with something typed in it', () => {
  it('asks on Esc, and keeps the dialog and the text while it asks', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
    esc()

    expect(dialogNamed(QUESTION)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialogNamed('טופס')).getByLabelText('שם').value).toBe('חדר אשפה')
  })

  it('asks on a tap outside', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
    tapOutside(dialogNamed('טופס'))

    expect(dialogNamed(QUESTION)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('puts the person back in the field, with the text as it was, on "back to editing"', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const field = within(dialogNamed('טופס')).getByLabelText('שם')
    field.focus()
    fireEvent.change(field, { target: { value: 'חדר אשפה' } })
    esc()
    fireEvent.click(within(dialogNamed(QUESTION)).getByRole('button', { name: KEEP }))

    noDialog(QUESTION)
    expect(onClose).not.toHaveBeenCalled()
    expect(field.value).toBe('חדר אשפה')
    expect(document.activeElement).toBe(field)
  })

  it('keeps editing when the question itself is closed with Esc, a tap outside or its close button', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')

    esc()
    esc() // the second Esc answers the question; it does not reach the dialog under it
    noDialog(QUESTION)
    expect(dialogNamed('טופס')).toBeTruthy()

    esc()
    tapOutside(dialogNamed(QUESTION))
    noDialog(QUESTION)
    expect(dialogNamed('טופס')).toBeTruthy()

    esc()
    fireEvent.click(within(dialogNamed(QUESTION)).getByRole('button', { name: 'סגירה' }))
    noDialog(QUESTION)
    expect(dialogNamed('טופס')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes, once, on "close without saving", and gives the page its scroll back', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    expect(document.body.style.overflow).toBe('hidden')
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
    esc()
    fireEvent.click(within(dialogNamed(QUESTION)).getByRole('button', { name: DISCARD }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('puts the safe answer first: the question opens on "back to editing"', () => {
    render(<Harness onClose={vi.fn()} />)
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
    esc()
    expect(document.activeElement).toBe(within(dialogNamed(QUESTION)).getByRole('button', { name: KEEP }))
  })

  it('does not ask when the close button or the dialog\'s own Cancel is pressed: those are chosen on purpose', () => {
    for (const name of ['סגירה', 'ביטול']) {
      const onClose = vi.fn()
      render(<Harness onClose={onClose} />)
      type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
      fireEvent.click(within(dialogNamed('טופס')).getByRole('button', { name }))
      expect(onClose, name).toHaveBeenCalledTimes(1)
      noDialog(QUESTION)
      cleanup()
    }
  })

  it('counts a field that is changed and changed back as nothing typed', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} start="חדר אשפה" />)
    type(dialogNamed('טופס'), 'שם', 'חדר')
    type(dialogNamed('טופס'), 'שם', 'חדר אשפה')
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not count what the form started with as typed', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} start="חדר אשפה" />)
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------ the forms */

/** The calls that wrote something (POST, PATCH, DELETE), as `[path, options]`. */
const writes = () => api.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')

/** What a form must do, whichever form it is: ask on Esc and on a tap outside, lose nothing, write nothing, and leave on request. */
function expectItAsksBeforeLosingWhatWasTyped(name, field, typed) {
  const form = dialogNamed(name)
  expect(within(form).getByLabelText(field).value, 'the form is not touched yet').not.toBe(typed)
  type(form, field, typed)

  esc()
  expect(dialogNamed(QUESTION), 'Esc asks').toBeTruthy()
  fireEvent.click(within(dialogNamed(QUESTION)).getByRole('button', { name: KEEP }))
  noDialog(QUESTION)
  expect(within(dialogNamed(name)).getByLabelText(field).value, 'the text is still there').toBe(typed)

  tapOutside(dialogNamed(name))
  expect(dialogNamed(QUESTION), 'a tap outside asks').toBeTruthy()
  fireEvent.click(within(dialogNamed(QUESTION)).getByRole('button', { name: DISCARD }))
  noDialog(name)
  expect(writes(), 'nothing was sent').toEqual([])
}

describe('the point form', () => {
  const point = {
    id: 'p-lobby', name: 'לובי', description: null, is_active: true, gps_mode: 'required', lat: 32.0853, lng: 34.7818,
    radius_m: 40, service_type: null, scan_count: 0, provider_ids: [], qr_url: 'https://example.test/scan?code=x',
  }
  async function show(points = [], { failSave = false } = {}) {
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/admin/points' && !options.method) return { points }
      if (path === '/admin/providers') return { providers: [] }
      if (path === '/admin/points' && options.method === 'POST') {
        if (failSave) throw Object.assign(new Error('boom'), { status: 500, code: 'server_error' })
        return { point: { ...point, ...options.body, id: 'p-new' } }
      }
      throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><PointsView /></ConfirmProvider></ToastProvider>)
    await screen.findByRole('heading', { name: 'נקודות סריקה' })
    if (points.length) await screen.findByText(points[0].name, {}, WAIT)
  }

  it('asks before a new point that was started is lost', async () => {
    await show()
    fireEvent.click(screen.getAllByRole('button', { name: 'נקודה חדשה' })[0])
    expectItAsksBeforeLosingWhatWasTyped('נקודה חדשה', 'שם הנקודה', 'חדר אשפה')
  })

  it('asks before the change to a point is lost, and not when nothing was changed', async () => {
    await show([point])
    const edit = () => fireEvent.click(within(screen.getByRole('heading', { name: 'לובי', level: 2 }).closest('article')).getByRole('button', { name: 'עריכה' }))
    edit()
    esc()
    noDialog('עריכת נקודה: לובי')
    expect(screen.queryByRole('dialog')).toBeNull() // untouched: closed at once, no question

    edit()
    expectItAsksBeforeLosingWhatWasTyped('עריכת נקודה: לובי', 'רדיוס (מטרים)', '75')
  })

  it('counts a pin put on the map and the providers chosen as typed too', async () => {
    await show()
    fireEvent.click(screen.getAllByRole('button', { name: 'נקודה חדשה' })[0])
    fireEvent.click(within(dialogNamed('נקודה חדשה')).getByRole('button', { name: 'סימון במפה' }))
    esc()
    expect(dialogNamed(QUESTION)).toBeTruthy()
  })

  it('keeps everything as it was typed when the save fails, and closes without asking when it succeeds', async () => {
    await show([], { failSave: true })
    fireEvent.click(screen.getAllByRole('button', { name: 'נקודה חדשה' })[0])
    const form = () => dialogNamed('נקודה חדשה')
    type(form(), 'שם הנקודה', 'חדר אשפה')
    fireEvent.click(within(form()).getByRole('button', { name: 'סימון במפה' }))
    fireEvent.click(within(form()).getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(writes()).toHaveLength(1), WAIT)
    await within(form()).findByRole('button', { name: 'שמירה' }) // the busy label is gone: the failed save has finished
    expect(within(form()).getByLabelText('שם הנקודה').value).toBe('חדר אשפה')
    expect(within(form()).getByLabelText('קו רוחב').value).toBe('32.0853')

    // (a server that works: the same form saves and goes, with no question about what it held)
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/admin/points' && options.method === 'POST') return { point: { ...point, ...options.body, id: 'p-new' } }
      if (path === '/admin/points') return { points: [] }
      if (path === '/admin/providers') return { providers: [] }
      throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
    })
    fireEvent.click(within(form()).getByRole('button', { name: 'שמירה' }))
    await waitFor(() => noDialog('נקודה חדשה'), WAIT)
    noDialog(QUESTION)
  })
})

describe('the provider forms', () => {
  const provider = {
    id: '00000000-0000-4000-8000-000000000001', company: 'ניקיון', contact_name: 'פלוני', service_type: 'cleaning',
    is_active: true, is_demo: false, created_at: '2026-09-01T08:00:00.000Z', has_password: true, active_devices: 0, last_scan_at: null,
    scan_count: 0, waiting: 0, oldest_waiting_at: null, outdated_devices: 0,
  }
  async function show() {
    api.mockImplementation(async (path, options = {}) => {
      if (path === '/admin/providers' && !options.method) return { providers: [provider] }
      throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><ProvidersView /></ConfirmProvider></ToastProvider>)
    await screen.findByRole('heading', { name: 'פלוני', level: 2 }, WAIT)
  }
  const card = () => within(screen.getByRole('heading', { name: 'פלוני', level: 2 }).closest('article'))

  it('asks before a new provider that was started is lost, and not for the password that the form made up', async () => {
    await show()
    fireEvent.click(screen.getAllByRole('button', { name: 'נותן שירות חדש' })[0])
    esc()
    expect(screen.queryByRole('dialog'), 'untouched: closed at once').toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'נותן שירות חדש' })[0])
    expectItAsksBeforeLosingWhatWasTyped('נותן שירות חדש', 'חברה', 'ניקיון אלון')
  })

  it('asks before the change to a provider is lost', async () => {
    await show()
    fireEvent.click(card().getByRole('button', { name: 'עריכה' }))
    expectItAsksBeforeLosingWhatWasTyped('עריכה: פלוני', 'שם העובד', 'דנה')
  })

  it('asks before a password that was changed is lost, and not for the one that was made up', async () => {
    await show()
    fireEvent.click(card().getByRole('button', { name: 'סיסמה חדשה' }))
    esc()
    expect(screen.queryByRole('dialog'), 'untouched: closed at once').toBeNull()

    fireEvent.click(card().getByRole('button', { name: 'סיסמה חדשה' }))
    expectItAsksBeforeLosingWhatWasTyped('סיסמה חדשה: פלוני', 'סיסמה', 'sample-password-1')
  })
})

describe('the agent key form', () => {
  it('asks before a name that was typed is lost', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/admin/api-keys') return { api_keys: [] }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><AgentView /></ConfirmProvider></ToastProvider>)
    fireEvent.click((await screen.findAllByRole('button', { name: 'מפתח חדש' }, WAIT))[0])
    esc()
    expect(screen.queryByRole('dialog'), 'untouched: closed at once').toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'מפתח חדש' })[0])
    expectItAsksBeforeLosingWhatWasTyped('מפתח גישה חדש', 'שם המפתח', 'הסוכן של הוועד')
  })
})

describe('the committee member form', () => {
  it('asks before an address that was typed is lost', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/admin/admins') return { admins: [] }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><CommitteeView admin={{ id: 'a1', name: 'Dana', email: 'dana@example.test' }} /></ConfirmProvider></ToastProvider>)
    fireEvent.click((await screen.findAllByRole('button', { name: 'חבר ועד חדש' }, WAIT))[0])
    esc()
    expect(screen.queryByRole('dialog'), 'untouched: closed at once').toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'חבר ועד חדש' })[0])
    expectItAsksBeforeLosingWhatWasTyped('חבר ועד חדש', 'כתובת Gmail', 'member@example.test')
  })
})

describe('the form that cancels a visit', () => {
  it('asks before a reason that was typed is lost', async () => {
    const scan = {
      id: 's1', local_date: '2026-10-05', checked_in_at: '2026-10-05T06:00:00Z', point_id: 'pt1', point_name: 'לובי',
      provider_id: 'pr1', provider_name: 'נותן סריקה', outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
      distance_m: 58, gps_accuracy_m: 35, flags: [], voided: false, void_reason: null,
    }
    api.mockImplementation(async (path) => {
      if (path === '/admin/points') return { points: [{ id: 'pt1', name: 'לובי' }] }
      if (path === '/admin/providers') return { providers: [{ id: 'pr1', company: 'ניקיון', contact_name: 'פלוני' }] }
      if (path.startsWith('/admin/scans')) return { scans: [scan], next_cursor: null }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
    await screen.findByText('נותן סריקה', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'ביטול הנוכחות' }))
    esc()
    expect(screen.queryByRole('dialog'), 'untouched: closed at once').toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'ביטול הנוכחות' }))
    expectItAsksBeforeLosingWhatWasTyped('ביטול נוכחות', 'סיבה (לא חובה)', 'נסרק בטעות')
  })
})
