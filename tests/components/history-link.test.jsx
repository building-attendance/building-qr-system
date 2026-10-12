// @vitest-environment jsdom
// A link can open the History tab with its filters set: `#history?provider=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=<type>`, every
// parameter optional (src/admin/views/HistoryView.jsx, `readLink`; src/admin/tab.js, `hashQuery`). The real HistoryView, and for the
// part about the address and the tab the real AdminApp, with the network (`api`) answered by the test and the layout told by a stub of
// `matchMedia` (jsdom has none, which `usePhoneLayout` reads as a computer).
//
// What these tests hold: the first request already carries the link's filters (there is no request of the defaults before it, and nothing
// waits for the pause of 350 ms); a parameter that is not valid is left out quietly and its filter keeps its default; a provider that
// the list of providers does not hold is dropped before any request names it; the address becomes a plain `#history` afterwards, without
// the screen changing; a link followed while the screen is open is applied the same way; and the transitions that a filter bar has
// (the window crossing 1024 px, a date half typed, a sheet that is open, the back button, a reload).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import HistoryView from '../../src/admin/views/HistoryView.jsx'
import AdminApp from '../../src/pages/AdminApp.jsx'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { clearLoadCache, setLoadCache, LOAD_KEY } from '../../src/admin/loadCache.js'
import { api } from '../../src/api/client.js'
import { OUTCOME_ACCEPTED, SOURCE_ONLINE } from '../../shared/contract.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

// ---- the layout ------------------------------------------------------------------------------------------------------------------

/** Stands in for `window.matchMedia` with one query whose answer the test changes (the window crossing 1024 px). */
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

// ---- the data --------------------------------------------------------------------------------------------------------------------

const POINT = { id: '11111111-1111-4111-8111-111111111111', name: 'לובי' }
const PLONI = { id: '33333333-3333-4333-8333-333333333333', company: 'ניקיון', contact_name: 'פלוני' }
const ALMONI = { id: '55555555-5555-4555-8555-555555555555', company: 'גינון', contact_name: 'אלמוני' }
const UNKNOWN = '99999999-9999-4999-8999-999999999999' // well formed, and not a provider of this building
const PROVIDERS = [PLONI, ALMONI]

// A fixed "today", so that the default week is known: 29/09/2026 to 05/10/2026. Only the clock of Date is faked: the pause before a query
// and Testing Library's waiting keep running on real timers.
const FROM = '2026-09-29'
const TO = '2026-10-05'

const visit = (id, provider, name) => ({
  id, local_date: TO, checked_in_at: '2026-10-05T06:00:00Z', point_id: POINT.id, point_name: POINT.name,
  provider_id: provider.id, provider_name: name, outcome: OUTCOME_ACCEPTED, source: SOURCE_ONLINE,
  distance_m: null, flags: [], voided: false, void_reason: null,
})
const SCANS = [visit('s1', PLONI, 'ביקור של פלוני'), visit('s2', ALMONI, 'ביקור של אלמוני')]

const WAIT = { timeout: 4000 }
const calls = (prefix) => api.mock.calls.map(([path]) => path).filter((path) => path.startsWith(prefix))
const asked = (prefix) => calls(prefix).map((path) => Object.fromEntries(new URL(path, 'http://x').searchParams))
const lastAsked = (prefix) => asked(prefix).at(-1)
const sleep = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

/**
 * What the server answers. The list of scans is narrowed by `provider_id` the way the server does it, so that what the screen shows says
 * which provider it asked for. `providersGate` holds the answer of the providers until the test releases it; `providers` is the list that
 * it answers with; `providersFail` makes that request fail.
 */
function server({ providers = PROVIDERS, providersGate = null, providersFail = false } = {}) {
  api.mockImplementation(async (path) => {
    if (path === '/admin/points') return { points: [POINT] }
    if (path === '/admin/providers') {
      if (providersGate) await providersGate.promise
      if (providersFail) throw new Error('no connection')
      return { providers }
    }
    if (path.startsWith('/admin/scans')) {
      const providerId = new URL(path, 'http://x').searchParams.get('provider_id')
      return { scans: SCANS.filter((s) => !providerId || s.provider_id === providerId), next_cursor: null }
    }
    if (path.startsWith('/admin/scan-refusals')) return { refusals: [], next_cursor: null }
    throw new Error(`the test does not expect ${path}`)
  })
}

/** A visit to the committee's providers earlier in the session: the list that `useLoad` keeps, so that this screen starts with it. */
const knownProviders = (providers = PROVIDERS) => setLoadCache(LOAD_KEY.providers, { providers })

