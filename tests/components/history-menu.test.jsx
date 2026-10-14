// @vitest-environment jsdom
// The rows of the committee's History tab: each shows its time, its text and one "more" button, and every action on the visit is in the
// menu of that button, in the order of the rule (AGENTS.md, "Rules for every change"): cancel or restore, then a separator and the red
// delete. The real HistoryView, with the network (`api`) answered by the test. The menu itself is tested on its own (Menu.test.jsx); this
// is what the History puts in it, how the button is named, and that every action still does what it did as an icon.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, OUTCOME_REJECTED_FAR, SOURCE_ONLINE } from '../../shared/contract.js'
import { choose, menuLabels, moreButton, openMenu, shownButtons } from './tile-menu.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }
const PROVIDER = { id: '33333333-3333-4333-8333-333333333333', company: 'ניקיון', contact_name: 'פלוני' }
const WAIT = { timeout: 4000 }

const base = {
  local_date: '2026-10-05', point_id: POINT.id, point_name: POINT.name, provider_id: PROVIDER.id, outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
  distance_m: null, gps_accuracy_m: null, flags: [], voided: false, void_reason: null,
}
const accepted = { ...base, id: 's1', checked_in_at: '2026-10-05T06:00:00Z', provider_name: 'נותן ראשון' }
const second = { ...base, id: 's2', checked_in_at: '2026-10-05T07:30:00Z', provider_name: 'נותן שני' }
const cancelled = { ...base, id: 's3', checked_in_at: '2026-10-05T08:00:00Z', provider_name: 'נותן שלישי', voided: true, void_reason: 'נסרק בטעות' }
const refused = { ...base, id: 's4', checked_in_at: '2026-10-05T09:00:00Z', provider_name: 'נותן רביעי', outcome: OUTCOME_REJECTED_FAR, distance_m: 5500 }

/** What the server answers: the list of scans, and what the actions send back (the scan as it is after the action). */
function server(scans) {
  api.mockImplementation(async (path, opts = {}) => {
    if (path === '/admin/points') return { points: [POINT] }
    if (path === '/admin/providers') return { providers: [PROVIDER] }
    if (path.startsWith('/admin/scans?')) return { scans, next_cursor: null }
    const hit = path.match(/^\/admin\/scans\/([^/]+)(\/void|\/unvoid)?$/)
    if (hit && opts.method === 'POST' && hit[2] === '/void') return { scan: { ...scans.find((s) => s.id === hit[1]), voided: true, void_reason: opts.body.reason || null } }
    if (hit && opts.method === 'POST' && hit[2] === '/unvoid') return { scan: { ...scans.find((s) => s.id === hit[1]), voided: false, void_reason: null } }
    if (hit && opts.method === 'DELETE') return { ok: true }
    throw new Error(`the test does not expect ${opts.method ?? 'GET'} ${path}`)
  })
}
const calls = (method, path) => api.mock.calls.filter(([p, o]) => (o?.method ?? 'GET') === method && p === path)

