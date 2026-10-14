// Two design rules of docs/design.md, checked on the screens of both apps with the longest text they will ever hold.
//
// T2  Reflow at 320 px. At a viewport of 320x640 (WCAG 1.4.10) no screen scrolls sideways, and no text is cut off, pushed out of the
//     screen or out of the box that draws it. The screens are the provider app in each of its four languages (the sign-in list, the
//     password screen, a result that was refused, a result that was recorded, the home screen) and the committee app (the sign-in
//     screen, the eight screens (Home with its week table among them) and the sheet under "עוד", and the point, QR and provider dialogs).
// F5  Input font size. On a phone every visible input, select and textarea has a computed font-size of 16 px or more, because iOS zooms
//     the page in when a field below that is focused. The provider app's password screen and pickers, and the forms and dialogs of the
//     committee app.
//
// The text is the worst case: names that sit at the limit of their field (shared/contract.js), in Hebrew, Arabic, Cyrillic and Latin
// letters. All of it is made up. It is created through the committee's API before the tests (the way clearScans in fixtures.js signs
// in) and taken away, and the building's own address and name put back, after them.
//
// A failing screen is not skipped and not loosened: its failures are listed, with a screenshot of the screen at 320 px in which the
// offending text is outlined in red. The screens are checked softly, so one run lists every failing screen.
import { randomUUID } from 'node:crypto'
import ar from '../src/i18n/ar.js'
import { ADDRESS_MAX_LENGTH, BUILDING_NAME_MAX_LENGTH, KEY_NAME_MAX_LENGTH, NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, EMAIL_MAX_LENGTH } from '../shared/contract.js'
import { test, expect, he, en, ru, SAMPLE_POINT, FAR, ADMIN_EMAIL, SCREEN_TITLES, adminSignIn, clearScans, allowConsoleErrors, pageSettled, openFilters, stubHome, homeSummary, openAccountMenu } from './fixtures.js'

const PHONE = { width: 320, height: 640 }
const NEAR = { latitude: SAMPLE_POINT.lat, longitude: SAMPLE_POINT.lng, accuracy: 10 }
const TEST_PASSWORD = 'dev-pass-reflow' // of the invented providers below, which exist only inside the scratch schema

// ---- the worst-case text ------------------------------------------------------------------------------------------------

/** As many of the words, in a ring, as fit in `max` characters. */
function fill(words, max) {
  let out = ''
  for (let i = 0; ; i++) {
    const next = out ? `${out} ${words[i % words.length]}` : words[i % words.length]
    if (next.length > max) return out
    out = next
  }
}

const HEBREW = ['הדוגמה', 'הארוכה', 'מאוד', 'של', 'הבניין', 'הגדול', 'ליד', 'חדר', 'הדואר', 'והמעליות', 'הצפוניות', 'בקומת', 'הקרקע']
const BUILDING_NAME = fill(HEBREW, BUILDING_NAME_MAX_LENGTH)
const BUILDING_ADDRESS = fill(['רחוב', 'הדוגמה', 'הארוך', 'מאוד', 'מספר', '123,', 'קומה', '4,', 'דירה', '56,', 'שכונת', 'הדוגמאות', 'הצפונית,', 'עיר', 'לדוגמה,', 'מחוז', 'הדוגמה,', 'כניסה', 'צפונית'], ADDRESS_MAX_LENGTH)
const POINT_NAME = fill(['לובי', 'הכניסה', 'הראשית', 'והמעבר', 'הצדדי', ...HEBREW], NAME_MAX_LENGTH)
const POINT_DESCRIPTION = fill(['נקודה', 'לדוגמה', 'עם', 'תיאור', 'ארוך', 'מאוד', ...HEBREW], 300)
const KEY_NAME = fill(['מפתח', 'לדוגמה', 'של', 'הסוכן', 'הארוך', 'מאוד', 'של', 'הוועד'], KEY_NAME_MAX_LENGTH)
const MEMBER_NAME = fill(['חבר', 'ועד', 'לדוגמה', ...HEBREW], NAME_MAX_LENGTH)
const MEMBER_EMAIL = `${'a-very-long-invented-mailbox-name-for-the-reflow-check'}@subdomain-of-example.example.test`

/** About 40 characters each: a person's name, and the name of the company that the sign-in list shows under it. */
const WORKERS = {
  he: { name: 'פלוני אלמוני בן פלוני אלמוני הארוך מאוד', company: 'ניקיון ואחזקה לדוגמה בעמ של פלוני אלמוני' },
  ar: { name: 'فلان الفلاني بن فلان الفلاني الطويل جدا', company: 'شركة النظافة والصيانة للمثال فلان الفلاني' },
  ru: { name: 'Образец Образцович Тестовый-Примерный Мл', company: 'ООО Тестовая Уборка и Содержание Пример' },
  en: { name: 'Example Placeholder Longname-Testington', company: 'Placeholder Cleaning And Maintenance Ltd' },
}
const WORDS = { he, en, ru, ar }
/** The same worst case with no space to break at: a name of one long word (a point, a person and a company). */
const UNBROKEN = {
  point: 'LobbyEntranceAndSideCorridorNextToThePostRoomAndTheNorthernElevatorsOfTheBigBuilding'.slice(0, 80),
  worker: { name: 'ExampleWorkerWithAnInventedLongNameAtTheLimit'.slice(0, 40), company: 'PlaceholderCleaningAndMaintenanceLimited'.slice(0, 40) },
}

// ---- the data -----------------------------------------------------------------------------------------------------------

/**
 * Creates the worst-case data through the committee's API (signed in with the dev sign-in of the scratch schema) and returns what
 * the tests need and `clean`, which removes it again (the specs that run after this one expect the sample data) and puts back the
 * building's name and address. The building's own texts are read first, so that `clean` restores exactly what the seed had.
 */
