// The preview migration: what scripts/vercel-build.mjs runs in a Vercel preview build, after the app was built and the
// gate (productionBuildDecision) answered `skip` (ADR 0009, docs/adr/0009-a-preview-on-the-non-production-database.md).
// It is guarded like the gate (AGENTS.md): a change must not loosen any of these conditions.
//
// - A preview build migrates only its own database, and only when every database its environment names is marked
//   `nonprod`. "Names" means every value that starts with postgres:// or postgresql://, under any variable name (the Neon
//   integration also sets POSTGRES_URL and its friends), and the sets of PGHOST, PGHOST_UNPOOLED and POSTGRES_HOST.
// - Fail closed: a value that starts like a Postgres URL but does not parse, a database that cannot be reached, a marker
//   read that fails or times out, a database marked `production`, one with no marker: each refuses the build before it
//   applies anything, so the deployment never serves. Only readEnvironmentMarker's answer `nonprod` passes.
// - The database it migrates is DATABASE_URL_UNPOOLED, a direct host (never -pooler: the migration lock needs a session of
//   its own), and its marker is read again on the session that then migrates.
// - A preview with no database in its environment touches nothing, as before ADR 0009.
// - There is no check against GitHub: a preview runs the branch's own, unmerged migrations on purpose.
// - It never writes a marker, never logs a value: only variable names, masked hosts (maskDatabaseHost), file names and,
//   through buildFailureText, an SQLSTATE. Nothing here reads process.env: the build script passes the environment.
// - Not a check: whether the build is of a fork's branch named `preview` (Vercel does not document what it would get).
//   That stays a rule of ADR 0009 (the owner never authorizes a fork's deployment), as does what a branch's own copy of
//   this file could do (ADR 0002, "What the gate is for").
import pg from 'pg'
import { normalizeConnectionString, guardPool } from './db.js'
import { DEFAULT_DIR, migrate } from './migrate.js'
import { MARKER_TABLE, markerTableName, maskDatabaseHost, readEnvironmentMarker } from './dbGuard.js'
import { SafeMessageError, failureLabel } from './logSafe.js'

