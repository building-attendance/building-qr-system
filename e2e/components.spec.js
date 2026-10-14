// The committee app's shared components in a real browser, on their own page (e2e/harness.js): what the component tests in jsdom
// (tests/components/Menu.test.jsx, tests/components/dialog-unsaved-changes.test.jsx) cannot show, because jsdom has no layout, no
// widths and no keyboard of its own.
//
// - The "more" menu (Menu in src/admin/ui.jsx): the keys of the menu button pattern as this browser really handles them (Enter and
//   Space on a button, the Tab that goes on from the button), where the menu stands on the screen in both directions, that it opens
//   upwards when there is no room under its button, that a box that clips what it holds does not cut it, that it follows its button
//   when the page scrolls, and a tap outside.
// - The dialog (Modal): on a phone a sheet from the bottom with its handle, on a computer in the middle of the screen (D7 of the
//   redesign), and a sheet stays at the bottom on a computer too. A menu inside a dialog closes on Esc without the dialog.
//
// The accessibility of the open menu, in both themes, is scanned in e2e/a11y.spec.js.
import { test, expect } from './fixtures.js'
import { openHarness } from './harness.js'

// The page answers the harness's requests itself (page.route), which a service worker would take from it.
test.use({ serviceWorkers: 'block' })

const PHONE = { width: 360, height: 780 }
const COMPUTER = { width: 1280, height: 800 }

/** The button of a menu, the menu and its items, by the label of the button. */
function menuOf(scope, label) {
  const menu = scope.getByRole('menu', { name: label })
  return { button: scope.getByRole('button', { name: label, exact: true }), menu, items: menu.getByRole('menuitem') }
}

const status = (page) => page.getByRole('status')

test.describe('the "more" menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE)
  })

  test('the keys of the menu button pattern: open, move, choose, close, and Tab on from the button', async ({ page }) => {
    await openHarness(page)
    const { button, menu, items } = menuOf(page, 'עוד פעולות ללובי')
    const before = page.getByRole('button', { name: 'לפני', exact: true })
    const after = page.getByRole('button', { name: 'אחרי', exact: true })

    await button.focus()
    await page.keyboard.press('Enter') // opens on the first item
    await expect(menu).toBeVisible()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(items).toHaveText(['הדפסת שלט QR', 'השבתת הנקודה', 'מחיקת הנקודה'])
    await expect(items.nth(0)).toBeFocused()
    for (const [key, to] of [['ArrowDown', 1], ['ArrowDown', 2], ['ArrowDown', 0], ['ArrowUp', 2], ['Home', 0], ['End', 2]]) {
      await page.keyboard.press(key)
      await expect(items.nth(to), `${key} goes to item ${to}`).toBeFocused()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press(' ') // Space opens it too
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter') // and Enter chooses: the menu closes, the action runs, the focus is on the button
    await expect(status(page)).toHaveText('נבחר: השבתת הנקודה (לובי)')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await page.keyboard.press('ArrowUp') // opens on the last item
    await expect(items.nth(2)).toBeFocused()
    await page.keyboard.press(' ') // Space chooses too
    await expect(status(page)).toHaveText('נבחר: מחיקת הנקודה (לובי)')
    await expect(button).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Tab') // closes the menu and goes on from its button
    await expect(menu).toHaveCount(0)
    await expect(after).toBeFocused()
    await button.focus()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Shift+Tab') // and back from it
    await expect(menu).toHaveCount(0)
    await expect(before).toBeFocused()
  })

  test('stands under its button, its end at the end of the button and inside the screen, in both directions', async ({ page }) => {
    for (const dir of ['rtl', 'ltr']) {
      await openHarness(page, { dir })
      const { button, menu } = menuOf(page, 'עוד פעולות ללובי')
      await button.click()
      const [b, m] = [await button.boundingBox(), await menu.boundingBox()]
      expect(m.y, `${dir}: under the button`).toBeGreaterThanOrEqual(b.y + b.height)
      expect(m.y - (b.y + b.height), `${dir}: close to it`).toBeLessThanOrEqual(4.5)
      if (dir === 'rtl') expect(Math.abs(m.x - b.x), 'rtl: the left edges meet (the end of a line is its left)').toBeLessThan(1)
      else expect(Math.abs(m.x + m.width - (b.x + b.width)), 'ltr: the right edges meet').toBeLessThan(1)
      expect(m.x, `${dir}: inside the screen`).toBeGreaterThanOrEqual(8)
      expect(m.x + m.width, `${dir}: inside the screen`).toBeLessThanOrEqual(PHONE.width - 8)
    }
  })

  test('opens upwards when there is no room under its button', async ({ page }) => {
    await openHarness(page)
    const { button, menu, items } = menuOf(page, 'עוד פעולות לגג')
    await button.click()
    const [b, m] = [await button.boundingBox(), await menu.boundingBox()]
    expect(m.y + m.height, 'over the button').toBeLessThanOrEqual(b.y)
    expect(b.y - (m.y + m.height), 'close to it').toBeLessThanOrEqual(4.5)
    await expect(items.nth(0)).toBeFocused()
  })

  test('is not cut by a box that clips what it holds, and its items can be tapped there', async ({ page }) => {
    await openHarness(page)
    const clip = await page.getByTestId('clip').boundingBox()
    const { button, menu, items } = menuOf(page, 'עוד פעולות לנוכחות בחניון')
    await button.click()
    const m = await menu.boundingBox()
    expect(m.y + m.height, 'the menu reaches out of the box').toBeGreaterThan(clip.y + clip.height)
    await expect(items).toHaveText(['ביטול הנוכחות', 'החזרת הנוכחות', 'מחיקת הנוכחות לצמיתות'])
    await expect(items.nth(1)).toHaveAttribute('aria-disabled', 'true')
    await items.nth(1).tap({ force: true }) // the one that is off does nothing, and the menu stays (force: Playwright waits for an enabled item)
    await expect(menu).toBeVisible()
    await expect(status(page)).toHaveText('')
    await items.nth(2).tap() // the last item, out of the box: a tap reaches it
    await expect(status(page)).toHaveText('נבחר: מחיקת הנוכחות (חניון)')
    await expect(menu).toHaveCount(0)
  })

  test('moves with its button when the page scrolls', async ({ page }) => {
    await openHarness(page)
    const { button, menu } = menuOf(page, 'עוד פעולות ללובי')
    await button.click()
    const gap = async () => (await menu.boundingBox()).y - (await button.boundingBox()).y
    const first = await gap()
    await page.evaluate(() => window.scrollBy(0, 60))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect.poll(gap).toBeCloseTo(first, 0)
  })

  test('a tap or a click outside closes it, and the focus goes back to its button', async ({ page }) => {
    await openHarness(page)
    const { button, menu } = menuOf(page, 'עוד פעולות ללובי')
    const heading = page.getByRole('heading', { level: 1 }) // plain text: it takes no focus
    await button.tap()
    await expect(menu).toBeVisible()
    await heading.tap()
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    await button.click()
    await expect(menu).toBeVisible()
    await heading.click()
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    // on a control, the menu closes and the control has the press (and the focus, where the browser gives a pressed button the focus)
    await button.click()
    await page.getByRole('button', { name: 'פתיחת גיליון' }).click()
    await expect(menu).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'עריכת נקודה' })).toBeVisible()
  })
})

