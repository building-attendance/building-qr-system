// @vitest-environment jsdom
// A notice of the provider app follows a switch of the language: the real WorkerApp, with the network (`api`) answered by the test, and
// the language switched with the globe select of the top bar. A notice that kept the words of the language it was shown in would leave a
// reader of Russian or Arabic with a Hebrew warning, which stays until it is dismissed.
//
// What this file proves:
//   - the word that the saved check-ins were sent is redrawn in the new language;
//   - the warning that some were not accepted is redrawn in the new language, with its count;
//   - the notice of the sign-in list that the sign-in expired is redrawn in the new language.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import WorkerApp from '../../src/pages/WorkerApp.jsx'
import { api } from '../../src/api/client.js'
import { translate } from '../../src/i18n/core.js'
import he from '../../src/i18n/he.js'
import { PROVIDER_TOKEN_PREFIX, OUTCOME_REJECTED_FAR } from '../../shared/contract.js'
import { SAMPLE_PROVIDER_NAMES } from '../../scripts/sample-data.mjs'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

const TOKEN = PROVIDER_TOKEN_PREFIX + 'a'.repeat(43)
const ploni = { id: '00000000-0000-4000-8000-000000000001', company: 'ניקיון', contact_name: SAMPLE_PROVIDER_NAMES.cleaner, service_type: 'cleaning' }
const queued = (id) => ({ id, code: 'BQR-abc123', client_time: '2026-10-05T07:00:00.000Z', gps: null, provider_id: ploni.id, saved_at: '2026-10-05T07:00:00.000Z' })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
})

/** What the server answers: `check` for the stored session, `outcome` for every saved check-in that the phone uploads. */
function answerLikeTheServer({ check = async () => ({ provider: ploni }), outcome = 'accepted' } = {}) {
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/public/providers') return { providers: [ploni] }
    if (path === '/public/building') return { building: { address: '' } }
    if (path === '/my/scans') return { scans: [] }
    if (path === '/session' && !options.method) return check()
    if (path === '/my/device-status') return { ok: true, build: null }
    if (path === '/scans/sync') return { results: options.body.scans.map((s) => ({ id: s.id, ok: true, scan: { outcome } })) }
    throw new Error(`the test does not expect ${path}`)
  })
}

/** A person signed in on this phone, with check-ins saved while there was no signal. */
const store = (queue) => {
  window.localStorage.setItem('qr.session', JSON.stringify({ token: TOKEN, provider: ploni }))
  window.localStorage.setItem('qr.queue.v1', JSON.stringify(queue))
}
const switchLanguage = (code) => fireEvent.change(screen.getByLabelText(he['lang.label'], { selector: 'select' }), { target: { value: code } })

describe('a notice after the language is switched', () => {
  it('says that the saved check-ins were sent in the new language', async () => {
    answerLikeTheServer()
    store([queued('first')])
    render(<WorkerApp />)
    expect(await screen.findByText(he['sync.done'])).toBeTruthy()

    switchLanguage('en')
    expect(screen.getByText(translate('en', 'sync.done'))).toBeTruthy()
    expect(screen.queryByText(he['sync.done'])).toBeNull()
  })

  it('warns that check-ins were not accepted in the new language, with the count', async () => {
    answerLikeTheServer({ outcome: OUTCOME_REJECTED_FAR })
    store([queued('first'), queued('second')])
    render(<WorkerApp />)
    expect(await screen.findByText(translate('he', 'sync.dropped', { count: 2 }))).toBeTruthy()

    switchLanguage('ru')
    expect(screen.getByText(translate('ru', 'sync.dropped', { count: 2 }))).toBeTruthy()
    expect(screen.queryByText(translate('he', 'sync.dropped', { count: 2 }))).toBeNull()
  })

  it('says on the sign-in list that the sign-in expired in the new language', async () => {
    answerLikeTheServer({ check: async () => { throw Object.assign(new Error('refused'), { status: 401, code: 'invalid_session' }) } })
    store([])
    render(<WorkerApp />)
    expect(await screen.findByText(he['error.invalid_session'])).toBeTruthy()

    switchLanguage('ar')
    expect(screen.getByText(translate('ar', 'error.invalid_session'))).toBeTruthy()
    expect(screen.queryByText(he['error.invalid_session'])).toBeNull()
  })
})
