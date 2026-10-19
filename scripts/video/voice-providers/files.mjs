// The recorded narrator (decision D2, option b): a person records every line, and each recording is an mp3 named by the cache key
// of its line (`<hash>.mp3`, the page that voice.mjs writes names each file). A line whose recording is missing stops the run with
// the line's id and text, never a silent gap in the video.

import fs from 'node:fs'
import path from 'node:path'

/** What stands for the voice and the model in the cache key of a recorded line: the text alone decides which file it needs. */
export const RECORDING_VOICE = 'recording'
export const RECORDING_MODEL = 'files'

/**
 * @param {{ dir: string }} options  the folder of the recordings of one language
 * @returns {import('./types.mjs').Provider}
 */
export function filesProvider({ dir }) {
  return Object.freeze({
    name: 'files',
    kind: 'recordings',
    voice: RECORDING_VOICE,
    model: RECORDING_MODEL,
    label: `files (recordings in ${dir})`,
    read(hash) {
      try {
        return fs.readFileSync(path.join(dir, `${hash}.mp3`))
      } catch (err) {
        if (err?.code === 'ENOENT') return null
        throw new Error(`The recording ${hash}.mp3 cannot be read (${err?.code ?? err?.name}).`, { cause: err })
      }
    },
  })
}
