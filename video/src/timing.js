// The timing of the provider tutorial video, as plain functions: how long each beat runs (the estimate of scenes.json, or the real
// duration of its audio from timings.json), where each one starts in frames, when a caption is on the screen, when a tap happens, and
// the WebVTT file of the captions. No Remotion and no browser here, so that the unit run of the repository can test it
// (tests/video-timing.test.js) and so that the renderer (render.mjs) and the composition (Video.jsx) read the same numbers.
//
// The inputs are the two files of video/out/<lang>/: scenes.json (scripts/video/record.spec.mjs, T1) and timings.json (the narrator,
// T3):
//   scenes.json  { lang, seconds, scenes: [{ id, seconds, beats: [{ id, image, width, height, scale, tap, highlight, caption (null for a
//                  beat that continues the line before it), say, seconds }] }] }, the boxes in CSS pixels of the screen that the picture shows
//   timings.json { lang, voice: 'elevenlabs' | 'files' | 'none', beats: { <beat id>: { seconds, audio } } }, `audio` a file name in
//                  video/out/<lang>/voice/ or null, and `seconds` the audio plus the pause after the line. A beat that is not in it,
//                  and a missing file, keep the seconds of scenes.json. A beat that `continues` the line before it is never in it.

export const FPS = 30
export const WIDTH = 720
export const HEIGHT = 1280

/** The seconds that one picture cross-fades into the next. */
export const FADE_SECONDS = 0.35

/** The caption bar and the phone above it, in pixels of the 720x1280 video. The screen keeps the proportions of the 390x844 recording. */
export const LAYOUT = Object.freeze({
  barHeight: 280,
  phoneTop: 27,
  bezel: 14,
  screenWidth: 437,
  screenHeight: 945,
})

/** The languages written from right to left. */
export const RTL_LANGUAGES = Object.freeze(['he', 'ar'])
export const isRtl = (lang) => RTL_LANGUAGES.includes(lang)

/**
 * A line that runs over the screens that continue it (the language beat names the four languages while the screens change), so the lead
 * and its continuations share the audio of the lead. Any other beat keeps its continuations after its own time, in silence (the notice
 * that the visits were sent is shown after the line that mentions it).
 */
export const SPEECH_OVER_CONTINUATIONS = Object.freeze(new Set(['language']))

/** The shortest that a lead beat stays when the screens that continue it share its audio. */
const MIN_LEAD_SECONDS = 1.5

/** An audio file name that timings.json may give: a plain file name of an mp3, never a path. */
export const SAFE_AUDIO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/
export const isSafeAudioName = (name) => typeof name === 'string' && name.length <= 120 && SAFE_AUDIO_NAME.test(name) && !name.includes('..')

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The beats of the video in order, each with its start and length in frames (from cumulative seconds, so that rounding never drifts),
 * its audio file or null, and the caption that is on the screen during it. `timings` may be null (the estimates of scenes.json).
 * @param {{ scenes: readonly { id: string, beats: readonly any[] }[] }} scenesFile
 * @param {{ beats?: Record<string, { seconds?: number, audio?: string | null }> } | null} [timings]
 * @param {number} [fps]
 */
export function planBeats(scenesFile, timings = null, fps = FPS) {
  // scenes.json has no `continues` flag: a beat that continues the line before it is the one whose caption is null.
  const flat = scenesFile.scenes.flatMap((scene) => scene.beats.map((beat) => ({ scene, beat: { ...beat, continues: Boolean(beat.continues) || beat.caption == null } })))
  const seconds = flat.map(({ beat }) => beat.seconds)
  const audio = flat.map(() => null)
  // A lead beat takes the real seconds of its line, and the beats that continue it keep their own planned seconds (or share the lead's).
  for (let i = 0; i < flat.length; i += 1) {
    const { beat } = flat[i]
    if (beat.continues) continue
    const entry = timings?.beats?.[beat.id]
    if (!entry) continue
    if (!positive(entry.seconds)) continue // a line with no real duration has no voice either: it would overlap the next one
    if (isSafeAudioName(entry.audio)) audio[i] = entry.audio
    let end = i + 1
    while (end < flat.length && flat[end].beat.continues) end += 1
    const rest = seconds.slice(i + 1, end).reduce((sum, value) => sum + value, 0)
    seconds[i] = SPEECH_OVER_CONTINUATIONS.has(beat.id) ? Math.max(entry.seconds - rest, Math.min(MIN_LEAD_SECONDS, entry.seconds)) : entry.seconds
  }

  let cumulative = 0
  let caption = null
  const beats = flat.map(({ scene, beat }, index) => {
    const startFrame = Math.round(cumulative * fps)
    cumulative += seconds[index]
    const endFrame = Math.round(cumulative * fps)
    if (!beat.continues) caption = beat.caption
    return {
      ...beat,
      index,
      sceneId: scene.id,
      seconds: seconds[index],
      startFrame,
      endFrame,
      frames: Math.max(1, endFrame - startFrame),
      audio: audio[index],
      caption,
    }
  })
  return { beats, totalFrames: beats.length ? beats[beats.length - 1].endFrame : 0, seconds: cumulative }
}

