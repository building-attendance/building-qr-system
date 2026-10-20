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

/** The longest that a change of scene may take (decision D16), and how far the new scene's picture rises while it fades in, in pixels. */
export const MAX_TRANSITION_SECONDS = 0.4
export const SCENE_PUSH_PX = 8

/** How a caption comes in (decision D16): it rises this many pixels while it fades in over this many seconds. */
export const CAPTION_RISE_PX = 8
export const CAPTION_FADE_IN_SECONDS = 0.25
const CAPTION_FADE_OUT_FRAMES = 6

/** The volume of the tap sound (it was 0.35 before the softer sound of decision D16). */
export const TAP_VOLUME = 0.22

/** The music bed: the file that render.mjs writes to the staged public folder (make-music.mjs), and its levels (decision D15). */
export const MUSIC_FILE = 'music.wav'
export const MUSIC = Object.freeze({
  /** The volume (0 to 1, of the pad at full scale, which is about -22 LUFS) while nobody speaks, and while the narrator does. */
  level: 0.22,
  duckedLevel: 0.1,
  /** The pad dips this long before a line starts, rises this long after it ends, and takes `rampSeconds` to move between the two levels. */
  leadSeconds: 0.3,
  tailSeconds: 0.1,
  rampSeconds: 0.5,
  fadeInSeconds: 2.5,
  fadeOutSeconds: 3,
})

/**
 * The pause that the narrator step leaves after every line (PAUSE_SECONDS of scripts/video/timings.mjs, which a test pins to this
 * number): a line's `seconds` is its audio plus this, so the music dips for the audio only and may rise in the pause.
 */
export const VOICE_PAUSE_SECONDS = 0.5

/**
 * The QR code that the camera scene shows over the code of the printed sign: a sharp one made for the video at every render (the owner,
 * 19/10/2026, in place of the blurred picture of the real one). It holds plain text, never a link and never a point's token (a secret,
 * AGENTS.md), so a viewer who scans the screen with a phone gets the word and nothing opens. render.mjs writes it as `file`.
 */
export const DEMO_QR = Object.freeze({ text: 'DEMO', file: 'demo-qr.svg' })

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
  plan.beats.forEach((beat, index) => {
    const last = groups[groups.length - 1]
    if (beat.continues && last) last.endFrame = beat.endFrame
    else if (beat.caption) groups.push({ id: beat.id, text: beat.caption, startFrame: beat.startFrame, endFrame: beat.endFrame, beatIndex: index })
  })
  return groups
}

/**
 * The captions with `rise`: whether a caption moves as it comes in, which it never does while a tap mark or an outline of its own beat
 * comes in (see isCalm).
 * @param {{ beats: readonly any[] }} plan
 */
export function risingCaptions(plan, fps = FPS) {
  const frames = Math.ceil(CAPTION_FADE_IN_SECONDS * fps)
  return captionGroups(plan).map((group) => ({ ...group, rise: isCalm(plan, group.beatIndex, frames, fps) }))
}

/**
 * Whether the first `frames` frames of a beat show no tap mark and no outline, the only frames in which anything may move (decision
 * D16, "no motion while a tap mark or a highlight is on the screen"). With `withPrevious`, an outline of the beat before, which still
 * shows under the fade into this one, counts too: a picture that moves must not carry it along.
 * @param {{ beats: readonly any[] }} plan
 * @param {number} index
 * @param {number} frames
 */
export function isCalm(plan, index, frames, fps = FPS, withPrevious = false) {
  const beat = plan.beats[index]
  const motion = beatMotion(beat, beat.frames, fps)
  if (motion.taps.some((start) => start < frames)) return false
  if (beat.highlight && motion.highlightFrame < frames) return false
  return !(withPrevious && plan.beats[index - 1]?.highlight)
}

const clamp01 = (value) => Math.min(1, Math.max(0, value))
const easeOut = (p) => 1 - (1 - clamp01(p)) ** 3

