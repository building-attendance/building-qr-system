import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { loadEnv } from '../server/loadEnv.js'
import { migrate, MigrationError } from '../server/migrate.js'
import { setPool, poolConfig, guardPool, createPool } from '../server/db.js'
import { assertNotProduction } from '../server/dbGuard.js'
import { setGoogleVerifier } from '../server/google.js'
import { AGENT_KEY_MAX_PER_MINUTE } from '../server/config.js'

loadEnv()

/**
 * The role that the server's pool of the tests runs as (db/migrations/016_runtime_roles.sql): it owns nothing and holds only the
 * privileges that the code needs, so a route that needs a grant the migration does not give fails here, not in production.
 */
export const RUNTIME_ROLE = 'app_runtime'

/**
 * Creates a throwaway schema on the real database, migrates it, and points the server at it.
 *  - `pool` is the server's pool (setPool): every connection of it does `set role app_runtime` when it opens, so the routes,
 *    the jobs and whatever a test runs through it have exactly the grants of 016 and are not the owner of any table.
 *  - `ownerPool` connects as the owner, which ran the migrations: for a test of what the owner can do (the append-only
 *    triggers are the guard against the owner) and for setup that the app itself never does.
 */
export async function setupDb() {
  // The pooled URL (pgbouncer) does not support per-connection search_path, so use the direct one.
  const raw = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL(_UNPOOLED) is not set (see .env.local)')
  const schema = 't_' + randomBytes(6).toString('hex')
  const control = guardPool(new pg.Pool(poolConfig(raw)))
  // Never create anything on a database that is marked as production (see server/dbGuard.js).
  try {
    await assertNotProduction(control)
  } catch (err) {
    await control.end()
    throw err
  }
  await control.query(`create schema ${schema}`)
  // The app's own kind of pool (server/db.js), so that every test also runs through the query limits of every statement. The
  // owner's pool migrates, as the production build does.
  const ownerPool = createPool({ ...poolConfig(raw, schema), max: 3 })
  try {
    await migrate(ownerPool)
  } catch (err) {
    // A MigrationError says the file and the SQLSTATE only (server/migrate.js). A test database holds fake data, so say why too,
    // or a broken new migration would fail every test file with no reason.
    if (err instanceof MigrationError) console.error(`${err.message}. Database message: ${err.databaseMessage}`)
    throw err
  }
  // `set role app_runtime` as the session starts: a startup option of the connection, after the search_path, so that it holds
  // before the first statement of every connection the pool opens, and a connection that cannot take the role is refused
  // instead of running as the owner. `reset role` in a test goes back to app_runtime, the session's own default.
  const { options, ...runtime } = poolConfig(raw, schema)
  const pool = createPool({ ...runtime, options: `${options} -c role=${RUNTIME_ROLE}`, max: 6 })
  try {
    const { rows: who } = await pool.query('select current_user as role')
    if (who[0].role !== RUNTIME_ROLE) throw new Error(`The server's pool of the tests runs as ${who[0].role}, not ${RUNTIME_ROLE}`)
  } catch (err) {
    // No test runs on a pool that is not the role: leave nothing behind and fail the file.
    await pool.end()
    await ownerPool.end()
    await control.query(`drop schema ${schema} cascade`)
    await control.end()
    throw err
  }
  setPool(pool)
  // Tests sign in "with Google" by presenting the e-mail as the credential.
  setGoogleVerifier(async (credential) => ({ email: String(credential).toLowerCase(), name: 'Test Admin', sub: 'sub-' + String(credential).toLowerCase() }))
  return {
    pool,
    ownerPool,
    schema,
    async teardown() {
      setGoogleVerifier(null)
      await pool.end()
      await ownerPool.end()
      await control.query(`drop schema ${schema} cascade`)
      await control.end()
    },
  }
}

