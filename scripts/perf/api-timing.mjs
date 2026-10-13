// How long the committee's screens and the agent wait for the API on a year of data: `npm run perf:api` (docs/testing.md,
// "Timing the committee and agent API"). A measurement, not a test: CI never runs it, because the timings of a shared runner are
// noise; what CI can check is the shape of a query plan, and every query that is fixed gets a unit test of its plan.
//
// For each of the two sizes of the data (x1, a real building's year, and x10: docs/testing.md), one after the other:
//   1. scripts/perf/year-data.mjs makes the scratch schema `perf_api` again and fills it with a year of invented data;
//   2. the local API (server/dev.mjs --schema=perf_api) is started on its own port, and the run signs in with the dev-only
//      shortcut of that server (it answers only when DEV_ADMIN_LOGIN is 1 and the code is not on Vercel);
//   3. every GET route that a committee screen opens (ROUTES, with the filters that the screens send), then every route of the
//      agent API (with keys minted in the scratch schema, one per route, so that no key comes near its limit of requests per
//      minute), is called RUNS times after one warm-up, one request at a time: the time is from the request to the last byte of
//      the answer, on this computer;
//   4. the same requests are made once more inside this process, through the app's own router and pool, to see which statements
//      each one runs, and every statement that reads is run again under EXPLAIN (ANALYZE, BUFFERS), in a read-only transaction
//      that is rolled back: its plan, the rows it read from the tables that grow for ever, and any full scan of them;
//   5. the server is stopped and the schema dropped (--keep leaves the schema for a look of your own).
// It prints a table for each size (median, p95, rows, the target, the rows read, the baseline) and the plan of every
// route that is over its target or reads a whole table that grows for ever. The run is written to LAST_RUN (and its tables, in
// Markdown for a pull request, to LAST_TABLES). It never writes the baseline: `npm run perf:api:baseline` does, after a run that
// passed (`--promote`, which takes only a complete run of both sizes at this checkout's commit, with every route answering 200).
//
// What it cannot show: the time of Vercel and Neon (the database here is on this computer, and production's compute is far
// smaller), or the network between the phone and the server. The numbers are a baseline to compare before and after a change on
// one computer; the plan is the evidence that does not depend on the computer.
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import http from 'node:http'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parsePort } from '../e2e-config.mjs'
import { YEAR_DATA_SCALES, YEAR_DATA_MEMBER_EMAIL, assertYearDataSchema, addDays, countYearData } from './year-data.mjs'
import { loadEnv } from '../../server/loadEnv.js'
import { assertNotProduction } from '../../server/dbGuard.js'
import { normalizeConnectionString } from '../../server/db.js'
import { isoDay } from '../../shared/datetime.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

// Away from a development server (3000, 3001), the E2E runs (3100 to 3501), the screenshots (3300, 3301) and the scan timing
// (3700, 3701); the schema is this run's alone (year-data.mjs refuses the schemas of the other tools).
export const PERF_API_PORT = 3711
export const PERF_API_SCHEMA = 'perf_api'

/** Timed calls of each route, after WARMUPS calls that are not counted. A baseline needs this many. */
export const RUNS = 20
export const WARMUPS = 1
/** A median more than LINE slower than the baseline, and slower by more than LINE_FLOOR_MS, is called out (as perf:scan does). */
export const LINE = 0.2
export const LINE_FLOOR_MS = 1

export const BASELINE = path.join(here, 'api-baseline.json')
export const LAST_RUN = path.join(root, 'node_modules/.cache/bqr-e2e/perf/last-api-timing.json')
export const LAST_TABLES = path.join(root, 'node_modules/.cache/bqr-e2e/perf/last-api-timing.md')

/**
 * The targets for the p95 of a route on this computer, in ms, set before the first measurement (13/10/2026, docs/testing.md): a
 * route that a screen opens (and every agent route) by the size of the data, and the Excel export of a year.
 */
export const TARGET_MS = Object.freeze({ route: Object.freeze({ 1: 300, 10: 1000 }), csv: Object.freeze({ 1: 5000, 10: 5000 }) })

/** The tables that are never emptied (scans, refused visits, the audit log) and the agent keys' minutes: a whole read of one grows. */
export const GROWING_TABLES = Object.freeze(['scans', 'scan_refusals', 'audit_log', 'api_key_usage'])

/** The target of a route at a size, in ms. */
export const targetFor = (route, scale) => TARGET_MS[route.target][scale]

const query = (params) => {
  const text = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
  return text ? `?${text}` : ''
}
const week = (c) => ({ from: c.weekFrom, to: c.today })
const year = (c) => ({ from: c.yearFrom, to: c.today })
const days366 = (c) => ({ from: c.countsFrom, to: c.today })

/**
 * One timed request. `pattern` is the route as server/router.js registers it, `words` says which screen (or which question of the
 * agent) it is, `target` is the kind of its target (TARGET_MS), and `path(ctx)` is the request, with the filters that the screen sends.
 * @param {'committee' | 'agent'} kind
 */
const timed = (kind) => (key, pattern, words, makePath, target = 'route') => Object.freeze({ key, kind, pattern, words, target, path: makePath })
const committee = timed('committee')
const agent = timed('agent')

