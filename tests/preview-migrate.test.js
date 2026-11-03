// The preview migration (server/previewMigrate.js, ADR 0009): refusals first, then the migration, against a throwaway schema.
// The environments hold fake URLs only (hosts under example.test). migratePreview takes its pool as a parameter, and the
// tests pass one that opens every fake host on the test database, in the throwaway schema, so that one database can play
// several: the marker table of the tests is a view in that schema whose one row is the setting
// `app.preview_test_marker` of the connection, which the pool sets from the fake host (`ep-nonprod-*` nonprod, `ep-prod-*`
// production, `ep-unmarked-*` none). `ep-down-*` is a port where nothing listens. public.environment_marker is never touched.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { setupDb } from './helpers.js'
import { guardPool, normalizeConnectionString } from '../server/db.js'
import { maskDatabaseHost } from '../server/dbGuard.js'
import { SafeMessageError } from '../server/logSafe.js'
import { buildFailureText } from '../server/productionMigrate.js'
import { migratePreview, previewDatabases } from '../server/previewMigrate.js'

const PASSWORD = 'fake-password-000'
const fakeUrl = (label, query = 'sslmode=require') => `postgresql://fake_user:${PASSWORD}@${label}.example.test/fakedb?${query}`
const NONPROD = fakeUrl('ep-nonprod-000001')
const NONPROD_POOLED = fakeUrl('ep-nonprod-000001-pooler')
const PRODUCTION = fakeUrl('ep-prod-000002')
const UNMARKED = fakeUrl('ep-unmarked-000003')
const DOWN = fakeUrl('ep-down-000004')
const PG_SET = { PGUSER: 'fake_user', PGPASSWORD: PASSWORD, PGDATABASE: 'fakedb' }

describe('previewDatabases', () => {
  it('finds every Postgres URL under any name and the PG* set, and reads an identical value once', () => {
    const env = {
      DATABASE_URL: NONPROD_POOLED,
      POSTGRES_URL: NONPROD_POOLED,
      DATABASE_URL_UNPOOLED: NONPROD,
      SOMETHING_ELSE: 'POSTGRES://fake_user@ep-unmarked-000003.example.test/fakedb',
      PGHOST: 'ep-prod-000002.example.test',
      ...PG_SET,
      NOT_A_DATABASE: 'https://ep-prod-000002.example.test/',
    }
    const found = previewDatabases(env)
    expect(found.map((d) => d.variables)).toEqual([['DATABASE_URL', 'POSTGRES_URL'], ['DATABASE_URL_UNPOOLED'], ['SOMETHING_ELSE'], ['PGHOST']])
    expect(new URL(found[3].connectionString)).toMatchObject({ hostname: 'ep-prod-000002.example.test', username: 'fake_user' })
    expect(previewDatabases({ VERCEL_ENV: 'preview', PGUSER: 'fake_user' })).toEqual([])
  })

  it('refuses a value it cannot read, naming the variable and never the value', () => {
    const cases = [
      [{ POSTGRES_URL: `postgresql://fake_user:${PASSWORD}@/fakedb` }, /POSTGRES_URL names a Postgres database, but no host/],
      [{ POSTGRES_URL: `postgres://fake_user:${PASSWORD}@ep-prod-000002.example.test:99999/fakedb` }, /POSTGRES_URL names/],
      [{ DATABASE_URL: `host=ep-prod-000002.example.test password=${PASSWORD}` }, /DATABASE_URL is set but is not a postgres/],
      [{ DATABASE_URL_RUNTIME: 'mysql://fake_user@ep-prod-000002.example.test/fakedb' }, /DATABASE_URL_RUNTIME is set/],
      [{ PGHOST: 'ep-prod-000002.example.test', PGPORT: 'not-a-port' }, /PGHOST names/],
    ]
    for (const [env, message] of cases) {
      const err = (() => {
        try {
          previewDatabases(env)
        } catch (e) {
          return e
        }
      })()
      expect(err, JSON.stringify(Object.keys(env))).toBeInstanceOf(SafeMessageError)
      expect(err.message).toMatch(message)
      expect(err.message).not.toContain(PASSWORD)
      expect(err.message).not.toContain('ep-prod-000002')
    }
  })
})

