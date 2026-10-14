import { useEffect, useId, useRef, useState } from 'react'
import { adminApi } from '../api.js'
import { useLoad, LOAD_KEY } from '../hooks.js'
import { Badge, EmptyState, Spinner } from '../ui.jsx'
import { IconAlert, IconChevron, IconHome } from '../icons.jsx'
import { goToTab } from '../tab.js'
import { buildingHour, formatDay, formatDayShort, isoDay } from '../../../shared/datetime.js'

// The Home screen: a greeting and the date, a summary card with the visits of the last seven days (the total, and a bar for each day), the
// service providers of those days (a dot for each day, and the total), a tile for each number that has a screen, and a short list of two
// more. The app records facts and does not analyse them (AGENTS.md), so this screen shows counts and nothing else: no trend, no average,
// no "more than last week", no score, and the providers stay in the order of the Providers screen (never ranked by their counts). Every
// number is one that another screen shows already, and a number that opens a screen is the number that screen shows when it opens
// (GET /api/admin/home, server/home.js).

// The greeting by the hour of the building's clock (buildingHour, shared/datetime.js): 05:00 to 11:59 the morning, 12:00 to 16:59 the
// noon, and 17:00 to 04:59 the evening.
const GREETING_MORNING = 'בוקר טוב'
const GREETING_NOON = 'צהריים טובים'
const GREETING_EVENING = 'ערב טוב'
const greetingOf = (hour) => (hour >= 5 && hour < 12 ? GREETING_MORNING : hour >= 12 && hour < 17 ? GREETING_NOON : GREETING_EVENING)

/** The first word of the member's name as it was saved, or '' when there is none. */
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]

// How often the screen looks at the clock again, so that a screen that stays open (an app left on a phone) does not keep a greeting, a
// date or a "today" that the clock has left behind.
const CLOCK_CHECK_MS = 60_000

/** The address of the History screen with filters set (`readLink` in HistoryView.jsx): only the filters that are given. */
const historyLink = (filters) => `#history?${new URLSearchParams(filters)}`

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0)

/** The word after a number of visits: 1 ביקור, 2 ביקורים, 0 ביקורים. */
const visitsWord = (count) => (count === 1 ? 'ביקור' : 'ביקורים')

/** A number of visits in a line of text. */
const visitsText = (count) => (count === 1 ? 'ביקור אחד' : `${count} ביקורים`)

/** A day written DD/MM, and allowed to break after its slash when its column is too narrow for it (a 320px phone): `08/` over `10`. */
function ShortDay({ day }) {
  const [dd, mm] = formatDayShort(day).split('/')
  return mm === undefined ? dd : <>{dd}/<wbr />{mm}</>
}

/**
 * One day of the summary card: the number of visits above a bar whose height is that number (a fixed scale from the busiest day of the table,
 * so the heights are a drawing of the numbers and the number is always written). A day with visits is a link to the History of that day,
 * named by its date and its count; a day with none is the number 0 and a short bar, and is not a link (there is nothing to open).
 */
function Bar({ day, count, tallest, now }) {
  const body = (
    <>
      <span className="a-bar__n">{count}</span>
      <span className="a-bar__fill" style={{ '--bar': tallest > 0 ? count / tallest : 0 }} />
    </>
  )
  const className = `a-bar${now ? ' is-today' : ''}`
  if (count === 0) return <span className={`${className} is-none`}>{body}</span>
  return (
    <a className={className} href={historyLink({ from: day, to: day })} aria-label={`${formatDay(day)}: ${count} ${visitsWord(count)}`}
      aria-current={now ? 'date' : undefined}>
      {body}
    </a>
  )
}

/**
 * The summary card: the visits of the seven days. The days are a table with one row of bars, in the order the server gives them (the oldest
 * first); the page is right to left, so the oldest is at the right and today at the left, and the data is never reversed.
 *
 * The dates. The heads write each day as DD/MM (`formatDayShort`), which is allowed only because the whole range stands in DD/MM/YYYY right
 * above the table, the element just before it with nothing between them (so the order of the card is the title, the total, the range, the
 * bars), which is also the name of the table, and each head carries its full date for a screen reader
 * (AGENTS.md, owner decision of 12/10/2026): the visible DD/MM is `aria-hidden` and the head is named by a visually hidden DD/MM/YYYY
 * (`formatDay`), so that the name of a head is its full date in every screen reader, whatever the reader does with the `aria-label` of a
 * table header. The heads are first in the markup, where a reader looks for them, and drawn under the bars (`.a-bars thead`).
 * Today's head and bar carry `aria-current="date"`.
 */
