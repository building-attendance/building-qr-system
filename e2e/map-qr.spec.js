// The map and the QR image of the committee app, rendered by the production build.
//
// Two components default-import a CommonJS or UMD package: `import L from 'leaflet'` (src/admin/MapPicker.jsx) and
// `import QRCode from 'qrcode'` (src/admin/qr.js). How a bundler turns that import into a default export is what changes
// between Vite major versions, and a broken one shows only when the component runs: the unit tests never load either
// package, and no other spec opens the point form or the QR dialog. So these tests render both on the real bundle.
import { test, expect, SAMPLE_POINT, POINTS, adminSignIn, allowConsoleErrors, chooseFromMenu } from './fixtures.js'

// A 1x1 transparent PNG: the answer to every image that the map would fetch from the internet.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/**
 * Answers the tiles of the map locally, so that no test depends on a server outside this machine: they come from
 * OpenStreetMap's one address (the URL in MapPicker.jsx). The marker pictures come with the app (data: URLs), so there is
 * nothing to answer for them. Returns the URLs of the tiles that it answered and the host of every request that the page
 * made (a data: URL has none).
 */
async function stubMapImages(page) {
  const tiles = []
  const hosts = []
  page.on('request', (request) => hosts.push(new URL(request.url()).hostname))
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tiles.push(route.request().url())
    return route.fulfill({ contentType: 'image/png', body: PIXEL })
  })
  return { tiles, hosts }
}

test.beforeEach(async ({ page }) => {
  // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
  allowConsoleErrors(page, /status of 401/)
})

/** The tile of the seeded point "לובי": its actions are in the menu of its "more" button. */
const lobbyTile = (page) => page.getByRole('article').filter({ hasText: 'לובי' })

test('the point form shows the map with the marker and the circle at the point, and a click on the map moves them', async ({ page }) => {
  const { tiles, hosts } = await stubMapImages(page)
  await adminSignIn(page, 'points')
  await chooseFromMenu(lobbyTile(page), 'עריכה')
  const dialog = page.getByRole('dialog', { name: 'עריכת נקודה: לובי' })

  // The map has no accessible markup of its own beyond the label that MapPicker gives it. The class names below are
  // Leaflet's, the only handle on what the library drew: the container, the loaded tiles and the radius circle.
  const map = dialog.getByRole('application', { name: 'מפה לסימון מיקום הנקודה' })
  await expect(map).toHaveClass(/leaflet-container/) // L.map ran on the element
  await expect(map.locator('img.leaflet-tile-loaded').first()).toBeAttached() // the tile layer asked for tiles and drew them
  await expect(map.locator('svg path.leaflet-interactive')).toHaveCount(1) // the check-in radius, drawn by L.circle

  // The marker is Leaflet's own: a button that the keyboard reaches, named by its alt text ("Marker").
  const marker = map.getByRole('button', { name: 'Marker' })
  await expect(marker).toHaveCount(1)
  // its picture comes with the app: a PNG inside the bundle (a data: URL), not a request to a server, and the browser decoded it
  await expect(marker).toHaveAttribute('src', /^data:image\/png;base64,.{100,}/)
  await expect.poll(() => marker.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(map.locator('img.leaflet-marker-shadow')).toHaveAttribute('src', /^data:image\/png;base64,.{100,}/)

  // the form fields hold the coordinates of the point, the same ones the marker stands at
  const lat = dialog.getByLabel('קו רוחב')
  const lng = dialog.getByLabel('קו אורך')
  await expect(lat).toHaveValue(String(SAMPLE_POINT.lat))
  await expect(lng).toHaveValue(String(SAMPLE_POINT.lng))

  // a click on the map is Leaflet's event: the fields follow it and the marker moves, it is not drawn a second time
  const before = await marker.boundingBox()
  const size = await map.boundingBox()
  await map.click({ position: { x: size.width * 0.25, y: size.height * 0.25 } })
  await expect(lat).not.toHaveValue(String(SAMPLE_POINT.lat))
  await expect(lng).not.toHaveValue(String(SAMPLE_POINT.lng))
  // still the same neighbourhood: the map is zoomed in on the point, so a click inside it is metres away, not degrees
  expect(Math.abs(Number(await lat.inputValue()) - SAMPLE_POINT.lat)).toBeLessThan(0.01)
  expect(Math.abs(Number(await lng.inputValue()) - SAMPLE_POINT.lng)).toBeLessThan(0.01)
  await expect(marker).toHaveCount(1)
  await expect.poll(async () => (await marker.boundingBox()).x).not.toBe(before.x)

  // the tiles were requested from OpenStreetMap's one address (answered here, none came from the internet), and the page
  // loaded nothing from cdnjs: the marker pictures are not fetched from a CDN
  expect(tiles.length, 'tiles were requested').toBeGreaterThan(0)
  expect(tiles.every((url) => new URL(url).hostname === 'tile.openstreetmap.org'), 'every tile came from tile.openstreetmap.org').toBe(true)
  expect(hosts, 'the tiles were requested from tile.openstreetmap.org').toContain('tile.openstreetmap.org')
  expect(hosts, 'nothing was requested from cdnjs').not.toContain('cdnjs.cloudflare.com')

  // leave without saving: the other specs rely on the point staying where the seed put it
  await dialog.getByRole('button', { name: 'ביטול' }).click()
  await expect(dialog).toHaveCount(0)
})

// The map's stylesheet comes with the map's own file, so it is still loading when the point form is put in the page for the first time.
// Until it arrives WebKit gives the new elements no box, and a text field that takes the focus without a box tells iOS a font size of 0:
// iOS then zooms the page in to its limit (5 times) on the top left corner, and the page stays zoomed (the owner's iPhone, 27/10/2026).
// The browser's own zoom is not something a test can see, so this test holds the stylesheet back and checks what leads to it: the field
// must not take the focus while the stylesheet loads, and it must not have the focus at a moment it has no box. The box is read by a
// ResizeObserver, which reports the layout of each rendering update and does not make one (a size read from the page would make WebKit
// lay the dialog out at once, and hide what is measured). Then the stylesheet arrives and the field gets the focus.
test('the first opening of the point form focuses the name field only after the map stylesheet has loaded', async ({ page }) => {
  await stubMapImages(page)
  let requested
  const asked = new Promise((resolve) => { requested = resolve })
  let release
  const held = new Promise((resolve) => { release = resolve })
  await page.route(/\/assets\/MapPicker-[^/]+\.css$/, async (route) => {
    requested()
    await held
    await route.continue()
  })
  await adminSignIn(page, 'points')
  // Every size that the name field has at a rendering update, from the moment the dialog is put in the page, and whether it had the focus.
  await page.evaluate(() => {
    window.__nameField = []
    const watch = new MutationObserver(() => {
      const label = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent === 'שם הנקודה')
      if (!label?.control) return
      const field = label.control
      new ResizeObserver(([entry]) => {
        window.__nameField.push({ size: `${entry.contentRect.width}x${entry.contentRect.height}`, focused: document.activeElement === field })
      }).observe(field)
      watch.disconnect()
    })
    watch.observe(document.body, { childList: true, subtree: true })
  })

  await page.getByRole('button', { name: 'נקודה חדשה' }).click()
  await asked
  const whileLoading = await page.evaluate(() => {
    const active = document.activeElement
    return { onDialog: active?.getAttribute('role') === 'dialog', onField: active?.tagName === 'INPUT' }
  })
  expect(whileLoading, 'while the stylesheet loads, the dialog holds the focus and no field has it').toEqual({ onDialog: true, onField: false })

  release()
  const dialog = page.getByRole('dialog', { name: 'נקודה חדשה' })
  await expect(dialog.getByRole('application', { name: 'מפה לסימון מיקום הנקודה' })).toHaveClass(/leaflet-container/)
  await expect(dialog.getByLabel('שם הנקודה')).toBeFocused()
  const sizes = await page.evaluate(() => window.__nameField)
  expect(sizes.length, 'the name field was measured').toBeGreaterThan(0)
  expect(sizes.filter((s) => s.focused && s.size === '0x0'), 'the name field never has the focus without a box').toEqual([])

  await dialog.getByRole('button', { name: 'ביטול' }).click()
  await expect(dialog).toHaveCount(0)
})

