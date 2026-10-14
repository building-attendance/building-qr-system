// The parts of a Playwright project in CI (.github/workflows/e2e.yml): each part runs a share of the project's test files,
// chosen by how long each file takes, so that the parts take about as long as each other. Playwright's own --shard splits
// by the number of tests and keeps a file whole in the part where its first test falls, so one part used to get the three
// slowest files and run about twice as long as the next (#218). The unit tests use the same split through a Vitest
// sequencer (tests/time-sequencer.js), with the weights of the project "unit".
//
// How a part is chosen, the same way in every part so that they agree without talking to each other:
//   1. the project's full list of test files comes from Playwright itself (`playwright test --list`), so a file that
//      Playwright runs is never missing from the split, whatever its name or folder;
//   2. the files are sorted from the slowest to the fastest by their seconds in e2e/part-weights.json, and each goes to the
//      part that has the fewest seconds so far (a file with no weight yet, a new one, counts as the median file);
//   3. this part's files are written to a list for `playwright test --test-list`, which runs exactly those files (a file
//      path is compared as it is, not as a pattern).
// Every file of the list is in exactly one part, and a part with no file fails (more parts than files): nothing is skipped
// without a red check. The weights only decide which files share a part, never whether a file runs.
//
// Usage:
//   node e2e/parts.js --project=<name> --part=<n> --parts=<count> --out=<file>   writes the list of part n, prints the split
//   node e2e/parts.js --weights --project=<name> --report=<file or folder>       replaces the project's weights with the
//                                                                                    durations of the JSON reports of one run
// The second form after a change that makes a file much slower or faster (docs/testing.md, "CI"): a weight that is off only
// makes the parts less even, it never leaves a file out.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from '../scripts/ci-git.mjs'

export const WEIGHTS_FILE = fileURLToPath(new URL('./part-weights.json', import.meta.url))

/** Plain string order, the same on every machine (no locale). */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The median of a list of numbers (the mean of the two middle ones for an even count). */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Splits `files` into `parts` parts by their seconds in `weights` (file name -> seconds): the slowest file first, each to the
 * part with the fewest seconds so far (the earlier part on a tie). A file with no usable weight counts as the median of the
 * weights that are known, or 1 when none is. Returns one `{ files, seconds }` per part, its files in name order. Every file
 * is in exactly one part; the same input always gives the same parts.
 * @param {string[]} files
 * @param {Record<string, number>} weights
 * @param {number} parts
 */
export function assignParts(files, weights, parts) {
  if (!Number.isInteger(parts) || parts < 1) throw new Error(`the number of parts must be a whole number from 1, not ${parts}`)
  const unique = [...new Set(files)].sort(byName)
  const usable = (w) => typeof w === 'number' && Number.isFinite(w) && w >= 0
  const known = unique.map((f) => weights[f]).filter(usable)
  const fallback = known.length > 0 ? median(known) : 1
  const weightOf = (f) => (usable(weights[f]) ? weights[f] : fallback)
  const order = [...unique].sort((a, b) => weightOf(b) - weightOf(a) || byName(a, b))
  const result = Array.from({ length: parts }, () => ({ files: [], seconds: 0 }))
  for (const file of order) {
    let lightest = 0
    for (let i = 1; i < parts; i += 1) if (result[i].seconds < result[lightest].seconds) lightest = i
    result[lightest].files.push(file)
    result[lightest].seconds += weightOf(file)
  }
  for (const part of result) part.files.sort(byName)
  return result
}

/**
 * The test files of a Playwright JSON report (of `--list` or of a run), relative to the test folder as Playwright writes
 * them, each with the seconds that its tests took (0 for a list, which runs nothing).
 * @param {any} report
 * @returns {Map<string, number>}
 */
export function filesOfReport(report) {
  const files = new Map()
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      const name = spec.file ?? file
      let ms = 0
      for (const test of spec.tests ?? []) for (const result of test.results ?? []) ms += result.duration ?? 0
      files.set(name, (files.get(name) ?? 0) + ms / 1000)
    }
    for (const child of suite.suites ?? []) walk(child, child.file ?? file)
  }
  for (const suite of report?.suites ?? []) walk(suite, suite.file)
  return files
}

/**
 * The test files of a Vitest JSON report (`--reporter=json`), relative to the repository as `tests/<file>`, each with the
 * seconds from its start to its end. Vitest writes absolute paths, which differ between machines (a CI runner, a laptop),
 * so the name starts at the last `/tests/` of the path.
 * @param {any} report
 * @returns {Map<string, number>}
 */
export function filesOfVitestReport(report) {
  const files = new Map()
  for (const result of report?.testResults ?? []) {
    const full = String(result.name ?? '').split('\\').join('/')
    const at = full.lastIndexOf('/tests/')
    const name = at >= 0 ? full.slice(at + 1) : full
    const seconds = Math.max(0, (Number(result.endTime) - Number(result.startTime)) / 1000) || 0
    files.set(name, (files.get(name) ?? 0) + seconds)
  }
  return files
}

