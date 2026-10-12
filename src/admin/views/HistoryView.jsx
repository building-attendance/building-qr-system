import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, errorText, scanRefusals } from '../api.js'
import { useLoad, usePhoneLayout, LOAD_KEY } from '../hooks.js'
import { dropLoadCache, loadCacheEpoch, readLoadCache, writeLoadCache } from '../loadCache.js'
import { Modal, Field, Badge, Switch, EmptyState, Spinner, IconButton, useToast, useConfirm, useAction, useDirty } from '../ui.jsx'
import { DateRangeFields, FilterBar, FilterSheet, goodDate, sameFilters, useFilterFocus, useFilterState, useUnfinishedDates } from '../filters.jsx'
import { IconList, IconDownload, IconRefresh, IconBan, IconUndo, IconAlert, IconTrash, IconPin } from '../icons.jsx'
import { goToTab, hashName, hashQuery } from '../tab.js'
import { formatDay, formatDateTime, formatTime, isoDay, parseDay } from '../../../shared/datetime.js'
import {
  OUTCOME_ACCEPTED, OUTCOME_REJECTED_FAR, OUTCOME_REJECTED_NO_LOCATION, VOID_REASON_MAX_LENGTH,
  SCAN_ERROR_INVALID_CODE, SCAN_ERROR_UNKNOWN_CODE, SCAN_ERROR_POINT_INACTIVE, SCAN_ERROR_NOT_ASSIGNED,
  SCAN_ERROR_INVALID_SCAN_ID, SCAN_ERROR_SCAN_ID_CONFLICT, SCAN_ERROR_INVALID_ITEM, SOURCE_ONLINE, SOURCE_OFFLINE_SYNC, UUID_RE,
} from '../../../shared/contract.js'

const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86_400_000))
const dayLabel = formatDay // the heading of a day: DD/MM/YYYY

// What the agent-facing flags mean, in words a committee member understands.
const FLAGS = {
  location_unverified: { label: 'מיקום לא מאומת', tone: 'warn' },
  location_outside_radius: { label: 'מחוץ לרדיוס', tone: 'warn' },
  location_stale: { label: 'מיקום ישן', tone: 'warn' },
  offline_sync: { label: 'נשלח אחרי חוסר קליטה', tone: 'info' },
  clock_skew: { label: 'שעון הטלפון לא תקין', tone: 'warn' },
  demo: { label: 'דמו', tone: 'neutral' },
  legacy_import: { label: 'מהמערכת הישנה', tone: 'neutral' },
}
const OUTCOMES = { [OUTCOME_REJECTED_FAR]: 'נדחתה: רחוק מהנקודה', [OUTCOME_REJECTED_NO_LOCATION]: 'נדחתה: חסר מיקום' }

// The fourth choice of the "type" filter, and the only one that is not a kind of scan: the visits that the server refused (a
// point that was switched off, a person who is not assigned, a code that names nothing, ...). They are another list (GET
// /api/admin/scan-refusals), not scans, so this screen shows that list instead and offers nothing that is about a scan.
const NOT_COUNTED = 'not_counted'

// Why a visit was not counted, in the words of the committee. Keyed by the codes of the contract, never by strings. A code
// that is not here (a newer server) gets OTHER_REASON. "warn" is a reason that the committee can act on (switch the point
// on, assign the person, print the code again); "neutral" is a fault of the data, which nobody on the committee can mend.
const REFUSAL_REASONS = new Map([
  [SCAN_ERROR_POINT_INACTIVE, { label: 'נקודה כבויה', tone: 'warn' }],
  [SCAN_ERROR_NOT_ASSIGNED, { label: 'לא משויך לנקודה', tone: 'warn' }],
  [SCAN_ERROR_UNKNOWN_CODE, { label: 'קוד לא מוכר', tone: 'warn' }],
  [SCAN_ERROR_INVALID_CODE, { label: 'קוד לא מוכר', tone: 'warn' }],
  [SCAN_ERROR_INVALID_SCAN_ID, { label: 'נתונים לא תקינים', tone: 'neutral' }],
  [SCAN_ERROR_SCAN_ID_CONFLICT, { label: 'נתונים לא תקינים', tone: 'neutral' }],
  [SCAN_ERROR_INVALID_ITEM, { label: 'נתונים לא תקינים', tone: 'neutral' }],
])
const OTHER_REASON = { label: 'סיבה אחרת', tone: 'neutral' }
// How the visit reached the server. A source that is not here shows no badge.
const REFUSAL_SOURCES = new Map([
  [SOURCE_OFFLINE_SYNC, { label: 'מהתור בטלפון', tone: 'info' }],
  [SOURCE_ONLINE, { label: 'בזמן אמת', tone: 'neutral' }],
])
const NO_POINT = 'קוד לא מוכר' // a refusal that named no point: the code that was scanned is not one of ours

