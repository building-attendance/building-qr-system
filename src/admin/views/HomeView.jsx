import { useEffect, useId, useRef, useState } from 'react'
import { adminApi } from '../api.js'
import { useLoad, LOAD_KEY } from '../hooks.js'
import { Badge, EmptyState, Spinner } from '../ui.jsx'
import { IconAlert, IconHome } from '../icons.jsx'
import { goToTab } from '../tab.js'
import { buildingHour, formatDay, formatDayShort, isoDay } from '../../../shared/datetime.js'

// The Home screen: a greeting, the visits of the last seven days as a table (a row for each service provider, a column for each day), and a
// card for each screen with its number. The app records facts and does not analyse them (AGENTS.md), so this screen shows counts and nothing
// else: no trend, no average, no "more than last week", no score. Every number is one that another screen shows already, and a number that
// opens a screen is the number that screen shows when it opens (GET /api/admin/home, server/home.js).

// The greeting by the hour of the building's clock (buildingHour, shared/datetime.js): 05:00 to 11:59 the morning, 12:00 to 16:59 the
// noon, and 17:00 to 04:59 the evening.
const GREETING_MORNING = 'בוקר טוב'
const GREETING_NOON = 'צהריים טובים'
const GREETING_EVENING = 'ערב טוב'
const greetingOf = (hour) => (hour >= 5 && hour < 12 ? GREETING_MORNING : hour >= 12 && hour < 17 ? GREETING_NOON : GREETING_EVENING)

/** The first word of the member's name as it was saved, or '' when there is none. */
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]

// How often the screen looks at the clock again, so that a screen that stays open (an app left on a phone) does not keep a greeting, or a
// "today", that the clock has left behind.
const CLOCK_CHECK_MS = 60_000

// The number of visits of a cell is written in the cell; its background is one of four steps, so the eye finds the busy days. The steps are
// a fixed scale (1, 2 to 3, 4 to 6, 7 or more), the same for every building and every week, and never a comparison with anything.
const stepOf = (count) => (count >= 7 ? 4 : count >= 4 ? 3 : count >= 2 ? 2 : 1)

/** The address of the History screen with filters set (`readLink` in HistoryView.jsx): only the filters that are given. */
const historyLink = (filters) => `#history?${new URLSearchParams(filters)}`

/** A number of visits in a line of text. */
const visitsText = (count) => (count === 1 ? 'ביקור אחד' : `${count} ביקורים`)

/**
 * One cell: the number of visits, and a link to the History of those visits when there are some. A day with none is an empty cell that
 * reads "0" to a screen reader and is not a link (there is nothing to open).
 */
function Cell({ count, href, total }) {
  return (
    <td className="a-week__cell">
      {count > 0
        ? <a className={`a-count ${total ? 'a-count--total' : `a-count--${stepOf(count)}`}`} href={href}>{count}</a>
        : <span className="w-sr">0</span>}
    </td>
  )
}

/** The row header of a provider: its name (and its company when the name is a contact's), and a badge for one that is off or was deleted. */
function WhoCell({ provider: p }) {
  return (
    <th scope="row" className="a-week__who">
      <span className="a-week__name" dir="auto">{p.name}</span>
      {p.company && p.company !== p.name && <span className="a-week__company" dir="auto">{p.company}</span>}
      {p.company === null ? <Badge>נותן שירות שנמחק</Badge> : !p.is_active && <Badge>מושבת</Badge>}
    </th>
  )
}

/**
 * The visits of the seven days. The columns are the days in the order the server gives them (the oldest first); the page is right to left,
 * so the oldest is at the right and today at the left, and the data is never reversed. A table too wide for the screen scrolls inside its
 * own box (the page never does), which a keyboard can reach, with the provider's name staying in place and the box starting at today.
 *
 * The dates. The heads write each day as DD/MM (`formatDayShort`), which is allowed only because the whole range stands in DD/MM/YYYY right
 * above the table, in its caption, and each head carries its full date for a screen reader (AGENTS.md, owner decision of 12/10/2026): the
 * visible DD/MM is `aria-hidden` and the head is named by a visually hidden DD/MM/YYYY (`formatDay`), so that the name of a head is its
 * full date in every screen reader, whatever the reader does with the `aria-label` of a table header.
 *
 * The names. The heading names the region (and so the box that scrolls); the caption gives the range and is the name of the table. There is
 * no second, hidden caption that says the heading again.
 */
