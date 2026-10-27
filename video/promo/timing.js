// The timing of the promo video, as plain functions: from the promo's script (scenes measured in bars, a caption per scene) and the
// tempo of the music (beats per minute and the second of the first beat) to frames: where each scene starts and ends, when each phrase of
// its caption comes in, when a scene changes its picture, and how long the video is. No Remotion, no React and no browser here, so that
// the unit run of the repository can test it (tests/video-promo.test.js) and so that the render and the composition read the same numbers.
//
// - The beats are computed, never detected (decision D13): beat n is at `firstBeat + n * 60 / bpm` seconds.
// - Every scene starts and ends on a bar, so every cut falls on the first beat of a bar (the first scene starts at frame 0, which is the
//   first bar when the first beat is 0). The video ends on a bar, and the music fades out over its last MUSIC_FADE_OUT_SECONDS.
// - The effects of decision D16 (pulses, whips, the landing of words, the sounds) are placed here too, from the same beats (the last section).
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

// ---- The effects of decision D16 (W1 to W6): every one of them is placed by these functions, on a beat of the plan. ----

/** The whip between two scenes lasts this many frames and ends on the bar line, where the new scene's first phrase lands. */
export const WHIP_FRAMES = 8

/** The scene where the groove of the track enters (frame 240 at 120 bpm): it gets the big punch and the impact sound. */
export const GROOVE_SCENE = 'scan'

/**
 * How strong the pulses are. `ground` is the share of white laid over the ground at the first frame of a bar (it fades over the beat),
 * `text` the same over the ground of a text scene, which is kept small so that the words stay AA on it (the test holds the contrast),
 * `phone` how much the phone grows, and the `punch` values are the bigger hit on the first beat of the groove (they fade over two beats).
 */
export const PULSE = Object.freeze({ ground: 0.1, text: 0.04, phone: 0.02, punchGround: 0.22, punchPhone: 0.06 })

/**
 * The gain of the whole mix, the track and the effect sounds alike (the effects keep their balance under the music): the track alone peaks
 * at +0.2 dBFS (true peak) and is -13.8 LUFS, so the mix is brought down by 2.5 dB to peak under -1 dBFS, the ceiling for a published
 * video. It is applied in Promo.jsx, on top of the fades of fade.js (`volumeAt`), which stay as they were.
 */
export const MIX_GAIN = 0.75

/** The frames of a beat (a whole number, for effects that last "a beat"). */
export const beatFrames = (tempo = DEFAULT_TEMPO) => Math.round((FPS * 60) / tempo.bpm)

/**
 * The bar that a frame is in and the frames since its first beat, or null before the first bar.
 * @param {number} frame
 * @param {{ bpm: number, firstBeat: number }} tempo
 */
export function barPhase(frame, tempo = DEFAULT_TEMPO) {
  let bar = Math.floor((frame / FPS - tempo.firstBeat) / ((BEATS_PER_BAR * 60) / tempo.bpm))
  while (bar >= 0 && beatFrame(bar * BEATS_PER_BAR, tempo) > frame) bar -= 1
  while (beatFrame((bar + 1) * BEATS_PER_BAR, tempo) <= frame) bar += 1
  return bar < 0 ? null : { bar, since: frame - beatFrame(bar * BEATS_PER_BAR, tempo) }
}

/** The pulse of the bar line, from 1 on its first frame down to 0 a beat later (it falls fast, then slowly). */
export function pulseAt(frame, tempo = DEFAULT_TEMPO) {
  const phase = barPhase(frame, tempo)
  const beat = beatFrames(tempo)
  return phase && phase.since < beat ? (1 - phase.since / beat) ** 2 : 0
}

/** The bigger hit that starts at `hitFrame`: 1 on its first frame, 0 two beats later. */
export function punchAt(frame, hitFrame, tempo = DEFAULT_TEMPO) {
  const since = frame - hitFrame
  const length = 2 * beatFrames(tempo)
  return since >= 0 && since < length ? (1 - since / length) ** 2 : 0
}

/**
 * The frames where the words of a phrase land (W1): the first on the phrase's beat, the others spread over the same beat, a half beat
 * apart at the most (so two words land on the beat and the half beat, and a longer phrase lands in quicker steps inside its beat, never
 * on the next phrase's).
 * @param {number} phraseFrame the frame of the phrase (a beat of the plan)
 * @param {number} count the words of the phrase
 */
export function wordFrames(phraseFrame, count, tempo = DEFAULT_TEMPO) {
  const beat = beatFrames(tempo)
  const step = Math.min(Math.round(beat / 2), Math.floor(beat / Math.max(2, count)))
  return Array.from({ length: count }, (_, index) => phraseFrame + index * step)
}

/**
 * Where a keyword sits in a caption: the index of its first word among the caption's words and its word count, or null when the keyword is
 * not whole consecutive words of the caption (or is empty, or longer than two words).
 * @param {string} caption
 * @param {string} keyword
 */
export function keywordRange(caption, keyword) {
  const words = String(caption).split(/\s+/).filter(Boolean)
  const wanted = String(keyword ?? '').split(/\s+/).filter(Boolean)
  if (wanted.length < 1 || wanted.length > 2) return null
  for (let start = 0; start + wanted.length <= words.length; start += 1) {
    if (wanted.every((word, offset) => words[start + offset] === word)) return { start, count: wanted.length }
  }
  return null
}

/**
 * The sounds of W5, made from code at every render by make-sounds.mjs (their length is `seconds`), and how loud each plays under the music.
 * The whoosh swells for the length of the whip and is loudest at its end, so it starts one whip before the bar line.
 */
export const SOUNDS = Object.freeze({
  whoosh: Object.freeze({ file: 'whoosh.wav', seconds: 0.5, volume: 0.5 }),
  impact: Object.freeze({ file: 'impact.wav', seconds: 1.1, volume: 0.35 }),
  ding: Object.freeze({ file: 'ding.wav', seconds: 0.8, volume: 0.35 }),
})

/**
 * When each sound plays: `frame` is where its file starts, `hit` the frame where it lands (a beat of the plan), `frames` how long it plays.
 * A whoosh at every bar line between scenes, the impact on the first beat of the groove, the ding when the check-in screen appears.
 * @param {ReturnType<typeof planPromo>} plan
 */
export function soundCues(plan) {
  const cues = []
  const add = (kind, hit, lead = 0) => {
    const { file, seconds, volume } = SOUNDS[kind]
    cues.push({ kind, file, frame: hit - lead, hit, frames: Math.ceil(seconds * FPS), volume })
  }
  for (const [index, scene] of plan.scenes.entries()) {
    if (index > 0) add('whoosh', scene.startFrame, WHIP_FRAMES)
    if (scene.id === GROOVE_SCENE) {
      add('impact', scene.startFrame)
      if (scene.thenFrame != null) add('ding', scene.thenFrame)
    }
  }
  return cues
}

/** The first beat of the last bar: the closing card's burst of confetti and the pop of its QR tile. */
export const burstFrame = (plan, tempo = DEFAULT_TEMPO) => beatFrame((plan.bars - 1) * BEATS_PER_BAR, tempo)
