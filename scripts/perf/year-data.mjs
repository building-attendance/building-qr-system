// A year of invented data in a scratch schema, so that the committee's screens and the agent's API can be timed on the sizes
// that a building really reaches (npm run perf:api, docs/testing.md "Timing the committee and agent API"). Scans, refused visits
// and the audit log are never deleted, so a query that reads them "since ever" slows down as the years go by: this is where it
// shows first, on invented data, before a committee notices it.
//
// Usage: node scripts/perf/year-data.mjs <schema> [--scale=1|10] [--today=YYYY-MM-DD]   make the schema again and fill it
//        node scripts/perf/year-data.mjs <schema> --drop                                remove it
//
// It writes tens of thousands of rows in a few statements, so it guards itself before it writes anything:
//  - the name of the schema is its one argument, never a variable of the environment, and it is checked first: a scratch name
//    (assertScratchSchema of scripts/e2e-config.mjs, so never `public` or `neon_auth`), and never the schema of another tool
//    (`dev_ui`, `e2e`, `perf`, `screenshots`), which this would empty;
//  - the database is asked for its marker (assertNotProduction of server/dbGuard.js) before the first statement that writes, so
//    a database that is marked production is refused whatever the environment says;
//  - a schema that is already there is dropped only when this generator made it (it leaves YEAR_DATA_MARK as the comment of the
//    schema), so a developer's own scratch schema is never emptied by a typo;
//  - every row is written on a connection whose search_path is the scratch schema and nothing else, and that connection checks
//    so before its first insert.
//
// What it writes, x1 and x10 (the two sizes of docs/testing.md):
//  - 25 points (2 switched off), 10 service providers (one of them the demo account, one switched off on day 200), the providers
//    who may scan each point, their phones, and 3 committee members;
//  - the visits of the 365 building days that end yesterday: about 40 a day at x1 (400 at x10), more on Sunday to Thursday, fewer
//    on Friday, few on Saturday; most accepted, some refused for the distance or for no location, a few flagged
//    `location_unverified`, `offline_sync` or `clock_skew`, a few of the demo account (`demo`), and about 1% voided, each void
//    with its `scan.void` entry in the audit log;
//  - refused visits (scan_refusals), about 5% of the visits;
//  - the audit log of a year of committee work, 3,000 entries at x1 (30,000 at x10): sign-ins and sign-outs, changes to points and
//    providers, the voids, and the daily retention job;
//  - 2 agent keys (one revoked), and the minutes of use of the active one: one request every 5 minutes for 90 days.
// Then it runs VACUUM (ANALYZE) on every table it filled, as autovacuum would have done long before a year had passed.
//
// The data is the same on every run of the same day: every choice comes from md5 of a fixed text (perf_rand below), not from
// random(), and the ids too, so two runs make the same rows whatever order the database evaluates them in. Only the minutes of
// use of the agent key are counted back from the moment of the run.
//
// Every value is invented (scripts/sample-data.mjs says why: the repository is public). Names are the kind of a place in a
// building with a number, "sample company N", "contact person N" and the Hebrew placeholders Ploni and Almoni; e-mails are at
// example.test; every point is at the sample point in the open sea. It prints counts only.
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertScratchSchema } from '../e2e-config.mjs'
import { SAMPLE_POINT, SAMPLE_PROVIDER_NAMES } from '../sample-data.mjs'
import { loadEnv } from '../../server/loadEnv.js'
import { assertNotProduction } from '../../server/dbGuard.js'
import { normalizeConnectionString } from '../../server/db.js'
import { migrate } from '../../server/migrate.js'
import { providerSnapshotName } from '../../server/scans.js'
import { TIMEZONE, API_KEY_PREFIX } from '../../server/config.js'
import { QR_TOKEN_PREFIX } from '../../shared/contract.js'
import { isoDay } from '../../shared/datetime.js'

/** The comment that this generator leaves on a schema it made: the only schema that it ever drops. */
export const YEAR_DATA_MARK = 'bqr perf year data (scripts/perf/year-data.mjs): invented rows, safe to drop'

/** The sizes it can make: x1 is a real building's year, x10 shows how a query grows (a big building, or several years). */
export const YEAR_DATA_SCALES = Object.freeze([1, 10])

/** The schemas of the other tools, which this generator must never empty: why each is refused. */
const OTHER_TOOLS = Object.freeze({
  dev_ui: "it is the developer's scratch data (npm run db:seed-dev)",
  e2e: "it is the E2E run's (npm run test:e2e)",
  perf: 'it is the scan timing\'s (npm run perf:scan)',
  screenshots: "it is the screenshots' (npm run screenshots)",
})

/** The committee member that a timing signs in as (the dev-only shortcut of the local API), and the busiest one in the log. */
export const YEAR_DATA_MEMBER_EMAIL = 'member1@example.test'

const DAYS = 365
// The weight of a building day by its day of the week (ISO: Monday 1 to Sunday 7): Sunday to Thursday are work days in Israel,
// Friday is short and Saturday is quiet. WEEK_MEAN is their mean, so that the visits of a year average the mean of the plan.
const WEEKDAY_WEIGHT = 1.15
const FRIDAY_WEIGHT = 0.6
const SATURDAY_WEIGHT = 0.25
const WEEK_MEAN = (5 * WEEKDAY_WEIGHT + FRIDAY_WEIGHT + SATURDAY_WEIGHT) / 7

