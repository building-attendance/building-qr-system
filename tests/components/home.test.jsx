// @vitest-environment jsdom
// The Home screen of the committee app (src/admin/views/HomeView.jsx): a greeting and the date, a summary card (the total of the seven days
// and a bar for each day), the service providers of those days (a dot for each day), a tile for each number that has a screen, and a short
// list. It shows counts and nothing else (the app records facts and does not analyse them), so there is no trend, no average and no score to
// test for: what these tests hold is what the screen does show, and where each number leads.
//
// The real HomeView, and for the part about links, the real AdminApp with the real History screen behind it, with the network (`api`)
// answered by the test and the clock of `Date` set by the test (the greeting and the date follow the hour of the building's clock).
//   - the greeting and the date: the three windows of the greeting to the minute, in summer and in winter time; the first word of the name,
//     none when there is no name; the screen that stays open follows the clock;
//   - the summary card: the total, a table whose name is the range in DD/MM/YYYY, heads that write DD/MM and are named by the full date,
//     the days in the order the server gives them, a bar for each day (a link to that day's History when there are visits, the number 0
//     and no link when there are none), today marked;
//   - the providers: a row for each, in the order of the server, a link to that provider's History for the seven days, a dot for each day
//     that a screen reader is told about, the total, and the words of a provider that is switched off or was deleted;
//   - the tiles and their links (the waiting phones only when there is one), and the two rows of the short list;
//   - the states: loading, an error with "נסו שוב", a building with nothing in it, and the answer kept from the last visit;
//   - the links followed in the real app: a bar and a provider open the History with exactly their filters, on a phone and on a computer,
//     Back returns to Home, and the window crossing 1024 px does not draw Home again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import HomeView from '../../src/admin/views/HomeView.jsx'
import AdminApp from '../../src/pages/AdminApp.jsx'
import { LOAD_KEY, clearLoadCache, readLoadCache, setLoadCache } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

window.scrollTo = vi.fn() // the shell scrolls to the top on a tab change; jsdom has no scrolling

// ---- the data (invented: nobody real) ---------------------------------------------------------------------------------------------

const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']
const ids = {
  ploni: '33333333-3333-4333-8333-333333333333',
  almoni: '55555555-5555-4555-8555-555555555555',
  solo: '88888888-8888-4888-8888-888888888888',
  ivan: '66666666-6666-4666-8666-666666666666',
  gone: '77777777-7777-4777-8777-777777777777',
}
const PLONI = { id: ids.ploni, name: 'פלוני', company: 'ניקיון', is_active: true, counts: [1, 2, 0, 4, 7, 3, 2] }
const ALMONI = { id: ids.almoni, name: 'אלמוני', company: 'גינון', is_active: true, counts: [0, 0, 1, 0, 0, 12, 0] }
const SOLO = { id: ids.solo, name: 'גינון אלון', company: 'גינון אלון', is_active: true, counts: [0, 0, 0, 0, 0, 0, 0] } // one name: no second line
const IVAN = { id: ids.ivan, name: 'Иван', company: 'Уборка', is_active: false, counts: [0, 1, 0, 0, 0, 0, 0] }
const GONE = { id: ids.gone, name: 'ספק ישן', company: null, is_active: false, counts: [0, 0, 2, 0, 0, 0, 0] }
const ALL = [PLONI, ALMONI, SOLO, IVAN, GONE]
const totalsOf = (providers) => DAYS.map((_, i) => providers.reduce((sum, p) => sum + p.counts[i], 0))
const sumOf = (numbers) => numbers.reduce((a, b) => a + b, 0)

/** What GET /api/admin/home answers (HomeSummary, shared/types.js). Every part can be changed by the test. */
function homeSummary({ providers = ALL, days = DAYS, counts = {} } = {}) {
  return {
    days,
    week: { providers, totals: totalsOf(providers) },
    counts: {
      points: { active: 3, total: 4 },
      providers: { active: 3, total: 5 },
      committee_members: { active: 2 },
      agent_keys: { active: 1 },
      visits_not_counted: 6,
      waiting: { phones: 2, visits: 5 },
      ...counts,
    },
  }
}
const EMPTY_BUILDING = homeSummary({
  providers: [],
  counts: { points: { active: 0, total: 0 }, providers: { active: 0, total: 0 }, committee_members: { active: 1 }, agent_keys: { active: 0 }, visits_not_counted: 0, waiting: { phones: 0, visits: 0 } },
})

const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sample Member', email: 'member@example.test' }
const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }

// ---- the clock, the server, the screen --------------------------------------------------------------------------------------------

/** The moment of the test, as an ISO string. Only `Date` is faked: Testing Library's waiting keeps running on real timers. */
function at(iso) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
const MORNING = '2026-10-12T07:00:00Z' // 10:00 in the building (UTC+3 in October), on the last of DAYS

