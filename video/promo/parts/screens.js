// What the long cut shows in a scene of its plan, as plain functions (no Remotion, no React), so that the unit run of the repository can
// test them (tests/video-promo.test.js) and PromoLong.jsx reads the same answers: which picture is on screen at a frame and until when,
// which pictures are drawn over the whole frame instead of in the device, and the camera and the rings of a scene, measured on the
// recorder's frames.json (the zoom rectangles widened so that no zoom looks soft, moves.js).
import { DRAWN_PICTURES, WIDE_ZOOMS } from '../script/index.js'
import { MAX_ZOOM_SCALE, capZoom, spanRect } from './moves.js'

/**
 * The pictures that the long cut draws over the whole frame, not in the device: the printed sign (a sheet of paper, with the demo code
 * over the sample point's code) and the drawn chat of the AI. The device keeps the picture before it underneath.
 */
export const OVER_FRAME = Object.freeze(['committee-print-sign.png', 'agent'])

/** A picture that the device shows (a recorded screen), as opposed to a drawn one or one over the whole frame. */
export const inDevice = (picture) => !DRAWN_PICTURES.includes(picture) && !OVER_FRAME.includes(picture)

/**
 * The pictures of a planned scene in order, each with the frame of the video where it comes in.
 * @param {{ picture: string, startFrame: number, then?: string, thenFrame?: number, later?: { picture: string, frame: number }[] }} scene
 * @returns {{ picture: string, frame: number }[]}
 */
export function pictureTimeline(scene) {
  return [{ picture: scene.picture, frame: scene.startFrame }, ...(scene.then ? [{ picture: scene.then, frame: scene.thenFrame }] : []), ...(scene.later ?? [])]
}

/** The picture on screen at a frame of the scene (the first one before it starts). */
export function pictureAt(scene, frame) {
  let at = scene.picture
  for (const one of pictureTimeline(scene)) if (frame >= one.frame) at = one.picture
  return at
}

/** The frame where the picture on screen at `frame` gives way to the next one, or the end of the scene. */
export function pictureEnd(scene, frame) {
  return pictureTimeline(scene).find((one) => one.frame > frame)?.frame ?? scene.endFrame
}

/**
 * The camera of a scene with zooms: the size of the device's pictures and each move, its rectangle (frames.json `zooms`, widened to
 * `maxScale` at the most, or the span of WIDE_ZOOMS) and the element it keeps in view (frames.json `boxes`). Null for a scene without
 * a zoom. Refuses a zoom on a picture that the device does not show, or device pictures of different sizes in one scene.
 * @param {ReturnType<typeof import('../timing.js').planPromo>['scenes'][number]} scene
 * @param {{ pictures: Record<string, { width: number, height: number, boxes: Record<string, object>, zooms: Record<string, object> }> }} frames
 * @param {number} [maxScale]
 */
export function cameraOf(scene, frames, maxScale = MAX_ZOOM_SCALE) {
  if (!scene.zoom) return null
  const shown = pictureTimeline(scene).filter((one) => inDevice(one.picture))
  const size = frames.pictures[shown[0]?.picture]
  if (!size) throw new Error(`Scene "${scene.id}" zooms, and its device shows no recorded picture.`)
  for (const one of shown) {
    const entry = frames.pictures[one.picture]
    if (entry.width !== size.width || entry.height !== size.height) throw new Error(`Scene "${scene.id}" shows pictures of different sizes in its device.`)
  }
  const moves = scene.zoom.map((move) => {
    const picture = pictureAt(scene, move.frame)
    if (!inDevice(picture)) throw new Error(`The zoom on "${move.box}" of scene "${scene.id}" is on "${picture}", which the device does not show.`)
    const entry = frames.pictures[picture]
    const wide = WIDE_ZOOMS[picture]?.[move.box]
    const rect = capZoom(wide ? spanRect(wide.map((box) => entry.boxes[box]), entry) : entry.zooms[move.box], entry, maxScale)
    return { frame: move.frame, rect, box: entry.boxes[move.box] }
  })
  return { picture: { width: size.width, height: size.height }, moves }
}

/**
 * The rings of a scene: each box (frames.json `boxes` of the picture on screen at its frame), its frame, and the frame where it goes with
 * its picture. A ring on the scene's first beat starts with the scene, so that on the settled frame 0 (the thumbnail) it is whole even
 * when the track's first beat comes a little after frame 0.
 */
export function ringsOf(scene, frames) {
  return (scene.ring ?? []).map((ring) => {
    const picture = pictureAt(scene, ring.frame)
    const frame = ring.frame === scene.phrases[0].frame ? scene.startFrame : ring.frame
    return { key: `${ring.box}-${ring.frame}`, box: frames.pictures[picture].boxes[ring.box], frame, until: pictureEnd(scene, ring.frame), picture }
  })
}