function mockRes() {
  const headers = {}
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  return {
    statusCode: 200,
    setHeader: (k, v) => (headers[k.toLowerCase()] = v),
    getHeader: (k) => headers[k.toLowerCase()],
    end(body) {
      this.body = body
      resolveDone()
    },
    headers,
    done,
  }
}

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

/**
 * Calls the API handler directly (no network). Each call comes from a fresh address unless `ip` is given.
 * `onBodyRead` is called each time something reads `req.body` (the router does, once, when it builds the context of a
 * handler), so a test can tell whether a request got that far. `now` is the clock that the router measures a slow request with
 * (handle() in server/router.js); left out, it is the real one.
 */
export async function call(method, path, { body, token, cookie, headers = {}, ip = randomIp(), badJsonBody = false, onBodyRead, now } = {}) {
  const { handle } = await import('../server/index.js')
  const req = {
    method,
    url: path,
    headers: {
      host: 'test.local',
      ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      'x-forwarded-for': ip,
      ...headers,
    },
    socket: { remoteAddress: ip },
  }
  // On Vercel `req.body` is a getter that throws when the JSON is malformed.
  if (badJsonBody) Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Unexpected token') } })
  else if (onBodyRead) {
    Object.defineProperty(req, 'body', {
      get() {
        onBodyRead()
        return body
      },
    })
  } else req.body = body
  const res = mockRes()
  await handle(req, res, now)
  await res.done
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    /* text response */
  }
  return { status: res.statusCode, json, text: res.body, headers: res.headers }
}

export async function seedAdmin(pool, email = 'admin@test.local') {
  await pool.query('insert into admins (email, name) values ($1, $2)', [email, 'Test Admin'])
  return { email }
}

/** Signs in through the real /admin/google endpoint and returns the Cookie header to send back. */
export async function adminCookie(email = 'admin@test.local') {
  const r = await call('POST', '/api/admin/google', { body: { credential: email } })
  if (r.status !== 200) throw new Error('admin sign-in failed: ' + r.text)
  return String(r.headers['set-cookie']).split(';')[0]
}

/**
 * Mints an agent key the way the committee does, through the real POST /api/admin/api-keys (a key of the Agent tab), and returns
 * the key (shown once, as the API shows it) with the id of its row. `cookie` is the committee's session (adminCookie()).
 * @param {string} cookie
 * @param {string} [name]
 * @returns {Promise<{ key: string, id: string }>}
 */
export async function mintAgentKey(cookie, name = 'test agent') {
  const r = await call('POST', '/api/admin/api-keys', { cookie, body: { name } })
  if (r.status !== 201) throw new Error('minting an agent key failed: ' + r.text)
  return { key: r.json.key, id: r.json.api_key.id }
}

/** Revokes an agent key through the real route (POST /api/admin/api-keys/:id/revoke): the key then answers api_key_invalid. */
export async function revokeAgentKey(cookie, id) {
  const r = await call('POST', `/api/admin/api-keys/${id}/revoke`, { cookie })
  if (r.status !== 200) throw new Error('revoking an agent key failed: ' + r.text)
}

/**
 * Puts an agent key at the limit of requests per minute (AGENT_KEY_MAX_PER_MINUTE), so that its next request gets the 429
 * `rate_limited`, without sending that many requests. The usage is written for the current minute AND the next one, so a test
 * that crosses a minute boundary between this call and its request still finds the key at the limit.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<unknown> }} pool  the pool of the throwaway schema
 * @param {string} keyId  the id of the key (mintAgentKey)
 */
export async function putKeyAtMinuteLimit(pool, keyId) {
  await pool.query(
    `insert into api_key_usage (key_id, minute, requests)
     select $1::uuid, date_trunc('minute', now()) + make_interval(mins => m), $2::int from generate_series(0, 1) as m
     on conflict (key_id, minute) do update set requests = excluded.requests`,
    [keyId, AGENT_KEY_MAX_PER_MINUTE],
  )
}