// The History screen sends its filters in this order (src/admin/views/HistoryView.jsx, DEFAULTS and PAGE): from, to, the point, the
// provider, the type (accepted), then the page. The audit screen asks for pages of 50 (src/admin/views/AuditView.jsx).
const history = (c, extra = {}, range = week(c)) => `/api/admin/scans${query({ ...range, point_id: extra.point_id, provider_id: extra.provider_id, outcome: 'accepted', limit: 100, cursor: extra.cursor })}`
const audit = (extra = {}) => `/api/admin/audit${query({ ...extra, limit: 50 })}`

/** Every timed request, in the order of the run and of the table. A baseline holds every one of them, at both sizes. */
export const ROUTES = Object.freeze([
  committee('config', '/admin/config', 'sign-in screen: what it needs', () => '/api/admin/config'),
  committee('me', '/admin/me', 'every screen: who is signed in', () => '/api/admin/me'),
  committee('home', '/admin/home', 'Home: the week and the counts', () => '/api/admin/home'),
  committee('history', '/admin/scans', 'History as it opens (7 days)', (c) => history(c)),
  committee('history_more', '/admin/scans', 'History, "load more" once', (c) => history(c, { cursor: c.historyCursor })),
  committee('history_point', '/admin/scans', 'History, one point (7 days)', (c) => history(c, { point_id: c.point })),
  committee('history_provider', '/admin/scans', 'History, one provider (7 days)', (c) => history(c, { provider_id: c.provider })),
  committee('history_year', '/admin/scans', 'History, a whole year', (c) => history(c, {}, year(c))),
  committee('history_year_point', '/admin/scans', 'History, a year of one point', (c) => history(c, { point_id: c.point }, year(c))),
  committee('history_year_provider', '/admin/scans', 'History, a year of one provider', (c) => history(c, { provider_id: c.provider }, year(c))),
  committee('not_counted', '/admin/scan-refusals', 'History, "not counted" (7 days)', (c) => `/api/admin/scan-refusals${query({ ...week(c), limit: 100 })}`),
  committee('csv_year', '/admin/scans', 'History, Excel export of a year', (c) => `/api/admin/scans${query({ ...year(c), outcome: 'accepted', format: 'csv' })}`, 'csv'),
  committee('audit', '/admin/audit', 'Audit log as it opens', () => audit()),
  committee('audit_more', '/admin/audit', 'Audit log, "load more" once', (c) => audit({ cursor: c.auditCursor })),
  committee('audit_week', '/admin/audit', 'Audit log, 7 days', (c) => audit(week(c))),
  committee('audit_group_session', '/admin/audit', 'Audit log, sign-ins (a common group)', () => audit({ group: 'session' })),
  committee('audit_group_building', '/admin/audit', 'Audit log, the building (a rare group)', () => audit({ group: 'building' })),
  committee('audit_member', '/admin/audit', 'Audit log, one committee member', (c) => audit({ actor_id: c.member })),
  committee('points', '/admin/points', 'Points', () => '/api/admin/points'),
  committee('providers', '/admin/providers', 'Providers', () => '/api/admin/providers'),
  committee('provider_devices', '/admin/providers/:id/devices', "Providers, one provider's phones", (c) => `/api/admin/providers/${c.provider}/devices`),
  committee('api_keys', '/admin/api-keys', 'Agent: the keys and their use', () => '/api/admin/api-keys'),
  committee('admins', '/admin/admins', 'Committee: the members', () => '/api/admin/admins'),
  committee('building', '/admin/building', 'Committee: the building', () => '/api/admin/building'),
  agent('agent_scans', '/agent/v1/scans', 'scans, the newest 100', () => '/api/agent/v1/scans'),
  agent('agent_scans_year', '/agent/v1/scans', 'scans of a year, a page of 500', (c) => `/api/agent/v1/scans${query({ ...year(c), limit: 500 })}`),
  agent('agent_scans_csv', '/agent/v1/scans', 'scans of a year, a page of 500 as CSV', (c) => `/api/agent/v1/scans${query({ ...year(c), limit: 500, format: 'csv' })}`),
  agent('agent_counts', '/agent/v1/counts', 'counts of 366 days, the total', (c) => `/api/agent/v1/counts${query(days366(c))}`),
  agent('agent_counts_day', '/agent/v1/counts', 'counts of 366 days by day', (c) => `/api/agent/v1/counts${query({ ...days366(c), group_by: 'day' })}`),
  agent('agent_counts_provider', '/agent/v1/counts', 'counts of 366 days by provider', (c) => `/api/agent/v1/counts${query({ ...days366(c), group_by: 'provider' })}`),
  agent('agent_counts_point', '/agent/v1/counts', 'counts of 366 days by point', (c) => `/api/agent/v1/counts${query({ ...days366(c), group_by: 'point' })}`),
  agent('agent_counts_service_type', '/agent/v1/counts', 'counts of 366 days by service', (c) => `/api/agent/v1/counts${query({ ...days366(c), group_by: 'service_type' })}`),
  agent('agent_refusals', '/agent/v1/refusals', 'refused visits, the newest 100', () => '/api/agent/v1/refusals'),
  agent('agent_points', '/agent/v1/points', 'points', () => '/api/agent/v1/points'),
  agent('agent_providers', '/agent/v1/providers', 'providers', () => '/api/agent/v1/providers'),
  agent('agent_building', '/agent/v1/building', 'the building', () => '/api/agent/v1/building'),
  agent('agent_audit', '/agent/v1/audit', 'audit log, the newest 100', () => '/api/agent/v1/audit'),
  agent('agent_audit_point', '/agent/v1/audit', "audit log, one point's history", (c) => `/api/agent/v1/audit${query({ entity: 'point', entity_id: c.point })}`),
  agent('agent_schema', '/agent/v1/schema', 'the schema document', () => '/api/agent/v1/schema'),
  agent('agent_openapi', '/agent/v1/openapi.json', 'the OpenAPI document', () => '/api/agent/v1/openapi.json'),
  agent('agent_health', '/agent/v1/health', 'liveness', () => '/api/agent/v1/health'),
  agent('health_db', '/health/db', "the smoke test's database check", () => '/api/health/db'),
])

