// The privacy notice of the provider app, at /privacy: what the app records about a service provider, why, who sees it, how long
// it is kept and the rights to see and correct it (Section 11 of the Protection of Privacy Law, as amended by Amendment 13). It
// names the committee of this building and how to reach it from the building settings that the committee typed (GET
// /api/public/building, kept on the phone by src/worker/buildingCache.js), so every copy of the app shows its own committee with
// no change to the code. The words are in src/i18n/*.js. It is a proposed notice, not legal advice: each committee has it checked
// (docs/install.md), and docs/privacy.md holds the facts that it states.
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { formatDate } from '../../shared/datetime.js'
import { GPS_MAX_STALE_AGE_S, RETENTION_DEVICE_LABEL_DAYS, RETENTION_LOGIN_ATTEMPT_DAYS } from '../../shared/contract.js'

/** When the text of the notice last changed, written for the person as DD/MM/YYYY. Change it with every change of the text. */
export const PRIVACY_NOTICE_UPDATED = '2026-10-24T09:00:00Z'

// The backups are counted, not dated: the backup task (scripts/backup-db.mjs, outside the app) keeps the newest 30 files
// (`--keep`, DEFAULT_KEEP), so the notice says "the latest 30 backups" in its words rather than taking a period from the code.

/** The path of the notice. Every path but /admin is the provider app (src/appKind.js), so it needs nothing in vercel.json. */
export const PRIVACY_PATH = '/privacy'

export const isPrivacyPath = () => window.location.pathname === PRIVACY_PATH

/**
 * The sections in their order: a heading, then a list (`list`) and paragraphs (`p`). An item with a `label` starts with it in bold,
 * the way the text names each kind of data. A paragraph is a key of the words, or one of the three that depend on the building.
 * @typedef {{ key: string, label?: boolean }} Item
 * @type {{ id: string, list?: Item[], p?: string[] }[]}
 */
const SECTIONS = [
  { id: 'who', p: ['who', 'whoContact'] },
  {
    id: 'what',
    list: ['account', 'scan', 'location', 'phone', 'signIn'].map((k) => ({ label: true, key: `privacy.what.${k}` })),
  },
  { id: 'why', list: ['service', 'near', 'phone', 'account'].map((k) => ({ key: `privacy.why.${k}` })) },
  { id: 'must', p: ['privacy.must'] },
  {
    id: 'see',
    list: ['committee', 'anyone', 'company', 'ai', 'hosting'].map((k) => ({ label: true, key: `privacy.see.${k}` })),
  },
  {
    id: 'keep',
    list: ['records', 'account', 'phone', 'signIn', 'location', 'backup'].map((k) => ({ label: true, key: `privacy.keep.${k}` })),
  },
  { id: 'rights', list: [{ key: 'privacy.rights.see' }, { key: 'privacy.rights.fix' }], p: ['rightsContact', 'privacy.rights.authority'] },
]

/** The key of the sentence that names the committee: with the building's name, its address, both, or neither. */
const whoKey = (name, address) =>
  name && address ? 'privacy.who.nameAddress' : name ? 'privacy.who.name' : address ? 'privacy.who.address' : 'privacy.who.none'

/** True when the page before this one was the app itself, so going back keeps where the person was (a scanned code, say). */
function cameFromApp() {
  try {
    return window.history.length > 1 && new URL(document.referrer).origin === window.location.origin
  } catch {
    return false // no referrer: the notice was opened directly, from a link or a bookmark
  }
}

/** @param {{ building: { name: string, address: string, privacy_contact: string } }} props */
export function PrivacyView({ building }) {
  const { t, days, minutes } = useI18n()
  const headingRef = useRef(null)
  // The page opens at its title, for a screen reader too.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const name = building.name.trim()
  const address = building.address.trim()
  const contact = building.privacy_contact.trim()
  const params = {
    building: name,
    address,
    contact,
    deviceDays: days(RETENTION_DEVICE_LABEL_DAYS),
    loginDays: days(RETENTION_LOGIN_ATTEMPT_DAYS),
    fixMinutes: minutes(Math.round(GPS_MAX_STALE_AGE_S / 60)),
  }
  /** @param {string} which */
  const paragraph = (which) =>
    which === 'who' ? t(whoKey(name, address), params)
      : which === 'whoContact' ? t(contact ? 'privacy.who.contact' : 'privacy.who.noContact', params)
      : which === 'rightsContact' ? t(contact ? 'privacy.rights.contact' : 'privacy.rights.noContact', params)
      : t(which, params)

  /** @param {import('react').MouseEvent} e */
  const back = (e) => {
    if (!cameFromApp()) return // the link itself opens the app
    e.preventDefault()
    window.history.back()
  }

  return (
    <article className="w-main w-notice" aria-labelledby="w-notice-title">
      <div>
        <h1 id="w-notice-title" className="w-h1" tabIndex={-1} ref={headingRef} style={{ outline: 'none' }}>{t('privacy.title')}</h1>
        <p className="w-lead">{t('privacy.intro')}</p>
      </div>
      {SECTIONS.map((section) => (
        <section className="w-card" key={section.id} aria-labelledby={`w-notice-${section.id}`}>
          <h2 id={`w-notice-${section.id}`} className="w-section-title">{t(`privacy.${section.id}.title`)}</h2>
          {section.list && (
            <ul className="w-notice__list">
              {section.list.map((item) => (
                <li key={item.key}>
                  {item.label && <><strong>{t(`${item.key}.label`)}</strong>{' '}</>}
                  {t(item.key, params)}
                </li>
              ))}
            </ul>
          )}
          {section.p?.map((which) => <p key={which} className="w-notice__p">{paragraph(which)}</p>)}
        </section>
      ))}
      <p className="w-small">{t('privacy.updated', { date: formatDate(PRIVACY_NOTICE_UPDATED) })}</p>
      <a className="w-link" href="/" onClick={back}>{t('privacy.back')}</a>
    </article>
  )
}