const DEFAULTS = () => ({ from: daysAgo(6), to: isoDay(new Date()), point_id: '', provider_id: '', outcome: OUTCOME_ACCEPTED, include_voided: false, include_demo: false })
const PAGE = 100

// The choices of the "type" filter, in the order of the select. The label is also what a chip says on a phone.
const TYPES = [
  [OUTCOME_ACCEPTED, 'נוכחויות שנרשמו'],
  ['rejected', 'ניסיונות שנדחו'],
  ['all', 'הכול'],
  [NOT_COUNTED, 'לא נקלטו'],
]
const typeLabel = (value) => TYPES.find(([key]) => key === value)?.[1] ?? value

// A link can open this screen with its filters set: `#history?provider=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=<type>`, every parameter
// optional. `from`, `to` and `outcome` are the names of the filters themselves; `provider` is the filter `provider_id`, written the way the
// link names it. `outcome` is one of the choices of the "type" filter (`accepted`, `rejected`, `all`, `not_counted`). The point and the
// two switches are not in the address: a link that needs them adds them here, the same way.
//
// The link is a whole description of the view, so it is applied to the defaults, never to the filters that happen to be set: opening it
// twice, or from another screen, gives the same list. A parameter that is not valid (a day that is not on the calendar, a type that is not
// one of the choices, a provider id that is not shaped like an id) is left out quietly and its filter keeps its default. The screen
// reads the address when it opens (`readLink`, in the first render, so nothing is drawn or asked for with the defaults first) and again
// when the address changes while it is open; then it puts the plain `#history` back (`tidyAddress`).
//
// A provider filter is never widened. The id of a link is applied whenever it is shaped like an id, whether or not the list of providers
// holds it, or loaded at all: a provider that the committee deleted keeps its visits (the Home screen links its row here), and an id that
// is dropped would show the visits of everyone under a link that asked for one provider. What the list does not know is shown as such, in
// the select and in the chip (`unlistedProvider`), so that the filter is on in plain sight.
const LINK_KEYS = ['provider', 'from', 'to', 'outcome']

/** A day that a link may name: the one that the date field itself would take (a day on the calendar, 2000 to 2100), as the API writes it. */
const linkedDay = (value) => goodDate(value) && parseDay(formatDay(value)) === value

/**
 * What the address asks of this screen: `{ from?, to?, outcome?, provider? }` with only the valid values (the provider is an id in
 * lower case, as the server reads it), or `null` when the address is not a link to this screen (another screen, or no parameter that a
 * link has). A link whose every parameter is invalid is still a link: it opens the defaults.
 */
function readLink(hash = window.location.hash) {
  if (hashName(hash) !== 'history') return null
  const query = hashQuery(hash)
  if (!LINK_KEYS.some((key) => query.has(key))) return null
  const link = {}
  const from = query.get('from')
  const to = query.get('to')
  const outcome = query.get('outcome')
  const provider = query.get('provider')
  if (linkedDay(from)) link.from = from
  if (linkedDay(to)) link.to = to
  if (TYPES.some(([key]) => key === outcome)) link.outcome = outcome
  if (provider && UUID_RE.test(provider)) link.provider = provider.toLowerCase() // the shape that the server accepts: nothing else is sent
  return link
}

