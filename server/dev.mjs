// Local API server for development: same handler as production, mounted on plain node:http.
// Vite proxies /api here (see vite.config.js). Reads DATABASE_URL from .env.local.
import http from 'node:http'
import { loadEnv } from './loadEnv.js'

loadEnv()

// `node server/dev.mjs --schema=dev_ui` runs against a scratch schema (see scripts/dev-seed.mjs).
const schemaArg = process.argv.find((a) => a.startsWith('--schema='))
if (schemaArg) {
  process.env.DB_SCHEMA = schemaArg.slice('--schema='.length)
  process.env.DEV_ADMIN_LOGIN ??= '1' // scratch mode = local development: enable the dev-only admin shortcut
}
if (process.env.DB_SCHEMA) console.log(`Using scratch schema "${process.env.DB_SCHEMA}"`)

// `--runtime-role` (with a scratch schema) runs the server as app_runtime, the role that a deployment takes with
// DATABASE_URL_RUNTIME, so that what the server does here and in the E2E tests (playwright.config.js) needs exactly the grants
// of db/migrations/016_runtime_roles.sql. It is a flag of this command and not a line of .env.local, so that the seed that runs
// before it (scripts/dev-seed.mjs, which migrates as the owner) never gets it (appPoolConfig in server/db.js).
if (process.argv.includes('--runtime-role')) {
  if (!process.env.DB_SCHEMA) {
    console.error('--runtime-role needs a scratch schema (--schema=<name>): it is for local development only')
    process.exit(1)
  }
  process.env.DB_RUNTIME_ROLE = '1'
  console.log('Running as the role app_runtime')
}

// Refuse to start on a production database (the scratch schema, if any, lives in the same database). As app_runtime the pool
// cannot read the marker (016 grants that role nothing on it), so with the switch the marker is read as the owner: the same URL
// and schema without the role, in a pool of its own that is closed right after this check.
const { getPool, createPool, appPoolConfig } = await import('./db.js')
const { assertNotProduction } = await import('./dbGuard.js')
const asRuntime = process.env.DB_RUNTIME_ROLE === '1'
const markerPool = asRuntime ? createPool(appPoolConfig({ ...process.env, DB_RUNTIME_ROLE: undefined })) : getPool()
try {
  await assertNotProduction(markerPool)
} catch (err) {
  console.error(err.message)
  process.exit(1)
} finally {
  if (asRuntime) await markerPool.end()
}

const { handle } = await import('./index.js')
const port = Number(process.env.API_PORT || 3001)

http
  .createServer((/** @type {import('./http.js').ApiRequest} */ req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const type = String(req.headers['content-type'] || '')
      if (raw && type.startsWith('application/json')) {
        try {
          req.body = JSON.parse(raw)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ error: { code: 'invalid_json', message: 'Invalid JSON' } }))
        }
      }
      handle(req, res)
    })
  })
  .listen(port, () => console.log(`API listening on http://localhost:${port}`))
