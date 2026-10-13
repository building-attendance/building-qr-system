// The baseline of the scan timing (docs/testing.md, "Timing a scan"): what a run must hold to become the baseline, and the
// step that makes it one. Node built-ins only, so that the spec, this script and tests/perf-scan.test.js can all import it.
//
// `npm run perf:scan` writes every run to LAST_RUN. `npm run perf:scan:baseline` is the same run followed by this script,
// joined with `&&`: the script runs only when Playwright exited 0, that is after every journey passed, every fixture was torn
// down (the E2E `page` fixture fails a test for a console error at teardown, after the test's own hooks) and every hook ran.
// Then it copies LAST_RUN over the baseline, but only a run that is complete and was measured at this checkout's commit.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const BASELINE = path.join(here, 'scan-baseline.json')
export const LAST_RUN = path.resolve(here, '../../node_modules/.cache/bqr-e2e/perf/last-scan-timing.json')
export const MIN_RUNS = 10

/** The journeys that a run measures, by the key under which a run stores them, with the words that the run prints. */
export const JOURNEYS = Object.freeze({
  daily: 'daily scan, signed in: navigation to "recorded"',
  first_list: 'first scan on a new phone: navigation to the list of names',
  first_checkin: 'first scan on a new phone: "sign in" tap to "recorded"',
  offline: 'no reception: navigation to "saved on the phone"',
})

/** The profiles that a run measures every journey in (the spec defines them; this is the list a baseline must cover). */
export const PROFILE_KEYS = Object.freeze(['slow-4g', 'unthrottled'])

/**
 * Why `run` (what a run wrote to LAST_RUN) cannot be the baseline, or null when it can: at least MIN_RUNS runs, and every
 * journey of every profile with exactly that many samples.
 */
export function whyNotABaseline(run) {
  if (!run || typeof run !== 'object') return 'there is no run to take'
  if (!Number.isInteger(run.runs) || run.runs < MIN_RUNS) return `a baseline needs at least ${MIN_RUNS} runs, and this one made ${run.runs}`
  for (const profile of PROFILE_KEYS) {
    for (const journey of Object.keys(JOURNEYS)) {
      const n = run.results?.[profile]?.[journey]?.n ?? 0
      if (n !== run.runs) return `${profile} ${journey} has ${n} of ${run.runs} runs`
    }
  }
  return null
}

/** The short commit of this checkout, or null outside git. */
export function headCommit(cwd = here) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * Makes the last run the baseline, or says why not. Returns { written: true } or { written: false, reason }.
 * @param {{ last?: string, baseline?: string, commit?: string | null }} [where]
 */
export function acceptBaseline({ last = LAST_RUN, baseline = BASELINE, commit = headCommit() } = {}) {
  if (!fs.existsSync(last)) return { written: false, reason: `there is no last run (${last}): run npm run perf:scan:baseline` }
  let run
  try {
    run = JSON.parse(fs.readFileSync(last, 'utf8'))
  } catch {
    return { written: false, reason: 'the last run is not readable JSON' }
  }
  const reason = whyNotABaseline(run)
  if (reason) return { written: false, reason }
  if (commit && run.commit !== commit) return { written: false, reason: `the last run measured ${run.commit}, and this checkout is at ${commit}` }
  fs.writeFileSync(baseline, `${JSON.stringify(run, null, 2)}\n`)
  return { written: true }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const result = acceptBaseline()
  if (result.written) {
    console.log(`written as the new baseline: ${path.relative(process.cwd(), BASELINE)} (commit it with the change that explains it)`)
  } else {
    console.error(`NOT written as the baseline: ${result.reason}. The baseline stays as it was.`)
    process.exitCode = 1
  }
}