const POSTGRES_URL = /^\s*postgres(?:ql)?:\/\//i
// The variables that the deployment itself connects with (server/db.js) and the one this file migrates: when one is set,
// it must be a Postgres URL, so that a database is never named in a form this file does not read.
const CONNECTION_VARIABLES = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_UNPOOLED']
// A host variable and the variables that complete it: PG* is what pg itself reads, POSTGRES_* what the Neon integration sets.
const HOST_SETS = [
  ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT'],
  ['PGHOST_UNPOOLED', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT'],
  ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE', 'POSTGRES_PORT'],
]
const CONNECT_TIMEOUT_MS = 20_000
const MARKER_READ_TIMEOUT_MS = 20_000

const present = (value) => typeof value === 'string' && value.length > 0

/**
 * The host that pg connects to for `connectionString` (a `host` query parameter wins over the host of the URL, as in
 * pg-connection-string), and the database it reaches: the URL without its password, and without its user unless the URL
 * names no database (pg then takes the user's name). Two URLs with the same key differ only in their credentials, so they
 * reach the same database. Null when the value is not a URL or names no host.
 */
function target(connectionString) {
  try {
    const url = new URL(connectionString)
    const host = url.searchParams.get('host') || url.hostname
    if (!host) return null
    url.password = ''
    if (url.pathname.length > 1) url.username = ''
    return { host, key: url.href }
  } catch {
    return null
  }
}

/** `maskDatabaseHost` of the host that pg connects to. */
const maskedHost = (connectionString) => maskDatabaseHost(`postgres://${target(connectionString)?.host ?? ''}`)

/**
 * Every database that `env` names, as `[{ variables, connectionStrings }]`: each value that starts with postgres:// or
 * postgresql:// (any variable name), and a URL built from each host set (PGHOST, PGHOST_UNPOOLED, POSTGRES_HOST) that is
 * set. Values that differ only in their credentials (see `target`) are one database, with all their variable names.
 * Throws a SafeMessageError that names the variable, never the value, for a value that starts like a Postgres URL but is not
 * a valid one with a host (white space around it included), and for a connection variable of the deployment that is set
 * but is not a Postgres URL.
 * @param {Record<string, string | undefined>} env
 */
export function previewDatabases(env) {
  const found = new Map()
  const add = (variable, connectionString) => {
    const reached = connectionString === connectionString.trim() ? target(connectionString) : null
    if (!reached) throw new SafeMessageError(`${variable} names a Postgres database, but not as a valid URL with a host`)
    const entry = found.get(reached.key) ?? { variables: [], connectionStrings: [] }
    entry.variables.push(variable)
    if (!entry.connectionStrings.includes(connectionString)) entry.connectionStrings.push(connectionString)
    found.set(reached.key, entry)
  }
  for (const [variable, value] of Object.entries(env)) {
    if (typeof value === 'string' && POSTGRES_URL.test(value)) add(variable, value)
    else if (CONNECTION_VARIABLES.includes(variable) && present(value)) {
      throw new SafeMessageError(`${variable} is set but is not a postgres:// or postgresql:// connection URL`)
    }
  }
  for (const [host, user, password, database, port] of HOST_SETS) {
    if (!present(env[host])) continue
    const part = (name) => encodeURIComponent(env[name] ?? '')
    const atPort = present(env[port]) ? `:${env[port]}` : ''
    add(host, `postgresql://${part(user)}:${part(password)}@${env[host]}${atPort}/${part(database)}?sslmode=require`)
  }
  return [...found.values()]
}

/** A pool of one connection to `connectionString`: a Neon compute that wakes from sleep needs a few seconds. */
function defaultOpenPool(connectionString) {
  return guardPool(
    new pg.Pool({ connectionString: normalizeConnectionString(connectionString), max: 1, connectionTimeoutMillis: CONNECT_TIMEOUT_MS }),
  )
}

/** `db` (a pool or a client) whose statements end after MARKER_READ_TIMEOUT_MS, for readEnvironmentMarker only. */
const timed = (db) => ({ query: (text) => db.query({ text, query_timeout: MARKER_READ_TIMEOUT_MS }) })

/** What a database is called in a message: its variables and its masked host, never its URL. */
const named = ({ variables, connectionStrings }) => `${variables.join(', ')} (${maskedHost(connectionStrings[0])})`

/** Throws unless `marker` is `nonprod`: the one answer that lets a preview build go on. */
function requireNonprod(marker, database) {
  if (marker === 'nonprod') return
  throw new SafeMessageError(
    marker === 'production'
      ? `${named(database)} is marked production: a preview build never touches production. Remove it from the ` +
          'Preview environment variables in Vercel'
      : `${named(database)} has no environment marker: a preview build migrates only a database marked nonprod`,
  )
}

/**
 * The marker of `database`, read through the first of its connection strings that can read it (they differ only in their
 * credentials, and a role may not be allowed to read the marker). Throws when none can.
 */
async function readMarker(database, table, openPool) {
  let failure
  for (const connectionString of database.connectionStrings) {
    let pool
    try {
      pool = openPool(connectionString)
      return await readEnvironmentMarker(timed(pool), table)
    } catch (err) {
      failure = err
    } finally {
      await pool?.end().catch(() => {})
    }
  }
  throw new SafeMessageError(
    `The marker of ${named(database)} could not be read (${failureLabel(failure)}): a preview build migrates only when ` +
      'every database its environment names is marked nonprod',
  )
}

/**
 * @typedef {object} MigratePreviewOptions
 * @property {Record<string, string | undefined>} env  the build environment (the caller passes `process.env`)
 * @property {(message: string) => void} [log]  default: no log
 * @property {string} [markerTable]  default public.environment_marker
 * @property {string} [dir]  the folder of the migrations, default db/migrations
 * @property {(connectionString: string) => pg.Pool} [openPool]  for the tests only
 */

/**
 * Migrates the preview's own database, DATABASE_URL_UNPOOLED, after every database that `env` names was read and found
 * marked `nonprod` (see the header). With no database in `env` it returns `[]` and connects to nothing. Returns the names of
 * the migrations it applied. `markerTable`, `dir` and `openPool` are for the tests, which point them at a table and a folder
 * of their own and at their own database.
 * @param {MigratePreviewOptions} options
 * @returns {Promise<string[]>}
 */
export async function migratePreview({ env, log = () => {}, markerTable = MARKER_TABLE, dir = DEFAULT_DIR, openPool = defaultOpenPool }) {
  // The name is interpolated into SQL by readEnvironmentMarker, so it is checked first (see server/dbGuard.js).
  const table = markerTableName(markerTable)
  const databases = previewDatabases(env)
  if (databases.length === 0) {
    log('Preview build: no database in its environment, so none is touched.')
    return []
  }
  const goal = env.DATABASE_URL_UNPOOLED
  if (!present(goal)) {
    throw new SafeMessageError(
      'DATABASE_URL_UNPOOLED is not set: a preview build whose environment names a database migrates that variable, ' +
        "the direct connection string of the preview's own database",
    )
  }
  if (target(goal).host.includes('-pooler')) {
    throw new SafeMessageError(
      'DATABASE_URL_UNPOOLED points at a pooled host (-pooler): the migration lock needs a direct connection, a ' +
        'session of its own',
    )
  }

  for (const database of databases) {
    requireNonprod(await readMarker(database, table, openPool), database)
    log(`Preview database: ${maskedHost(database.connectionStrings[0])} (${database.variables.join(', ')}), marker nonprod`)
  }

  const pool = openPool(goal)
  try {
    // The marker is read again in the session that migrates: migrate() is handed this one client, already checked.
    const client = await pool.connect()
    let checked = false
    try {
      const marker = await readEnvironmentMarker(timed(client), table)
      requireNonprod(marker, { variables: ['DATABASE_URL_UNPOOLED'], connectionStrings: [goal] })
      checked = true
    } finally {
      if (!checked) client.release(true)
    }
    const applied = await migrate({ connect: async () => client }, dir)
    log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.')
    return applied
  } finally {
    await pool.end()
  }
}
