// @vitest-environment jsdom
// The provider app's screens, rendered with their real translations: the sign-in flow, the home screen, the screen that waits for the
// position, and the result screens.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { I18nProvider } from '../../src/i18n/index.jsx'
import { LoginView, ResultView, HomeView, WorkingView } from '../../src/worker/components.jsx'
import he from '../../src/i18n/he.js'
import { DICTS, LANGS, LANG_STORAGE_KEY } from '../../src/i18n/core.js'
import { tutorialUrl } from '../../src/worker/tutorial.js'
import { api } from '../../src/api/client.js'
import { SAMPLE_PROVIDER_NAMES } from '../../scripts/sample-data.mjs'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})

const withI18n = (ui) => render(<I18nProvider>{ui}</I18nProvider>)
const ploni = { id: 'p1', contact_name: SAMPLE_PROVIDER_NAMES.cleaner, company: 'ניקיון' }
const almoni = { id: 'p2', contact_name: SAMPLE_PROVIDER_NAMES.gardener, company: 'גינון' }

describe('LoginView', () => {
  const view = (props = {}) => (
    <LoginView providers={{ status: 'ready', providers: [ploni, almoni], reload: () => {} }} pointName="לובי" onSignedIn={() => {}} {...props} />
  )

  it('lists the people and names the scanned point', () => {
    withI18n(view())
    expect(screen.getByRole('heading', { name: he['login.title'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(ploni.contact_name) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(almoni.contact_name) })).toBeTruthy()
    expect(screen.getByText(/נקודת סריקה/).textContent).toContain('לובי')
  })

  it('links to the tutorial video from the start on the account list, in every language, between the title and the first account', () => {
    // Written out, so that publishing another language is a deliberate edit here too (src/worker/tutorial.js).
    const FROM_START = 'https://building-attendance.github.io/building-qr-system/video/he/'
    for (const { code } of LANGS) {
      window.localStorage.setItem(LANG_STORAGE_KEY, code)
      const { unmount } = withI18n(view())
      try {
        const link = screen.getByRole('link', { name: DICTS[code]['home.tutorial'] })
        expect(link.getAttribute('href'), code).toBe(FROM_START)
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toContain('noopener')
        const title = screen.getByRole('heading', { name: DICTS[code]['login.title'] })
        const first = screen.getByRole('button', { name: new RegExp(ploni.contact_name) })
        expect(title.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING, `${code}: after the title`).toBeTruthy()
        expect(link.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING, `${code}: before the first account`).toBeTruthy()
      } finally {
        unmount()
      }
    }
  })

  it('leaves the link off the password screen', () => {
    withI18n(view())
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ploni.contact_name) }))
    expect(screen.queryByRole('link', { name: he['home.tutorial'] })).toBeNull()
  })

  it("starts the privacy note with the account's name in every language: a scan keeps the name of the account, not the person's own (owner decision of 15/10/2026)", () => {
    // The sentences are written out here and not read from the dictionaries, which are what this test checks.
    const firstSentence = {
      he: 'בכל סריקה נרשמים שם החשבון, הנקודה והשעה.',
      en: "Each scan records the account's name, the point and the time.",
      ru: 'При каждом сканировании записываются название аккаунта, точка и время.',
      ar: 'عند كل مسح يُسجَّل اسم الحساب والنقطة والوقت.',
    }
    expect(Object.keys(firstSentence).sort()).toEqual(LANGS.map((l) => l.code).sort())
    for (const { code } of LANGS) {
      window.localStorage.setItem('qr.lang', code)
      withI18n(view())
      // Exactly one element must hold the note's own text, and it must start with the sentence.
      const note = screen.getByText((content) => content.startsWith(firstSentence[code]))
      expect(note.textContent.slice(0, firstSentence[code].length), code).toBe(firstSentence[code])
      cleanup()
    }
  })

  it('shows a friendly message, not an empty list, when no providers are set up yet', () => {
    withI18n(view({ providers: { status: 'ready', providers: [], reload: () => {} } }))
    expect(screen.getByText(he['login.noProviders'])).toBeTruthy()
  })

  it('offers a retry when the list cannot be loaded', () => {
    const reload = vi.fn()
    withI18n(view({ providers: { status: 'error', providers: [], reload } }))
    expect(screen.getByText(he['login.loadError'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: he['common.retry'] }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('asks for the password of the person chosen, and keeps them signed in by default', async () => {
    const onSignedIn = vi.fn()
    api.mockResolvedValue({ token: 'qrp_token', provider: ploni })
    withI18n(view({ onSignedIn }))

    fireEvent.click(screen.getByRole('button', { name: new RegExp(ploni.contact_name) }))
    expect(screen.getByRole('heading', { name: /שלום/ }).textContent).toContain(ploni.contact_name)
    fireEvent.change(screen.getByLabelText(he['login.passwordLabel'], { selector: 'input' }), { target: { value: 'secret-1' } })
    fireEvent.click(screen.getByRole('button', { name: he['login.submit'] }))

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    expect(onSignedIn).toHaveBeenCalledWith({ token: 'qrp_token', provider: ploni }, true)
    expect(api).toHaveBeenCalledWith('/session', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ provider_id: 'p1', password: 'secret-1' }) }))
  })

  it('says the password is wrong and clears the field', async () => {
    api.mockRejectedValue(Object.assign(new Error('nope'), { code: 'invalid_credentials', status: 401 }))
    withI18n(view())
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ploni.contact_name) }))
    const field = screen.getByLabelText(he['login.passwordLabel'], { selector: 'input' })
    fireEvent.change(field, { target: { value: 'wrong-pass' } })
    fireEvent.click(screen.getByRole('button', { name: he['login.submit'] }))

    // the alert region exists from the start and is filled once the server has answered
    expect(await screen.findByText(he['login.wrong'])).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(he['login.wrong'])
    expect(field.value).toBe('')
  })

  it('can go back to choose someone else', () => {
    withI18n(view())
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ploni.contact_name) }))
    fireEvent.click(screen.getByRole('button', { name: he['login.changeName'] }))
    expect(screen.getByRole('heading', { name: he['login.title'] })).toBeTruthy()
  })
})

