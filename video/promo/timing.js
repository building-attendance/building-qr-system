// The timing of the promo video, as plain functions: from the promo's script (scenes measured in bars, a caption per scene) and the
// tempo of the music (beats per minute and the second of the first beat) to frames: where each scene starts and ends, when each phrase of
// its caption comes in, when a scene changes its picture, and how long the video is. No Remotion, no React and no browser here, so that
// the unit run of the repository can test it (tests/video-promo.test.js) and so that the render and the composition read the same numbers.
//
// - The beats are computed, never detected (decision D13): beat n is at `firstBeat + n * 60 / bpm` seconds.
// - Every scene starts and ends on a bar, so every cut falls on the first beat of a bar (the first scene starts at frame 0, which is the
//   first bar when the first beat is 0). The video ends on a bar, and the music fades out over its last MUSIC_FADE_OUT_SECONDS.
// - A caption comes in by phrases (cut at `.`, `,`, `?`, `:`), one phrase per beat from the first beat of its scene, all of them by the
//   middle of the scene. A caption that does not get its reading time at the tempo is refused (decision D9): fix the script, not the time.
import { SCENES, SCRIPTS } from './script/index.js'

export const FPS = 30
export const WIDTH = 1080
export const HEIGHT = 1920

export const BEATS_PER_BAR = 4

/** The reading time of a caption (D9): at least this long, and at least this long per word, from its first phrase to the end of its scene. */
export const MIN_CAPTION_SECONDS = 2
export const SECONDS_PER_WORD = 0.4

/** The music fades out over this long before the end of the video (D13). */
export const MUSIC_FADE_OUT_SECONDS = 1.5

/** The tempo that plans the video when the track is not known: 120 bpm makes a bar two seconds. */
export const DEFAULT_TEMPO = Object.freeze({ bpm: 120, firstBeat: 0 })

/**
 * The tempos that the plan accepts at all (a sanity range). The reading rule is stricter and depends on the script: with today's
 * captions, the two-bar scene that holds a caption of eight words cannot be planned above about 150 bpm.
 */
export const MIN_BPM = 60
export const MAX_BPM = 200

/** No two cuts are closer than this many beats (planPromo refuses a script that does it), so never three in one second at 60 bpm or more (WCAG 2.3.1). */
export const MIN_CUT_BEATS = 2

/**
 * A caption cut into phrases after each sentence or clause mark, the mark kept with its phrase, the words in their logical order (the
 * right-to-left layout is the composition's). An empty caption has no phrases.
 * @param {string} text
 * @returns {string[]}
 */
export function phrasesOf(text) {
  // A mark ends a phrase only when a space or the end follows it, so a number, a time or an address inside a phrase is never cut.
  return String(text).split(/(?<=[.,?:])\s+/).map((part) => part.trim()).filter(Boolean)
}

/** The words of a text: runs of characters between spaces. */
export function wordsOf(text) {
  return String(text).split(/\s+/).filter(Boolean).length
}

/** The seconds that a caption needs between its first phrase and the end of its scene. */
export function readingSeconds(text) {
  return Math.max(MIN_CAPTION_SECONDS, SECONDS_PER_WORD * wordsOf(text))
}

/** @param {{ bpm: number, firstBeat: number }} tempo */
function checkTempo(tempo) {
  const { bpm, firstBeat } = tempo ?? {}
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    throw new Error(`The tempo of ${bpm} bpm is outside ${MIN_BPM} to ${MAX_BPM} bpm.`)
  }
  const barSeconds = (BEATS_PER_BAR * 60) / bpm
  if (!Number.isFinite(firstBeat) || firstBeat < 0 || firstBeat > barSeconds) {
    throw new Error(`The first beat at ${firstBeat} s is before the start or later than one bar (${barSeconds.toFixed(3)} s at ${bpm} bpm).`)
  }
}

/**
 * The frame of a beat, counted from the first beat (beat 0), rounded to the nearest frame.
 * @param {number} beat
 * @param {{ bpm: number, firstBeat: number }} tempo
 */
export function beatFrame(beat, tempo = DEFAULT_TEMPO) {
  return Math.round((tempo.firstBeat + (beat * 60) / tempo.bpm) * FPS)
}

/**
 * The plan of the video in one language.
 * @param {string} lang
 * @param {{ bpm: number, firstBeat: number }} [tempo]
 * @returns {{
 *   scenes: { id: string, picture: string, then?: string, startFrame: number, endFrame: number, thenFrame?: number, phrases: { text: string, frame: number }[] }[],
 *   totalFrames: number,
 *   fadeOutFrame: number,
 *   bars: number,
 * }}
 */
export function planPromo(lang, tempo = DEFAULT_TEMPO) {
  checkTempo(tempo)
  const captions = SCRIPTS[lang]
  if (!captions) throw new Error(`The promo has no script in "${lang}".`)

  let bar = 0
  /** The beats (counted from the first beat) where the picture changes, with the scene each belongs to. */
  const cuts = []
  const scenes = SCENES.map((scene) => {
    const caption = captions[scene.id]
    if (typeof caption !== 'string' || !caption.trim()) throw new Error(`Scene "${scene.id}" has no caption in "${lang}".`)
    const startBeat = bar * BEATS_PER_BAR
    const beats = scene.bars * BEATS_PER_BAR
    bar += scene.bars
    // The first scene starts at frame 0, so a first beat after 0 is the lead-in of that scene.
    const startFrame = startBeat === 0 ? 0 : beatFrame(startBeat, tempo)
    const endFrame = beatFrame(startBeat + beats, tempo)

    const texts = phrasesOf(caption)
    if (texts.length >= beats / 2) {
      throw new Error(`The caption of scene "${scene.id}" has ${texts.length} phrases, more than the ${beats / 2 - 1} that come in before the middle of its ${scene.bars} bars.`)
    }
    const phrases = texts.map((text, index) => ({ text, frame: beatFrame(startBeat + index, tempo) }))

    const needed = readingSeconds(caption)
    const available = (endFrame - phrases[0].frame) / FPS
    if (available < needed) {
      throw new Error(
        `The caption of scene "${scene.id}" needs ${needed.toFixed(2)} s to be read, and its scene of ${scene.bars} bars gives it ${available.toFixed(2)} s at ${tempo.bpm} bpm.`,
      )
    }

    const planned = { id: scene.id, picture: scene.picture, startFrame, endFrame, phrases }
    if (startBeat > 0) cuts.push({ beat: startBeat, id: scene.id })
    if (scene.then) {
      planned.then = scene.then
      planned.thenFrame = beatFrame(startBeat + beats / 2, tempo)
      cuts.push({ beat: startBeat + beats / 2, id: scene.id })
    }
    return planned
  })

  cuts.forEach((cut, index) => {
    if (index > 0 && cut.beat - cuts[index - 1].beat < MIN_CUT_BEATS) {
      throw new Error(`The cut in scene "${cut.id}" is less than ${MIN_CUT_BEATS} beats after the cut before it.`)
    }
  })

  const totalFrames = scenes[scenes.length - 1].endFrame
  return { scenes, totalFrames, fadeOutFrame: totalFrames - Math.round(MUSIC_FADE_OUT_SECONDS * FPS), bars: bar }
}
