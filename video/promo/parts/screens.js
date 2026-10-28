// What the long cut shows in a scene of its plan, as plain functions (no Remotion, no React), so that the unit run of the repository can
// test them (tests/video-promo.test.js) and PromoLong.jsx reads the same answers: which picture is on screen at a frame and until when,
// which pictures are drawn over the whole frame instead of in the device, and the camera and the rings of a scene, measured on the
// recorder's frames.json, the device each scene stands in and where its camera is at a frame (moves.js), and the bezel of each app's phone.
import { DRAWN_PICTURES, WIDE_ZOOMS } from '../script/index.js'
import { screenOf } from '../timing.js'
import { BEZELS, LAPTOP_OUTLINE, LONG_PHONE, PHONE, PICTURE_AREA, insetArea, laptopRest, phoneRest, sceneView, spanRect, viewInArea } from './moves.js'

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
 * The pictures that the device draws at a frame of the video, each with its opacity, under the ones after it: the scene's first picture
 * from the first frame of its sequence (so the whip brings the screen in already drawn), each later one cross-fading in over `fade`
 * frames from its own frame, and none that a later one covers whole. `before` is the picture that the scene before it ended on, for a scene
 * that continues it on another picture: drawn whole under the first one, which cross-fades in on the scene's first frame.
 * @param {{ picture: string, startFrame: number, then?: string, thenFrame?: number, later?: { picture: string, frame: number }[] }} scene
 * @param {number} global
 * @param {number} fade
 * @param {string | null} [before]
 * @returns {{ picture: string, frame: number, opacity: number }[]}
 */
export function drawnPictures(scene, global, fade, before = null) {
  const own = pictureTimeline(scene).filter((one) => inDevice(one.picture))
  const shown = before && before !== own[0]?.picture ? [{ picture: before, frame: -Infinity }, ...own] : own
  const drawn = []
  shown.forEach((one, index) => {
    if (index > 0 && global < one.frame) return
    if (index + 1 < shown.length && global >= shown[index + 1].frame + fade) return // covered whole by the next one
    const opacity = index === 0 ? 1 : Math.min(1, Math.max(0, (global - one.frame) / fade))
    drawn.push({ picture: one.picture, frame: one.frame, opacity })
  })
  return drawn
}

/**
 * The camera of a scene with zooms: the size of the device's pictures and each move, its rectangle (frames.json `zooms`, or the span
 * of WIDE_ZOOMS) and the element it keeps in view (frames.json `boxes`). Null for a scene without a zoom. Refuses a zoom on a picture
 * that the device does not show, or device pictures of different sizes in one scene.
 * @param {ReturnType<typeof import('../timing.js').planPromo>['scenes'][number]} scene
 * @param {{ pictures: Record<string, { width: number, height: number, boxes: Record<string, object>, zooms: Record<string, object> }> }} frames
 */
export function cameraOf(scene, frames) {
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
    const rect = wide ? spanRect(wide.map((box) => entry.boxes[box]), entry) : entry.zooms[move.box]
    return { frame: move.frame, rect, box: entry.boxes[move.box] }
  })
  return { picture: { width: size.width, height: size.height }, moves }
}

export { BEZELS }
/** The bezel of the phone that shows `picture` (the provider's, dark, for a drawn picture such as the camera). */
export const bezelOf = (picture) => (screenOf(picture)?.app === 'committee' ? BEZELS.committee : BEZELS.provider)

/**
 * Where a scene with zooms stands and what its camera frames: on the laptop (a computer's picture) or the long cut's phone, its rest, its
 * width at rest in the frame (`outline`), and the area its camera frames (above a picture in picture, from the start of the scene, so
 * that the camera does not move when the inset lands). Null for a scene without a zoom.
 * @param {ReturnType<typeof import('../timing.js').planPromo>['scenes'][number]} scene
 * @param {Parameters<typeof cameraOf>[1]} frames
 */
export function stageOf(scene, frames) {
  const camera = cameraOf(scene, frames)
  if (!camera) return null
  const laptop = screenOf(scene.picture)?.device === 'computer'
  const inset = scene.inset ? frames.pictures[scene.inset.picture] : null
  return {
    camera,
    laptop,
    rest: laptop ? laptopRest(camera.picture) : phoneRest(camera.picture, LONG_PHONE),
    outline: laptop ? LAPTOP_OUTLINE : PHONE.width * LONG_PHONE.scale,
    area: inset ? insetArea(inset) : PICTURE_AREA,
  }
}

/**
 * Where a scene that continues the one before it (`continues`) starts: the view of that one's camera on its last frame (without the
 * pulse of the bar line, which this scene's camera adds), in this scene's area, and the picture it ended on, which this one cross-fades
 * from (drawnPictures). Null for a scene that does not continue. Refuses a scene before it that has no camera, that ends on a picture
 * drawn over the whole frame, or whose device or picture size differs.
 * @param {ReturnType<typeof import('../timing.js').planPromo>['scenes']} scenes
 * @param {number} index
 * @param {Parameters<typeof cameraOf>[1]} frames
 * @param {{ bpm: number, firstBeat: number }} tempo
 * @param {(t: number) => number} [ease] the easing of the moves (zoom.jsx), for a scene before that ends during a move
 */
export function continuityOf(scenes, index, frames, tempo, ease) {
  const scene = scenes[index]
  if (!scene.continues) return null
  const before = scenes[index - 1]
  const [was, is] = [stageOf(before, frames), stageOf(scene, frames)]
  const last = pictureAt(before, before.endFrame)
  if (!was || !is || !inDevice(last) || was.laptop !== is.laptop || was.camera.picture.width !== is.camera.picture.width || was.camera.picture.height !== is.camera.picture.height) {
    throw new Error(`Scene "${scene.id}" continues "${before.id}", which does not end on a zoomed screen of the same device and size.`)
  }
  const end = sceneView({ frame: before.endFrame, scene: before, ...was, from: continuityOf(scenes, index - 1, frames, tempo, ease)?.from, tempo, ease, pulse: false })
  return { from: viewInArea(end, was.area, is.area), picture: last }
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
