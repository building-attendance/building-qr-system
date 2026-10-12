// @vitest-environment jsdom
// The Home screen of the committee app (src/admin/views/HomeView.jsx): a greeting, the visits of the last seven days as a table, and a card
// for each screen. It shows counts and nothing else (the app records facts and does not analyse them), so there is no trend, no average and
// no score to test for: what these tests hold is what the screen does show, and where each number leads.
//
// The real HomeView, and for the part about links, the real AdminApp with the real History screen behind it, with the network (`api`)
// answered by the test and the clock of `Date` set by the test (the greeting follows the hour of the building's clock).
//   - the greeting: its three windows to the minute, in summer and in winter time; the first word of the name, none when there is no
//     name; the screen that stays open follows the clock;
//   - the table: a real table whose caption is the range in DD/MM/YYYY, heads that write DD/MM and are named by the full date, the days in the
//     order the server gives them, a row for each provider (a provider that is switched off or was deleted says so), the totals, the link
//     of each cell with its provider and its day, and an empty cell for a zero;
//   - the cards and their links, the card of the waiting phones only when there is one;
//   - the states: loading, an error with "נסו שוב", a building with nothing in it, and the answer kept from the last visit;
//   - the links followed in the real app: a cell opens the History with exactly its filters, on a phone and on a computer, Back returns to
//     Home, and the window crossing 1024 px does not draw Home again.
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
  ivan: '66666666-6666-4666-8666-666666666666',
  gone: '77777777-7777-4777-8777-777777777777',
}
const PLONI = { id: ids.ploni, name: 'פלוני', company: 'ניקיון', is_active: true, counts: [1, 2, 0, 4, 7, 3, 2] }
const ALMONI = { id: ids.almoni, name: 'אלמוני', company: 'גינון', is_active: true, counts: [0, 0, 1, 0, 0, 12, 0] }
const SOLO = { id: '88888888-8888-4888-8888-888888888888', name: 'גינון אלון', company: 'גינון אלון', is_active: true, counts: [0, 0, 0, 0, 0, 0, 0] } // one name: no second line
const IVAN = { id: ids.ivan, name: 'Иван', company: 'Уборка', is_active: false, counts: [0, 1, 0, 0, 0, 0, 0] }
const GONE = { id: ids.gone, name: 'ספק ישן', company: null, is_active: false, counts: [0, 0, 2, 0, 0, 0, 0] }
const totalsOf = (providers) => DAYS.map((_, i) => providers.reduce((sum, p) => sum + p.counts[i], 0))

