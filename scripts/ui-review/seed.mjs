// Seeds a scratch schema for the UI review pictures (npm run ui-review:pictures, docs/testing.md). Run by the Playwright config of the
// pictures (playwright.ui-review.config.js) and by its spec, never by hand against a real table.
// Usage: node scripts/ui-review/seed.mjs <schema>            the sample data of the dev seed, with the worst case in it
//        node scripts/ui-review/seed.mjs <schema> --empty    an empty building: the schema is made again with one committee member
//
// The worst case (scripts/ui-review/worst-case.mjs) starts from the rows that scripts/dev-seed.mjs makes: it runs the dev seed first,
// renames some of its rows to the long names, and adds a few. The other rows stay as the dev seed made them, so every list has
// ordinary rows beside the extreme ones. The dev seed itself, the sample data and every README picture and visual baseline that reads
// it are not changed: this writes only in the schema that it is given, which parseUiReviewSchema accepts only if no other tool uses it.
//
// The empty building drops the schema (cascade) and makes it again, because the audit log and the refused visits are append-only
// and cannot be emptied row by row. The API of the run can stay up meanwhile: it names the schema in the search path of each connection.
import { execFileSync } from 'node:child_process'
import { loadEnv } from '../../server/loadEnv.js'
import { ROOT, parseUiReviewSchema } from './settings.mjs'
import { SAMPLE, PLAIN_ADMIN, BUILDING, ADMINS, PROVIDERS, POINTS, AGENT_KEY, VISITS, REFUSALS } from './worst-case.mjs'

loadEnv()

const args = process.argv.slice(2)
const empty = args.includes('--empty')
const names = args.filter((a) => !a.startsWith('--'))
const unknown = args.filter((a) => a.startsWith('--') && a !== '--empty')
if (names.length !== 1 || unknown.length) {
  console.error('Usage: node scripts/ui-review/seed.mjs <schema> [--empty]')
  process.exit(2)
}
// Checked before anything is touched. The schema goes into SQL as an identifier below, so only this checked name is ever used.
let schema
try {
  schema = parseUiReviewSchema(names[0])
} catch (err) {
  console.error(`Refusing to seed: ${err.message}`)
  process.exit(1)
}
process.env.DB_SCHEMA = schema

const { getPool, query, tx } = await import('../../server/db.js')
const { assertNotProduction } = await import('../../server/dbGuard.js')

