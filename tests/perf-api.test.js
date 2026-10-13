// The timing of the committee's screens and the agent's API on a year of data (npm run perf:api, scripts/perf/api-timing.mjs,
// docs/testing.md "Timing the committee and agent API"). No database and no server: CI never measures (a shared runner's timings
// are noise), so this file checks what the measurement is made of:
//   1. it is run by its own npm scripts, and the baseline step runs only after a run that passed;
//   2. it works on its own port and schema, apart from the other tools;
//   3. every GET route of the server is timed or named as not timed, with the reason, and every agent endpoint and every grouping of
//      the counts is timed; the requests are made only to the local server that the run started;
//   4. the numbers: the median and the p95, the rows of an answer, the targets, the 20% line, and what a plan says
//      (the rows read from the tables that grow, a full scan, a route that reads most of such a table);
//   5. the step that makes a run the baseline refuses a partial run, a run of another commit, a run with uncommitted changes and a
//      route that did not answer 200, and the committed baseline passes the rule that wrote it.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE, LINE, LINE_FLOOR_MS, MOST_OF_A_TABLE, NOT_TIMED, PERF_API_PORT, PERF_API_SCHEMA, ROUTES, RUNS, TARGET_MS, acceptBaseline, flagged,
  judge, parseTimingArgs, planFacts, routeFacts, rowsOf, summary, targetFor, whyNotABaseline,
} from '../scripts/perf/api-timing.mjs'
import { YEAR_DATA_SCALES, assertYearDataSchema } from '../scripts/perf/year-data.mjs'
import { SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, SCREENSHOTS_SCHEMA } from '../scripts/screenshots/settings.mjs'
import { AGENT_ENDPOINTS } from '../server/agentEndpoints.js'
import { COUNT_GROUPS } from '../server/scanCounts.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const TIMING = path.join(root, 'scripts/perf/api-timing.mjs')

/** What a run knows when it builds its requests, with invented values. */
const CTX = {
  today: '2030-06-15',
  weekFrom: '2030-06-09',
  yearFrom: '2029-06-16',
  countsFrom: '2029-06-15',
  point: '11111111-1111-4111-8111-111111111111',
  provider: '22222222-2222-4222-8222-222222222222',
  member: '33333333-3333-4333-8333-333333333333',
  historyCursor: 'eyJ0IjoiMjAzMC0wNi0xMCJ9',
  auditCursor: 'eyJ0IjoiMjAzMC0wNi0xMSJ9',
}

describe('how the timing is run', () => {
  it('is run by npm run perf:api, and npm run perf:api:baseline promotes a run only after it passed', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(scripts['perf:api']).toBe('node scripts/perf/api-timing.mjs')
    // `&&`: the promotion runs only when the run exited 0, that is when every route of both sizes answered 200.
    expect(scripts['perf:api:baseline']).toBe('node scripts/perf/api-timing.mjs && node scripts/perf/api-timing.mjs --promote')
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('perf:api')) expect(command, name).not.toContain('api-timing')
    }
  })

  it('works on a port and a schema of its own', () => {
    const perfScan = fs.readFileSync(path.join(root, 'playwright.perf.config.js'), 'utf8')
    const scanPorts = [/PERF_APP_PORT = (\d+)/, /PERF_API_PORT = (\d+)/].map((re) => Number(re.exec(perfScan)?.[1]))
    expect(scanPorts.every(Number.isInteger)).toBe(true)
    const taken = [3000, 3001, 3100, 3101, 3200, 3201, SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, ...scanPorts]
    expect(taken).not.toContain(PERF_API_PORT)
    expect(assertYearDataSchema(PERF_API_SCHEMA)).toBe(PERF_API_SCHEMA)
    expect(['e2e', 'perf', 'dev_ui', 'public', SCREENSHOTS_SCHEMA]).not.toContain(PERF_API_SCHEMA)
  })

  it('reads its options and refuses what it does not know', () => {
    expect(parseTimingArgs([])).toEqual({ scales: [...YEAR_DATA_SCALES], runs: RUNS, port: PERF_API_PORT, keep: false, promote: false })
    expect(parseTimingArgs(['--scale=10', '--runs=3', '--port=3999', '--keep'])).toEqual({ scales: [10], runs: 3, port: 3999, keep: true, promote: false })
    expect(parseTimingArgs(['--scale=1,10']).scales).toEqual([1, 10])
    expect(parseTimingArgs(['--promote']).promote).toBe(true)
    for (const bad of ['--scale=3', '--runs=0', '--runs=x', '--port=80', '--fast']) expect(() => parseTimingArgs([bad]), bad).toThrow()
  })

  it('sends its requests only to the local server that it started', () => {
    const source = fs.readFileSync(TIMING, 'utf8')
    const calls = [...source.matchAll(/await request\(([^,)]+)/g)].map((m) => m[1].trim())
    expect(calls.length).toBeGreaterThan(0)
    for (const target of calls) expect(target, target).toMatch(/^(`\$\{base\}|base \+|`http:\/\/127\.0\.0\.1:\$\{port\})/)
    expect(source).toMatch(/const base = `http:\/\/127\.0\.0\.1:\$\{port\}`/)
    expect(source, 'every request goes through request(), to the local server').not.toMatch(/\bfetch\(/)
    // The keys that it mints go into a header and nowhere else: never into a line that it prints.
    for (const line of source.split('\n').filter((l) => /console\.|stdout\.write/.test(l))) expect(line).not.toMatch(/authorization|headersOf|\)\.key\b/)
  })
})

