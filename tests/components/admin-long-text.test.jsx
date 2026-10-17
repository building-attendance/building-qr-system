// @vitest-environment jsdom
// Long values in the committee app's cards and rows (owner decisions of 16/10/2026): the tile "מי סורק" of a point names two providers, each on a line of its own that stops at two lines (owner decision of 17/10/2026), and
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

async function showPoint(over, providers = PROVIDERS) {
  api.mockImplementation(async (url) => {
    if (url === '/admin/points') return { points: [point(over)] }
    if (url === '/admin/providers') return { providers }
    throw new Error(`the test does not expect ${url}`)
  })
  render(<ToastProvider><ConfirmProvider><PointsView /></ConfirmProvider></ToastProvider>)
  const tile = (await screen.findByRole('heading', { name: 'לובי', level: 2 }, WAIT)).closest('article')
  // the tile asks for the providers too: wait until their names have replaced the "…" that stands for a name that is not known yet
  await vi.waitFor(() => expect(tile.textContent).not.toContain('…'), WAIT)
  return tile
}
const whoScans = (tile) => within(tile).getByText('מי סורק').closest('div').querySelector('dd')
/** The lines that a person sees in the cell: one element for each drawn name and one for the drawn "ועוד N", without the parts for a screen reader only (`w-sr`). */
const lines = (dd) => [...dd.children].filter((el) => !el.classList.contains('w-sr'))
/** The drawn names: each is an element of its own that `.a-clamp-2` cuts at two lines. */
const drawn = (dd) => [...dd.children].filter((el) => el.classList.contains('a-clamp-2'))
/** What a screen reader is given: the text of the cell without the part that is hidden from it (`aria-hidden`, the drawn "ועוד N"). */
const heard = (dd) => {
  const copy = dd.cloneNode(true)
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return copy.textContent
}
/**
 * How a clamped box takes its direction. The ellipsis of a clamp goes at the end of the box in the box's own direction, so a box that kept the
 * direction of a right-to-left card put the ellipsis of a Russian or Latin name at the left of its last word. A box takes the direction of its
 * own text instead: `dir="auto"`, or a `bdi`, which is auto when it has no `dir`; an address is always left to right.
 */
const directionOf = (el) => el.getAttribute('dir') ?? (el.tagName === 'BDI' ? 'auto' : 'the direction of the card')
/** A drawn name is a `bdi` (R3) that is the clamped box itself, so it takes the direction of its own text, and it holds the whole name and nothing else. */
const expectDrawn = (el, name) => {
  expect(el.tagName, `${name} is a bdi`).toBe('BDI')
  expect(el.classList.contains('a-clamp-2'), `${name} is clamped to two lines`).toBe(true)
  expect(directionOf(el), `${name} takes the direction of its own text, so that its ellipsis lands at the end of the name`).toBe('auto')
  expect([...el.childNodes].map((n) => `${n.nodeName}:${n.textContent}`), `${name}: the whole name and nothing else`).toEqual([`#text:${name}`])
}