/** Opens the app at `hash` (the address that a link was clicked from, or typed). */
function openAt(hash) {
  window.history.replaceState(null, '', `/${hash}`)
}
const show = () => render(<ToastProvider><ConfirmProvider><HistoryView /></ConfirmProvider></ToastProvider>)
const listed = (text) => screen.findByText(text, {}, WAIT)

/** A person (or a link) changes the address while the screen is open: the address changes, and the browser says so. */
async function follow(hash) {
  await act(async () => {
    window.location.hash = hash
    await new Promise((resolve) => setTimeout(resolve, 20)) // jsdom fires `hashchange` a moment later, as a browser does
  })
}

const opener = () => screen.getByRole('button', { name: /^סינון/ })
const sheet = () => screen.getByRole('dialog', { name: 'סינון' })
const chips = () => screen.queryAllByRole('button', { name: /^הסרת סינון/ }).map((b) => b.textContent)
const range = () => document.querySelector('.a-filterbar__range').textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
  clearLoadCache()
})
afterEach(() => {
  cleanup()
  delete window.matchMedia
  window.history.replaceState(null, '', '/')
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ---- the first render ------------------------------------------------------------------------------------------------------------

describe('a link that opens the screen', () => {
  it('asks at once for what the link says, and for nothing else first', async () => {
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&to=2026-09-03&outcome=all`)
    show()
    await listed('ביקור של פלוני')
    expect(asked('/admin/scans')).toEqual([{ from: '2026-09-01', to: '2026-09-03', provider_id: PLONI.id, outcome: 'all', limit: '100' }])
    expect(screen.queryByText('ביקור של אלמוני'), 'the list is of the provider of the link').toBeNull()
    await sleep(600) // longer than the pause before a query: nothing was waiting for it
    expect(calls('/admin/scans'), 'one request, no request for the defaults before or after it').toHaveLength(1)
  })

  it('shows the same values in the inline fields of a computer', async () => {
    knownProviders()
    server()
    openAt(`#history?provider=${ALMONI.id}&from=2026-09-01&to=2026-09-03&outcome=rejected`)
    show()
    await listed('ביקור של אלמוני')
    expect(screen.getByLabelText('מתאריך').value).toBe('01/09/2026')
    expect(screen.getByLabelText('עד תאריך').value).toBe('03/09/2026')
    expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    expect(screen.getByLabelText('סוג').value).toBe('rejected')
    expect(screen.getByLabelText('נקודה').value, 'a filter that the link does not name keeps its default').toBe('')
  })

  it.each([
    ['provider', `provider=${PLONI.id}`, { provider_id: PLONI.id }],
    ['from', 'from=2026-09-01', { from: '2026-09-01' }],
    ['to', 'to=2026-10-03', { to: '2026-10-03' }],
    ['outcome accepted', `outcome=${OUTCOME_ACCEPTED}`, { outcome: OUTCOME_ACCEPTED }],
    ['outcome rejected', 'outcome=rejected', { outcome: 'rejected' }],
    ['outcome all', 'outcome=all', { outcome: 'all' }],
  ])('takes %s alone, and the defaults for the rest', async (_what, parameter, expected) => {
    knownProviders()
    server()
    openAt(`#history?${parameter}`)
    show()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100', ...expected })
    await sleep(500)
    expect(calls('/admin/scans')).toHaveLength(1)
  })

  it('takes "not counted" for the outcome: it asks for the visits that were not counted, with the other filters, and never for scans', async () => {
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&to=2026-09-03&outcome=not_counted`)
    show()
    await waitFor(() => expect(calls('/admin/scan-refusals')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scan-refusals')).toEqual({ from: '2026-09-01', to: '2026-09-03', provider_id: PLONI.id, limit: '100' })
    expect(screen.getByLabelText('סוג').value).toBe('not_counted')
    await sleep(500)
    expect(calls('/admin/scans'), 'the list of scans is not asked for, not even once').toHaveLength(0)
    expect(calls('/admin/scan-refusals')).toHaveLength(1)
  })

  it('takes the link in any order, and a parameter it does not know is ignored', async () => {
    knownProviders()
    server()
    openAt(`#history?utm=1&outcome=all&to=2026-10-03&provider=${PLONI.id}&from=2026-09-01&extra`)
    show()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scans')).toEqual({ from: '2026-09-01', to: '2026-10-03', provider_id: PLONI.id, outcome: 'all', limit: '100' })
  })

  it('takes a value that the browser encoded', async () => {
    knownProviders()
    server()
    openAt(`#history?outcome=%61ll&from=2026%2D09%2D01`)
    show()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scans')).toMatchObject({ from: '2026-09-01', outcome: 'all' })
  })

  it('asks for the defaults when the address has no link', async () => {
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' }])
  })
})

// ---- the address afterwards ------------------------------------------------------------------------------------------------------

describe('the address after a link has been read', () => {
  it('becomes a plain #history, and nothing else of the address changes', async () => {
    knownProviders()
    server()
    window.history.replaceState({ kept: true }, '', `/admin?x=1#history?provider=${PLONI.id}&outcome=all`)
    const entries = window.history.length
    const changed = vi.fn()
    window.addEventListener('hashchange', changed)
    show()
    await listed('ביקור של פלוני')
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    expect(window.location.pathname + window.location.search).toBe('/admin?x=1')
    expect(window.history.state, 'the state of the entry is kept').toEqual({ kept: true })
    expect(window.history.length, 'an entry is replaced, not added').toBe(entries)
    await sleep(60)
    expect(changed, 'the screen does not change, so the browser has nothing to report').not.toHaveBeenCalled()
    window.removeEventListener('hashchange', changed)
  })

  it('is cleaned also when every parameter was invalid, and left alone when the address has no parameter of a link', async () => {
    server()
    openAt('#history?from=nonsense&outcome=nonsense')
    show()
    await listed('ביקור של פלוני')
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    cleanup()
    openAt('#history?utm=1')
    show()
    await listed('ביקור של פלוני')
    await sleep(50)
    expect(window.location.hash, 'not a link: not ours to change').toBe('#history?utm=1')
  })

  it('does not apply the link a second time: a screen that is drawn again from the plain address has the defaults (a reload)', async () => {
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01`)
    const first = show()
    await listed('ביקור של פלוני')
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    first.unmount()
    vi.mocked(api).mockClear()
    server()
    show() // a reload opens the address as it is now
    await listed('ביקור של אלמוני')
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' }])
    expect(window.location.hash).toBe('#history')
  })
})

// ---- what is not valid -----------------------------------------------------------------------------------------------------------

describe('a parameter that is not valid', () => {
  it.each([
    ['a day that is not on the calendar', 'from=2026-02-30'],
    ['a month that does not exist', 'from=2026-13-01'],
    ['a day before 2000, which goodDate refuses', 'from=1999-12-31'],
    ['a year after 2100, which the date field refuses', 'from=2101-01-01'],
    ['a day written the way people write it', 'from=01/09/2026'],
    ['a day without its zeros', 'from=2026-9-1'],
    ['a day with a time', 'from=2026-09-01T10:00:00Z'],
    ['words', 'from=yesterday'],
    ['an empty day', 'from='],
    ['a day for "to"', 'to=2026-02-30'],
    ['a day for "to", in the wrong format', 'to=1.10.2026'],
    ['a type that is not one of the choices', 'outcome=bogus'],
    ['a type in the wrong case', 'outcome=ALL'],
    ['an empty type', 'outcome='],
    ['an empty provider', 'provider='],
  ])('is left out quietly: %s', async (_what, parameter) => {
    knownProviders()
    server()
    openAt(`#history?${parameter}`)
    show()
    await listed('ביקור של פלוני')
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' }])
    expect(screen.queryByRole('alert'), 'no error is shown').toBeNull()
    await sleep(500)
    expect(calls('/admin/scans')).toHaveLength(1)
    expect(window.location.hash).toBe('#history')
  })

  it('does not take the others with it: the valid parameters of the same link are applied', async () => {
    knownProviders()
    server()
    openAt(`#history?from=2026-02-30&to=2026-10-03&outcome=bogus&provider=${PLONI.id}`)
    show()
    await listed('ביקור של פלוני')
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: '2026-10-03', provider_id: PLONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' }])
    expect(screen.getByLabelText('מתאריך').value, 'the field shows the default, not the nonsense').toBe('29/09/2026')
  })

  it('takes the first value of a parameter that is given twice', async () => {
    knownProviders()
    server()
    openAt('#history?outcome=all&outcome=rejected')
    show()
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scans').outcome).toBe('all')
  })
})

// ---- the provider ----------------------------------------------------------------------------------------------------------------

describe('the provider of a link', () => {
  describe('when an earlier visit kept the list of providers', () => {
    it('is applied in the first render when the list holds it', async () => {
      knownProviders()
      server({ providersGate: deferred() }) // the new answer never comes: the kept list decides
      openAt(`#history?provider=${PLONI.id}`)
      show()
      await listed('ביקור של פלוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: PLONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' }])
    })

    it('is dropped when neither the kept list nor the new one holds it, and no request ever names it', async () => {
      knownProviders()
      server()
      openAt(`#history?provider=${UNKNOWN}&from=2026-09-01`)
      show()
      await listed('ביקור של פלוני')
      await listed('ביקור של אלמוני')
      expect(asked('/admin/scans'), 'one request, without the unknown id, with the rest of the link').toEqual([
        { from: '2026-09-01', to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' },
      ])
      expect(api.mock.calls.flat().join(' ')).not.toContain(UNKNOWN)
      expect(screen.getByLabelText('נותן שירות').value).toBe('')
      expect(screen.queryByRole('alert')).toBeNull()
      await sleep(500)
      expect(calls('/admin/scans')).toHaveLength(1)
    })

    it('waits for the new answer when the kept list lacks it (a provider added since), and applies it when the new list holds it', async () => {
      knownProviders([PLONI]) // an older list
      const gate = deferred()
      server({ providersGate: gate }) // the new list has Almoni
      openAt(`#history?provider=${ALMONI.id}`)
      show()
      await sleep(100)
      expect(calls('/admin/scans'), 'nothing is asked for while it is not known whether the kept list is out of date').toHaveLength(0)
      expect(screen.getByRole('status'), 'the list is on its way').toBeTruthy()
      expect(screen.queryByText('ביקור של פלוני'), 'no list of the wrong filters').toBeNull()
      await act(async () => { gate.resolve() })
      await listed('ביקור של אלמוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: ALMONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' }])
      expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    })
  })

  describe('when nothing was kept', () => {
    it('waits for the list of providers, then asks once, with the provider', async () => {
      const gate = deferred()
      server({ providersGate: gate })
      openAt(`#history?provider=${ALMONI.id}&outcome=all`)
      show()
      await sleep(100)
      expect(calls('/admin/providers')).toHaveLength(1)
      expect(calls('/admin/scans'), 'nothing is asked for before the provider is known to be one of ours').toHaveLength(0)
      expect(screen.getByRole('status')).toBeTruthy()
      expect(screen.queryByText('אין נוכחויות בטווח הזה'), 'and the list is not empty-looking either').toBeNull()
      await act(async () => { gate.resolve() })
      await listed('ביקור של אלמוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: ALMONI.id, outcome: 'all', limit: '100' }])
      expect(screen.queryByText('ביקור של פלוני')).toBeNull()
      await sleep(500)
      expect(calls('/admin/scans')).toHaveLength(1)
    })

    it('drops a provider that is not in the list without a request that names it, and without showing the wrong list', async () => {
      const gate = deferred()
      server({ providersGate: gate })
      openAt(`#history?provider=${UNKNOWN}&outcome=all&to=2026-10-03`)
      show()
      await sleep(100)
      expect(calls('/admin/scans')).toHaveLength(0)
      expect(screen.queryByText('ביקור של פלוני')).toBeNull()
      await act(async () => { gate.resolve() })
      await listed('ביקור של פלוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: '2026-10-03', outcome: 'all', limit: '100' }])
      expect(api.mock.calls.flat().join(' ')).not.toContain(UNKNOWN)
      expect(screen.getByLabelText('נותן שירות').value).toBe('')
      expect(screen.getByLabelText('סוג').value, 'the rest of the link stays').toBe('all')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('drops it, and asks, when the list of providers cannot be had', async () => {
      server({ providersFail: true })
      openAt(`#history?provider=${PLONI.id}&outcome=all`)
      show()
      await listed('ביקור של פלוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, outcome: 'all', limit: '100' }])
    })

    it('does not wait for the list of providers when the link names none', async () => {
      server({ providersGate: deferred() })
      openAt('#history?outcome=all')
      show()
      await listed('ביקור של פלוני')
      expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, outcome: 'all', limit: '100' }])
    })

    it('stops waiting when the person chooses a provider themselves, and the link\'s is not applied over it', async () => {
      const gate = deferred()
      server({ providersGate: gate })
      knownProviders([ALMONI]) // the kept list is out of date (it lacks Ploni): the link's provider waits for the new one
      openAt(`#history?provider=${PLONI.id}`)
      show()
      await sleep(50)
      expect(calls('/admin/scans')).toHaveLength(0)
      fireEvent.change(screen.getByLabelText('נותן שירות'), { target: { value: ALMONI.id } })
      await listed('ביקור של אלמוני')
      await act(async () => { gate.resolve() })
      await sleep(600)
      expect(lastAsked('/admin/scans').provider_id).toBe(ALMONI.id)
      expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    })
  })

  it('shows as a chip on a phone, once it is known', async () => {
    layout(true)
    const gate = deferred()
    server({ providersGate: gate })
    openAt(`#history?provider=${ALMONI.id}`)
    show()
    await sleep(50)
    await act(async () => { gate.resolve() })
    await listed('ביקור של אלמוני')
    expect(chips()).toEqual(['נותן שירות: אלמוני'])
  })
})

// ---- both layouts ----------------------------------------------------------------------------------------------------------------

describe('on a phone', () => {
  it('shows the dates in the bar and a chip for each of the other filters of the link, with the count', async () => {
    layout(true)
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&to=2026-09-03&outcome=all`)
    show()
    await listed('ביקור של פלוני')
    expect(asked('/admin/scans')).toEqual([{ from: '2026-09-01', to: '2026-09-03', provider_id: PLONI.id, outcome: 'all', limit: '100' }])
    expect(range()).toBe('טווח התאריכים: 01/09/2026 עד 03/09/2026')
    expect(chips()).toEqual(['נותן שירות: פלוני', 'סוג: הכול'])
    expect(opener().getAttribute('aria-haspopup')).toBe('dialog')
    expect(opener().textContent).toMatch(/^סינון\s*3\s*פעילים$/) // the dates count once
    expect(screen.queryByLabelText('מתאריך'), 'the inline fields are not drawn').toBeNull()
    expect(window.location.hash).toBe('#history')
  })

  it('shows the visits that were not counted as a chip, and asks for that list at once', async () => {
    layout(true)
    knownProviders()
    server()
    openAt('#history?outcome=not_counted')
    show()
    await waitFor(() => expect(calls('/admin/scan-refusals')).toHaveLength(1), WAIT)
    expect(chips()).toEqual(['סוג: לא נקלטו'])
    expect(calls('/admin/scans')).toHaveLength(0)
  })

  it('has the values of the link in the sheet, and a chip removes one of them', async () => {
    layout(true)
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&outcome=all`)
    show()
    await listed('ביקור של פלוני')
    fireEvent.click(opener())
    const dialog = sheet()
    expect(within(dialog).getByLabelText('מתאריך').value).toBe('01/09/2026')
    expect(within(dialog).getByLabelText('עד תאריך').value).toBe('05/10/2026')
    expect(within(dialog).getByLabelText('נותן שירות').value).toBe(PLONI.id)
    expect(within(dialog).getByLabelText('סוג').value).toBe('all')
    fireEvent.click(within(dialog).getByRole('button', { name: 'סגירה' }))
    fireEvent.click(screen.getByRole('button', { name: 'הסרת סינון: נותן שירות: פלוני' }))
    await listed('ביקור של אלמוני')
    expect(lastAsked('/admin/scans')).toEqual({ from: '2026-09-01', to: TO, outcome: 'all', limit: '100' })
  })
})

