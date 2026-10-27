// Fills the scratch schema of the long promo's recorder with the invented building of scripts/promo/sample.mjs: the committee, the
// service providers, the points, a week of visits and a refused one. Run by playwright.promo.config.js after the schema is dropped
// (scripts/dev-seed.mjs <schema> --drop) and before the API starts, never by hand and never against a real table.
// Usage: node scripts/promo/seed.mjs <schema>    (PROMO_DAY, the story's day, comes from the config)
//
// The visits go through recordScan, the function that records a real one, with the time of the visit passed in (as
// scripts/screenshots/seed-history.mjs does), so they are ordinary accepted scans with the flags that a real one gets.
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { loadEnv } from '../../server/loadEnv.js'
import { SAMPLE_POINT } from '../sample-data.mjs'
import { assertPromoSchema, buildingInstant, addDays, checkPromoDay, promoDay } from './settings.mjs'
import { BUILDING, MEMBERS, PROVIDERS, POINTS, RADIUS_M, REFUSAL, positionNear, weekVisits } from './sample.mjs'

loadEnv()

// The guard: a scratch schema of this tool and of no other (the name goes into SQL as an identifier, so it is checked first).
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (names.length !== 1) throw new Error(`Expected one schema name, got ${names.length}`)
const schema = assertPromoSchema(names[0])
const today = checkPromoDay(process.env.PROMO_DAY || promoDay())

const { normalizeConnectionString } = await import('../../server/db.js')
const control = new pg.Pool({ connectionString: normalizeConnectionString(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL), max: 1 })
const { assertNotProduction } = await import('../../server/dbGuard.js')
try {
  await assertNotProduction(control) // before any write: never a database that is marked as production
} catch (err) {
  console.error(err.message)
  await control.end()
  process.exit(1)
}
await control.query(`create schema if not exists ${schema}`)
await control.end()

process.env.DB_SCHEMA = schema
const { getPool, query } = await import('../../server/db.js')
const { migrate } = await import('../../server/migrate.js')
const { hashPassword } = await import('../../server/crypto.js')
const { recordScan, providerSnapshotName } = await import('../../server/scans.js')
const { GPS_MODE_REQUIRED, SCAN_ERROR_NOT_ASSIGNED, SOURCE_ONLINE } = await import('../../shared/contract.js')

await migrate(getPool())
const { rows: existing } = await query('select count(*)::int n from providers')
if (existing[0].n > 0) {
  // The config drops the schema first, so this is a schema that something else filled: stop here, not later in the pictures.
  console.error(`Schema "${schema}" already has providers: the promo's building needs an empty one.`)
  await getPool().end()
  process.exit(1)
}

for (const member of Object.values(MEMBERS)) {
  await query('insert into admins (email, name) values ($1, $2)', [member.email, member.name])
}

const people = {}
for (const [key, p] of Object.entries(PROVIDERS)) {
  const { rows } = await query(
    'insert into providers (company, contact_name, service_type, password_hash) values ($1, $2, $3, $4) returning *',
    [p.company, p.contact, p.service, await hashPassword(p.password)],
  )
  people[key] = rows[0]
}

const places = {}
for (const [key, p] of Object.entries(POINTS)) {
  const { rows } = await query(
    `insert into points (name, description, gps_mode, qr_token, lat, lng, radius_m, service_type)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [p.name, p.description, GPS_MODE_REQUIRED, p.token, SAMPLE_POINT.lat, SAMPLE_POINT.lng, RADIUS_M, p.service],
  )
  places[key] = rows[0]
  for (const who of p.only) await query('insert into point_providers (point_id, provider_id) values ($1, $2)', [rows[0].id, people[who].id])
}

await query('update building_settings set name = $1, address = $2 where id = 1', [BUILDING.name, BUILDING.address])

const visits = weekVisits(today)
for (const v of visits) {
  await recordScan({
    provider: people[v.who],
    deviceId: null,
    input: { id: randomUUID(), code: POINTS[v.where].token, gps: positionNear(v.metres) },
    source: SOURCE_ONLINE,
    now: buildingInstant(v.day, v.time),
  })
}

// The refused visit, as the server writes one (server/scanRefusals.js), with the time of the story: the table is append-only, so it is
// written once, here, with its own time.
const refusedBy = people[REFUSAL.who]
const refusedAt = places[REFUSAL.where]
await query(
  `insert into scan_refusals (at, source, code, provider_id, provider_name, point_id, point_name)
   values ($1, $2, $3, $4, $5, $6, $7)`,
  [buildingInstant(addDays(today, -REFUSAL.daysAgo), REFUSAL.time), SOURCE_ONLINE, SCAN_ERROR_NOT_ASSIGNED, refusedBy.id,
    providerSnapshotName(refusedBy), refusedAt.id, refusedAt.name],
)

console.log(`Seeded the promo's building in schema "${schema}" for ${today}: 2 members, 3 providers, 4 points, ${visits.length} visits, 1 refused visit.`)
await getPool().end()
