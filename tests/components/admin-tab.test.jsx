// @vitest-environment jsdom
// The tab of the committee app follows the address (#history). The real AdminApp, signed in, with the network (`api`)
// answered by the test: every screen gets an empty list, which is enough to show its heading.
//
// Eight screens. Home, history, points and providers (the work group) are buttons of the tab bar of the phone and of the side rail; agent,
// settings, audit and help (the management group) are in the side rail and, on a phone, in the sheet that the fifth button of the bar,
// "עוד", opens. The first screen is Home (it was the history before Home came), and the old address #committee lands on the settings.
//
// What went wrong: the tab was read from the address once, in the first render, and the listener for a change of the address
// was attached later, in an effect. A change that came in between was lost and the app stayed on the first tab. A link that is
// opened right after sign-in (or a test that does `page.goto('/admin#history')` at that moment) hit it. The address is now
// an external store that React subscribes to (src/admin/tab.js): after subscribing React reads it again, so nothing is lost.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import AdminApp from '../../src/pages/AdminApp.jsx'
import { tabFromHash, hashQuery, hashName, RENAMED_TABS } from '../../src/admin/tab.js'
import { api } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sample Member', email: 'member@example.test' }
const TITLE_SUFFIX = ' · נוכחות בבניין'

// Each tab: its key in the address, its name as a page (the first part of the title of the document), the short name on its button
// (`nav`, in the side rail and in the tab bar), the heading that its screen draws, and whether it is a button of the tab bar of the phone
// (`bar`) or one of the screens under "עוד". In the order of the side rail; the first one is the screen that opens by default.
const TABS = [
  // Home's h1 is a greeting that follows the hour (HomeView.jsx), so it is found by the three greetings and the first word of ADMIN's name.
  { key: 'home', label: 'בית', nav: 'בית', heading: /^(בוקר טוב|צהריים טובים|ערב טוב), Sample$/, bar: true },
  { key: 'history', label: 'היסטוריה', nav: 'היסטוריה', heading: 'היסטוריית נוכחות', bar: true },
  { key: 'points', label: 'נקודות', nav: 'מיקומים', heading: 'נקודות סריקה', bar: true }, // the button says "מיקומים", the title and the window say "נקודות"
  { key: 'providers', label: 'נותני שירות', nav: 'ספקים', heading: 'נותני שירות', bar: true },
  { key: 'agent', label: 'אייג׳נט', nav: 'אייג׳נט', heading: "גישה לאייג'נט", bar: false },
  { key: 'settings', label: 'הגדרות', nav: 'הגדרות', heading: 'הגדרות', bar: false },
  { key: 'audit', label: 'יומן פעולות', nav: 'יומן פעולות', heading: 'יומן פעולות', bar: false },
  { key: 'help', label: 'איך עובדים עם המערכת', nav: 'עזרה', heading: 'איך עובדים עם המערכת', bar: false },
]
const MORE = TABS.filter((t) => !t.bar)
const BAR_NAMES = TABS.filter((t) => t.bar).map((t) => t.nav) // the buttons of the tab bar but the last, "עוד"
const byKey = Object.fromEntries(TABS.map((t) => [t.key, t]))
const FIRST = TABS[0].key

window.scrollTo = vi.fn() // the shell scrolls to the top on a tab change; jsdom has no scrolling

afterEach(() => {
  cleanup()
  vi.restoreAllMocks() // the spy on window.addEventListener
  window.history.replaceState(null, '', '/')
  document.title = ''
  vi.clearAllMocks()
})

// What GET /api/admin/home answers for a building with nothing in it: enough for the screen to draw its heading.
const HOME = {
  days: ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'],
  week: { providers: [], totals: [0, 0, 0, 0, 0, 0, 0] },
  counts: {
    points: { active: 0, total: 0 }, providers: { active: 0, total: 0 }, committee_members: { active: 1 }, agent_keys: { active: 0 },
    visits_not_counted: 0, waiting: { phones: 0, visits: 0 },
  },
}

