// The arithmetic of the promo's camera and progress strip, as plain functions (no Remotion, no React, no browser), so that the unit run
// of the repository can test it (tests/video-promo.test.js) and the parts (zoom.jsx, strip.jsx) read the same numbers.
//
// A "view" is what the camera looks at: `scale`, the pixels of the video per pixel of the picture, and `cx`, `cy`, the point of the
// picture (in its own pixels) at the centre of the picture area, which is the frame between the progress strip and the caption bar (a
// zoomed picture never reads as half under the strip). A device (the phone, the
// computer) is drawn at rest by its scene; the camera is a scale and a shift of that drawing, so the device and its picture move together.
//
// The camera pushes in, it does not crop (decision E2 of the topic "promo-web-flow"): a zoom enlarges the device to MAX_PUSH times its
// size at rest at the most, keeps it centred across the frame so that both its side edges stay in view, and moves only up and down to
// keep the element that the caption names in view. It never holds still: after a move lands it drifts toward its element (DRIFT over the
// rest of the hold), and the 2% pulse of the bar line (PULSE.phone) is on the view. A scene that continues the one before it starts
// where that one's camera ended (liveView, `from`).
import { COLORS } from '../../src/theme.js'
import { LAYOUT } from '../../src/timing.js'
import { STAGES, STRIP_STAGES } from '../script/index.js'
import { HEIGHT, PULSE, WHIP_FRAMES, WIDTH, beatFrame, beatFrames, pulseAt } from '../timing.js'

/** The caption bar at the bottom of a scene with a picture is this tall, and the progress strip at the top this tall (strip.jsx). */
export const BAR_HEIGHT = 400
export const STRIP_HEIGHT = 84
/** The part of the frame where a zoomed picture is shown: between the strip and the caption bar. */
export const PICTURE_AREA = Object.freeze({ top: STRIP_HEIGHT, width: WIDTH, height: HEIGHT - BAR_HEIGHT - STRIP_HEIGHT })

// ---- The devices at rest (phone.jsx, laptop.jsx and inset.jsx draw them; the camera starts from here) ----

/** The phone's screen and the phone with its bezel, in its own units, and where the short cut stands it and how large. */
export const SCREEN = Object.freeze({ width: LAYOUT.screenWidth, height: LAYOUT.screenHeight })
export const PHONE = Object.freeze({ scale: 1.5, top: 36, width: SCREEN.width + LAYOUT.bezel * 2, height: SCREEN.height + LAYOUT.bezel * 2 })
/**
 * The long cut's phone at rest stands this far under the strip (the short cut's stands 48 px under where the strip would be), as large as
 * the space down to the caption bar allows: 973 units tall at this scale end 25 px above the bar.
 */
export const LONG_PHONE = Object.freeze({ scale: 1.43, top: STRIP_HEIGHT + 20 })

/**
 * Where a picture of `picture.width` pixels sits in the frame when the phone is at rest: its top left corner (the screen's, inside the
 * bezel) and the pixels of the frame per pixel of the picture. The zoom (zoom.jsx) starts from here.
 * @param {{ width: number }} picture
 * @param {{ scale: number, top: number }} [place] where the phone stands (PHONE when not given)
 * @returns {Rest}
 */
export const phoneRest = (picture, place = PHONE) => ({
  x: (WIDTH - PHONE.width * place.scale) / 2 + LAYOUT.bezel * place.scale,
  y: place.top + LAYOUT.bezel * place.scale,
  scale: (SCREEN.width * place.scale) / picture.width,
})

/**
 * The bezel of a phone by whose app it shows (decision E2, "whose device"; screens.js, bezelOf): the provider's phone is dark, as in the
 * short cut, and the committee's is light, with a darker ring around it and a line around its screen, so that it reads as a phone on the
 * violet ground and its white screen does not melt into it.
 */
export const BEZELS = Object.freeze({
  provider: Object.freeze({ color: COLORS.phone, ring: 'rgba(255, 255, 255, 0.14)' }),
  committee: Object.freeze({ color: '#e4e0f2', ring: 'rgba(21, 18, 31, 0.35)', screen: 'rgba(21, 18, 31, 0.22)' }),
})