/** The files of a JSON report of either runner: Vitest's has `testResults`, Playwright's has `suites`. */
export function filesOfAnyReport(report) {
  return Array.isArray(report?.testResults) ? filesOfVitestReport(report) : filesOfReport(report)
}

/**
 * The project's test files, from Playwright's own list (`playwright test --list --reporter=json`), in name order. Throws when
 * Playwright fails or lists no file: a part must never run "nothing" and pass.
 * @param {string} project
 */
export function listFiles(project, run = spawnSync) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
  const env = { ...process.env }
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME // the report must come to stdout, not to a file
  const out = run(process.execPath, [cli, 'test', '--list', `--project=${project}`, '--reporter=json'], {
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (out.error) throw new Error(`Playwright could not list the tests of ${project}: ${out.error.message}`)
  if (out.status !== 0) throw new Error(`Playwright could not list the tests of ${project} (exit ${out.status}): ${(out.stderr || '').trim().slice(0, 500)}`)
  let report
  try {
    report = JSON.parse(out.stdout)
  } catch {
    throw new Error(`Playwright's list of ${project} is not JSON`)
  }
  const files = [...filesOfReport(report).keys()].sort(byName)
  if (files.length === 0) throw new Error(`Playwright lists no test file for the project ${project}`)
  return files
}

/** The weights of every project from e2e/part-weights.json: { project: { files: { file: seconds } } }. */
export function readWeights(file = WEIGHTS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** The options of the command line: `--name=value` and bare `--flag`; anything else is an error. */
export function parseArgs(argv) {
  const options = {}
  for (const arg of argv) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg)
    if (!match) throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    options[match[1]] = match[2] ?? true
  }
  return options
}

/** A whole number from 1, or an error that names the option. */
function wholeNumber(value, name) {
  const n = Number(value)
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || !Number.isInteger(n) || n < 1) {
    throw new Error(`--${name} must be a whole number from 1`)
  }
  return n
}

/**
 * The list of one part: writes the file for `--test-list` and returns the lines to print. `list` and `weights` are given
 * so that a test can try it without Playwright.
 */
export function writePart({ project, part, parts, out }, { list = listFiles, weights = readWeights(), write = fs.writeFileSync } = {}) {
  if (typeof project !== 'string' || project === '') throw new Error('--project is missing')
  if (typeof out !== 'string' || out === '') throw new Error('--out is missing')
  const n = wholeNumber(part, 'part')
  const count = wholeNumber(parts, 'parts')
  if (n > count) throw new Error(`--part=${n} is more than --parts=${count}`)
  const files = list(project)
  const split = assignParts(files, weights[project]?.files ?? {}, count)
  const mine = split[n - 1]
  if (mine.files.length === 0) {
    throw new Error(`part ${n} of ${count} of ${project} has no test file (${files.length} files for ${count} parts): use fewer parts`)
  }
  write(out, [`# ${project}, part ${n} of ${count} (e2e/parts.js)`, ...mine.files, ''].join('\n'))
  return [
    `${project}: ${files.length} test files in ${count} parts, by the seconds in e2e/part-weights.json`,
    ...split.map((p, i) => `${i + 1 === n ? '->' : '  '} part ${i + 1}: about ${Math.round(p.seconds)} s, ${p.files.join(', ')}`),
  ]
}

/**
 * The JSON reports at `report`: the file itself, or every .json file under the folder (the artifacts of the parts of one CI
 * run, downloaded with `gh run download`), in name order.
 */
export function reportFiles(report) {
  if (!fs.statSync(report).isDirectory()) return [report]
  return fs
    .readdirSync(report, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort(byName)
}

/**
 * Replaces the weights of `project` with the durations in the JSON reports at `report` (one report of a full run, or a
 * folder with the reports of every part of one run, which together hold every file once).
 */
export function updateWeights({ project, report }, { weightsFile = WEIGHTS_FILE } = {}) {
  if (typeof project !== 'string' || project === '') throw new Error('--project is missing')
  if (typeof report !== 'string' || report === '') throw new Error('--report is missing')
  const seconds = new Map()
  for (const file of reportFiles(report)) {
    for (const [name, s] of filesOfAnyReport(JSON.parse(fs.readFileSync(file, 'utf8')))) seconds.set(name, (seconds.get(name) ?? 0) + s)
  }
  if (seconds.size === 0) throw new Error(`no test file in the report at ${report}`)
  const all = fs.existsSync(weightsFile) ? readWeights(weightsFile) : {}
  const files = Object.fromEntries([...seconds].sort(([a], [b]) => byName(a, b)).map(([f, s]) => [f, Math.round(s * 10) / 10]))
  all[project] = { files }
  fs.writeFileSync(weightsFile, `${JSON.stringify(all, null, 2)}\n`)
  return [`${project}: ${seconds.size} files written to ${weightsFile}`]
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const lines = options.weights ? updateWeights(options) : writePart(options)
    for (const line of lines) console.log(line)
  } catch (error) {
    console.error(`e2e/parts.js: ${error.message}`)
    process.exitCode = 1
  }
}