test.describe('the dialog', () => {
  const corners = (dialog) => dialog.evaluate((el) => {
    const style = getComputedStyle(el)
    const handle = getComputedStyle(el, '::before')
    return {
      top: [style.borderStartStartRadius, style.borderStartEndRadius],
      bottom: [style.borderEndStartRadius, style.borderEndEndRadius],
      handle: { visibility: handle.visibility, width: handle.width, height: handle.height },
    }
  })
  const ROUND = ['28px', '28px']
  const SQUARE = ['0px', '0px']
  const HANDLE = { width: '44px', height: '5px' }

  test('on a phone, a sheet from the bottom of the screen with its handle; on a computer, in the middle', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openHarness(page)
    const dialog = page.getByRole('dialog', { name: 'עריכת נקודה' })
    const close = dialog.getByRole('button', { name: 'סגירה' })

    await page.getByRole('button', { name: 'פתיחת חלון' }).click()
    let box = await dialog.boundingBox()
    expect(box.y + box.height, 'phone: on the bottom edge').toBeCloseTo(PHONE.height, 0)
    expect([box.x, box.width], 'phone: the whole width').toEqual([0, PHONE.width])
    expect(await corners(dialog)).toEqual({ top: ROUND, bottom: SQUARE, handle: { visibility: 'visible', ...HANDLE } })
    const closeBox = await close.boundingBox()
    expect(closeBox.y, 'the close button is under the handle, in the head').toBeGreaterThan(box.y + 5)
    await close.click()
    await expect(dialog).toHaveCount(0)

    await page.setViewportSize(COMPUTER)
    await page.getByRole('button', { name: 'פתיחת חלון' }).click()
    box = await dialog.boundingBox()
    expect(Math.abs(box.x - (COMPUTER.width - box.x - box.width)), 'computer: in the middle, across').toBeLessThanOrEqual(1)
    expect(Math.abs(box.y - (COMPUTER.height - box.y - box.height)), 'computer: in the middle, up and down').toBeLessThanOrEqual(1)
    expect(box.width, 'computer: its own width').toBe(580)
    expect(await corners(dialog)).toEqual({ top: ROUND, bottom: ROUND, handle: { visibility: 'hidden', ...HANDLE } })
    await expect(close).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('a sheet stays at the bottom on a computer too, with its handle', async ({ page }) => {
    await page.setViewportSize(COMPUTER)
    await openHarness(page)
    const dialog = page.getByRole('dialog', { name: 'עריכת נקודה' })
    await page.getByRole('button', { name: 'פתיחת גיליון' }).click()
    const box = await dialog.boundingBox()
    expect(box.y + box.height, 'on the bottom edge').toBeCloseTo(COMPUTER.height, 0)
    expect(box.width).toBe(480)
    expect(Math.abs(box.x - (COMPUTER.width - box.x - box.width)), 'in the middle, across').toBeLessThanOrEqual(1)
    expect(await corners(dialog)).toEqual({ top: ROUND, bottom: SQUARE, handle: { visibility: 'visible', ...HANDLE } })
  })

  test('a menu inside it: Esc closes the menu and not the dialog, and the next Esc the dialog', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openHarness(page)
    const dialog = page.getByRole('dialog', { name: 'עריכת נקודה' })
    await page.getByRole('button', { name: 'פתיחת חלון' }).click()
    const { button, menu, items } = menuOf(dialog, 'עוד פעולות לנקודה בחלון')
    await button.click()
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(button).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
})