/**
 * The laptop of the long cut: its screen this wide in the frame at rest, its bezel, and the base under it, which overhangs the bezel on
 * each side. The whole laptop is 988 px wide, so that it can drift and pulse with both its sides in the frame (pushLimit).
 */
export const LAPTOP = Object.freeze({ screenWidth: 920, bezel: 18, baseHeight: 34, baseOverhang: 16 })
/** The width of the laptop in the frame at rest, its base included. */
export const LAPTOP_OUTLINE = LAPTOP.screenWidth + 2 * (LAPTOP.bezel + LAPTOP.baseOverhang)

/**
 * Where a picture of the computer sits in the frame when the laptop is at rest (its top left corner and the pixels of the frame per pixel
 * of the picture): the laptop in the middle of the picture area.
 * @param {{ width: number, height: number }} picture
 * @returns {Rest}
 */
export function laptopRest(picture) {
  const height = (LAPTOP.screenWidth * picture.height) / picture.width
  const total = height + 2 * LAPTOP.bezel + LAPTOP.baseHeight
  return { x: (WIDTH - LAPTOP.screenWidth) / 2, y: PICTURE_AREA.top + (PICTURE_AREA.height - total) / 2 + LAPTOP.bezel, scale: LAPTOP.screenWidth / picture.width }
}

/** The picture in picture (inset.jsx): its margin from the edges, its bezel, its width in the frame, and the room the camera leaves above it. */
export const INSET = Object.freeze({ margin: 48, bezel: 10, width: Math.round(WIDTH / 3), gap: 24 })

/** The height of an inset of `width` in the frame, with its bezel, for a picture of this shape. */
export const insetHeight = (picture, width = INSET.width) => Math.round(((width - 2 * INSET.bezel) * picture.height) / picture.width) + 2 * INSET.bezel

/**
 * The top of an inset in a bottom corner, in pixels of the frame: the long cut frames its zoom above it, so that the picture in picture
 * never covers what the camera shows.
 * @param {{ width: number, height: number }} picture
 * @param {number} [width]
 */
export const insetTop = (picture, width = INSET.width) => HEIGHT - BAR_HEIGHT - INSET.margin - insetHeight(picture, width)

/** The part of the frame that the camera frames in a scene with a picture in picture: above it, from the start of the scene. */
export const insetArea = (picture) => Object.freeze({ top: STRIP_HEIGHT, width: WIDTH, height: insetTop(picture) - INSET.gap - STRIP_HEIGHT })

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect a rectangle in the picture's own pixels
 * @typedef {{ x: number, y: number, scale: number }} Rest where the picture's top left corner is in the frame when the camera is at rest, and the pixels of the frame per pixel of the picture
 * @typedef {{ scale: number, cx: number, cy: number }} View
 */

/**
 * The view of a device at rest: its own scale, and the point of the picture that sits at the centre of the area.
 * @param {Rest} rest
 * @param {{ top?: number, width: number, height: number }} [area]
 * @returns {View}
 */
export function restView(rest, area = PICTURE_AREA) {
  return { scale: rest.scale, cx: (area.width / 2 - rest.x) / rest.scale, cy: ((area.top ?? 0) + area.height / 2 - rest.y) / rest.scale }
}

/**
 * The most the camera enlarges a device: this many times its size at rest, its drift and its pulse included (decision E2). The long
 * cut's phone is then 998 pixels wide in a frame of 1080, and its body text about 34 pixels high.
 */
export const MAX_PUSH = 1.5
/** After a move lands, the camera keeps pushing toward its element by this share of its scale over the rest of the hold. */
export const DRIFT = 0.03
/** How much larger than its view the camera shows a device at the most alive (the end of a hold, on a bar line). */
export const LIFE = (1 + DRIFT) * (1 + PULSE.phone)
/** A device's side edges stay at least this many pixels inside the frame. */
export const EDGE = 16

