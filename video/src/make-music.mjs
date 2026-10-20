// The music bed of the provider tutorial video (decisions D14 and D15): a slow pad with no beat and no tune, made here from sine waves
// so that no third party's sound is in the repository. Nothing is committed: render.mjs calls musicWav() at every render and writes the
// result to the staged public folder as MUSIC_FILE (timing.js). The same seconds give the same bytes, so a render is repeatable.
//
// Four chords of four notes, ten seconds each, in a loop. Every note has a long attack and a long release (the next chord starts to
// rise while the last one fades), three soft partials, and a tiny difference of pitch between the left and the right ear, which is
// what makes it a pad and not a beep. How loud it is, when it dips under the narrator, and how it fades in and out is not decided here
// but in timing.js (musicVolumeAt), so that one place holds the levels.
//
// `node video/src/make-music.mjs <seconds> <file>` writes a file to listen to.
import { Buffer } from 'node:buffer'
import { writeFileSync } from 'node:fs'
import { argv, exit, stderr } from 'node:process'
import { fileURLToPath } from 'node:url'

export const MUSIC_RATE = 24000

/** Seconds that one chord lasts, and the seconds that a note takes to rise and to fade (so the chords overlap). */
const CHORD_SECONDS = 10
const SWELL_SECONDS = 3.5

/** The chords: Cmaj7 add 9, Am7, Fmaj7, and a G with its third replaced by the sixth (open and unresolved, so it never sounds like an end). */
const CHORDS = Object.freeze([
  [130.81, 196.0, 293.66, 329.63],
  [110.0, 164.81, 261.63, 392.0],
  [87.31, 130.81, 220.0, 329.63],
  [98.0, 146.83, 246.94, 329.63],
])

/** The loudness of the first three partials of a note: soft, nearly a sine. */
const PARTIALS = Object.freeze([1, 0.3, 0.1])

/** Half of the pitch gap between the ears, as a fraction of the pitch (about 3 cents). */
const DETUNE = 0.0017

/** The gain of one note, so that the whole pad stays far from clipping (musicWav is tested to peak below 0.5). */
const NOTE_GAIN = 0.045

/** The rise (0 to 1) of a note `age` seconds after it started, and its fall `left` seconds before it ends: a half cosine each. */
const swell = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x / SWELL_SECONDS)))

/**
 * The pad as a 16-bit stereo WAV file.
 * @param {number} seconds  the length; at least a second
 * @returns {Buffer}
 */
export function musicWav(seconds) {
  const frames = Math.round(Math.max(1, seconds) * MUSIC_RATE)
  const data = Buffer.alloc(frames * 4)
  const chordCount = Math.ceil(frames / MUSIC_RATE / CHORD_SECONDS) + 1
  for (let i = 0; i < frames; i += 1) {
    const t = i / MUSIC_RATE
    // A slow, shallow breathing of the whole pad (a period of about 14 seconds).
    const breath = 0.92 + 0.08 * Math.sin(2 * Math.PI * 0.07 * t)
    let left = 0
    let right = 0
    const current = Math.min(chordCount, Math.floor(t / CHORD_SECONDS))
    for (let k = Math.max(0, current - 1); k <= current; k += 1) {
      const start = k * CHORD_SECONDS
      const end = start + CHORD_SECONDS + SWELL_SECONDS
      const level = k === 0 ? swell(end - t) : swell(t - start) * swell(end - t)
      if (level <= 0) continue
      for (const hz of CHORDS[k % CHORDS.length]) {
        PARTIALS.forEach((amount, p) => {
          const w = 2 * Math.PI * hz * (p + 1) * t
          left += amount * level * Math.sin(w * (1 - DETUNE))
          right += amount * level * Math.sin(w * (1 + DETUNE))
        })
      }
    }
    data.writeInt16LE(Math.round(left * NOTE_GAIN * breath * 32767), i * 4)
    data.writeInt16LE(Math.round(right * NOTE_GAIN * breath * 32767), i * 4 + 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16) // the size of the format block
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(2, 22) // stereo
  header.writeUInt32LE(MUSIC_RATE, 24)
  header.writeUInt32LE(MUSIC_RATE * 4, 28) // bytes per second
  header.writeUInt16LE(4, 32) // bytes per sample frame
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const [seconds, file] = argv.slice(2)
  if (!file || !Number.isFinite(Number(seconds))) {
    stderr.write('Usage: node video/src/make-music.mjs <seconds> <file.wav>   (a file to listen to; render.mjs makes its own)\n')
    exit(1)
  }
  writeFileSync(file, musicWav(Number(seconds)))
}