/** The filters that a link asks for: the defaults, with its valid parameters on top. */
function linkedFilters(link, defaults) {
  const { provider, ...rest } = link
  return { ...defaults, ...rest, ...(provider && { provider_id: provider }) }
}

/**
 * The words for a provider filter whose id the list of providers does not name, from the load of that list: a provider that the
 * committee deleted (its visits stay, and the Home screen links to them) when the list loaded and lacks it, one that cannot be told
 * when the list could not be loaded, and `null` while it is on its way (the select says "loading", the chip only "provider"). The filter
 * stays on, whatever the list says.
 */
function unlistedProvider(providers) {
  if (providers.status === 'error') return 'נותן שירות שאינו ברשימה'
  return providers.data ? 'נותן שירות שנמחק' : null
}

/**
 * Puts the plain `#history` where the link's address was. `replaceState`, not `location.hash`: the screen does not change, so no
 * `hashchange` is wanted, and the entry of the link in the history becomes the plain address (a reload or the forward button then opens
 * the screen with its defaults, as a link is a one-time instruction, not a place to return to). It also lets the same link, clicked again,
 * be a change of the address, which the browser reports and the screen reads. The tab does not change either, so the store of
 * `useTab` (src/admin/tab.js) has nothing to learn.
 */
function tidyAddress() {
  if (hashName() === 'history' && window.location.hash.includes('?')) window.history.replaceState(window.history.state, '', '#history')
}

/**
 * What the filters that differ from the defaults `d` say, for the bar of the phone layout: one chip for each (the dates are not a chip, the
 * bar always shows them) and how many they are, the dates counting once. A filter that has no control now is not counted: the two switches
 * are about scans, so they are left out while the list is the visits that were not counted. A provider filter whose id the list does not
 * name (`providerName` gives nothing) still gets its chip, and the chip says `unlisted` (see `unlistedProvider`).
 */
function activeFilters(f, d, { pointName, providerName, unlisted }) {
  const chips = []
  if (f.point_id !== d.point_id) chips.push({ key: 'point_id', label: 'נקודה', value: pointName(f.point_id) })
  if (f.provider_id !== d.provider_id) {
    const name = providerName(f.provider_id) // undefined when the list does not name it: then the chip says why (`unlisted`) and has no value
    chips.push(name ? { key: 'provider_id', label: 'נותן שירות', value: name } : { key: 'provider_id', label: unlisted })
  }
  if (f.outcome !== d.outcome) chips.push({ key: 'outcome', label: 'סוג', value: typeLabel(f.outcome) })
  if (f.outcome !== NOT_COUNTED) {
    if (f.include_voided !== d.include_voided) chips.push({ key: 'include_voided', label: 'כולל מבוטלות' })
    if (f.include_demo !== d.include_demo) chips.push({ key: 'include_demo', label: 'כולל חשבון דמו' })
  }
  return { chips, count: chips.length + (f.from !== d.from || f.to !== d.to ? 1 : 0) }
}

/** The filters that are set, as the API takes them: nothing empty or off, and only a complete, sensible date. */
function params(f, extra = {}) {
  const out = {}
  for (const [k, v] of Object.entries({ ...f, ...extra })) {
    if (v === '' || v === false || v == null) continue
    if ((k === 'from' || k === 'to') && !goodDate(v)) continue
    out[k] = String(v)
  }
  return out
}
const query = (f, extra) => new URLSearchParams(params(f, extra)).toString()

// The first page of each set of filters is kept for the session (src/admin/loadCache.js), so that coming back to this tab draws it at
// once while the current one is asked for. The key says the kind of list and every filter that is set, so a filter never shows the rows
// of another. Only the first page is kept: "load more" pages are not (they are asked for again when the person wants them).
const CACHE_PREFIX = 'history:'
const cacheKey = (f) => `${CACHE_PREFIX}${f.outcome === NOT_COUNTED ? 'refusals' : 'scans'}:${query(f, { limit: PAGE })}`
/** The first page that this screen showed for these filters before, as the state of the list; `null` when there is none. */
function rememberedList(f) {
  const kept = readLoadCache(cacheKey(f))
  return kept ? { rows: kept.rows, cursor: kept.cursor, status: 'ready', kind: kept.kind } : null
}