describe('migratePreview against a throwaway schema', () => {
  let db
  let raw
  let tmpDir
  let markerTable
  let opened // the fake URLs that a pool was opened for
  let migrationMarker // when set, what the connection that migrates reads as its marker

  const openPool = (connectionString, extra = {}) => {
    opened.push(connectionString)
    const host = new URL(connectionString).hostname
    const forMarker = 'query_timeout' in extra
    const marker = !forMarker && migrationMarker ? migrationMarker : (host.match(/^ep-(nonprod|prod)-/)?.[1] ?? null)
    const setting = marker ? ` -c app.preview_test_marker=${marker === 'prod' ? 'production' : marker}` : ''
    const options = encodeURIComponent(`-c search_path=${db.schema}${setting}`)
    const real = host.startsWith('ep-down-') ? 'postgres://nobody:nothing@127.0.0.1:1/none' : `${raw}${raw.includes('?') ? '&' : '?'}options=${options}`
    return guardPool(new pg.Pool({ connectionString: normalizeConnectionString(real), max: 1, connectionTimeoutMillis: 10_000, ...extra }))
  }
  const run = (env) => {
    const lines = []
    const promise = migratePreview({ env, log: (line) => lines.push(line), markerTable, dir: tmpDir, openPool })
    return { lines, promise }
  }
  const migrationRows = async () =>
    (await db.ownerPool.query("select name from schema_migrations where name like 'pv\\_%' order by name")).rows.map((r) => r.name)
  const present = async (table) => (await db.ownerPool.query('select to_regclass($1) is not null as present', [table])).rows[0].present
  /** Refused, before anything is applied, with a message that names `variable` and the masked host only. */
  const expectRefused = async (env, variable, message) => {
    const { lines, promise } = run(env)
    const err = await promise.catch((e) => e)
    expect(err, variable).toBeInstanceOf(SafeMessageError)
    expect(buildFailureText(err)).toBe(err.message)
    expect(err.message).toMatch(message)
    expect(err.message).toContain(variable)
    for (const text of [err.message, ...lines]) {
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toMatch(/ep-(?:prod|unmarked|down)-00000/)
    }
    expect(await migrationRows()).toEqual([])
    expect(await present(`${db.schema}.pv_first`)).toBe(false)
    return err
  }

  beforeAll(async () => {
    db = await setupDb()
    raw = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
    markerTable = `${db.schema}.environment_marker`
    // Never the real marker: the view is in the throwaway schema, whose name is the random one of setupDb.
    expect(db.schema).toMatch(/^t_[0-9a-f]+$/)
  })
  afterAll(async () => db?.teardown())

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-migrate-'))
    fs.writeFileSync(path.join(tmpDir, 'pv_001_first.sql'), 'create table pv_first (id int primary key);')
    fs.writeFileSync(path.join(tmpDir, 'pv_002_second.sql'), 'create table pv_second (id int primary key);')
    opened = []
    migrationMarker = null
    await db.ownerPool.query(`drop table if exists pv_first, pv_second; drop view if exists ${markerTable}`)
    await db.ownerPool.query("delete from schema_migrations where name like 'pv\\_%'")
    await db.ownerPool.query(`create view ${markerTable} as select current_setting('app.preview_test_marker', true) as environment`)
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('refuses a production marker, under DATABASE_URL, under POSTGRES_URL only and under PG* only', async () => {
    const base = { VERCEL_ENV: 'preview', DATABASE_URL_UNPOOLED: NONPROD }
    const refusals = [
      [{ ...base, DATABASE_URL: PRODUCTION }, 'DATABASE_URL'],
      [{ ...base, DATABASE_URL: NONPROD_POOLED, POSTGRES_URL: PRODUCTION }, 'POSTGRES_URL'],
      [{ ...base, PGHOST: 'ep-prod-000002.example.test', ...PG_SET }, 'PGHOST'],
    ]
    for (const [env, variable] of refusals) {
      const err = await expectRefused(env, variable, /is marked production: a preview build never touches production/)
      expect(err.message).toContain(maskDatabaseHost(PRODUCTION))
    }
  })

  it('refuses a database with no marker row, one with no marker table, and one it cannot read', async () => {
    await expectRefused({ DATABASE_URL_UNPOOLED: NONPROD, POSTGRES_PRISMA_URL: UNMARKED }, 'POSTGRES_PRISMA_URL', /has no environment marker/)
    await expectRefused({ DATABASE_URL_UNPOOLED: NONPROD, POSTGRES_URL_NON_POOLING: DOWN }, 'POSTGRES_URL_NON_POOLING', /could not be read \(\w+\)/)
    await db.ownerPool.query(`drop view ${markerTable}`)
    await expectRefused({ DATABASE_URL_UNPOOLED: NONPROD }, 'DATABASE_URL_UNPOOLED', /has no environment marker/)
  })

  it('refuses before it connects without DATABASE_URL_UNPOOLED, or with a pooled one', async () => {
    await expectRefused({ DATABASE_URL: NONPROD_POOLED }, 'DATABASE_URL_UNPOOLED is not set', /migrates that variable/)
    await expectRefused({ DATABASE_URL_UNPOOLED: NONPROD_POOLED }, 'DATABASE_URL_UNPOOLED', /pooled host \(-pooler\)/)
    expect(opened).toEqual([])
  })

  it('reads the marker again on the connection that migrates', async () => {
    migrationMarker = 'production'
    await expectRefused({ DATABASE_URL_UNPOOLED: NONPROD }, 'DATABASE_URL_UNPOOLED', /is marked production/)
  })

  it('touches nothing when its environment names no database', async () => {
    const connect = vi.spyOn(pg.Pool.prototype, 'connect')
    try {
      await expect(run({ VERCEL_ENV: 'preview', PGUSER: 'fake_user' }).promise).resolves.toEqual([])
      expect(connect).not.toHaveBeenCalled()
      expect(opened).toEqual([])
    } finally {
      connect.mockRestore()
    }
  })

  it('migrates when every database is nonprod, says so without a URL or a password, and is up to date the second time', async () => {
    const env = { DATABASE_URL: NONPROD_POOLED, DATABASE_URL_UNPOOLED: NONPROD, PGHOST: 'ep-nonprod-000001.example.test', ...PG_SET }
    const first = run(env)
    await expect(first.promise).resolves.toEqual(['pv_001_first.sql', 'pv_002_second.sql'])
    expect(await present(`${db.schema}.pv_first`)).toBe(true)
    const log = first.lines.join('\n')
    expect(log).toContain(`Preview database: ${maskDatabaseHost(NONPROD)} (DATABASE_URL_UNPOOLED), marker nonprod`)
    expect(log).toContain('Applied: pv_001_first.sql, pv_002_second.sql')
    const { username, password } = new URL(raw)
    for (const secret of [PASSWORD, 'fake_user', NONPROD, raw, username, password].filter(Boolean)) expect(log).not.toContain(secret)

    const second = run(env)
    await expect(second.promise).resolves.toEqual([])
    expect(second.lines).toContain('Database is up to date.')
  })
})

describe('the build wiring', () => {
  const code = (file) =>
    fs
      .readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it('scripts/vercel-build.mjs runs migratePreview only for a preview build, and prints a failure only through buildFailureText', () => {
    const source = code('../scripts/vercel-build.mjs')
    expect(source).toContain("if (action === 'skip' && env.VERCEL_ENV === 'preview') {")
    expect(source).toContain('await migratePreview({ env, log: console.log })')
    expect(source).toContain('Preview migration failed: ${buildFailureText(err)}')
    expect(code('../server/previewMigrate.js')).not.toMatch(/process\.env|\b(?:master|main)\b/)
  })

  it('vercel.json deploys the branch preview by itself, besides the production branch', () => {
    const { git } = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    expect(git.deploymentEnabled).toEqual({ '**': false, master: true, main: true, preview: true })
  })
})
