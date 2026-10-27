// The arithmetic of the promo's camera and progress strip, as plain functions (no Remotion, no React, no browser), so that the unit run
// of the repository can test it (tests/video-promo.test.js) and the parts (zoom.jsx, strip.jsx) read the same numbers.
//
// A "view" is what the camera looks at: `scale`, the pixels of the video per pixel of the picture, and `cx`, `cy`, the point of the
// picture (in its own pixels) at the centre of the picture area, which is the frame between the progress strip and the caption bar (a
// zoomed picture never reads as half under the strip). A device (the phone, the
// computer) is drawn at rest by its scene; the camera is a scale and a shift of that drawing, so the device and its picture move together.
import { STAGES, STRIP_STAGES } from '../script/index.js'
import { HEIGHT, WIDTH } from '../timing.js'

/** The caption bar at the bottom of a scene with a picture is this tall, and the progress strip at the top this tall (strip.jsx). */
export const BAR_HEIGHT = 400
export const STRIP_HEIGHT = 84
/** The part of the frame where a zoomed picture is shown: between the strip and the caption bar. */
export const PICTURE_AREA = Object.freeze({ top: STRIP_HEIGHT, width: WIDTH, height: HEIGHT - BAR_HEIGHT - STRIP_HEIGHT })

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
 * The view of a zoom: the rectangle (9:16, frames.json `zooms`) as wide as the area, so the bezel leaves the frame. The area is wider
 * than 9:16, so it shows the middle of the rectangle's height; the window moves up or down to keep the whole `box` (frames.json `boxes`,
 * the element that the caption names) in view, and stays inside the picture.
 * @param {Rect} rect
 * @param {Rect | null} box
 * @param {{ width: number, height: number }} picture
 * @param {{ top?: number, width: number, height: number }} [area]
 * @returns {View}
 */
export function zoomView(rect, box, picture, area = PICTURE_AREA) {
  const scale = area.width / rect.width
  const tall = area.height / scale // the height of the picture that the area shows
  let top = rect.y + rect.height / 2 - tall / 2
  if (box) {
    if (box.y + box.height > top + tall) top = box.y + box.height - tall
    if (box.y < top) top = box.y
  }
  top = tall >= picture.height ? (picture.height - tall) / 2 : Math.min(Math.max(top, 0), picture.height - tall)
  return { scale, cx: rect.x + rect.width / 2, cy: top + tall / 2 }
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
 * The view at a frame of a scene: at rest until the first move, then each move from where the camera is to its view over `length`
 * frames, `ease` shaping the way. A move on the scene's first frame (or before it) is there already, so that scene begins zoomed.
 * @param {number} frame the frame of the video
 * @param {number} start the scene's first frame
 * @param {View} rest
 * @param {{ frame: number, view: View }[]} moves in order
 * @param {number} length the frames of a move (a beat)
 * @param {(t: number) => number} [ease]
 */
export function viewAt(frame, start, rest, moves, length, ease = (t) => t) {
  let view = rest
  for (const move of moves) {
    if (move.frame <= start) view = move.view
    else if (frame > move.frame) view = blendViews(view, move.view, ease(Math.min(1, (frame - move.frame) / length)))
  }
  return view
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