function WeekTable({ days, week }) {
  const titleId = useId()
  const scroller = useRef(null)
  const today = days.at(-1)
  useEffect(() => {
    const box = scroller.current
    // Start at today, the end of the row: scrollLeft counts toward the left in a right-to-left box, so the sign follows the direction.
    if (box) box.scrollLeft = (getComputedStyle(box).direction === 'rtl' ? -1 : 1) * box.scrollWidth
  }, [today])
  const title = 'נוכחות ב-7 הימים האחרונים'
  return (
    <section>
      <h2 className="a-home__title" id={titleId}>{title}</h2>
      <div className="a-week" role="region" aria-labelledby={titleId} tabIndex={0} ref={scroller}>
        <table>
          <caption className="a-week__range"><span className="a-stamp">{formatDay(days[0])}</span> עד <span className="a-stamp">{formatDay(today)}</span></caption>
          <thead>
            <tr>
              <th scope="col" className="a-week__who"><span className="w-sr">נותן שירות</span></th>
              {days.map((day) => (
                <th scope="col" className="a-week__day" key={day}>
                  <span className="a-stamp" aria-hidden="true">{formatDayShort(day)}</span>
                  <span className="w-sr">{formatDay(day)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.providers.map((p) => (
              <tr key={p.id}>
                <WhoCell provider={p} />
                {p.counts.map((count, i) => <Cell key={days[i]} count={count} href={historyLink({ provider: p.id, from: days[i], to: days[i] })} />)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="a-week__who">סך הכול</th>
              {week.totals.map((count, i) => <Cell key={days[i]} total count={count} href={historyLink({ from: days[i], to: days[i] })} />)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

/** A card with one number: the whole card is a link to the screen that shows it. The words are the screen's own (C1, docs/design.md). */
function StatCard({ href, value, label, note }) {
  return (
    <a className="a-card a-stat" href={href}>
      <span className="a-stat__value">{value}</span>
      <span className="a-stat__label">{label}</span>
      {note && <span className="a-stat__note">{note}</span>}
    </a>
  )
}

function Cards({ days, counts }) {
  const { points, providers, committee_members: members, agent_keys: keys, visits_not_counted: notCounted, waiting } = counts
  return (
    <div className="a-grid a-grid--stats">
      <StatCard href="#providers" value={providers.active} label="נותני שירות פעילים" note={`מתוך ${providers.total}`} />
      <StatCard href="#points" value={points.active} label="נקודות פעילות" note={`מתוך ${points.total}`} />
      <StatCard href={historyLink({ outcome: 'not_counted', from: days[0], to: days.at(-1) })} value={notCounted} label="ביקורים שלא נקלטו ב-7 הימים" />
      {waiting.phones > 0 && (
        <StatCard href="#providers" value={waiting.phones} label="טלפונים עם ביקורים שממתינים לשליחה" note={`${visitsText(waiting.visits)} בסך הכול`} />
      )}
      <StatCard href="#settings" value={members.active} label="חברי הוועד" />
      <StatCard href="#agent" value={keys.active} label="מפתחות אייג'נט פעילים" />
    </div>
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

  // A screen that stays open looks at the clock once a minute: the greeting follows the hour, and when the building's day has moved on
  // from the last column, the numbers are asked for again, so that "today" is today.
  const shownToday = useRef(null)
  shownToday.current = data?.days.at(-1) ?? null
  useEffect(() => {
    const timer = setInterval(() => {
      setHour(buildingHour())
      if (shownToday.current && shownToday.current !== isoDay()) reload()
    }, CLOCK_CHECK_MS)
    return () => clearInterval(timer)
  }, [reload])

  const name = firstName(admin?.name)
  const empty = data && data.counts.points.total === 0 && data.counts.providers.total === 0 && data.week.providers.length === 0

  return (
    <>
      <div className="a-head">
        <div><h1>{greetingOf(hour)}{name && <>, <bdi>{name}</bdi></>}</h1></div>
      </div>

      {home.status === 'loading' && <Spinner />}
      {home.status === 'error' && !data && (
        <EmptyState icon={IconAlert} title="לא הצלחנו לטעון" action={<button className="w-btn w-btn--small" onClick={reload}>נסו שוב</button>} />
      )}
      {empty && <GettingStarted />}
      {data && !empty && (
        <div className="a-home">
          <WeekTable days={data.days} week={data.week} />
          <Cards days={data.days} counts={data.counts} />
        </div>
      )}
    </>
  )
}