describe('ResultView', () => {
  const success = { kind: 'success', scan: { checked_in_at: '2026-10-01T10:00:00Z', point_name: 'לובי' } }
  const show = (result, props = {}) =>
    withI18n(<ResultView result={result} pointName="לובי" provider={ploni} onDone={() => {}} onRetry={() => {}} {...props} />)

  it('confirms a check-in and says who is signed in', () => {
    show(success)
    expect(screen.getByRole('heading', { name: he['checkin.success.title'] })).toBeTruthy()
    expect(screen.getByText(/משתמש:/).textContent).toContain(`${ploni.contact_name} · ניקיון`)
    expect(screen.getByRole('button', { name: he['checkin.done'] })).toBeTruthy()
  })

  it('says who is signed in on a refusal too, which is when it matters most', () => {
    show({ kind: 'error', code: 'not_assigned' })
    expect(screen.getByText(/משתמש:/).textContent).toContain(`${ploni.contact_name} · ניקיון`)
  })

  it('gives each known refusal its own message and no retry button (trying again cannot help)', () => {
    for (const code of ['not_assigned', 'unknown_code', 'point_inactive', 'invalid_code']) {
      show({ kind: 'error', code })
      expect(screen.getByRole('heading', { name: he[`error.${code}`] }), code).toBeTruthy()
      expect(screen.queryByRole('button', { name: he['checkin.retry'] }), code).toBeNull()
      cleanup()
    }
  })

  it('shows the generic message, with a retry, for a refusal it does not know', () => {
    show({ kind: 'error', code: 'something_new' })
    expect(screen.getByRole('heading', { name: he['error.generic'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: he['checkin.retry'] })).toBeTruthy()
  })

  it('offers a retry when the phone is too far, and the retry is wired', () => {
    const onRetry = vi.fn()
    show({ kind: 'far', scan: { distance_m: 5600 } }, { onRetry })
    expect(screen.getByRole('heading', { name: he['checkin.far.title'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: he['checkin.retry'] }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('tells a check-in that is only saved on the phone', () => {
    show({ kind: 'queued', persisted: true, located: true })
    expect(screen.getByRole('heading', { name: he['checkin.queued.title'] })).toBeTruthy()
    expect(screen.getByText(he['checkin.queued.body'])).toBeTruthy()
    expect(screen.queryByText(he['checkin.queued.noLocation']), 'a visit with a position has nothing to warn about').toBeNull()
  })

  it('warns that the server may refuse a saved check-in that has no position, in the language of the person', () => {
    show({ kind: 'queued', persisted: true, located: false })
    expect(screen.getByText(he['checkin.queued.body'])).toBeTruthy()
    expect(screen.getByText(he['checkin.queued.noLocation'])).toBeTruthy()
  })

  it('says nothing extra for a saved check-in from before the screen knew about positions (no `located` at all)', () => {
    show({ kind: 'queued', persisted: true })
    expect(screen.queryByText(he['checkin.queued.noLocation'])).toBeNull()
  })

  it('adds the warning to the message of a check-in that could not even be saved on the phone', () => {
    show({ kind: 'queued', persisted: false, located: false })
    expect(screen.getByText(he['checkin.queuedTemp.body'])).toBeTruthy()
    expect(screen.getByText(he['checkin.queued.noLocation'])).toBeTruthy()
  })

  it('calls onDone from the done button', () => {
    const onDone = vi.fn()
    show(success, { onDone })
    fireEvent.click(screen.getByRole('button', { name: he['checkin.done'] }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('ResultView, the recorded check-in', () => {
  // 10:00 UTC on 1 October 2026 is 13:00 in the building (summer time, UTC+3)
  const scan = (extra = {}) => ({ checked_in_at: '2026-10-01T10:00:00Z', point_name: 'לובי', distance_m: 8, flags: [], ...extra })
  const show = (result) => withI18n(<ResultView result={result} pointName="לובי" provider={ploni} onDone={() => {}} onRetry={() => {}} />)

  it('shows the time large with its day under it, and the point and the person as chips', () => {
    show({ kind: 'success', scan: scan() })
    expect(screen.getByText('13:00').className).toContain('w-stamp__time')
    expect(screen.getByText('01/10/2026')).toBeTruthy()
    expect(screen.getByText('לובי')).toBeTruthy()
    expect(screen.getByText(/משתמש:/).closest('.w-chip')).toBeTruthy()
  })

  it('says the location was verified, with the distance, when the server measured one and flagged nothing', () => {
    show({ kind: 'success', scan: scan() })
    expect(screen.getByText(/המיקום אומת/).textContent).toContain('8')
  })

  it('says nothing about the location when there is no distance, or when the visit carries a flag about the position', () => {
    for (const extra of [{ distance_m: null }, { flags: ['location_unverified'] }, { flags: ['location_outside_radius'] }, { flags: ['location_stale'] }, { flags: undefined, distance_m: undefined }]) {
      show({ kind: 'success', scan: scan(extra) })
      expect(screen.queryByText(/המיקום אומת/), JSON.stringify(extra)).toBeNull()
      cleanup()
    }
  })

  it('still verifies a visit whose flags are not about the position (an offline visit, a clock that was off)', () => {
    show({ kind: 'success', scan: scan({ flags: ['offline_sync', 'clock_skew'] }) })
    expect(screen.getByText(/המיקום אומת/)).toBeTruthy()
  })

  it('shows no time and no day on a refusal: nothing was recorded', () => {
    show({ kind: 'far', scan: { distance_m: 5600 } })
    expect(document.querySelector('.w-stamp')).toBeNull()
    expect(screen.queryByText(/\d{2}\/\d{2}\/\d{4}/)).toBeNull()
  })

  it('puts the time of the phone, and a "no signal" chip, on a check-in that was saved on the phone', () => {
    show({ kind: 'queued', persisted: true, located: true, client_time: '2026-10-01T10:00:00Z' })
    expect(screen.getByText(he['checkin.queued.chip'])).toBeTruthy()
    expect(screen.getByText('13:00')).toBeTruthy()
    expect(document.querySelector('.w-stamp__date'), 'the day is only for a recorded visit').toBeNull()
  })

  it('has the main button last, below the outcome', () => {
    show({ kind: 'success', scan: scan() })
    expect(document.querySelector('.w-result').lastElementChild.className).toBe('w-actions')
  })
})

describe('HomeView', () => {
  const session = { token: 'qrp_token', provider: ploni }
  const visits = [
    { id: 'a', time: '2026-10-01T10:00:00Z', point: 'לובי', pending: false },
    { id: 'b', time: '2026-10-01T09:00:00Z', point: 'חניון', pending: true },
  ]
  const show = (props = {}) =>
    withI18n(<HomeView session={session} visits={visits} pending={0} syncing={false} onSync={() => {}} notice={null} onDismissNotice={() => {}} onSwitch={() => {}} {...props} />)
  const stepsOf = (words) => [1, 2, 3].map((n) => `${n}. ${words[`home.step${n}`]}`)

  it('names the person and the company, and draws three steps on the violet card', () => {
    show()
    expect(screen.getByRole('heading', { name: /שלום/ }).textContent).toContain(ploni.contact_name)
    expect(screen.getByText(ploni.company)).toBeTruthy()
    expect([...document.querySelectorAll('.w-hero .w-step')].map((el) => el.textContent)).toEqual(stepsOf(he))
  })

  it('links to the tutorial video from the first scene after the sign-in, in the language of the person, in a new tab, and falls back to Hebrew where a language has no video yet', () => {
    // The addresses are written out, so that publishing another language is a deliberate edit here too (src/worker/tutorial.js).
    const HEBREW_PAGE = 'https://building-attendance.github.io/building-qr-system/video/he/after-sign-in/'
    const pages = { he: HEBREW_PAGE, en: HEBREW_PAGE, ru: HEBREW_PAGE, ar: HEBREW_PAGE }
    expect(Object.keys(pages)).toEqual(LANGS.map((l) => l.code))
    for (const lang of LANGS.map((l) => l.code)) {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang)
      const { unmount } = show()
      try {
        const link = screen.getByRole('link', { name: DICTS[lang]['home.tutorialAfterSignIn'] })
        expect(link.getAttribute('href'), lang).toBe(pages[lang])
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toContain('noopener')
      } finally {
        unmount()
      }
    }
  })

  it('never builds a link to a language that is not published', () => {
    expect(tutorialUrl('he')).toBe('https://building-attendance.github.io/building-qr-system/video/he/')
    expect(tutorialUrl('xx')).toBe(tutorialUrl('he'))
    expect(tutorialUrl(undefined)).toBe(tutorialUrl('he'))
  })

  it("gives each of today's visits a chip: recorded, or waiting to be sent", () => {
    show()
    const rows = [...document.querySelectorAll('.w-visit')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('13:00')
    expect(rows[0].querySelector('.w-tag').textContent).toBe(he['home.recorded'])
    expect(rows[0].querySelector('.w-tag').className).toContain('w-tag--ok')
    expect(rows[1].querySelector('.w-tag').textContent).toBe(he['home.pending'])
    expect(rows[1].querySelector('.w-tag').className).not.toContain('w-tag--ok')
  })

  it("shows the three steps and the two chips in every language, from that language's own words", () => {
    for (const { code } of LANGS) {
      window.localStorage.setItem('qr.lang', code)
      show()
      const words = DICTS[code]
      expect([...document.querySelectorAll('.w-hero .w-step')].map((el) => el.textContent), code).toEqual(stepsOf(words))
      expect([...document.querySelectorAll('.w-visit .w-tag')].map((el) => el.textContent), code).toEqual([words['home.recorded'], words['home.pending']])
      cleanup()
    }
  })

  it('keeps the live region in the page when there is nothing to say, and puts the visits that wait in it', () => {
    show()
    const live = document.querySelector('.w-live')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.children).toHaveLength(0)
    cleanup()
    show({ pending: 2 })
    expect(document.querySelector('.w-live').textContent).toContain('2')
  })
})

describe('WorkingView', () => {
  it('says what it is doing, advises standing at the code while it looks for the position, and names the point', () => {
    withI18n(<WorkingView phase="locating" pointName="לובי" />)
    expect(screen.getByText(he['checkin.locating'])).toBeTruthy()
    expect(screen.getByText(he['checkin.locatingHint'])).toBeTruthy()
    expect(screen.getByText('לובי')).toBeTruthy()
  })

  it('has no advice while it records the visit, and no chip when it does not know the point yet', () => {
    withI18n(<WorkingView phase="saving" />)
    expect(screen.getByText(he['checkin.saving'])).toBeTruthy()
    expect(screen.queryByText(he['checkin.locatingHint'])).toBeNull()
    expect(document.querySelector('.w-chip')).toBeNull()
  })
})

describe('the avatar of a person', () => {
  it('has the same tint on the sign-in list and on the password screen', () => {
    withI18n(<LoginView providers={{ status: 'ready', providers: [ploni, almoni], reload: () => {} }} onSignedIn={() => {}} />)
    const tintOf = (el) => [...el.classList].find((c) => c.startsWith('w-avatar--') && c !== 'w-avatar--lg')
    const [onList] = [...document.querySelectorAll('.w-person')].filter((el) => el.textContent.includes(ploni.contact_name))
    const listTint = tintOf(onList.querySelector('.w-avatar'))
    fireEvent.click(onList)
    expect(listTint).toBeTruthy()
    expect(tintOf(document.querySelector('.w-avatar'))).toBe(listTint)
  })

  it('comes from the name, not from the id: the ids of the sample data change on every seed, and so would the pictures of the screens', () => {
    const tintFor = (id) => {
      withI18n(<LoginView providers={{ status: 'ready', providers: [{ ...ploni, id }], reload: () => {} }} onSignedIn={() => {}} />)
      const tint = [...document.querySelector('.w-avatar').classList].find((c) => c.startsWith('w-avatar--'))
      cleanup()
      return tint
    }
    expect(tintFor('00000000-0000-4000-8000-000000000001')).toBe(tintFor('ffffffff-ffff-4fff-8fff-fffffffffffe'))
    expect(tintFor('a')).toBe(tintFor('zzzz'))
  })
})