function answerLikeTheServer() {
  api.mockImplementation(async (path) => {
    if (path === '/admin/config') return { google_client_id: '', dev_login: false }
    if (path === '/admin/me') return { admin: ADMIN }
    if (path === '/admin/home') return HOME
    if (path === '/admin/points') return { points: [] }
    if (path === '/admin/providers') return { providers: [] }
    if (path.startsWith('/admin/scans')) return { scans: [], next_cursor: null }
    if (path === '/admin/api-keys') return { api_keys: [] }
    if (path === '/admin/admins') return { admins: [] }
    if (path === '/admin/building') return { building: { address: '' } }
    if (path.startsWith('/admin/audit')) return { entries: [], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}

const heading = (tab) => screen.findByRole('heading', { level: 1, name: byKey[tab].heading })
// The page that is shown now, by the headings of the eight screens. At most one of them is there.
const shown = () => TABS.filter((t) => screen.queryByRole('heading', { level: 1, name: t.heading })).map((t) => t.key)
// Both navigations are in the page (the side rail and the tab bar of the phone: CSS hides one), so a screen of the bar is found twice: first
// in the side rail, then in the bar. A screen under "עוד" is in the side rail only, until the sheet is open.
const buttons = (tab) => screen.getAllByRole('button', { name: byKey[tab].nav })
const current = (tab) => buttons(tab).map((b) => b.getAttribute('aria-current'))
const bar = () => screen.getByRole('navigation', { name: 'ניווט ראשי (טלפון)' })
const rail = () => screen.getByRole('navigation', { name: 'ניווט ראשי' })
const moreButton = () => within(bar()).getByRole('button', { name: 'עוד' })
const sheet = () => screen.queryByRole('dialog', { name: 'עוד' })
// A row of the sheet is named by the screen's name followed by the line under it (aria-labelledby with both ids): the name holds all the text
// that the button shows (WCAG 2.5.3), and a button is found by the start of its name, the screen's name.
const rowIds = (b) => b.getAttribute('aria-labelledby').split(' ')
const rowName = (b) => document.getElementById(rowIds(b)[0]).textContent
const rowSub = (b) => document.getElementById(rowIds(b)[1]).textContent
const row = (scope, label) => within(scope).getByRole('button', { name: new RegExp(`^${label} `) })

/** A person (or a test) opens another address of the same page: the address changes, and the browser says so. */
async function openByAddress(hash) {
  await act(async () => {
    window.location.hash = hash
    await new Promise((resolve) => setTimeout(resolve, 20)) // jsdom fires `hashchange` a moment later, as a browser does
  })
}

describe('the tab that the address names when the app opens', () => {
  it.each(TABS)('opens $key from #$key', async ({ key }) => {
    answerLikeTheServer()
    window.history.replaceState(null, '', `/#${key}`)
    render(<AdminApp />)
    await heading(key)
    expect(shown()).toEqual([key])
    // the side rail marks it; so does the tab bar: the button of the screen, or "עוד" when the screen is one of those under it
    expect(within(rail()).getByRole('button', { name: byKey[key].nav }).getAttribute('aria-current')).toBe('page')
    if (byKey[key].bar) expect(current(key)).toEqual(['page', 'page'])
    else expect(moreButton().getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(document.title).toBe(`${byKey[key].label}${TITLE_SUFFIX}`)) // the title is set by an effect after the heading is drawn
  })

  it.each([['no hash', ''], ['an empty hash', '#'], ['a name that is not a tab', '#nowhere'], ['a tab with something after it', '#points/x'], ['the wrong case', '#Points']])(
    'opens the first tab (Home) for %s',
    async (_what, hash) => {
      answerLikeTheServer()
      window.history.replaceState(null, '', `/${hash}`)
      render(<AdminApp />)
      await heading(FIRST)
      expect(FIRST).toBe('home')
      expect(shown()).toEqual([FIRST])
      expect(current(FIRST)).toEqual(['page', 'page'])
      expect(moreButton().getAttribute('aria-current')).toBeNull()
    },
  )

  // A link can carry a query after the name of the tab (`#history?provider=...`, src/admin/tab.js): the tab is the part before the `?`.
  // The row `['a tab with something after it', '#points?x=1']` of the list above opened the first tab before links had a query; it
  // is `#points/x` there now (still no tab), and `#points?x=1` opens the points, here.
  it.each([
    ['a tab with a query', '#points?x=1', 'points'],
    ['the first tab with a query', '#history?provider=1&from=2026-10-01', 'history'],
    ['a tab with an empty query', '#providers?', 'providers'],
    ['a renamed tab with a query', '#committee?x=1', 'settings'],
    ['a name that is not a tab, with a query', '#nowhere?x=1', 'home'],
    ['a tab with a query but the wrong case', '#Points?x=1', 'home'],
  ])('opens the tab before the ? for %s', async (_what, hash, key) => {
    answerLikeTheServer()
    window.history.replaceState(null, '', `/${hash}`)
    render(<AdminApp />)
    await heading(key)
    expect(shown()).toEqual([key])
    expect(within(rail()).getByRole('button', { name: byKey[key].nav }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(document.title).toBe(`${byKey[key].label}${TITLE_SUFFIX}`))
  })

  it('opens the settings for #committee, the address of the screen that held the members, the building, the guide and the audit log', async () => {
    answerLikeTheServer()
    window.history.replaceState(null, '', '/#committee')
    render(<AdminApp />)
    await heading('settings')
    expect(shown()).toEqual(['settings'])
    expect(within(rail()).getByRole('button', { name: 'הגדרות' }).getAttribute('aria-current')).toBe('page')
    expect(moreButton().getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(document.title).toBe(`הגדרות${TITLE_SUFFIX}`))
  })
})

describe('the address that changes between the first render and the listener', () => {
  it('opens the tab that the address names by then (the race)', async () => {
    answerLikeTheServer()
    let moved = 0
    const attach = window.addEventListener.bind(window)
    // Just before the app attaches its listener for `hashchange`, the address changes the way a link that is opened at that
    // moment changes it. `replaceState` fires no `hashchange`, so only reading the address again after subscribing can see it. (A tab
    // that is not the first one: the first is what the app shows when it has not seen the change.)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) => {
      if (type === 'hashchange' && moved === 0) {
        moved += 1
        window.history.replaceState(null, '', '#points')
      }
      return attach(type, ...rest)
    })

    render(<AdminApp />)
    // the shell is drawn and has attached its listener, and the address changed just before that
    await waitFor(() => expect(moved, 'the address changed before the listener was attached').toBe(1))
    await heading('points')
    expect(shown()).toEqual(['points'])
    expect(current('points')).toEqual(['page', 'page'])
    await waitFor(() => expect(document.title).toBe(`${byKey.points.label}${TITLE_SUFFIX}`)) // the title is set by an effect after the heading is drawn
  })
})

describe('changing the tab while the app is open', () => {
  it('follows a change of the address, and a change back, and goes to the first tab when the address names none', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)

    await openByAddress('#points')
    await heading('points')
    expect(shown()).toEqual(['points'])
    await waitFor(() => expect(document.title).toBe(`${byKey.points.label}${TITLE_SUFFIX}`)) // the title is set by an effect after the heading is drawn

    await openByAddress('#committee')
    await heading('settings')
    expect(shown()).toEqual(['settings'])

    await openByAddress('#audit')
    await heading('audit')
    expect(shown()).toEqual(['audit'])

    await openByAddress('#nowhere')
    await heading(FIRST)
    expect(shown()).toEqual([FIRST])
  })

  it('follows an address with a query to another tab, and leaves the tab as it is when only the query changes', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)

    await openByAddress('#points?x=1')
    await heading('points')
    expect(shown()).toEqual(['points'])

    // the same tab with another query, and with none: still the points (the heading is the same element, nothing was drawn again)
    const title = screen.getByRole('heading', { level: 1, name: byKey.points.heading })
    await openByAddress('#points?x=2')
    await openByAddress('#points')
    expect(shown()).toEqual(['points'])
    expect(screen.getByRole('heading', { level: 1, name: byKey.points.heading })).toBe(title)

    await openByAddress('#history?x=1')
    await heading('history')
    expect(shown()).toEqual(['history'])
  })

  it('follows the back button', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)
    await openByAddress('#providers')
    await heading('providers')
    await openByAddress('#agent')
    await heading('agent')

    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await heading('providers')
    expect(shown()).toEqual(['providers'])
    expect(window.location.hash).toBe('#providers')
  })

  it.each(TABS)('opens $key from its button in the side rail, and a screen of the bar also from its button in the tab bar, and puts it in the address', async ({ key, bar: inBar }) => {
    answerLikeTheServer()
    for (const index of inBar ? [0, 1] : [0]) {
      // from another screen each time, so that every button has somewhere to go from
      const from = key === 'points' ? 'history' : 'points'
      window.history.replaceState(null, '', `/#${from}`)
      render(<AdminApp />)
      await heading(from)

      fireEvent.click(buttons(key)[index])
      await heading(key)
      await waitFor(() => expect(window.location.hash).toBe(`#${key}`))
      expect(shown()).toEqual([key])
      expect(within(rail()).getByRole('button', { name: byKey[key].nav }).getAttribute('aria-current')).toBe('page')
      for (const other of TABS.filter((t) => t.key !== key)) {
        expect(within(rail()).getByRole('button', { name: other.nav }).getAttribute('aria-current'), `${other.key} is not the current page`).toBeNull()
      }
      await waitFor(() => expect(document.title).toBe(`${byKey[key].label}${TITLE_SUFFIX}`)) // the title is set by an effect after the heading is drawn
      cleanup()
    }
  })

  it('scrolls to the top and puts the focus on the content when the screen changes, also to a screen under "עוד"', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)
    window.scrollTo.mockClear()
    fireEvent.click(moreButton())
    fireEvent.click(row(sheet(), 'הגדרות'))
    await heading('settings')
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')))
  })
})