/** What GET /api/admin/home answers (HomeSummary, shared/types.js). Every part can be changed by the test. */
function homeSummary({ providers = [PLONI, ALMONI, SOLO, IVAN, GONE], days = DAYS, counts = {} } = {}) {
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
const MORNING = '2026-10-12T07:00:00Z' // 10:00 in the building (UTC+3 in October)

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
const TITLE = 'נוכחות ב-7 הימים האחרונים'
const region = () => screen.getByRole('region', { name: TITLE })
const table = () => within(region()).getByRole('table')
const rowOf = (name) => screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')
const cellsOf = (row) => within(row).getAllByRole('cell')
const linksOf = (row) => within(row).queryAllByRole('link')
const card = (name) => screen.getByRole('link', { name: new RegExp(name) })
const hrefOf = (link) => link.getAttribute('href')

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

// ---- the greeting -----------------------------------------------------------------------------------------------------------------

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

  it('asks for the numbers again when the building has moved on to another day, and not before', async () => {
    at('2026-10-12T20:00:00Z') // 23:00 on 12/10: the last column is today
    server()
    const timer = minuteTimer()
    show()
    await screen.findByRole('table')
    expect(homeCalls()).toBe(1)
    vi.setSystemTime(new Date('2026-10-12T20:59:00Z')) // 23:59, the same day
    await timer.tick()
    expect(homeCalls(), 'the same day: no new request').toBe(1)
    vi.setSystemTime(new Date('2026-10-12T21:00:00Z')) // 00:00 on 13/10
    server({ home: homeSummary({ days: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'] }) })
    await timer.tick()
    await waitFor(() => expect(homeCalls()).toBe(2))
    expect(await screen.findByText('13/10')).toBeTruthy()
    expect(screen.queryByText('06/10')).toBeNull()
  })
})

// ---- the table ----------------------------------------------------------------------------------------------------------------------

describe('the week table', () => {
  it('is a real table in a region that a keyboard can reach: the heading names the region, and the caption is the range', async () => {
    server()
    await showed()
    const t = table()
    expect(t.tagName).toBe('TABLE')
    expect(region().contains(t)).toBe(true)
    expect(region().getAttribute('tabindex')).toBe('0') // a box that scrolls must take the focus (axe: scrollable-region-focusable)
    const title = screen.getByRole('heading', { level: 2, name: TITLE })
    expect(region().getAttribute('aria-labelledby')).toBe(title.id) // the region (the box that scrolls) is named by the heading
    // the table is named by its caption: the range, not the heading again
    expect(screen.getByRole('table', { name: '06/10/2026 עד 12/10/2026' })).toBe(t)
  })

  it('has a visible caption with the whole range in DD/MM/YYYY, as the filter bar of the History says a range, right above the heads', async () => {
    server()
    await showed()
    const captions = table().querySelectorAll('caption')
    expect(captions).toHaveLength(1)
    const caption = captions[0]
    expect(caption.textContent).toBe('06/10/2026 עד 12/10/2026') // the first and the last day, with their year
    expect(caption.classList.contains('w-sr'), 'visible: it is not the visually hidden class').toBe(false)
    expect(caption.querySelector('.w-sr, [aria-hidden]'), 'nothing in it is hidden from a person or from a reader').toBeNull()
    expect([...caption.querySelectorAll('.a-stamp')].map((n) => n.textContent)).toEqual(['06/10/2026', '12/10/2026']) // each date is kept in one piece, left to right, as in the History bar
    expect(table().firstElementChild).toBe(caption) // the caption is the first thing in the table, over the heads
  })

  it('follows the days that it is given: the range is the first and the last of them, with their own year', async () => {
    server({ home: homeSummary({ days: ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'] }) })
    await showed()
    expect(table().querySelector('caption').textContent).toBe('27/12/2026 עד 02/01/2027')
    expect(within(table()).getByRole('columnheader', { name: '01/01/2027' })).toBeTruthy() // a head over the new year has the new year
  })

  it('has no second caption, and none that says the heading again (the heading is the name of the region, once)', async () => {
    server()
    await showed()
    expect(document.querySelectorAll('caption')).toHaveLength(1)
    expect(table().querySelector('caption').textContent).not.toContain(TITLE)
    // the words of the heading are said by the heading and by the name of the region, and by nothing else in the table
    expect(table().textContent).not.toContain(TITLE)
    expect(screen.queryByRole('table', { name: TITLE })).toBeNull()
    expect(screen.getAllByText(TITLE)).toHaveLength(1)
  })

  it('has a column head for each day that writes DD/MM and is named by the full date, DD/MM/YYYY, for a screen reader', async () => {
    server()
    await showed()
    const heads = within(table()).getAllByRole('columnheader')
    expect(heads).toHaveLength(8)
    for (const head of heads) expect(head.getAttribute('scope')).toBe('col')
    // what is written: DD/MM, hidden from a reader; what is read: the full date, hidden from the eye
    const days = ['06/10', '07/10', '08/10', '09/10', '10/10', '11/10', '12/10']
    for (const [i, short] of days.entries()) {
      const head = heads[i + 1]
      const written = head.querySelector('[aria-hidden="true"]')
      const read = head.querySelector('.w-sr')
      expect(written.textContent, `the head of ${short}: what is written`).toBe(short)
      expect(read.textContent, `the head of ${short}: what is read`).toBe(`${short}/2026`)
      // and its accessible name, as a screen reader and the accessibility tree have it: the full date and only that
      expect(within(table()).getByRole('columnheader', { name: `${short}/2026`, exact: true }), `the head of ${short}`).toBe(head)
    }
    // no head is named by DD/MM alone
    for (const short of days) expect(within(table()).queryByRole('columnheader', { name: short, exact: true }), short).toBeNull()
  })

  it('has the head over the names read, not drawn, and no weekday and no month name in any head', async () => {
    server()
    await showed()
    const heads = within(table()).getAllByRole('columnheader')
    expect(heads[0].textContent).toBe('נותן שירות')
    expect(heads[0].querySelector('.w-sr'), 'the head over the names is read, not drawn').toBeTruthy()
    // no weekday and no month name in a head (the guard of tests/dates.test.js is for the code; this is for the screen)
    expect(heads.map((h) => h.textContent).join(' ')).not.toMatch(/יום|ראשון|שלישי|רביעי|חמישי|שישי|שבת|אוקטובר/)
  })

  it('does not turn the days around (the page is right to left, so the oldest is at the right by itself)', async () => {
    server()
    await showed()
    const row = rowOf('פלוני')
    // the cells follow the days one to one, in the DOM: 1 2 (0) 4 7 3 2, and the totals too
    expect(cellsOf(row).map((c) => c.textContent)).toEqual(['1', '2', '0', '4', '7', '3', '2'])
    const totals = screen.getByRole('rowheader', { name: 'סך הכול' }).closest('tr')
    expect(cellsOf(totals).map((c) => c.textContent)).toEqual(totalsOf([PLONI, ALMONI, SOLO, IVAN, GONE]).map(String))
  })

  it('has a row for each provider, in the order that the server gives, then the totals', async () => {
    server()
    await showed()
    expect(within(table()).getAllByRole('rowheader').map((h) => h.querySelector('.a-week__name')?.textContent ?? h.textContent)).toEqual(
      ['פלוני', 'אלמוני', 'גינון אלון', 'Иван', 'ספק ישן', 'סך הכול'],
    )
  })

  it('shows the company under a name that is a contact\'s, and says nothing more for a name that is the company', async () => {
    server()
    await showed()
    expect(rowOf('פלוני').querySelector('.a-week__company').textContent).toBe('ניקיון')
    expect(rowOf('גינון אלון').querySelector('.a-week__company')).toBeNull()
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

  it('makes a link of each cell that has visits: its provider and its day, nothing else', async () => {
    server()
    await showed()
    const row = rowOf('פלוני')
    const links = linksOf(row)
    expect(links.map((l) => l.textContent)).toEqual(['1', '2', '4', '7', '3', '2'])
    expect(links.map(hrefOf)).toEqual([
      `#history?provider=${ids.ploni}&from=2026-10-06&to=2026-10-06`,
      `#history?provider=${ids.ploni}&from=2026-10-07&to=2026-10-07`,
      `#history?provider=${ids.ploni}&from=2026-10-09&to=2026-10-09`,
      `#history?provider=${ids.ploni}&from=2026-10-10&to=2026-10-10`,
      `#history?provider=${ids.ploni}&from=2026-10-11&to=2026-10-11`,
      `#history?provider=${ids.ploni}&from=2026-10-12&to=2026-10-12`,
    ])
  })

  it('makes the link of a deleted provider with its id, and the link of an inactive one too: their visits are in the History', async () => {
    server()
    await showed()
    expect(linksOf(rowOf('ספק ישן')).map(hrefOf)).toEqual([`#history?provider=${ids.gone}&from=2026-10-08&to=2026-10-08`])
    expect(linksOf(rowOf('Иван')).map(hrefOf)).toEqual([`#history?provider=${ids.ivan}&from=2026-10-07&to=2026-10-07`])
  })

  it('draws a zero as an empty cell that reads "0", and is not a link', async () => {
    server()
    await showed()
    const zero = cellsOf(rowOf('פלוני'))[2]
    expect(zero.textContent).toBe('0')
    expect(zero.querySelector('a')).toBeNull()
    expect(zero.querySelector('.w-sr').textContent).toBe('0') // read by a screen reader, not drawn
    // a row of zeros has seven of them and no link at all
    expect(cellsOf(rowOf('גינון אלון')).map((c) => c.textContent)).toEqual(['0', '0', '0', '0', '0', '0', '0'])
    expect(linksOf(rowOf('גינון אלון'))).toHaveLength(0)
  })

  it('ends with the totals, and each total with visits links to the History of that day for everyone', async () => {
    server()
    await showed()
    const totals = screen.getByRole('rowheader', { name: 'סך הכול' }).closest('tr')
    expect(totals.closest('tfoot')).toBeTruthy()
    const days = DAYS.filter((_, i) => totalsOf([PLONI, ALMONI, SOLO, IVAN, GONE])[i] > 0)
    expect(linksOf(totals).map(hrefOf)).toEqual(days.map((day) => `#history?from=${day}&to=${day}`))
    expect(linksOf(totals).map(hrefOf).join(' ')).not.toContain('provider=')
  })

  it('has a total of 0 as an empty cell that is not a link, like any other zero', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 5] }] }) })
    await showed()
    const totals = screen.getByRole('rowheader', { name: 'סך הכול' }).closest('tr')
    expect(cellsOf(totals).map((c) => c.textContent)).toEqual(['0', '0', '0', '0', '0', '0', '5'])
    expect(linksOf(totals)).toHaveLength(1)
  })

  it('writes the number in every cell with visits, and its background is one of four steps by that number', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [1, 2, 3, 4, 6, 7, 120] }] }) })
    await showed()
    const links = linksOf(rowOf('פלוני'))
    expect(links.map((l) => l.textContent)).toEqual(['1', '2', '3', '4', '6', '7', '120']) // the number is always there: colour is never the only carrier
    expect(links.map((l) => [...l.classList].find((c) => /^a-count--\d$/.test(c)))).toEqual(
      ['a-count--1', 'a-count--2', 'a-count--2', 'a-count--3', 'a-count--3', 'a-count--4', 'a-count--4'],
    )
  })

  it('does not colour the totals by step (a sum is not a cell of the week), only the cells of the providers', async () => {
    server()
    await showed()
    const totals = screen.getByRole('rowheader', { name: 'סך הכול' }).closest('tr')
    for (const link of linksOf(totals)) {
      expect(link.classList.contains('a-count--total')).toBe(true)
      expect([...link.classList].some((c) => /^a-count--\d$/.test(c))).toBe(false)
    }
  })

  it('shows a week with no visit: every provider as a row of zeros (an absence is information), the totals zeros, no link', async () => {
    const quiet = [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }, { ...ALMONI, counts: [0, 0, 0, 0, 0, 0, 0] }]
    server({ home: homeSummary({ providers: quiet }) })
    await showed()
    expect(within(table()).getAllByRole('row')).toHaveLength(1 + 2 + 1) // the head, two providers, the totals
    expect(within(table()).queryAllByRole('link')).toHaveLength(0)
    expect(within(table()).getAllByRole('cell').every((c) => c.textContent === '0')).toBe(true)
  })

  it('starts the box at today: the end of the row, which is the left edge in a right-to-left page, and the right edge in a left-to-right one', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500)
    // the direction of the box only: everything else is asked of the real getComputedStyle (Testing Library reads it for the names of roles)
    const real = window.getComputedStyle.bind(window)
    let dir = 'rtl'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...rest) => {
      const style = real(el, ...rest)
      if (!el.classList?.contains('a-week')) return style
      return new Proxy(style, { get: (target, name) => (name === 'direction' ? dir : typeof target[name] === 'function' ? target[name].bind(target) : target[name]) })
    })
    server()
    await showed()
    const box = screen.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' })
    expect(box.scrollLeft).toBe(-500)
    cleanup()
    dir = 'ltr'
    server()
    await showed()
    expect(screen.getByRole('region', { name: 'נוכחות ב-7 הימים האחרונים' }).scrollLeft).toBe(500)
    width.mockRestore()
  })
})