/** The GET routes that are not timed here, and why: tests/perf-api.test.js fails for a GET route that is in neither list. */
export const NOT_TIMED = Object.freeze({
  '/public/providers': 'the service provider app: npm run perf:scan times the scan',
  '/public/building': 'the service provider app: npm run perf:scan times the scan',
  '/public/points/resolve': 'the service provider app: npm run perf:scan times the scan',
  '/session': 'the service provider app: npm run perf:scan times the scan',
  '/my/scans': 'the service provider app: npm run perf:scan times the scan',
  '/cron/retention': 'a daily job that Vercel Cron calls, not a screen or the agent',
  '/cron/daily-summary': 'a daily job that Vercel Cron calls, not a screen or the agent',
  '/health': 'the uptime monitor: it answers without the database',
})

// ---------- numbers ----------

const round1 = (ms) => Math.round(ms * 10) / 10

/**
 * The median, the p95 (nearest rank: with 20 runs, the 19th fastest), the fastest and the slowest of some times, in ms with one
 * decimal.
 * @param {number[]} times
 */
export function summary(times) {
  const ms = [...times].sort((a, b) => a - b)
  const middle = Math.floor(ms.length / 2)
  const median = ms.length % 2 ? ms[middle] : (ms[middle - 1] + ms[middle]) / 2
  return { n: ms.length, median: round1(median), p95: round1(ms[Math.ceil(0.95 * ms.length) - 1]), min: round1(ms[0]), max: round1(ms[ms.length - 1]) }
}

/**
 * How many rows an answer holds: the lines of a CSV less its head, the list of a JSON answer, the providers of the Home week, or 1.
 * @param {string | null} contentType
 * @param {Buffer} body
 */
export function rowsOf(contentType, body) {
  const text = body.toString('utf8')
  if (String(contentType).startsWith('text/csv')) return Math.max(0, text.split('\r\n').filter(Boolean).length - 1)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  for (const key of ['scans', 'refusals', 'entries', 'points', 'providers', 'devices', 'api_keys', 'admins', 'counts']) {
    if (Array.isArray(json?.[key])) return json[key].length
  }
  if (Array.isArray(json?.week?.providers)) return json.week.providers.length
  return 1
}

/**
 * A route measured now against the same route in the baseline and against its target: `{ overTarget, change, overLine }`.
 * `change` is the change of the median (0.25 is 25% slower), null without a baseline. A median is over the line when it is more
 * than LINE slower and more than LINE_FLOOR_MS slower (a route of 2 ms that takes 3 is noise of the clock, not a finding).
 * @param {{ median: number, p95: number }} now
 * @param {{ median: number } | null | undefined} before
 * @param {number} target  ms, for the p95
 */
export function judge(now, before, target) {
  const overTarget = now.p95 > target
  if (!before || !(before.median > 0)) return { overTarget, change: null, overLine: false }
  const change = (now.median - before.median) / before.median
  return { overTarget, change, overLine: change > LINE && now.median - before.median > LINE_FLOOR_MS }
}

// ---------- plans ----------

const SCAN_NODES = new Set(['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan', 'Tid Scan', 'Tid Range Scan'])

/**
 * What a plan of EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) says, in short: the rows that it read from GROWING_TABLES (the rows it
 * kept and the rows its filters removed, times the loops), the full scans of those tables, the time the database took, and one
 * line for each node of the plan.
 * @param {any} explained  the first element of the JSON that EXPLAIN returns
 */