describe('the tab bar of the phone and the side rail', () => {
  it('has exactly five buttons in the bar: home, history, points, providers and "עוד", in this order', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent)).toEqual([...BAR_NAMES, 'עוד'])
  })

  it('has all eight screens in the side rail, Home first, in two groups with a separator between them', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)
    expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(TABS.map((t) => t.nav))
    expect(within(rail()).getAllByRole('separator')).toHaveLength(1)
    // the separator is between the fourth and the fifth button
    expect([...rail().children].map((n) => (n.tagName === 'HR' ? '|' : n.textContent))).toEqual([...BAR_NAMES, '|', ...MORE.map((t) => t.nav)])
  })

  // The bar floats, and only the current button says its name (the others are an icon): the name of each stays in the page, visually hidden
  // (`w-sr`), so every button has its accessible name. Which one is visible is the current one, or "עוד" while a screen under it is open.
  const saysItsName = () => within(bar()).getAllByRole('button').map((b) => [b.textContent, !b.querySelector('.a-nav-label').classList.contains('w-sr')])
  /** What `saysItsName` is when `current` (a key of TABS, or 'more') is the button that says its name. */
  const sayingOnly = (current) => [...TABS.filter((t) => t.bar).map((t) => [t.nav, t.key === current]), ['עוד', current === 'more']]

  it('shows the name of the current button only, and every other button keeps its name for a screen reader', async () => {
    answerLikeTheServer()
    window.history.replaceState(null, '', '/#points')
    render(<AdminApp />)
    await heading('points')
    expect(saysItsName()).toEqual(sayingOnly('points'))
    for (const name of [...BAR_NAMES, 'עוד']) expect(within(bar()).getByRole('button', { name, exact: true })).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: byKey.providers.nav, exact: true }))
    await heading('providers')
    expect(saysItsName()).toEqual(sayingOnly('providers'))
  })

  it('shows "עוד" as the one that says its name while a screen under it is open', async () => {
    answerLikeTheServer()
    window.history.replaceState(null, '', '/#settings')
    render(<AdminApp />)
    await heading('settings')
    expect(saysItsName()).toEqual(sayingOnly('more'))
  })

  it('says that "עוד" opens a dialog, and whether it is open', async () => {
    answerLikeTheServer()
    render(<AdminApp />)
    await heading(FIRST)
    expect(moreButton().getAttribute('aria-haspopup')).toBe('dialog')
    expect(moreButton().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(moreButton())
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
  })
})

