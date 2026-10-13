// The year of invented data that npm run perf:api times the API on (scripts/perf/year-data.mjs, docs/testing.md "Timing the
// committee and agent API"). It writes tens of thousands of rows in a few statements, so this file proves first that it writes
// nothing where it must not:
//   1. a name that is not a scratch schema, or that belongs to another tool, is refused before any statement is sent, and so is a
//      database that is marked production (only the two reads of the marker are sent), and a schema that it did not make itself;
//   2. the schema comes from its argument and from nothing else, it reads no other variable than the database's address, and it
//      writes only on a connection whose search_path is the scratch schema alone;
// and then, on the test database, in a throwaway schema, that a year at x1 is the year that docs/testing.md describes:
//   3. the counts (25 points, 10 providers with one demo account, 3 members, about 40 visits a day, 5% refused, 1% voided, 3,000
//      audit entries, 90 days of an agent key's minutes);
//   4. every visit is one that the app could have recorded (its building day, its flags, the demo account, the voids with their
//      audit entries), every refused visit and every audit entry has the shape that the app writes, and the append-only guards of
//      the tables still refuse an update and a delete of a generated row;
//   5. the same day makes the same data, row for row;
//   6. nothing in the generator looks like a real phone number, e-mail or place.
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnv } from '../server/loadEnv.js'
import { normalizeConnectionString } from '../server/db.js'
import {
  YEAR_DATA_MARK, YEAR_DATA_MEMBER_EMAIL, addDays, assertYearDataSchema, dropYearData, fillYearData, generateYearData, parseYearDataArgs,
  prepareSchema, yearDataPlan,
} from '../scripts/perf/year-data.mjs'
import { SCAN_FLAGS } from '../shared/flags.js'
import { SYNC_PERMANENT_ERROR_CODES, SCAN_OUTCOMES } from '../shared/contract.js'
import { AUDIT_DETAIL_ALLOW } from '../server/audit.js'
import { AUDIT_GROUPS } from '../server/auditRead.js'

loadEnv()

const GENERATOR = fileURLToPath(new URL('../scripts/perf/year-data.mjs', import.meta.url))
const TIMING = fileURLToPath(new URL('../scripts/perf/api-timing.mjs', import.meta.url))

/** A fake pg client that answers the marker, the comment of a schema, and records everything it is sent. */
function fakeDb({ marker = null, comment } = {}) {
  const sent = []
  return {
    sent,
    async query(text) {
      sent.push(text)
      if (/to_regclass/.test(text)) return { rows: [{ present: marker !== null }] }
      if (/environment_marker/.test(text)) return { rows: (marker ?? []).map((environment) => ({ environment })) }
      if (/pg_namespace/.test(text)) return { rows: comment === undefined ? [] : [{ comment }] }
      return { rows: [] }
    },
  }
}

const NOWHERE = 'postgres://nobody:nothing@127.0.0.1:1/none' // nothing listens there: a connection would fail with ECONNREFUSED