function Summary({ days, totals, today }) {
  const titleId = useId()
  const rangeId = useId()
  const total = sum(totals)
  const tallest = Math.max(...totals)
  return (
    <section className="a-hero" aria-labelledby={titleId}>
      <h2 id={titleId}>השבוע בבניין</h2>
      <p className="a-hero__total"><span className="a-hero__num">{total}</span>{' '}{visitsWord(total)}</p>
      <p className="a-hero__range" id={rangeId}><span className="a-stamp">{formatDay(days[0])}</span> עד <span className="a-stamp">{formatDay(days[days.length - 1])}</span></p>
      <table className="a-bars" aria-labelledby={rangeId}>
        <thead>
          <tr>
            {days.map((day) => (
              <th scope="col" className="a-bars__head" key={day} aria-current={day === today ? 'date' : undefined}>
                <span className="a-stamp" aria-hidden="true"><ShortDay day={day} /></span>
                <span className="w-sr">{formatDay(day)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {days.map((day, i) => (
              <td className="a-bars__cell" key={day}><Bar day={day} count={totals[i]} tallest={tallest} now={day === today} /></td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

// The round mark before a provider's name: its first letter on one of the four tints (by its id, so that it stays the same), or on the grey of
// something that is off. Decoration only: the name is written beside it.
const TONES = ['violet', 'mint', 'peach', 'sky']
const toneOf = (id) => TONES[Array.from(String(id)).reduce((n, ch) => n + ch.charCodeAt(0), 0) % TONES.length]
const initialOf = (name) => Array.from(String(name ?? '').trim())[0] ?? ''

/**
 * A provider of the week: the whole row is a link to the History of that provider for the seven days, which shows exactly the visits that
 * the total counts. A dot for each day, in the order of the bars: a filled dot for a day with a visit, an empty ring for a day without one,
 * so that colour is not the only carrier. The dots are one picture for a reader, named by the days that have a visit; the total is written
 * beside them. The name, the company (when the name is a contact's), and a badge for a provider that is off or was deleted are the ones
 * of the Providers screen and the History.
 */
function ProviderRow({ provider: p, days, today }) {
  const total = sum(p.counts)
  const visited = days.filter((_, i) => p.counts[i] > 0)
  const off = p.company === null || !p.is_active
  return (
    <li>
      <a className="a-prov__row" href={historyLink({ provider: p.id, from: days[0], to: days[days.length - 1] })}>
        <span className={`a-prov__avatar a-prov__avatar--${off ? 'off' : toneOf(p.id)}`} aria-hidden="true">{initialOf(p.name)}</span>
        <span className="a-prov__main">
          <span className="a-prov__line">
            <span className="a-prov__name" dir="auto">{p.name}</span>
            {p.company === null ? <Badge>נותן שירות שנמחק</Badge> : !p.is_active && <Badge>מושבת</Badge>}
          </span>
          {p.company && p.company !== p.name && <span className="a-prov__company" dir="auto">{p.company}</span>}
          <span className="a-dots" role="img" aria-label={visited.length > 0 ? `ביקורים ב-${visited.map((day) => formatDay(day)).join(', ')}` : 'אין ביקורים'}>
            {days.map((day, i) => <span key={day} className={`a-dot${p.counts[i] > 0 ? ' is-on' : ''}${day === today ? ' is-today' : ''}`} />)}
          </span>
        </span>
        <span className="a-prov__total"><span className="a-prov__num">{total}</span><span className="a-prov__unit">{visitsWord(total)}</span></span>
      </a>
    </li>
  )
}

function Providers({ days, providers, today }) {
  const titleId = useId()
  if (providers.length === 0) return null
  return (
    <section className="a-prov" aria-labelledby={titleId}>
      <div className="a-prov__head">
        <h2 id={titleId}>נותני שירות השבוע</h2>
        <a className="a-prov__all" href={historyLink({ from: days[0], to: days[days.length - 1] })}>לכל ההיסטוריה</a>
      </div>
      <ul className="a-prov__list">
        {providers.map((p) => <ProviderRow key={p.id} provider={p} days={days} today={today} />)}
      </ul>
    </section>
  )
}

/** A tile with one number: the whole tile is a link to the screen that shows it. The words are the screen's own (C1, docs/design.md). */
function Tile({ tone, href, value, label, note }) {
  return (
    <a className={`a-tile a-tile--${tone}`} href={href}>
      <span className="a-tile__value">{value}</span>
      <span className="a-tile__label">{label}</span>
      {note && <span className="a-tile__note">{note}</span>}
    </a>
  )
}

function Tiles({ days, counts }) {
  const { points, providers, visits_not_counted: notCounted, waiting } = counts
  return (
    <div className="a-tiles">
      <Tile tone="violet" href="#providers" value={providers.active} label="נותני שירות פעילים" note={`מתוך ${providers.total}`} />
      <Tile tone="plain" href="#points" value={points.active} label="נקודות פעילות" note={`מתוך ${points.total}`} />
      <Tile tone="peach" href={historyLink({ outcome: 'not_counted', from: days[0], to: days[days.length - 1] })} value={notCounted} label="ביקורים שלא נקלטו ב-7 הימים" />
      {waiting.phones > 0 && (
        <Tile tone="sky" href="#providers" value={waiting.phones} label="טלפונים עם ביקורים שממתינים לשליחה" note={`${visitsText(waiting.visits)} בסך הכול`} />
      )}
    </div>
  )
}

/** The two numbers that have no tile: the committee's members and the agent's keys, each a row that opens its screen. */
function Shortcuts({ counts }) {
  return (
    <ul className="a-links">
      <li><a className="a-links__row" href="#settings"><span className="a-links__label">חברי הוועד</span><span className="a-links__n">{counts.committee_members.active}</span><IconChevron className="w-flip" size={18} /></a></li>
      <li><a className="a-links__row" href="#agent"><span className="a-links__label">מפתחות אייג'נט פעילים</span><span className="a-links__n">{counts.agent_keys.active}</span><IconChevron className="w-flip" size={18} /></a></li>
    </ul>
  )
}

/** A building with nothing in it yet: the first step is a point and a service provider. */
function GettingStarted() {
  return (
    <EmptyState icon={IconHome} title="עוד אין נקודות ונותני שירות"
      action={(
        <div className="a-actions">
          <button className="w-btn w-btn--small" onClick={() => goToTab('points')}>הוסיפו נקודה</button>
          <button className="w-btn w-btn--small" onClick={() => goToTab('providers')}>הוסיפו נותן שירות</button>
        </div>
      )}>
      התחילו בנקודה שבה נותן השירות סורק QR, ובנותן שירות שיסרוק אותה.
    </EmptyState>
  )
}

export default function HomeView({ admin }) {
  const home = useLoad(() => adminApi('/home'), [], { cacheKey: LOAD_KEY.home })
  const { data, reload } = home
  const [hour, setHour] = useState(() => buildingHour())
  const [today, setToday] = useState(() => isoDay())

  // A screen that stays open looks at the clock once a minute: the greeting and the date follow it, and when the building's day has moved on
  // from the last column, the numbers are asked for again, so that "today" is today.
  const shownToday = useRef(null)
  shownToday.current = data ? data.days[data.days.length - 1] : null
  useEffect(() => {
    const timer = setInterval(() => {
      setHour(buildingHour())
      setToday(isoDay())
      if (shownToday.current && shownToday.current !== isoDay()) reload()
    }, CLOCK_CHECK_MS)
    return () => clearInterval(timer)
  }, [reload])

  const name = firstName(admin?.name)
  const empty = data && data.counts.points.total === 0 && data.counts.providers.total === 0 && data.week.providers.length === 0

  return (
    <>
      <div className="a-head">
        <div>
          <h1>{greetingOf(hour)}{name && <>, <bdi>{name}</bdi></>}</h1>
          <p><span className="a-stamp">{formatDay(today)}</span></p>
        </div>
      </div>

      {home.status === 'loading' && <Spinner />}
      {home.status === 'error' && !data && (
        <EmptyState icon={IconAlert} title="לא הצלחנו לטעון" action={<button className="w-btn w-btn--small" onClick={reload}>נסו שוב</button>} />
      )}
      {empty && <GettingStarted />}
      {data && !empty && (
        <div className="a-home">
          <Summary days={data.days} totals={data.week.totals} today={today} />
          <Providers days={data.days} providers={data.week.providers} today={today} />
          <Tiles days={data.days} counts={data.counts} />
          <Shortcuts counts={data.counts} />
        </div>
      )}
    </>
  )
}