describe('on a computer', () => {
  it('shows the values in the inline fields and no bar', async () => {
    layout(false)
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&to=2026-09-03&outcome=all`)
    show()
    await listed('ביקור של פלוני')
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
    expect(screen.getByLabelText('מתאריך').value).toBe('01/09/2026')
    expect(screen.getByLabelText('עד תאריך').value).toBe('03/09/2026')
    expect(screen.getByLabelText('נותן שירות').value).toBe(PLONI.id)
    expect(screen.getByLabelText('סוג').value).toBe('all')
    expect(asked('/admin/scans')).toHaveLength(1)
  })
})

// ---- a link followed while the screen is open ------------------------------------------------------------------------------------

describe('a link followed while the screen is open', () => {
  it('is applied the same way: the defaults with the link on top, in one request, and the address becomes #history', async () => {
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    // something the person chose earlier that the link does not name: the link is a whole view, so it goes back to its default
    fireEvent.click(screen.getByLabelText('כולל חשבון דמו'))
    await waitFor(() => expect(lastAsked('/admin/scans').include_demo).toBe('true'), WAIT)
    const before = calls('/admin/scans').length

    await follow(`#history?provider=${ALMONI.id}&from=2026-09-01&to=2026-09-03`)
    await listed('ביקור של אלמוני')
    expect(calls('/admin/scans')).toHaveLength(before + 1)
    expect(lastAsked('/admin/scans')).toEqual({ from: '2026-09-01', to: '2026-09-03', provider_id: ALMONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' })
    expect(screen.getByLabelText('מתאריך').value).toBe('01/09/2026')
    expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    expect(screen.getByLabelText('כולל חשבון דמו').checked).toBe(false)
    expect(window.location.hash).toBe('#history')
    await sleep(500)
    expect(calls('/admin/scans'), 'and nothing is asked for after it').toHaveLength(before + 1)
  })

  it('is applied again when the same link is followed again', async () => {
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    const link = `#history?provider=${ALMONI.id}`
    await follow(link)
    await listed('ביקור של אלמוני')
    expect(window.location.hash).toBe('#history')
    fireEvent.change(screen.getByLabelText('נותן שירות'), { target: { value: '' } }) // the person looks at everyone
    await listed('ביקור של פלוני')
    await follow(link)
    await waitFor(() => expect(lastAsked('/admin/scans').provider_id).toBe(ALMONI.id), WAIT)
    expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    expect(window.location.hash).toBe('#history')
  })

  it('asks for the visits that were not counted when the link says so', async () => {
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    await follow(`#history?outcome=not_counted&provider=${PLONI.id}`)
    await waitFor(() => expect(calls('/admin/scan-refusals')).toHaveLength(1), WAIT)
    expect(lastAsked('/admin/scan-refusals')).toEqual({ from: FROM, to: TO, provider_id: PLONI.id, limit: '100' })
    expect(screen.getByLabelText('סוג').value).toBe('not_counted')
  })

  it('drops what is not valid in it, a provider that is not in the list included, and still applies the rest', async () => {
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    await follow(`#history?provider=${UNKNOWN}&from=2026-02-30&to=2026-10-03&outcome=all`)
    await waitFor(() => expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: '2026-10-03', outcome: 'all', limit: '100' }), WAIT)
    expect(api.mock.calls.flat().join(' ')).not.toContain(UNKNOWN)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(window.location.hash).toBe('#history')
  })

  it('waits for the providers, as an opening link does, when the screen has only just opened and they have not answered', async () => {
    const gate = deferred()
    server({ providersGate: gate })
    openAt('#history')
    show()
    await listed('ביקור של פלוני') // the defaults do not need the providers
    const before = calls('/admin/scans').length
    await follow(`#history?provider=${ALMONI.id}&outcome=all`)
    await sleep(100)
    expect(calls('/admin/scans'), 'nothing is asked for until the provider is known').toHaveLength(before)
    expect(screen.queryByText('ביקור של פלוני'), 'and the list of the old filters is not left under the new ones').toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => { gate.resolve() })
    await listed('ביקור של אלמוני')
    expect(calls('/admin/scans')).toHaveLength(before + 1)
    expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: TO, provider_id: ALMONI.id, outcome: 'all', limit: '100' })
    expect(window.location.hash).toBe('#history')
  })

  it('drops a provider that the new list does not hold, after waiting for it', async () => {
    const gate = deferred()
    server({ providersGate: gate })
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    const before = calls('/admin/scans').length
    await follow(`#history?provider=${UNKNOWN}&outcome=all`)
    await act(async () => { gate.resolve() })
    await listed('ביקור של פלוני')
    await waitFor(() => expect(calls('/admin/scans')).toHaveLength(before + 1), WAIT)
    expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: TO, outcome: 'all', limit: '100' })
    expect(api.mock.calls.flat().join(' ')).not.toContain(UNKNOWN)
  })

  it('asks for nothing when the screen already says what the link says', async () => {
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}`)
    show()
    await listed('ביקור של פלוני')
    const before = calls('/admin/scans').length
    await follow(`#history?provider=${PLONI.id}`)
    await sleep(500)
    expect(calls('/admin/scans')).toHaveLength(before)
    expect(window.location.hash).toBe('#history')
    expect(screen.getByLabelText('נותן שירות').value).toBe(PLONI.id)
  })

  it('leaves alone an address that is not a link to this screen', async () => {
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    const before = calls('/admin/scans').length
    for (const hash of ['#points?provider=' + ALMONI.id, '#history', '#history?utm=1', '#settings?outcome=all']) {
      await follow(hash)
      expect(window.location.hash, `${hash} is not for this screen`).toBe(hash)
    }
    await sleep(500)
    expect(calls('/admin/scans')).toHaveLength(before)
  })

  it('closes the sheet that is open on a phone, and applies the link', async () => {
    layout(true)
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    fireEvent.click(opener())
    fireEvent.change(within(sheet()).getByLabelText('נקודה'), { target: { value: POINT.id } }) // a draft that is not applied
    await follow(`#history?provider=${ALMONI.id}`)
    await listed('ביקור של אלמוני')
    expect(screen.queryByRole('dialog'), 'no question is asked: the person went to the link').toBeNull()
    expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: TO, provider_id: ALMONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' })
    expect(chips()).toEqual(['נותן שירות: אלמוני'])
    expect(window.location.hash).toBe('#history')
  })

  it('shows the dates of the link in a field that holds a date half typed, and releases the export', async () => {
    layout(false)
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    const from = screen.getByLabelText('מתאריך')
    fireEvent.change(from, { target: { value: '2909' } }) // half a date: "29/09"; the filters keep the last good one, the same as the link's
    expect(from.value).toBe('29/09')
    expect(screen.getByRole('button', { name: 'ייצוא ל-Excel' }).hasAttribute('disabled')).toBe(true)
    await follow(`#history?from=${FROM}`) // the link says the day that the filters hold: nothing changes but the half text
    await waitFor(() => expect(screen.getByLabelText('מתאריך').value).toBe('29/09/2026'), WAIT)
    expect(screen.getByRole('link', { name: 'ייצוא ל-Excel' }), 'the file is a link again: nothing is half typed').toBeTruthy()
    await sleep(500)
    expect(calls('/admin/scans'), 'the list was not asked for again').toHaveLength(1)
  })

  it('on a window that is held at the computer layout by a date half typed, applies the link and then follows the window', async () => {
    const window1024 = layout(false)
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '2909' } })
    await window1024.phone() // held: a date is half typed
    expect(screen.queryByRole('button', { name: /^סינון/ })).toBeNull()
    await follow(`#history?provider=${ALMONI.id}&from=2026-09-01`)
    await waitFor(() => expect(opener()).toBeTruthy(), WAIT) // the half date is gone with the fields: the window decides
    await listed('ביקור של אלמוני')
    expect(range()).toBe('טווח התאריכים: 01/09/2026 עד 05/10/2026')
    expect(chips()).toEqual(['נותן שירות: אלמוני'])
    expect(lastAsked('/admin/scans')).toEqual({ from: '2026-09-01', to: TO, provider_id: ALMONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' })
  })

  it('applies a link that arrives while the pause for typing is waiting, with no request for what was typed', async () => {
    layout(false)
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    const before = calls('/admin/scans').length
    fireEvent.change(screen.getByLabelText('נקודה'), { target: { value: POINT.id } }) // waiting for the pause of 350 ms
    await follow(`#history?provider=${ALMONI.id}`)
    await listed('ביקור של אלמוני')
    await sleep(600)
    const after = asked('/admin/scans').slice(before)
    expect(after.every((q) => q.provider_id === ALMONI.id && !q.point_id), 'every request after the link is the link\'s').toBe(true)
    expect(screen.getByLabelText('נקודה').value).toBe('')
  })
})

