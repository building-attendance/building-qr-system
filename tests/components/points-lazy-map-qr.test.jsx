// @vitest-environment jsdom
// The map of the point form (Leaflet) and the QR library are files of their own, downloaded the first time they are used
// (src/admin/views/PointsView.jsx, src/admin/qr.js), so that the committee app's own file does not carry them to every screen.
// Design rule S1 (docs/design.md): while the map downloads, the app's loading look stands in the map's place; when the download
// fails, that place says so and offers "try again", and the form keeps everything that was typed. The QR image of a point does the
// same in its dialog. The network (`api`) is answered by the test, and each of the two downloads is a promise that the test
// settles when it wants (the map itself is a stub: Leaflet needs a real layout).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import PointsView from '../../src/admin/views/PointsView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { api } from '../../src/api/client.js'

// What each download does when it is asked for: the test sets it before the screen asks.
const download = vi.hoisted(() => ({ map: vi.fn(), qr: vi.fn() }))

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
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
vi.mock('qrcode', async () => {
  await download.qr()
  return { default: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' } }
})

const WAIT = { timeout: 4000 }
const MAP = { name: 'מפה לסימון מיקום הנקודה' }
const MAP_FAILED = 'לא הצלחנו לטעון את המפה. נסו שוב, או הקלידו את קו הרוחב וקו האורך.'
const HINT = 'לחצו על המפה כדי לסמן איפה הנקודה. העיגול הוא הרדיוס שבו נחשבת נוכחות.'
const QR_FAILED = 'לא הצלחנו ליצור את קוד ה-QR.'

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

async function show() {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/admin/points' && !options.method) return { points: [lobby] }
    if (path === '/admin/providers') return { providers: [] }
    throw new Error(`the test does not expect ${options.method ?? 'GET'} ${path}`)
  })
  render(<ToastProvider><ConfirmProvider><PointsView /></ConfirmProvider></ToastProvider>)
  await screen.findByText(lobby.name, {}, WAIT)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// One test for each download: once a download has worked, the page keeps it (the browser keeps the module), as it does here.
describe('the map of the point form', () => {
  it('shows the loading look in its place, then the error with "try again" when the download fails, keeps the form, and loads on the retry', async () => {
    const first = deferred()
    download.map.mockImplementationOnce(() => first.promise)
    await show()
    fireEvent.click(screen.getAllByRole('button', { name: 'נקודה חדשה' })[0])
    const form = within(screen.getByRole('dialog', { name: 'נקודה חדשה' }))

    // While the map downloads: the loading look, with its words for a screen reader, and the hint under it; the form already works.
    expect(form.getByRole('status').textContent).toBe('טוען את המפה…')
    expect(form.getByText(HINT)).toBeTruthy()
    expect(form.queryByRole('application', MAP)).toBeNull()
    fireEvent.change(form.getByLabelText('שם הנקודה'), { target: { value: 'חדר מדרגות' } })
    fireEvent.change(form.getByLabelText('קו רוחב'), { target: { value: '32.08' } })

    // The download fails: its place says so and offers "try again"; nothing that was typed is lost, and the dialog is still open.
    first.reject(new TypeError('Failed to fetch dynamically imported module'))
    const alert = await form.findByRole('alert', {}, WAIT)
    expect(alert.textContent).toContain(MAP_FAILED)
    expect(form.queryByRole('status')).toBeNull()
    expect(form.getByLabelText('שם הנקודה').value).toBe('חדר מדרגות')
    expect(form.getByLabelText('קו רוחב').value).toBe('32.08')

    // "Try again" downloads it again: the loading look while it comes, then the map, and still the same form.
    const second = deferred()
    download.map.mockImplementationOnce(() => second.promise)
    fireEvent.click(within(alert).getByRole('button', { name: 'נסו שוב' }))
    expect(await form.findByRole('status', {}, WAIT)).toBeTruthy()
    expect(form.queryByRole('alert')).toBeNull()
    second.resolve()
    expect(await form.findByRole('application', MAP, WAIT)).toBeTruthy()
    expect(form.queryByRole('status')).toBeNull()
    expect(download.map).toHaveBeenCalledTimes(2)
    expect(form.getByLabelText('שם הנקודה').value).toBe('חדר מדרגות')

    // Once it is here, the next form shows the map at once, with no second download.
    fireEvent.click(form.getByRole('button', { name: 'ביטול' }))
    fireEvent.click(within(screen.getByRole('heading', { name: 'לובי', level: 2 }).closest('article')).getByRole('button', { name: 'עריכה' }))
    const edit = within(screen.getByRole('dialog', { name: 'עריכת נקודה: לובי' }))
    expect(edit.getByRole('application', MAP)).toBeTruthy()
    expect(edit.queryByRole('status')).toBeNull()
    expect(download.map).toHaveBeenCalledTimes(2)
  })
})

describe('the QR image of a point', () => {
  it('shows the loading look, then the error with "try again" when the QR library does not download, and the image on the retry', async () => {
    const first = deferred()
    download.qr.mockImplementationOnce(() => first.promise)
    await show()
    fireEvent.click(within(screen.getByRole('heading', { name: 'לובי', level: 2 }).closest('article')).getByRole('button', { name: 'QR והדפסה' }))
    const dialog = within(screen.getByRole('dialog', { name: 'QR: לובי' }))
    const downloadButton = () => dialog.getByRole('button', { name: 'הורדה' })

    expect(dialog.getByRole('status')).toBeTruthy()
    expect(downloadButton().disabled, 'nothing to download yet').toBe(true)

    first.reject(new TypeError('Failed to fetch dynamically imported module'))
    const alert = await dialog.findByRole('alert', {}, WAIT)
    expect(alert.textContent).toContain(QR_FAILED)
    expect(dialog.queryByRole('status')).toBeNull()
    expect(downloadButton().disabled).toBe(true)
    expect(dialog.getByRole('button', { name: 'הדפסת שלט' }), 'printing stays available: it makes its own QR').toBeTruthy()

    download.qr.mockImplementationOnce(() => Promise.resolve())
    fireEvent.click(within(alert).getByRole('button', { name: 'נסו שוב' }))
    const image = await dialog.findByRole('img', { name: 'קוד QR של הנקודה לובי' }, WAIT)
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(dialog.queryByRole('alert')).toBeNull()
    expect(downloadButton().disabled).toBe(false)
    expect(download.qr).toHaveBeenCalledTimes(2)
  })
})
