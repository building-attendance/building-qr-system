import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, auditLog, errorText } from '../api.js'
import { useLoad, usePhoneLayout, LOAD_KEY } from '../hooks.js'
import { loadCacheEpoch, readLoadCache, writeLoadCache } from '../loadCache.js'
import { Field, EmptyState, Spinner, IconButton, useToast, useAction } from '../ui.jsx'
import Email, { isEmailAddress } from '../Email.jsx'
import { DateRangeFields, FilterBar, FilterSheet, goodDate, sameFilters, useFilterFocus, useFilterState, useUnfinishedDates } from '../filters.jsx'
import { IconClock, IconRefresh, IconAlert } from '../icons.jsx'
import { formatDay, formatTime, isoDay } from '../../../shared/datetime.js'
import { DELETED_ACTOR_MARK, GROUP_OPTIONS } from '../auditLabels.js'
import { describeEntry, actorText } from '../auditDescribe.js'

// The audit log: what the committee's members (and the system) did, and when (ADR 0007, decision 4). Read only, so a row has no
// actions and there is no file to export: it answers "who switched this point off?" and "who removed this member?".
// Built like the history screen: filters that query after a short pause, rows grouped by building day, and a page at a time.
//
// It is a screen of its own ("יומן פעולות", under "עוד" on a phone): the <h1>, the filters, and the days as <h2>. It used to be a section
// at the foot of the Committee screen that a button opened; that screen was split into the settings, the audit log and the guide.

const PAGE = 50
const EMPTY_FILTERS = { from: '', to: '', group: '', actor_id: '' }

/** The filters that are set, as the API takes them: nothing empty, and only a complete, sensible date. */
function params(filters) {
  const out = {}
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue
    if ((key === 'from' || key === 'to') && !goodDate(value)) continue
    out[key] = value
  }
  return out
}

// The first page of each set of filters is kept for the session (src/admin/loadCache.js), so that opening the log again draws it at once
// while the current one is asked for. The key is every filter that is set, so a filter never shows the entries of another. Only the first
// page is kept: "load more" pages are not.
const cacheKey = (filters) => `audit:${new URLSearchParams({ ...params(filters), limit: String(PAGE) }).toString()}`
/** The first page that this screen showed for these filters before, as the state of the list; `null` when there is none. */
function rememberedList(filters) {
  const kept = readLoadCache(cacheKey(filters))
  return kept ? { entries: kept.entries, cursor: kept.cursor, status: 'ready' } : null
}

/** One line of detail. The values are bidi-isolated: a name or a number inside Hebrew keeps its own direction. */
function Line({ line }) {
  if (line.kind === 'text') return <div>{line.text}</div>
  if (line.kind === 'field') return <div>{line.label}: {line.email ? <Email address={line.value} /> : <bdi>{line.value}</bdi>}</div>
  return (
    <div>
      {line.label}: <bdi>{line.from}</bdi> <span className="a-audit__arrow" role="img" aria-label="הפך ל">←</span> <bdi>{line.to}</bdi>
    </div>
  )
}

/**
 * Who did it, in a clamped box of its own (stops at two lines) that takes the direction of its own text, so that its ellipsis lands at the end
 * of the name (`.a-clamp-2`). A member who has no saved name is named by the e-mail address (the audit contract), and an address is drawn
 * by `Email`, so that it breaks only after "@" and dots like every other address of the committee app, in a left-to-right box; the mark of
 * a member who is gone ("(נמחק)") then stands beside it, outside it. Any other name is one `bdi`, the box itself, with its mark, as
 * `actorText` writes it.
 * @param {{ actor: { name: string, deleted: boolean } }} props
 */
function Actor({ actor }) {
  if (!isEmailAddress(actor.name)) return <bdi className="a-clamp-2">{actorText(actor)}</bdi>
  return <span className="a-clamp-2" dir="ltr"><Email address={actor.name} />{actor.deleted && <> <bdi>{DELETED_ACTOR_MARK}</bdi></>}</span>
}

