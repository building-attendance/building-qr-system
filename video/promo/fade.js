// The volume of the promo video's music at each frame, apart from music.js because the composition (Promo.jsx) imports it and runs in the
// browser, where music.js, which reads the file system, cannot be bundled. music.js re-exports it, and tests/video-promo.test.js tests it there.
import { FPS } from './timing.js'

/** The music fades in over this long at the start of the video. */
export const MUSIC_FADE_IN_SECONDS = 0.5

/**
 * The volume of the music at a frame of the video, from 0 to 1: silent at the first frame, rising linearly over MUSIC_FADE_IN_SECONDS, full
 * until `plan.fadeOutFrame`, then falling linearly to silent at the last frame (D13: the last 1.5 seconds).
 * @param {number} frame
 * @param {{ totalFrames: number, fadeOutFrame: number }} plan
 */
export function volumeAt(frame, plan) {
  const last = plan.totalFrames - 1
  const fadeInFrames = Math.round(MUSIC_FADE_IN_SECONDS * FPS)
  const fadeIn = Math.min(1, Math.max(0, frame / fadeInFrames))
  const fadeOut = Math.min(1, Math.max(0, (last - frame) / (last - plan.fadeOutFrame)))
  return Math.min(fadeIn, fadeOut)
}