async function show(scans) {
  server(scans)
  render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
  await screen.findByText(scans[0].provider_name, {}, WAIT)
}
const rowOf = (text) => screen.getByText(text).closest('li')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('a row of the History', () => {
  it('shows its "more" button and nothing else, named after the visit, so that the rows can be told apart', async () => {
    await show([accepted, second])
    const names = ['נותן ראשון', 'נותן שני'].map((who) => shownButtons(rowOf(who)))
    expect(names.map((list) => list.length), 'one button on a row').toEqual([1, 1])
    // the place, the person and the day and time that the visit has (the building's time, DD/MM/YYYY HH:MM)
    expect(names[0]).toEqual(['עוד פעולות לביקור: לובי · נותן ראשון · 05/10/2026 09:00'])
    expect(names[1]).toEqual(['עוד פעולות לביקור: לובי · נותן שני · 05/10/2026 10:30'])
    expect(moreButton(rowOf('נותן ראשון')).getAttribute('aria-haspopup')).toBe('menu')
  })

  it('has cancelling, then the red delete, in the menu of a visit that was recorded', async () => {
    await show([accepted])
    const row = rowOf('נותן ראשון')
    expect(menuLabels(row)).toEqual(['ביטול הנוכחות', 'מחיקת הנוכחות לצמיתות'])
    const items = within(row).getAllByRole('menuitem')
    expect(items.at(-1).className, 'the delete is the red one').toContain('a-menu__item--danger')
    expect(items.slice(0, -1).filter((item) => item.className.includes('danger'))).toEqual([])
    expect(within(row).getAllByRole('separator'), 'a separator before the delete').toHaveLength(1)
  })

  it('has restoring in place of cancelling when the visit was cancelled', async () => {
    await show([cancelled])
    expect(menuLabels(rowOf('נותן שלישי'))).toEqual(['שחזור הנוכחות', 'מחיקת הנוכחות לצמיתות'])
  })

  it('has the delete alone, with no separator, when the attempt was refused as too far (it was never a visit)', async () => {
    await show([refused])
    const row = rowOf('נותן רביעי')
    expect(menuLabels(row)).toEqual(['מחיקת הנוכחות לצמיתות'])
    expect(within(row).queryAllByRole('separator')).toHaveLength(0)
  })

  it('opens the dialog of cancelling from its menu, sends the reason, and the row goes (the list shows the visits that count)', async () => {
    await show([accepted, second])
    choose(rowOf('נותן ראשון'), 'ביטול הנוכחות')
    const dialog = await screen.findByRole('dialog', { name: 'ביטול נוכחות' })
    fireEvent.change(within(dialog).getByLabelText('סיבה (לא חובה)'), { target: { value: 'נסרק בטעות' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'ביטול הנוכחות' }))
    await waitFor(() => expect(calls('POST', '/admin/scans/s1/void')).toHaveLength(1), WAIT)
    expect(calls('POST', '/admin/scans/s1/void')[0][1].body).toEqual({ reason: 'נסרק בטעות' })
    await waitFor(() => expect(screen.queryByText('נותן ראשון')).toBeNull(), WAIT)
    expect(screen.getByText('נותן שני'), 'the other row is where it was').toBeTruthy()
  })

  it('restores a cancelled visit from its menu, and the row has cancelling in its menu again', async () => {
    await show([cancelled])
    // a cancelled visit is listed only when the filter says so (the list of the server is answered by the test either way)
    fireEvent.click(screen.getByLabelText('כולל מבוטלות'))
    await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith('/admin/scans?') && path.includes('include_voided=true'))).toBe(true), WAIT)
    const row = await waitFor(() => rowOf('נותן שלישי'), WAIT)
    choose(row, 'שחזור הנוכחות')
    await waitFor(() => expect(calls('POST', '/admin/scans/s3/unvoid')).toHaveLength(1), WAIT)
    expect(calls('POST', '/admin/scans/s3/unvoid')[0][1].body).toEqual({})
    await waitFor(() => expect(rowOf('נותן שלישי').className).not.toContain('is-void'), WAIT)
    expect(menuLabels(rowOf('נותן שלישי'))).toEqual(['ביטול הנוכחות', 'מחיקת הנוכחות לצמיתות'])
  })

  it('asks before deleting for good, names the visit, and deletes only when the answer is yes', async () => {
    await show([accepted, second])
    const row = rowOf('נותן ראשון')
    choose(row, 'מחיקת הנוכחות לצמיתות')
    let question = await screen.findByRole('dialog', { name: 'למחוק את הנוכחות לצמיתות?' })
    expect(question.textContent).toContain('לובי · נותן ראשון · 05/10/2026 09:00')
    expect(question.textContent).toContain('אפשר לבטל אותה במקום')
    fireEvent.click(within(question).getByRole('button', { name: 'ביטול' })) // "no" changes nothing
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('DELETE', '/admin/scans/s1')).toHaveLength(0)
    expect(screen.getByText('נותן ראשון')).toBeTruthy()

    openMenu(row)
    fireEvent.click(within(row).getByRole('menuitem', { name: 'מחיקת הנוכחות לצמיתות' }))
    question = await screen.findByRole('dialog', { name: 'למחוק את הנוכחות לצמיתות?' })
    fireEvent.click(within(question).getByRole('button', { name: 'מחיקה', exact: true }))
    await waitFor(() => expect(calls('DELETE', '/admin/scans/s1')).toHaveLength(1), WAIT)
    await waitFor(() => expect(screen.queryByText('נותן ראשון')).toBeNull(), WAIT)
    expect(screen.getByText('נותן שני')).toBeTruthy()
  })
})
