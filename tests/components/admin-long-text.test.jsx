// @vitest-environment jsdom
// Long values in the committee app's cards and rows (owner decisions of 16/10/2026): the tile "מי סורק" of a point names two providers and
// then "ועוד N", the description of a point, the provider's name of a History row, and the audit log's "what" and "who" stop at two lines,
// and the account button's name and address stop at one. jsdom has no layout, so a line cannot be counted here. What is tested is what
// the markup and the stylesheet decide: the class that clamps, the rule that it names, and, above all, that the clamped text is still
// whole in the page, because the cut is the browser's and a screen reader and a copy get everything. The lines themselves are measured
// in a real browser (e2e/admin.spec.js, "a long service name, a long description ...").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, within, cleanup } from '@testing-library/react'
import PointsView from '../../src/admin/views/PointsView.jsx'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import AuditView from '../../src/admin/views/AuditView.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { clearLoadCache } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE, GPS_MODE_REQUIRED, DESCRIPTION_MAX_LENGTH } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
vi.mock('../../src/admin/MapPicker.jsx', () => ({ default: () => null }))

const WAIT = { timeout: 4000 }
const CSS = fs.readFileSync(path.join(process.cwd(), 'src', 'admin', 'admin.css'), 'utf8')

/** The body of the first CSS rule whose selector list is exactly `selector`, as declarations. */
function ruleOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = CSS.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  expect(match, `admin.css has no rule for ${selector}`).toBeTruthy()
  return match[1]
}

const PROVIDERS = ['דנה לוי', 'Gebaeudereinigungsunternehmensdienstleistungsgesellschaft', 'Константин Константинович', 'פלוני בן אלמוני', 'John'].map((contact_name, i) => ({
  id: `p${i}`, company: `חברה ${i}`, contact_name, is_active: true, is_demo: false, has_password: true, service_type: null, last_scan_at: null,
  active_devices: 0, waiting: 0, oldest_waiting_at: null, outdated_devices: 0,
}))
const LONG_DESCRIPTION = 'הנקודה נמצאת מיד אחרי הזכוכית הראשית, ליד עמדת השמירה. '.repeat(Math.floor(DESCRIPTION_MAX_LENGTH / 55)).trim()
const point = (over = {}) => ({
  id: 'pt1', name: 'לובי', description: null, is_active: true, gps_mode: GPS_MODE_REQUIRED, lat: 32.0853, lng: 34.7818, radius_m: 40, service_type: null,
  scan_count: 0, provider_ids: [], qr_url: 'https://example.test/scan?code=x', ...over,
})

beforeEach(() => clearLoadCache())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---- the point card --------------------------------------------------------------------------------------------------------------

async function showPoint(over) {
  api.mockImplementation(async (url) => {
    if (url === '/admin/points') return { points: [point(over)] }
    if (url === '/admin/providers') return { providers: PROVIDERS }
    throw new Error(`the test does not expect ${url}`)
  })
  render(<ToastProvider><ConfirmProvider><PointsView /></ConfirmProvider></ToastProvider>)
  const tile = (await screen.findByRole('heading', { name: 'לובי', level: 2 }, WAIT)).closest('article')
  // the tile asks for the providers too: wait until their names have replaced the "…" that stands for a name that is not known yet
  await vi.waitFor(() => expect(tile.textContent).not.toContain('…'), WAIT)
  return tile
}
const whoScans = (tile) => within(tile).getByText('מי סורק').closest('div').querySelector('dd')
/** What a person sees in the tile: the text without the part that is for a screen reader only (`w-sr`) and without the part that is hidden from one. */
const seen = (dd) => [...dd.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('w-sr'))).map((n) => n.textContent).join('')

describe('the tile "מי סורק" of a point', () => {
  const some = (n) => PROVIDERS.slice(0, n).map((p) => p.id)
  const names = (n) => PROVIDERS.slice(0, n).map((p) => p.contact_name)

  it('says "כל נותני השירות" when no provider is chosen', async () => {
    const dd = whoScans(await showPoint({ provider_ids: [] }))
    expect(dd.textContent).toBe('כל נותני השירות')
  })

  it('names one provider, and no "ועוד"', async () => {
    const one = whoScans(await showPoint({ provider_ids: some(1) }))
    expect(seen(one)).toBe(names(1)[0])
    expect(one.textContent).not.toContain('ועוד')
  })

  it('names two providers, and no "ועוד", and nothing is hidden from view', async () => {
    const two = whoScans(await showPoint({ provider_ids: some(2) }))
    expect(seen(two)).toBe(names(2).join(', '))
    expect(two.textContent).not.toContain('ועוד')
    expect(two.querySelector('.w-sr')).toBeNull()
  })

  it('names two and says "ועוד 1" for a third', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(3) }))
    expect(seen(dd)).toBe(`${names(3).slice(0, 2).join(', ')} ועוד 1`)
    expect(dd.querySelectorAll('bdi').length, 'two names are drawn').toBe(2)
  })

  it('counts every one that is left: "ועוד 3" for five', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(5) }))
    expect(seen(dd)).toBe(`${names(5).slice(0, 2).join(', ')} ועוד 3`)
  })

  it('keeps every name in the page for a screen reader, and hides the count from it, so that it hears each name once and no "and 3 more"', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(5) }))
    expect(dd.querySelector('[aria-hidden="true"]').textContent).toBe('ועוד 3')
    const hidden = dd.querySelector('.w-sr')
    expect(hidden.textContent).toBe(`, ${names(5).slice(2).join(', ')}`)
    for (const name of names(5)) expect(dd.textContent).toContain(name) // all five are in the page
  })

  it('isolates each name (a Latin or Russian one keeps its order inside the Hebrew line)', async () => {
    const dd = whoScans(await showPoint({ provider_ids: [PROVIDERS[1].id, PROVIDERS[2].id] }))
    expect([...dd.querySelectorAll('bdi')].map((el) => el.textContent)).toEqual([PROVIDERS[1].contact_name, PROVIDERS[2].contact_name])
  })
})