/** One entry: read only. The time, what was done and about what, who did it, and the detail. Everything is text. */
function EntryRow({ entry }) {
  const { phrase, subject, actor, lines } = describeEntry(entry)
  return (
    <li className="a-audit">
      <span className="a-scan__time a-audit__time">{formatTime(entry.at)}</span>
      <div className="a-audit__what">
        {phrase.known
          ? <span className="a-audit__action">{phrase.text}</span>
          : <span className="a-audit__action a-audit__action--raw" dir="ltr">{phrase.text}</span>}
        {subject && <> <span aria-hidden="true">·</span> <bdi className="a-audit__subject a-clamp-2" dir={isEmailAddress(subject) ? 'ltr' : undefined}>{isEmailAddress(subject) ? <Email address={subject} /> : subject}</bdi></>}
      </div>
      <div className="a-audit__who"><span className="a-audit__by">על ידי</span>{' '}<Actor actor={actor} /></div>
      {lines.length > 0 && (
        <div className="a-audit__detail">
          {lines.map((line, i) => <Line key={i} line={line} />)}
        </div>
      )}
    </li>
  )
}

/**
 * What the filters that are on say, for the bar of the phone layout: one chip for each of the two selects (the dates are not a chip, the bar
 * always shows them) and how many are on, the dates counting once. Every filter is off at first, so the defaults are `EMPTY_FILTERS`.
 */
function activeFilters(f, { memberName }) {
  const chips = []
  if (f.group) chips.push({ key: 'group', label: 'סוג פעולה', value: GROUP_OPTIONS.find((g) => g.value === f.group)?.label })
  if (f.actor_id) chips.push({ key: 'actor_id', label: 'מנהל מערכת', value: memberName(f.actor_id) })
  return { chips, count: chips.length + (f.from || f.to ? 1 : 0) }
}

