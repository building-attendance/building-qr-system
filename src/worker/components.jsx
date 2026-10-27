import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { api } from '../api/client.js'
import { applyUpdate, isUpdateReady, subscribeUpdate } from './update.js'
import { errorMessageKey, isKnownError } from './errors.js'
import { providerLabel } from './checkIn.js'
import { isSession } from './session.js'
import { tutorialUrl } from './tutorial.js'
import { DEVICE_LABEL_MAX_LENGTH } from '../../shared/contract.js'
import { FLAG_LOCATION_OUTSIDE_RADIUS, FLAG_LOCATION_STALE, FLAG_LOCATION_UNVERIFIED } from '../../shared/flags.js'
import ThemeSwitch from '../ui/ThemeSwitch.jsx'
import BuildLabel from '../ui/BuildLabel.jsx'
import { Sheet } from './Sheet.jsx'
import {
  IconAlert, IconChevron, IconCheck, IconCloudOff, IconEye, IconEyeOff, IconGlobe, IconInfo, IconLock, IconPhoneCheck, IconPin,
  IconPinOff, IconQr, IconRefresh, IconSend, IconShield, IconUser, IconWifiOff, IconX,
} from './icons.jsx'

const initial = (text) => Array.from((text || '?').trim())[0]?.toUpperCase() ?? '?'

/**
 * The colour of a person's avatar: one of the four tints of the palette, always the same one for the same name (it comes from the name that
 * the avatar stands for, not from the place in the list, and not from the id: the ids of the sample data are made at random on every seed, which
 * would give the pictures of the screens another colour each run), so a person finds their own circle again on the sign-in list and on the
 * password screen, on every phone.
 */
const AVATAR_TINTS = ['violet', 'mint', 'peach', 'sky']
const tintOf = (name) => AVATAR_TINTS[Array.from(String(name)).reduce((sum, ch) => sum + ch.codePointAt(0), 0) % AVATAR_TINTS.length]

/**
 * `name` and `address` are the building's name and address as the committee typed them (any language: dir="auto" lays out Hebrew and
 * Latin alike). The name is a line of its own above the address. With neither there is no line at all: the icons stay at the
 * end of the bar by themselves. The address stops at two lines with an ellipsis (`.w-brand--address`, ui.css); the whole of it stays in
 * the page.
 *
 * `adminEntry` adds the committee's way in, a plain link to /admin (where the Google sign-in lives), as a lock beside the two pickers. It
 * was the last line of the sign-in list and of home, and a list of a few names or a visit or two pushed it below the fold (owner,
 * 27/10/2026); in the bar it is in view on arrival however long the screen below grows.
 */
