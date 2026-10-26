// The music of the promo video, as plain functions (no Remotion and no browser): which local file may be used as the track, where in it the
// music starts, and the volume at each frame (a fade in at the start and the fade out of decision D13 at the end). The track is a licensed
// file of the owner's that is never committed: render.mjs reads it from where it is and copies it into the staged folder, which is deleted
// at the end of the render. tests/video-promo.test.js tests this module.
import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { MUSIC_FADE_IN_SECONDS, volumeAt } from './fade.js'
import { FPS } from './timing.js'

// The fades are in fade.js, which the browser can bundle; they are part of this module's interface all the same.
export { MUSIC_FADE_IN_SECONDS, volumeAt }

/** The extensions of a track that the render accepts. */
export const MUSIC_EXTENSIONS = Object.freeze(['.mp3', '.wav', '.m4a'])

/** The name that the track has in the staged public folder, whatever it was called (the extension is the track's own). */
export const stagedMusicFile = (file) => `music${path.extname(file).toLowerCase()}`

/** The part of the repository where a track may sit: video/out/ is ignored by git, so a file there cannot be committed by accident. */
const IGNORED_FOLDER = ['video', 'out']

const inside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Checks the track the owner gave and returns its absolute path. A file inside the repository is accepted only under video/out/ (ignored
 * by git), so that the licensed track cannot be added to a commit; a file anywhere else on the machine is accepted.
 * @param {string} file
 * @param {string} repositoryRoot
 * @returns {string}
 */
export function checkMusicPath(file, repositoryRoot) {
  if (typeof file !== 'string' || file.trim() === '') throw new Error('The music file is not given.')
  const absolute = path.resolve(file)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`The music file "${path.basename(file)}" does not exist.`)
  const extension = path.extname(absolute).toLowerCase()
  if (!MUSIC_EXTENSIONS.includes(extension)) {
    throw new Error(`The music file "${path.basename(file)}" is a "${extension}" file: the render takes ${MUSIC_EXTENSIONS.join(', ')}.`)
  }
  // The real paths, so that a link or a different spelling of the same folder does not slip a track into the repository.
  const real = realpathSync(absolute)
  const root = realpathSync(repositoryRoot)
  if (inside(root, real) && !inside(path.join(root, ...IGNORED_FOLDER), real)) {
    throw new Error(`The music file "${path.basename(file)}" is inside the repository: keep a licensed track outside it, or under ${IGNORED_FOLDER.join('/')}/ (ignored by git).`)
  }
  return absolute
}

/**
 * Checks where in the track the music starts: not before the start of the file, and with at least the video's length left after it.
 * @param {number} start the second of the file where the music starts
 * @param {number} trackSeconds the length of the file
 * @param {number} videoSeconds the length of the video
 */
export function checkMusicStart(start, trackSeconds, videoSeconds) {
  if (!Number.isFinite(start) || start < 0) throw new Error(`The start of the music at ${start} s is not a second of the file.`)
  if (!Number.isFinite(trackSeconds) || start + videoSeconds > trackSeconds) {
    throw new Error(`The track is ${Number(trackSeconds).toFixed(3)} s long and the music starts at ${start} s: it would end before the video's ${videoSeconds.toFixed(3)} s.`)
  }
}

/** The frame of the track where the music starts, as Remotion's `trimBefore` takes it. */
export const startFrameOf = (startSeconds) => Math.round(startSeconds * FPS)