describe('the tile "מי סורק" of a point', () => {
  const some = (n) => PROVIDERS.slice(0, n).map((p) => p.id)
  const names = (n) => PROVIDERS.slice(0, n).map((p) => p.contact_name)

  it('says "כל נותני השירות" when no provider is chosen', async () => {
    const dd = whoScans(await showPoint({ provider_ids: [] }))
    expect(dd.textContent).toBe('כל נותני השירות')
  })

  it('names one provider on a clamped line of its own, and no "ועוד"', async () => {
    const one = whoScans(await showPoint({ provider_ids: some(1) }))
    expect(lines(one)).toHaveLength(1)
    expectDrawn(lines(one)[0], names(1)[0])
    expect(one.textContent).not.toContain('ועוד')
    expect(heard(one)).toBe(names(1)[0])
  })

  it('names two providers, each on a clamped line of its own, with no visible comma between them and no "ועוד"', async () => {
    const two = whoScans(await showPoint({ provider_ids: some(2) }))
    expect(drawn(two).length, 'the two names are two separate elements').toBe(2)
    expect(lines(two), 'and they are all that is drawn').toEqual(drawn(two))
    drawn(two).forEach((el, i) => expectDrawn(el, names(2)[i]))
    expect(two.textContent).not.toContain('ועוד')
    expect(lines(two).map((el) => el.textContent).join('')).not.toContain(',')
    expect([...two.querySelectorAll('.w-sr')].map((el) => el.textContent), 'what is hidden from view is the delimiter between the two names, for a screen reader').toEqual([', '])
    expect(heard(two)).toBe(names(2).join(', '))
  })

  it('names two and says "ועוד 1" for a third, on a line of its own', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(3) }))
    expect(lines(dd).map((el) => el.textContent)).toEqual([...names(3).slice(0, 2), 'ועוד 1'])
    expect(drawn(dd).length, 'two names are drawn').toBe(2)
    drawn(dd).forEach((el, i) => expectDrawn(el, names(3)[i]))
    const more = lines(dd)[2]
    expect(more.parentElement, 'the count is an element of the cell, not a piece of the last name').toBe(dd)
    expect(getComputedStyle(more).display, 'a block, so a line of its own').toBe('block')
    expect(more.classList.contains('a-clamp-2')).toBe(false)
    expect(dd.querySelectorAll('.w-sr bdi').length, 'the third is in the run for a screen reader, isolated too').toBe(1)
  })

  it('counts every one that is left: "ועוד 3" for five', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(5) }))
    expect(lines(dd).map((el) => el.textContent)).toEqual([...names(5).slice(0, 2), 'ועוד 3'])
  })

  it('hides the count from a screen reader, which hears every name once, separated by ", ", and no "and 3 more"', async () => {
    const dd = whoScans(await showPoint({ provider_ids: some(5) }))
    expect([...dd.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent), 'only the count is hidden from a screen reader').toEqual(['ועוד 3'])
    expect(heard(dd)).toBe(names(5).join(', '))
    for (const name of names(5)) expect(heard(dd).split(name).length - 1, `${name} is heard once`).toBe(1)
    expect(dd.lastElementChild.textContent, 'the names that are not drawn follow, each with its own delimiter').toBe(`, ${names(5).slice(2).join(', ')}`)
    for (const name of names(5)) expect(dd.textContent).toContain(name) // all five are in the page
  })

  it('isolates every name, the drawn ones and the hidden ones, in a bdi of its own (a Latin name, a Russian one, one with digits and punctuation)', async () => {
    const NAMES = ['Cleaning Co. 24/7 (A-1)', 'Константин Иванов', 'John Smith', 'Cleaning & Co., Ltd. 24/7 (A-1)', 'Gebaeude, GmbH (24/7)']
    const providers = NAMES.map((contact_name, i) => ({ ...PROVIDERS[0], id: `h${i}`, contact_name }))
    const dd = whoScans(await showPoint({ provider_ids: providers.map((p) => p.id) }, providers))
    // what the cell is made of, in order: a clamped line, the delimiter for a screen reader, a clamped line, the count, the hidden run
    expect([...dd.children].map((el) => (el.classList.contains('a-clamp-2') ? 'name' : el.classList.contains('w-sr') ? 'delimiter' : 'count'))).toEqual(
      ['name', 'delimiter', 'name', 'count', 'delimiter'],
    )
    drawn(dd).forEach((el, i) => expectDrawn(el, NAMES[i]))
    const hidden = dd.lastElementChild
    // the run is, name by name, a plain ", " and then the name in a bdi: no name stands bare in the run, so none can reorder its neighbours
    expect([...hidden.childNodes].map((n) => (n.nodeName === 'BDI' ? `bdi:${n.textContent}` : `text:${n.textContent}`))).toEqual(
      NAMES.slice(2).flatMap((name) => ['text:, ', `bdi:${name}`]),
    )
    expect(heard(dd), 'a screen reader is given every name once, separated by ", "').toBe(NAMES.join(', '))
    expect(dd.querySelectorAll('bdi').length, 'two drawn and three hidden').toBe(5)
  })

  it('isolates each name (a Latin or Russian one keeps its order inside the Hebrew line)', async () => {
    const dd = whoScans(await showPoint({ provider_ids: [PROVIDERS[1].id, PROVIDERS[2].id] }))
    expect([...dd.querySelectorAll('bdi')].map((el) => el.textContent)).toEqual([PROVIDERS[1].contact_name, PROVIDERS[2].contact_name])
    drawn(dd).forEach((el, i) => expectDrawn(el, [PROVIDERS[1], PROVIDERS[2]][i].contact_name))
  })
})