/**
 * How a caption looks at `frame`: it fades in over CAPTION_FADE_IN_SECONDS, rising CAPTION_RISE_PX when the group says so, and fades out
 * over its last frames without moving.
 * @param {{ startFrame: number, endFrame: number, rise?: boolean }} group
 */
export function captionAt(group, frame, fps = FPS) {
  const into = clamp01((frame - group.startFrame) / (CAPTION_FADE_IN_SECONDS * fps))
  const out = clamp01((group.endFrame - frame) / CAPTION_FADE_OUT_FRAMES)
  return { opacity: Math.min(into, out), offsetY: group.rise ? CAPTION_RISE_PX * (1 - easeOut(into)) : 0 }
}

/**
 * How the picture of a beat comes in: it fades in over `frames` frames (the first beat has no fade), and when the beat starts a new scene
 * and nothing else moves then, it also rises `push` pixels. Between the beats inside one scene it is the plain fade of before.
 * @param {{ beats: readonly any[] }} plan
 * @param {number} index
 */
export function sceneEntrance(plan, index, fps = FPS) {
  const frames = Math.round(FADE_SECONDS * fps)
  if (index === 0) return { frames: 0, push: 0 }
  const newScene = plan.beats[index].sceneId !== plan.beats[index - 1].sceneId
  return { frames, push: newScene && isCalm(plan, index, frames, fps, true) ? SCENE_PUSH_PX : 0 }
}

/** The opacity and the rise (a pixel offset that goes to 0) of a picture `frame` frames into its beat. */
export function entranceAt(entrance, frame) {
  if (entrance.frames === 0) return { opacity: 1, offsetY: 0 }
  const p = clamp01(frame / entrance.frames)
  return { opacity: p, offsetY: entrance.push * (1 - easeOut(p)) }
}

/**
 * The frames in which the narrator is heard: from the start of each voiced beat to the end of its audio (the end of the beat less the
 * pause, and for a line that runs over the screens that continue it, the end of the last of them).
 * @param {{ beats: readonly any[] }} plan
 * @returns {{ startFrame: number, endFrame: number }[]}
 */
export function voicedSpans(plan, fps = FPS) {
  const pause = Math.round(VOICE_PAUSE_SECONDS * fps)
  const spans = []
  plan.beats.forEach((beat, i) => {
    if (!beat.audio) return
    let last = i
    if (SPEECH_OVER_CONTINUATIONS.has(beat.id)) while (plan.beats[last + 1]?.continues) last += 1
    spans.push({ startFrame: beat.startFrame, endFrame: Math.max(beat.startFrame + 1, plan.beats[last].endFrame - pause) })
  })
  return spans
}

/**
 * The volume of the music bed at `frame`: MUSIC.level, MUSIC.duckedLevel from a moment before each voiced line to a moment after it
 * (moving between them over MUSIC.rampSeconds), faded in at the start and out at the end of the video. Pure, so a test can read it.
 * @param {{ startFrame: number, endFrame: number }[]} spans  voicedSpans(plan)
 * @param {number} frame
 * @param {number} totalFrames
 */
export function musicVolumeAt(spans, frame, totalFrames, fps = FPS) {
  const lead = MUSIC.leadSeconds * fps
  const tail = MUSIC.tailSeconds * fps
  const ramp = MUSIC.rampSeconds * fps
  let duck = 0
  for (const span of spans) {
    const from = span.startFrame - lead
    const to = span.endFrame + tail
    const depth = frame < from ? clamp01(1 - (from - frame) / ramp) : frame > to ? clamp01(1 - (frame - to) / ramp) : 1
    if (depth > duck) duck = depth
  }
  const level = MUSIC.level + (MUSIC.duckedLevel - MUSIC.level) * duck
  const fadeIn = clamp01(frame / (MUSIC.fadeInSeconds * fps))
  const fadeOut = clamp01((totalFrames - frame) / (MUSIC.fadeOutSeconds * fps))
  return level * Math.min(fadeIn, fadeOut)
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
