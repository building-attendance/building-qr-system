// The numbers of the committee's Home screen, in one request (GET /api/admin/home; the screen is a later change). The app records facts
// and does not analyse, so this is counts and nothing else, and every number in it is one that another screen of the committee app
// shows already (docs/privacy.md does not change): History, Providers, Points, the committee list, the agent's keys, the refused visits.
//
// Nothing is defined again here. Each number is taken from the code of the screen that shows it, so the two cannot differ:
//   - `week` is countsQuery (server/scanCounts.js) grouped by day and provider, over scanWhere (server/scans.js), the very conditions of
//     the History list: accepted visits only, voided ones and the demo account's hidden. A cell is the number of rows that
//     GET /api/admin/scans returns for that provider and that day (tests/admin-home.test.js proves it for a matrix of cells);
//   - `counts.visits_not_counted` is countRefusals (server/scanRefusals.js), listRefusals' own conditions, so a day is a building day;
//   - `counts.waiting` is waitingUploads (server/deviceStatus.js), the phone health of the Providers screen added up;
//   - the order of the providers is the Providers screen's (server/providerOrder.js).
//
// The days are the seven building days that end today: `isoDay(now)` (shared/datetime.js) is today in the building's zone, and the six
// before it are found by calendar arithmetic on that date, never by taking 24 hours away from a moment (a day of 23 or 25 hours, when
// the clocks change, would then be skipped or repeated).
//
// All of it is read in ONE read-only transaction (`set transaction read only` first, as server/summary.js does), so that nothing here
// can write by a mistake. It is built field by field: no row of any table goes out, and no id of anything but a provider.
import { tx } from './db.js'
import { commit } from './health.js'
import { countsQuery } from './scanCounts.js'
import { countRefusals } from './scanRefusals.js'
import { waitingUploads } from './deviceStatus.js'
import { PROVIDER_LIST_ORDER } from './providerOrder.js'
import { COUNTS_MAX_ROWS } from './config.js'
import { isoDay } from '../shared/datetime.js'

/** @import { HomeSummary, HomeWeekProvider } from '../shared/types.js' */

/** How many days the week table has: today and the six days before it. */
export const HOME_DAYS = 7

/**
 * `n` calendar days after `day` (before it when `n` is negative), as `YYYY-MM-DD`. Arithmetic on the calendar date, in UTC, where
 * every day has the same length: the building's clock changes do not matter, because no moment is involved.
 * @param {string} day  `YYYY-MM-DD`
 * @param {number} n
 */
function addDays(day, n) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10)
}

/**
 * The seven building days that end with the day of `now` in the building's time zone, the oldest first.
 * @param {Date} [now]
 * @returns {string[]}
 */
export function homeDays(now = new Date()) {
  const today = isoDay(now)
  return Array.from({ length: HOME_DAYS }, (_, i) => addDays(today, i - (HOME_DAYS - 1)))
}

// The plain counts of the committee's lists, one statement. "Active" is what the screen of that list calls switched on: a point or a
// provider with `is_active`, a committee member with `is_active`, an agent key that is not revoked (the key the agent API accepts).
const COUNTS_SQL = `
  select (select count(*) from points where is_active)::int as points_active,
         (select count(*) from points)::int as points_total,
         (select count(*) from providers where is_active)::int as providers_active,
         (select count(*) from providers)::int as providers_total,
         (select count(*) from admins where is_active)::int as members_active,
         (select count(*) from api_keys where revoked_at is null)::int as keys_active`

// The providers of the week table: every active one (the demo account apart: its visits are hidden everywhere, so a row of zeros
// would say that it never came), and any provider that had a visit in the days ($1 holds their ids, also an inactive or demo one),
// in the order of the Providers screen. `p.id` makes the order total.
const PROVIDERS_SQL = `
  select p.id, p.company, p.contact_name, p.is_active
    from providers p
   where (p.is_active and not p.is_demo) or p.id = any($1::uuid[])
   order by ${PROVIDER_LIST_ORDER}, p.id`

/**
 * The seven building days that end today, the visits of each provider on each of them, and the committee's counts. Read only, in one
 * transaction. A failure of the database is thrown as it is.
 * @param {{ now?: Date }} [options]  the moment that "today" is taken from (default: now); a test passes one
 * @returns {Promise<HomeSummary>}
 */
export async function buildHome({ now = new Date() } = {}) {
  const days = homeDays(now)
  const from = days[0]
  const to = days[HOME_DAYS - 1]
  const build = commit()

  const read = await tx(async (c) => {
    await c.query('set transaction read only')
    const { sql, params } = countsQuery({ from, to, group_by: 'day,provider' })
    const week = await c.query(sql, params)
    // The counts are never cut: a statement that read more rows than the limit would add up to less than the History shows.
    if (week.rows.length > COUNTS_MAX_ROWS) throw new Error('The week table has more rows than a count may have')
    const visitors = [...new Set(week.rows.map((row) => row.provider_id))]
    const providers = await c.query(PROVIDERS_SQL, [visitors])
    const counts = await c.query(COUNTS_SQL)
    return {
      week: week.rows,
      providers: providers.rows,
      counts: counts.rows[0],
      refused: await countRefusals(c, { from, to }),
      waiting: await waitingUploads(c, build),
    }
  })

  return {
    days,
    week: weekOf(days, read.week, read.providers),
    counts: {
      points: { active: read.counts.points_active, total: read.counts.points_total },
      providers: { active: read.counts.providers_active, total: read.counts.providers_total },
      committee_members: { active: read.counts.members_active },
      agent_keys: { active: read.counts.keys_active },
      visits_not_counted: read.refused,
      waiting: read.waiting,
    },
  }
}

/**
 * The week table from the rows of countsQuery (a count for each day and provider that has visits) and the providers that get a row.
 * A provider with visits whose row is gone (the committee deleted it; its visits stay) still gets one, with the name its visits kept,
 * after the others, so that the rows add up to `totals` and `totals` to the History.
 * @param {string[]} days
 * @param {Array<{ day: string, provider_id: string, provider_name: string, count: number }>} counted
 * @param {Array<{ id: string, company: string, contact_name: string, is_active: boolean }>} listed
 * @returns {{ providers: HomeWeekProvider[], totals: number[] }}
 */
function weekOf(days, counted, listed) {
  const zeros = () => days.map(() => 0)
  const totals = zeros()
  /** @type {Map<string, { name: string, counts: number[] }>} */
  const byProvider = new Map()
  for (const row of counted) {
    const day = days.indexOf(row.day)
    const entry = byProvider.get(row.provider_id) ?? { name: row.provider_name, counts: zeros() }
    entry.counts[day] += row.count
    totals[day] += row.count
    byProvider.set(row.provider_id, entry)
  }

  const providers = listed.map((p) => ({
    id: p.id,
    name: p.contact_name || p.company,
    company: p.company,
    is_active: p.is_active,
    counts: byProvider.get(p.id)?.counts ?? zeros(),
  }))
  const shown = new Set(listed.map((p) => p.id))
  const deleted = [...byProvider]
    .filter(([id]) => !shown.has(id))
    .map(([id, { name, counts }]) => ({ id, name, company: null, is_active: false, counts }))
    .sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1))
  return { providers: [...providers, ...deleted], totals }
}