describe('the sheet under "עוד"', () => {
  /** Opens the app on `hash` (the first screen when empty) and the sheet, and returns the sheet. */
  async function open(hash = '') {
    answerLikeTheServer()
    window.history.replaceState(null, '', `/${hash}`)
    render(<AdminApp />)
    await heading(hash ? hash.slice(1) : FIRST)
    expect(sheet()).toBeNull()
    fireEvent.click(moreButton())
    return sheet()
  }

  it('is a modal dialog named "עוד" that lists the four other screens, each with an icon and its whole name', async () => {
    const dialog = await open()
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const items = within(within(dialog).getByRole('navigation', { name: 'מסכים נוספים' })).getAllByRole('button')
    expect(items.map(rowName)).toEqual(MORE.map((t) => t.label))
    for (const item of items) {
      expect(item.querySelector('svg'), rowName(item)).toBeTruthy()
      expect(rowSub(item), `${rowName(item)} has a line about the screen`).not.toBe('')
      expect(row(dialog, rowName(item)), 'found by the name of the screen').toBe(item)
      expect(item.textContent, 'its name holds all the text that the button shows').toBe(`${rowName(item)} ${rowSub(item)}`)
    }
  })

  it('marks no screen when the open screen is one of the bar, and "עוד" is not the current item either', async () => {
    const dialog = await open('#points')
    for (const item of within(dialog).getByRole('navigation', { name: 'מסכים נוספים' }).querySelectorAll('button')) expect(item.getAttribute('aria-current')).toBeNull()
    expect(moreButton().getAttribute('aria-current')).toBeNull()
  })

  it.each(MORE)('marks $key as the current screen when it is open, and "עוד" is the current item of the bar', async ({ key, label }) => {
    const dialog = await open(`#${key}`)
    const marked = [...within(dialog).getByRole('navigation', { name: 'מסכים נוספים' }).querySelectorAll('button')].filter((b) => b.getAttribute('aria-current') === 'page')
    expect(marked.map(rowName)).toEqual([label])
    expect(moreButton().getAttribute('aria-current')).toBe('page')
  })

  it.each(MORE)('goes to $key and closes when it is chosen', async ({ key, label }) => {
    const dialog = await open()
    fireEvent.click(row(dialog, label))
    await heading(key)
    await waitFor(() => expect(window.location.hash).toBe(`#${key}`))
    expect(sheet()).toBeNull()
    expect(moreButton().getAttribute('aria-expanded')).toBe('false')
    expect(moreButton().getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(document.title).toBe(`${label}${TITLE_SUFFIX}`))
  })

  it('moves the focus in, keeps it inside, and gives it back to "עוד" on Escape', async () => {
    const dialog = await open()
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Tab from the last button wraps to the first, and Shift+Tab from the first wraps to the last
    const buttons = within(dialog).getAllByRole('button')
    buttons.at(-1).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().getAttribute('aria-expanded')).toBe('false')
    expect(shown()).toEqual([FIRST]) // closing changes nothing else
  })

  it('closes on a tap outside the sheet, and on its close button, and gives the focus back each time', async () => {
    await open()
    fireEvent.mouseDown(document.querySelector('.a-overlay'))
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(moreButton())

    fireEvent.click(moreButton())
    const dialog = sheet()
    fireEvent.mouseDown(dialog) // a tap inside does not close it
    expect(sheet()).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(moreButton())
  })

  it('has no question about unsaved changes (it has no form)', async () => {
    const dialog = await open()
    expect(dialog.querySelector('form, input, select, textarea')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull() // and no "close without saving?" on top
  })

  it('stays on the same screen, and gives the focus back to "עוד", when the screen that is already open is chosen', async () => {
    const dialog = await open('#audit')
    fireEvent.click(row(dialog, 'יומן פעולות'))
    expect(sheet()).toBeNull()
    expect(shown()).toEqual(['audit'])
    expect(document.activeElement).toBe(moreButton())
  })
})