/** What the server answers: Home's numbers (a value, or a function that is called for each request), and the lists History asks for. */
function server({ home = homeSummary() } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/admin/home') return typeof home === 'function' ? home() : home
    if (path === '/admin/config') return { google_client_id: '', dev_login: false }
    if (path === '/admin/me') return { admin: ADMIN }
    if (path === '/admin/building') return { building: { address: '' } }
    if (path === '/admin/points') return { points: [POINT] }
    if (path === '/admin/providers') return { providers: [{ id: ids.ploni, company: 'ניקיון', contact_name: 'פלוני' }, { id: ids.almoni, company: 'גינון', contact_name: 'אלמוני' }] }
    if (path.startsWith('/admin/scans')) return { scans: [], next_cursor: null }
    if (path.startsWith('/admin/scan-refusals')) return { refusals: [], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}
const homeCalls = () => api.mock.calls.filter(([path]) => path === '/admin/home').length
const asked = (prefix) => api.mock.calls.map(([path]) => path).filter((path) => path.startsWith(prefix)).map((path) => Object.fromEntries(new URL(path, 'http://x').searchParams))

const show = (admin = ADMIN) => render(<HomeView admin={admin} />)
const showed = async (options) => {
  const view = show(options)
  await screen.findByRole('table')
  return view
}
const greeting = () => screen.getByRole('heading', { level: 1 }).textContent
const TITLE = 'השבוע בבניין'
const PROVIDERS_TITLE = 'נותני שירות השבוע'
const RANGE = '06/10/2026 עד 12/10/2026'
const summary = () => screen.getByRole('region', { name: TITLE })
const table = () => within(summary()).getByRole('table')
const heads = () => within(table()).getAllByRole('columnheader')
const barCells = () => [...table().querySelectorAll('tbody td')]
/** The row of one provider, by its name. */
const rowOf = (name) => screen.getByText(name, { selector: '.a-who__name' }).closest('li')
const rowLink = (name) => within(rowOf(name)).getByRole('link')
const tiles = () => [...document.querySelectorAll('.a-tiles a.a-tile')]
const tile = (name) => screen.getByRole('link', { name: new RegExp(name) })
const hrefOf = (link) => link.getAttribute('href')
const weekOf = (id) => `#history?provider=${id}&from=2026-10-06&to=2026-10-12`

/** Stands in for `window.matchMedia` with the query of 1024 px, whose answer the test changes (the window crossing 1024 px). */
function layout(startAsPhone) {
  let phone = startAsPhone
  const listeners = new Set()
  const query = {
    get matches() { return !phone },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }
  window.matchMedia = vi.fn(() => query)
  const change = (toPhone) => act(() => { phone = toPhone; for (const listener of listeners) listener() })
  return { phone: () => change(true), computer: () => change(false) }
}

beforeEach(() => {
  clearLoadCache()
  at(MORNING)
})
afterEach(() => {
  cleanup()
  delete window.matchMedia
  window.history.replaceState(null, '', '/')
  document.title = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ---- the greeting and the date ------------------------------------------------------------------------------------------------------

describe('the greeting', () => {
  // [the moment in UTC, the time in the building, the greeting]. October is UTC+3 and January UTC+2.
  it.each([
    ['2026-10-12T01:59:00Z', '04:59', 'ערב טוב'],
    ['2026-10-12T02:00:00Z', '05:00', 'בוקר טוב'],
    ['2026-10-12T08:59:00Z', '11:59', 'בוקר טוב'],
    ['2026-10-12T09:00:00Z', '12:00', 'צהריים טובים'],
    ['2026-10-12T13:59:00Z', '16:59', 'צהריים טובים'],
    ['2026-10-12T14:00:00Z', '17:00', 'ערב טוב'],
    ['2026-10-12T21:30:00Z', '00:30 the next day', 'ערב טוב'],
    ['2026-01-15T02:59:00Z', '04:59 in winter', 'ערב טוב'],
    ['2026-01-15T03:00:00Z', '05:00 in winter', 'בוקר טוב'],
    ['2026-01-15T09:59:00Z', '11:59 in winter', 'בוקר טוב'],
    ['2026-01-15T10:00:00Z', '12:00 in winter', 'צהריים טובים'],
    ['2026-01-15T14:59:00Z', '16:59 in winter', 'צהריים טובים'],
    ['2026-01-15T15:00:00Z', '17:00 in winter', 'ערב טוב'],
  ])('at %s (%s in the building) says "%s", with the first word of the name', async (moment, _local, expected) => {
    at(moment)
    server()
    show()
    expect(screen.getByRole('heading', { level: 1, name: `${expected}, Sample` })).toBeTruthy()
    await screen.findByRole('table')
  })

  it('is by the clock of the building, not by the zone of the machine: 17:00 in the building is evening whatever UTC says', async () => {
    at('2026-10-12T14:00:00Z') // 14:00 in UTC, which would be the noon; the building is three hours ahead
    server()
    show()
    expect(greeting()).toBe('ערב טוב, Sample')
    await screen.findByRole('table')
  })

  it.each([
    ['a full name, in Hebrew', 'מתן ברוך', 'מתן'],
    ['a full name, in Latin letters', 'Sample Member', 'Sample'],
    ['one word', 'דנה', 'דנה'],
    ['a name with spaces around it and between its words', '  דנה   לוי  ', 'דנה'],
  ])('greets by the first word of the name: %s', async (_what, name, first) => {
    server()
    show({ ...ADMIN, name })
    expect(greeting()).toBe(`בוקר טוב, ${first}`)
    await screen.findByRole('table')
  })

  it.each([['null', null], ['an empty name', ''], ['only spaces', '   '], ['no name at all', undefined]])('has the greeting alone when the member has no name (%s)', async (_what, name) => {
    server()
    show({ id: ADMIN.id, email: ADMIN.email, name })
    expect(screen.getByRole('heading', { level: 1, name: 'בוקר טוב' }).textContent).toBe('בוקר טוב')
    await screen.findByRole('table')
  })

  it('has the greeting alone when the screen is given no member', async () => {
    server()
    render(<HomeView />)
    expect(greeting()).toBe('בוקר טוב')
    await screen.findByRole('table')
  })

  it('isolates the name from the Hebrew around it (bdi), so that a name in Latin letters keeps its own order', async () => {
    server()
    show()
    expect(screen.getByRole('heading', { level: 1 }).querySelector('bdi').textContent).toBe('Sample')
    await screen.findByRole('table')
  })

  it('is on the screen while the numbers load, and when they cannot', async () => {
    let fail
    api.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    show()
    expect(greeting()).toBe('בוקר טוב, Sample')
    await act(async () => { fail(new Error('no connection')) })
    expect(await screen.findByRole('button', { name: 'נסו שוב' })).toBeTruthy()
    expect(greeting()).toBe('בוקר טוב, Sample')
  })
})

describe('the date under the greeting', () => {
  const dateLine = () => screen.getByRole('heading', { level: 1 }).parentElement.querySelector('p')

  it('is today in the building, DD/MM/YYYY, kept in one piece left to right, and is not part of the heading', async () => {
    server()
    await showed()
    expect(dateLine().textContent).toBe('12/10/2026')
    expect(dateLine().querySelector('.a-stamp').textContent).toBe('12/10/2026')
    expect(greeting()).toBe('בוקר טוב, Sample') // the heading is the greeting alone
  })

  it('is the day of the building, not the day of UTC: 00:30 in the building is already the next day', async () => {
    at('2026-10-12T21:30:00Z') // 00:30 on 13/10 in the building
    server()
    show()
    expect(dateLine().textContent).toBe('13/10/2026')
    await screen.findByRole('table')
  })

  it('is on the screen while the numbers load, and when they cannot', async () => {
    api.mockImplementation(async () => { throw new Error('no connection') })
    show()
    expect(dateLine().textContent).toBe('12/10/2026')
    await screen.findByRole('button', { name: 'נסו שוב' })
    expect(dateLine().textContent).toBe('12/10/2026')
  })
})

describe('a screen that stays open follows the clock', () => {
  /** Captures the interval that the screen sets (only the one of 60 seconds): the test says when a minute has passed. */
  function minuteTimer() {
    const real = globalThis.setInterval
    const ticks = []
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, ms, ...rest) => {
      if (ms !== 60_000) return real(fn, ms, ...rest)
      ticks.push(fn)
      return 1234
    })
    const cleared = vi.spyOn(globalThis, 'clearInterval')
    return { tick: () => act(async () => { ticks.at(-1)() }), count: () => ticks.length, cleared }
  }

  it('changes the greeting when the hour changes, once a minute', async () => {
    at('2026-10-12T08:58:00Z') // 11:58
    server()
    const timer = minuteTimer()
    show()
    await screen.findByRole('table')
    expect(timer.count()).toBe(1)
    expect(greeting()).toBe('בוקר טוב, Sample')
    vi.setSystemTime(new Date('2026-10-12T08:59:30Z')) // 11:59, still the morning
    await timer.tick()
    expect(greeting()).toBe('בוקר טוב, Sample')
    vi.setSystemTime(new Date('2026-10-12T09:00:00Z')) // 12:00
    await timer.tick()
    expect(greeting()).toBe('צהריים טובים, Sample')
    vi.setSystemTime(new Date('2026-10-12T14:00:00Z')) // 17:00
    await timer.tick()
    expect(greeting()).toBe('ערב טוב, Sample')
  })

  it('stops looking at the clock when the screen is left', async () => {
    server()
    const timer = minuteTimer()
    const view = show()
    await screen.findByRole('table')
    view.unmount()
    expect(timer.cleared).toHaveBeenCalledWith(1234)
  })

  it('asks for the numbers again when the building has moved on to another day, and not before; the date and today follow', async () => {
    at('2026-10-12T20:00:00Z') // 23:00 on 12/10: the last column is today
    server()
    const timer = minuteTimer()
    show()
    await screen.findByRole('table')
    expect(homeCalls()).toBe(1)
    expect(screen.getByRole('columnheader', { name: '12/10/2026' }).getAttribute('aria-current')).toBe('date')
    vi.setSystemTime(new Date('2026-10-12T20:59:00Z')) // 23:59, the same day
    await timer.tick()
    expect(homeCalls(), 'the same day: no new request').toBe(1)
    vi.setSystemTime(new Date('2026-10-12T21:00:00Z')) // 00:00 on 13/10
    server({ home: homeSummary({ days: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'] }) })
    await timer.tick()
    await waitFor(() => expect(homeCalls()).toBe(2))
    expect(await screen.findByText('13/10')).toBeTruthy()
    expect(screen.queryByText('06/10')).toBeNull()
    expect(screen.getByRole('columnheader', { name: '13/10/2026' }).getAttribute('aria-current')).toBe('date') // today moved to the new last column
    expect(screen.getByRole('columnheader', { name: '12/10/2026' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).parentElement.querySelector('p').textContent).toBe('13/10/2026')
  })

  it('marks no day as today between midnight and the answer with the new days (the kept last column is yesterday)', async () => {
    at('2026-10-12T20:00:00Z')
    server()
    const timer = minuteTimer()
    show()
    await screen.findByRole('table')
    vi.setSystemTime(new Date('2026-10-12T21:00:00Z')) // 00:00 on 13/10, and the answer for the new days has not come yet
    api.mockImplementation(() => new Promise(() => {}))
    await timer.tick()
    expect(heads().filter((head) => head.hasAttribute('aria-current'))).toHaveLength(0)
    expect(table().querySelector('.is-today')).toBeNull()
  })
})

// ---- the summary card ---------------------------------------------------------------------------------------------------------------

describe('the summary card', () => {
  it('is a region named by its heading, and holds the total of the seven days in words a person reads: the number and "ביקורים"', async () => {
    server()
    await showed()
    const title = screen.getByRole('heading', { level: 2, name: TITLE })
    expect(summary().getAttribute('aria-labelledby')).toBe(title.id)
    const total = sumOf(totalsOf(ALL))
    expect(summary().querySelector('.a-hero__total').textContent).toBe(`${total} ביקורים`)
    expect(total).toBe(35)
  })

  it('says ביקור for one visit and ביקורים for none and for many', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 1] }] }) })
    await showed()
    expect(summary().querySelector('.a-hero__total').textContent).toBe('1 ביקור')
    cleanup()
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }] }) })
    await showed()
    expect(summary().querySelector('.a-hero__total').textContent).toBe('0 ביקורים')
  })

  it('writes the whole range in DD/MM/YYYY above the table, and the table is named by it (no caption, no second name)', async () => {
    server()
    await showed()
    const range = summary().querySelector('.a-hero__range')
    expect(range.textContent).toBe(RANGE) // the first and the last day, with their year
    expect([...range.querySelectorAll('.a-stamp')].map((n) => n.textContent)).toEqual(['06/10/2026', '12/10/2026']) // each date is kept in one piece, left to right
    expect(range.querySelector('.w-sr, [aria-hidden]'), 'nothing in it is hidden from a person or from a reader').toBeNull()
    expect(table().getAttribute('aria-labelledby')).toBe(range.id)
    expect(screen.getByRole('table', { name: RANGE })).toBe(table())
    expect(table().querySelector('caption')).toBeNull()
    expect(screen.queryByRole('table', { name: TITLE })).toBeNull()
  })

  it('puts the range right above the table, the element just before it with nothing between them (the #202 exception): title, total, range, bars', async () => {
    server()
    await showed()
    const range = summary().querySelector('.a-hero__range')
    expect(table().previousElementSibling, 'the element before the table is the range').toBe(range)
    expect(range.nextElementSibling).toBe(table())
    expect([...summary().children].map((child) => child.className || child.tagName)).toEqual(['H2', 'a-hero__total', 'a-hero__range', 'a-bars']) // the order of the card
    // the whole range, and the table is named by it
    expect(range.textContent).toBe('06/10/2026 עד 12/10/2026')
    expect(table().getAttribute('aria-labelledby')).toBe(range.id)
  })

  it('follows the days that it is given: the range is the first and the last of them, with their own year', async () => {
    server({ home: homeSummary({ days: ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'] }) })
    await showed()
    expect(summary().querySelector('.a-hero__range').textContent).toBe('27/12/2026 עד 02/01/2027')
    expect(within(table()).getByRole('columnheader', { name: '01/01/2027' })).toBeTruthy() // a head over the new year has the new year
  })

  it('has a column head for each day that writes DD/MM and is named by the full date, DD/MM/YYYY, for a screen reader', async () => {
    server()
    await showed()
    const columns = heads()
    expect(columns).toHaveLength(7)
    for (const head of columns) expect(head.getAttribute('scope')).toBe('col')
    // what is written: DD/MM, hidden from a reader; what is read: the full date, hidden from the eye
    const days = ['06/10', '07/10', '08/10', '09/10', '10/10', '11/10', '12/10']
    for (const [i, short] of days.entries()) {
      const written = columns[i].querySelector('[aria-hidden="true"]')
      const read = columns[i].querySelector('.w-sr')
      expect(written.textContent, `the head of ${short}: what is written`).toBe(short)
      expect(read.textContent, `the head of ${short}: what is read`).toBe(`${short}/2026`)
      // and its accessible name, as a screen reader and the accessibility tree have it: the full date and only that
      expect(within(table()).getByRole('columnheader', { name: `${short}/2026`, exact: true }), `the head of ${short}`).toBe(columns[i])
    }
    // no head is named by DD/MM alone, and none has a weekday or a month name
    for (const short of days) expect(within(table()).queryByRole('columnheader', { name: short, exact: true }), short).toBeNull()
    expect(columns.map((h) => h.textContent).join(' ')).not.toMatch(/יום|ראשון|שלישי|רביעי|חמישי|שישי|שבת|אוקטובר/)
  })

  it('lets a head that is too narrow break after its slash, and only there (a 320px phone: 08/ over 10)', async () => {
    server()
    await showed()
    for (const head of heads()) {
      const written = head.querySelector('[aria-hidden="true"]')
      const breaks = written.querySelectorAll('wbr')
      expect(breaks).toHaveLength(1)
      expect(breaks[0].previousSibling.textContent).toBe('/') // the break opportunity is right after the slash
    }
  })

  it('has the heads first in the markup and the bars after them: the order that a screen reader meets them in (the heads are drawn under the bars)', async () => {
    server()
    await showed()
    const [head, body] = [...table().children]
    expect(head.tagName).toBe('THEAD')
    expect(body.tagName).toBe('TBODY')
    expect(table().querySelectorAll('tr')).toHaveLength(2) // the heads, and one row of bars
  })

  it('does not turn the days around (the page is right to left, so the oldest is at the right by itself)', async () => {
    server()
    await showed()
    expect(barCells().map((cell) => cell.querySelector('.a-bar__n').textContent)).toEqual(totalsOf(ALL).map(String)) // 1 3 3 4 7 15 2, the server's order
    expect(heads().map((head) => head.querySelector('.w-sr').textContent)).toEqual(DAYS.map((day) => `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`))
  })

  it('makes a link of each day that has visits: that day for everyone, named by its date and its count', async () => {
    server()
    await showed()
    const links = within(table()).getAllByRole('link')
    expect(links.map(hrefOf)).toEqual(DAYS.map((day) => `#history?from=${day}&to=${day}`))
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      '06/10/2026: 1 ביקור', '07/10/2026: 3 ביקורים', '08/10/2026: 3 ביקורים', '09/10/2026: 4 ביקורים', '10/10/2026: 7 ביקורים', '11/10/2026: 15 ביקורים', '12/10/2026: 2 ביקורים',
    ])
    expect(links.join(' ')).not.toContain('provider') // everyone's visits of the day, not one provider's
    // the name of the link has the number that is drawn in it (the label says what the number is)
    for (const link of links) expect(link.getAttribute('aria-label')).toContain(link.querySelector('.a-bar__n').textContent)
    expect(within(table()).getByRole('link', { name: '11/10/2026: 15 ביקורים' })).toBeTruthy()
  })

  it('draws a day with no visit as the number 0 and a short bar, and not as a link (there is nothing to open)', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 4, 0, 0, 2] }] }) })
    await showed()
    const cells = barCells()
    expect(cells.map((cell) => cell.textContent)).toEqual(['0', '0', '0', '4', '0', '0', '2'])
    expect(within(table()).getAllByRole('link')).toHaveLength(2)
    expect(cells[0].querySelector('a')).toBeNull()
    expect(cells[0].querySelector('.a-bar').classList.contains('is-none')).toBe(true)
    expect(cells[0].querySelector('.a-bar__fill')).toBeTruthy() // the short bar is drawn; the 0 is written, so a reader gets it from the cell
  })

  it('draws every bar as high as its number against the busiest day (0 to 1, the busiest is 1), and 0 for all of a week with no visit', async () => {
    server()
    await showed()
    const heights = barCells().map((cell) => Number(cell.querySelector('.a-bar__fill').style.getPropertyValue('--bar')))
    const totals = totalsOf(ALL)
    expect(heights).toHaveLength(7)
    for (const [i, height] of heights.entries()) expect(height, `the bar of ${DAYS[i]}`).toBeCloseTo(totals[i] / 15, 5)
    expect(Math.max(...heights)).toBe(1)
    cleanup()
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }] }) })
    await showed()
    const none = barCells().map((cell) => cell.querySelector('.a-bar__fill').style.getPropertyValue('--bar'))
    expect(none).toEqual(['0', '0', '0', '0', '0', '0', '0']) // never NaN
  })

  it('marks today: its head and its bar say "date" to a reader, and its bar is the one drawn in the whole colour', async () => {
    server()
    await showed()
    const current = heads().map((head) => head.getAttribute('aria-current'))
    expect(current).toEqual([null, null, null, null, null, null, 'date'])
    const links = within(table()).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('aria-current'))).toEqual([null, null, null, null, null, null, 'date'])
    expect(barCells().map((cell) => cell.querySelector('.a-bar').classList.contains('is-today'))).toEqual([false, false, false, false, false, false, true])
  })

  it('marks no day as today when the last day of the table is not the day of the building', async () => {
    at('2026-10-20T07:00:00Z') // a clock far from the days of the answer
    server()
    await showed()
    expect(heads().filter((head) => head.hasAttribute('aria-current'))).toHaveLength(0)
    expect(table().querySelector('.is-today')).toBeNull()
  })

  it('shows a week with no visit: a total of 0, seven bars of 0, no link', async () => {
    const quiet = [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }, { ...ALMONI, counts: [0, 0, 0, 0, 0, 0, 0] }]
    server({ home: homeSummary({ providers: quiet }) })
    await showed()
    expect(within(table()).queryAllByRole('link')).toHaveLength(0)
    expect(barCells().every((cell) => cell.textContent === '0')).toBe(true)
    expect(summary().querySelector('.a-hero__total').textContent).toBe('0 ביקורים')
  })

  it('does not scroll and does not take the focus: it is not a box that holds more than it shows', async () => {
    server()
    await showed()
    expect(summary().hasAttribute('tabindex')).toBe(false)
    expect(summary().querySelector('[tabindex]')).toBeNull()
  })

  it('has no trend, no average and no comparison with an earlier week: counts and their words only', async () => {
    server()
    await showed()
    expect(summary().textContent).not.toMatch(/ממוצע|לעומת|מגמה|שיפור|ירידה|עלייה|ציון|[↑↓▲▼]|%/)
  })
})