async function createWorstCase(playwright, baseURL) {
  const admin = await playwright.request.newContext({ baseURL })
  const phone = await playwright.request.newContext({ baseURL })
  expect((await admin.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })).ok(), 'dev admin sign-in').toBeTruthy()
  const call = async (client, method, url, data, token) => {
    const response = await client[method](url, { data, headers: token ? { authorization: `Bearer ${token}` } : {} })
    expect(response.ok(), `${method.toUpperCase()} ${url}`).toBeTruthy()
    return response.json()
  }
  const was = (await call(admin, 'get', '/api/admin/building')).building

  await call(admin, 'put', '/api/admin/building', { name: BUILDING_NAME, address: BUILDING_ADDRESS })
  const point = (await call(admin, 'post', '/api/admin/points', {
    name: POINT_NAME, description: POINT_DESCRIPTION, gps_mode: 'required', lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, radius_m: 50,
  })).point
  const workers = {}
  for (const [lang, worker] of Object.entries(WORKERS)) {
    const { provider } = await call(admin, 'post', '/api/admin/providers', { company: worker.company, contact_name: worker.name, password: TEST_PASSWORD })
    workers[lang] = { ...worker, id: provider.id }
  }
  const key = (await call(admin, 'post', '/api/admin/api-keys', { name: KEY_NAME })).api_key
  const member = (await call(admin, 'post', '/api/admin/admins', { email: MEMBER_EMAIL, name: MEMBER_NAME })).admin

  /** One accepted visit of each worker at the long point, so that the history has rows with the long names. */
  const makeVisits = async () => {
    for (const worker of Object.values(workers)) {
      const { token } = await call(phone, 'post', '/api/session', { provider_id: worker.id, password: TEST_PASSWORD })
      await call(phone, 'post', '/api/scan', { id: randomUUID(), code: point.qr_token, gps: { lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, accuracy: 10 } }, token)
    }
  }
  const clean = async () => {
    await clearScans(admin)
    await Promise.all([
      admin.delete(`/api/admin/points/${point.id}`, { data: {} }),
      admin.delete(`/api/admin/api-keys/${key.id}`, { data: {} }),
      admin.delete(`/api/admin/admins/${member.id}`, { data: {} }),
      ...Object.values(workers).map(({ id }) => admin.delete(`/api/admin/providers/${id}`, { data: {} })),
      admin.put('/api/admin/building', { data: { name: was.name, address: was.address } }),
    ])
    await Promise.all([admin.dispose(), phone.dispose()])
  }
  return { point, workers, makeVisits, clean }
}

/**
 * The extra worst case: a point and a person whose names are one long word. Apart from the data above because it is not part of the
 * agreed list, and because a person with such a name changes the screens that list people (a fieldset takes the width of its longest
 * word), which would hide whether the agreed cases fit. `clean` removes both and the visit that was made.
 */
async function createUnbroken(playwright, baseURL) {
  const admin = await playwright.request.newContext({ baseURL })
  const phone = await playwright.request.newContext({ baseURL })
  expect((await admin.post('/api/admin/dev-login', { data: { email: ADMIN_EMAIL } })).ok(), 'dev admin sign-in').toBeTruthy()
  const call = async (client, method, url, data, token) => {
    const response = await client[method](url, { data, headers: token ? { authorization: `Bearer ${token}` } : {} })
    expect(response.ok(), `${method.toUpperCase()} ${url}`).toBeTruthy()
    return response.json()
  }
  const point = (await call(admin, 'post', '/api/admin/points', { name: UNBROKEN.point, gps_mode: 'required', lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, radius_m: 50 })).point
  const worker = (await call(admin, 'post', '/api/admin/providers', { company: UNBROKEN.worker.company, contact_name: UNBROKEN.worker.name, password: TEST_PASSWORD })).provider
  const makeVisit = async () => {
    const { token } = await call(phone, 'post', '/api/session', { provider_id: worker.id, password: TEST_PASSWORD })
    await call(phone, 'post', '/api/scan', { id: randomUUID(), code: point.qr_token, gps: { lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, accuracy: 10 } }, token)
  }
  const clean = async () => {
    await clearScans(admin)
    await Promise.all([admin.delete(`/api/admin/points/${point.id}`, { data: {} }), admin.delete(`/api/admin/providers/${worker.id}`, { data: {} })])
    await Promise.all([admin.dispose(), phone.dispose()])
  }
  return { point, worker, makeVisit, clean }
}

let data
test.beforeAll(async ({ playwright }, testInfo) => {
  data = await createWorstCase(playwright, testInfo.project.use.baseURL)
})
test.afterAll(async () => {
  await data?.clean()
})

// ---- what is measured in the page ---------------------------------------------------------------------------------------