export function planFacts(explained) {
  const facts = { rowsRead: 0, readBy: {}, fullScans: [], executionMs: round1(explained['Execution Time'] ?? 0), buffers: 0, lines: [] }
  facts.buffers = (explained.Plan['Shared Hit Blocks'] ?? 0) + (explained.Plan['Shared Read Blocks'] ?? 0)
  const walk = (node, depth) => {
    const loops = node['Actual Loops'] ?? 1
    const kept = node['Actual Rows'] ?? 0
    const removed = (node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Index Recheck'] ?? 0)
    const relation = node['Relation Name']
    if (SCAN_NODES.has(node['Node Type']) && GROWING_TABLES.includes(relation)) {
      const read = Math.round((kept + removed) * loops)
      facts.rowsRead += read
      facts.readBy[relation] = (facts.readBy[relation] ?? 0) + read
      if (node['Node Type'] === 'Seq Scan' && !facts.fullScans.includes(relation)) facts.fullScans.push(relation)
    }
    const name = [node['Node Type'], node['Index Name'] ? `using ${node['Index Name']}` : '', relation ? `on ${relation}` : ''].filter(Boolean).join(' ')
    const sort = node['Sort Method'] ? `, ${node['Sort Method']} (${node['Sort Space Used']} kB, ${node['Sort Space Type']})` : ''
    const parent = node['Parent Relationship'] === 'SubPlan' || node['Parent Relationship'] === 'InitPlan' ? `${node['Subplan Name'] ?? node['Parent Relationship']}: ` : ''
    facts.lines.push(
      `${'  '.repeat(depth)}${parent}${name}: ${kept} rows${loops > 1 ? ` x ${loops} loops` : ''}${removed ? `, ${Math.round(removed)} removed by a filter` : ''}${sort}, ${round1(node['Actual Total Time'] ?? 0)} ms`,
    )
    for (const child of node.Plans ?? []) walk(child, depth + 1)
  }
  walk(explained.Plan, 0)
  return facts
}

/** A route that reads at least this share of a table that grows reads (nearly) all of it, whichever way: it grows with the table. */
export const MOST_OF_A_TABLE = 0.5

/** The rows of each table that grows, in the counts of the data (countYearData of year-data.mjs). */
const tableRows = (data) => ({ scans: data.scans, scan_refusals: data.refusals, audit_log: data.audit, api_key_usage: data.api_key_usage })

/**
 * What the plans of one route add up to: how many statements it ran, the rows it read from each table that grows (a statement that
 * one request ran many times counts that many times), the tables it read with a full scan, and the tables it read at least
 * MOST_OF_A_TABLE of (`wholeReads`, with the share in percent), which is what makes a route slower as the data grows.
 * @param {Array<{ times: number, rowsRead: number, readBy: Record<string, number>, fullScans: string[] }>} plans
 * @param {number} statements
 * @param {Record<string, number>} data  the counts of the data
 */
export function routeFacts(plans, statements, data) {
  const readBy = {}
  for (const plan of plans) for (const [table, rows] of Object.entries(plan.readBy ?? {})) readBy[table] = (readBy[table] ?? 0) + rows * plan.times
  const sizes = tableRows(data)
  const wholeReads = Object.entries(readBy)
    .filter(([table, rows]) => sizes[table] > 0 && rows >= MOST_OF_A_TABLE * sizes[table])
    .map(([table, rows]) => `${table} ${Math.round((100 * rows) / sizes[table])}%`)
  return {
    statements,
    rowsRead: Object.values(readBy).reduce((sum, rows) => sum + rows, 0),
    readBy,
    fullScans: [...new Set(plans.flatMap((p) => p.fullScans ?? []))],
    wholeReads,
    plans,
  }
}

// The statements that every request runs and that are not about the route: the transaction around a statement and the two guards
// (the committee's session, the agent key's count, which writes).
const BOOKKEEPING = /^\s*(begin|commit|rollback|set\b)/i
const GUARD = /from admin_sessions s|insert into api_key_usage/
const READS = (text) => /^\s*(select|with)\b/i.test(text) && !/\b(insert|update|delete)\b/i.test(text)

// ---------- the baseline ----------

/** The short commit of this checkout, or null outside git. */
export function headCommit(cwd = root) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Whether this checkout has changes to tracked files that are not committed (a baseline must name the code it measured). */
export function isDirty(cwd = root) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' }).trim() !== ''
  } catch {
    return true
  }
}

/**
 * Why `run` (what a run wrote to LAST_RUN) cannot be the baseline, or null when it can: RUNS runs of every route of ROUTES at both
 * sizes, every one of them answered 200, measured on a checkout with no uncommitted change.
 * @param {any} run
 */
export function whyNotABaseline(run) {
  if (!run || typeof run !== 'object') return 'there is no run to take'
  if (!Number.isInteger(run.runs) || run.runs < RUNS) return `a baseline needs ${RUNS} runs of every route, and this one made ${run.runs}`
  if (run.dirty !== false) return 'the run measured a checkout with changes that are not committed'
  for (const scale of YEAR_DATA_SCALES) {
    const routes = run.scales?.[scale]?.routes
    if (!routes) return `the run has no x${scale} (a baseline holds both sizes: run npm run perf:api:baseline without --scale)`
    for (const { key } of ROUTES) {
      const route = routes[key]
      if (!route) return `x${scale} ${key} was not measured`
      if (route.n !== run.runs) return `x${scale} ${key} has ${route.n} of ${run.runs} runs`
      if (route.failed !== 0 || route.statuses?.['200'] !== run.runs) return `x${scale} ${key} did not answer 200 every time (${JSON.stringify(route.statuses)})`
    }
  }
  return null
}

/** The run as the baseline keeps it: everything but the plans themselves (their facts stay). */
const withoutPlans = (run) => ({
  ...run,
  scales: Object.fromEntries(
    Object.entries(run.scales).map(([scale, s]) => [
      scale,
      { ...s, routes: Object.fromEntries(Object.entries(s.routes).map(([key, r]) => [key, Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'plans'))])) },
    ]),
  ),
})

/**
 * Makes the last run the baseline, or says why not. Returns { written: true } or { written: false, reason }.
 * @param {{ last?: string, baseline?: string, commit?: string | null }} [where]
 */
