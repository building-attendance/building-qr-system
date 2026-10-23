// What GET /api/health/db needs besides its handler (server/index.js): the commit, the time limit, and the guard of that
// route. The route is the smoke test after a deploy, so a database that is down or does not answer must be answered with
// a 503 in its own shape, also when the failure happens while the key is being looked up. The router runs the guard before
// the handler (server/access.js), so the key lookup and its time limit live here, in the guard, and not in the handler.
// There is ONE time limit for the whole request, the key lookup and the health query together: the guard writes down when
// it runs out (deadlines), and the handler races its query against what is left (timeLeft).
import { requireApiKey } from './auth.js'
import { Answer, ApiError } from './http.js'
import { failureLabel } from './logSafe.js'

export const DB_HEALTH_TIMEOUT_MS = 5_000

/** The error of a request that used up its time limit. It has a code, because the log says only the code or name of an error. */
export const healthTimeout = () => Object.assign(new Error('timed out'), { code: 'timeout' })

// The first 7 characters of the commit that Vercel built (only a deployment from Git has one), else null.
export const commit = () => (process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null)

/**
 * The one query of GET /api/health/db (after the key): the database answers, its newest migration, and whether the role the app
 * runs as (`current_user`) owns any table of the app's schema (the first of its search_path: public in a deployment), so that
 * audit_log and scan_refusals, whose append-only triggers an owner could switch off, count as much as any other. A member of the
 * owner's role counts as the owner, because it can act as that role, and so does a superuser (pg_has_role says true for one). A
 * deployment with DATABASE_URL_RUNTIME (a login role that is a member of app_runtime only, migration 016) answers false; one
 * that connects with the owner's DATABASE_URL answers true.
 */
export const DB_HEALTH_SQL =
  'select 1 as ok, (select name from schema_migrations order by name desc limit 1) as migration, ' +
  'exists (select 1 from pg_catalog.pg_class c where c.relnamespace = pg_catalog.to_regnamespace(current_schema()) ' +
  "and c.relkind in ('r', 'p') and pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER')) as owns_tables"

/**
 * The answer of GET /api/health/db, field by field: never the row as it is, so a column that the query gains later does not reach
 * the answer by itself. `owns_tables` is a boolean and nothing else: not the role's name, not the host. It came after the other
 * fields, so a reader from before it (an old smoke run) ignores it.
 * @param {{ migration: string | null, owns_tables: boolean | null }} row  the row of DB_HEALTH_SQL
 */
export const dbHealthAnswer = (row) => ({ ok: true, commit: commit(), migration: row.migration, owns_tables: row.owns_tables === true })

// When the time limit of a request runs out (a time in ms), written down by the guard that starts it.
const deadlines = new WeakMap()

/** What is left of the time limit of this request, in ms (0 when it is used up). The whole limit when the guard has not run. */
export function timeLeft(req) {
  const deadline = deadlines.get(req)
  return deadline === undefined ? DB_HEALTH_TIMEOUT_MS : Math.max(0, deadline - Date.now())
}

/**
 * `requireApiKey` for GET /api/health/db. A missing, malformed or unknown key is refused exactly as by the plain guard (a
 * 401, and no query for a key that is not shaped like ours), and a key that is over its limit gets the 429 `rate_limited` of
 * the plain guard, not a 503: the database answered. When the lookup fails or does not finish within
 * DB_HEALTH_TIMEOUT_MS, the request is answered with the 503 of this route (`{ ok: false, commit }`) and nothing of the
 * cause: its code or name goes to the log, never its message (server/logSafe.js).
 */
export async function requireApiKeyForHealth(req) {
  let timer
  if (!deadlines.has(req)) deadlines.set(req, Date.now() + DB_HEALTH_TIMEOUT_MS)
  try {
    return await Promise.race([
      requireApiKey(req),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(healthTimeout()), DB_HEALTH_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    if (err instanceof ApiError) throw err // a refused key is a 401 (or a 429), not a database failure
    console.error(`health/db failed: ${failureLabel(err)}`)
    throw new Answer({ status: 503, json: { ok: false, commit: commit() } })
  } finally {
    clearTimeout(timer)
  }
}