// ---- the providers ------------------------------------------------------------------------------------------------------------------

describe('the providers of the week', () => {
  const list = () => screen.getByRole('region', { name: PROVIDERS_TITLE }).querySelector('ul')

  it('has a section named by its heading, and a link to the History of the seven days for everyone', async () => {
    server()
    await showed()
    const section = screen.getByRole('region', { name: PROVIDERS_TITLE })
    expect(within(section).getByRole('heading', { level: 2, name: PROVIDERS_TITLE })).toBeTruthy()
    const all = within(section).getByRole('link', { name: 'לכל ההיסטוריה' })
    expect(hrefOf(all)).toBe('#history?from=2026-10-06&to=2026-10-12') // exactly what the summary card counts
  })

  it('has a row for each provider in the order that the server gives (never ranked by the counts)', async () => {
    server()
    await showed()
    const rows = [...list().children]
    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.querySelector('.a-who__name').textContent)).toEqual(['פלוני', 'אלמוני', 'גינון אלון', 'Иван', 'ספק ישן'])
    // totals 19, 13, 0, 1, 2: neither the most visits first nor the fewest
    expect(rows.map((row) => row.querySelector('.a-who__num').textContent)).toEqual(['19', '13', '0', '1', '2'])
  })

  it('makes the whole row one link to the History of that provider for the seven days: the visits that its total counts', async () => {
    server()
    await showed()
    for (const p of ALL) {
      const link = rowLink(p.name)
      expect(hrefOf(link), p.name).toBe(weekOf(p.id))
      expect(within(rowOf(p.name)).getAllByRole('link'), `${p.name}: one link in the row`).toHaveLength(1)
      expect(rowOf(p.name).querySelector('a').contains(rowOf(p.name).querySelector('.a-who__num')), `${p.name}: the total is in the link`).toBe(true)
    }
  })

  it('makes the link of a deleted provider with its id, and of an inactive one and one with no visit too (their History is the answer)', async () => {
    server()
    await showed()
    expect(hrefOf(rowLink('ספק ישן'))).toBe(weekOf(ids.gone))
    expect(hrefOf(rowLink('Иван'))).toBe(weekOf(ids.ivan))
    expect(hrefOf(rowLink('גינון אלון'))).toBe(weekOf(ids.solo)) // a row of zeros: the History says there is none
  })

  it('names the link by the provider, the days with a visit and the total', async () => {
    server()
    await showed()
    // (the pieces of the name are separate boxes in the page, which a browser reads with a space between them)
    const link = screen.getByRole('link', { name: /פלוני\s*ניקיון\s*ביקורים ב-06\/10\/2026.*12\/10\/2026\s*19\s*ביקורים/ })
    expect(link).toBe(rowLink('פלוני'))
  })

  it('shows the company under a name that is a contact\'s, and says nothing more for a name that is the company', async () => {
    server()
    await showed()
    expect(rowOf('פלוני').querySelector('.a-who__company').textContent).toBe('ניקיון')
    expect(rowOf('גינון אלון').querySelector('.a-who__company')).toBeNull()
  })

  it('says that a provider is switched off, and that a deleted one was deleted, next to its name', async () => {
    server()
    await showed()
    expect(within(rowOf('פלוני')).queryByText('מושבת')).toBeNull()
    expect(within(rowOf('Иван')).getByText('מושבת')).toBeTruthy()
    const gone = rowOf('ספק ישן')
    expect(within(gone).getByText('ספק ישן')).toBeTruthy() // the name that its visits kept
    expect(within(gone).getByText('נותן שירות שנמחק')).toBeTruthy() // the words of the History screen for the same provider
    expect(within(gone).queryByText('מושבת'), 'one badge, not two').toBeNull()
  })

  it('writes the total of a provider: the sum of its seven days, with ביקור for one and ביקורים for the rest', async () => {
    server()
    await showed()
    expect(rowOf('פלוני').querySelector('.a-who__total').textContent).toBe('19ביקורים')
    expect(rowOf('Иван').querySelector('.a-who__total').textContent).toBe('1ביקור')
    expect(rowOf('גינון אלון').querySelector('.a-who__total').textContent).toBe('0ביקורים')
  })

  it('draws a dot for each day, in the order of the days, filled for a day with a visit and a ring for a day without', async () => {
    server()
    await showed()
    const on = (name) => [...rowOf(name).querySelectorAll('.a-dot')].map((dot) => dot.classList.contains('is-on'))
    expect(on('פלוני')).toEqual([true, true, false, true, true, true, true]) // 1 2 0 4 7 3 2
    expect(on('אלמוני')).toEqual([false, false, true, false, false, true, false])
    expect(on('גינון אלון')).toEqual([false, false, false, false, false, false, false])
    expect(rowOf('פלוני').querySelectorAll('.a-dot')).toHaveLength(7)
    // the dot of today is the last, and only that one
    const today = [...rowOf('פלוני').querySelectorAll('.a-dot')].map((dot) => dot.classList.contains('is-today'))
    expect(today).toEqual([false, false, false, false, false, false, true])
  })

  it('tells a screen reader what the dots say: one picture, named by the days with a visit, in full dates', async () => {
    server()
    await showed()
    const dots = (name) => within(rowOf(name)).getByRole('img')
    expect(dots('פלוני').getAttribute('aria-label')).toBe('ביקורים ב-06/10/2026, 07/10/2026, 09/10/2026, 10/10/2026, 11/10/2026, 12/10/2026')
    expect(dots('Иван').getAttribute('aria-label')).toBe('ביקורים ב-07/10/2026')
    expect(dots('גינון אלון').getAttribute('aria-label')).toBe('אין ביקורים')
    expect(within(rowOf('פלוני')).getByRole('img', { name: /^ביקורים ב-06\/10\/2026/ })).toBe(dots('פלוני'))
    // the separate dots are nothing to a reader: they are children of the picture
    expect(dots('פלוני').querySelectorAll('[aria-label], [role]')).toHaveLength(0)
  })

  it('has a mark with the first letter of the name, hidden from a reader, in one of the tints by the id and the grey of one that is off', async () => {
    server()
    await showed()
    const mark = (name) => rowOf(name).querySelector('.a-who__avatar')
    expect(mark('פלוני').textContent).toBe('פ')
    expect(mark('Иван').textContent).toBe('И')
    expect(mark('פלוני').getAttribute('aria-hidden')).toBe('true')
    expect(mark('Иван').classList.contains('a-who__avatar--off')).toBe(true) // switched off
    expect(mark('ספק ישן').classList.contains('a-who__avatar--off')).toBe(true) // deleted
    expect(mark('פלוני').classList.contains('a-who__avatar--off')).toBe(false)
    const tone = (name) => [...mark(name).classList].filter((c) => c !== 'a-who__avatar')[0] ?? 'violet'
    const before = [tone('פלוני'), tone('אלמוני')]
    cleanup()
    server()
    await showed()
    expect([tone('פלוני'), tone('אלמוני')], 'the same tint on the next visit').toEqual(before)
  })

  it('has no section when the week has no provider, and the rest of the screen stays', async () => {
    server({ home: homeSummary({ providers: [], counts: { providers: { active: 0, total: 0 } } }) })
    await showed()
    expect(screen.queryByRole('region', { name: PROVIDERS_TITLE })).toBeNull()
    expect(summary()).toBeTruthy()
    expect(tiles()).toHaveLength(4)
  })

  it('shows a week with no visit: every provider as a row of empty dots and a total of 0 (an absence is information)', async () => {
    const quiet = [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }, { ...ALMONI, counts: [0, 0, 0, 0, 0, 0, 0] }]
    server({ home: homeSummary({ providers: quiet }) })
    await showed()
    expect([...list().children]).toHaveLength(2)
    expect(list().querySelectorAll('.a-dot.is-on')).toHaveLength(0)
    expect([...list().querySelectorAll('.a-who__num')].map((n) => n.textContent)).toEqual(['0', '0'])
  })
})