test('the QR dialog draws the QR image of the point as a PNG and shows the address it holds', async ({ page }) => {
  await adminSignIn(page, 'points')
  await chooseFromMenu(lobbyTile(page), 'QR והדפסה')
  const dialog = page.getByRole('dialog', { name: 'QR: לובי' })

  // QRCode.toDataURL made the picture: a PNG as a data URL that the browser decoded into pixels
  const qr = dialog.getByRole('img', { name: 'קוד QR של הנקודה לובי' })
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,.{100,}/)
  await expect.poll(() => qr.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
  // the address that the code holds is printed under it, and it carries the point's own token
  await expect(dialog).toContainText(POINTS.lobby)
  await expect(dialog.getByRole('button', { name: 'הדפסת שלט' })).toBeVisible()
})

test('printing a sign builds the sheet with the name of the point and its QR image, and then asks the browser to print', async ({ page }) => {
  // The browser's print dialog is outside the page and a headless browser has none: count the call instead of making it.
  await page.addInitScript(() => {
    window.__prints = 0
    window.print = () => { window.__prints += 1 }
  })
  await adminSignIn(page, 'points')
  await chooseFromMenu(lobbyTile(page), 'QR והדפסה')
  await page.getByRole('dialog', { name: 'QR: לובי' }).getByRole('button', { name: 'הדפסת שלט' }).click()

  // The sheet is hidden on a screen (it shows only in print), aria-hidden too, so a role or a visible text cannot find it:
  // its own class names are the handle.
  const sign = page.locator('.a-print-only .a-sign')
  await expect(sign).toHaveCount(1)
  await expect(sign.locator('h1')).toHaveText('לובי')
  await expect(sign.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,.{100,}/)
  await expect.poll(() => sign.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(sign.locator('p')).toHaveCount(4) // the instruction in the four languages
  // PrintSheet waits until the images are decoded and only then prints
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1)
})