describe('the guards of the generator, before any statement', () => {
  it.each([
    ['public', /real tables/],
    ['neon_auth', /Neon Auth/],
    ['dev_ui', /developer's scratch data/],
    ['e2e', /E2E run/],
    ['perf', /scan timing/],
    ['screenshots', /screenshots/],
    ['', /not a valid scratch schema name/],
    ['Bad-Name', /not a valid scratch schema name/],
    ['1abc', /not a valid scratch schema name/],
    ['a'.repeat(40), /not a valid scratch schema name/],
    [undefined, /not a valid scratch schema name/],
  ])('refuses the schema %j and sends nothing', async (name, reason) => {
    expect(() => assertYearDataSchema(name)).toThrow(reason)
    const db = fakeDb({ marker: ['nonprod'] })
    await expect(prepareSchema(db, name)).rejects.toThrow(reason)
    await expect(dropYearData(db, name)).rejects.toThrow(reason)
    expect(db.sent).toEqual([])
    // The name is checked before a connection is made: the error is the name's, not the refused connection's.
    await expect(generateYearData({ schema: name, scale: 1, connectionString: NOWHERE })).rejects.toThrow(reason)
  })

  it('refuses a database that is marked production, after reading the marker and nothing else', async () => {
    for (const marker of [['production'], ['nonprod', 'production']]) {
      for (const step of [prepareSchema, dropYearData]) {
        const db = fakeDb({ marker })
        await expect(step(db, 'perf_api')).rejects.toThrow(/production/)
        expect(db.sent).toHaveLength(2)
        expect(db.sent.join('\n')).toMatch(/to_regclass\('public\.environment_marker'\)/)
        expect(db.sent.join('\n')).not.toMatch(/\b(create|drop|comment|insert)\b/i)
      }
    }
  })

  it('makes a schema that is not there: the marker, then the schema, then its mark', async () => {
    const db = fakeDb({ marker: ['nonprod'] })
    await prepareSchema(db, 'perf_api')
    expect(db.sent.slice(0, 2).join('\n')).toMatch(/environment_marker/)
    const writes = db.sent.filter((text) => /^(create|drop|comment on)\b/i.test(text))
    expect(writes).toEqual(['create schema perf_api', `comment on schema perf_api is '${YEAR_DATA_MARK}'`])
  })

  it('drops a schema only when it carries the mark of the generator, and leaves any other one as it is', async () => {
    const ours = fakeDb({ marker: ['nonprod'], comment: YEAR_DATA_MARK })
    await expect(dropYearData(ours, 'perf_api')).resolves.toBe(true)
    expect(ours.sent.at(-1)).toBe('drop schema perf_api cascade')
    for (const comment of [null, 'my own work', `${YEAR_DATA_MARK} `]) {
      const theirs = fakeDb({ marker: ['nonprod'], comment })
      await expect(prepareSchema(theirs, 'perf_api')).rejects.toThrow(/not made by scripts\/perf\/year-data\.mjs/)
      expect(theirs.sent.join('\n')).not.toMatch(/\b(create|drop|comment on)\b/i)
    }
    const none = fakeDb({ marker: ['nonprod'] })
    await expect(dropYearData(none, 'perf_api')).resolves.toBe(false)
    expect(none.sent.join('\n')).not.toMatch(/\bdrop\b/i)
  })

  it('fills only a connection whose search_path is the scratch schema alone', async () => {
    for (const where of [{ schema: 'public', path: 'public' }, { schema: 'perf_api', path: 'perf_api, public' }, { schema: null, path: 'perf_api' }]) {
      const sent = []
      const client = { query: async (text) => (sent.push(text), { rows: [where] }) }
      await expect(fillYearData(/** @type {any} */ (client), { schema: 'perf_api', scale: 1, today: '2030-06-15' })).rejects.toThrow(/Refusing to fill/)
      expect(sent).toHaveLength(1)
    }
  })
})

describe('what the command line can ask for', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('takes the schema from its one argument, whatever the environment says', () => {
    vi.stubEnv('DB_SCHEMA', 'public')
    vi.stubEnv('E2E_SCHEMA', 'public')
    expect(parseYearDataArgs(['perf_api'])).toEqual({ schema: 'perf_api', scale: 1, today: undefined, drop: false })
    expect(parseYearDataArgs(['--scale=10', 'perf_api', '--today=2030-06-15'])).toEqual({ schema: 'perf_api', scale: 10, today: '2030-06-15', drop: false })
    expect(parseYearDataArgs(['perf_api', '--drop']).drop).toBe(true)
  })

  it.each([
    [[], /Expected one schema name, got 0/],
    [['perf_api', 'other'], /Expected one schema name, got 2/],
    [['perf_api', '--scale=3'], /scale must be one of 1, 10/],
    [['perf_api', '--scale=x'], /scale must be one of 1, 10/],
    [['perf_api', '--today=2030-02-30'], /real day/],
    [['perf_api', '--force'], /Unknown option --force/],
    [['public'], /real tables/],
  ])('refuses %j', (argv, reason) => {
    expect(() => parseYearDataArgs(argv)).toThrow(reason)
  })

  it('reads no variable of the environment but the address of the database', () => {
    const source = fs.readFileSync(GENERATOR, 'utf8')
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1])
    expect(new Set(read)).toEqual(new Set(['DATABASE_URL_UNPOOLED', 'DATABASE_URL']))
  })
})