describe('the description of a point', () => {
  it('is clamped to two lines by CSS, and is whole in the page', async () => {
    const tile = await showPoint({ description: LONG_DESCRIPTION })
    const description = within(tile).getByText(LONG_DESCRIPTION)
    expect(description.classList.contains('a-clamp-2')).toBe(true)
    expect(directionOf(description), 'a description in Latin letters ends with its ellipsis at its own end').toBe('auto')
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
    expect(directionOf(who), 'a Russian or Latin name ends with its ellipsis at its own end').toBe('auto')
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
    // what it is about, and who did it, are clamped boxes of their own beside the phrase and the word "by" (which are never cut), and each takes
    // the direction of its own text
    const subject = what.querySelector('.a-audit__subject')
    expect(subject.classList.contains('a-clamp-2')).toBe(true)
    expect(subject.textContent).toBe(SUBJECT)
    expect(directionOf(subject)).toBe('auto')
    expect(what.classList.contains('a-clamp-2'), 'the phrase is not clamped with it').toBe(false)
    expect(what.textContent).toContain(SUBJECT)
    const name = who.querySelector('.a-clamp-2')
    expect(name.parentElement, 'the name is a box of its own, beside the word "by"').toBe(who)
    expect(name.textContent).toBe(ACTOR)
    expect(directionOf(name)).toBe('auto')
    expect(who.classList.contains('a-clamp-2'), 'the word "by" is not clamped with it').toBe(false)
    expect(who.textContent).toBe(`על ידי ${ACTOR}`)
  })

  describe('who did it, when the actor is named by an e-mail address (a member with no saved name)', () => {
    const ADDRESS = 'bartholomew.fitzgerald@northwind.example.test'
    async function actorRow(over) {
      api.mockImplementation(async (url) => {
        if (url === '/admin/admins') return { admins: [] }
        if (url.startsWith('/admin/audit')) {
          return {
            entries: [{
              id: 9, at: '2026-10-05T07:14:00.000Z', action: 'point.update', entity: 'point', entity_id: 'p1', entity_name: 'לובי',
              actor_type: 'admin', actor_id: 'a1', actor_name: ADDRESS, actor_deleted: false, detail: null, ...over,
            }],
            next_cursor: null,
          }
        }
        throw new Error(`the test does not expect ${url}`)
      })
      render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
      return (await screen.findByText('עדכון נקודה', { selector: '.a-audit__action' }, WAIT)).closest('li').querySelector('.a-audit__who')
    }

    it('draws the address with the helper, inside the clamped line: a left-to-right isolate in whole pieces', async () => {
      const who = await actorRow({})
      const box = who.querySelector('.a-clamp-2')
      expect(box.parentElement, 'the address is a clamped box of its own, beside the word "by"').toBe(who)
      expect(directionOf(box), 'an address is always left to right: its ellipsis is at its right end').toBe('ltr')
      expect(who.classList.contains('a-clamp-2'), 'the word "by" is not clamped with it').toBe(false)
      expect(who.textContent).toBe(`על ידי ${ADDRESS}`)
      const address = who.querySelector('bdi[dir="ltr"]')
      expect(address.textContent).toBe(ADDRESS)
      expect([...address.querySelectorAll('.a-email__piece')].map((el) => el.textContent)).toEqual(['bartholomew.', 'fitzgerald@', 'northwind.', 'example.', 'test'])
      expect(who.querySelectorAll('bdi').length, 'one isolate: the address').toBe(1)
    })

    it('keeps the mark of a member who is gone outside the address, in an isolate of its own', async () => {
      const who = await actorRow({ actor_deleted: true })
      expect(who.textContent).toBe(`על ידי ${ADDRESS} (נמחק)`)
      const isolates = [...who.querySelectorAll('bdi')]
      expect(isolates.map((el) => el.textContent)).toEqual([ADDRESS, '(נמחק)'])
      expect(isolates[0].getAttribute('dir')).toBe('ltr')
      expect(isolates[0].textContent, 'the mark is not part of the address').not.toContain('נמחק')
    })

    it('leaves a name that is not an address as it was: one isolate, with its mark', async () => {
      const who = await actorRow({ actor_name: 'אבי מזרחי', actor_deleted: true })
      expect([...who.querySelectorAll('bdi')].map((el) => el.textContent)).toEqual(['אבי מזרחי (נמחק)'])
      expect(who.querySelector('.a-email__piece')).toBeNull()
    })
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

// ---- the direction of a clamped box ----------------------------------------------------------------------------------------------

describe('a clamped box takes the direction of its own text, so that its ellipsis lands at the end of the name', () => {
  const RUSSIAN = 'Константин Константинович Примеров-Образцовский, старший бригадир по уборке' // under the 80 characters that the audit screen shows of a name

  it('every clamped box in the screens of the committee app is a bdi or has a dir attribute (read from the source, so that a new one cannot forget it)', () => {
    const root = path.join(process.cwd(), 'src', 'admin')
    const found = []
    for (const name of fs.readdirSync(root, { recursive: true })) {
      if (!String(name).endsWith('.jsx')) continue
      const source = fs.readFileSync(path.join(root, String(name)), 'utf8')
      for (const tag of source.matchAll(/<(\w+)([^<>]*\ba-clamp-2\b[^<>]*)>/g)) found.push({ name: String(name), tag: tag[1], attributes: tag[2] })
    }
    expect(found.length, 'the boxes that the screens clamp, found by their class').toBeGreaterThanOrEqual(7)
    for (const { name, tag, attributes } of found) {
      expect(tag === 'bdi' || /\sdir=/.test(attributes), `${name}: <${tag}${attributes}> is clamped and takes no direction of its own`).toBe(true)
    }
  })

  it('a Russian name and a Latin one in the tile of a point, an audit entry (what it is about, and who did it) get their own direction', async () => {
    const tile = await showPoint({ provider_ids: ['r1', 'l1'] }, [
      { ...PROVIDERS[0], id: 'r1', contact_name: RUSSIAN },
      { ...PROVIDERS[0], id: 'l1', contact_name: 'Cleaning Co. 24/7 (A-1)' },
    ])
    for (const el of drawn(whoScans(tile))) expect(directionOf(el)).toBe('auto')
    cleanup()
    api.mockImplementation(async (url) => {
      if (url === '/admin/admins') return { admins: [] }
      if (url.startsWith('/admin/audit')) {
        return {
          entries: [{
            id: 1, at: '2026-10-05T07:14:00.000Z', action: 'provider.update', entity: 'provider', entity_id: 'p1', entity_name: RUSSIAN,
            actor_type: 'admin', actor_id: 'a1', actor_name: 'John Smith', actor_deleted: false, detail: null,
          }],
          next_cursor: null,
        }
      }
      throw new Error(`the test does not expect ${url}`)
    })
    render(<ToastProvider><ConfirmProvider><AuditView /></ConfirmProvider></ToastProvider>)
    const row = (await screen.findByText('עדכון נותן שירות', { selector: '.a-audit__action' }, WAIT)).closest('li')
    expect(directionOf(row.querySelector('.a-audit__subject'))).toBe('auto')
    expect(row.querySelector('.a-audit__subject').textContent).toBe(RUSSIAN)
    expect(directionOf(row.querySelector('.a-audit__who .a-clamp-2'))).toBe('auto')
    expect(row.querySelector('.a-audit__who .a-clamp-2').textContent).toBe('John Smith')
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

  it('.a-clamp-2 sets neither the direction nor the alignment: the box takes its direction from its text (measured: Chromium leaves out the ellipsis of a right-aligned left-to-right line that has room to spare)', () => {
    expect(ruleOf('.a-clamp-2')).not.toMatch(/\b(?:direction|text-align|unicode-bidi)\s*:/)
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