// ---- the cards ----------------------------------------------------------------------------------------------------------------------

describe('the cards', () => {
  it('has a card for each screen, with its number and its words, and the whole card is the link', async () => {
    server()
    await showed()
    const cards = [...document.querySelectorAll('.a-grid a.a-stat')]
    expect(cards.map((c) => [c.textContent, hrefOf(c)])).toEqual([
      ['3נותני שירות פעיליםמתוך 5', '#providers'],
      ['3נקודות פעילותמתוך 4', '#points'],
      ['6ביקורים שלא נקלטו ב-7 הימים', '#history?outcome=not_counted&from=2026-10-06&to=2026-10-12'],
      ['2טלפונים עם ביקורים שממתינים לשליחה5 ביקורים בסך הכול', '#providers'],
      ['2חברי הוועד', '#settings'],
      ["1מפתחות אייג'נט פעילים", '#agent'],
    ])
  })

  it('links the card of the visits that were not counted to the History of the seven days, with the type "not counted"', async () => {
    server()
    await showed()
    const link = card('ביקורים שלא נקלטו')
    const query = new URLSearchParams(hrefOf(link).slice('#history?'.length))
    expect(Object.fromEntries(query)).toEqual({ outcome: 'not_counted', from: '2026-10-06', to: '2026-10-12' }) // the first and the last day of the table
    expect(hrefOf(link).startsWith('#history?')).toBe(true)
  })

  it('has its seven days from the server, not from the clock: the last day of the table is the end of the range', async () => {
    at('2027-05-05T09:00:00Z') // a clock far from the days of the answer
    server({ home: homeSummary({ days: ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'] }) })
    await showed()
    expect(hrefOf(card('ביקורים שלא נקלטו'))).toBe('#history?outcome=not_counted&from=2026-03-01&to=2026-03-07')
  })

  it('shows the waiting phones only when there is one, and says how many visits wait (one in the singular)', async () => {
    server({ home: homeSummary({ counts: { waiting: { phones: 0, visits: 0 } } }) })
    await showed()
    expect(screen.queryByRole('link', { name: /טלפונים עם ביקורים/ })).toBeNull()
    expect(document.querySelectorAll('.a-grid a.a-stat')).toHaveLength(5)
    cleanup()
    server({ home: homeSummary({ counts: { waiting: { phones: 1, visits: 1 } } }) })
    await showed()
    expect(card('טלפונים עם ביקורים').textContent).toBe('1טלפונים עם ביקורים שממתינים לשליחהביקור אחד בסך הכול')
    expect(document.querySelectorAll('.a-grid a.a-stat')).toHaveLength(6)
  })

  it('writes 0 for a count of zero (it is a number, and the card is still a link)', async () => {
    server({ home: homeSummary({ counts: { visits_not_counted: 0, agent_keys: { active: 0 } } }) })
    await showed()
    expect(card('ביקורים שלא נקלטו').textContent).toBe('0ביקורים שלא נקלטו ב-7 הימים')
    expect(card("מפתחות אייג'נט").textContent).toBe("0מפתחות אייג'נט פעילים")
  })

  it('has the total of the points and of the providers beside their active ones', async () => {
    server({ home: homeSummary({ counts: { points: { active: 7, total: 7 }, providers: { active: 1, total: 12 } } }) })
    await showed()
    expect(card('נקודות פעילות').textContent).toBe('7נקודות פעילותמתוך 7')
    expect(card('נותני שירות פעילים').textContent).toBe('1נותני שירות פעיליםמתוך 12')
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
    expect(document.querySelector('.a-grid')).toBeNull()
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

  it('shows the table and the cards for a building that has providers and points and no visit in the week', async () => {
    server({ home: homeSummary({ providers: [{ ...PLONI, counts: [0, 0, 0, 0, 0, 0, 0] }], counts: { visits_not_counted: 0, waiting: { phones: 0, visits: 0 } } }) })
    await showed()
    expect(screen.queryByRole('heading', { name: 'עוד אין נקודות ונותני שירות' })).toBeNull()
    expect(document.querySelectorAll('.a-grid a.a-stat')).toHaveLength(5)
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
    // at once: the kept table, no spinner
    expect(screen.queryByRole('status')).toBeNull()
    expect(linksOf(rowOf('פלוני')).map((l) => l.textContent)).toEqual(['9', '9', '9', '9', '9', '9', '9'])
    expect(homeCalls()).toBe(1) // and it asked again
    await act(async () => { release() })
    await waitFor(() => expect(linksOf(rowOf('פלוני')).map((l) => l.textContent)).toEqual(['1', '2', '4', '7', '3', '2']))
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
  const cell = (name, day) => linksOf(rowOf(name)).find((l) => hrefOf(l).includes(`from=${day}&`))

  it('opens on Home when the address names no screen, and the title of the window says so', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('heading', { level: 1, name: /^בוקר טוב, Sample$/ })
    await screen.findByRole('table')
    await waitFor(() => expect(document.title).toBe('בית · נוכחות בבניין'))
  })

  it.each(['phone', 'computer'])('opens the History with exactly the filters of the cell that is followed, on a %s', async (kind) => {
    layout(kind === 'phone')
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    const link = cell('פלוני', '2026-10-09')
    fireEvent.click(link) // a link to #history?...
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scans').length).toBeGreaterThan(0))
    expect(asked('/admin/scans').at(-1)).toMatchObject({ provider_id: ids.ploni, from: '2026-10-09', to: '2026-10-09', outcome: 'accepted' })
    expect(asked('/admin/scans').every((q) => q.provider_id === ids.ploni && q.from === '2026-10-09' && q.to === '2026-10-09'), 'no request of another filter first').toBe(true)
    // the address is the plain one afterwards, and the screen did not change
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    if (kind === 'phone') expect(screen.getAllByRole('button', { name: /^הסרת סינון/ }).map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('פלוני')]))
    else expect(screen.getByLabelText('נותן שירות')).toHaveProperty('value', ids.ploni)
  })

  it('opens the History of everyone for a total, and of the seven days for the visits that were not counted', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    const totals = screen.getByRole('rowheader', { name: 'סך הכול' }).closest('tr')
    fireEvent.click(linksOf(totals)[0])
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scans').length).toBeGreaterThan(0))
    expect(asked('/admin/scans').at(-1)).toMatchObject({ from: '2026-10-06', to: '2026-10-06', outcome: 'accepted' })
    expect(asked('/admin/scans').at(-1)).not.toHaveProperty('provider_id')
  })

  it.each([
    ['providers', '#providers', 'נותני שירות פעילים', 'נותני שירות'],
    ['points', '#points', 'נקודות פעילות', 'נקודות סריקה'],
    ['the waiting phones', '#providers', 'טלפונים עם ביקורים', 'נותני שירות'],
    ['the members', '#settings', 'חברי הוועד', 'הגדרות'],
    ['the keys', '#agent', "מפתחות אייג'נט", "גישה לאייג'נט"],
  ])('opens the screen of the card of %s', async (_what, hash, label, title) => {
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
    fireEvent.click(card(label))
    await heading(title)
    expect(window.location.hash).toBe(hash)
  })

  it('opens the History of the visits that were not counted from its card, with the seven days', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(card('ביקורים שלא נקלטו'))
    await heading('היסטוריית נוכחות')
    await waitFor(() => expect(asked('/admin/scan-refusals').length).toBeGreaterThan(0))
    expect(asked('/admin/scan-refusals').at(-1)).toMatchObject({ from: '2026-10-06', to: '2026-10-12' })
    expect(asked('/admin/scans')).toHaveLength(0) // the visits that were not counted are not scans: the list is the refusals
  })

  it('goes back to Home with Back after a link, and then asks Home for its numbers again, drawing the kept ones at once', async () => {
    server()
    render(<AdminApp />)
    await screen.findByRole('table')
    fireEvent.click(cell('פלוני', '2026-10-09'))
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
