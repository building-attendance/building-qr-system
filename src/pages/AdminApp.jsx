import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import '../ui/ui.css'
import '../admin/admin.css'
import { adminApi } from '../admin/api.js'
import { ToastProvider, ConfirmProvider, Modal, Spinner, useToast } from '../admin/ui.jsx'
import AccountMenu from '../admin/AccountMenu.jsx'
import LoginScreen from '../admin/LoginScreen.jsx'
import HomeView from '../admin/views/HomeView.jsx'
import PointsView from '../admin/views/PointsView.jsx'
import ProvidersView from '../admin/views/ProvidersView.jsx'
import HistoryView from '../admin/views/HistoryView.jsx'
import AgentView from '../admin/views/AgentView.jsx'
import SettingsView from '../admin/views/SettingsView.jsx'
import AuditView from '../admin/views/AuditView.jsx'
import HelpView from '../admin/views/HelpView.jsx'
import { useTab } from '../admin/tab.js'
import { BuildingNameProvider, useBuildingName, APP_NAME } from '../admin/buildingName.jsx'
import { useErrorReport, clearLoadCache } from '../admin/hooks.js'
import { noteClientError, setPlace, currentPlace } from '../ui/errorReport.js'
import { applyUpdate, isUpdateReady, subscribeUpdate } from '../worker/update.js'
import { IconHome, IconPin, IconUsers, IconList, IconRobot, IconClock, IconInfo, IconSettings, IconMore, IconChevron, IconAlert, IconRefresh } from '../admin/icons.jsx'

// The screens of the committee app, in the order of the side rail (a computer). `label` is the name of the screen as a page: the title of the
// document and the list under "עוד". `nav` is the name on its button in the side rail and in the tab bar of the phone. Three screens have a
// `nav` that is not their `label`. Two are shorter, and each was measured (e2e/admin.spec.js), not guessed. The providers' button says
// "ספקים" because "נותני שירות" wrapped onto two lines in a fifth of a 360 px screen, which is the share of each of the five buttons of the
// bar when it was a bar of labels. The help's says "עזרה" because "איך עובדים עם המערכת" is 168 px wide and the name on a button of the
// side rail has 157 px. The points' says "מיקומים" (owner decision of 14/10/2026): only the navigation calls the screen that, and its
// title, its buttons and menus, and the provider app keep "נקודה". The sheet under "עוד" has room for the whole name of a
// screen, so it shows the `label`.
//
// `group` is where the screen sits. The side rail shows all eight, the work group and then the management group with a separator
// between them. The tab bar of the phone has five buttons: the four screens of the work group, in this order (Home first), and "עוד" (more),
// which opens a sheet with the management group. The first screen, Home, is the one that opens when the address names none.
// `sub` (a line about the screen) and `tint` (the colour of its icon) are for the rows of that sheet only.
const GROUP_WORK = 'work'
const GROUP_MANAGE = 'manage'
const TABS = [
  { key: 'home', label: 'בית', nav: 'בית', icon: IconHome, View: HomeView, group: GROUP_WORK },
  { key: 'history', label: 'היסטוריה', nav: 'היסטוריה', icon: IconList, View: HistoryView, group: GROUP_WORK },
  { key: 'points', label: 'נקודות', nav: 'מיקומים', icon: IconPin, View: PointsView, group: GROUP_WORK },
  { key: 'providers', label: 'נותני שירות', nav: 'ספקים', icon: IconUsers, View: ProvidersView, group: GROUP_WORK },
  { key: 'agent', label: 'אייג׳נט', nav: 'אייג׳נט', icon: IconRobot, View: AgentView, group: GROUP_MANAGE, sub: 'מפתחות לסוכן ה-AI של הוועד', tint: 'violet' },
  { key: 'settings', label: 'הגדרות', nav: 'הגדרות', icon: IconSettings, View: SettingsView, group: GROUP_MANAGE, sub: 'מנהלי המערכת ופרטי הבניין', tint: 'sky' },
  { key: 'audit', label: 'יומן פעולות', nav: 'יומן פעולות', icon: IconClock, View: AuditView, group: GROUP_MANAGE, sub: 'מי שינה מה ומתי', tint: 'peach' },
  { key: 'help', label: 'איך עובדים עם המערכת', nav: 'עזרה', icon: IconInfo, View: HelpView, group: GROUP_MANAGE, sub: 'מדריך קצר', tint: 'mint' },
]

// The tab that is open lives in the address (#history), see src/admin/tab.js. The first tab is the one that opens by default.
const TAB_KEYS = TABS.map((t) => t.key)
const WORK_TABS = TABS.filter((t) => t.group === GROUP_WORK)
const MORE_TABS = TABS.filter((t) => t.group === GROUP_MANAGE)

