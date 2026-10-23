// @vitest-environment jsdom
// The privacy notice of the provider app (src/worker/PrivacyView.jsx, at /privacy), rendered with its real translations: it names
// the committee and how to reach it from the building settings, falls back to "the committee's members" when no contact is set,
// states the periods of the code with the plural of each language, and is dated DD/MM/YYYY. The sign-in and home screens link to it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { I18nProvider } from '../../src/i18n/index.jsx'
import { LANGS, LANG_STORAGE_KEY } from '../../src/i18n/core.js'
import { PrivacyView, PRIVACY_NOTICE_UPDATED } from '../../src/worker/PrivacyView.jsx'
import { LoginView, HomeView } from '../../src/worker/components.jsx'
import { formatDate } from '../../shared/datetime.js'
import he from '../../src/i18n/he.js'
import en from '../../src/i18n/en.js'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const BUILDING = { name: 'בניין הדוגמה', address: 'רחוב הדוגמה 1, עיר לדוגמה', privacy_contact: 'ועד הבית, vaad@example.test' }
const notice = (building = BUILDING, lang = 'he') => {
  window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  return render(<I18nProvider><PrivacyView building={building} /></I18nProvider>)
}
// The words as a person reads them: translate() wraps every value in direction isolates (src/i18n/core.js).
const text = () => document.body.textContent.replace(/[⁨⁩]/g, '')

describe('the privacy notice', () => {
  it('names the committee with the building and its address, and how to reach it, in the section and in the rights', () => {
    notice()
    expect(screen.getByRole('heading', { level: 1, name: he['privacy.title'] })).toBeTruthy()
    expect(text()).toContain(`ועד הבית של ${BUILDING.name}, ${BUILDING.address}, אחראי למידע`)
    expect(text()).toContain(`לשאלות ולבקשות על המידע שלכם: ${BUILDING.privacy_contact}.`)
    expect(text()).toContain(`כדי להשתמש בזכויות האלה, פנו לוועד הבית: ${BUILDING.privacy_contact}.`)
  })

  it('names the committee by what the committee typed: the name alone, the address alone, or neither', () => {
    for (const [building, sentence] of [
      [{ ...BUILDING, address: '' }, `ועד הבית של ${BUILDING.name} אחראי`],
      [{ ...BUILDING, name: '' }, `ועד הבית של הבניין שבכתובת ${BUILDING.address} אחראי`],
      [{ ...BUILDING, name: '  ', address: '' }, 'ועד הבית של הבניין אחראי'],
    ]) {
      notice(building)
      expect(text(), sentence).toContain(sentence)
      cleanup()
    }
  })

  it('tells the providers to ask the committee members when the committee has not set a contact', () => {
    notice({ ...BUILDING, privacy_contact: '' })
    expect(text()).toContain(he['privacy.who.noContact'])
    expect(text()).toContain(he['privacy.rights.noContact'])
    expect(text()).not.toContain('{contact}')
  })

  it('states the periods of the code with the plural of each language, and leaves no placeholder', () => {
    const periods = {
      he: ['90 ימים', '1 יום', '5 דקות', '30 ימים'],
      en: ['90 days', '1 day', '5 minutes', '30 days'],
      ru: ['90 дней', '1 день', '5 минут', '30 дней'],
      ar: ['90 يومًا', 'يوم', '5 دقائق', '30 يومًا'],
    }
    expect(Object.keys(periods).sort()).toEqual(LANGS.map((l) => l.code).sort())
    for (const { code } of LANGS) {
      notice(BUILDING, code)
      for (const period of periods[code]) expect(text(), `${code}: ${period}`).toContain(period)
      expect(text(), code).not.toMatch(/\{\w+\}/)
      cleanup()
    }
  })

  it('is dated DD/MM/YYYY by shared/datetime.js', () => {
    notice()
    expect(formatDate(PRIVACY_NOTICE_UPDATED)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(text()).toContain(`עודכן: ${formatDate(PRIVACY_NOTICE_UPDATED)}`)
  })

  it('has a heading for each part of Section 11 in every language, and a link back to the app', () => {
    for (const { code } of LANGS) {
      notice(BUILDING, code)
      expect(screen.getAllByRole('heading', { level: 2 }).length, code).toBe(7)
      expect(screen.getByRole('link').getAttribute('href'), code).toBe('/')
      cleanup()
    }
    notice(BUILDING, 'en')
    expect(screen.getByRole('heading', { level: 1, name: en['privacy.title'] })).toBeTruthy()
    expect(screen.getByRole('link', { name: en['privacy.back'] })).toBeTruthy()
  })
})

describe('the way to the notice', () => {
  it('is on the sign-in list, after the short notice', () => {
    render(<I18nProvider><LoginView providers={{ status: 'ready', providers: [], reload: () => {} }} onSignedIn={() => {}} /></I18nProvider>)
    expect(screen.getByRole('link', { name: he['privacy.open'] }).getAttribute('href')).toBe('/privacy')
  })

  it('is on the home screen, at any time after the sign-in', () => {
    const session = { token: 'qrp_x', provider: { id: 'p1', contact_name: 'פלוני', company: 'ניקיון' } }
    render(<I18nProvider><HomeView session={session} visits={[]} pending={0} syncing={false} onSync={() => {}} onSwitch={() => {}} /></I18nProvider>)
    expect(screen.getByRole('link', { name: he['privacy.title'] }).getAttribute('href')).toBe('/privacy')
  })
})