/**
 * The numbers of one scale. The counts that a run makes are close to these: the visits of a day are drawn around the mean,
 * and the voids are a share of the accepted visits.
 * @param {number} scale  1 or 10
 */
export function yearDataPlan(scale) {
  if (!YEAR_DATA_SCALES.includes(scale)) throw new Error(`The scale must be one of ${YEAR_DATA_SCALES.join(', ')}, not ${JSON.stringify(scale)}.`)
  return Object.freeze({
    scale,
    days: DAYS,
    points: 25,
    inactivePoints: 2,
    providers: 10,
    demoProviders: 1,
    members: 3,
    visitsPerDay: 40 * scale,
    visits: DAYS * 40 * scale,
    refusalShare: 0.05,
    voidShare: 0.0105,
    auditEntries: 3000 * scale,
    agentKeys: 2,
    agentKeyMinutes: 90 * 288, // one request every 5 minutes for 90 days (the retention of api_key_usage)
  })
}

/**
 * The name of the schema, or an error that says why it is refused: a scratch name, and not the schema of another tool.
 * @param {unknown} name
 */
export function assertYearDataSchema(name) {
  const schema = assertScratchSchema(name)
  if (Object.hasOwn(OTHER_TOOLS, schema)) {
    throw new Error(`Schema "${schema}" is refused: ${OTHER_TOOLS[schema]}, and the year data would empty it. Pick another name (npm run perf:api uses perf_api).`)
  }
  return schema
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` that is a real calendar day, or an error. */
function assertDay(value) {
  const day = String(value)
  if (!DAY_RE.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error(`--today must be a real day written YYYY-MM-DD, not ${JSON.stringify(value)}.`)
  }
  return day
}

/** `n` calendar days after `day` (before it when `n` is negative), `YYYY-MM-DD`, by calendar arithmetic (as server/home.js does). */
export function addDays(day, n) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10)
}

/**
 * What the command line asks for: `{ schema, scale, today, drop }`. The schema is the one argument that is not an option, and
 * nothing else can name it. Throws for a missing or second name, an unknown option, a scale that is not 1 or 10, or a bad day.
 * @param {string[]} argv  the arguments after the script
 */
export function parseYearDataArgs(argv) {
  const names = argv.filter((a) => !a.startsWith('--'))
  if (names.length !== 1) throw new Error(`Expected one schema name, got ${names.length}. Usage: node scripts/perf/year-data.mjs <schema> [--scale=1|10] [--drop]`)
  let scale = 1
  let today
  let drop = false
  for (const option of argv.filter((a) => a.startsWith('--'))) {
    if (option === '--drop') drop = true
    else if (option.startsWith('--scale=')) scale = Number(option.slice('--scale='.length))
    else if (option.startsWith('--today=')) today = assertDay(option.slice('--today='.length))
    else throw new Error(`Unknown option ${option}`)
  }
  if (!drop) yearDataPlan(scale) // refuses a scale that is not one of YEAR_DATA_SCALES
  return { schema: assertYearDataSchema(names[0]), scale, today, drop }
}

// ---------- the schema ----------

/** The comment of `schema`, or undefined when there is no such schema (null when it has no comment). */
async function schemaComment(db, schema) {
  const { rows } = await db.query(
    'select obj_description(n.oid, \'pg_namespace\') as comment from pg_namespace n where n.nspname = $1',
    [schema],
  )
  return rows.length ? rows[0].comment : undefined
}

/**
 * Drops `schema` when this generator made it, and does nothing when there is no such schema. The marker of the database is read
 * first: on a database that is marked production nothing else is sent. A schema that is there without YEAR_DATA_MARK is refused.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} control  a pg Pool or Client on the database
 * @param {string} schema  a name that assertYearDataSchema accepted
 * @returns {Promise<boolean>}  whether a schema was dropped
 */
export async function dropYearData(control, schema) {
  const name = assertYearDataSchema(schema)
  await assertNotProduction(control)
  const comment = await schemaComment(control, name)
  if (comment === undefined) return false
  if (comment !== YEAR_DATA_MARK) {
    throw new Error(`Schema "${name}" exists and was not made by scripts/perf/year-data.mjs (it has no mark of it), so it is left as it is. Drop it yourself, or pick another name.`)
  }
  await control.query(`drop schema ${name} cascade`)
  return true
}

/**
 * Makes `schema` empty and new: the marker of the database first (nothing else is sent to a database that is marked
 * production), then the schema that this generator made before is dropped, and the schema is created with YEAR_DATA_MARK.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} control
 * @param {string} schema
 */
export async function prepareSchema(control, schema) {
  const name = assertYearDataSchema(schema)
  await assertNotProduction(control) // before the first statement that writes: the drop below
  await dropYearData(control, name)
  await control.query(`create schema ${name}`)
  await control.query(`comment on schema ${name} is '${YEAR_DATA_MARK.replace(/'/g, "''")}'`)
}

// ---------- the invented things ----------