// Defined once, outside Shell: a component created inside a render would be a new type each time and every tab change would remount the
// buttons (losing keyboard focus). `text` is what the button says. In the tab bar only the current button shows it: the others are an icon,
// and the text stays in the page for a screen reader and for voice control (`w-sr`), so every button has its name.
function NavItem({ tab, current, onGo, className, size, iconOnly = false }) {
  return (
    <button className={className} onClick={() => onGo(tab.key)} aria-current={current ? 'page' : undefined}>
      <tab.icon size={size} /><span className={iconOnly && !current ? 'a-nav-label w-sr' : 'a-nav-label'}>{tab.nav}</span>
    </button>
  )
}

// The sheet that "עוד" opens: the management screens, one row each (an icon on its tint, the name, a line about the screen, and a chevron).
// A real dialog (the same `Modal` as every form of the app: focus moves in and is trapped, Esc and a tap outside close it). Choosing a screen
// goes there and closes the sheet; the button that opened it takes the focus back (Shell). It has no form, so it never asks about unsaved
// changes. The name of a row is the screen's name followed by the line under it: both are drawn inside the button, and a name must contain
// the text that a person sees (WCAG 2.5.3, axe `label-content-name-mismatch`). A button is still found by the start of its name.
function MoreSheet({ tab, onGo, onClose }) {
  return (
    <Modal title="עוד" onClose={onClose} size="sheet">
      <nav className="a-more" aria-label="מסכים נוספים">
        {MORE_TABS.map((t) => (
          <button
            key={t.key} className="a-more__row" aria-current={tab === t.key ? 'page' : undefined}
            aria-labelledby={`more-${t.key} more-${t.key}-sub`} onClick={() => { onGo(t.key); onClose() }}
          >
            <span className={`a-more__icon a-more__icon--${t.tint}`}><t.icon size={22} /></span>
            <span className="a-more__text"><span id={`more-${t.key}`}>{t.label}</span>{' '}<span id={`more-${t.key}-sub`}>{t.sub}</span></span>
            <IconChevron size={18} className="w-flip" />
          </button>
        ))}
      </nav>
    </Modal>
  )
}

// The brand: the building's name when the committee set one (kept to a few lines by CSS, an 80 character name included), else the name of
// the app, and under it what the app is. It is the same text in the side rail of a computer and in the top bar of a phone, and the end of
// the window title.
function Brand({ name }) {
  return (
    <div className="a-brand">
      <span className="a-brand__text" dir="auto">{name || APP_NAME}</span>
      <span className="a-brand__sub">ועד הבית</span>
    </div>
  )
}

function Shell({ admin, onSignedOut }) {
  const toast = useToast()
  const { name: buildingName, loadName: loadBuildingName } = useBuildingName()
  const [tab, goTo] = useTab(TAB_KEYS)
  setPlace(`committee:${tab}`) // the screen for an error report (src/ui/errorReport.js), told while rendering so that a first draw that breaks is on this tab
  const { View, label } = TABS.find((t) => t.key === tab)
  const moreCurrent = MORE_TABS.some((t) => t.key === tab)
  const updateReady = useSyncExternalStore(subscribeUpdate, isUpdateReady)
  const mainRef = useRef(null)
  const first = useRef(true)
  // The sheet under "עוד" on the phone. When it closes, the focus goes back to the button that opened it: the dialog does that itself, by
  // the element that was focused when it opened, but Safari does not focus a button that was tapped, so the shell names the button.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)
  const moreWasOpen = useRef(false)
  useEffect(() => {
    if (moreWasOpen.current && !moreOpen) moreRef.current?.focus()
    moreWasOpen.current = moreOpen
  }, [moreOpen])
  const closeMore = useCallback(() => setMoreOpen(false), [])

  // The building's name, from the committee's own route, as soon as somebody is signed in. Until it answers (or when it cannot) the
  // brand shows what the public route said, or the plain name of the app. The Settings screen tells the same state when it saves, and
  // a save that comes before this answer wins over it (loadName drops an answer that is older than a save).
  useEffect(() => {
    let cancelled = false
    loadBuildingName(() => adminApi('/building').then((res) => (cancelled ? undefined : res?.building?.name)))
      .catch(() => {}) // the brand stays as it is; a session that ended is announced by adminApi
    return () => {
      cancelled = true
    }
  }, [loadBuildingName])

  // The title of the window: the page, then the building (or the app). A new name changes the title and nothing else.
  useEffect(() => {
    document.title = `${label} · ${buildingName || APP_NAME}`
  }, [label, buildingName])

  // A tab change is a page change: scroll to the top, focus to the content.
  useEffect(() => {
    if (first.current) return void (first.current = false)
    window.scrollTo(0, 0)
    mainRef.current?.focus({ preventScroll: true })
  }, [tab])

  // Only leave the screen once the server has really ended the session; otherwise a reload would sign the
  // person straight back in (a shared computer).
  const signOut = async () => {
    try {
      await adminApi('/logout', { method: 'POST' })
    } catch (err) {
      if (err.status !== 401) return toast.error('ההתנתקות לא הושלמה. בדקו את החיבור ונסו שוב.')
    }
    onSignedOut()
  }

  return (
    <>
      <aside className="a-side">
        <Brand name={buildingName} />
        <nav className="a-nav" aria-label="ניווט ראשי">
          {[WORK_TABS, MORE_TABS].map((group, index) => (
            <Fragment key={group[0].group}>
              {index > 0 && <hr className="a-nav__sep" />}
              {group.map((t) => <NavItem key={t.key} tab={t} current={tab === t.key} onGo={goTo} className="a-nav__item" size={24} />)}
            </Fragment>
          ))}
        </nav>
        <AccountMenu admin={admin} onSignOut={signOut} where="rail" />
      </aside>

      <header className="a-top">
        <Brand name={buildingName} />
        <AccountMenu admin={admin} onSignOut={signOut} where="top" />
      </header>

      <main className="a-main" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
        {updateReady && (
          <div className="w-banner" role="status" style={{ marginBlockEnd: 'var(--w-space-4)' }}>
            <IconRefresh />
            <div className="w-banner__body">יש גרסה חדשה של המערכת.</div>
            <button className="w-btn w-btn--small w-btn--quiet" onClick={applyUpdate}>עדכון</button>
          </div>
        )}
        <View admin={admin} />
      </main>

      <div className="a-tabbar-fade" aria-hidden="true" />
      <nav className="a-tabbar" aria-label="ניווט ראשי (טלפון)">
        {WORK_TABS.map((t) => <NavItem key={t.key} tab={t} current={tab === t.key} onGo={goTo} className="a-tab" size={24} iconOnly />)}
        {/* The fifth button is the current item while one of the screens under it is open; the sheet marks which one. */}
        <button type="button" className="a-tab" ref={moreRef} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}
          aria-current={moreCurrent ? 'page' : undefined}>
          <IconMore size={24} /><span className={moreCurrent ? 'a-nav-label' : 'a-nav-label w-sr'}>עוד</span>
        </button>
      </nav>
      {moreOpen && <MoreSheet tab={tab} onGo={goTo} onClose={closeMore} />}
    </>
  )
}

