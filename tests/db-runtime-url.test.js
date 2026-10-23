// Which database URL, and which role, the app's pool connects with (appPoolConfig and getPool in server/db.js):
//  - a deployment takes DATABASE_URL_RUNTIME when it is set (the login role that is a member of app_runtime, migration 016) and
//    falls back to DATABASE_URL, so a copy that never set the variable, and the deployment that keeps serving while a new one is
//    built, connect exactly as before;
//  - local development (DB_SCHEMA) never reads DATABASE_URL_RUNTIME, and only there the dev-only switch (the option runtimeRole,
//    which only `node server/dev.mjs --runtime-role` passes) runs every connection as app_runtime: without a scratch schema it is
//    refused, and no variable of the environment turns it on.
// The URLs are made up: nothing here connects, except the last test, which uses the throwaway schema of setupDb().
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupDb, RUNTIME_ROLE } from './helpers.js'
import { appPoolConfig, createPool, getPool, setPool, RUNTIME_ROLE as SERVER_RUNTIME_ROLE } from '../server/db.js'

const OWNER_URL = 'postgresql://owner-user:owner-pass@owner-host.example.test/db'
const DIRECT_URL = 'postgresql://owner-user:owner-pass@direct-host.example.test/db'
const RUNTIME_URL = 'postgresql://runtime-user:runtime-pass@runtime-host.example.test/db'

describe('appPoolConfig: a deployment (no DB_SCHEMA)', () => {
  it('connects with DATABASE_URL_RUNTIME when it is set', () => {
    const config = appPoolConfig({ DATABASE_URL: OWNER_URL, DATABASE_URL_UNPOOLED: DIRECT_URL, DATABASE_URL_RUNTIME: RUNTIME_URL })
    expect(config.connectionString).toBe(RUNTIME_URL)
    expect(config).not.toHaveProperty('options')
  })

  it('falls back to DATABASE_URL when DATABASE_URL_RUNTIME is not set or empty, exactly as before', () => {
    for (const env of [{ DATABASE_URL: OWNER_URL }, { DATABASE_URL: OWNER_URL, DATABASE_URL_RUNTIME: '' }]) {
      const config = appPoolConfig(env)
      expect(config.connectionString, JSON.stringify(Object.keys(env))).toBe(OWNER_URL)
      expect(config).not.toHaveProperty('options')
    }
  })

  it('never takes the direct URL of the migrations (DATABASE_URL_UNPOOLED)', () => {
    expect(appPoolConfig({ DATABASE_URL: OWNER_URL, DATABASE_URL_UNPOOLED: DIRECT_URL }).connectionString).toBe(OWNER_URL)
  })

  it('refuses the dev-only switch, so a deployment can never take the role that way', () => {
    expect(() => appPoolConfig({ DATABASE_URL: OWNER_URL }, { runtimeRole: true })).toThrow(/scratch schema/)
    expect(() => appPoolConfig({ DATABASE_URL: OWNER_URL, DATABASE_URL_RUNTIME: RUNTIME_URL }, { runtimeRole: true })).toThrow(/scratch schema/)
  })

  it('is turned to app_runtime by no variable of the environment', () => {
    for (const DB_RUNTIME_ROLE of ['1', 'true', 'app_runtime']) {
      expect(appPoolConfig({ DATABASE_URL: OWNER_URL, DB_RUNTIME_ROLE })).not.toHaveProperty('options')
      expect(appPoolConfig({ DATABASE_URL: OWNER_URL, DB_SCHEMA: 'e2e', DB_RUNTIME_ROLE }).options).toBe('-c search_path=e2e')
    }
  })

  it('refuses to start without any URL, and the message names the variable and no value', () => {
    expect(() => appPoolConfig({})).toThrow('DATABASE_URL is not set')
    expect(() => appPoolConfig({ DATABASE_URL_RUNTIME: '' })).toThrow('DATABASE_URL is not set')
  })
})

describe('appPoolConfig: local development (DB_SCHEMA)', () => {
  it('never reads DATABASE_URL_RUNTIME: the direct URL, else DATABASE_URL, with the scratch schema', () => {
    const env = { DATABASE_URL: OWNER_URL, DATABASE_URL_UNPOOLED: DIRECT_URL, DATABASE_URL_RUNTIME: RUNTIME_URL, DB_SCHEMA: 'dev_ui' }
    expect(appPoolConfig(env)).toMatchObject({ connectionString: DIRECT_URL, options: '-c search_path=dev_ui' })
    const noDirect = { DATABASE_URL: OWNER_URL, DATABASE_URL_RUNTIME: RUNTIME_URL, DB_SCHEMA: 'dev_ui' }
    expect(appPoolConfig(noDirect).connectionString).toBe(OWNER_URL)
  })

  it('runs as app_runtime with the switch (a startup option after the search_path), and as the URL\'s role without it', () => {
    const env = { DATABASE_URL_UNPOOLED: DIRECT_URL, DB_SCHEMA: 'e2e' }
    expect(appPoolConfig(env, { runtimeRole: true })).toMatchObject({ connectionString: DIRECT_URL, options: '-c search_path=e2e -c role=app_runtime' })
    for (const options of [undefined, {}, { runtimeRole: false }]) {
      expect(appPoolConfig(env, options).options, JSON.stringify(options)).toBe('-c search_path=e2e')
    }
  })

  it('names the same role as the tests and migration 016', () => {
    expect(SERVER_RUNTIME_ROLE).toBe(RUNTIME_ROLE)
  })
})

describe('getPool', () => {
  afterEach(() => {
    setPool(undefined)
    vi.unstubAllEnvs()
  })

  it('builds the app\'s pool from DATABASE_URL_RUNTIME when it is set, and from DATABASE_URL when it is not (it opens no connection)', async () => {
    vi.stubEnv('DB_SCHEMA', '')
    vi.stubEnv('DATABASE_URL', OWNER_URL)
    vi.stubEnv('DATABASE_URL_RUNTIME', RUNTIME_URL)
    setPool(undefined)
    const runtime = getPool()
    expect(runtime.options.connectionString).toBe(RUNTIME_URL)
    expect(runtime.options.options).toBeUndefined()
    await runtime.end()

    vi.stubEnv('DATABASE_URL_RUNTIME', '')
    setPool(undefined)
    const owner = getPool()
    expect(owner.options.connectionString).toBe(OWNER_URL)
    await owner.end()
  })
})

describe('the dev-only switch on a real database', () => {
  let db
  beforeAll(async () => {
    db = await setupDb()
  })
  afterAll(async () => db?.teardown())

  it('connects as app_runtime, which does not own the tables, while the same settings without it connect as the owner', async () => {
    const env = { DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED, DATABASE_URL: process.env.DATABASE_URL, DB_SCHEMA: db.schema }
    const switched = createPool(appPoolConfig(env, { runtimeRole: true }))
    const plain = createPool(appPoolConfig(env))
    try {
      const sql =
        "select current_user as role, pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('scans')), 'MEMBER') as owns"
      const [asRuntime] = (await switched.query(sql)).rows
      expect(asRuntime).toEqual({ role: RUNTIME_ROLE, owns: false })
      const [asOwner] = (await plain.query(sql)).rows
      expect(asOwner.role).not.toBe(RUNTIME_ROLE)
      expect(asOwner.owns).toBe(true)
      // What 016 refuses app_runtime: an append-only table cannot be emptied or have its rows deleted.
      await expect(switched.query('delete from audit_log')).rejects.toMatchObject({ code: '42501' })
    } finally {
      await switched.end()
      await plain.end()
    }
  })
})