/**
 * Runs in the page. Looks at the text of every root (the roots are the apps themselves: `.w-app` for the provider app, `.a-app` for the
 * committee app, whose dialogs and toasts are drawn inside it) and returns what does not fit. Self-contained: Playwright sends its source.
 *
 * Why the roots are the whole apps and not a list of containers: a list goes stale when a screen gains a container, and the text
 * that overflows is, by definition, text that nobody listed. What is looked at is the text itself (a Range over each text node, so a
 * wrapped line and a line that runs on are measured as they are drawn), against three things that can hold it:
 *   - the screen: the text must not start before the left edge or end after the right edge (an RTL page cannot even scroll to what
 *     lies off its right edge, so the scroll width alone would not see it);
 *   - an ancestor that clips (overflow hidden or clip): the text must not be cut by it. A horizontal cut is any part outside; a
 *     vertical cut is a line whose middle is outside, so that the leading of a line (a line box a little shorter than its glyphs)
 *     is not a finding;
 *   - the nearest ancestor that draws a box (a fill, a border or a shadow: a card, a button, a badge, a row): the text must not poke
 *     out of it sideways, and that box must not poke out of the box that draws it in turn.
 * A region that scrolls sideways on purpose is not looked into for the screen and the box checks, but is itself a finding when it does
 * scroll (that is a second axis of scrolling).
 *
 * What is left out, and why:
 *   - `ignoreSelector`: text that is not drawn as text (a `select`'s options and a `textarea`'s value are the browser's own, the
 *     visually hidden `.w-sr` is clipped to 1 px on purpose) and the map's attribution (Leaflet's, not ours);
 *   - `designedSelector`: the one box whose clipping is the design (the building's name in the top bar of the committee app, which
 *     stops at two lines with an ellipsis, src/admin/admin.css). It is reported as `designed`, not as a finding.
 * The ellipsis of a tab label (`.a-nav-label`) is NOT left out: admin.css says it "should never show".
 *
 * The width of the screen is given, not read from `window.innerWidth`: Chromium's mobile emulation widens the layout viewport to the
 * width of the content when the content is wider (measured: a 400 px line on a 320 px screen gives innerWidth 400 and scrollWidth 400),
 * so `scrollWidth <= innerWidth` is true for a page that does scroll sideways.
 * @param {{ rootSelector: string, ignoreSelector: string, designedSelector: string, viewportWidth: number }} options
 */