export function TopBar({ name = '', address = '', adminEntry = false }) {
  const { t, lang, setLang, langs } = useI18n()
  const themeLabels = { label: t('theme.label'), system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') }
  return (
    <header className="w-topbar">
      {(name || address) && (
        <div className="w-brandbox">
          {name && <p className="w-brand" dir="auto">{name}</p>}
          {address && <p className={`${name ? 'w-brand w-brand--sub' : 'w-brand'} w-brand--address`} dir="auto">{address}</p>}
        </div>
      )}
      <div className="w-topbar__tools">
        {adminEntry && (
          <a className="w-admin-entry" href="/admin" aria-label={t('footer.admin')} title={t('footer.admin')}>
            <IconLock size={22} />
          </a>
        )}
        <ThemeSwitch labels={themeLabels} />
        <label className="w-lang">
          <span className="w-sr">{t('lang.label')}</span>
          <IconGlobe size={24} />
          <select value={lang} onChange={(e) => { setLang(e.target.value); e.target.blur() }}>
            {langs.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  )
}

/* ---------------------------------------------------------------- sign in */

export function LoginView({ providers, pointName, notice, onSignedIn }) {
  const { t, lang } = useI18n()
  const [selected, setSelected] = useState(null)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pwRef = useRef(null)

  useEffect(() => {
    if (selected) pwRef.current?.focus()
  }, [selected])

  const pick = (p) => {
    setSelected(p)
    setPassword('')
    setError('')
    setShow(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!selected || !password || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api('/session', {
        method: 'POST',
        body: { provider_id: selected.id, password, device_label: navigator.userAgent.slice(0, DEVICE_LABEL_MAX_LENGTH) },
      })
      const signedIn = { token: res.token, provider: res.provider }
      // An answer without a usable token or details (an old or broken server) is not kept and not drawn from: the screens
      // below would fail on it, and so would every later start. The person sees the same message as for any other failure.
      if (!isSession(signedIn)) throw new Error('The sign-in answer cannot be used')
      onSignedIn(signedIn, remember)
    } catch (err) {
      setError(
        err.code === 'invalid_credentials' ? t('login.wrong')
          : err.status === 429 ? t('login.locked')
          : err.transient ? t('login.network')
          : t('error.generic'),
      )
      setPassword('')
      pwRef.current?.focus()
      setBusy(false)
    }
  }

  const banner = (
    <>
      {notice && (
        <div className="w-banner w-banner--warn" role="status"><IconAlert /><div className="w-banner__body">{t(notice)}</div></div>
      )}
      {pointName && (
        <div className="w-banner">
          <IconPin />
          <div className="w-banner__body">{t('login.pointBanner', { name: pointName })}</div>
        </div>
      )}
    </>
  )

  if (selected) {
    const name = selected.contact_name || selected.company
    return (
      <form className="w-main" onSubmit={submit} noValidate>
        {banner}
        <div className="w-greet">
          <span className={`w-avatar w-avatar--lg w-avatar--${tintOf(name)}`} aria-hidden="true">{initial(name)}</span>
          <div className="w-greet__text">
            <h1 className="w-h1">{t('login.passwordTitle', { name })}</h1>
            {selected.contact_name && <p className="w-greet__sub"><bdi>{selected.company}</bdi></p>}
          </div>
        </div>
        {/* Lets a password manager keep one saved login per person instead of overwriting a single one. */}
        <input type="text" name="username" autoComplete="username" value={name} readOnly tabIndex={-1} aria-hidden="true"
          style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} />
        <div className="w-formcard">
          <div className="w-field">
            <label className="w-label" htmlFor="w-password">{t('login.passwordLabel')}</label>
            <div className="w-input-wrap">
              <input
                id="w-password" ref={pwRef} className={`w-input${error ? ' w-input--error' : ''}`}
                type={show ? 'text' : 'password'} value={password} disabled={busy}
                dir="ltr" // a revealed Latin password with punctuation must not be reordered by RTL rules
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password" enterKeyHint="go" autoCapitalize="none" spellCheck="false"
                aria-invalid={!!error} aria-describedby={error ? 'w-login-error' : undefined}
              />
              <button type="button" className="w-eye" onClick={() => setShow((s) => !s)}
                aria-label={show ? t('login.hidePassword') : t('login.showPassword')}>
                {show ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            <div id="w-login-error" role="alert" aria-live="assertive">
              {error && <p className="w-error"><IconAlert size={20} />{error}</p>}
            </div>
          </div>
          <label className="w-switch">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span className="w-switch__text">
              <span>{t('login.remember')}</span>
              <span className="w-small">{t('login.rememberHint')}</span>
            </span>
          </label>
          <button className="w-btn" type="submit" disabled={busy || !password}>
            {busy ? <span className="w-spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /> : t('login.submit')}
          </button>
        </div>
        <button type="button" className="w-link" onClick={() => setSelected(null)} disabled={busy}>
          {t('login.changeName')}
        </button>
      </form>
    )
  }

  return (
    <div className="w-main">
      {banner}
      <div>
        <h1 className="w-h1">{t('login.title')}</h1>
        <p className="w-lead">{t('login.subtitle')}</p>
      </div>

      {/* The video teaches this very sign-in, so its link is here too, from the start. */}
      <a className="w-link" href={tutorialUrl(lang)} target="_blank" rel="noopener">{t('home.tutorial')}</a>

      {providers.status === 'loading' && (
        <div className="w-list" role="status" aria-busy="true" aria-label={t('common.loading')}>
          <div className="w-skel" /><div className="w-skel" /><div className="w-skel" />
        </div>
      )}
      {providers.status === 'error' && (
        <div className="w-card" role="alert">
          <p className="w-error"><IconAlert size={20} />{t('login.loadError')}</p>
          <p className="w-small" style={{ marginBlock: 'var(--w-space-1-5) var(--w-space-3)' }}>{t('login.network')}</p>
          <button className="w-btn w-btn--quiet" onClick={providers.reload}>{t('common.retry')}</button>
        </div>
      )}
      {providers.status === 'ready' && providers.providers.length === 0 && (
        <div className="w-banner w-banner--warn" role="status"><IconInfo /><div className="w-banner__body">{t('login.noProviders')}</div></div>
      )}
      {providers.status === 'ready' && providers.providers.length > 0 && (
        <ul className="w-list">
          {providers.providers.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-person" onClick={() => pick(p)}>
                <span className={`w-avatar w-avatar--${tintOf(p.contact_name || p.company)}`} aria-hidden="true">{initial(p.contact_name || p.company)}</span>
                <span className="w-person__text">
                  <span className="w-person__name">{p.contact_name || p.company}</span>
                  {p.contact_name && <span className="w-person__sub">{p.company}</span>}
                </span>
                <IconChevron className="w-flip" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* The short privacy notice, before anyone signs in or scans, and inside it the way to the whole of it (src/worker/PrivacyView.jsx):
          one block, where the link was a row of its own under it. */}
      <p className="w-note">
        <IconShield size={20} />
        <span>{t('login.privacy')}<a className="w-note__link" href="/privacy">{t('privacy.open')}</a></span>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------- home */

export function HomeView({ session, visits, pending, syncing, onSync, notice, onDismissNotice, onSwitch }) {
  const { t, time, lang } = useI18n()
  const name = session.provider.contact_name || session.provider.company
  const company = session.provider.contact_name ? session.provider.company : ''
  const updateReady = useSyncExternalStore(subscribeUpdate, isUpdateReady)
  const headingRef = useRef(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  // After "done" or a sign-in the focus would otherwise fall back to the page body; start at the greeting.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  return (
    <div className="w-main">
      {/* Who is signed in, and beside it the way to hand the phone to the next person: on a shared phone that is what they need first,
          and under today's visits it went further down with every visit. */}
      <div className="w-greet__text">
        <h1 className="w-h1" tabIndex={-1} ref={headingRef} style={{ outline: 'none' }}>{t('home.hello', { name })}</h1>
        <div className="w-greet__account">
          {company && <p className="w-greet__sub"><bdi>{company}</bdi></p>}
          <button className="w-link w-greet__switch" onClick={onSwitch}>{t('home.switchWorker')}</button>
        </div>
      </div>

      {/* What needs attention comes before the how-to: a new version, the word that visits were refused, the visits that wait. */}
      {updateReady && (
        <div className="w-banner w-banner--wrap" role="status">
          <IconRefresh />
          <div className="w-banner__body">{t('update.available')}</div>
          <button className="w-btn w-btn--small" onClick={applyUpdate}>{t('update.apply')}</button>
        </div>
      )}

      <div className="w-live" aria-live="polite">
        {notice && (
          <div className={`w-banner ${notice.tone === 'ok' ? 'w-banner--ok' : 'w-banner--warn'}`} role="status">
            {notice.tone === 'ok' ? <IconCheck /> : <IconAlert />}
            <div className="w-banner__body">{t(notice.key, notice.params)}</div>
            {/* A warning stays until it is dismissed: it is the only word the person gets that visits were refused. */}
            <button className="w-banner__close" onClick={onDismissNotice} aria-label={t('notice.dismiss')}>
              <IconX size={20} />
            </button>
          </div>
        )}
        {pending > 0 && (
          <div className="w-banner w-banner--warn w-banner--wrap">
            <IconCloudOff />
            <div className="w-banner__body">{t('home.pendingCount', { count: pending })}</div>
            <button className="w-btn w-btn--small w-btn--quiet" onClick={onSync} disabled={syncing}>
              <IconSend size={18} />{syncing ? t('home.syncing') : t('home.syncNow')}
            </button>
          </div>
        )}
      </div>

      <div className="w-hero">
        <div className="w-hero__top">
          <span className="w-hero__icon" aria-hidden="true"><IconQr size={30} /></span>
          <div className="w-hero__text">
            <p className="w-only-touch">{t('home.instruction')}</p>
            <p className="w-only-desktop">{t('home.desktopHint')}</p>
          </div>
        </div>
        <ol className="w-steps" role="list">
          {[1, 2, 3].map((n) => (
            <li className="w-step" key={n}><span aria-hidden="true">{n}. </span>{t(`home.step${n}`)}</li>
          ))}
        </ol>
      </div>

      {/* The two things to read, side by side under the card (owner, 27/10/2026), one under the other where the words are long. The video
          is a link: it leaves the app for the player page of the person's language. The privacy notice opens its short version in a sheet
          over the screen, with the way to the whole of it. */}
      <div className="w-links">
        <a className="w-link" href={tutorialUrl(lang)} target="_blank" rel="noopener">{t('home.tutorial')}</a>
        <button type="button" className="w-link" aria-haspopup="dialog" onClick={() => setPrivacyOpen(true)}>{t('privacy.title')}</button>
      </div>

      <section className="w-card" aria-labelledby="w-today">
        <h2 id="w-today" className="w-section-title">{t('home.today')}</h2>
        {visits.length === 0 ? (
          <p className="w-small">{t('home.empty')}</p>
        ) : (
          <ul className="w-visits">
            {visits.map((v) => (
              <li className="w-visit" key={v.id}>
                <span className="w-visit__time" dir="ltr">{time(v.time)}</span>
                <span className="w-visit__point"><bdi>{v.point}</bdi></span>
                <span className={`w-tag${v.pending ? '' : ' w-tag--ok'}`}>{v.pending ? t('home.pending') : t('home.recorded')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BuildLabel label={t('app.version')} className="w-build--center w-foot" />

      {privacyOpen && (
        <Sheet title={t('privacy.title')} closeLabel={t('common.close')} onClose={() => setPrivacyOpen(false)}>
          <p>{t('login.privacy')}</p>
          <a className="w-link" href="/privacy">{t('privacy.open')}</a>
        </Sheet>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- working */

/** `pointName` is the point being checked in at, when the phone knows it (a scanned code that has not been looked up yet has none). */
export function WorkingView({ phase, pointName = '' }) {
  const { t } = useI18n()
  return (
    <div className="w-working" role="status" aria-live="polite">
      <div className="w-orbit" aria-hidden="true">
        <span className="w-orbit__arc" />
        <span className="w-orbit__core"><IconPin size={34} /></span>
      </div>
      <p className="w-working__title">
        {phase === 'locating' ? t('checkin.locating') : phase === 'saving' ? t('checkin.saving') : t('common.loading')}
      </p>
      {phase === 'locating' && <p className="w-working__hint">{t('checkin.locatingHint')}</p>}
      {pointName && <span className="w-chip w-chip--point"><IconPin size={18} /><span><bdi>{pointName}</bdi></span></span>}
    </div>
  )
}

/* ----------------------------------------------------------------- result */

const LOCATION_FLAGS = [FLAG_LOCATION_UNVERIFIED, FLAG_LOCATION_OUTSIDE_RADIUS, FLAG_LOCATION_STALE]

/**
 * The distance (metres) that the screen may call "location verified", or null: the server measured one, and the visit carries none of
 * the flags that say the position was weak, old or outside the point's radius (shared/flags.js). A visit without it says nothing about
 * the location, which is also true.
 */
function verifiedDistance(scan) {
  const flagged = (scan.flags ?? []).some((f) => LOCATION_FLAGS.includes(f))
  return Number.isFinite(scan.distance_m) && !flagged ? scan.distance_m : null
}

export function ResultView({ result, pointName, provider, onDone, onRetry }) {
  const { t, time, date, distance } = useI18n()
  const headingRef = useRef(null)
  useEffect(() => {
    headingRef.current?.focus() // screen readers announce the outcome; sighted users are unaffected
  }, [result])

  const point = result.scan?.point_name || pointName || ''
  let v
  switch (result.kind) {
    case 'success':
      v = {
        tone: 'success', Icon: IconCheck, title: t('checkin.success.title'), done: true,
        stamp: result.scan.checked_in_at, showDate: true, verified: verifiedDistance(result.scan),
      }
      break
    case 'duplicate':
      v = { tone: 'info', Icon: IconCheck, title: t('checkin.duplicate.title'), body: t('checkin.duplicate.body', { point, time: time(result.scan.checked_in_at) }), done: true }
      break
    case 'queued':
      // persisted=false: the phone refused to store it, so it survives only while this page stays open.
      v = {
        tone: 'warn', Icon: IconPhoneCheck, title: t('checkin.queued.title'), done: true,
        chip: t('checkin.queued.chip'), stamp: result.client_time,
        body: t(result.persisted === false ? 'checkin.queuedTemp.body' : 'checkin.queued.body'),
        // located=false: no position the server can use was saved with the visit, and a point that checks the location may refuse
        // it when it is sent, so the person is told while they are still standing at the point.
        warning: result.located === false ? t('checkin.queued.noLocation') : '',
      }
      break
    case 'far':
      v = { tone: 'danger', Icon: IconPinOff, title: t('checkin.far.title'), body: t('checkin.far.body', { distance: distance(result.scan.distance_m ?? 0), point }), retry: true }
      break
    case 'needLocation':
      v = {
        tone: 'warn', Icon: IconPinOff, title: t('checkin.needLocation.title'), retry: true,
        // "denied" needs different advice from "no fix": the fix is in the browser's site settings.
        body: t(result.locationReason === 'denied' ? 'checkin.needLocation.denied' : 'checkin.needLocation.body'),
      }
      break
    default:
      v = { tone: 'danger', Icon: IconAlert, title: t(errorMessageKey(result.code)), body: '', retry: !isKnownError(result.code) }
  }

  return (
    <div className={`w-result w-result--${v.tone}`} role="status" aria-live="polite">
      {v.chip && <span className="w-statuschip"><IconWifiOff size={16} />{v.chip}</span>}
      <div className="w-result__main">
        <div className="w-ring w-pop"><v.Icon /></div>
        <h1 tabIndex={-1} ref={headingRef}>{v.title}</h1>
        {v.body && <p className="w-result__body">{v.body}</p>}
        {v.warning && <p className="w-result__body w-result__warning">{v.warning}</p>}
        {v.stamp && (
          <p className="w-stamp">
            <span className="w-stamp__time" dir="ltr">{time(v.stamp)}</span>
            {v.showDate && <span className="w-stamp__date" dir="ltr">{date(v.stamp)}</span>}
          </p>
        )}
        <div className="w-chips">
          {v.done && point && <span className="w-chip w-chip--point"><IconPin size={18} /><span><bdi>{point}</bdi></span></span>}
          {/* On every outcome: on a shared phone, or after a refusal, the first question is "who am I signed in as?" */}
          {provider && <span className="w-chip"><IconUser size={18} /><span>{t('checkin.asUser', { name: providerLabel(provider) })}</span></span>}
        </div>
        {v.verified != null && <span className="w-verified"><IconCheck size={16} />{t('checkin.verified', { distance: distance(v.verified) })}</span>}
      </div>
      <div className="w-actions">
        {v.retry && <button className="w-btn" onClick={onRetry}>{t('checkin.retry')}</button>}
        <button className={`w-btn${v.retry ? ' w-btn--quiet' : ''}`} onClick={onDone}>{t('checkin.done')}</button>
      </div>
    </div>
  )
}