try {
  await assertNotProduction(getPool())
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

/** Runs the dev seed (it makes the schema, applies the migrations and seeds it, or with --drop removes the schema). */
const devSeed = (...flags) => execFileSync(process.execPath, ['scripts/dev-seed.mjs', schema, ...flags], { cwd: ROOT, stdio: 'inherit' })

if (empty) {
  devSeed('--drop')
  const { migrate } = await import('../../server/migrate.js')
  await query(`create schema if not exists ${schema}`)
  await migrate(getPool())
  await query('insert into admins (email, name) values ($1, $2)', [PLAIN_ADMIN.email, PLAIN_ADMIN.name])
  console.log(`Schema "${schema}" is an empty building: one committee member and nothing else.`)
  await getPool().end()
  process.exit(0)
}

devSeed()

const { rows: building } = await query('select name from building_settings where id = 1')
if (building[0]?.name === BUILDING.name) {
  console.log(`Schema "${schema}" already has the worst case: left as it is.`)
  await getPool().end()
  process.exit(0)
}

const { hashPassword, randomToken, sha256 } = await import('../../server/crypto.js')
const { audit, adminActor } = await import('../../server/audit.js')
const { recordScan, providerSnapshotName } = await import('../../server/scans.js')
const { API_KEY_PREFIX, TIMEZONE } = await import('../../server/config.js')
const { SOURCE_ONLINE, GPS_MODE_REQUIRED, SCAN_ERROR_NOT_ASSIGNED, SCAN_ERROR_POINT_INACTIVE } = await import('../../shared/contract.js')
const { SAMPLE_POINT } = await import('../sample-data.mjs')
const { randomUUID } = await import('node:crypto')

/** The one row that `sql` returns, or an error that says which row of the dev seed is missing (the dev seed changed). */
async function one(c, sql, params, what) {
  const { rows } = await c.query(sql, params)
  if (rows.length !== 1) throw new Error(`The dev seed has no ${what}: scripts/dev-seed.mjs changed, and SAMPLE in scripts/ui-review/worst-case.mjs has to follow.`)
  return rows[0]
}

/** @type {Record<string, any>} */
const providers = {} // by the keys of PROVIDERS, plus `cleaner`: the rows after the renames
/** @type {Record<string, any>} */
const points = {} // by the keys of POINTS, plus `basement`

await tx(async (c) => {
  // The member that the pictures sign in as: the dev seed's member, renamed (the dev sign-in takes the e-mail).
  const before = await one(c, 'select id, email, name from admins where email = $1', [SAMPLE.admin], 'committee member')
  await c.query('update admins set email = $2, name = $3 where id = $1', [before.id, ADMINS.signedIn.email, ADMINS.signedIn.name])
  const actor = adminActor({ id: before.id, ...ADMINS.signedIn })
  for (const member of [ADMINS.oneLetter, ADMINS.noName]) {
    const { rows } = await c.query('insert into admins (email, name) values ($1, $2) returning id', [member.email, member.name])
    await audit(c, actor, 'admin.add', { entity: 'admin', entityId: rows[0].id, detail: { email: member.email } })
  }

  // The building.
  const was = (await c.query('select name, address from building_settings where id = 1')).rows[0]
  await c.query('update building_settings set name = $1, address = $2 where id = 1', [BUILDING.name, BUILDING.address])
  await audit(c, actor, 'building.update', {
    entity: 'building',
    detail: { changes: { address: { from: was.address, to: BUILDING.address }, name: { from: was.name, to: BUILDING.name } } },
  })

  // The providers: three of the dev seed's, renamed (they keep the password of the dev seed), and one more.
  for (const [key, sample] of [['hebrew', SAMPLE.gardener], ['russian', SAMPLE.russian], ['oneWord', SAMPLE.english]]) {
    const p = PROVIDERS[key]
    const old = await one(c, 'select id, company, contact_name, service_type from providers where company = $1', [sample], `provider "${sample}"`)
    await c.query('update providers set company = $2, contact_name = $3, service_type = $4 where id = $1', [old.id, p.company, p.contact_name, p.service_type])
    providers[key] = { id: old.id, company: p.company, contact_name: p.contact_name }
    await audit(c, actor, 'provider.update', {
      entity: 'provider',
      entityId: old.id,
      detail: {
        changes: {
          company: { from: old.company, to: p.company },
          ...(old.contact_name !== p.contact_name ? { contact_name: { from: old.contact_name, to: p.contact_name } } : {}),
        },
      },
    })
  }
  providers.cleaner = await one(c, 'select * from providers where company = $1', [SAMPLE.cleaner], `provider "${SAMPLE.cleaner}"`)
  const short = PROVIDERS.short
  const created = await c.query(
    'insert into providers (company, contact_name, service_type, password_hash) values ($1, $2, $3, $4) returning id',
    [short.company, short.contact_name, short.service_type, await hashPassword(short.password)],
  )
  providers.short = { id: created.rows[0].id, company: short.company, contact_name: short.contact_name }
  await audit(c, actor, 'provider.create', { entity: 'provider', entityId: created.rows[0].id, detail: { company: short.company } })

  // The points: all of them check the location, as the committee app saves them (src/admin/views/PointsView.jsx). The lobby is
  // renamed and described, and three providers may scan it; the gym is renamed and keeps its one provider.
  await c.query('update points set gps_mode = $1 where gps_mode <> $1', [GPS_MODE_REQUIRED])
  const lobby = await one(c, 'select id, name from points where name = $1', [SAMPLE.lobby], `point "${SAMPLE.lobby}"`)
  const gym = await one(c, 'select id, name from points where name = $1', [SAMPLE.gym], `point "${SAMPLE.gym}"`)
  await c.query('update points set name = $2, description = $3, service_type = $4 where id = $1', [lobby.id, POINTS.lobby.name, POINTS.lobby.description, POINTS.lobby.service_type])
  await c.query('update points set name = $2 where id = $1', [gym.id, POINTS.gym.name])
  const allowed = [providers.hebrew.id, providers.russian.id, providers.oneWord.id]
  for (const id of allowed) await c.query('insert into point_providers (point_id, provider_id) values ($1, $2)', [lobby.id, id])
  await audit(c, actor, 'point.update', {
    entity: 'point',
    entityId: lobby.id,
    detail: {
      changes: {
        name: { from: lobby.name, to: POINTS.lobby.name },
        description: { from: null, to: POINTS.lobby.description },
        service_type: { from: null, to: POINTS.lobby.service_type },
      },
      provider_ids: { added: [...allowed].sort(), removed: [] },
    },
  })
  await audit(c, actor, 'point.update', { entity: 'point', entityId: gym.id, detail: { changes: { name: { from: gym.name, to: POINTS.gym.name } } } })
  points.lobby = { ...lobby, name: POINTS.lobby.name }
  points.gym = { ...gym, name: POINTS.gym.name }
  points.basement = await one(c, 'select id, name from points where name = $1', [SAMPLE.basement], `point "${SAMPLE.basement}"`)

  // The one key of the agent: an item alone in its list, with a name of 80 characters.
  const secret = randomToken(API_KEY_PREFIX)
  const key = await c.query('insert into api_keys (name, key_prefix, key_hash) values ($1, $2, $3) returning id', [AGENT_KEY.name, secret.slice(0, 8), sha256(secret)])
  await audit(c, actor, 'api_key.create', { entity: 'api_key', entityId: key.rows[0].id, detail: { name: AGENT_KEY.name } })
})

// The visits, through recordScan (the function that records a real one) with the time of each passed in, so each is an ordinary accepted
// visit with the flags that a real one gets. The names in them are the ones above: a visit keeps the name as it was when it was made.
const here = { lat: SAMPLE_POINT.lat, lng: SAMPLE_POINT.lng, accuracy: 12 }
const { rows: tokens } = await query('select id, qr_token from points')
const codeOf = (point) => tokens.find((t) => t.id === point.id).qr_token
const full = async (who) => (await query('select * from providers where id = $1', [who.id])).rows[0]

// The instant of "HH:MM on the day that is `days` before today in the building's time zone", worked out by the database so that the hour
// is the same whatever the time of day of the run (the same as scripts/screenshots/seed-history.mjs).
const instant = async (days, hhmm) =>
  (await query('select (((now() at time zone $1)::date - $2::int) + $3::time) at time zone $1 as at', [TIMEZONE, days, hhmm])).rows[0].at

for (const [days, hhmm, who, where] of VISITS) {
  await recordScan({
    provider: await full(providers[who]),
    deviceId: null,
    input: { id: randomUUID(), code: codeOf(points[where]), gps: here },
    source: SOURCE_ONLINE,
    now: await instant(days, hhmm),
  })
}

// Visits that the server did not count (the list on the History screen, the count on Home). The snapshots are written as the server writes them.
for (const [minutesAgo, code, who, where] of REFUSALS) {
  const person = await full(providers[who])
  const point = where ? points[where] : null
  const reason = { not_assigned: SCAN_ERROR_NOT_ASSIGNED, point_inactive: SCAN_ERROR_POINT_INACTIVE }[code]
  await query(
    `insert into scan_refusals (at, source, code, provider_id, provider_name, point_id, point_name)
     values (now() - make_interval(mins => $1::int), $2, $3, $4, $5, $6, $7)`,
    [minutesAgo, SOURCE_ONLINE, reason, person.id, providerSnapshotName(person), point?.id ?? null, point?.name ?? null],
  )
}

console.log(`Worst case seeded in schema "${schema}": ${VISITS.length} visits, ${REFUSALS.length} refused visits, 4 providers renamed or added, 2 points renamed.`)
await getPool().end()