describe('what is timed', () => {
  it('has one entry for each key, of a kind and a kind of target that TARGET_MS defines', () => {
    expect(new Set(ROUTES.map((r) => r.key)).size).toBe(ROUTES.length)
    for (const route of ROUTES) {
      expect(['committee', 'agent']).toContain(route.kind)
      expect(Object.keys(TARGET_MS)).toContain(route.target)
      expect(route.words.length).toBeGreaterThan(3)
    }
    expect(ROUTES.filter((r) => r.target === 'csv').map((r) => r.key)).toEqual(['csv_year'])
  })

  it('times every GET route of the committee and the agent, and names every other one with the reason', async () => {
    await import('../server/index.js')
    const { routeTable } = await import('../server/router.js')
    const gets = routeTable().filter((r) => r.method === 'GET').map((r) => r.path)
    const timed = new Set(ROUTES.map((r) => r.pattern))
    for (const pattern of gets) {
      expect(timed.has(pattern) || Object.hasOwn(NOT_TIMED, pattern), `${pattern} is neither timed nor in NOT_TIMED`).toBe(true)
      if (/^\/(admin|agent)\//.test(pattern)) expect(timed.has(pattern), `${pattern} is a committee or agent route`).toBe(true)
    }
    for (const [pattern, why] of Object.entries(NOT_TIMED)) {
      expect(gets, pattern).toContain(pattern)
      expect(timed.has(pattern), pattern).toBe(false)
      expect(why.length).toBeGreaterThan(20)
    }
  })

  it('times every endpoint of the agent API and every grouping of its counts', () => {
    for (const endpoint of AGENT_ENDPOINTS) {
      expect(ROUTES.some((r) => r.kind === 'agent' && r.pattern === endpoint.path), endpoint.path).toBe(true)
    }
    const counts = ROUTES.filter((r) => r.pattern === '/agent/v1/counts').map((r) => new URL(r.path(CTX), 'http://x').searchParams.get('group_by'))
    expect(counts.sort()).toEqual([null, ...COUNT_GROUPS].sort())
  })

  it('asks each route the way its screen does, on its own pattern', () => {
    for (const route of ROUTES) {
      const url = new URL(route.path(CTX), 'http://x')
      const expected = `/api${route.pattern.replace(':id', CTX.provider)}`
      expect(url.pathname, route.key).toBe(expected)
    }
    const params = (key) => Object.fromEntries(new URL(ROUTES.find((r) => r.key === key).path(CTX), 'http://x').searchParams)
    // The History screen as it opens (src/admin/views/HistoryView.jsx): the last 7 days, the accepted visits, pages of 100.
    expect(params('history')).toEqual({ from: CTX.weekFrom, to: CTX.today, outcome: 'accepted', limit: '100' })
    expect(params('history_more')).toEqual({ from: CTX.weekFrom, to: CTX.today, outcome: 'accepted', limit: '100', cursor: CTX.historyCursor })
    expect(params('csv_year')).toEqual({ from: CTX.yearFrom, to: CTX.today, outcome: 'accepted', format: 'csv' })
    // The audit screen asks for pages of 50 (src/admin/views/AuditView.jsx).
    expect(params('audit')).toEqual({ limit: '50' })
    // The counts of the agent cover 366 days, the most that one request may ask for (COUNTS_MAX_DAYS).
    expect(params('agent_counts')).toEqual({ from: CTX.countsFrom, to: CTX.today })
  })
})

describe('the numbers of a run', () => {
  it('takes the median and the nearest-rank p95', () => {
    expect(summary([5, 1, 3, 2, 4])).toEqual({ n: 5, median: 3, p95: 5, min: 1, max: 5 })
    const twenty = Array.from({ length: 20 }, (_, i) => 20 - i)
    expect(summary(twenty)).toMatchObject({ n: 20, median: 10.5, p95: 19, min: 1, max: 20 })
    expect(summary([1.234, 1.26])).toMatchObject({ median: 1.2, p95: 1.3 })
  })

  it('counts the rows of an answer', () => {
    const json = (value) => Buffer.from(JSON.stringify(value))
    expect(rowsOf('text/csv; charset=utf-8', Buffer.from('a,b\r\n1,2\r\n3,4\r\n5,6\r\n'))).toBe(3)
    expect(rowsOf('application/json', json({ scans: [1, 2], next_cursor: null }))).toBe(2)
    expect(rowsOf('application/json', json({ group_by: [], counts: [{ count: 9 }], total: 9 }))).toBe(1)
    expect(rowsOf('application/json', json({ days: [], week: { providers: [1, 2, 3], totals: [] }, counts: {} }))).toBe(3)
    expect(rowsOf('application/json', json({ admin: { id: 'x' } }))).toBe(1)
    expect(rowsOf('text/plain', Buffer.from('not json'))).toBeNull()
  })

  it('has the targets that were set before the first measurement: 300 ms at x1 and 1 s at x10 for a route, 5 s for the export of a year', () => {
    const route = ROUTES.find((r) => r.key === 'history')
    const csv = ROUTES.find((r) => r.key === 'csv_year')
    expect([targetFor(route, 1), targetFor(route, 10), targetFor(csv, 1), targetFor(csv, 10)]).toEqual([300, 1000, 5000, 5000])
  })

  it('marks a p95 over the target, and a median over the 20% line that is more than the floor', () => {
    expect(LINE).toBe(0.2)
    expect(judge({ median: 125, p95: 301 }, { median: 100 }, 300)).toEqual({ overTarget: true, change: 0.25, overLine: true })
    expect(judge({ median: 119, p95: 300 }, { median: 100 }, 300)).toMatchObject({ overTarget: false, overLine: false })
    // 2.0 to 2.6 ms is 30% slower, and less than LINE_FLOOR_MS: the clock, not a finding.
    expect(judge({ median: 2.0 + LINE_FLOOR_MS * 0.6, p95: 3 }, { median: 2 }, 300).overLine).toBe(false)
    expect(judge({ median: 9, p95: 9 }, null, 300)).toEqual({ overTarget: false, change: null, overLine: false })
  })

  it('reads a plan: the rows read from the tables that grow, a full scan, one line per node', () => {
    const explained = {
      'Execution Time': 12.34,
      Plan: {
        'Node Type': 'Sort', 'Actual Rows': 25, 'Actual Loops': 1, 'Actual Total Time': 12, 'Sort Method': 'quicksort', 'Sort Space Used': 29, 'Sort Space Type': 'Memory',
        'Shared Hit Blocks': 40, 'Shared Read Blocks': 2,
        Plans: [
          { 'Node Type': 'Seq Scan', 'Relation Name': 'points', 'Actual Rows': 25, 'Actual Loops': 1, 'Actual Total Time': 0.1 },
          {
            'Node Type': 'Aggregate', 'Parent Relationship': 'SubPlan', 'Subplan Name': 'SubPlan 1', 'Actual Rows': 1, 'Actual Loops': 25, 'Actual Total Time': 0.2,
            Plans: [{ 'Node Type': 'Index Only Scan', 'Index Name': 'scans_point_idx', 'Relation Name': 'scans', 'Actual Rows': 40, 'Actual Loops': 25, 'Actual Total Time': 0.1 }],
          },
          { 'Node Type': 'Seq Scan', 'Relation Name': 'audit_log', 'Actual Rows': 10, 'Rows Removed by Filter': 90, 'Actual Loops': 1, 'Actual Total Time': 0.3 },
        ],
      },
    }
    const facts = planFacts(explained)
    expect(facts).toMatchObject({ rowsRead: 1000 + 100, readBy: { scans: 1000, audit_log: 100 }, fullScans: ['audit_log'], executionMs: 12.3, buffers: 42 })
    expect(facts.lines).toHaveLength(5)
    expect(facts.lines[2]).toBe('  SubPlan 1: Aggregate: 1 rows x 25 loops, 0.2 ms')
    expect(facts.lines[4]).toBe('  Seq Scan on audit_log: 10 rows, 90 removed by a filter, 0.3 ms')
  })

  it('adds the plans of a route up, and marks a route that reads most of a table that grows', () => {
    const data = { scans: 1000, refusals: 50, audit: 300, api_key_usage: 100 }
    const plans = [
      { times: 1, rowsRead: 400, readBy: { scans: 400 }, fullScans: [] },
      { times: 3, rowsRead: 50, readBy: { scans: 50, audit_log: 50 }, fullScans: ['audit_log'] },
    ]
    const facts = routeFacts(plans, 4, data)
    expect(facts).toMatchObject({ statements: 4, rowsRead: 400 + 150 + 150, readBy: { scans: 550, audit_log: 150 }, fullScans: ['audit_log'], wholeReads: ['scans 55%', 'audit_log 50%'] })
    expect(MOST_OF_A_TABLE).toBe(0.5)
    expect(routeFacts([{ times: 1, rowsRead: 499, readBy: { scans: 499 }, fullScans: [] }], 1, data).wholeReads).toEqual([])
    expect(flagged({ fullScans: [], wholeReads: [] }, { overTarget: false })).toBe(false)
    expect(flagged({ fullScans: [], wholeReads: [] }, { overTarget: true })).toBe(true)
    expect(flagged({ fullScans: ['scans'], wholeReads: [] }, { overTarget: false })).toBe(true)
    expect(flagged({ fullScans: [], wholeReads: ['scans 100%'] }, { overTarget: false })).toBe(true)
  })
})

describe('the step that makes a run the baseline', () => {
  /** A run as the timing writes it: every route at both sizes, RUNS answers of 200 each, with its plans. */
  const aRun = ({ runs = RUNS, n = runs, commit = 'abc1234', dirty = false, scales = YEAR_DATA_SCALES, drop = null, failed = null } = {}) => ({
    commit,
    dirty,
    runs,
    scales: Object.fromEntries(
      scales.map((scale) => [
        scale,
        {
          data: { scans: 100 },
          routes: Object.fromEntries(
            ROUTES.filter((r) => `x${scale} ${r.key}` !== drop).map((r) => {
              const broken = `x${scale} ${r.key}` === failed
              return [r.key, { n, median: 5, p95: 6, failed: broken ? 1 : 0, statuses: broken ? { 200: n - 1, 500: 1 } : { 200: n }, plans: [{ lines: ['Seq Scan on scans'] }] }]
            }),
          ),
        },
      ]),
    ),
  })
  let dir
  const accept = (run, commit = 'abc1234') => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-api-baseline-'))
    const last = path.join(dir, 'last.json')
    const baseline = path.join(dir, 'baseline.json')
    if (run !== undefined) fs.writeFileSync(last, typeof run === 'string' ? run : JSON.stringify(run))
    fs.writeFileSync(baseline, '{"old": true}')
    const result = acceptBaseline({ last, baseline, commit })
    return { ...result, baseline: JSON.parse(fs.readFileSync(baseline, 'utf8')) }
  }
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  it('makes a complete run of this commit the baseline, without the plans themselves', () => {
    const result = accept(aRun())
    expect(result.written).toBe(true)
    expect(result.baseline.commit).toBe('abc1234')
    const route = result.baseline.scales[1].routes.history
    expect(route).toEqual({ n: RUNS, median: 5, p95: 6, failed: 0, statuses: { 200: RUNS } })
  })

  it.each([
    ['fewer runs than a baseline needs', aRun({ runs: 3 }), `needs ${RUNS} runs`],
    ['a run of a checkout with uncommitted changes', aRun({ dirty: true }), 'not committed'],
    ['a run of one size only', aRun({ scales: [1] }), 'has no x10'],
    ['a route that was not measured', aRun({ drop: 'x10 agent_counts_point' }), 'x10 agent_counts_point was not measured'],
    ['a route with fewer samples (it failed halfway)', aRun({ n: RUNS - 1 }), `has ${RUNS - 1} of ${RUNS} runs`],
    ['a route that did not answer 200 every time', aRun({ failed: 'x1 csv_year' }), 'x1 csv_year did not answer 200'],
    ['a run of another commit', aRun({ commit: 'fff0000' }), 'measured fff0000'],
    ['no run at all', undefined, 'there is no last run'],
    ['a run that is not JSON', '{not json', 'not readable JSON'],
  ])('refuses %s, and leaves the baseline as it was', (_what, run, reason) => {
    const result = accept(run)
    expect(result.written).toBe(false)
    expect(result.reason).toContain(reason)
    expect(result.baseline).toEqual({ old: true })
  })
})

describe('the committed baseline', () => {
  it('is a complete run of both sizes, with the commit, the computer and every route', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    expect(baseline.commit).toMatch(/^[0-9a-f]{7}$/)
    expect(typeof baseline.machine.cpu).toBe('string')
    expect(baseline.machine.postgres).toMatch(/^\d+/)
    expect(whyNotABaseline(baseline), 'the committed baseline passes the rule that wrote it').toBeNull()
    for (const scale of YEAR_DATA_SCALES) {
      expect(baseline.scales[scale].data.scans).toBeGreaterThan(0)
      for (const route of ROUTES) {
        const numbers = baseline.scales[scale].routes[route.key]
        expect(numbers.median, `x${scale} ${route.key}`).toBeGreaterThan(0)
        expect(numbers.p95).toBeGreaterThanOrEqual(numbers.median)
        expect(numbers.plans, 'the plans stay in the last run, out of the repository').toBeUndefined()
      }
    }
  })
})