/** The refused visits for the same dates, point and provider (the other filters are about scans), one page. */
function refusalsPage(f, extra) {
  const { from, to, point_id, provider_id, limit, cursor } = params(f, extra)
  return scanRefusals({ from, to, point_id, provider_id, limit, cursor })
}

/** One refused visit: read only, so there are no actions on it. The time is the server's; the phone's own clock is added
 * when it tells something (the visit came from the queue, or the phone's minute is not the server's). */
function RefusalRow({ r }) {
  const reason = REFUSAL_REASONS.get(r.code) ?? OTHER_REASON
  const source = REFUSAL_SOURCES.get(r.source)
  const onPhone = r.client_time && (r.source === SOURCE_OFFLINE_SYNC || formatDateTime(r.client_time) !== formatDateTime(r.at))
  return (
    <li className="a-scan a-scan--readonly">
      <span className="a-scan__time">{formatTime(r.at)}</span>
      <div className="a-scan__main">
        <div className="a-scan__point">{r.point_name || NO_POINT}</div>
        <div className="a-scan__who">{r.provider_name}</div>
        {onPhone && <div className="a-scan__who">נסרק בטלפון: <span className="a-scan__stamp">{formatDateTime(r.client_time)}</span></div>}
      </div>
      <div className="a-scan__flags">
        <Badge tone={reason.tone}>{reason.label}</Badge>
        {source && <Badge tone={source.tone}>{source.label}</Badge>}
      </div>
    </li>
  )
}

/**
 * What an empty list says. This is the first screen of the app, and a new installation has no points yet: a list of visits that is empty
 * because there is nothing to scan must not tell the person to widen the dates, but to start by adding points. `points` is the load of the
 * points that the filter above already makes (the same request, kept by useLoad). While it is on its way an empty list of visits waits (a
 * spinner), so that the wrong message never shows for a moment; when it cannot be loaded, the list says what it always said.
 */
function EmptyHistory({ refusals, points }) {
  if (refusals) return <EmptyState icon={IconList} title="אין ביקורים שלא נקלטו בטווח הזה">נסו להרחיב את טווח התאריכים או לשנות את הסינון.</EmptyState>
  if (!points.data && points.status === 'loading') return <Spinner />
  if (points.data?.points.length === 0) {
    return (
      <EmptyState icon={IconPin} title="עוד אין נקודות"
        action={<button className="w-btn w-btn--small" onClick={() => goToTab('points')}>מעבר לנקודות</button>}>
        הנוכחויות מופיעות כאן אחרי שנותני שירות סורקים שלט QR. מתחילים בהוספת נקודה לכל מקום שצריך לבדוק בו נוכחות.
      </EmptyState>
    )
  }
  return <EmptyState icon={IconList} title="אין נוכחויות בטווח הזה">נסו להרחיב את טווח התאריכים או לשנות את הסינון.</EmptyState>
}

function VoidDialog({ scan, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, run] = useAction(toast, errorText)
  const dirty = useDirty(reason)
  const submit = async (e) => {
    e.preventDefault()
    const res = await run(() => adminApi(`/scans/${scan.id}/void`, { method: 'POST', body: { reason } }), 'הנוכחות בוטלה')
    if (res) onDone(res.scan)
  }
  return (
    <Modal title="ביטול נוכחות" onClose={onClose} dirty={dirty} busy={busy} size="sm"
      footer={(
        <>
          <button type="button" className="w-btn w-btn--quiet w-btn--small" onClick={onClose} disabled={busy}>חזרה</button>
          <button type="submit" form="void-form" className="w-btn w-btn--danger w-btn--small" disabled={busy}>{busy ? 'מבטל…' : 'ביטול הנוכחות'}</button>
        </>
      )}>
      <p className="w-lead">{scan.point_name} · {scan.provider_name} · {formatDateTime(scan.checked_in_at)}</p>
      <form id="void-form" className="a-form" onSubmit={submit}>
        <Field label="סיבה (לא חובה)" hint="הרשומה לא נמחקת: היא נשארת בהיסטוריה מסומנת כמבוטלת ואפשר לשחזר אותה.">
          <textarea className="a-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={VOID_REASON_MAX_LENGTH} placeholder="לדוגמה: נסרק בטעות" />
        </Field>
      </form>
    </Modal>
  )
}