function measureLayout({ rootSelector, ignoreSelector, designedSelector, viewportWidth }) {
  const SLACK = 1 // px: the rounding of a rectangle
  const findings = []
  const designed = []
  const seen = new Set()

  const describe = (el) => {
    const parts = []
    for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      const cls = typeof n.className === 'string' && n.className.trim() ? `.${n.className.trim().split(/\s+/)[0]}` : ''
      parts.unshift(`${n.tagName.toLowerCase()}${cls}`)
    }
    return parts.join(' > ')
  }
  const alphaOf = (color) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(color.trim())
    if (!m) return color === 'transparent' ? 0 : 1
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    return parts.length >= 4 ? Number(parts[3]) : 1
  }
  const isDrawn = (el) => {
    const cs = getComputedStyle(el)
    if (alphaOf(cs.backgroundColor) > 0 || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true
    return ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none')
  }
  const hasSize = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const nearestDrawn = (el, root) => {
    for (let n = el; n && n !== root; n = n.parentElement) if (isDrawn(n) && hasSize(n)) return n
    return null
  }
  const scrollsSideways = (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)
  const scrollerOf = (el, root) => {
    for (let n = el; n && n !== root; n = n.parentElement) if (scrollsSideways(n)) return n
    return null
  }
  // What is found is outlined in red for the screenshot: by an attribute that a rule of the CSSOM (not a style attribute: the
  // Content-Security-Policy refuses those) draws, and that the check takes off again after the screenshot.
  if (!window.__reflowMarks) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('[data-reflow-flag] { outline: 3px solid #e00 !important; outline-offset: -3px; }')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    window.__reflowMarks = sheet
  }
  const flag = (kind, el, text, detail, wide = false) => {
    const key = `${kind}|${describe(el)}|${detail}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ kind, where: describe(el), text: text.replace(/\s+/g, ' ').trim().slice(0, 40), detail, wide })
    el.setAttribute('data-reflow-flag', kind)
  }

  let checked = 0 // the text boxes that were looked at, so that a screen with nothing on it cannot pass
  const boxes = new Set() // the drawn boxes that hold text
  for (const root of document.querySelectorAll(rootSelector)) {
    for (const el of root.querySelectorAll('*')) {
      if (scrollsSideways(el) && el.scrollWidth > el.clientWidth + SLACK && el.clientWidth > 0 && !el.closest(ignoreSelector)) {
        flag('scrolls sideways', el, '', `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`)
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? ''
      const el = node.parentElement
      if (!text.trim() || !el || el.closest(ignoreSelector) || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
      if (rects.length === 0) continue
      checked += 1
      const left = Math.min(...rects.map((r) => r.left))
      const right = Math.max(...rects.map((r) => r.right))
      const scroller = scrollerOf(el, root)

      // 1. an ancestor that clips
      let clipped = false
      for (let a = el; a && a !== root.parentElement && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a)
        const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
        const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
        if (!clipX && !clipY) continue
        const r = a.getBoundingClientRect()
        const edge = { left: r.left + parseFloat(cs.borderLeftWidth), right: r.right - parseFloat(cs.borderRightWidth), top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom - parseFloat(cs.borderBottomWidth) }
        const cutX = clipX && (left < edge.left - SLACK || right > edge.right + SLACK)
        const cutY = clipY && rects.some((q) => (q.top + q.bottom) / 2 < edge.top || (q.top + q.bottom) / 2 > edge.bottom)
        if (!cutX && !cutY) continue
        clipped = true
        const by = describe(a)
        if (a.matches(designedSelector) || el.closest(designedSelector)) designed.push({ where: describe(el), text: text.replace(/\s+/g, ' ').trim().slice(0, 40), detail: `cut by ${by} (by design)` })
        else flag('clipped', el, text, `cut off by ${by}${cutX ? ' (sideways)' : ' (a line is hidden)'}`)
        break
      }
      if (clipped) continue // what is cut is not also outside the screen
      if (scroller) {
        // inside a region that may scroll: the text must not be what makes it scroll sideways (the region itself is flagged above)
        const r = scroller.getBoundingClientRect()
        const from = r.left + scroller.clientLeft
        const to = from + scroller.clientWidth
        if (left < from - SLACK || right > to + SLACK) {
          flag('makes its region scroll sideways', el, text, `text spans ${Math.round(left)}..${Math.round(right)} px, ${describe(scroller)} spans ${Math.round(from)}..${Math.round(to)}`, right - left > scroller.clientWidth)
        }
        continue
      }

      // 2. the screen
      if (left < -SLACK || right > viewportWidth + SLACK) {
        flag('outside the screen', el, text, `text spans ${Math.round(left)}..${Math.round(right)} px of ${viewportWidth}`, right - left > viewportWidth)
        continue
      }
      // 3. the box that draws it
      const box = nearestDrawn(el, root)
      if (box) {
        boxes.add(box)
        const r = box.getBoundingClientRect()
        if (left < r.left - SLACK || right > r.right + SLACK) {
          flag('pokes out of its box', el, text, `text spans ${Math.round(left)}..${Math.round(right)} px, ${describe(box)} spans ${Math.round(r.left)}..${Math.round(r.right)}`)
        }
      }
    }
    // a drawn box that holds text, and the boxes around it, must each be inside the box that draws it
    for (const start of boxes) {
      for (let box = start; box; ) {
        const parent = box.parentElement && nearestDrawn(box.parentElement, root)
        if (!parent || getComputedStyle(box).position === 'fixed' || scrollerOf(box, root)) break
        const r = box.getBoundingClientRect()
        const p = parent.getBoundingClientRect()
        if (r.left < p.left - SLACK || r.right > p.right + SLACK) {
          flag('box pokes out of its box', box, box.textContent ?? '', `${describe(box)} spans ${Math.round(r.left)}..${Math.round(r.right)} px, ${describe(parent)} spans ${Math.round(p.left)}..${Math.round(p.right)}`)
        }
        box = parent
      }
    }
  }
  const doc = document.documentElement
  return { innerWidth: window.innerWidth, scrollWidth: doc.scrollWidth, checked, findings, designed }
}

/** Runs in the page: the fields that are drawn and have a computed font-size under 16 px. A field is drawn when it has a size and is not display none or hidden (opacity does not matter: the invisible pickers of the provider app are tapped). */
function smallFields() {
  const small = []
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue
    const size = parseFloat(cs.fontSize)
    if (size < 16) {
      const label = el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent?.trim() ?? el.id ?? ''
      small.push(`${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? `[type=${el.type}]` : ''}${el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''} "${label.slice(0, 30)}": ${cs.fontSize}`)
    }
  }
  return small
}

// ---- the checks ---------------------------------------------------------------------------------------------------------

const IGNORE = '.w-sr, option, select, textarea, script, style, noscript, .leaflet-container'
const DESIGNED = '.a-brand__text'
const MAX_LISTED = 8
const slug = (text) => text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()

/** The check of one screen at 320 px: soft, so that a run lists every screen that does not fit. */
function reflowChecker(page, testInfo) {
  const check = async (screen) => {
    await page.evaluate(() => document.fonts.ready)
    await pageSettled(page)
    const rootSelector = (await page.locator('.a-app').count()) > 0 ? '.a-app' : '.w-app'
    const result = await page.evaluate(measureLayout, { rootSelector, ignoreSelector: IGNORE, designedSelector: DESIGNED, viewportWidth: PHONE.width })
    // A text that is wider than the screen itself is the cause of a page that scrolls sideways; everything else that is "outside the
    // screen" on such a page is only pushed there by it. So the wide ones come first, and the rest are listed up to a limit.
    const describeFinding = (f) => `${f.kind}${f.wide ? ' (WIDER THAN THE SCREEN)' : ''}: "${f.text}" in ${f.where} (${f.detail})`
    const ordered = [...result.findings.filter((f) => f.wide), ...result.findings.filter((f) => !f.wide)]
    const problems = ordered.slice(0, MAX_LISTED).map(describeFinding)
    if (ordered.length > MAX_LISTED) problems.push(`... and ${ordered.length - MAX_LISTED} more (all are outlined in the screenshot)`)
    if (result.scrollWidth > PHONE.width) problems.unshift(`the page scrolls sideways: scrollWidth ${result.scrollWidth} > ${PHONE.width} (window.innerWidth is ${result.innerWidth})`)
    testInfo.annotations.push({ type: 'checked', description: `${screen}: ${result.checked} text boxes, scrollWidth ${result.scrollWidth}, window.innerWidth ${result.innerWidth}` })
    expect(result.checked, `${screen}: the screen has text to look at`).toBeGreaterThan(3)
    for (const d of result.designed) testInfo.annotations.push({ type: 'truncated by design', description: `${screen}: "${d.text}" in ${d.where} (${d.detail})` })
    let shot = ''
    if (problems.length > 0) {
      shot = testInfo.outputPath(`${testInfo.project.name}--${slug(screen)}.png`)
      // Playwright's WebKit puts a style sheet of its own into the page for a screenshot, and the page's policy (style-src has no
      // 'unsafe-inline') refuses it: one console error per screenshot (measured, with a bare page.screenshot). It is allowed, by its
      // text, only here, where a failing screen is photographed, and only for the screenshot.
      allowConsoleErrors(page, /Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/)
      await page.screenshot({ path: shot, fullPage: true })
      await testInfo.attach(`${screen} (320 px)`, { path: shot, contentType: 'image/png' })
      await page.evaluate(() => document.querySelectorAll('[data-reflow-flag]').forEach((el) => el.removeAttribute('data-reflow-flag')))
    }
    expect.soft(problems, `T2 reflow, ${screen}, at ${PHONE.width} px:\n  ${problems.join('\n  ')}\n  screenshot: ${shot}\n`).toEqual([])
  }
  return { check }
}

/** The check of the fields of one screen: soft, as above. */
async function checkFields(page, screen) {
  const small = await page.evaluate(smallFields)
  expect.soft(small, `F5 input font size, ${screen}: fields under 16 px:\n  ${small.join('\n  ')}\n`).toEqual([])
}

// ---- T2: the provider app, in each language -----------------------------------------------------------------------------

test.describe('T2 reflow at 320 px: the provider app', () => {
  test.use({ viewport: PHONE, reducedMotion: 'reduce' })

  for (const lang of ['he', 'en', 'ru', 'ar']) {
    test(`in ${lang}: the sign-in list, the password screen, a refused and a recorded check-in, and the home screen`, async ({ page, context, request }, testInfo) => {
      await clearScans(request) // a visit that is still on record would answer "already recorded" instead of recording
      const words = WORDS[lang]
      const worker = data.workers[lang]
      const { check } = reflowChecker(page, testInfo)

      // The phone is far from the point (a point that checks the location refuses it), and the language is picked on the screen.
      await context.setGeolocation(FAR)
      await page.goto(`/scan?code=${data.point.qr_token}`)
      if (lang !== 'he') await page.getByLabel(he['lang.label']).selectOption(lang)
      await expect(page.getByRole('heading', { name: words['login.title'] })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.getByText(POINT_NAME.slice(0, 20)).first()).toBeVisible() // the banner that names the point
      await expect(page.getByRole('banner').getByText(BUILDING_NAME.slice(0, 20))).toBeVisible() // the header, with the long name and address
      await check(`provider ${lang}: sign-in list`)

      await page.getByRole('button', { name: worker.name }).click()
      const password = page.getByLabel(words['login.passwordLabel'], { exact: true })
      await expect(password).toBeVisible()
      await check(`provider ${lang}: password screen`)

      await password.fill(TEST_PASSWORD)
      await page.getByRole('button', { name: words['login.submit'], exact: true }).click()
      await expect(page.getByRole('heading', { name: words['checkin.far.title'] })).toBeVisible()
      await check(`provider ${lang}: result, too far`)

      await context.setGeolocation(NEAR)
      await page.getByRole('button', { name: words['checkin.retry'] }).click()
      await expect(page.getByRole('heading', { name: words['checkin.success.title'] })).toBeVisible()
      await check(`provider ${lang}: result, recorded`)

      await page.getByRole('button', { name: words['checkin.done'] }).click()
      await expect(page.getByRole('heading', { name: new RegExp(worker.name.slice(0, 12)) })).toBeVisible()
      await expect(page.getByRole('list').getByText(POINT_NAME.slice(0, 20))).toBeVisible()
      await check(`provider ${lang}: home`)
    })
  }
})

// ---- T2: the committee app, in Hebrew -----------------------------------------------------------------------------------

/** The map's tiles come from the internet (OpenStreetMap): answered here, as map-qr.spec.js does. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const stubMapImages = (page) => page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }))

const TITLES = SCREEN_TITLES
const openTab = async (page, tab) => {
  await page.goto(`/admin#${tab}`)
  await expect(page.getByRole('heading', { level: 1, name: TITLES[tab] })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'טוען' })).toHaveCount(0)
}
const pointTile = (page) => page.getByRole('article').filter({ hasText: POINT_NAME.slice(0, 30) })
const workerTile = (page) => page.getByRole('article').filter({ hasText: WORKERS.he.name })