/**
 * The most the camera may enlarge a device of `outline` pixels wide at rest, centred across a frame of `width`: MAX_PUSH, or less for a
 * device so wide that its side edges would leave the frame. Refuses a device too wide to drift and pulse with its edges in the frame.
 * @param {number} outline
 * @param {number} [width]
 */
export function pushLimit(outline, width = WIDTH) {
  const limit = Math.min(MAX_PUSH, (width - 2 * EDGE) / outline)
  if (limit < LIFE) throw new Error(`A device ${outline} px wide at rest cannot drift and pulse with its side edges ${EDGE} px inside a frame ${width} px wide: make it narrower.`)
  return limit
}

/**
 * The view of a zoom (decision E2): the device pushed in as far as `limit` leaves room for its life (LIFE), and no further than the
 * element it is for (`box`, frames.json `boxes`) fits the window; centred across the frame as at rest, so that both side edges stay in
 * view. Vertically the window is centred on the rectangle (frames.json `zooms`, or a span of boxes) and moves up or down to keep the
 * whole `box` in view with the room its life takes, inside the picture (or, when the whole picture fits, where the rest view has it).
 * @param {Rect} rect
 * @param {Rect | null} box
 * @param {{ width: number, height: number }} picture
 * @param {Rest} rest
 * @param {number} limit pushLimit of the device
 * @param {{ top?: number, width: number, height: number }} [area]
 * @returns {View}
 */
export function pushView(rect, box, picture, rest, limit, area = PICTURE_AREA) {
  const fits = box ? area.height / (box.height * rest.scale * LIFE) : Infinity
  const push = Math.max(1, Math.min(limit / LIFE, fits))
  const scale = rest.scale * push
  const tall = area.height / scale // the height of the picture that the area shows
  const at = restView(rest, area)
  if (tall >= picture.height) return { scale, cx: at.cx, cy: Math.min(Math.max(at.cy, picture.height - tall / 2), tall / 2) }
  const room = (tall * (1 - 1 / LIFE)) / 2 // what the drift and the pulse may take from each end of the window
  let top = rect.y + rect.height / 2 - tall / 2
  if (box) {
    if (box.y + box.height > top + tall - room) top = box.y + box.height - tall + room
    if (box.y < top + room) top = box.y - room
  }
  top = Math.min(Math.max(top, 0), picture.height - tall)
  return { scale, cx: at.cx, cy: top + tall / 2 }
}

/**
 * The same place of the camera described in another area (a scene that continues one whose camera frames a smaller area, above a
 * picture in picture): the device stays where it is on screen.
 * @param {View} view
 * @param {{ top?: number, height: number }} from
 * @param {{ top?: number, height: number }} to
 * @returns {View}
 */
export function viewInArea(view, from, to) {
  const centre = (area) => (area.top ?? 0) + area.height / 2
  return { ...view, cy: view.cy + (centre(to) - centre(from)) / view.scale }
}

/**
 * The rectangle that spans boxes side by side (the filters of the history and the Excel button at the other end of the page, on the
 * computer), with `pad` pixels of the picture around them, inside the picture: a zoom that keeps every one of them in view.
 * @param {Rect[]} boxes
 * @param {{ width: number, height: number }} picture
 * @param {number} [pad]
 * @returns {Rect}
 */
export function spanRect(boxes, picture, pad = 24) {
  const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad)
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad)
  const right = Math.min(picture.width, Math.max(...boxes.map((box) => box.x + box.width)) + pad)
  const bottom = Math.min(picture.height, Math.max(...boxes.map((box) => box.y + box.height)) + pad)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The view between two views, `t` from 0 (a) to 1 (b): the scale changes by the same factor every frame (a zoom that does not slow down
 * as it closes in), the centre moves in a straight line.
 * @param {View} a
 * @param {View} b
 * @param {number} t
 * @returns {View}
 */
export function blendViews(a, b, t) {
  return { scale: a.scale * (b.scale / a.scale) ** t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t }
}

/**
 * A view pushed in by `share` of the drift (0 to 1) toward the height `anchor` of the picture (the centre of the element): the anchor stays
 * where it is on screen and the centre across does not move. Without an anchor it pushes in on the centre of the area.
 * @param {View} view
 * @param {number | null} anchor
 * @param {number} share
 * @param {number} [drift]
 * @returns {View}
 */
