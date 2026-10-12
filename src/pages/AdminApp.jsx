import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import '../ui/ui.css'
import '../admin/admin.css'
import { adminApi } from '../admin/api.js'
import { ToastProvider, ConfirmProvider, Modal, Spinner, IconButton, useToast } from '../admin/ui.jsx'
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
import ThemeSwitch, { HEBREW_THEME_LABELS as THEME_LABELS } from '../ui/ThemeSwitch.jsx'
import { IconHome, IconPin, IconUsers, IconList, IconKey, IconClock, IconInfo, IconSettings, IconMore, IconLogout, IconQr, IconDevice, IconAlert, IconRefresh } from '../admin/icons.jsx'

// The screens of the committee app, in the order of the side rail (a computer). `label` is the name of the screen as a page: the top bar,
// the title of the document and the list under "עוד". `nav` is the name on its button in the side rail and in the tab bar of the phone.
// Two screens have a `nav` shorter than their `label`, and each was measured (e2e/admin.spec.js), not guessed. The providers' button says
// "ספקים" because "נותני שירות" wrapped onto two lines in a fifth of a 360 px screen (72 px), which is the share of each of the five buttons of the bar. The help's says "עזרה"
// because "איך עובדים עם המערכת" is 168 px wide and the name on a button of the side rail has 157 px. The sheet under "עוד" has room for
// the whole name of a screen, so it shows the `label`.
//
// `group` is where the screen sits. The side rail shows all eight, the work group and then the management group with a separator
// between them. The tab bar of the phone has five buttons: the four screens of the work group, in this order (Home first), and "עוד" (more),
// which opens a sheet with the management group. The first screen, Home, is the one that opens when the address names none.
const GROUP_WORK = 'work'
const GROUP_MANAGE = 'manage'
const TABS = [
  { key: 'home', label: 'בית', nav: 'בית', icon: IconHome, View: HomeView, group: GROUP_WORK },
  { key: 'history', label: 'היסטוריה', nav: 'היסטוריה', icon: IconList, View: HistoryView, group: GROUP_WORK },
  { key: 'points', label: 'נקודות', nav: 'נקודות', icon: IconPin, View: PointsView, group: GROUP_WORK },
  { key: 'providers', label: 'נותני שירות', nav: 'ספקים', icon: IconUsers, View: ProvidersView, group: GROUP_WORK },
  { key: 'agent', label: 'אייג׳נט', nav: 'אייג׳נט', icon: IconKey, View: AgentView, group: GROUP_MANAGE },
  { key: 'settings', label: 'הגדרות', nav: 'הגדרות', icon: IconSettings, View: SettingsView, group: GROUP_MANAGE },
  { key: 'audit', label: 'יומן פעולות', nav: 'יומן פעולות', icon: IconClock, View: AuditView, group: GROUP_MANAGE },
  { key: 'help', label: 'איך עובדים עם המערכת', nav: 'עזרה', icon: IconInfo, View: HelpView, group: GROUP_MANAGE },
]

// The tab that is open lives in the address (#history), see src/admin/tab.js. The first tab is the one that opens by default.
const TAB_KEYS = TABS.map((t) => t.key)
const WORK_TABS = TABS.filter((t) => t.group === GROUP_WORK)
const MORE_TABS = TABS.filter((t) => t.group === GROUP_MANAGE)

// Defined once, outside Shell: a component created inside a render would be a new type each time and every
// tab change would remount the buttons (losing keyboard focus). `text` is what the button says (the `nav` name unless the caller
// says otherwise: the sheet under "עוד" has room for the whole name of a screen).
function NavItem({ tab, current, onGo, className, size, text = tab.nav }) {
  return (
    <button className={className} onClick={() => onGo(tab.key)} aria-current={current ? 'page' : undefined}>
      <tab.icon size={size} /><span className="a-nav-label">{text}</span>
    </button>
  )
}

// The sheet that "עוד" opens: the management screens, one button each, in the same look as the rows of the side rail. A real dialog
// (the same `Modal` as every form of the app: focus moves in and is trapped, Esc and a tap outside close it). Choosing a screen goes
// there and closes the sheet; the button that opened it takes the focus back (Shell). It has no form, so it never asks about unsaved changes.
function MoreSheet({ tab, onGo, onClose }) {
  return (
    <Modal title="עוד" onClose={onClose} size="sheet">
      <nav className="a-nav" aria-label="מסכים נוספים">
        {MORE_TABS.map((t) => (
          <NavItem key={t.key} tab={t} text={t.label} current={tab === t.key} onGo={(key) => { onGo(key); onClose() }} className="a-nav__item" size={24} />
        ))}
      </nav>
    </Modal>
  )
}

// The same three icons on every screen size (the side rail on a computer, the top bar on a phone): the provider app,
// light / dark, and signing out. Only the place they sit changes with the width, never what they look like.
function ShellTools({ onSignOut }) {
  return (
    <div className="a-tools">
      <IconButton icon={IconDevice} label="אפליקציית נותני השירות" href="/" />
      <ThemeSwitch labels={THEME_LABELS} />
      <IconButton icon={IconLogout} label="יציאה" onClick={onSignOut} />
    </div>
  )
}

// The brand: the building's name when the committee set one (kept to a few lines by CSS, an 80 character name included), else the
// name of the app. It is the same text in the side rail of a computer and in the top bar of a phone, and the end of the window title.
function Brand({ name }) {
  return (
    <div className="a-brand">
      <span className="a-brand__mark"><IconQr size={22} /></span>
      <span className="a-brand__text" dir="auto">{name || APP_NAME}</span>
    </div>
  )
}

function Shell({ admin, onSignedOut }) {
  const toast = useToast()
  const { name: buildingName, loadName: loadBuildingName } = useBuildingName()
  const [tab, goTo] = useTab(TAB_KEYS)
  setPlace(`committee:${tab}`) // the screen for an error report (src/ui/errorReport.js), told while rendering so that a first draw that breaks is on this tab
  const { View, label } = TABS.find((t) => t.key === tab)
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
        <div className="a-side__foot">
          <div className="a-user"><strong>{admin.name || 'חבר ועד'}</strong><span dir="ltr">{admin.email}</span></div>
          <ShellTools onSignOut={signOut} />
        </div>
      </aside>

      <header className="a-top">
        <Brand name={buildingName} />
        <ShellTools onSignOut={signOut} />
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

      <nav className="a-tabbar" aria-label="ניווט ראשי (טלפון)">
        {WORK_TABS.map((t) => <NavItem key={t.key} tab={t} current={tab === t.key} onGo={goTo} className="a-tab" size={24} />)}
        {/* The fourth button is the current item while one of the screens under it is open; the sheet marks which one. */}
        <button type="button" className="a-tab" ref={moreRef} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}
          aria-current={MORE_TABS.some((t) => t.key === tab) ? 'page' : undefined}>
          <IconMore size={24} /><span className="a-nav-label">עוד</span>
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