describe('tabFromHash', () => {
  const keys = ['one', 'two', 'three']
  it('names the tab after the #, and the first key for anything else', () => {
    expect(tabFromHash(keys, '#two')).toBe('two')
    expect(tabFromHash(keys, '#three')).toBe('three')
    expect(tabFromHash(keys, '')).toBe('one')
    expect(tabFromHash(keys, '#')).toBe('one')
    expect(tabFromHash(keys, '#four')).toBe('one')
    expect(tabFromHash(keys, '#Two')).toBe('one')
    expect(tabFromHash(keys, 'two')).toBe('one') // `slice(1)` takes the # off: a hash always starts with one
    expect(tabFromHash(keys, '#committee')).toBe('one') // a renamed address lands on its new screen only when that screen is among the keys
  })

  it('lands the address of a screen that was split on the screen that took its place', () => {
    const screens = ['history', 'points', 'settings', 'audit', 'help']
    expect(tabFromHash(screens, '#committee')).toBe('settings')
    expect(tabFromHash(screens, '#settings')).toBe('settings')
    expect(tabFromHash(screens, '#Committee')).toBe('history') // the wrong case is no address
    expect(tabFromHash(screens, '#committee2')).toBe('history')
    expect(RENAMED_TABS.get('committee')).toBe('settings')
    for (const [, target] of RENAMED_TABS) expect(screens).toContain(target)
  })

  it('reads the address of the page when it is not given a hash', () => {
    window.history.replaceState(null, '', '/#three')
    expect(tabFromHash(keys)).toBe('three')
  })

  it('decides by the part before the ?, so a link with a query opens the same tab as the plain address', () => {
    expect(tabFromHash(keys, '#two?x=1')).toBe('two')
    expect(tabFromHash(keys, '#three?a=1&b=2')).toBe('three')
    expect(tabFromHash(keys, '#two?')).toBe('two')
    expect(tabFromHash(keys, '#two??x=1')).toBe('two') // the first ? ends the name
    expect(tabFromHash(keys, '#two?x=#three')).toBe('two') // a tab's name inside the query is not an address
    expect(tabFromHash(keys, '#?x=1')).toBe('one') // no name: the first tab
    expect(tabFromHash(keys, '#four?x=1')).toBe('one') // a name that is not a tab, whatever follows
    expect(tabFromHash(keys, '#Two?x=1')).toBe('one') // the wrong case
    expect(tabFromHash(keys, '#?two')).toBe('one') // the query does not name a tab
    expect(tabFromHash(keys, '#two ?x=1')).toBe('one') // the name is exactly what is before the ?
  })

  it('applies the renamed tabs to the part before the ?', () => {
    const screens = ['history', 'points', 'settings', 'audit', 'help']
    expect(tabFromHash(screens, '#committee?x=1')).toBe('settings')
    expect(tabFromHash(screens, '#committee2?x=1')).toBe('history')
    expect(tabFromHash(screens, '#Committee?x=1')).toBe('history')
    expect(tabFromHash(screens, '#settings?x=1')).toBe('settings')
    expect(tabFromHash(['one', 'two'], '#committee?x=1')).toBe('one') // renamed to a screen that is not among the keys
  })

  it('opens the first tab for a hash that is no screen, with or without a query', () => {
    expect(tabFromHash(keys, '#nowhere')).toBe('one')
    expect(tabFromHash(keys, '#nowhere?provider=1&from=2026-10-01')).toBe('one')
    expect(tabFromHash(keys, '#history?provider=1')).toBe('one') // not among these keys
    expect(tabFromHash(['history', 'points'], '#history?provider=1&from=2026-10-01&to=2026-10-07&outcome=all')).toBe('history')
  })

  it('reads the query of the address of the page when it is not given a hash', () => {
    window.history.replaceState(null, '', '/admin#two?x=1')
    expect(tabFromHash(keys)).toBe('two')
    expect(hashQuery().get('x')).toBe('1')
    expect(hashName()).toBe('two')
  })
})