test.describe('T2 reflow at 320 px: the committee app', () => {
  test.use({ viewport: PHONE, reducedMotion: 'reduce' })

  test.beforeAll(async () => {
    await data.makeVisits() // the history has rows that carry the long names
  })
  test.beforeEach(async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
  })

  test('the sign-in screen', async ({ page }, testInfo) => {
    const { check } = reflowChecker(page, testInfo)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'ניהול נוכחות הבניין' })).toBeVisible()
    await expect(page.getByText(BUILDING_NAME.slice(0, 20))).toBeVisible()
    await check('committee: sign-in')
  })

  test('the eight screens and the sheet under "עוד"', async ({ page }, testInfo) => {
    const { check } = reflowChecker(page, testInfo)
    await adminSignIn(page)
    await expect(page.getByRole('banner')).toContainText(BUILDING_NAME.slice(0, 20)) // the top bar says the long name of the building
    for (const tab of ['home', 'history', 'points', 'providers', 'agent', 'settings', 'audit', 'help']) {
      await openTab(page, tab)
      if (tab === 'home') await expect(page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).getByRole('table').getByRole('rowheader').filter({ hasText: WORKERS.he.name.slice(0, 12) })).toBeVisible() // the rows with the long names are drawn
      if (tab === 'history') await expect(page.getByRole('listitem').getByText(POINT_NAME.slice(0, 20)).first()).toBeVisible() // the rows are drawn
      if (tab === 'agent') await expect(page.getByText(KEY_NAME.slice(0, 20))).toBeVisible()
      if (tab === 'settings') await expect(page.getByLabel('שם הבניין', { exact: true })).toHaveValue(BUILDING_NAME)
      if (tab === 'audit') await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible()
      await check(`committee phone: ${tab}`)
      if (tab === 'history') { // the filters are in a sheet on a phone
        const filters = await openFilters(page)
        await check('committee phone: history, the filters sheet')
        await filters.getByRole('button', { name: 'סגירה' }).click()
      }
    }
    // the sheet that the fourth button of the bar opens, over the screen of the management group that is open (the help)
    await page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' }).getByRole('button', { name: 'עוד', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'עוד', exact: true })).toBeVisible()
    await check('committee phone: the sheet under "עוד"')
    // the account menu, open over the same screen: a popover with a fixed position, which must stay inside a 320 px screen and fit its own words
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openAccountMenu(page)
    await check('committee phone: the account menu')
  })

  // The week table of Home is the one place where the numbers are a grid, so it gets the worst case that the real data above does not make: a
  // provider that is switched off and one that was deleted (each has a badge in the name column), names of one long word, a name at the
  // limit in Cyrillic, counts of three digits, and the cards with the biggest numbers. The table must fit the width of the screen by
  // itself (its own box does not scroll), and so must every card.
  test('the Home screen with the longest names, a provider that is switched off and one that was deleted, and big numbers', async ({ page }, testInfo) => {
    const { check } = reflowChecker(page, testInfo)
    const id = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`
    const providers = [
      { id: id(1), name: WORKERS.he.name, company: WORKERS.he.company, is_active: true, counts: [120, 0, 0, 0, 0, 0, 9] },
      { id: id(2), name: UNBROKEN.worker.name, company: UNBROKEN.worker.company, is_active: true, counts: [1, 2, 3, 4, 5, 6, 7] },
      { id: id(3), name: WORKERS.ru.name, company: WORKERS.ru.company, is_active: false, counts: [0, 0, 0, 0, 0, 0, 3] },
      { id: id(4), name: `${UNBROKEN.worker.name}2`, company: null, is_active: false, counts: [0, 0, 4, 0, 0, 0, 0] },
      { id: id(5), name: 'דנה', company: 'דנה', is_active: true, counts: [0, 0, 0, 0, 0, 0, 0] },
    ]
    await stubHome(page, homeSummary({ providers, counts: { visits_not_counted: 123456, waiting: { phones: 12, visits: 345 } } }))
    await adminSignIn(page, 'home')
    await expect(page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).getByRole('table').getByRole('rowheader').filter({ hasText: 'נותן שירות שנמחק' })).toBeVisible()
    await check('committee phone: home, the longest names, a provider that is off and one that was deleted')
    const box = page.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' })
    expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth), 'the box of the table does not scroll: the table fits').toBeLessThanOrEqual(1)
  })

  test('the dialogs of the points and the providers', async ({ page }, testInfo) => {
    const { check } = reflowChecker(page, testInfo)
    await stubMapImages(page)
    await adminSignIn(page)
    const dialog = (name) => page.getByRole('dialog', { name })
    const close = async (name) => {
      await page.keyboard.press('Escape')
      await expect(dialog(name)).toHaveCount(0)
    }

    await openTab(page, 'points')
    await pointTile(page).getByRole('button', { name: 'עריכה' }).click()
    const form = dialog(`עריכת נקודה: ${POINT_NAME}`)
    await expect(form.locator('img.leaflet-tile-loaded').first()).toBeAttached() // the map has drawn
    await check('committee phone: point form (the long point)')
    await close(`עריכת נקודה: ${POINT_NAME}`)

    await pointTile(page).getByRole('button', { name: 'QR והדפסה' }).click()
    const qr = dialog(`QR: ${POINT_NAME}`)
    await expect.poll(() => qr.getByRole('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
    await check('committee phone: QR dialog (the long point)')
    await close(`QR: ${POINT_NAME}`)

    await openTab(page, 'providers')
    await workerTile(page).getByRole('button', { name: 'עריכה' }).click()
    await expect(dialog(`עריכה: ${WORKERS.he.name}`)).toBeVisible()
    await check('committee phone: provider form (the long worker)')
    await close(`עריכה: ${WORKERS.he.name}`)

    await page.getByRole('button', { name: 'נותן שירות חדש' }).click()
    await expect(dialog('נותן שירות חדש')).toBeVisible()
    await check('committee phone: new provider form')
    await close('נותן שירות חדש')

    await workerTile(page).getByRole('button', { name: 'סיסמה חדשה' }).click()
    await expect(dialog(`סיסמה חדשה: ${WORKERS.he.name}`)).toBeVisible()
    await check('committee phone: new password dialog (the long worker)')
    await close(`סיסמה חדשה: ${WORKERS.he.name}`)
  })
})

// ---- F5: the fields, on a phone -----------------------------------------------------------------------------------------

test.describe('F5 input font size on a phone', () => {
  test.beforeEach(async ({ page }) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
  })

  test('the provider app: the pickers, the password field and its switch', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: he['login.title'] })).toBeVisible()
    await checkFields(page, 'provider: sign-in list (the language and theme pickers)')
    await page.getByRole('button', { name: WORKERS.he.name }).click()
    const password = page.getByLabel(he['login.passwordLabel'], { exact: true })
    await expect(password).toBeVisible()
    await checkFields(page, 'provider: password screen')
    await password.fill(TEST_PASSWORD)
    await page.getByRole('button', { name: he['login.showPassword'] }).click() // the same field, as text
    await expect(password).toHaveAttribute('type', 'text')
    await checkFields(page, 'provider: password screen, the password shown')
  })

  test('the committee app: the history filters, the forms and the dialogs', async ({ page }) => {
    await stubMapImages(page)
    await adminSignIn(page)
    const dialog = (name) => page.getByRole('dialog', { name })
    const closeAfter = async (name, screen) => {
      await expect(dialog(name)).toBeVisible()
      await checkFields(page, screen)
      await page.keyboard.press('Escape')
      await expect(dialog(name)).toHaveCount(0)
    }

    await openTab(page, 'history')
    const historyFilters = await openFilters(page) // on a phone (and this is one) the fields are in the sheet that the filter button opens
    await checkFields(page, 'committee: history (the filters)')
    await historyFilters.getByRole('button', { name: 'סגירה' }).click()

    await openTab(page, 'points')
    await page.getByRole('button', { name: 'נקודה חדשה' }).click()
    await expect(dialog('נקודה חדשה').locator('img.leaflet-tile-loaded').first()).toBeAttached()
    await closeAfter('נקודה חדשה', 'committee: new point form')

    await openTab(page, 'providers')
    await page.getByRole('button', { name: 'נותן שירות חדש' }).click()
    await closeAfter('נותן שירות חדש', 'committee: new provider form')
    await workerTile(page).getByRole('button', { name: 'עריכה' }).click()
    await closeAfter(`עריכה: ${WORKERS.he.name}`, 'committee: edit provider form')
    await workerTile(page).getByRole('button', { name: 'סיסמה חדשה' }).click()
    await closeAfter(`סיסמה חדשה: ${WORKERS.he.name}`, 'committee: new password dialog')

    await openTab(page, 'agent')
    await page.getByRole('button', { name: 'מפתח חדש' }).click()
    await closeAfter('מפתח גישה חדש', 'committee: new agent key form')

    await openTab(page, 'settings')
    await checkFields(page, 'committee: settings (the building card)')
    await page.getByRole('button', { name: 'חבר ועד חדש' }).click()
    await closeAfter('חבר ועד חדש', 'committee: new member form')
    await openTab(page, 'audit')
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible()
    const auditFilters = await openFilters(page)
    await checkFields(page, 'committee: audit log (the filters)')
    await auditFilters.getByRole('button', { name: 'סגירה' }).click()
  })
})

// EXTRA, beyond the agreed worst case: user text that is one long word. Its clicks are dispatched instead of performed, so that a screen
// that does not fit (and puts the button off the page) does not stop the rest of the journey from being measured.
test.describe('T2 reflow at 320 px [extra]: names with no space to break at', () => {
  test.use({ viewport: PHONE, reducedMotion: 'reduce' })
  let extra
  test.beforeAll(async ({ playwright }, testInfo) => {
    extra = await createUnbroken(playwright, testInfo.project.use.baseURL)
  })
  test.afterAll(async () => {
    await extra?.clean()
  })

  for (const lang of ['he', 'en']) {
    test(`provider app in ${lang}: a point, a person and a company that are each one long word`, async ({ page, request }, testInfo) => {
      await clearScans(request)
      const words = WORDS[lang]
      const { check } = reflowChecker(page, testInfo)
      await page.goto(`/scan?code=${extra.point.qr_token}`)
      if (lang !== 'he') await page.getByLabel(he['lang.label']).selectOption(lang)
      await expect(page.getByRole('heading', { name: words['login.title'] })).toBeVisible()
      await expect(page.getByText(UNBROKEN.point.slice(0, 20)).first()).toBeVisible()
      await check(`provider ${lang}, names of one word: sign-in list`)

      await page.getByRole('button', { name: UNBROKEN.worker.name }).dispatchEvent('click')
      const password = page.getByLabel(words['login.passwordLabel'], { exact: true })
      await expect(password).toBeVisible()
      await check(`provider ${lang}, names of one word: password screen`)

      await password.fill(TEST_PASSWORD)
      await page.getByRole('button', { name: words['login.submit'], exact: true }).dispatchEvent('click')
      await expect(page.getByRole('heading', { name: words['checkin.success.title'] })).toBeVisible()
      await check(`provider ${lang}, names of one word: result, recorded`)

      await page.getByRole('button', { name: words['checkin.done'] }).dispatchEvent('click')
      await expect(page.getByRole('heading', { name: new RegExp(UNBROKEN.worker.name.slice(0, 12)) })).toBeVisible()
      await check(`provider ${lang}, names of one word: home`)
    })
  }

  test('committee app: the points, the providers, the history and the dialogs of a point and a person that are each one long word', async ({ page, request }, testInfo) => {
    allowConsoleErrors(page, /status of 401/) // the first load of /admin, before the sign-in
    await clearScans(request) // the visit of the person on the other screens would be "already recorded"
    await extra.makeVisit() // a row of the history
    const { check } = reflowChecker(page, testInfo)
    await stubMapImages(page)
    await adminSignIn(page)
    for (const tab of ['points', 'providers', 'history']) {
      await openTab(page, tab)
      await check(`committee phone, names of one word: ${tab}`)
    }
    await openTab(page, 'points')
    await page.getByRole('article').filter({ hasText: UNBROKEN.point.slice(0, 30) }).getByRole('button', { name: 'עריכה' }).click()
    await expect(page.getByRole('dialog', { name: `עריכת נקודה: ${UNBROKEN.point}` })).toBeVisible()
    await check('committee phone, names of one word: point form')
    await page.keyboard.press('Escape')
    await openTab(page, 'providers')
    await page.getByRole('article').filter({ hasText: UNBROKEN.worker.name }).getByRole('button', { name: 'עריכה' }).click()
    await expect(page.getByRole('dialog', { name: `עריכה: ${UNBROKEN.worker.name}` })).toBeVisible()
    await check('committee phone, names of one word: provider form')
  })
})

// The measurement itself: a check that finds nothing would pass every day, so it is shown a page with each kind of fault, and a page
// without any. (Each page has the viewport meta of the apps; without it Chromium's mobile emulation lays a page out at 980 px.)
test.describe('the reflow measurement finds what it should', () => {
  test.use({ viewport: PHONE })
  const measure = (page) => page.evaluate(measureLayout, { rootSelector: 'body', ignoreSelector: IGNORE, designedSelector: DESIGNED, viewportWidth: PHONE.width })
  const FRAME = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px sans-serif}.box{border:1px solid #000;padding:4px;margin:8px;width:120px}</style>'
  const LONG = 'a line that is much longer than the box that holds it'
  const CASES = [
    ['text that wraps inside its box', '<div class="box">short words wrap inside the box without trouble at all</div><div class="box" style="overflow:hidden;height:5em">two lines</div>', []],
    ['a long line cut off by a box that clips', `<div class="box" style="overflow:hidden;white-space:nowrap">${LONG}</div>`, ['clipped']],
    ['a line that is hidden by a box that clips', '<div class="box" style="overflow:hidden;height:1.4em">first line<br>a second line that is cut off</div>', ['clipped']],
    ['a long line that pokes out of the box that draws it', '<div class="box" style="white-space:nowrap">a line wider than its box</div>', ['pokes out of its box']],
    ['a line that runs past the edge of the screen', '<div style="margin-left:250px;width:200px;white-space:nowrap">a line that runs past the edge</div>', ['outside the screen']],
    ['a region that scrolls sideways', `<div class="box" style="overflow:auto;white-space:nowrap">${LONG}</div>`, ['makes its region scroll sideways', 'scrolls sideways']],
    ['a box that pokes out of the box around it', '<div class="box" style="width:200px"><span style="display:inline-block;white-space:nowrap;background:#ddd">a badge wider than the card it sits in</span></div>', ['box pokes out of its box']],
  ]
  for (const [name, html, expected] of CASES) {
    test(name, async ({ page }) => {
      await page.setContent(`${FRAME}${html}`)
      const result = await measure(page)
      expect([...new Set(result.findings.map((f) => f.kind))].sort()).toEqual([...expected].sort())
    })
  }

  test('a page wider than the screen is found by its scroll width, which window.innerWidth can hide', async ({ page, browserName }) => {
    await page.setContent(`${FRAME}<div style="width:400px">a block 400 px wide on a 320 px screen</div>`)
    const result = await measure(page)
    expect(result.scrollWidth).toBeGreaterThan(PHONE.width)
    // Chromium's mobile emulation grew the layout viewport to the content, so `scrollWidth <= innerWidth` holds for a page that scrolls
    // sideways; WebKit keeps the screen's width. (Measured; this is why the check compares with the width of the screen.)
    if (browserName === 'chromium') expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth)
    else expect(result.innerWidth).toBe(PHONE.width)
  })

  // The same on the real screens: a rule that breaks the layout is added to the page (through the CSSOM, as the Content-Security-Policy
  // allows no style element), and the measurement must find it. This is what shows that the roots, the exceptions and the reading of
  // the page work on the markup of the apps and not only on the small pages above.
  const breakWith = (page, css) => page.evaluate((rules) => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(rules)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  }, css)

  test('the provider app: a name that cannot wrap is found on the sign-in list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: WORKERS.he.name })).toBeVisible()
    const before = await page.evaluate(measureLayout, { rootSelector: '.w-app', ignoreSelector: IGNORE, designedSelector: DESIGNED, viewportWidth: PHONE.width })
    expect(before.findings).toEqual([])
    expect(before.checked).toBeGreaterThan(10)
    await breakWith(page, '.w-person__name { white-space: nowrap; overflow-wrap: normal; }')
    const after = await page.evaluate(measureLayout, { rootSelector: '.w-app', ignoreSelector: IGNORE, designedSelector: DESIGNED, viewportWidth: PHONE.width })
    expect(after.findings.map((f) => f.text)).toEqual(expect.arrayContaining([expect.stringContaining(WORKERS.he.name.slice(0, 10))]))
  })

  test('the committee app: tab labels that no longer fit are found, and the clamped name of the building is by design', async ({ page }) => {
    allowConsoleErrors(page, /status of 401/)
    await adminSignIn(page)
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })).toBeVisible()
    const measure = () => page.evaluate(measureLayout, { rootSelector: '.a-app', ignoreSelector: IGNORE, designedSelector: DESIGNED, viewportWidth: PHONE.width })
    const before = await measure()
    expect(before.findings).toEqual([])
    expect(before.designed.map((d) => d.where).join()).toContain('a-brand__text') // the name of the building, clamped at two lines
    await breakWith(page, '.a-nav-label { font-size: 22px; }')
    expect((await measure()).findings.map((f) => f.kind)).toContain('clipped')
  })

  test('the clamped name of the building in the top bar is reported as by design, and is not a finding', async ({ page }) => {
    await page.setContent(`${FRAME}<div class="box"><div class="a-brand__text" style="overflow:hidden;height:1.3em">a design that stops at one line<br>and hides the second one</div></div>`)
    const result = await measure(page)
    expect(result.findings).toEqual([])
    expect(result.designed).toHaveLength(2) // its two lines of text, both cut by the one clamp
  })
})

// The worst-case text is within the limits that the server enforces, and is long enough to be a worst case.
test('the invented text is at the limit of its field and about 40 characters for a name', () => {
  for (const [lang, worker] of Object.entries(WORKERS)) {
    expect(worker.name.length, `${lang} name`).toBeGreaterThanOrEqual(36)
    expect(worker.name.length, `${lang} name`).toBeLessThanOrEqual(44)
    expect(worker.company.length, `${lang} company`).toBeGreaterThanOrEqual(36)
    expect(worker.company.length, `${lang} company`).toBeLessThanOrEqual(44)
  }
  expect(BUILDING_NAME.length).toBeGreaterThan(BUILDING_NAME_MAX_LENGTH - 15)
  expect(BUILDING_ADDRESS.length).toBeGreaterThan(ADDRESS_MAX_LENGTH - 20)
  expect(POINT_NAME.length).toBeGreaterThan(NAME_MAX_LENGTH - 15)
  expect(POINT_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH)
  expect(MEMBER_EMAIL.length).toBeLessThanOrEqual(EMAIL_MAX_LENGTH)
})
