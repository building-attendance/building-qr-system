// The parts of a Playwright project in CI (e2e/parts.js, run by .github/workflows/e2e.yml): every test file is in exactly
// one part, the split follows the measured seconds, and a part that would run nothing fails instead of passing.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assignParts, filesOfReport, listFiles, median, parseArgs, readWeights, updateWeights, writePart } from '../e2e/parts.js'

const FILES = ['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js', 'e.spec.js', 'f.spec.js', 'g.spec.js']
const WEIGHTS = { 'a.spec.js': 236, 'b.spec.js': 149, 'c.spec.js': 90, 'd.spec.js': 50, 'e.spec.js': 43, 'f.spec.js': 9, 'g.spec.js': 0 }

const flat = (parts) => parts.flatMap((p) => p.files)

describe('assignParts', () => {
  it('puts every file in exactly one part, for any number of parts', () => {
    for (let parts = 1; parts <= 9; parts += 1) {
      const split = assignParts(FILES, WEIGHTS, parts)
      expect(split).toHaveLength(parts)
      expect(flat(split).sort()).toEqual([...FILES].sort())
    }
  })

  it('gives the slowest file a part of its own and evens out the rest', () => {
    const split = assignParts(FILES, WEIGHTS, 3)
    // a 236 alone; b 149, then f 9 and g 0 go to the lightest part; c 90, d 50 and e 43 fill the third
    expect(split.map((p) => p.seconds)).toEqual([236, 158, 183])
    expect(split[2].files).toEqual(['c.spec.js', 'd.spec.js', 'e.spec.js'])
    expect(split[0].files).toEqual(['a.spec.js'])
  })

  it('is the same for the same input, whatever the order of the files', () => {
    const one = assignParts(FILES, WEIGHTS, 4)
    const two = assignParts([...FILES].reverse(), WEIGHTS, 4)
    expect(two).toEqual(one)
  })

  it('counts a file with no weight, or a weight that is not a number, as the median file', () => {
    const split = assignParts(['x.spec.js', 'y.spec.js', 'new.spec.js', 'odd.spec.js'], { 'x.spec.js': 10, 'y.spec.js': 30, 'odd.spec.js': 'slow' }, 1)
    expect(split[0].seconds).toBe(10 + 30 + 20 + 20)
  })

  it('counts every file as 1 when no weight is known, and drops a file listed twice', () => {
    const split = assignParts(['b.spec.js', 'a.spec.js', 'b.spec.js'], {}, 2)
    expect(split.map((p) => p.files)).toEqual([['a.spec.js'], ['b.spec.js']])
  })

  it('leaves a part empty when there are more parts than files (writePart then fails it)', () => {
    expect(assignParts(['a.spec.js'], {}, 2)[1].files).toEqual([])
  })

  it('refuses a number of parts that is not a whole number from 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '2']) expect(() => assignParts(FILES, WEIGHTS, /** @type {any} */ (bad))).toThrow(/whole number/)
  })

  it('takes the median of an odd and of an even count', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('filesOfReport', () => {
  it('finds the files of nested suites and adds up the seconds of every result, retries included', () => {
    const report = {
      suites: [
        { file: 'a.spec.js', specs: [{ file: 'a.spec.js', tests: [{ results: [{ duration: 1500 }, { duration: 500 }] }] }], suites: [] },
        { file: 'b.spec.js', specs: [], suites: [{ title: 'group', specs: [{ file: 'b.spec.js', tests: [{ results: [{ duration: 250 }] }, { results: [] }] }] }] },
      ],
    }
    expect([...filesOfReport(report)]).toEqual([['a.spec.js', 2], ['b.spec.js', 0.25]])
  })

  it('lists a file whose tests did not run (a --list report) with 0 seconds, and an empty report as no file', () => {
    expect([...filesOfReport({ suites: [{ file: 'c.spec.js', specs: [{ file: 'c.spec.js', tests: [{}] }] }] })]).toEqual([['c.spec.js', 0]])
    expect(filesOfReport({}).size).toBe(0)
  })
})

describe('writePart', () => {
  const written = []
  const write = (file, text) => written.push({ file, text })
  const deps = (files = FILES) => ({ list: () => files, weights: { 'android-chrome': { files: WEIGHTS } }, write })
  afterEach(() => { written.length = 0 })

  it('writes the files of this part, one per line, for --test-list, and prints the whole split', () => {
    const lines = writePart({ project: 'android-chrome', part: '1', parts: '3', out: 'list.txt' }, deps())
    expect(written).toEqual([{ file: 'list.txt', text: '# android-chrome, part 1 of 3 (e2e/parts.js)\na.spec.js\n' }])
    expect(lines[0]).toBe('android-chrome: 7 test files in 3 parts, by the seconds in e2e/part-weights.json')
    expect(lines.filter((l) => l.startsWith('->'))).toHaveLength(1)
  })

  it('together, the parts list every file once', () => {
    const seen = []
    for (let part = 1; part <= 4; part += 1) {
      writePart({ project: 'android-chrome', part: String(part), parts: '4', out: 'x' }, deps())
      seen.push(...written.pop().text.split('\n').filter((l) => l && !l.startsWith('#')))
    }
    expect(seen.sort()).toEqual([...FILES].sort())
  })

  it('fails a part that would run nothing, instead of passing it', () => {
    expect(() => writePart({ project: 'android-chrome', part: '2', parts: '2', out: 'x' }, deps(['a.spec.js']))).toThrow(/part 2 of 2 .* has no test file/)
    expect(written).toEqual([])
  })

  it('splits a project with no weights by count, not by failing', () => {
    writePart({ project: 'iphone-webkit', part: '2', parts: '2', out: 'x' }, deps(['a.spec.js', 'b.spec.js']))
    expect(written[0].text).toContain('b.spec.js')
  })

  it('refuses a missing or wrong option', () => {
    const base = { project: 'android-chrome', part: '1', parts: '2', out: 'x' }
    expect(() => writePart({ ...base, project: undefined }, deps())).toThrow(/--project/)
    expect(() => writePart({ ...base, out: undefined }, deps())).toThrow(/--out/)
    expect(() => writePart({ ...base, part: '0' }, deps())).toThrow(/--part/)
    expect(() => writePart({ ...base, parts: '2.5' }, deps())).toThrow(/--parts/)
    expect(() => writePart({ ...base, part: '3' }, deps())).toThrow(/more than --parts/)
    expect(written).toEqual([])
  })
})

describe('parseArgs', () => {
  it('reads --name=value and --flag, and refuses anything else', () => {
    expect(parseArgs(['--project=iphone-webkit', '--part=2', '--weights'])).toEqual({ project: 'iphone-webkit', part: '2', weights: true })
    expect(() => parseArgs(['iphone-webkit'])).toThrow(/unknown argument/)
  })
})

describe('updateWeights', () => {
  const dirs = []
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

  it("replaces one project's weights from a run's report and keeps the other's", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bqr-parts-'))
    dirs.push(dir)
    const weightsFile = path.join(dir, 'weights.json')
    fs.writeFileSync(weightsFile, JSON.stringify({ 'iphone-webkit': { files: { 'old.spec.js': 5 } }, 'android-chrome': { files: { 'old.spec.js': 9 } } }))
    const report = path.join(dir, 'report.json')
    fs.writeFileSync(report, JSON.stringify({ suites: [{ file: 'b.spec.js', specs: [{ file: 'b.spec.js', tests: [{ results: [{ duration: 1234 }] }] }] }] }))
    updateWeights({ project: 'android-chrome', report }, { weightsFile })
    expect(readWeights(weightsFile)).toEqual({ 'iphone-webkit': { files: { 'old.spec.js': 5 } }, 'android-chrome': { files: { 'b.spec.js': 1.2 } } })
  })

  it('adds up the reports of every part of one run, from a folder as gh run download makes it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bqr-parts-'))
    dirs.push(dir)
    const weightsFile = path.join(dir, 'weights.json')
    const report = (file, ms) => JSON.stringify({ suites: [{ file, specs: [{ file, tests: [{ results: [{ duration: ms }] }] }] }] })
    for (const [part, file, ms] of [[1, 'a.spec.js', 2000], [2, 'b.spec.js', 3000]]) {
      fs.mkdirSync(path.join(dir, 'timings', `timings-iphone-webkit-part-${part}`), { recursive: true })
      fs.writeFileSync(path.join(dir, 'timings', `timings-iphone-webkit-part-${part}`, 'playwright-timings.json'), report(file, ms))
    }
    fs.writeFileSync(path.join(dir, 'timings', 'notes.txt'), 'not a report')
    updateWeights({ project: 'iphone-webkit', report: path.join(dir, 'timings') }, { weightsFile })
    expect(readWeights(weightsFile)).toEqual({ 'iphone-webkit': { files: { 'a.spec.js': 2, 'b.spec.js': 3 } } })
  })

  it('refuses a folder with no report in it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bqr-parts-'))
    dirs.push(dir)
    expect(() => updateWeights({ project: 'iphone-webkit', report: dir }, { weightsFile: path.join(dir, 'w.json') })).toThrow(/no test file/)
  })
})

describe('the real project and weights', () => {
  it('lists the spec files of e2e/ through Playwright, and the weights file names a weight for each project', () => {
    const files = listFiles('android-chrome')
    const onDisk = fs.readdirSync(path.join(import.meta.dirname, '..', 'e2e')).filter((f) => f.endsWith('.spec.js')).sort()
    expect(files).toEqual(onDisk)
    const weights = readWeights()
    for (const project of ['android-chrome', 'iphone-webkit']) {
      expect(Object.keys(weights[project].files).length, project).toBeGreaterThan(0)
    }
  }, 60_000)

  it('fails when Playwright fails or lists nothing', () => {
    expect(() => listFiles('android-chrome', () => ({ status: 1, stdout: '', stderr: 'boom' }))).toThrow(/exit 1/)
    expect(() => listFiles('android-chrome', () => ({ status: 0, stdout: '{"suites":[]}', stderr: '' }))).toThrow(/no test file/)
    expect(() => listFiles('android-chrome', () => ({ status: 0, stdout: 'not json', stderr: '' }))).toThrow(/not JSON/)
  })
})