/** md5 of a text written as a uuid, as Postgres writes `md5(text)::uuid`: the same id on every run. */
export function uuidOf(text) {
  const h = crypto.createHash('md5').update(text).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const md5Hex = (text) => crypto.createHash('md5').update(text).digest('hex')
const pad2 = (n) => String(n).padStart(2, '0')

// Kinds of places in a building, each with the service that keeps it. A point is one of them with a number ("lobby 01").
const PLACES = [
  ['לובי', 'cleaning'],
  ['חדר מדרגות', 'cleaning'],
  ['חניון', 'cleaning'],
  ['חדר אשפה', 'cleaning'],
  ['מעלית', 'maintenance'],
  ['גינה', 'gardening'],
  ['גג', 'maintenance'],
  ['מחסן', 'cleaning'],
  ['חדר כושר', 'cleaning'],
  ['בריכה', 'pool'],
]
// The underground places ask for the location without requiring it (a weak fix down there is common); one point asks nothing.
const OPTIONAL_PLACES = new Set(['חניון', 'מחסן'])
const NO_GPS_POINT = 23
const INACTIVE_POINTS = new Set([11, 24])
// How many visits an assignment gets, against the others: the cleaners come most often.
const VISIT_WEIGHT = { cleaning: 6, gardening: 3, maintenance: 2, pool: 3 }

// "Sample company N" of each trade, with "contact person N" (or a Hebrew placeholder) and the demo account of scripts/dev-seed.mjs.
const PROVIDERS = [
  { company: 'ניקיון לדוגמה 1', contact: SAMPLE_PROVIDER_NAMES.cleaner, service: 'cleaning' },
  { company: 'ניקיון לדוגמה 2', contact: 'איש קשר 2', service: 'cleaning' },
  { company: 'ניקיון לדוגמה 3', contact: 'איש קשר 3', service: 'cleaning' },
  { company: 'ניקיון לדוגמה 4', contact: '', service: 'cleaning', leftOnDay: 200 },
  { company: 'גינון לדוגמה 1', contact: SAMPLE_PROVIDER_NAMES.gardener, service: 'gardening' },
  { company: 'גינון לדוגמה 2', contact: 'איש קשר 6', service: 'gardening' },
  { company: 'אחזקה לדוגמה 1', contact: 'איש קשר 7', service: 'maintenance' },
  { company: 'אחזקה לדוגמה 2', contact: 'איש קשר 8', service: 'maintenance' },
  { company: 'בריכות לדוגמה 1', contact: 'איש קשר 9', service: 'pool' },
  { company: 'דמו', contact: 'לקוח דמה', service: null, demo: true },
]

const MEMBERS = [1, 2, 3].map((n) => ({ id: uuidOf(`perf-member:${n}`), email: `member${n}@example.test`, name: `חבר ועד ${n}` }))

const VOID_REASONS = ['כפילות', 'סריקת בדיקה', 'נרשם בטעות']
const SAMPLE_ADDRESS = 'רחוב הדוגמה 1, עיר לדוגמה' // the invented address of scripts/dev-seed.mjs
const SAMPLE_BUILDING = 'בניין הדוגמה'

/** The points, the providers, their assignments and the "slots" a visit is drawn from, all decided here and the same on every run. */
function buildWorld() {
  const points = Array.from({ length: 25 }, (_, i) => {
    const [place, service] = PLACES[i % PLACES.length]
    return {
      i,
      id: uuidOf(`perf-point:${i}`),
      name: `${place} ${pad2(i + 1)}`,
      service,
      gps_mode: i === NO_GPS_POINT ? 'none' : OPTIONAL_PLACES.has(place) ? 'optional' : 'required',
      active: !INACTIVE_POINTS.has(i),
      qr_token: `${QR_TOKEN_PREFIX}${md5Hex(`perf-qr:${i}`).slice(0, 24)}`,
    }
  })
  const providers = PROVIDERS.map((p, i) => ({
    ...p,
    i,
    id: uuidOf(`perf-provider:${i}`),
    snapshot: providerSnapshotName({ company: p.company, contact_name: p.contact }),
    device: uuidOf(`perf-device:${i}`),
    active: p.leftOnDay === undefined,
  }))
  const byService = (service) => providers.filter((p) => p.service === service && !p.demo)
  // Who may scan each point: two of the cleaners for a place that is cleaned (a different pair from point to point), and every
  // provider of the trade for the others. The demo account is never listed (it may scan everywhere).
  const assignments = []
  for (const point of points) {
    const trade = byService(point.service)
    const chosen = point.service === 'cleaning' ? [trade[point.i % trade.length], trade[(point.i + 1) % trade.length]] : trade
    for (const provider of chosen) assignments.push({ point, provider })
  }
  // A slot is one (provider, point) pair, repeated by its weight: a visit picks one slot at random. A point that is switched off
  // has none (its visits are older than the year), and the demo account has one, so its visits are few.
  const slots = []
  for (const { point, provider } of assignments) {
    if (!point.active) continue
    for (let w = 0; w < VISIT_WEIGHT[point.service]; w++) slots.push({ point, provider })
  }
  slots.push({ point: points[0], provider: providers.find((p) => p.demo) })
  // The provider who left on a day: a visit of theirs after that day goes to another provider of the same point (the slot `alt`).
  const rows = slots.map(({ point, provider }, k) => {
    let alt = k
    if (provider.leftOnDay !== undefined) {
      const other = slots.findIndex((s) => s.point === point && s.provider.leftOnDay === undefined && !s.provider.demo)
      alt = other === -1 ? slots.findIndex((s) => s.provider.leftOnDay === undefined && !s.provider.demo) : other
    }
    return {
      k,
      provider_id: provider.id,
      provider_name: provider.snapshot,
      is_demo: Boolean(provider.demo),
      device_id: provider.device,
      point_id: point.id,
      point_name: point.name,
      service_type: point.service,
      gps_mode: point.gps_mode,
      last_day: provider.leftOnDay ?? null,
      alt,
    }
  })
  return { points, providers, assignments, slots: rows }
}

// ---------- filling ----------

// A number in [0, 1) from md5 of a key: the seeded random of every choice below. It lives in pg_temp (it is gone when the
// connection ends) and is called by its full name, so nothing is added to the scratch schema itself.
const PERF_RAND_SQL = `
  create function pg_temp.perf_rand(key text) returns double precision language sql immutable as
  $$ select ('x' || substr(md5('bqr-perf-year:' || key), 1, 12))::bit(48)::bigint::double precision / 281474976710656 $$`

/** Inserts the rows of a JSON array into a temporary table, typed by `columns` (`name type, ...`). */
async function tempTable(c, name, columns, rows) {
  await c.query(`create temp table ${name} (${columns})`)
  await c.query(`insert into ${name} select * from jsonb_to_recordset($1::jsonb) as x(${columns})`, [JSON.stringify(rows)])
}

/**
 * Fills the scratch schema that `c` is connected to. `c` must be a client whose search_path is `schema` and nothing else: that is
 * checked before the first write. Everything is one transaction.
 * @param {import('pg').Client} c
 * @param {{ schema: string, scale: number, today: string }} options  `today` is the building day after the last day of data
 */
export async function fillYearData(c, { schema, scale, today }) {
  const plan = yearDataPlan(scale)
  const { rows: where } = await c.query('select current_schema() as schema, current_setting(\'search_path\') as path')
  if (where[0].schema !== schema || where[0].path.replace(/"/g, '') !== schema) {
    throw new Error(`Refusing to fill: the connection writes to ${JSON.stringify(where[0].schema)} (search_path ${where[0].path}), not to the scratch schema "${schema}" alone.`)
  }
  const first = addDays(today, -plan.days) // the first building day of the data; the last one is the day before `today`
  const world = buildWorld()
  const at = (day, minutes) => `((date '${addDays(first, day)}' + make_interval(mins => ${minutes})) at time zone '${TIMEZONE}')`

  await c.query('begin')
  try {
    await c.query(PERF_RAND_SQL)

    // The committee: three members, the first one the busiest.
    for (const m of MEMBERS) {
      await c.query(`insert into admins (id, email, name, created_at) values ($1, $2, $3, ${at(-30, 9 * 60)})`, [m.id, m.email, m.name])
    }

    // The points, at the invented sample point in the open sea.
    for (const p of world.points) {
      await c.query(
        `insert into points (id, name, description, service_type, gps_mode, lat, lng, radius_m, is_active, qr_token, created_at, updated_at)
         values ($1, $2, '', $3, $4, $5, $6, 50, $7, $8, ${at(-20, 10 * 60 + p.i)}, ${at(-20, 10 * 60 + p.i)})`,
        [p.id, p.name, p.service, p.gps_mode, SAMPLE_POINT.lat, SAMPLE_POINT.lng, p.active, p.qr_token],
      )
    }

    // The providers (no password: nobody signs in as them here), their assignments and their phones.
    for (const p of world.providers) {
      await c.query(
        `insert into providers (id, company, contact_name, service_type, is_active, is_demo, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, ${at(-19, 10 * 60 + p.i)}, ${at(-19, 10 * 60 + p.i)})`,
        [p.id, p.company, p.contact, p.service, p.active, Boolean(p.demo)],
      )
      await c.query(
        `insert into provider_devices (id, provider_id, token_hash, label, created_at, last_seen_at, app_build, status_at, waiting_count,
                                       oldest_waiting_at, last_sync_at)
         values ($1, $2, $3, $4, ${at(-10, 8 * 60)}, now() - make_interval(hours => $5), $6, now() - make_interval(hours => $5),
                 $7, case when $7 > 0 then now() - interval '3 hours' end, now() - make_interval(hours => $5 + 1))`,
        [p.device, p.id, md5Hex(`perf-device-token:${p.i}`), `Fake phone ${p.i + 1} (perf data)`, p.i + 1, p.i % 3 === 0 ? 'dev' : null, p.i === 1 ? 2 : 0],
      )
      if (p.i < 5) {
        await c.query(
          `insert into provider_devices (id, provider_id, token_hash, label, created_at, last_seen_at, revoked_at)
           values ($1, $2, $3, $4, ${at(-10, 8 * 60)}, ${at(100, 8 * 60)}, ${at(100, 9 * 60)})`,
          [uuidOf(`perf-device:old:${p.i}`), p.id, md5Hex(`perf-device-token:old:${p.i}`), `Old fake phone ${p.i + 1} (perf data)`],
        )
      }
    }
    for (const { point, provider } of world.assignments) {
      await c.query('insert into point_providers (point_id, provider_id) values ($1, $2)', [point.id, provider.id])
    }
    await c.query('update building_settings set address = $1, name = $2 where id = 1', [SAMPLE_ADDRESS, SAMPLE_BUILDING])

    await tempTable(
      c,
      'perf_slot',
      'k int, provider_id uuid, provider_name text, is_demo boolean, device_id uuid, point_id uuid, point_name text, service_type text, gps_mode text, last_day int, alt int',
      world.slots,
    )
    await c.query('create unique index on perf_slot (k)')

    // The visits: each building day draws its number around the mean of its weekday, and each visit draws its slot, its time
    // (06:00 to 19:00 in the building), how it came in and how it was judged. They are inserted in the order of time, as the app
    // appends them. (The flags are written in the order that recordScan writes them: the location, the clock, the demo account.)
    await c.query(
      `insert into scans (id, point_id, provider_id, point_name, provider_name, service_type, checked_in_at, received_at, client_time,
                          local_date, source, outcome, distance_m, gps_accuracy_m, device_id, flags, voided_at, void_reason)
       with days as (
         select ($1::date + i) as day, i as di from generate_series(0, $2::int - 1) as i
       ),
       counted as (
         select day, di,
                round($3::double precision
                      * case extract(isodow from day)::int when 6 then $4::double precision when 5 then $5::double precision else $6::double precision end
                      * (0.8 + 0.4 * pg_temp.perf_rand('day:' || di)))::int as n
           from days
       ),
       drawn as (
         select c.day, c.di, 'scan:' || c.di || ':' || j as key from counted c cross join lateral generate_series(1, c.n) as j
       ),
       placed as (
         select d.day, d.di, d.key, s.provider_id, s.provider_name, s.is_demo, s.device_id, s.point_id, s.point_name, s.service_type, s.gps_mode,
                pg_temp.perf_rand(d.key || ':time') as r_time, pg_temp.perf_rand(d.key || ':source') as r_source,
                pg_temp.perf_rand(d.key || ':gps') as r_gps, pg_temp.perf_rand(d.key || ':more') as r_more,
                pg_temp.perf_rand(d.key || ':void') as r_void, pg_temp.perf_rand(d.key || ':when') as r_when
           from drawn d
           join perf_slot s0 on s0.k = floor(pg_temp.perf_rand(d.key || ':slot') * $7::int)::int
           join perf_slot s on s.k = case when s0.last_day is not null and d.di > s0.last_day then s0.alt else s0.k end
       ),
       judged as (
         select p.*,
                -- In milliseconds, as checked_in_at keeps it (timestamptz(3)), so that the times made from it are never before it.
                date_trunc('milliseconds', (p.day + time '06:00' + p.r_time * interval '13 hours') at time zone $8::text) as at,
                case when p.r_source < 0.12 then 'offline_sync' else 'online' end as source,
                case when p.gps_mode = 'required' and p.r_gps < 0.025 then 'rejected_far'
                     when p.gps_mode = 'required' and p.r_gps < 0.04 then 'rejected_no_location'
                     when p.gps_mode = 'optional' and p.r_gps < 0.02 then 'rejected_far'
                     else 'accepted' end as outcome,
                (p.gps_mode = 'optional' and p.r_gps >= 0.02 and p.r_gps < 0.12) as unverified,
                (p.r_more < 0.006) as skewed
           from placed p
       )
       select md5(j.key)::uuid, j.point_id, j.provider_id, j.point_name, j.provider_name, j.service_type, j.at,
              j.at + case when j.source = 'online' then j.r_more * interval '2 seconds' else interval '2 minutes' + j.r_more * interval '4 hours' end,
              case when j.source = 'offline_sync' then j.at
                   when j.skewed then j.at + interval '9 minutes'
                   else j.at - (j.r_more - 0.5) * interval '10 seconds' end,
              j.day, j.source, j.outcome,
              case when j.outcome = 'rejected_no_location' or j.unverified then null
                   when j.outcome = 'rejected_far' then 120 + floor(j.r_more * 3000)::int
                   else floor(j.r_more * 55)::int end,
              case when j.outcome = 'rejected_no_location' or j.unverified then null else 4 + floor(j.r_when * 30)::int end,
              j.device_id,
              array_remove(array[
                case when j.unverified then 'location_unverified' end,
                case when j.source = 'offline_sync' then 'offline_sync' end,
                case when j.skewed and j.source = 'online' then 'clock_skew' end,
                case when j.is_demo then 'demo' end
              ], null),
              case when j.outcome = 'accepted' and j.r_void < $9::double precision then j.at + interval '10 minutes' + j.r_when * interval '3 hours' end,
              case when j.outcome = 'accepted' and j.r_void < $9::double precision
                   then (array[$10::text, $11::text, $12::text, null])[1 + floor(j.r_when * 4)::int] end
         from judged j
        order by j.at, j.key`,
      [
        first, plan.days, plan.visitsPerDay / WEEK_MEAN, SATURDAY_WEIGHT, FRIDAY_WEIGHT, WEEKDAY_WEIGHT, world.slots.length, TIMEZONE,
        plan.voidShare, ...VOID_REASONS,
      ],
    )

    // The refused visits (scan_refusals): a share of the visits, spread over the year, with the codes that a phone drops a queued
    // visit for. A refusal names the point that the code named (a point that is switched off, one the provider is not assigned
    // to), or none (a code that names no point, an item of bad data).
    const { rows: counted } = await c.query('select count(*)::int as n from scans')
    const refusals = Math.round(counted[0].n * plan.refusalShare)
    const pickable = world.providers.filter((p) => p.active && !p.demo)
    await tempTable(c, 'perf_provider', 'k int, id uuid, name text, device_id uuid', pickable.map((p, k) => ({ k, id: p.id, name: p.snapshot, device_id: p.device })))
    const activePoints = world.points.filter((p) => p.active)
    const inactivePoints = world.points.filter((p) => !p.active)
    await tempTable(
      c,
      'perf_point',
      'k_active int, k_inactive int, id uuid, name text',
      [
        ...activePoints.map((p, k) => ({ k_active: k, k_inactive: null, id: p.id, name: p.name })),
        ...inactivePoints.map((p, k) => ({ k_active: null, k_inactive: k, id: p.id, name: p.name })),
      ],
    )
    await c.query(
      `insert into scan_refusals (at, scan_id, source, code, provider_id, provider_name, device_id, point_id, point_name, client_time)
       with drawn as (
         select 'refusal:' || j as key from generate_series(1, $1::int) as j
       ),
       shaped as (
         select key,
                ((($2::date + floor(pg_temp.perf_rand(key || ':day') * $3::int)::int) + time '06:00'
                  + pg_temp.perf_rand(key || ':time') * interval '13 hours') at time zone $4::text) as at,
                pg_temp.perf_rand(key || ':code') as r_code, pg_temp.perf_rand(key || ':source') as r_source,
                pg_temp.perf_rand(key || ':provider') as r_provider, pg_temp.perf_rand(key || ':point') as r_point
           from drawn
       ),
       coded as (
         select s.*,
                case when r_code < 0.45 then 'not_assigned' when r_code < 0.70 then 'point_inactive'
                     when r_code < 0.90 then 'unknown_code' else 'invalid_item' end as code
           from shaped s
       )
       select x.at,
              case when x.code = 'invalid_item' then null else md5(x.key)::uuid end,
              case when x.code = 'invalid_item' or x.r_source < 0.4 then 'offline_sync' else 'online' end,
              x.code, p.id, p.name, p.device_id, pt.id, pt.name,
              case when x.code = 'invalid_item' or x.r_source < 0.4 then x.at - interval '1 minute' - x.r_point * interval '2 hours' end
         from coded x
         join perf_provider p on p.k = floor(x.r_provider * $5::int)::int
         left join perf_point pt on (x.code = 'not_assigned' and pt.k_active = floor(x.r_point * $6::int)::int)
                                 or (x.code = 'point_inactive' and pt.k_inactive = floor(x.r_point * $7::int)::int)
        order by x.at, x.key`,
      [refusals, first, plan.days, TIMEZONE, pickable.length, activePoints.length, inactivePoints.length],
    )

    // The audit log: what the committee set up on the first day, the daily retention job, the voids (one `scan.void` for each voided
    // visit, at its time and by a member), and a year of committee work to fill the rest. The details have the shapes that
    // server/audit.js documents, so that the audit screen and the agent read them as they read real ones.
    const setup = [
      { day: 0, minute: 8 * 60, actor: null, actor_type: 'script', action: 'admin.add', entity: 'admin', entity_id: MEMBERS[0].id, detail: { email: MEMBERS[0].email } },
      ...MEMBERS.slice(1).map((m, n) => ({ day: 0, minute: 8 * 60 + 10 + n, actor: MEMBERS[0], action: 'admin.add', entity: 'admin', entity_id: m.id, detail: { email: m.email } })),
      { day: 0, minute: 8 * 60 + 20, actor: MEMBERS[0], action: 'building.update', entity: 'building', entity_id: null, detail: { changes: { address: { from: null, to: SAMPLE_ADDRESS }, name: { from: null, to: SAMPLE_BUILDING } } } },
      ...world.providers.map((p) => ({ day: 0, minute: 9 * 60 + p.i, actor: MEMBERS[0], action: 'provider.create', entity: 'provider', entity_id: p.id, detail: { company: p.company } })),
      ...world.points.map((p) => ({
        day: 0,
        minute: 10 * 60 + p.i,
        actor: MEMBERS[0],
        action: 'point.create',
        entity: 'point',
        entity_id: p.id,
        detail: {
          name: p.name, service_type: p.service, gps_mode: p.gps_mode, lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, radius_m: 50,
          provider_ids: world.assignments.filter((a) => a.point === p).map((a) => a.provider.id).sort(),
        },
      })),
      { day: 0, minute: 11 * 60, actor: MEMBERS[0], action: 'api_key.create', entity: 'api_key', entity_id: uuidOf('perf-key:old'), detail: { name: 'מפתח ישן' } },
      { day: 30, minute: 11 * 60, actor: MEMBERS[0], action: 'api_key.create', entity: 'api_key', entity_id: uuidOf('perf-key:agent'), detail: { name: 'סוכן הוועד' } },
      { day: 31, minute: 11 * 60, actor: MEMBERS[0], action: 'api_key.revoke', entity: 'api_key', entity_id: uuidOf('perf-key:old'), detail: null },
      ...world.points.filter((p) => !p.active).map((p, n) => ({
        day: 40 + n, minute: 12 * 60, actor: MEMBERS[1], action: 'point.update', entity: 'point', entity_id: p.id,
        detail: { changes: { is_active: { from: true, to: false } } },
      })),
      ...world.providers.filter((p) => !p.active).map((p) => ({
        day: p.leftOnDay + 1, minute: 12 * 60, actor: MEMBERS[1], action: 'provider.update', entity: 'provider', entity_id: p.id,
        detail: { changes: { is_active: { from: true, to: false } } },
      })),
    ].map((e, o) => ({
      o,
      day: e.day,
      minute: e.minute,
      actor_type: e.actor_type ?? 'admin',
      actor_id: e.actor?.id ?? null,
      actor_name: e.actor?.name ?? null,
      action: e.action,
      entity: e.entity,
      entity_id: e.entity_id,
      detail: e.detail,
    }))
    const { rows: voided } = await c.query('select count(*)::int as n from scans where voided_at is not null')
    const work = plan.auditEntries - setup.length - plan.days - voided[0].n
    if (work < 0) throw new Error('The audit log of the plan is smaller than its fixed entries')
    await tempTable(c, 'perf_member', 'k int, id text, name text', MEMBERS.map((m, k) => ({ k, id: m.id, name: m.name })))
    await tempTable(c, 'perf_thing', 'k int, point_id text, provider_id text', world.points.map((p, k) => ({
      k, point_id: p.id, provider_id: world.providers[k % (world.providers.length - 1)].id, // never the demo account
    })))
    await c.query(
      `insert into audit_log (at, actor_type, actor_id, actor_name, action, entity, entity_id, detail)
       with setup as (
         select ((($1::date + x.day) + make_interval(mins => x.minute)) at time zone $2::text) as at, 'setup:' || lpad(x.o::text, 4, '0') as ord,
                x.actor_type, x.actor_id, x.actor_name, x.action, x.entity, x.entity_id, x.detail
           from jsonb_to_recordset($3::jsonb) as x(o int, day int, minute int, actor_type text, actor_id text, actor_name text, action text,
                                                   entity text, entity_id text, detail jsonb)
       ),
       retention as (
         select ((($1::date + d) + time '03:00') at time zone $2::text) as at, 'retention:' || d as ord,
                'system' as actor_type, null::text as actor_id, null::text as actor_name, 'retention.run' as action, null::text as entity,
                null::text as entity_id,
                jsonb_build_object('sessions', 0, 'login_attempts', floor(pg_temp.perf_rand('retention:' || d) * 4)::int, 'device_labels', 0,
                                   'app_errors', 0, 'alert_pings', 0, 'api_key_usage', case when d >= $4::int - 90 then 288 else 0 end) as detail
           from generate_series(0, $4::int - 1) as d
       ),
       voids as (
         select s.voided_at as at, 'void:' || s.id as ord, 'admin' as actor_type, m.id as actor_id, m.name as actor_name, 'scan.void' as action,
                'scan' as entity, s.id::text as entity_id, jsonb_build_object('reason', s.void_reason) as detail
           from scans s
           join perf_member m on m.k = case when pg_temp.perf_rand('voider:' || s.id) < 0.6 then 0 else 1 end
          where s.voided_at is not null
       ),
       drawn as (
         select 'work:' || j as key from generate_series(1, $5::int) as j
       ),
       chosen as (
         select key,
                ((($1::date + floor(pg_temp.perf_rand(key || ':day') * $4::int)::int) + time '07:00'
                  + pg_temp.perf_rand(key || ':time') * interval '16 hours') at time zone $2::text) as at,
                pg_temp.perf_rand(key || ':action') as r_action, pg_temp.perf_rand(key || ':actor') as r_actor,
                pg_temp.perf_rand(key || ':thing') as r_thing, pg_temp.perf_rand(key || ':shape') as r_shape
           from drawn
       ),
       acted as (
         select c.*, m.id as actor_id, m.name as actor_name, t.point_id, t.provider_id,
                case when r_action < 0.42 then 'session.sign_in' when r_action < 0.58 then 'session.sign_out'
                     when r_action < 0.80 then 'point.update' when r_action < 0.93 then 'provider.update'
                     when r_action < 0.97 then 'provider.revoke_devices' when r_action < 0.995 then 'point.regenerate_qr'
                     else 'building.update' end as action
           from chosen c
           join perf_member m on m.k = case when c.r_actor < 0.6 then 0 when c.r_actor < 0.9 then 1 else 2 end
           join perf_thing t on t.k = floor(c.r_thing * $6::int)::int
       ),
       work as (
         select at, key as ord, 'admin' as actor_type, actor_id, actor_name, action,
                case when action like 'session.%' then 'admin' when action like 'point.%' then 'point'
                     when action like 'provider.%' then 'provider' else 'building' end as entity,
                case when action like 'session.%' then actor_id when action like 'point.%' then point_id
                     when action like 'provider.%' then provider_id end as entity_id,
                case action
                  when 'session.sign_in' then jsonb_build_object('method', 'google')
                  when 'point.update' then
                    case when r_shape < 0.5 then jsonb_build_object('changes', jsonb_build_object('description', jsonb_build_object('from', '', 'to', 'ניקיון יסודי בימי ראשון')))
                         when r_shape < 0.8 then jsonb_build_object('changes', jsonb_build_object('radius_m', jsonb_build_object('from', 50, 'to', 60)))
                         else jsonb_build_object('provider_ids', jsonb_build_object('added', jsonb_build_array(provider_id), 'removed', jsonb_build_array())) end
                  when 'provider.update' then
                    case when r_shape < 0.6 then jsonb_build_object('password_changed', true)
                         else jsonb_build_object('changes', jsonb_build_object('service_type', jsonb_build_object('from', null, 'to', 'cleaning'))) end
                  when 'provider.revoke_devices' then jsonb_build_object('devices', 1)
                  when 'building.update' then jsonb_build_object('changes', jsonb_build_object('address', jsonb_build_object('from', $7::text, 'to', $7::text || ' א')))
                end as detail
           from acted
       )
       select at, actor_type, actor_id, actor_name, action, entity, entity_id, detail
         from (select * from setup union all select * from retention union all select * from voids union all select * from work) entries
        order by at, ord`,
      [first, TIMEZONE, JSON.stringify(setup), plan.days, work, world.points.length, SAMPLE_ADDRESS],
    )

    // The agent's keys: the one the committee's agent uses, which asked once every 5 minutes for the last 90 days, and an old one
    // that was revoked. Each key's hash is of a fixed text that is no key at all, so no request can ever present one of them.
    const agentKey = uuidOf('perf-key:agent')
    await c.query(
      `insert into api_keys (id, name, key_prefix, key_hash, created_at, last_used_at, revoked_at) values
         ($1, 'סוכן הוועד', $3, $4, ${at(30, 11 * 60)}, date_trunc('minute', now()) - interval '5 minutes', null),
         ($2, 'מפתח ישן', $5, $6, ${at(0, 11 * 60)}, ${at(30, 9 * 60)}, ${at(31, 11 * 60)})`,
      [
        agentKey, uuidOf('perf-key:old'),
        `${API_KEY_PREFIX}${md5Hex('perf-key-prefix:agent').slice(0, 4)}`, crypto.createHash('sha256').update('not a key: perf agent').digest('hex'),
        `${API_KEY_PREFIX}${md5Hex('perf-key-prefix:old').slice(0, 4)}`, crypto.createHash('sha256').update('not a key: perf old').digest('hex'),
      ],
    )
    await c.query(
      `insert into api_key_usage (key_id, minute, requests, refused)
       select $1::uuid, date_trunc('minute', now()) - make_interval(mins => 5 * k), 1, 0 from generate_series(1, $2::int) as k`,
      [agentKey, plan.agentKeyMinutes],
    )

    await c.query('commit')
  } catch (err) {
    await c.query('rollback').catch(() => {})
    throw err
  }
}

/** The tables that the generator fills, for VACUUM (ANALYZE) and for the counts. */
const FILLED = ['admins', 'points', 'providers', 'point_providers', 'provider_devices', 'scans', 'scan_refusals', 'audit_log', 'api_keys', 'api_key_usage', 'building_settings']

/**
 * How many rows of each kind the schema holds: counts only, no row.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db  connected to the scratch schema
 */
export async function countYearData(db) {
  const { rows } = await db.query(`
    select (select count(*) from points)::int as points,
           (select count(*) from points where not is_active)::int as inactive_points,
           (select count(*) from providers)::int as providers,
           (select count(*) from providers where is_demo)::int as demo_providers,
           (select count(*) from admins)::int as members,
           (select count(*) from scans)::int as scans,
           (select count(*) from scans where outcome = 'accepted')::int as accepted,
           (select count(*) from scans where voided_at is not null)::int as voided,
           (select count(*) from scans where 'demo' = any(flags))::int as demo_scans,
           (select count(*) from scan_refusals)::int as refusals,
           (select count(*) from audit_log)::int as audit,
           (select count(*) from api_keys)::int as api_keys,
           (select count(*) from api_key_usage)::int as api_key_usage`)
  return rows[0]
}

const n = (value) => value.toLocaleString('en-US')

/** One line of counts, for a person. */
export function describeCounts(schema, scale, k) {
  return (
    `Year data in "${schema}" at x${scale}: ${k.points} points (${k.inactive_points} switched off), ${k.providers} providers ` +
    `(${k.demo_providers} demo), ${k.members} committee members, ${n(k.scans)} visits (${n(k.voided)} voided, ${n(k.demo_scans)} demo), ` +
    `${n(k.refusals)} refused visits, ${n(k.audit)} audit entries, ${k.api_keys} agent keys with ${n(k.api_key_usage)} minutes of use.`
  )
}

/**
 * Makes the scratch schema again and fills it. The name is checked before anything else, then the database's marker (on the
 * control connection, before the first write), then the schema is made, migrated, filled, vacuumed and counted.
 * @param {{ schema: string, scale: number, today?: string, connectionString: string, log?: (line: string) => void }} options
 */
export async function generateYearData({ schema, scale, today = isoDay(new Date()), connectionString, log = () => {} }) {
  const name = assertYearDataSchema(schema)
  yearDataPlan(scale)
  const day = assertDay(today)
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)')
  const url = normalizeConnectionString(connectionString)
  const control = new pg.Pool({ connectionString: url, max: 1 })
  try {
    await prepareSchema(control, name)
  } finally {
    await control.end()
  }
  // The scratch schema alone on the path: a table that is not there is an error, never a row written somewhere else.
  const scoped = { connectionString: url, options: `-c search_path=${name}`, statement_timeout: 10 * 60_000 }
  const migrations = new pg.Pool({ ...scoped, max: 1 })
  try {
    await migrate(migrations)
  } finally {
    await migrations.end()
  }
  const c = new pg.Client(scoped)
  await c.connect()
  try {
    await fillYearData(c, { schema: name, scale, today: day })
    for (const table of FILLED) await c.query(`vacuum (analyze) ${name}.${table}`)
    const counts = await countYearData(c)
    log(describeCounts(name, scale, counts))
    return counts
  } finally {
    await c.end()
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let args
  try {
    args = parseYearDataArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
  loadEnv()
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  try {
    if (args.drop) {
      if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)')
      const control = new pg.Pool({ connectionString: normalizeConnectionString(connectionString), max: 1 })
      try {
        console.log((await dropYearData(control, args.schema)) ? `Dropped schema ${args.schema}` : `There is no schema ${args.schema}`)
      } finally {
        await control.end()
      }
    } else {
      await generateYearData({ ...args, today: args.today ?? isoDay(new Date()), connectionString, log: (line) => console.log(line) })
    }
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}