export function acceptBaseline({ last = LAST_RUN, baseline = BASELINE, commit = headCommit() } = {}) {
  if (!fs.existsSync(last)) return { written: false, reason: `there is no last run (${last}): run npm run perf:api:baseline` }
  let run
  try {
    run = JSON.parse(fs.readFileSync(last, 'utf8'))
  } catch {
    return { written: false, reason: 'the last run is not readable JSON' }
  }
  const reason = whyNotABaseline(run)
  if (reason) return { written: false, reason }
  if (!commit || run.commit !== commit) return { written: false, reason: `the last run measured ${run.commit}, and this checkout is at ${commit}` }
  fs.writeFileSync(baseline, `${JSON.stringify(withoutPlans(run), null, 2)}\n`)
  return { written: true }
}

// ---------- the report ----------

const kb = (bytes) => (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)
const pad = (text, width, right = false) => (right ? String(text).padStart(width) : String(text).padEnd(width))

/** The notes of a route: over its target, over the line, a full scan of a table that grows, an export that was cut. */
function notesOf(route, verdict) {
  const notes = []
  if (verdict.overTarget) notes.push('OVER TARGET')
  if (verdict.overLine) notes.push('OVER THE 20% LINE')
  if (route.failed) notes.push(`FAILED ${route.failed} of ${route.n} (${JSON.stringify(route.statuses)})`)
  if (route.wholeReads?.length) notes.push(`reads ${route.wholeReads.join(', ')}`)
  if (route.fullScans?.length) notes.push(`full scan of ${route.fullScans.join(', ')}`)
  if (route.truncated) notes.push('cut at the export limit (X-Truncated)')
  return notes
}

/** A route that needs a reader's look: over its target, or reading (nearly) all of a table that grows for ever, whichever way. */
export const flagged = (route, verdict) => verdict.overTarget || Boolean(route.fullScans?.length) || Boolean(route.wholeReads?.length)

/** The lines that the run prints for one size: the table, then the plans of the flagged routes. */
function tableLines(scale, result, baseline) {
  const lines = []
  const k = result.data
  lines.push(
    `x${scale}: ${k.scans.toLocaleString('en-US')} visits, ${k.refusals.toLocaleString('en-US')} refused visits, ` +
      `${k.audit.toLocaleString('en-US')} audit entries, ${k.api_key_usage.toLocaleString('en-US')} minutes of agent key use`,
  )
  lines.push(`  ${pad('route', 26)}${pad('median', 8, true)}${pad('p95', 8, true)}${pad('target', 8, true)}${pad('rows', 7, true)}${pad('KB', 7, true)}${pad('stmts', 6, true)}${pad('rows read', 11, true)}  baseline`)
  for (const route of ROUTES) {
    const r = result.routes[route.key]
    if (!r) continue
    const before = baseline?.scales?.[scale]?.routes?.[route.key]
    const verdict = judge(r, before, r.target)
    const compared = before ? `${before.median} (${verdict.change >= 0 ? '+' : ''}${Math.round(verdict.change * 100)}%)` : '-'
    const notes = notesOf(r, verdict)
    lines.push(
      `  ${pad(route.key, 26)}${pad(r.median, 8, true)}${pad(r.p95, 8, true)}${pad(r.target, 8, true)}${pad(r.rows ?? '-', 7, true)}${pad(kb(r.bytes), 7, true)}` +
        `${pad(r.statements ?? '-', 6, true)}${pad(r.rowsRead ?? '-', 11, true)}  ${compared}${notes.length ? `  ${notes.join('; ')}` : ''}`,
    )
  }
  const marked = ROUTES.filter((route) => result.routes[route.key] && flagged(result.routes[route.key], judge(result.routes[route.key], null, result.routes[route.key].target)))
  if (marked.length) {
    lines.push(`  The plans of the flagged routes at x${scale} (EXPLAIN ANALYZE of each statement that reads; rows x loops, ms):`)
    for (const route of marked) {
      const r = result.routes[route.key]
      lines.push(`  ${route.key}: ${route.words}, ${r.path}`)
      for (const plan of r.plans ?? []) {
        lines.push(`    statement ${plan.n} of ${r.plans.length}${plan.times > 1 ? `, run ${plan.times} times by one request` : ''}: ${plan.executionMs} ms, ${plan.rowsRead} rows read${plan.error ? `, not explained (${plan.error})` : ''}`)
        for (const line of plan.lines.slice(0, 16)) lines.push(`      ${line}`)
        if (plan.lines.length > 16) lines.push(`      ... ${plan.lines.length - 16} more nodes in ${path.relative(root, LAST_RUN)}`)
      }
    }
  }
  return lines
}

/** The same table in Markdown, for a pull request. */
function markdownTable(scale, result, baseline) {
  const k = result.data
  const out = [
    `#### x${scale}: ${k.scans.toLocaleString('en-US')} visits, ${k.refusals.toLocaleString('en-US')} refused visits, ${k.audit.toLocaleString('en-US')} audit entries`,
    '',
    '| Route | What it is | Median ms | p95 ms | Target ms | Rows | Rows read | Notes |',
    '|---|---|--:|--:|--:|--:|--:|---|',
  ]
  for (const route of ROUTES) {
    const r = result.routes[route.key]
    if (!r) continue
    const verdict = judge(r, baseline?.scales?.[scale]?.routes?.[route.key], r.target)
    out.push(`| \`${route.key}\` | ${route.words} | ${r.median} | ${r.p95} | ${r.target} | ${r.rows ?? '-'} | ${r.rowsRead ?? '-'} | ${notesOf(r, verdict).join('; ')} |`)
  }
  return out.join('\n')
}