describe('hashQuery', () => {
  it('is the query after the first ? of the address, as URLSearchParams', () => {
    const query = hashQuery('#history?provider=abc&from=2026-10-01&to=2026-10-07&outcome=not_counted')
    expect(query).toBeInstanceOf(URLSearchParams)
    expect(Object.fromEntries(query)).toEqual({ provider: 'abc', from: '2026-10-01', to: '2026-10-07', outcome: 'not_counted' })
  })

  it('is empty for an address with no query, an empty one, or none at all', () => {
    for (const hash of ['', '#', '#history', '#history?', '#?', 'history']) expect([...hashQuery(hash)], JSON.stringify(hash)).toEqual([])
  })

  it('decodes what the browser encoded, and keeps a second ? and a # inside a value', () => {
    expect(hashQuery('#history?provider=a%20b&x=%D7%A9').get('provider')).toBe('a b')
    expect(hashQuery('#history?provider=a%20b&x=%D7%A9').get('x')).toBe('ש')
    expect(hashQuery('#history?a=b?c').get('a')).toBe('b?c')
    expect(hashQuery('#history?a=1&a=2').getAll('a')).toEqual(['1', '2'])
    expect(hashQuery('#history?flag').has('flag')).toBe(true)
    expect(hashQuery('#history?a=1').has('b')).toBe(false)
  })

  it('does not depend on the name before the ?', () => {
    expect(hashQuery('#nowhere?x=1').get('x')).toBe('1')
    expect(hashQuery('#committee?x=1').get('x')).toBe('1')
  })
})

describe('hashName', () => {
  it('is what is between the # and the first ?, as written', () => {
    expect(hashName('#history')).toBe('history')
    expect(hashName('#history?provider=1')).toBe('history')
    expect(hashName('#History?x=1')).toBe('History') // not changed: the case and the renamed tabs are for tabFromHash
    expect(hashName('#committee?x=1')).toBe('committee')
    expect(hashName('#?x=1')).toBe('')
    expect(hashName('#')).toBe('')
    expect(hashName('')).toBe('')
  })
})