describe('nothing in the generator or the timing looks like real data', () => {
  for (const [name, file] of [['scripts/perf/year-data.mjs', GENERATOR], ['scripts/perf/api-timing.mjs', TIMING]]) {
    const source = fs.readFileSync(file, 'utf8')
    it(`${name}: no phone number`, () => {
      expect(source).not.toMatch(/\+972|\b0[2-9]\d?[- ]?\d{3}[- ]?\d{4}\b/)
    })
    it(`${name}: no e-mail outside example.test`, () => {
      const emails = [...source.matchAll(/[\w.+-]+@([\w-]+\.)+[\w-]+/g)].map((m) => m[0])
      for (const email of emails) expect(email).toMatch(/@example\.test$/)
    })
    it(`${name}: no coordinate of its own (every point is the invented sample point)`, () => {
      expect(source).not.toMatch(/\b[1-9]\d{0,2}\.\d{4,}\b/)
    })
  }
})

// ===============================================================================================================================
// A year at x1, on the test database
// ===============================================================================================================================

const TODAY = '2030-06-15' // a fixed day: the data is relative to it, and two runs of it must be the same
const plan = yearDataPlan(1)
const url = () => normalizeConnectionString(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
const scratch = () => `t_${randomBytes(6).toString('hex')}`

describe('a year of data at x1', () => {
  const schema = scratch()
  const again = scratch()
  let control
  let db
  let counts

  beforeAll(async () => {
    control = new pg.Pool({ connectionString: url(), max: 1 })
    counts = await generateYearData({ schema, scale: 1, today: TODAY, connectionString: url() })
    db = new pg.Pool({ connectionString: url(), options: `-c search_path=${schema}`, max: 2 })
  }, 120_000)

  afterAll(async () => {
    await db?.end()
    for (const name of [schema, again]) await dropYearData(control, name).catch(() => {})
    await control?.end()
  })

  const one = async (sql, params) => (await db.query(sql, params)).rows[0]

  it('is the year of the plan: its counts', () => {
    expect(counts).toMatchObject({ points: 25, inactive_points: 2, providers: 10, demo_providers: 1, members: 3, api_keys: 2, api_key_usage: plan.agentKeyMinutes })
    expect(counts.scans).toBeGreaterThan(plan.visits * 0.95)
    expect(counts.scans).toBeLessThan(plan.visits * 1.05)
    expect(counts.refusals).toBe(Math.round(counts.scans * plan.refusalShare))
    expect(counts.voided / counts.accepted).toBeGreaterThan(0.006)
    expect(counts.voided / counts.accepted).toBeLessThan(0.016)
    expect(counts.demo_scans).toBeGreaterThan(0)
    expect(counts.demo_scans / counts.scans).toBeLessThan(0.01)
    expect(counts.audit).toBe(plan.auditEntries)
    expect(counts.accepted / counts.scans).toBeGreaterThan(0.9)
  })

  it('carries the mark of the generator, and the member that a timing signs in as', async () => {
    const mark = await control.query("select obj_description(oid, 'pg_namespace') as comment from pg_namespace where nspname = $1", [schema])
    expect(mark.rows[0].comment).toBe(YEAR_DATA_MARK)
    expect(await one('select is_active from admins where email = $1', [YEAR_DATA_MEMBER_EMAIL])).toEqual({ is_active: true })
    for (const { email } of (await db.query('select email from admins')).rows) expect(email).toMatch(/@example\.test$/)
  })

  it('has the visits of the 365 building days that end the day before, each on its own building day', async () => {
    const r = await one(
      `select min(local_date)::text as first, max(local_date)::text as last, count(distinct local_date)::int as days,
              count(*) filter (where (checked_in_at at time zone 'Asia/Jerusalem')::date <> local_date)::int as wrong_day
         from scans`,
    )
    expect(r).toEqual({ first: addDays(TODAY, -365), last: addDays(TODAY, -1), days: 365, wrong_day: 0 })
  })

  it('has more visits on a work day than on Friday, and more on Friday than on Saturday', async () => {
    const { rows } = await db.query(
      `select extract(isodow from local_date)::int as dow, count(*)::float / count(distinct local_date) as per_day from scans group by 1`,
    )
    const per = Object.fromEntries(rows.map((r) => [r.dow, r.per_day]))
    for (const workday of [7, 1, 2, 3, 4]) expect(per[workday]).toBeGreaterThan(per[5])
    expect(per[5]).toBeGreaterThan(per[6] * 1.5)
  })

  it('has only visits that the app could have recorded', async () => {
    const r = await one(
      `select count(*) filter (where not (flags <@ $1::text[]))::int as unknown_flag,
              count(*) filter (where cardinality(flags) <> (select count(distinct f) from unnest(flags) f))::int as repeated_flag,
              count(*) filter (where not (outcome = any($2::text[])))::int as unknown_outcome,
              count(*) filter (where ('demo' = any(flags)) <> p.is_demo)::int as demo_mismatch,
              count(*) filter (where ('offline_sync' = any(flags)) <> (source = 'offline_sync'))::int as offline_mismatch,
              count(*) filter (where voided_at is not null and (outcome <> 'accepted' or voided_at <= checked_in_at))::int as bad_void,
              count(*) filter (where void_reason is not null and voided_at is null)::int as reason_without_void,
              count(*) filter (where pt.id is null or not pt.is_active)::int as bad_point,
              count(*) filter (where s.point_name <> pt.name)::int as point_name_mismatch,
              count(*) filter (where received_at < checked_in_at)::int as received_before
         from scans s join providers p on p.id = s.provider_id left join points pt on pt.id = s.point_id`,
      [SCAN_FLAGS, SCAN_OUTCOMES],
    )
    expect(r).toEqual({
      unknown_flag: 0, repeated_flag: 0, unknown_outcome: 0, demo_mismatch: 0, offline_mismatch: 0, bad_void: 0, reason_without_void: 0,
      bad_point: 0, point_name_mismatch: 0, received_before: 0,
    })
    // Every outcome and every flag of the plan is there, so that a screen and a filter meet each of them.
    const { rows } = await db.query('select distinct outcome from scans union all select distinct unnest(flags) from scans')
    expect(rows.map((x) => x.outcome).sort()).toEqual(
      ['accepted', 'rejected_far', 'rejected_no_location', 'location_unverified', 'offline_sync', 'clock_skew', 'demo'].sort(),
    )
  })

  it('has one scan.void entry for every voided visit, and none for any other', async () => {
    const r = await one(
      `select (select count(*) from scans s where s.voided_at is not null
                 and (select count(*) from audit_log a where a.action = 'scan.void' and a.entity = 'scan' and a.entity_id = s.id::text) <> 1)::int as unmatched,
              (select count(*) from audit_log a where a.action = 'scan.void'
                 and not exists (select 1 from scans s where s.id::text = a.entity_id and s.voided_at is not null))::int as orphans,
              (select count(*) from audit_log a join scans s on s.id::text = a.entity_id where a.action = 'scan.void' and a.at <> s.voided_at)::int as other_time`,
    )
    expect(r).toEqual({ unmatched: 0, orphans: 0, other_time: 0 })
  })

  it('has refused visits with the codes that a phone drops a visit for, each naming the point it can name', async () => {
    const r = await one(
      `select count(*) filter (where not (code = any($1::text[])))::int as unknown_code,
              count(*) filter (where (point_id is null) <> (code in ('unknown_code', 'invalid_item')))::int as bad_point,
              count(*) filter (where code = 'point_inactive' and point_id not in (select id from points where not is_active))::int as active_point,
              count(*) filter (where provider_id not in (select id from providers where not is_demo))::int as bad_provider,
              count(distinct code)::int as codes
         from scan_refusals`,
      [SYNC_PERMANENT_ERROR_CODES],
    )
    expect(r).toEqual({ unknown_code: 0, bad_point: 0, active_point: 0, bad_provider: 0, codes: 4 })
  })

  it('has an audit log of known actions, in the order of time, by the committee, the system and the owner\'s script', async () => {
    const { rows } = await db.query('select distinct action, actor_type from audit_log')
    for (const { action, actor_type } of rows) {
      expect(Object.keys(AUDIT_DETAIL_ALLOW), action).toContain(action)
      expect(AUDIT_GROUPS, action).toContain(action.split('.')[0])
      expect(['admin', 'system', 'script']).toContain(actor_type)
    }
    const r = await one(
      `select count(*) filter (where at < previous)::int as out_of_order,
              count(*) filter (where actor_type = 'admin' and actor_id not in (select id::text from admins))::int as stranger
         from (select at, actor_type, actor_id, lag(at) over (order by id) as previous from audit_log) x`,
    )
    expect(r).toEqual({ out_of_order: 0, stranger: 0 })
  })

  it('leaves the append-only guards of the tables as they are: a generated row cannot be changed or deleted', async () => {
    const scan = (await one('select id from scans limit 1')).id
    await expect(db.query("update scans set point_name = 'changed' where id = $1", [scan])).rejects.toThrow(/append-only/)
    await expect(db.query('delete from scans where id = $1', [scan])).rejects.toThrow(/append-only/)
    await expect(db.query("update audit_log set action = 'point.update' where id = (select min(id) from audit_log)")).rejects.toThrow(/append-only/)
    await expect(db.query('delete from scan_refusals where id = (select min(id) from scan_refusals)')).rejects.toThrow(/append-only/)
  })

  it('makes the same rows again on the same day', async () => {
    await generateYearData({ schema: again, scale: 1, today: TODAY, connectionString: url() })
    const fingerprint = async (name) => {
      const client = new pg.Client({ connectionString: url(), options: `-c search_path=${name}` })
      await client.connect()
      try {
        const { rows } = await client.query(`
          select (select md5(string_agg(s::text, ',' order by s.id)) from scans s) as scans,
                 (select md5(string_agg(r::text, ',' order by r.id)) from scan_refusals r) as refusals,
                 (select md5(string_agg(a::text, ',' order by a.id)) from audit_log a) as audit,
                 (select md5(string_agg(p::text, ',' order by p.id)) from (select id, name, qr_token, gps_mode, is_active from points) p) as points,
                 (select md5(string_agg(p::text, ',' order by p.id)) from (select id, company, contact_name, is_demo from providers) p) as providers`)
        return rows[0]
      } finally {
        await client.end()
      }
    }
    expect(await fingerprint(again)).toEqual(await fingerprint(schema))
  }, 120_000)

  it('refuses to replace a schema that it did not make, and leaves it as it was', async () => {
    const theirs = scratch()
    await control.query(`create schema ${theirs}`)
    try {
      await control.query(`create table ${theirs}.kept (id int)`)
      await expect(generateYearData({ schema: theirs, scale: 1, today: TODAY, connectionString: url() })).rejects.toThrow(/not made by/)
      await expect(dropYearData(control, theirs)).rejects.toThrow(/not made by/)
      expect((await control.query('select to_regclass($1) is not null as kept', [`${theirs}.kept`])).rows[0].kept).toBe(true)
    } finally {
      await control.query(`drop schema ${theirs} cascade`)
    }
  })
})