/**
 * The captions: one per line (a beat that continues the line before it extends its caption), with the frames it is on the screen.
 * @param {{ beats: readonly any[] }} plan
 */
export function captionGroups(plan) {
  const groups = []
  for (const beat of plan.beats) {
    const last = groups[groups.length - 1]
    if (beat.continues && last) last.endFrame = beat.endFrame
    else if (beat.caption) groups.push({ id: beat.id, text: beat.caption, startFrame: beat.startFrame, endFrame: beat.endFrame })
  }
  return groups
}

const pad = (value, width) => String(value).padStart(width, '0')

/** A WebVTT timestamp, HH:MM:SS.mmm, of a number of frames. */
export function vttTime(frame, fps = FPS) {
  const ms = Math.round((frame / fps) * 1000)
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`
}

/**
 * The WebVTT file of the captions. A cue text may not hold a line that is empty, or `-->`, or a `<` that starts a tag: a caption is the
 * app's own label inside a sentence, never markup, so those are escaped.
 * @param {{ beats: readonly any[] }} plan
 */
export function toVtt(plan, fps = FPS) {
  const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n+/g, ' ')
  const cues = captionGroups(plan).map((group, i) => `${i + 1}\n${vttTime(group.startFrame, fps)} --> ${vttTime(group.endFrame, fps)}\n${escape(group.text)}`)
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

/**
 * The box of a picture scaled onto the screen of the phone in the video. The boxes of scenes.json are in CSS pixels of the screen that
 * the picture shows (`from`), the screen of the video has its own size (`to`).
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ width: number, height: number }} from
 * @param {{ width: number, height: number }} to
 */
export function scaleBox(box, from, to) {
  const fx = to.width / from.width
  const fy = to.height / from.height
  return { x: box.x * fx, y: box.y * fy, w: box.w * fx, h: box.h * fy }
}

/** The centre of a box. */
export const centerOf = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

/** The seconds that a tap mark takes to grow and fade. */
export const TAP_SECONDS = 0.8

/**
 * The picture of a beat that has the dots of the password: the beat before the sign-in button types them, by showing that picture's own
 * dots one by one (so that the dots are the app's, not drawn).
 */
export const TYPING = Object.freeze({
  // In CSS pixels of the 390x844 recording: the dots of the sign-in button's picture start at `firstX` and are `step` apart, `fromX` is a
  // little to the right of the eye icon in the field, and `inset` keeps the border of the field out of the uncovered part.
  password: { source: 'submit', dots: 10, fromX: 86, firstX: 96, step: 7.4, inset: 6 },
})

/** The beats that are drawn scenes (the camera and the phone's question): their taps are in their own places, not on a box. */
export const DRAWN_TAPS = Object.freeze({
  sign: [0.78], // the link that the camera offers
  locating: [0.55], // "allow" in the phone's question
})

/**
 * When things happen inside one beat of `frames` frames, in frames from its start: the taps (a tap on the box of the beat, or the
 * beat's own drawn taps), the typing of the password dots, and when the highlight appears.
 * @param {{ id: string, tap?: unknown }} beat
 * @param {number} frames
 * @param {number} [fps]
 */
export function beatMotion(beat, frames, fps = FPS) {
  const tapLength = Math.round(TAP_SECONDS * fps)
  const latest = Math.max(0, frames - tapLength - Math.round(0.15 * fps))
  const fraction = (value) => Math.min(Math.round(frames * value), latest)
  /** @type {number[]} */
  let taps = []
  if (DRAWN_TAPS[beat.id]) taps = DRAWN_TAPS[beat.id].map(fraction)
  else if (beat.tap) taps = [beat.id === 'password' ? Math.min(Math.round(0.4 * fps), latest) : fraction(0.55)]
  const typing = TYPING[beat.id]
    ? { ...TYPING[beat.id], startFrame: Math.min(Math.round(1 * fps), latest), endFrame: Math.max(Math.round(frames * 0.8), Math.round(1.5 * fps)) }
    : null
  return { taps, tapLength, typing, highlightFrame: Math.round(0.2 * fps) }
}

/** How many dots are shown at `frame` of a beat's typing (0 before it starts, all of them when it has ended). */
export function dotsAt(typing, frame) {
  if (!typing || frame < typing.startFrame) return 0
  const t = Math.min(1, (frame - typing.startFrame) / Math.max(1, typing.endFrame - typing.startFrame))
  return Math.min(typing.dots, Math.floor(t * typing.dots) + 1)
}

/** Every tap of the video, as a frame from the start of the video (the tap sound plays at each). */
export function tapFrames(plan, fps = FPS) {
  return plan.beats.flatMap((beat) => beatMotion(beat, beat.frames, fps).taps.map((frame) => beat.startFrame + frame))
}

/** The audio files of the video, each with the frame it starts at. */
export function voiceTracks(plan) {
  return plan.beats.filter((beat) => beat.audio).map((beat) => ({ id: beat.id, file: beat.audio, startFrame: beat.startFrame }))
}

/** Luminance of an `#rrggbb` colour (WCAG 2.2). */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** The size of the caption's text by its length: a long line is set smaller so that it still fits the bar. */
export function captionFontSize(text) {
  const length = String(text).length
  if (length <= 60) return 42
  if (length <= 100) return 38
  return 34
}
