// @vitest-environment jsdom
// The History screen is the first screen of the committee app, and a new installation has no points: its empty list must tell the person
// to start by adding points (with a button to the Points screen), not to widen the dates. The real HistoryView, with the network (`api`)
// answered by the test. HistoryView loads the points for its filter already, so the message needs no request of its own.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }
const scan = {
  id: 's1', local_date: '2026-10-05', checked_in_at: '2026-10-05T06:00:00Z', point_id: POINT.id, point_name: POINT.name,
  provider_id: 'p1', provider_name: 'נותן סריקה', outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
  distance_m: null, flags: [], voided: false, void_reason: null,
}

const NO_POINTS = 'עוד אין נקודות'
const NO_VISITS = 'אין נוכחויות בטווח הזה'
const NO_REFUSALS = 'אין ביקורים שלא נקלטו בטווח הזה'

/** What the server answers. `points` is a list, or a function that throws or waits; `scans` the visits of the range. */
function server({ points = [], scans = [] } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/admin/points') return typeof points === 'function' ? points() : { points }
    if (path === '/admin/providers') return { providers: [] }
    if (path.startsWith('/admin/scans')) return { scans, next_cursor: null }
    if (path.startsWith('/admin/scan-refusals')) return { refusals: [], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}
const show = () => render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
const WAIT = { timeout: 4000 }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('the empty History of a building that has no points', () => {
  it('says to start by adding points, and does not say to widen the dates', async () => {
    server({ points: [] })
    show()
    expect(await screen.findByRole('heading', { level: 2, name: NO_POINTS }, WAIT)).toBeTruthy()
    expect(screen.getByText(/מתחילים בהוספת נקודה/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_VISITS })).toBeNull()
    expect(screen.queryByText('נסו להרחיב את טווח התאריכים או לשנות את הסינון.')).toBeNull()
  })

  it('has a button that opens the Points screen (the address changes to #points)', async () => {
    server({ points: [] })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'מעבר לנקודות' }, WAIT))
    expect(window.location.hash).toBe('#points')
  })

  it('asks for nothing that the screen did not ask for already: the points are the filter\'s own request', async () => {
    server({ points: [] })
    show()
    await screen.findByRole('heading', { name: NO_POINTS }, WAIT)
    expect(api.mock.calls.map(([path]) => path).filter((path) => path === '/admin/points')).toHaveLength(1)
  })

  it('waits for the points before it says anything, so the wrong message never shows for a moment', async () => {
    let release
    server({ points: () => new Promise((resolve) => { release = () => resolve({ points: [] }) }) })
    show()
    await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/admin/scans'))).toBe(true))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) }) // the visits have answered, the points have not
    expect(screen.queryByRole('heading', { name: NO_VISITS })).toBeNull()
    expect(screen.queryByRole('heading', { name: NO_POINTS })).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy() // the spinner
    await act(async () => { release() })
    expect(await screen.findByRole('heading', { name: NO_POINTS }, WAIT)).toBeTruthy()
  })
})

describe('the empty History of a building that has points', () => {
  it('says what it always said: widen the dates', async () => {
    server({ points: [POINT] })
    show()
    expect(await screen.findByRole('heading', { level: 2, name: NO_VISITS }, WAIT)).toBeTruthy()
    expect(screen.getByText('נסו להרחיב את טווח התאריכים או לשנות את הסינון.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_POINTS })).toBeNull()
    expect(screen.queryByRole('button', { name: 'מעבר לנקודות' })).toBeNull()
  })

  it('says it too when the points could not be loaded: it does not know that there are none', async () => {
    server({ points: () => { throw Object.assign(new Error('x'), { status: 500, code: 'server_error' }) } })
    show()
    expect(await screen.findByRole('heading', { level: 2, name: NO_VISITS }, WAIT)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_POINTS })).toBeNull()
  })

  it('lists the visits that are there, whatever the points say (a deleted point keeps its history)', async () => {
    server({ points: [], scans: [scan] })
    show()
    expect(await screen.findByText('נותן סריקה', {}, WAIT)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_POINTS })).toBeNull()
  })
})

describe('the list of visits that were not counted', () => {
  it('keeps its own empty message in a building with no points: the person asked for that list', async () => {
    server({ points: [] })
    show()
    await screen.findByRole('heading', { name: NO_POINTS }, WAIT)
    fireEvent.change(screen.getByLabelText('סוג'), { target: { value: screen.getByRole('option', { name: 'לא נקלטו' }).getAttribute('value') } })
    expect(await screen.findByRole('heading', { level: 2, name: NO_REFUSALS }, WAIT)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_POINTS })).toBeNull()
  })
})
