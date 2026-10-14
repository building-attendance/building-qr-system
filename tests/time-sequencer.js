// How Vitest splits the unit tests between the parts of CI (`vitest run --shard=<n>/<count>`, the job "unit part <n>" of
// .github/workflows/ci.yml): by how long each file takes, not by how many files a part gets. Vitest's own shard sorts the
// files by a hash of their path and cuts the list into equal counts, so one part got the slow database files and ran about
// twice as long as the other (161 s and 84 s of tests on 14/10/2026).
//
// Vitest hands the sequencer every test file of the run; each part splits that whole list the same way (e2e/parts.js,
// assignParts: the slowest file first, each to the part with the fewest seconds so far, by the weights of the project
// "unit" in e2e/part-weights.json) and keeps its own share. Every file is in exactly one part, a new file with no weight
// counts as the median file, and a part that would get no file fails the run. The order inside a part is Vitest's own
// (BaseSequencer.sort), and a run without --shard does not call this at all.
import path from 'node:path'
import { BaseSequencer } from 'vitest/node'
import { assignParts, readWeights } from '../e2e/parts.js'

/**
 * What loading a file costs on top of its own seconds, which Vitest's report does not count (its timings run from the
 * file's start to its end): on CI on 14/10/2026 the two test steps took 242 s for 186 s of measured files (115 files). Added
 * to every file, it keeps the parts even in files as well as in seconds (57 and 58 files, not 71 and 44).
 */
export const FILE_LOAD_SECONDS = 0.5

/** The name of a test file as the weights write it: relative to the repository, with forward slashes. */
export const fileName = (root, moduleId) => path.relative(root, moduleId).split(path.sep).join('/')

/**
 * This part's files of `files` (Vitest's test specifications, each with a `moduleId`): `index` of `count`, 1-based, split
 * by `weights` (file name -> seconds), each file counting `perFile` seconds more. Throws when the part gets no file.
 * @template {{ moduleId: string }} T
 * @param {T[]} files
 * @param {{ root: string, index: number, count: number, weights: Record<string, number>, perFile?: number }} options
 * @returns {T[]}
 */
export function shardByTime(files, { root, index, count, weights, perFile = 0 }) {
  const byName = new Map(files.map((spec) => [fileName(root, spec.moduleId), spec]))
  const loaded = Object.fromEntries(Object.entries(weights).map(([name, seconds]) => [name, seconds + perFile]))
  const mine = assignParts([...byName.keys()], loaded, count)[index - 1]
  if (!mine || mine.files.length === 0) {
    throw new Error(`part ${index} of ${count} of the unit tests has no test file (${byName.size} files): use fewer parts`)
  }
  return mine.files.map((name) => byName.get(name))
}

export default class TimeSequencer extends BaseSequencer {
  async shard(files) {
    const { root, shard } = this.ctx.config
    const weights = readWeights().unit?.files ?? {}
    return shardByTime(files, { root, index: shard.index, count: shard.count, weights, perFile: FILE_LOAD_SECONDS })
  }
}