// ---------- running ----------

/**
 * What the command line asks for: `{ scales, runs, port, keep, promote }`.
 * @param {string[]} argv
 */
export function parseTimingArgs(argv) {
  const options = { scales: [...YEAR_DATA_SCALES], runs: RUNS, port: PERF_API_PORT, keep: false, promote: false }
  for (const arg of argv) {
    if (arg === '--keep') options.keep = true
    else if (arg === '--promote') options.promote = true
    else if (arg.startsWith('--scale=')) {
      options.scales = arg.slice('--scale='.length).split(',').map(Number)
      for (const scale of options.scales) if (!YEAR_DATA_SCALES.includes(scale)) throw new Error(`--scale takes ${YEAR_DATA_SCALES.join(' or ')} (or both, comma-separated)`)
    } else if (arg.startsWith('--runs=')) {
      options.runs = Number(arg.slice('--runs='.length))
      if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs takes a whole number, 1 or more')
    } else if (arg.startsWith('--port=')) options.port = parsePort('--port', arg.slice('--port='.length), PERF_API_PORT)
    else throw new Error(`Unknown option ${arg}`)
  }
  return options
}

/** Runs `node <args>` in the project folder, its output shown, and throws when it fails. */
function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, HEALTH_HEARTBEAT_URL: '' } })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} exited with ${code}`))))
  })
}

/** Whether something answers on 127.0.0.1:`port`. */
function portTaken(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// One kept-alive connection to the local server, as a browser keeps one: the time of a request is then the server's, not that of a
// new connection. node:http and not fetch on purpose: measured on 13/10/2026 on Windows, fetch added about 15 ms to every request
// on this loopback (a GET of /api/health took 16 ms with fetch and 1 ms with node:http), which would hide the server's own time.
const newHttpAgent = () => new http.Agent({ keepAlive: true, maxSockets: 1 })
let httpAgent = newHttpAgent()

/**
 * One HTTP request, its whole answer read: `{ status, headers, body }` (the headers in lower case, the body a Buffer).
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
 */
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const sent = body === undefined ? headers : { ...headers, 'content-length': String(Buffer.byteLength(body)) }
    const req = http.request(url, { method, headers: sent, agent: httpAgent }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Starts the local API on the scratch schema and resolves when it answers; `stop()` ends that process (by its own handle). */
async function startApi(port) {
  const child = spawn(process.execPath, ['server/dev.mjs', `--schema=${PERF_API_SCHEMA}`], {
    cwd: root,
    env: { ...process.env, API_PORT: String(port), DEV_ADMIN_LOGIN: '1', HEALTH_HEARTBEAT_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const keep = (chunk) => (log = (log + chunk).slice(-4000))
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited = false
  const done = new Promise((resolve) => child.on('exit', () => resolve((exited = true))))
  const stop = async () => {
    if (!exited) {
      child.kill()
      await done
    }
  }
  const deadline = Date.now() + 30_000
  for (;;) {
    if (exited) throw new Error(`The API stopped before it answered. Its last lines:\n${log}`)
    try {
      const res = await request(`http://127.0.0.1:${port}/api/health`)
      if (res.status === 200) return { stop, log: () => log }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`The API did not answer on port ${port} within 30 s. Its last lines:\n${log}`)
    }
    await sleep(200)
  }
}

/** A request of a mock HTTP pair to the app's router in this process (as tests/helpers.js does): `{ status }`. */
async function callInProcess(handle, url, headers) {
  const req = { method: 'GET', url, headers: { host: 'perf.local', 'x-forwarded-for': '127.0.0.1', ...headers }, socket: { remoteAddress: '127.0.0.1' } }
  let finished
  const done = new Promise((resolve) => (finished = resolve))
  const stored = {}
  const res = {
    statusCode: 200,
    setHeader: (k, v) => (stored[k.toLowerCase()] = v),
    getHeader: (k) => stored[k.toLowerCase()],
    end() {
      finished()
    },
  }
  await handle(req, res)
  await done
  return { status: res.statusCode }
}

/** Times `route` over HTTP: WARMUPS calls, then `runs` timed ones, one at a time. */
async function timeRoute(base, route, ctx, headers, runs) {
  const url = route.path(ctx)
  const times = []
  const statuses = {}
  let last
  for (let i = 0; i < WARMUPS + runs; i++) {
    const started = performance.now()
    const res = await request(base + url, { headers })
    const ms = performance.now() - started
    if (i < WARMUPS) continue
    times.push(ms)
    statuses[res.status] = (statuses[res.status] ?? 0) + 1
    last = res
  }
  return {
    ...summary(times),
    statuses,
    failed: times.length - (statuses[200] ?? 0),
    rows: rowsOf(last.headers['content-type'], last.body),
    bytes: last.body.length,
    truncated: last.headers['x-truncated'] === 'true',
  }
}

/** The request of a route as the report shows it: the ids, the cursors and the days of this run by name. */
function shownPath(route, ctx) {
  let text = route.path(ctx)
  for (const [name, value] of Object.entries(ctx)) {
    if (typeof value === 'string' && value) text = text.split(encodeURIComponent(value)).join(`<${name}>`).split(value).join(`<${name}>`)
  }
  return text
}