/** The controls of the filters, drawn once: inline above the list on a computer, in the sheet on a phone (see HistoryView.jsx). */
function AuditControls({ values, set, errors, onPending, members }) {
  return (
    <>
      <DateRangeFields from={values.from} to={values.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} onPending={onPending} errors={errors} />
      <Field label="סוג פעולה">
        <select className="a-input" value={values.group} onChange={(e) => set('group', e.target.value)}>
          {GROUP_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </Field>
      <Field label="מנהל מערכת">
        <select className="a-input" value={values.actor_id} onChange={(e) => set('actor_id', e.target.value)}>
          <option value="">כל המנהלים</option>
          {(members.data?.admins ?? []).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
        </select>
      </Field>
    </>
  )
}

export default function AuditView() {
  const toast = useToast()
  // A date that is half typed in the inline fields (on a computer) lives in the text of its field, which the phone's layout would unmount,
  // so below 1024 px the computer's layout stays until it is finished or cleared (see filters.jsx).
  const [unfinished, onPending] = useUnfinishedDates()
  const phone = usePhoneLayout({ hold: unfinished.from || unfinished.to })
  const [filtersRef, returnFocus] = useFilterFocus() // the focus has somewhere to go when the sheet closes after the layout changed
  const members = useLoad(() => adminApi('/admins'), [], { cacheKey: LOAD_KEY.admins }) // the same list as the settings
  // On a computer the filters are what the inputs show and the log follows them after a short pause in typing; on a phone they are chosen
  // in a sheet and applied together, so there the two are always the same (`apply`).
  const [filters, setFilters, applied, setApplied] = useFilterState(EMPTY_FILTERS, phone) // what the inputs show, and what is actually queried
  const [sheet, setSheet] = useState(false) // the sheet of filters is open (the phone's, which stays open if the window grows past 1024 px)
  // The list starts with the page that was kept for the first filters, if there is one (the log was open before in this session).
  const [{ entries, cursor, status }, setList] = useState(() => rememberedList(filters) ?? { entries: [], cursor: null, status: 'loading' })
  const [busy, run] = useAction(toast, errorText)
  const seq = useRef(0) // numbers the queries: an answer to an older one is ignored

  // Asks for the first page of the applied filters. `shown` is the page that was kept for them (see `rememberedList`): it stays on
  // screen while the answer comes, and if the request fails it stays. Without it the list starts from the loading state and a failure
  // empties it.
  const fetchFirstPage = useCallback(async (shown) => {
    const mine = ++seq.current
    const key = cacheKey(applied)
    const asked = loadCacheEpoch()
    setList(shown ?? { entries: [], cursor: null, status: 'loading' }) // never show the old filter's rows under the new one
    try {
      const res = await auditLog({ ...params(applied), limit: PAGE })
      const page = { entries: res.entries, cursor: res.next_cursor }
      writeLoadCache(key, page, asked) // for these filters, whatever the screen is doing by now
      if (mine !== seq.current) return
      setList({ ...page, status: 'ready' })
      if (shown) seq.current += 1 // a "load more" that was asked for the page above belongs to a list that has just been replaced
    } catch (err) {
      if (mine !== seq.current) return
      if (!shown) setList({ entries: [], cursor: null, status: 'error' })
      toast.error(errorText(err))
    }
  }, [applied, toast])
  const load = useCallback(() => fetchFirstPage(null), [fetchFirstPage]) // the refresh button and "try again": from the loading state, as ever
  useEffect(() => { fetchFirstPage(rememberedList(applied)) }, [fetchFirstPage, applied])

  const more = async () => {
    const mine = seq.current
    const res = await run(() => auditLog({ ...params(applied), limit: PAGE, cursor }))
    if (!res || mine !== seq.current) return // the filters changed meanwhile: this page belongs to an old query
    setList((s) => {
      const have = new Set(s.entries.map((e) => e.id))
      return { ...s, entries: [...s.entries, ...res.entries.filter((e) => !have.has(e.id))], cursor: res.next_cursor }
    })
  }

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  // The phone: the sheet's "show results", and a chip's remove button. Both apply at once, with no pause for typing.
  const apply = (next) => {
    setSheet(false)
    if (sameFilters(next, applied)) return // nothing changed: no new query, no loading state
    setFilters(next)
    setApplied(next)
  }
  const { chips, count } = activeFilters(applied, {
    memberName: (id) => { const a = (members.data?.admins ?? []).find((x) => x.id === id); return a && (a.name || a.email) },
  })
  const filtered = Object.keys(params(applied)).length > 0

  // Rows of one building day sit together under the date, newest day first (the API's order).
  const days = useMemo(() => {
    const out = []
    for (const entry of entries) {
      const date = isoDay(entry.at)
      const last = out[out.length - 1]
      if (last && last.date === date) last.items.push(entry)
      else out.push({ date, items: [entry] })
    }
    return out
  }, [entries])

  return (
    <>
      <div className="a-head">
        <div>
          <h1>יומן פעולות</h1>
          <p>מי עשה מה ומתי: שינויים של מנהלי המערכת ופעולות אוטומטיות של המערכת. הרשימה לקריאה בלבד.</p>
        </div>
        <div className="a-actions">
          <IconButton icon={IconRefresh} label="רענון היומן" onClick={load} />
        </div>
      </div>

      {phone ? (
        <FilterBar ref={filtersRef} count={count} from={applied.from} to={applied.to} onOpen={() => setSheet(true)}
          chips={chips.map((chip) => ({ ...chip, onRemove: () => apply({ ...applied, [chip.key]: EMPTY_FILTERS[chip.key] }) }))} />
      ) : (
        <div className="a-filters" ref={filtersRef}>
          <AuditControls values={filters} set={set} onPending={onPending} members={members} />
        </div>
      )}
      {/* Outside the choice of layout, so that a sheet that is open when the window crosses 1024 px stays, with its draft (see filters.jsx). */}
      {sheet && (
        <FilterSheet initial={applied} defaults={EMPTY_FILTERS} onApply={apply} onClose={() => setSheet(false)} returnFocus={returnFocus}>
          {({ values, set: choose, errors, watch }) => <AuditControls values={values} set={choose} errors={errors} onPending={watch} members={members} />}
        </FilterSheet>
      )}

      {status === 'loading' && <Spinner />}
      {status === 'error' && (
        <EmptyState icon={IconAlert} title="לא הצלחנו לטעון" action={<button className="w-btn w-btn--small" onClick={load}>נסו שוב</button>} />
      )}
      {status === 'ready' && entries.length === 0 && (filtered
        ? <EmptyState icon={IconClock} title="אין פעולות בטווח הזה">נסו להרחיב את טווח התאריכים או לשנות את הסינון.</EmptyState>
        : <EmptyState icon={IconClock} title="עוד לא נרשמו פעולות">פעולות של מנהלי המערכת יופיעו כאן.</EmptyState>)}

      {days.map((day) => (
        <section key={day.date} aria-label={formatDay(day.date)}>
          <h2 className="a-day">{formatDay(day.date)} · {day.items.length}</h2>
          <ul className="a-scans">
            {day.items.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
          </ul>
        </section>
      ))}

      {cursor && status === 'ready' && (
        <div style={{ display: 'grid', placeItems: 'center', marginBlockStart: 'var(--w-space-4-5)' }}>
          <button className="w-btn w-btn--quiet w-btn--small" onClick={more} disabled={busy}>{busy ? 'טוען…' : 'טעינת עוד'}</button>
        </div>
      )}
    </>
  )
}
