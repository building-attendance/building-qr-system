// @vitest-environment jsdom
// The map of the point form (Leaflet) is a file of its own, downloaded the first time the form opens
// (src/admin/views/PointsView.jsx), so that the committee app's own file does not carry it to every screen.
// Design rule S1 (docs/design.md): while the map downloads, the app's loading look stands in the map's place; when the download
// fails, that place says so, the form keeps everything that was typed and can still be saved, and the next step is to refresh the
// page (a browser keeps the failure of a module's download for as long as the page is open), which asks first when something
// typed would be lost (F4). The network (`api`) is answered by the test, the download is a promise that the test settles when it
// wants (the map itself is a stub: Leaflet needs a real layout), and the reload of the page is counted instead of made.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { api } from '../../src/api/client.js'
import { choose } from './tile-menu.js'
import { reloadApp } from '../../src/ui/crash.js'

// What the download does when it is asked for: the test sets it before the screen asks.
const download = vi.hoisted(() => ({ map: vi.fn() }))

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
vi.mock('../../src/ui/crash.js', async (importOriginal) => ({ ...(await importOriginal()), reloadApp: vi.fn() }))
vi.mock('../../src/admin/MapPicker.jsx', async () => {
  await download.map()
  return {
    default: ({ hint }) => (
      <div>
        <div role="application" aria-label="מפה לסימון מיקום הנקודה" />
        <p>{hint}</p>
      </div>
    ),
  }
})

const WAIT = { timeout: 4000 }
const MAP = { name: 'מפה לסימון מיקום הנקודה' }
const MAP_FAILED = 'לא הצלחנו לטעון את המפה. אפשר להקליד את קו הרוחב וקו האורך, או לרענן את הדף.'
const HINT = 'לחצו על המפה כדי לסמן איפה הנקודה. העיגול הוא הרדיוס שבו נחשבת נוכחות.'
const REFRESH = { name: 'רענון הדף' }

/** Lets the promises that are already settled run their callbacks. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

/** A promise that the test settles when it wants: a download that is still on its way. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const lobby = {
  id: 'p-lobby', name: 'לובי', description: null, is_active: true, gps_mode: 'required', lat: 32.0853, lng: 34.7818,
  radius_m: 40, service_type: null, scan_count: 0, provider_ids: [], qr_url: 'https://example.test/scan?code=x',
}

/**
 * The Points screen of a new page load: the modules are loaded afresh, so the map has not been downloaded yet (a page keeps a
 * download, and its failure, for as long as it is open, and so does the lazy map of PointsView).
 */
async function show() {
  vi.resetModules()
  const { default: PointsView } = await import('../../src/admin/views/PointsView.jsx')
  const { ToastProvider, ConfirmProvider } = await import('../../src/admin/ui.jsx')
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/admin/points' && !options.method) return { points: [lobby] }
    if (path === '/admin/providers') return { providers: [] }
    throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
  })
  render(<ToastProvider><ConfirmProvider><PointsView /></ConfirmProvider></ToastProvider>)
  await screen.findByText(lobby.name, {}, WAIT)
}
const lobbyTile = () => screen.getByRole('heading', { name: 'לובי', level: 2 }).closest('article')
const openNewPoint = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'נקודה חדשה' })[0])
  return within(screen.getByRole('dialog', { name: 'נקודה חדשה' }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// A page keeps a download that worked (here: the mock keeps a module that loaded), so the failure is tried first.
describe('the map of the point form', () => {
  it('puts the error in its place when the download fails, keeps the form, and refreshes the page, asking first when something was typed', async () => {
    const map = deferred()
    download.map.mockImplementationOnce(() => map.promise)
    await show()
    const form = openNewPoint()
    expect(form.getByRole('status')).toBeTruthy()

    map.reject(new TypeError('Failed to fetch dynamically imported module'))
    const alert = await form.findByRole('alert', {}, WAIT)
    expect(alert.textContent).toContain(MAP_FAILED)
    expect(form.queryByRole('status')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'נקודה חדשה' }), 'the form is still open: the failure did not reach the crash screen').toBeTruthy()

    // nothing typed yet: the refresh happens at once
    fireEvent.click(within(alert).getByRole('button', REFRESH))
    expect(reloadApp).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'לרענן בלי לשמור?' })).toBeNull()

    // the form still works without the map, and what is typed is kept
    fireEvent.change(form.getByLabelText('שם הנקודה'), { target: { value: 'חדר מדרגות' } })
    fireEvent.change(form.getByLabelText('קו רוחב'), { target: { value: '32.08' } })
    fireEvent.change(form.getByLabelText('קו אורך'), { target: { value: '34.78' } })

    // with something typed, the refresh asks first; "back to editing" leaves everything as it was
    fireEvent.click(within(form.getByRole('alert')).getByRole('button', REFRESH))
    const question = await screen.findByRole('dialog', { name: 'לרענן בלי לשמור?' }, WAIT)
    fireEvent.click(within(question).getByRole('button', { name: 'חזרה לעריכה' }))
    await settled() // the answer comes back as a promise: give a wrong reload its chance to happen
    expect(screen.queryByRole('dialog', { name: 'לרענן בלי לשמור?' })).toBeNull()
    expect(reloadApp).toHaveBeenCalledTimes(1)
    expect(form.getByLabelText('שם הנקודה').value).toBe('חדר מדרגות')
    expect(form.getByLabelText('קו רוחב').value).toBe('32.08')

    // and "refresh without saving" refreshes
    fireEvent.click(within(form.getByRole('alert')).getByRole('button', REFRESH))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'לרענן בלי לשמור?' }, WAIT)).getByRole('button', { name: 'רענון בלי לשמור' }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(2), WAIT) // after the answer, which comes back as a promise
    await settled()
    expect(reloadApp).toHaveBeenCalledTimes(2)
  })

  it('shows the loading look in its place while it downloads, then the map; the next form shows it at once', async () => {
    const map = deferred()
    download.map.mockImplementationOnce(() => map.promise)
    await show()
    const form = openNewPoint()

    // the loading look, with its words for a screen reader, and the hint under it; the form works already
    expect(form.getByRole('status').textContent).toBe('טוען את המפה…')
    expect(form.getByText(HINT)).toBeTruthy()
    expect(form.queryByRole('application', MAP)).toBeNull()
    fireEvent.change(form.getByLabelText('שם הנקודה'), { target: { value: 'חדר מדרגות' } })

    map.resolve()
    expect(await form.findByRole('application', MAP, WAIT)).toBeTruthy()
    expect(form.queryByRole('status')).toBeNull()
    expect(form.getByLabelText('שם הנקודה').value).toBe('חדר מדרגות')

    // once it is here, another form shows the map at once, with no second download
    fireEvent.click(form.getByRole('button', { name: 'ביטול' }))
    choose(lobbyTile(), 'עריכה')
    const edit = within(screen.getByRole('dialog', { name: 'עריכת נקודה: לובי' }))
    expect(edit.getByRole('application', MAP)).toBeTruthy()
    expect(edit.queryByRole('status')).toBeNull()
    expect(download.map).toHaveBeenCalledTimes(1)
  })
})