describe('the description of a point', () => {
  it('is clamped to two lines by CSS, and is whole in the page', async () => {
    const tile = await showPoint({ description: LONG_DESCRIPTION })
    const description = within(tile).getByText(LONG_DESCRIPTION)
    expect(description.classList.contains('a-clamp-2')).toBe(true)
    expect(description.textContent).toBe(LONG_DESCRIPTION) // cut by the browser, never by the code: nothing of it is missing from the page
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(DESCRIPTION_MAX_LENGTH - 60)
  })

  it('has no second line at all when the point has none', async () => {
    const tile = await showPoint({ description: null })
    expect(tile.querySelector('.a-clamp-2')).toBeNull()
  })
})

// ---- the History and the audit log -------------------------------------------------------------------------------------------------

const LONG_PROVIDER = 'פלוני בן אלמוני פלוני הדוגמה הראשון, מנהל הצוות לחדרי מדרגות ומעליות באזור הצפון והמרכז של העיר (חברת הניקיון, התחזוקה והשירות המקצועית לבנייני מגורים)'

describe('a row of the History', () => {
  it('clamps the name of the provider to two lines, and the whole name is in the page', async () => {
    api.mockImplementation(async (url) => {
      if (url === '/admin/points') return { points: [{ id: 'pt1', name: 'לובי' }] }
      if (url === '/admin/providers') return { providers: [] }
      if (url.startsWith('/admin/scans?')) {
        return {
          scans: [{
            id: 's1', local_date: '2026-10-05', checked_in_at: '2026-10-05T06:00:00Z', point_id: 'pt1', point_name: 'לובי', provider_id: 'p1',
            provider_name: LONG_PROVIDER, outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE, distance_m: null, gps_accuracy_m: null, flags: [], voided: false, void_reason: null,
          }],
          next_cursor: null,
        }
      }
      throw new Error(`the test does not expect ${url}`)
    })
    render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
    const who = await screen.findByText(LONG_PROVIDER, {}, WAIT)
    expect(who.classList.contains('a-clamp-2')).toBe(true)
    expect(who.textContent).toBe(LONG_PROVIDER)
    expect(within(who.closest('li')).getByText('לובי').classList.contains('a-clamp-2'), 'the point is not clamped: only the provider is').toBe(false)
  })
})