// ---- the window crosses 1024 px --------------------------------------------------------------------------------------------------

describe('the window crossing 1024 px', () => {
  it('keeps what the link set, in both directions, with no new request', async () => {
    const window1024 = layout(true)
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&from=2026-09-01&outcome=all`)
    show()
    await listed('ביקור של פלוני')
    expect(chips()).toEqual(['נותן שירות: פלוני', 'סוג: הכול'])

    await window1024.computer()
    expect(screen.getByLabelText('מתאריך').value).toBe('01/09/2026')
    expect(screen.getByLabelText('נותן שירות').value).toBe(PLONI.id)
    expect(screen.getByLabelText('סוג').value).toBe('all')

    await window1024.phone()
    expect(chips()).toEqual(['נותן שירות: פלוני', 'סוג: הכול'])
    expect(range()).toBe('טווח התאריכים: 01/09/2026 עד 05/10/2026')
    await sleep(600)
    expect(calls('/admin/scans'), 'one request in all').toHaveLength(1)
  })

  it('applies a link at once even when the window crosses right after the first draw', async () => {
    const window1024 = layout(true)
    knownProviders()
    server()
    openAt(`#history?provider=${PLONI.id}&outcome=all`)
    show()
    await window1024.computer() // before anything has been answered
    await listed('ביקור של פלוני')
    expect(screen.getByLabelText('נותן שירות').value).toBe(PLONI.id)
    await sleep(600)
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: PLONI.id, outcome: 'all', limit: '100' }])
  })

  it('applies the provider that was waited for once, whichever layout the window has by then', async () => {
    const window1024 = layout(true)
    const gate = deferred()
    server({ providersGate: gate })
    openAt(`#history?provider=${ALMONI.id}`)
    show()
    await sleep(50)
    await window1024.computer() // while the first query waits for the providers
    await act(async () => { gate.resolve() })
    await listed('ביקור של אלמוני')
    await window1024.phone()
    await window1024.computer()
    expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    await sleep(600)
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: ALMONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' }])
  })

  it('applies a link that is followed at the moment the window crosses', async () => {
    const window1024 = layout(true)
    knownProviders()
    server()
    openAt('#history')
    show()
    await listed('ביקור של פלוני')
    await act(async () => {
      window.location.hash = `#history?provider=${ALMONI.id}&outcome=all`
      await window1024.computer()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await listed('ביקור של אלמוני')
    expect(screen.getByLabelText('נותן שירות').value).toBe(ALMONI.id)
    expect(screen.getByLabelText('סוג').value).toBe('all')
    await window1024.phone()
    expect(chips()).toEqual(['נותן שירות: אלמוני', 'סוג: הכול'])
    await sleep(600)
    expect(asked('/admin/scans').filter((q) => q.provider_id === ALMONI.id)).toHaveLength(1)
  })
})