export function driftView(view, anchor, share, drift = DRIFT) {
  const grow = 1 + drift * share
  return { scale: view.scale * grow, cx: view.cx, cy: anchor == null ? view.cy : anchor + (view.cy - anchor) / grow }
}

/** How far `frame` is from `from` to `to`, from 0 to 1 (0 for a hold of no length). */
const shareOf = (frame, from, to) => (to > from ? Math.min(1, Math.max(0, (frame - from) / (to - from))) : 0)

/**
 * The same life for a picture drawn over the whole frame (the printed sign, the chat), which no camera moves: how much larger than at its
 * start it is at `frame`, drifting by DRIFT from `from` to `until` and pulsing by PULSE.phone on the bar line (none on the settled frame 0).
 * @param {number} frame
 * @param {number} from
 * @param {number} until
 * @param {{ bpm: number, firstBeat: number }} tempo
 * @param {boolean} [settled]
 */
export const lifeScale = (frame, from, until, tempo, settled = false) => (1 + DRIFT * shareOf(frame, from, until)) * (1 + PULSE.phone * (settled ? 0 : pulseAt(frame, tempo)))

/**
 * The view at a frame of a scene, with the camera's life. At rest (or, for a scene that continues the one before it, where that one's
 * camera ended: `from`) until the first move, then each move from where the camera is to its view over `length` frames, `ease` shaping
 * the way. During every hold (before the first move, and from each landing to the next move or the end of the scene) the camera drifts
 * toward the element of the hold's move (the first move's before it) by `drift` of its scale, evenly. The pulse of the bar line (`pulse`,
 * from 0 to 1, timing.js pulseAt) grows the view by PULSE.phone at its peak, on the centre of the area. A move on the scene's first frame
 * (or before it) is there already, so that scene begins zoomed, except in a scene that continues: its camera glides from `from` to its
 * first move from its first frame, whatever that move's beat (`from` has drifted already).
 * @param {{ frame: number, start: number, end: number, rest: View, from?: View | null, moves: { frame: number, view: View, anchor?: number | null }[],
 *   length: number, ease?: (t: number) => number, pulse?: number, drift?: number }} camera `frame` is the frame of the video, `start` and
 *   `end` the scene's first frame and its end, `moves` in order, each with the height of its element's centre (`anchor`).
 * @returns {View}
 */
export function liveView({ frame, start, end, rest, from = null, moves, length, ease = (t) => t, pulse = 0, drift = DRIFT }) {
  const alive = (view) => ({ ...view, scale: view.scale * (1 + PULSE.phone * pulse) })
  let view = from ?? rest
  let anchor = moves[0]?.anchor ?? null
  let holdFrom = start
  let next = 0
  while (!from && next < moves.length && moves[next].frame <= start) {
    view = moves[next].view
    anchor = moves[next].anchor ?? null
    next += 1
  }
  // A scene that continues starts on a camera that has drifted already: it glides to its first move from its first frame, whatever that
  // move's beat, so that it never drifts twice.
  const begins = (n) => (from && n === 0 ? start : Math.max(moves[n].frame, start))
  for (; next < moves.length; next += 1) {
    const move = moves[next]
    const at = begins(next)
    if (frame < at) return alive(driftView(view, anchor, shareOf(frame, holdFrom, at), drift))
    const origin = driftView(view, anchor, shareOf(at, holdFrom, at), drift)
    const land = Math.min(at + length, next + 1 < moves.length ? begins(next + 1) : Infinity)
    const way = (to) => blendViews(origin, move.view, ease(Math.min(1, (to - at) / length)))
    if (frame < land) return alive(way(frame))
    view = way(land)
    anchor = move.anchor ?? null
    holdFrom = land
  }
  return alive(driftView(view, anchor, shareOf(frame, holdFrom, end), drift))
}