// ---- the tiles and the list ---------------------------------------------------------------------------------------------------------

describe('the tiles and the short list', () => {
  it('has a tile for each number that has a screen, with its number and its words, and the whole tile is the link', async () => {
    server()
    await showed()
    expect(tiles().map((c) => [c.textContent, hrefOf(c)])).toEqual([
      ['3נותני שירות פעיליםמתוך 5', '#providers'],
      ['3נקודות פעילותמתוך 4', '#points'],
      ['6ביקורים שלא נקלטו ב-7 הימים', '#history?outcome=not_counted&from=2026-10-06&to=2026-10-12'],
      ['2טלפונים עם ביקורים שממתינים לשליחה5 ביקורים בסך הכול', '#providers'],
    ])
  })

  it('draws the tiles in their tones: violet, the plain surface, peach, and sky', async () => {
    server()
    await showed()
    expect(tiles().map((c) => [...c.classList].find((name) => name.startsWith('a-tile--')))).toEqual(['a-tile--violet', 'a-tile--plain', 'a-tile--peach', 'a-tile--sky'])
  })

  it('has the two numbers that have no tile as two rows of one list: the members and the agent keys, each a link to its screen', async () => {
    server()
    await showed()
    const rows = [...document.querySelectorAll('.a-links a')]
    expect(rows.map((r) => [r.textContent, hrefOf(r)])).toEqual([
      ['חברי הוועד2', '#settings'],
      ["מפתחות אייג'נט פעילים1", '#agent'],
    ])
    expect(rows[0].querySelector('svg').getAttribute('aria-hidden')).toBe('true') // the chevron is decoration
    expect(rows[0].querySelector('svg').classList.contains('w-flip')).toBe(true) // and it points forward in a right-to-left page
    expect(screen.getByRole('link', { name: /חברי הוועד/ })).toBe(rows[0])
  })

  it('links the tile of the visits that were not counted to the History of the seven days, with the type "not counted"', async () => {
    server()
    await showed()
    const link = tile('ביקורים שלא נקלטו')
    const query = new URLSearchParams(hrefOf(link).slice('#history?'.length))
    expect(Object.fromEntries(query)).toEqual({ outcome: 'not_counted', from: '2026-10-06', to: '2026-10-12' }) // the first and the last day of the table
    expect(hrefOf(link).startsWith('#history?')).toBe(true)
  })

  it('has its seven days from the server, not from the clock: the last day of the table is the end of the range', async () => {
    at('2027-05-05T09:00:00Z') // a clock far from the days of the answer
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']
    server({ home: homeSummary({ days }) })
    await showed()
    expect(hrefOf(tile('ביקורים שלא נקלטו'))).toBe('#history?outcome=not_counted&from=2026-03-01&to=2026-03-07')
    expect(hrefOf(within(screen.getByRole('region', { name: PROVIDERS_TITLE })).getByRole('link', { name: 'לכל ההיסטוריה' }))).toBe('#history?from=2026-03-01&to=2026-03-07')
    expect(hrefOf(rowLink('פלוני'))).toBe(`#history?provider=${ids.ploni}&from=2026-03-01&to=2026-03-07`)
  })

  it('shows the waiting phones only when there is one, and says how many visits wait (one in the singular)', async () => {
    server({ home: homeSummary({ counts: { waiting: { phones: 0, visits: 0 } } }) })
    await showed()
    expect(screen.queryByRole('link', { name: /טלפונים עם ביקורים/ })).toBeNull()
    expect(tiles()).toHaveLength(3)
    cleanup()
    server({ home: homeSummary({ counts: { waiting: { phones: 1, visits: 1 } } }) })
    await showed()
    expect(tile('טלפונים עם ביקורים').textContent).toBe('1טלפונים עם ביקורים שממתינים לשליחהביקור אחד בסך הכול')
    expect(tiles()).toHaveLength(4)
  })

  it('writes 0 for a count of zero (it is a number, and the tile is still a link)', async () => {
    server({ home: homeSummary({ counts: { visits_not_counted: 0, agent_keys: { active: 0 } } }) })
    await showed()
    expect(tile('ביקורים שלא נקלטו').textContent).toBe('0ביקורים שלא נקלטו ב-7 הימים')
    expect(screen.getByRole('link', { name: /מפתחות אייג'נט/ }).textContent).toBe("מפתחות אייג'נט פעילים0")
  })

  it('has the total of the points and of the providers beside their active ones', async () => {
    server({ home: homeSummary({ counts: { points: { active: 7, total: 7 }, providers: { active: 1, total: 12 } } }) })
    await showed()
    expect(tile('נקודות פעילות').textContent).toBe('7נקודות פעילותמתוך 7')
    expect(tile('נותני שירות פעילים').textContent).toBe('1נותני שירות פעיליםמתוך 12')
  })

  it('shows no trend, no average and no comparison with an earlier week: counts and their words only', async () => {
    server()
    await showed()
    const text = document.body.textContent
    expect(text).not.toMatch(/ממוצע|לעומת|מגמה|שיפור|ירידה|עלייה|ציון|[↑↓▲▼]|%/)
  })
})

// ---- the states ---------------------------------------------------------------------------------------------------------------------

describe('the states', () => {
  it('shows the loading state, with its words for a screen reader, while the numbers are on their way', async () => {
    api.mockImplementation(() => new Promise(() => {}))
    show()
    expect(screen.getByRole('status').textContent).toBe('טוען…')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows an error with "נסו שוב" when the numbers cannot be loaded, and asks again when it is pressed', async () => {
    let answer = async () => { throw Object.assign(new Error('no connection'), { status: 0 }) }
    api.mockImplementation(async () => answer())
    show()
    const retry = await screen.findByRole('button', { name: 'נסו שוב' })
    expect(screen.getByRole('heading', { level: 2, name: 'לא הצלחנו לטעון' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    answer = async () => homeSummary()
    fireEvent.click(retry)
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'נסו שוב' })).toBeNull()
    expect(homeCalls()).toBe(2)
  })

  it('shows what to do first in a building with no points and no providers: buttons to the two screens, and nothing else', async () => {
    server({ home: EMPTY_BUILDING })
    show()
    expect(await screen.findByRole('heading', { level: 2, name: 'עוד אין נקודות ונותני שירות' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.querySelector('.a-home')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'הוסיפו נקודה' }))
    await waitFor(() => expect(window.location.hash).toBe('#points'))
    fireEvent.click(screen.getByRole('button', { name: 'הוסיפו נותן שירות' }))
    await waitFor(() => expect(window.location.hash).toBe('#providers'))
  })

  it('does not call a building empty when only one of the two is empty, or when a deleted provider\'s visits are in the week', async () => {
    const noProviders = homeSummary({ providers: [], counts: { providers: { active: 0, total: 0 } } })
    server({ home: noProviders })
    await showed()
    cleanup()
    const noPoints = homeSummary({ counts: { points: { active: 0, total: 0 } } })
    server({ home: noPoints })
    await showed()
    cleanup()
    const onlyAGhost = homeSummary({
      providers: [GONE],
      counts: { points: { active: 0, total: 0 }, providers: { active: 0, total: 0 } },
    })
    server({ home: onlyAGhost })
    await showed()
    expect(rowOf('ספק ישן')).toBeTruthy()
  })

  it('shows the card, the providers and the tiles for a building that has providers and points and no visit in the week', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }], counts: { visits_not_counted: 0, waiting: { phones: 0, visits: 0 } } }) })
    await showed()
    expect(screen.queryByRole('heading', { name: 'עוד אין נקודות ונותני שירות' })).toBeNull()
    expect(tiles()).toHaveLength(3)
  })
})