export default function AdminApp() {
  const [boot, setBoot] = useState({ status: 'loading' })
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [config, me] = await Promise.all([
        adminApi('/config'),
        adminApi('/me').catch((e) => (e.status === 401 ? null : Promise.reject(e))),
      ])
      setBoot({ status: 'ready', config, admin: me?.admin ?? null })
    } catch {
      setBoot({ status: 'error' })
    }
  }, [])
  useEffect(() => { load() }, [load])

  // The screen for an error report (src/ui/errorReport.js): the shell sets its own tab, so what is left is the sign-in and what is
  // outside any screen (the first load, the screen that says there is no connection).
  if (boot.status !== 'ready') setPlace('committee:app')
  else if (!boot.admin) setPlace('committee:login')

  // Any call that finds the session gone sends the person back to the sign-in screen. This is the one place where a session that the
  // server ended is noted for the report (a sign-out that the person chose, Shell's `signOut`, is not). Calls that find it gone
  // together note it once.
  const signedIn = useRef(false)
  signedIn.current = Boolean(boot.admin)

  // What went wrong in the app goes to the server once somebody is signed in, and when the page comes back to the foreground. Not for a
  // session that has just ended: the sign-in screen is drawn a moment after the ref above says so.
  useErrorReport(Boolean(boot.admin), () => signedIn.current)

  useEffect(() => {
    const expired = () => {
      if (signedIn.current) {
        signedIn.current = false
        noteClientError({ kind: 'signed_out', place: currentPlace(), code: 'admin_required' })
      }
      clearLoadCache() // the member is gone: what the tabs showed is not for whoever signs in next
      setNotice('פג תוקף ההתחברות. היכנסו שוב.')
      setBoot((b) => (b.status === 'ready' ? { ...b, admin: null } : b))
    }
    window.addEventListener('admin-session-expired', expired)
    return () => window.removeEventListener('admin-session-expired', expired)
  }, [])

  let content
  if (boot.status === 'loading') content = <Spinner />
  else if (boot.status === 'error') {
    content = (
      <div className="a-login"><div className="a-login__card">
        <span className="a-login__mark"><IconAlert size={34} /></span>
        <h1 className="w-h1">אין חיבור לשרת</h1>
        <button className="w-btn" onClick={() => { setBoot({ status: 'loading' }); load() }}>נסו שוב</button>
      </div></div>
    )
  } else if (!boot.admin) {
    content = (
      <>
        {notice && <div className="w-banner w-banner--warn" role="status" style={{ margin: 'var(--w-space-4) auto 0', maxWidth: 440 }}><IconAlert /><div className="w-banner__body">{notice}</div></div>}
        <LoginScreen config={boot.config} onSignedIn={(admin) => { clearLoadCache(); setNotice(''); setBoot((b) => ({ ...b, admin })) }} />
      </>
    )
  } else content = <Shell admin={boot.admin} onSignedOut={() => { clearLoadCache(); setNotice(''); setBoot((b) => ({ ...b, admin: null })) }} />

  return (
    <div className="a-app">
      <BuildingNameProvider>
        <ToastProvider>
          <ConfirmProvider>{content}</ConfirmProvider>
        </ToastProvider>
      </BuildingNameProvider>
    </div>
  )
}
