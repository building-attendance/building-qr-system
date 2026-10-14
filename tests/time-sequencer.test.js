// The split of the unit tests between the parts of CI (tests/time-sequencer.js, through `vitest run --shard`): every file
// is in exactly one part, by the measured seconds, and a part that would run nothing fails instead of passing. And the
// timings of a Vitest JSON report become the weights of the project "unit" (e2e/parts.js).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import TimeSequencer, { FILE_LOAD_SECONDS, fileName, shardByTime } from './time-sequencer.js'
import { filesOfAnyReport, filesOfVitestReport, readWeights, updateWeights } from '../e2e/parts.js'

const ROOT = path.join(os.tmpdir(), 'repo')
const spec = (name) => ({ moduleId: path.join(ROOT, ...name.split('/')) })
const SPECS = ['tests/api.test.js', 'tests/migrate.test.js', 'tests/components/history.test.jsx', 'tests/a.test.js', 'tests/b.test.js'].map(spec)
const WEIGHTS = { 'tests/api.test.js': 40, 'tests/migrate.test.js': 15, 'tests/components/history.test.jsx': 31, 'tests/a.test.js': 1, 'tests/b.test.js': 2 }
const names = (specs) => specs.map((s) => fileName(ROOT, s.moduleId)).sort()

describe('shardByTime', () => {
  it('names a file from the repository, with forward slashes, as the weights do', () => {
    expect(fileName(ROOT, path.join(ROOT, 'tests', 'components', 'x.test.jsx'))).toBe('tests/components/x.test.jsx')
  })

  it('puts every file in exactly one part, for any number of parts up to the number of files', () => {
    for (let count = 1; count <= SPECS.length; count += 1) {
      const all = []
      for (let index = 1; index <= count; index += 1) all.push(...shardByTime(SPECS, { root: ROOT, index, count, weights: WEIGHTS }))
      expect(names(all), `${count} parts`).toEqual(names(SPECS))
    }
  })

  it('splits by the seconds of each file: the slowest alone, the rest together', () => {
    const one = shardByTime(SPECS, { root: ROOT, index: 1, count: 2, weights: WEIGHTS })
    const two = shardByTime(SPECS, { root: ROOT, index: 2, count: 2, weights: WEIGHTS })
    expect(names(one)).toEqual(['tests/a.test.js', 'tests/api.test.js', 'tests/b.test.js'])
    expect(names(two)).toEqual(['tests/components/history.test.jsx', 'tests/migrate.test.js'])
  })

  it('counts the load of each file, so that many small files do not all go to one part', () => {
    const small = Array.from({ length: 10 }, (_, i) => spec(`tests/s${i}.test.js`))
    const files = [spec('tests/big.test.js'), ...small]
    const weights = Object.fromEntries([['tests/big.test.js', 5], ...small.map((s) => [fileName(ROOT, s.moduleId), 0.5])])
    const without = shardByTime(files, { root: ROOT, index: 2, count: 2, weights })
    const withLoad = shardByTime(files, { root: ROOT, index: 2, count: 2, weights, perFile: 1 })
    expect(without).toHaveLength(10) // 5 s of measured seconds each side, but one file against ten
    expect(withLoad.length).toBeLessThan(10)
  })

  it('returns the specifications themselves, not copies, so that Vitest runs them as they are', () => {
    const [first] = shardByTime(SPECS, { root: ROOT, index: 1, count: 1, weights: WEIGHTS })
    expect(SPECS).toContain(first)
  })

  it('fails a part that would get no file, instead of letting it pass', () => {
    expect(() => shardByTime(SPECS.slice(0, 1), { root: ROOT, index: 2, count: 2, weights: WEIGHTS })).toThrow(/part 2 of 2 .* has no test file/)
  })

  it('is what the sequencer does with the shard that Vitest gives it', async () => {
    const sequencer = new TimeSequencer(/** @type {any} */ ({ config: { root: ROOT, shard: { index: 1, count: 2 } } }))
    const mine = await sequencer.shard(SPECS)
    const theirs = shardByTime(SPECS, { root: ROOT, index: 1, count: 2, weights: readWeights().unit?.files ?? {}, perFile: FILE_LOAD_SECONDS })
    expect(names(mine)).toEqual(names(theirs))
  })
})

describe('the timings of a Vitest JSON report', () => {
  const report = {
    testResults: [
      { name: '/home/runner/work/building-qr-system/building-qr-system/tests/api.test.js', startTime: 1000, endTime: 41500 },
      { name: 'C:\\Users\\someone\\repo\\tests\\components\\history.test.jsx', startTime: 0, endTime: 31000 },
      { name: '/x/tests/broken.test.js', startTime: 5, endTime: 'never' },
    ],
  }

  it('names each file from its last /tests/ and gives it the seconds from start to end', () => {
    expect([...filesOfVitestReport(report)]).toEqual([
      ['tests/api.test.js', 40.5],
      ['tests/components/history.test.jsx', 31],
      ['tests/broken.test.js', 0],
    ])
  })

  it('is told apart from a Playwright report by its testResults', () => {
    expect(filesOfAnyReport(report).has('tests/api.test.js')).toBe(true)
    expect(filesOfAnyReport({ suites: [{ file: 'a.spec.js', specs: [{ file: 'a.spec.js', tests: [] }] }] }).has('a.spec.js')).toBe(true)
  })

  const dirs = []
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

  it('becomes the weights of the project "unit", from the folder of a CI run, the other projects kept', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bqr-unit-'))
    dirs.push(dir)
    const weightsFile = path.join(dir, 'weights.json')
    fs.writeFileSync(weightsFile, JSON.stringify({ 'iphone-webkit': { files: { 'a.spec.js': 3 } } }))
    for (const part of [1, 2]) {
      fs.mkdirSync(path.join(dir, 'timings-unit', `timings-unit-part-${part}`), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'timings-unit', `timings-unit-part-${part}`, 'vitest-timings.json'),
        JSON.stringify({ testResults: [{ name: `/r/tests/f${part}.test.js`, startTime: 0, endTime: part * 1000 }] }),
      )
    }
    updateWeights({ project: 'unit', report: path.join(dir, 'timings-unit') }, { weightsFile })
    expect(readWeights(weightsFile)).toEqual({
      'iphone-webkit': { files: { 'a.spec.js': 3 } },
      unit: { files: { 'tests/f1.test.js': 1, 'tests/f2.test.js': 2 } },
    })
  })
})