describe('the answer kept from the last visit', () => {
  it('keeps the first answer in the cache of the committee app, under its own key', async () => {
    server()
    await showed()
    expect(readLoadCache(LOAD_KEY.home)).toEqual(homeSummary())
    expect(LOAD_KEY.home).toBe('home')
  })

  it('draws the kept answer at once, with no loading state, and takes the fresh one when it comes', async () => {
    setLoadCache(LOAD_KEY.home, homeSummary({ providers: [{ ...PLONI, counts: [9, 9, 9, 9, 9, 9, 9] }] }))
    let release
    api.mockImplementation(() => new Promise((resolve) => { release = () => resolve(homeSummary()) }))
    show()
    // at once: the kept card and rows, no spinner
    expect(screen.queryByRole('status')).toBeNull()
    expect(rowOf('פלוני').querySelector('.a-who__num').textContent).toBe('63')
    expect(homeCalls()).toBe(1) // and it asked again
    await act(async () => { release() })
    await waitFor(() => expect(rowOf('פלוני').querySelector('.a-who__num').textContent).toBe('19'))
  })

  it('keeps the kept answer on the screen when the fresh one cannot be loaded (no error in its place)', async () => {
    setLoadCache(LOAD_KEY.home, homeSummary())
    api.mockImplementation(async () => { throw new Error('no connection') })
    show()
    await waitFor(() => expect(homeCalls()).toBe(1))
    await act(async () => {})
    expect(table()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'נסו שוב' })).toBeNull()
  })

  it('shows the days of the kept answer until the fresh one replaces them, then the new ones', async () => {
    setLoadCache(LOAD_KEY.home, homeSummary({ days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'] }))
    server()
    show()
    expect(screen.getByText('05/10')).toBeTruthy()
    await screen.findByText('12/10')
    expect(screen.queryByText('05/10')).toBeNull()
  })

  it('does not show one member\'s numbers to the next: an emptied cache loads from the start', async () => {
    setLoadCache(LOAD_KEY.home, homeSummary())
    clearLoadCache() // what AdminApp does when the member signs out, and before a new sign-in
    api.mockImplementation(() => new Promise(() => {}))
    show()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

// ---- in the real app ----------------------------------------------------------------------------------------------------------------

describe('in the app', () => {
  const heading = (name) => screen.findByRole('heading', { level: 1, name })
  const bar = (day) => within(table()).getByRole('link', { name: new RegExp(`^${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}:`) })

  it('opens on Home when the address names no screen, and the title of the window says so', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('heading', { level: 1, name: /^בוקר טוב, Sample$/ })
    await screen.findByRole('table')
    await waitFor(() => expect(document.title).toBe('בית · נוכחות בבניין'))
  })

  it.each(['phone', 'computer'])('opens the History of a day for everyone, with exactly the filters of the bar that is followed, on a %s', async (kind) => {
    layout(kind === 'phone')
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(bar('2026-10-09')) // a link to #history?...
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scans').length).toBeGreaterThan(0))
    expect(asked('/admin/scans').at(-1)).toMatchObject({ from: '2026-10-09', to: '2026-10-09', outcome: 'accepted' })
    expect(asked('/admin/scans').at(-1)).not.toHaveProperty('provider_id')
    expect(asked('/admin/scans').every((q) => q.from === '2026-10-09' && q.to === '2026-10-09' && !('provider_id' in q)), 'no request of another filter first').toBe(true)
    // the address is the plain one afterwards, and the screen did not change
    await waitFor(() => expect(window.location.hash).toBe('#history'))
  })

  it.each(['phone', 'computer'])('opens the History of a provider for the seven days from its row, with exactly its filters, on a %s', async (kind) => {
    layout(kind === 'phone')
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(rowLink('פלוני'))
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scans').length).toBeGreaterThan(0))
    expect(asked('/admin/scans').at(-1)).toMatchObject({ provider_id: ids.ploni, from: '2026-10-06', to: '2026-10-12', outcome: 'accepted' })
    expect(asked('/admin/scans').every((q) => q.provider_id === ids.ploni && q.from === '2026-10-06' && q.to === '2026-10-12'), 'no request of another filter first').toBe(true)
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    if (kind === 'phone') expect(screen.getAllByRole('button', { name: /^הסרת סינון/ }).map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('פלוני')]))
    else expect(screen.getByLabelText('נותן שירות')).toHaveProperty('value', ids.ploni)
  })

  it('opens the History of everyone for the seven days from "לכל ההיסטוריה", and of the seven days for the visits that were not counted', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('link', { name: 'לכל ההיסטוריה' }))
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scans').length).toBeGreaterThan(0))
    expect(asked('/admin/scans').at(-1)).toMatchObject({ from: '2026-10-06', to: '2026-10-12', outcome: 'accepted' })
    expect(asked('/admin/scans').at(-1)).not.toHaveProperty('provider_id')
  })

  it.each([
    ['providers', '#providers', 'נותני שירות פעילים', 'נותני שירות'],
    ['points', '#points', 'נקודות פעילות', 'נקודות סריקה'],
    ['the waiting phones', '#providers', 'טלפונים עם ביקורים', 'נותני שירות'],
    ['the members', '#settings', 'חברי הוועד', 'הגדרות'],
    ['the keys', '#agent', "מפתחות אייג'נט", "גישה לאייג'נט"],
  ])('opens the screen of the tile or the row of %s', async (_what, hash, label, title) => {
    api.mockImplementation(async (path) => {
      if (path === '/admin/api-keys') return { api_keys: [] }
      if (path === '/admin/admins') return { admins: [] }
      if (path === '/admin/providers') return { providers: [] }
      if (path === '/admin/points') return { points: [] }
      if (path === '/admin/building') return { building: { address: '' } }
      if (path === '/admin/home') return homeSummary()
      if (path === '/admin/config') return { google_client_id: '', dev_login: false }
      if (path === '/admin/me') return { admin: ADMIN }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(tile(label))
    await heading(title)
    expect(window.location.hash).toBe(hash)
  })

  it('opens the History of the visits that were not counted from its tile, with the seven days', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(tile('ביקורים שלא נקלטו'))
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scan-refusals').length).toBeGreaterThan(0))
    expect(asked('/admin/scan-refusals').at(-1)).toMatchObject({ from: '2026-10-06', to: '2026-10-12' })
    expect(asked('/admin/scans')).toHaveLength(0) // the visits that were not counted are not scans: the list is the refusals
  })

  it('goes back to Home with Back after a link, and then asks Home for its numbers again, drawing the kept ones at once', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(bar('2026-10-09'))
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(window.location.hash).toBe('#history')) // the link's address was tidied
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    await screen.findByRole('heading', { level: 1, name: /^בוקר טוב/ })
    expect(screen.getByRole('table')).toBeTruthy() // at once, from the cache
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(homeCalls()).toBe(2))
  })

  it('shows Home again after a reload of the page (the address of a link is not kept, and the default is Home)', async () => {
    server()
    window.history.replaceState(null, '', '/#home')
    render(<AdminApp />)
    await screen.findByRole('table')
    cleanup()
    clearLoadCache() // a page load starts with an empty cache
    render(<AdminApp />)
    await screen.findByRole('table')
    expect(screen.getByRole('heading', { level: 1, name: /^בוקר טוב/ })).toBeTruthy()
  })

  it('does not draw Home again when the window crosses 1024 px: the table stays the same element, and nothing is asked for', async () => {
    const screenSize = layout(true)
    server()
    render(<AdminApp />)
    const first = await screen.findByRole('table')
    expect(homeCalls()).toBe(1)
    await screenSize.computer()
    expect(screen.getByRole('table')).toBe(first)
    await screenSize.phone()
    expect(screen.getByRole('table')).toBe(first)
    expect(homeCalls()).toBe(1)
    expect(greeting()).toBe('בוקר טוב, Sample')
  })

  it('has the greeting alone in the app for a member whose name is not known', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/admin/me') return { admin: { ...ADMIN, name: null } }
      if (path === '/admin/home') return homeSummary()
      if (path === '/admin/config') return { google_client_id: '', dev_login: false }
      if (path === '/admin/building') return { building: { address: '' } }
      throw new Error(`the test does not expect ${path}`)
    })
    render(<AdminApp />)
    await screen.findByRole('table')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('בוקר טוב')
  })
})