/**
 * The views of a scene's moves (pushView), each with the height of its element's centre, which the camera drifts toward.
 * @param {{ frame: number, rect: Rect, box?: Rect | null }[]} moves
 * @param {{ width: number, height: number }} picture
 * @param {Rest} rest
 * @param {number} outline the device's width at rest, in pixels of the frame (its bezel and a laptop's base included)
 * @param {{ top?: number, width: number, height: number }} [area]
 */
export function moveViews(moves, picture, rest, outline, area = PICTURE_AREA) {
  const limit = pushLimit(outline, area.width)
  return moves.map((move) => ({
    frame: move.frame,
    view: pushView(move.rect, move.box ?? null, picture, rest, limit, area),
    anchor: move.box ? move.box.y + move.box.height / 2 : null,
  }))
}

/**
 * The view of the camera of a scene at a frame of the video, as zoom.jsx draws it: liveView with the scene's moves, from its first beat
 * (its first frame, or for the first scene of a track whose first beat is late, that beat, so a move on beat 0 starts there already).
 * @param {{ frame: number, scene: { startFrame: number, endFrame: number }, camera: { picture: { width: number, height: number },
 *   moves: { frame: number, rect: Rect, box?: Rect | null }[] }, rest: Rest, outline: number, area?: { top?: number, width: number, height: number },
 *   from?: View | null, tempo: { bpm: number, firstBeat: number }, ease?: (t: number) => number, settled?: boolean, pulse?: boolean }} at
 *   `pulse: false` leaves the bar line's pulse out (where a scene that continues starts).
 * @returns {View}
 */
export function sceneView({ frame, scene, camera, rest, outline, area = PICTURE_AREA, from = null, tempo, ease, settled = false, pulse = true }) {
  return liveView({
    frame,
    start: Math.max(scene.startFrame, beatFrame(0, tempo)),
    end: scene.endFrame,
    rest: restView(rest, area),
    from,
    moves: moveViews(camera.moves, camera.picture, rest, outline, area),
    length: beatFrames(tempo),
    ease,
    pulse: settled || !pulse ? 0 : pulseAt(frame, tempo),
  })
}

/**
 * The CSS transform (origin at the top left corner) that turns the drawing at rest into the view: `scale` times larger, then shifted.
 * @param {View} view
 * @param {Rest} rest
 * @param {{ top?: number, width: number, height: number }} [area]
 */
export function cameraTransform(view, rest, area = PICTURE_AREA) {
  const scale = view.scale / rest.scale
  const x = area.width / 2 - scale * (rest.x + rest.scale * view.cx)
  const y = (area.top ?? 0) + area.height / 2 - scale * (rest.y + rest.scale * view.cy)
  return { scale, x, y }
}

/**
 * The state of each label of the progress strip in a scene of `stage`: the stage itself is `lit`, the ones before it `done`, the ones
 * after it `dim`. A stage that the strip does not label (the opening, the AI) lights none of them: before the first it leaves all dim,
 * after `see` it leaves the three before it done (decision D3).
 * @param {string} stage
 * @param {readonly string[]} [strip]
 * @param {readonly string[]} [stages]
 * @returns {('done' | 'lit' | 'dim')[]}
 */
export function stripStates(stage, strip = STRIP_STAGES, stages = STAGES) {
  const at = stages.indexOf(stage)
  if (at < 0) throw new Error(`The stage "${stage}" is not one of ${stages.join(', ')}.`)
  return strip.map((one) => {
    const index = stages.indexOf(one)
    return index < at ? 'done' : index === at ? 'lit' : 'dim'
  })
}

/**
 * How much of the progress strip shows on `frame`, from 0 to 1. A cut that opens on a text scene (the long cut's title card) opens
 * without it, so that frame 0, the poster and the thumbnail that a platform takes from it are the card alone: the strip fades in over the
 * whip that ends that first scene. A cut that opens on a screen shows it from frame 0.
 * @param {{ scenes: readonly { picture: string, endFrame: number }[] }} plan
 * @param {number} frame
 */
export function stripOpacity(plan, frame) {
  const first = plan.scenes[0]
  if (first.picture !== 'text') return 1
  return Math.min(1, Math.max(0, (frame - (first.endFrame - WHIP_FRAMES)) / WHIP_FRAMES))
}