/** Times every route at one size, explains what each one runs, and returns `{ data, routes }`. */
async function timeScale({ scale, runs, port, keep, connectionString, today }) {
  console.log(`\n--- x${scale}: making the year of data (scripts/perf/year-data.mjs ${PERF_API_SCHEMA} --scale=${scale})`)
  await runNode(['scripts/perf/year-data.mjs', PERF_API_SCHEMA, `--scale=${scale}`, `--today=${today}`])
  const scoped = { connectionString: normalizeConnectionString(connectionString), options: `-c search_path=${PERF_API_SCHEMA}`, max: 1 }
  const explainPool = new pg.Pool(scoped)
  let server
  try {
    const data = await countYearData(explainPool)
    server = await startApi(port)
    const base = `http://127.0.0.1:${port}`

    // The committee member of the data signs in through the dev-only shortcut of this local server.
    const login = await request(`${base}/api/admin/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: YEAR_DATA_MEMBER_EMAIL }) })
    if (login.status !== 200) throw new Error(`The dev sign-in answered ${login.status}`)
    const cookie = String([login.headers['set-cookie']].flat()[0]).split(';')[0]
    const read = async (url) => {
      const res = await request(base + url, { headers: { cookie } })
      if (res.status !== 200) throw new Error(`GET ${url} answered ${res.status}`)
      return JSON.parse(res.body.toString('utf8'))
    }

    // What the requests name: the busiest point and provider (their filters are the heavy case), the busiest member of the log,
    // and the cursors of the first pages (for "load more").
    const { points } = await read('/api/admin/points')
    const { providers } = await read('/api/admin/providers')
    const { admins } = await read('/api/admin/admins')
    const busiest = (rows) => [...rows].sort((a, b) => b.scan_count - a.scan_count)[0].id
    const ctx = {
      today,
      weekFrom: addDays(today, -6),
      yearFrom: addDays(today, -364),
      countsFrom: addDays(today, -365),
      point: busiest(points.filter((p) => p.is_active)),
      provider: busiest(providers.filter((p) => !p.is_demo)),
      member: admins.find((a) => a.email === YEAR_DATA_MEMBER_EMAIL).id,
      historyCursor: null,
      auditCursor: null,
    }
    ctx.historyCursor = (await read(history(ctx))).next_cursor
    ctx.auditCursor = (await read(audit())).next_cursor

    // The statements behind each route: the same request once more, inside this process, through the app's own router and a pool of
    // the app's own kind whose clients write down what they are asked to run (explainAll below).
    const db = await import('../../server/db.js')
    const { handle } = await import('../../server/index.js')
    const recorded = []
    let recording = false
    const pool = db.createPool(db.poolConfig(connectionString, PERF_API_SCHEMA))
    pool.on('connect', (client) => {
      const original = client.query.bind(client)
      client.query = (...args) => {
        if (recording && typeof args[0] === 'string') recorded.push({ text: args[0], values: Array.isArray(args[1]) ? args[1] : [] })
        return original(...args)
      }
    })
    db.setPool(pool)

    const routes = {}
    const headersOf = {}
    const timeAll = async (kind) => {
      for (const route of ROUTES.filter((r) => r.kind === kind)) {
        process.stdout.write(`  timing ${route.key} ...`)
        routes[route.key] = { path: shownPath(route, ctx), target: targetFor(route, scale), ...(await timeRoute(base, route, ctx, headersOf[route.key], runs)) }
        process.stdout.write(` ${routes[route.key].median} ms
`)
      }
    }
    // Each statement of a route that reads is run again under EXPLAIN (ANALYZE, BUFFERS) in a read-only transaction that is rolled
    // back, with the values it was run with (a statement that a request runs many times, like the pages of the export, once).
    const explainAll = async (kind) => {
      for (const route of ROUTES.filter((r) => r.kind === kind)) {
        recorded.length = 0
        recording = true
        const { status } = await callInProcess(handle, route.path(ctx), headersOf[route.key])
        recording = false
        const statements = recorded.filter((s) => !BOOKKEEPING.test(s.text) && !GUARD.test(s.text))
        const distinct = new Map()
        for (const s of statements) {
          const seen = distinct.get(s.text)
          if (seen) seen.times += 1
          else distinct.set(s.text, { ...s, times: 1 })
        }
        const plans = []
        for (const s of distinct.values()) {
          const plan = { n: plans.length + 1, times: s.times, executionMs: 0, rowsRead: 0, readBy: {}, fullScans: [], lines: [] }
          if (!READS(s.text)) plan.error = 'it writes'
          else {
            const c = await explainPool.connect()
            try {
              await c.query('begin')
              await c.query('set transaction read only')
              const { rows } = await c.query(`explain (analyze, buffers, format json) ${s.text}`, s.values)
              Object.assign(plan, planFacts(rows[0]['QUERY PLAN'][0]))
            } catch (err) {
              plan.error = err?.code ?? 'error'
            } finally {
              await c.query('rollback').catch(() => {})
              c.release()
            }
          }
          plans.push(plan)
        }
        Object.assign(routes[route.key], routeFacts(plans, statements.length, data), status === 200 ? {} : { explainStatus: status })
      }
    }

    try {
      for (const route of ROUTES.filter((r) => r.kind === 'committee')) headersOf[route.key] = { cookie }
      await timeAll('committee')
      await explainAll('committee')
      // One agent key for each agent route, minted the way the committee mints one, after the committee's routes were timed and
      // explained (so that the audit log and the list of keys that they read are the data's own). The keys live in the scratch schema,
      // are dropped with it and are never printed.
      for (const [n, route] of ROUTES.filter((r) => r.kind === 'agent').entries()) {
        const res = await request(`${base}/api/admin/api-keys`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: `perf timing ${n + 1}` }) })
        if (res.status !== 201) throw new Error(`Minting an agent key answered ${res.status}`)
        headersOf[route.key] = { authorization: `Bearer ${JSON.parse(res.body.toString('utf8')).key}` }
      }
      await timeAll('agent')
      await explainAll('agent')
    } finally {
      db.setPool(undefined)
      await pool.end()
    }
    return { data, routes }
  } finally {
    await server?.stop()
    httpAgent.destroy() // the connection of this server; the next size starts a server of its own
    httpAgent = newHttpAgent()
    await explainPool.end()
    if (!keep) await runNode(['scripts/perf/year-data.mjs', PERF_API_SCHEMA, '--drop'])
  }
}

async function main(argv) {
  const options = parseTimingArgs(argv)
  if (options.promote) {
    const result = acceptBaseline()
    if (result.written) console.log(`written as the new baseline: ${path.relative(process.cwd(), BASELINE)} (commit it with the change that explains it)`)
    else {
      console.error(`NOT written as the baseline: ${result.reason}. The baseline stays as it was.`)
      process.exitCode = 1
    }
    return
  }
  assertYearDataSchema(PERF_API_SCHEMA)
  // Every run starts without a last run, so that npm run perf:api:baseline can never take one from before.
  fs.rmSync(LAST_RUN, { force: true })
  fs.rmSync(LAST_TABLES, { force: true })
  loadEnv()
  process.env.HEALTH_HEARTBEAT_URL = '' // nothing here may ping the owner's check (tests/setup-no-heartbeat.js says why)
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)')

  // The marker of the database first, before anything is started (the generator and the API ask it again themselves).
  const control = new pg.Pool({ connectionString: normalizeConnectionString(connectionString), max: 1 })
  let postgres
  try {
    await assertNotProduction(control)
    postgres = (await control.query('show server_version')).rows[0].server_version
  } finally {
    await control.end()
  }
  if (await portTaken(options.port)) throw new Error(`Something already answers on port ${options.port}: stop it, or pass --port=<a free port>.`)

  const today = isoDay(new Date())
  const run = {
    commit: headCommit(),
    dirty: isDirty(),
    measuredAt: new Date().toISOString(),
    runs: options.runs,
    warmups: WARMUPS,
    machine: { cpu: os.cpus()[0]?.model?.trim() ?? 'unknown', cores: os.cpus().length, platform: `${os.platform()} ${os.release()}`, postgres },
    targets: TARGET_MS,
    scales: {},
  }
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null
  for (const scale of options.scales) {
    run.scales[scale] = await timeScale({ scale, runs: options.runs, port: options.port, keep: options.keep, connectionString, today })
  }

  fs.mkdirSync(path.dirname(LAST_RUN), { recursive: true })
  fs.writeFileSync(LAST_RUN, `${JSON.stringify(run, null, 2)}\n`)
  fs.writeFileSync(LAST_TABLES, `${options.scales.map((scale) => markdownTable(scale, run.scales[scale], baseline)).join('\n\n')}\n`)

  const lines = [`\nAPI timing at ${run.commit ?? 'this checkout'}${run.dirty ? ' (with uncommitted changes)' : ''}, ${run.runs} runs of each route after ${WARMUPS} warm-up (ms, on this computer):`]
  if (baseline && baseline.machine?.cpu !== run.machine.cpu) {
    lines.push(`  note: the baseline was measured on another computer (${baseline.machine?.cpu}); compare runs of one computer only`)
  }
  for (const scale of options.scales) lines.push(...tableLines(scale, run.scales[scale], baseline))
  const over = options.scales.flatMap((scale) => ROUTES.filter((r) => run.scales[scale].routes[r.key]?.p95 > run.scales[scale].routes[r.key]?.target).map((r) => `x${scale} ${r.key}`))
  lines.push(over.length ? `Over the target: ${over.join(', ')}.` : 'Every route is within its target.')
  if (lines.some((line) => line.includes('OVER THE 20% LINE'))) {
    lines.push('Once over the line can be noise: run it again. A median over the line in two runs in a row is a regression (docs/testing.md).')
  }
  const failed = options.scales.flatMap((scale) => ROUTES.filter((r) => run.scales[scale].routes[r.key]?.failed).map((r) => `x${scale} ${r.key}`))
  if (failed.length) lines.push(`These routes did not answer 200 every time: ${failed.join(', ')}. This run cannot be the baseline.`)
  else {
    const reason = whyNotABaseline(run)
    lines.push(reason ? `This run cannot be the baseline: ${reason}.` : 'To make a run the baseline: npm run perf:api:baseline (it writes only after the whole run passed).')
  }
  lines.push(`The run: ${path.relative(process.cwd(), LAST_RUN)}; its tables in Markdown: ${path.relative(process.cwd(), LAST_TABLES)}`)
  console.log(lines.join('\n'))
  if (failed.length) process.exitCode = 1
  httpAgent.destroy()
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