describe('an entry of the audit log', () => {
  it('clamps what it says and who did it to two lines, and both are whole in the page', async () => {
    const ACTOR = 'אברהם-יצחק בן-ציון הדוגמה-רוזנברג השני, יושב ראש הוועד ואחראי על הבניין' // the screen itself cuts a name at 80 characters (VALUE_MAX)
    const SUBJECT = 'פלוני בן אלמוני פלוני הדוגמה הראשון, מנהל הצוות לחדרי מדרגות ומעליות באזור'
    api.mockImplementation(async (url) => {
      if (url === '/admin/admins') return { admins: [] }
      if (url.startsWith('/admin/audit')) {
        return {
          entries: [{
            id: 1, at: '2026-10-05T07:14:00.000Z', action: 'provider.update', entity: 'provider', entity_id: 'p1', entity_name: SUBJECT,
            actor_type: 'admin', actor_id: 'a1', actor_name: ACTOR, actor_deleted: false, detail: null,
          }],
          next_cursor: null,
        }
      }
      throw new Error(`the test does not expect ${url}`)
    })
    render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
    const row = (await screen.findByText('עדכון נותן שירות', { selector: '.a-audit__action' }, WAIT)).closest('li')
    const what = row.querySelector('.a-audit__what')
    const who = row.querySelector('.a-audit__who')
    expect(what.classList.contains('a-clamp-2')).toBe(true)
    expect(what.textContent).toContain(SUBJECT)
    expect(who.classList.contains('a-clamp-2')).toBe(true)
    expect(who.textContent).toBe(`על ידי ${ACTOR}`)
  })

  it('draws the e-mail line of a member who was added with the address helper (it may break after "@" and dots)', async () => {
    const ADDRESS = 'bartholomew.fitzgerald@northwind-industries-holdings.example.test'
    api.mockImplementation(async (url) => {
      if (url === '/admin/admins') return { admins: [] }
      if (url.startsWith('/admin/audit')) {
        return {
          entries: [{
            id: 2, at: '2026-10-05T07:14:00.000Z', action: 'admin.add', entity: 'admin', entity_id: 'a2', entity_name: 'גילה',
            actor_type: 'admin', actor_id: 'a1', actor_name: 'דנה', actor_deleted: false, detail: { email: ADDRESS },
          }],
          next_cursor: null,
        }
      }
      throw new Error(`the test does not expect ${url}`)
    })
    render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
    const row = (await screen.findByText('הוספת מנהל מערכת', { selector: '.a-audit__action' }, WAIT)).closest('li')
    const line = within(row.querySelector('.a-audit__detail')).getByText((_, el) => el.tagName === 'BDI')
    expect(line.textContent).toBe(ADDRESS)
    expect(line.getAttribute('dir')).toBe('ltr')
    expect([...line.querySelectorAll('.a-email__piece')].map((el) => el.textContent).join('|')).toBe('bartholomew.|fitzgerald@|northwind-industries-holdings.|example.|test')
  })

  it('draws the subject of an entry with the same helper when the subject is an address (a member that has no name), and a name as plain text', async () => {
    const ADDRESS = 'bartholomew.fitzgerald@northwind.example.test'
    api.mockImplementation(async (url) => {
      if (url === '/admin/admins') return { admins: [] }
      if (url.startsWith('/admin/audit')) {
        return {
          entries: ['admin.disable', 'admin.enable'].map((action, i) => ({
            id: 3 + i, at: '2026-10-05T07:14:00.000Z', action, entity: 'admin', entity_id: 'a2', entity_name: i === 0 ? ADDRESS : 'גילה לוי',
            actor_type: 'admin', actor_id: 'a1', actor_name: 'דנה', actor_deleted: false, detail: null,
          })),
          next_cursor: null,
        }
      }
      throw new Error(`the test does not expect ${url}`)
    })
    render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
    const address = (await screen.findByText('השבתת מנהל מערכת', { selector: '.a-audit__action' }, WAIT)).closest('li').querySelector('.a-audit__subject')
    expect(address.textContent).toBe(ADDRESS)
    expect(address.querySelector('bdi[dir="ltr"]')).toBeTruthy()
    expect(address.querySelectorAll('.a-email__piece').length).toBe(5)
    const name = (await screen.findByText('הפעלת מנהל מערכת', { selector: '.a-audit__action' }, WAIT)).closest('li').querySelector('.a-audit__subject')
    expect(name.textContent).toBe('גילה לוי')
    expect(name.querySelector('bdi')).toBeNull()
  })
})

// ---- what the stylesheet says ---------------------------------------------------------------------------------------------------

describe('the stylesheet (src/admin/admin.css)', () => {
  it('.a-clamp-2 is a two-line clamp, in the prefixed and the standard property', () => {
    const rule = ruleOf('.a-clamp-2')
    expect(rule).toMatch(/overflow:\s*hidden/)
    expect(rule).toMatch(/display:\s*-webkit-box/)
    expect(rule).toMatch(/-webkit-box-orient:\s*vertical/)
    expect(rule).toMatch(/-webkit-line-clamp:\s*2\b/)
    expect(rule).toMatch(/(?<!-webkit-)line-clamp:\s*2\b/)
  })

  it('a badge wraps inside its card: it may be as wide as its room and breaks a long word, and it is never nowrap', () => {
    const rule = ruleOf('.a-badge')
    expect(rule).toMatch(/max-width:\s*100%/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule).not.toMatch(/white-space:\s*nowrap/)
    expect(CSS, 'no later rule makes a badge nowrap again').not.toMatch(/\.a-badge[^{]*\{[^}]*white-space:\s*nowrap/)
  })

  it("the rail's account button keeps the name and the address to one line with an ellipsis, and the menu is not touched by it", () => {
    const rule = ruleOf('.a-account-btn .a-who strong, .a-who .a-who__mail')
    expect(rule).toMatch(/overflow:\s*hidden/)
    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
    expect(CSS, 'the name of the menu is not one of the selectors').not.toMatch(/\.a-account__who[^{]*strong[^{]*\{[^}]*nowrap/)
  })

  it('an address may still break anywhere as the last resort: the boxes that hold it keep overflow-wrap: anywhere', () => {
    for (const selector of ['.a-who { flex: 1; min-width: 0;', '.a-card__sub {']) expect(CSS, selector).toContain(selector)
    expect(ruleOf('.a-who')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleOf('.a-card__sub')).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