/**
 * The controls of the filters, drawn once: inline above the list on a computer, in the sheet on a phone. `values` and `set` are the
 * filters they edit, `errors` and `onPending` are for the date fields (see `DateRangeFields`). The two switches are about scans, so they
 * go while the type is the visits that were not counted.
 */
function HistoryControls({ values, set, errors, onPending, points, providers }) {
  // A provider filter on an id that the list does not name (a deleted provider's visits, a list that did not load) has an option of its
  // own, so that the select says that a filter is on instead of showing "everyone". It goes when another choice is made.
  const providerList = providers.data?.providers ?? []
  const unlisted = values.provider_id !== '' && !providerList.some((p) => p.id === values.provider_id)
  return (
    <>
      <DateRangeFields from={values.from} to={values.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} onPending={onPending} errors={errors} />
      <Field label="נקודה">
        <select className="a-input" value={values.point_id} onChange={(e) => set('point_id', e.target.value)}>
          <option value="">כל הנקודות</option>
          {(points.data?.points ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="נותן שירות">
        <select className="a-input" value={values.provider_id} onChange={(e) => set('provider_id', e.target.value)}>
          <option value="">כולם</option>
          {unlisted && <option value={values.provider_id}>{unlistedProvider(providers) ?? 'טוען…'}</option>}
          {providerList.map((p) => <option key={p.id} value={p.id}>{p.contact_name || p.company}</option>)}
        </select>
      </Field>
      <Field label="סוג">
        <select className="a-input" value={values.outcome} onChange={(e) => set('outcome', e.target.value)}>
          {TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>
      {values.outcome !== NOT_COUNTED && (
        <div className="a-stack" style={{ gap: 0 }}>
          <Switch checked={values.include_voided} onChange={(v) => set('include_voided', v)} label="כולל מבוטלות" />
          <Switch checked={values.include_demo} onChange={(v) => set('include_demo', v)} label="כולל חשבון דמו" />
        </div>
      )}
    </>
  )
}

export default function HistoryView() {
  const toast = useToast()
  // A date field that is half typed shows something other than what is queried (the last good date). The list may stay, but the export
  // must not quietly use a range that differs from the fields, so it waits until both are finished. (Only the computer's inline fields tell
  // it: the sheet of the phone applies nothing while a date is unfinished.) The same state holds the layout: a date that is half typed lives
  // in the text of its field, which the phone's layout would unmount, so below 1024 px the computer's layout stays until it is finished.
  const [unfinished, onPending] = useUnfinishedDates()
  const phone = usePhoneLayout({ hold: unfinished.from || unfinished.to })
  const [filtersRef, returnFocus] = useFilterFocus() // the focus has somewhere to go when the sheet closes after the layout changed
  const points = useLoad(() => adminApi('/points'), [], { cacheKey: LOAD_KEY.points })
  const providers = useLoad(() => adminApi('/providers'), [], { cacheKey: LOAD_KEY.providers })
  const [defaults] = useState(DEFAULTS) // what "reset" and the count of the filters that are on are measured against
  // The link that opened the screen (see `readLink`), or null. Its filters are the first ones, in the first render: they are the filters
  // and the applied ones at once, so there is no pause for typing to wait for and no list of the defaults before them.
  const [link] = useState(readLink)
  const [first] = useState(() => (link ? linkedFilters(link, defaults) : defaults))
  // On a computer the filters are what the inputs show and the list follows them after a short pause in typing; on a phone they are
  // chosen in a sheet and applied together, so there the two are always the same (`apply`).
  const [filters, setFilters, applied, setApplied] = useFilterState(first, phone) // what the inputs show, and what is actually queried
  const [sheet, setSheet] = useState(false) // the sheet of filters is open (the phone's, which stays open if the window grows past 1024 px)
  const [round, setRound] = useState(0) // a link draws the inline fields again, so that a date half typed in one goes
  // `kind` says which list the rows are (scans or refusals), set when they arrive: the filter can already say another one
  // while the pause before a query runs, and rows are never drawn as the wrong kind.
  // The list starts with the page that was kept for the first filters, if there is one (the tab was open before in this session).
  const [{ rows, cursor, status, kind }, setList] = useState(() => rememberedList(filters) ?? { rows: [], cursor: null, status: 'loading', kind: 'scans' })
  const [voiding, setVoiding] = useState(null)
  const confirm = useConfirm()
  const [busy, run] = useAction(toast, errorText)
  const seq = useRef(0) // numbers the queries: an answer to an older one is ignored

  // Asks for the first page of the applied filters. `shown` is the page that was kept for them (see `rememberedList`): it stays on
  // screen while the answer comes, and if the request fails it stays. Without it the list starts from the loading state and a failure
  // empties it.
  const fetchFirstPage = useCallback(async (shown) => {
    const mine = ++seq.current
    const refused = applied.outcome === NOT_COUNTED
    const kind = refused ? 'refusals' : 'scans'
    const key = cacheKey(applied)
    const asked = loadCacheEpoch()
    setList(shown ?? { rows: [], cursor: null, status: 'loading', kind }) // never show the old filter's rows under the new one
    try {
      const res = refused ? await refusalsPage(applied, { limit: PAGE }) : await adminApi(`/scans?${query(applied, { limit: PAGE })}`)
      const page = { rows: refused ? res.refusals : res.scans, cursor: res.next_cursor, kind }
      writeLoadCache(key, page, asked) // for these filters, whatever the screen is doing by now
      if (mine !== seq.current) return
      setList({ ...page, status: 'ready' })
      if (shown) seq.current += 1 // a "load more" that was asked for the page above belongs to a list that has just been replaced
    } catch (err) {
      if (mine !== seq.current) return
      if (!shown) setList({ rows: [], cursor: null, status: 'error', kind })
      toast.error(errorText(err))
    }
  }, [applied, toast])
  const load = useCallback(() => fetchFirstPage(null), [fetchFirstPage]) // the refresh button and "try again": from the loading state, as ever
  useEffect(() => { fetchFirstPage(rememberedList(applied)) }, [fetchFirstPage, applied])

  const more = async () => {
    const mine = seq.current
    const refused = kind === 'refusals'
    const res = await run(() => (refused ? refusalsPage(applied, { limit: PAGE, cursor }) : adminApi(`/scans?${query(applied, { limit: PAGE, cursor })}`)))
    if (!res || mine !== seq.current) return // the filters changed meanwhile: this page belongs to an old query
    const page = refused ? res.refusals : res.scans
    setList((s) => {
      const have = new Set(s.rows.map((r) => r.id))
      return { ...s, rows: [...s.rows, ...page.filter((r) => !have.has(r.id))], cursor: res.next_cursor }
    })
  }

  // Update the one row in place instead of reloading: the loaded pages and the scroll position stay.
  const patch = (scan) => {
    dropLoadCache(CACHE_PREFIX) // the pages that were kept show this scan as it was
    setList((s) => ({
      ...s,
      rows: applied.include_voided ? s.rows.map((r) => (r.id === scan.id ? scan : r)) : s.rows.filter((r) => r.id !== scan.id),
    }))
  }
  const restore = async (s) => {
    const res = await run(() => adminApi(`/scans/${s.id}/unvoid`, { method: 'POST', body: {} }), 'הנוכחות שוחזרה')
    if (res) patch(res.scan)
  }
  // For rows that should never have been there (test scans). Gone for good, unlike "cancel", which can be undone.
  const remove = async (s) => {
    const ok = await confirm({
      title: 'למחוק את הנוכחות לצמיתות?',
      body: `${s.point_name} · ${s.provider_name} · ${formatDateTime(s.checked_in_at)}. אי אפשר לשחזר אותה. אם רק רוצים להוציא אותה מהדוחות, אפשר לבטל אותה במקום.`,
      confirmLabel: 'מחיקה', danger: true,
    })
    if (ok && await run(() => adminApi(`/scans/${s.id}`, { method: 'DELETE' }), 'הנוכחות נמחקה')) {
      dropLoadCache(CACHE_PREFIX)
      setList((st) => ({ ...st, rows: st.rows.filter((r) => r.id !== s.id) }))
    }
  }

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  // The phone: the sheet's "show results", and a chip's remove button. Both apply at once, with no pause for typing.
  const apply = (next) => {
    setSheet(false)
    if (sameFilters(next, applied)) return // nothing changed: no new query, no loading state
    setFilters(next)
    setApplied(next)
  }

  // A link followed while the screen is open (the address changes, and the screen is still this one): the same as one that opened it, and
  // the address goes back to the plain `#history`. The latest values are read from a ref, so that the listener is attached once.
  const latest = useRef(null)
  latest.current = { applied, defaults, dateUnfinished: unfinished.from || unfinished.to }
  useEffect(() => {
    const follow = () => {
      const next = readLink()
      if (!next) return // another screen (this one is about to go), or this screen's own address, which has nothing to apply
      const { applied: now, defaults: base, dateUnfinished } = latest.current
      const filtersOfLink = linkedFilters(next, base)
      setSheet(false)
      if (dateUnfinished) setRound((n) => n + 1) // a date half typed in a field would stay there; the fields are drawn again from the filters
      if (sameFilters(filtersOfLink, now)) setFilters(now) // the screen already says it (a pause for typing may be waiting): no new query
      else { setFilters(filtersOfLink); setApplied(filtersOfLink) }
      tidyAddress()
    }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [setFilters, setApplied])
  useEffect(() => { if (link) tidyAddress() }, [link]) // the link that opened the screen has been read: the plain address goes back
  const { chips, count } = activeFilters(applied, defaults, {
    pointName: (id) => (points.data?.points ?? []).find((p) => p.id === id)?.name,
    providerName: (id) => { const p = (providers.data?.providers ?? []).find((x) => x.id === id); return p && (p.contact_name || p.company) },
    unlisted: unlistedProvider(providers) ?? 'נותן שירות', // while the list is on its way the chip only says what it is about
  })
  const refusals = kind === 'refusals'
  const groups = useMemo(() => {
    const out = []
    for (const s of rows) {
      const date = refusals ? isoDay(s.at) : s.local_date // a refusal has no local_date: its building day comes from its time
      const last = out[out.length - 1]
      if (last && last.date === date) last.items.push(s)
      else out.push({ date, items: [s] })
    }
    return out
  }, [rows, refusals])
  // What the filter says now (not what was last loaded): the controls that are about scans leave at once.
  const choseRefusals = filters.outcome === NOT_COUNTED

  return (
    <>
      <div className="a-head">
        <div>
          <h1>היסטוריית נוכחות</h1>
          {choseRefusals
            ? <p>ביקורים שהשרת לא קלט, למשל בגלל נקודה כבויה. הם לא נספרים כנוכחות, והרשימה רק לקריאה.</p>
            : <p>כל הנוכחויות שנרשמו. אפשר לבטל נוכחות ולשחזר אותה, או למחוק שורה לצמיתות.</p>}
        </div>
        <div className="a-actions">
          <IconButton icon={IconRefresh} label="רענון" onClick={load} />
          {/* The file is of scans only: it has no refused visits, so there is nothing to export in this view. */}
          {!choseRefusals && applied.outcome !== NOT_COUNTED && (
            <IconButton icon={IconDownload} label="ייצוא ל-Excel" href={`/api/admin/scans?${query(applied, { format: 'csv' })}`} download="scans.csv" disabled={unfinished.from || unfinished.to} />
          )}
        </div>
      </div>

      {phone ? (
        <FilterBar ref={filtersRef} count={count} from={applied.from} to={applied.to} onOpen={() => setSheet(true)}
          chips={chips.map((chip) => ({ ...chip, onRemove: () => apply({ ...applied, [chip.key]: defaults[chip.key] }) }))} />
      ) : (
        <div className="a-filters" key={round} ref={filtersRef}>
          <HistoryControls values={filters} set={set} onPending={onPending} points={points} providers={providers} />
        </div>
      )}
      {/* Outside the choice of layout, so that a sheet that is open when the window crosses 1024 px stays, with its draft (see filters.jsx). */}
      {sheet && (
        <FilterSheet initial={applied} defaults={defaults} onApply={apply} onClose={() => setSheet(false)} returnFocus={returnFocus}>
          {({ values, set: choose, errors, watch }) => <HistoryControls values={values} set={choose} errors={errors} onPending={watch} points={points} providers={providers} />}
        </FilterSheet>
      )}

      {status === 'loading' && <Spinner />}
      {status === 'error' && (
        <EmptyState icon={IconAlert} title="לא הצלחנו לטעון" action={<button className="w-btn w-btn--small" onClick={load}>נסו שוב</button>} />
      )}
      {status === 'ready' && rows.length === 0 && <EmptyHistory refusals={refusals} points={points} />}

      {groups.map((g) => (
        <section key={g.date} aria-label={dayLabel(g.date)}>
          <h2 className="a-day">{dayLabel(g.date)} · {g.items.length}</h2>
          <ul className="a-scans">
            {refusals ? g.items.map((r) => <RefusalRow key={r.id} r={r} />) : g.items.map((s) => (
              <li key={s.id} className={`a-scan${s.voided ? ' is-void' : ''}`}>
                <span className="a-scan__time">{formatTime(s.checked_in_at)}</span>
                <div className="a-scan__main">
                  <div className="a-scan__point">{s.point_name}</div>
                  <div className="a-scan__who">{s.provider_name}</div>
                </div>
                <div className="a-scan__flags">
                  {s.outcome !== OUTCOME_ACCEPTED && <Badge tone="danger">{OUTCOMES[s.outcome] ?? s.outcome}</Badge>}
                  {s.voided && <Badge tone="danger">מבוטלת{s.void_reason ? `: ${s.void_reason}` : ''}</Badge>}
                  {s.distance_m != null && <Badge>{s.distance_m} מ׳ מהנקודה{s.gps_accuracy_m != null && `, דיוק ${s.gps_accuracy_m} מ׳`}</Badge>}
                  {s.flags.map((f) => <Badge key={f} tone={FLAGS[f]?.tone}>{FLAGS[f]?.label ?? f}</Badge>)}
                </div>
                <div className="a-scan__tools">
                  {s.outcome === OUTCOME_ACCEPTED && (s.voided
                    ? <IconButton icon={IconUndo} label="שחזור הנוכחות" onClick={() => restore(s)} disabled={busy} />
                    : <IconButton icon={IconBan} label="ביטול הנוכחות" onClick={() => setVoiding(s)} />)}
                  <IconButton icon={IconTrash} label="מחיקת הנוכחות לצמיתות" tone="danger" onClick={() => remove(s)} disabled={busy} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {cursor && status === 'ready' && (
        <div style={{ display: 'grid', placeItems: 'center', marginBlockStart: 'var(--w-space-4-5)' }}>
          <button className="w-btn w-btn--ghost w-btn--small" onClick={more} disabled={busy}>{busy ? 'טוען…' : 'טעינת עוד'}</button>
        </div>
      )}

      {voiding && <VoidDialog scan={voiding} onClose={() => setVoiding(null)} onDone={(scan) => { setVoiding(null); patch(scan) }} />}
    </>
  )
}