// ---- in the app: the tab, the back button ----------------------------------------------------------------------------------------

describe('in the committee app', () => {
  const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Sample Member', email: 'member@example.test' }
  window.scrollTo = vi.fn()

  function appServer() {
    server()
    const scans = api.getMockImplementation()
    api.mockImplementation(async (path) => {
      if (path === '/admin/config') return { google_client_id: '', dev_login: false }
      if (path === '/admin/me') return { admin: ADMIN }
      if (path === '/admin/api-keys') return { api_keys: [] }
      if (path === '/admin/points') return { points: [] } // the Points tab needs more of a point than this test is about
      return scans(path)
    })
  }
  const heading = (name) => screen.findByRole('heading', { level: 1, name }, WAIT)
  const HISTORY = 'היסטוריית נוכחות'
  const POINTS = 'נקודות סריקה'

  it('opens History from an address with a query, applies it, and the tab stays after the address is cleaned', async () => {
    appServer()
    openAt(`#history?provider=${ALMONI.id}&outcome=all`)
    render(<AdminApp />)
    await heading(HISTORY)
    await listed('ביקור של אלמוני')
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    expect(asked('/admin/scans')).toEqual([{ from: FROM, to: TO, provider_id: ALMONI.id, outcome: 'all', limit: '100' }])
    await sleep(100)
    expect(screen.getByRole('heading', { level: 1, name: HISTORY }), 'the app is still on the History tab').toBeTruthy()
    // the store of the tab still follows the address after the replaceState
    await follow('#points')
    await heading(POINTS)
    await follow('#history')
    await heading(HISTORY)
  })

  it('opens History from another tab with the link, in one request, and the back button returns to that tab', async () => {
    appServer()
    knownProviders()
    openAt('#points')
    render(<AdminApp />)
    await heading(POINTS)
    await follow(`#history?provider=${PLONI.id}&from=2026-09-01&to=2026-09-03`)
    await heading(HISTORY)
    await listed('ביקור של פלוני')
    await waitFor(() => expect(window.location.hash).toBe('#history'))
    expect(asked('/admin/scans')).toEqual([{ from: '2026-09-01', to: '2026-09-03', provider_id: PLONI.id, outcome: OUTCOME_ACCEPTED, limit: '100' }])

    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await heading(POINTS)
    expect(window.location.hash).toBe('#points')

    // forward: the entry of the link is the plain address now, so History opens with its defaults
    await act(async () => {
      window.history.forward()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await heading(HISTORY)
    await waitFor(() => expect(lastAsked('/admin/scans')).toEqual({ from: FROM, to: TO, outcome: OUTCOME_ACCEPTED, limit: '100' }))
    expect(window.location.hash).toBe('#history')
  })

  it('applies a link followed on History itself, where the tab does not change', async () => {
    appServer()
    knownProviders()
    openAt('#history')
    render(<AdminApp />)
    await heading(HISTORY)
    await listed('ביקור של פלוני')
    const title = screen.getByRole('heading', { level: 1, name: HISTORY })
    await follow(`#history?provider=${ALMONI.id}`)
    await waitFor(() => expect(lastAsked('/admin/scans').provider_id).toBe(ALMONI.id), WAIT)
    await listed('ביקור של אלמוני')
    expect(screen.getByRole('heading', { level: 1, name: HISTORY }), 'the screen was not drawn again').toBe(title)
    expect(window.location.hash).toBe('#history')
  })

  it('does not apply a query that is for another tab, and does not clean it', async () => {
    appServer()
    knownProviders()
    openAt('#history')
    render(<AdminApp />)
    await heading(HISTORY)
    await listed('ביקור של פלוני')
    const before = calls('/admin/scans').length
    await follow(`#points?provider=${ALMONI.id}`)
    await heading(POINTS)
    expect(window.location.hash).toBe(`#points?provider=${ALMONI.id}`)
    await sleep(300)
    expect(calls('/admin/scans')).toHaveLength(before)
  })

  it('opens the screen of a renamed address that carries a query, and History is not touched', async () => {
    appServer()
    openAt('#committee?provider=1')
    render(<AdminApp />)
    await heading('הגדרות')
    expect(calls('/admin/scans')).toHaveLength(0)
    expect(window.location.hash).toBe('#committee?provider=1')
  })
})
