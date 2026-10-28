// The format of the promo's frame (video/promo/format.js, task W3a of the topic "promo-web-flow"): VERTICAL holds the numbers that both
// vertical cuts were drawn with before the format existed, the old constants are its numbers, and the camera and the devices of both cuts
// are the same at every planned frame with the format given as with the old constants (written out here as they were, numbers and all).
// The render itself (a browser) is not run here: the renders of both cuts are compared by SSIM in the pull request.
import { describe, it, expect } from 'vitest'
import { FORMATS, VERTICAL } from '../video/promo/format.js'
import {
  BAR_HEIGHT,
  INSET,
  LAPTOP,
  LAPTOP_OUTLINE,
  LONG_PHONE,
  PHONE,
  PICTURE_AREA,
  SCREEN,
  STRIP_HEIGHT,
  cameraTransform,
  insetArea,
  insetHeight,
  insetTop,
  laptopOutline,
  laptopRest,
  phoneBox,
  phoneRest,
  pushLimit,
  sceneView,
  viewInArea,
} from '../video/promo/parts/moves.js'
import { cameraOf, continuityOf, inDevice, stageOf } from '../video/promo/parts/screens.js'
import { BOXES, LONG, PROMO_PICTURES } from '../video/promo/script/index.js'
import { HEIGHT, WHIP_FRAMES, WIDTH, planPromo, screenOf } from '../video/promo/timing.js'
import { LAYOUT } from '../video/src/timing.js'

const TRACK = { bpm: 120, firstBeat: 0 }

describe('the vertical format (video/promo/format.js)', () => {
  it("holds today's numbers, each one by its name", () => {
    expect(VERTICAL.name).toBe('vertical')
    expect(VERTICAL.width).toBe(1080)
    expect(VERTICAL.height).toBe(1920)
    expect(VERTICAL.bar).toBe(400) // the caption bar
    expect(VERTICAL.strip).toBe(84) // the progress strip
    expect(VERTICAL.pictureArea).toEqual({ top: 84, width: 1080, height: 1436 })
    expect(VERTICAL.phone).toEqual({ scale: 1.5, top: 36 }) // the short cut's phone
    expect(VERTICAL.longPhone).toEqual({ scale: 1.43, top: 104 }) // the long cut's, 20 px under the strip
    expect(VERTICAL.laptop).toEqual({ screenWidth: 920, bezel: 18, baseHeight: 34, baseOverhang: 16 })
    expect(VERTICAL.inset).toEqual({ margin: 48, bezel: 10, width: 360, gap: 24 })
    expect(VERTICAL.sheetWidth).toBe(900) // the printed sign
    expect(VERTICAL.chat).toEqual({ side: 48, gap: 40 })
    expect(FORMATS).toEqual({ vertical: VERTICAL })
    expect(Object.isFrozen(VERTICAL) && Object.isFrozen(VERTICAL.pictureArea) && Object.isFrozen(VERTICAL.inset)).toBe(true)
  })

  it('is what the old names of timing.js and moves.js are, so that the code that reads them draws the same frame', () => {
    expect([WIDTH, HEIGHT]).toEqual([VERTICAL.width, VERTICAL.height])
    expect([BAR_HEIGHT, STRIP_HEIGHT]).toEqual([VERTICAL.bar, VERTICAL.strip])
    expect(PICTURE_AREA).toBe(VERTICAL.pictureArea)
    expect({ scale: PHONE.scale, top: PHONE.top }).toEqual(VERTICAL.phone)
    expect([PHONE.width, PHONE.height]).toEqual([SCREEN.width + 2 * LAYOUT.bezel, SCREEN.height + 2 * LAYOUT.bezel])
    expect(LONG_PHONE).toBe(VERTICAL.longPhone)
    expect(LAPTOP).toBe(VERTICAL.laptop)
    expect(LAPTOP_OUTLINE).toBe(988)
    expect(laptopOutline(VERTICAL.laptop)).toBe(LAPTOP_OUTLINE)
    expect(INSET).toBe(VERTICAL.inset)
    expect(pushLimit(PHONE.width * LONG_PHONE.scale)).toBe(pushLimit(PHONE.width * LONG_PHONE.scale, VERTICAL.width))
  })
})

// ---- The old constants, as they were written before the format (master at W1, PR #366) ----

const OLD = Object.freeze({ width: 1080, height: 1920, bar: 400, strip: 84, inset: { margin: 48, bezel: 10, width: Math.round(1080 / 3), gap: 24 } })
const OLD_AREA = { top: OLD.strip, width: OLD.width, height: OLD.height - OLD.bar - OLD.strip }
const OLD_PHONE = { scale: 1.5, top: 36, width: SCREEN.width + LAYOUT.bezel * 2, height: SCREEN.height + LAYOUT.bezel * 2 }
const OLD_LONG_PHONE = { scale: 1.43, top: OLD.strip + 20 }
const OLD_LAPTOP = { screenWidth: 920, bezel: 18, baseHeight: 34, baseOverhang: 16 }

const oldPhoneRest = (picture, place = OLD_PHONE) => ({
  x: (OLD.width - OLD_PHONE.width * place.scale) / 2 + LAYOUT.bezel * place.scale,
  y: place.top + LAYOUT.bezel * place.scale,
  scale: (SCREEN.width * place.scale) / picture.width,
})
function oldLaptopRest(picture) {
  const height = (OLD_LAPTOP.screenWidth * picture.height) / picture.width
  const total = height + 2 * OLD_LAPTOP.bezel + OLD_LAPTOP.baseHeight
  return { x: (OLD.width - OLD_LAPTOP.screenWidth) / 2, y: OLD_AREA.top + (OLD_AREA.height - total) / 2 + OLD_LAPTOP.bezel, scale: OLD_LAPTOP.screenWidth / picture.width }
}
const oldInsetHeight = (picture, width = OLD.inset.width) => Math.round(((width - 2 * OLD.inset.bezel) * picture.height) / picture.width) + 2 * OLD.inset.bezel
const oldInsetTop = (picture, width = OLD.inset.width) => OLD.height - OLD.bar - OLD.inset.margin - oldInsetHeight(picture, width)
const oldInsetArea = (picture) => ({ top: OLD.strip, width: OLD.width, height: oldInsetTop(picture) - OLD.inset.gap - OLD.strip })

/** stageOf as it was: the camera of the scene, the laptop or the long cut's phone at rest, its outline and its area. */
function oldStageOf(scene, frames) {
  const camera = cameraOf(scene, frames)
  if (!camera) return null
  const laptop = screenOf(scene.picture)?.device === 'computer'
  const inset = scene.inset ? frames.pictures[scene.inset.picture] : null
  return {
    camera,
    laptop,
    rest: laptop ? oldLaptopRest(camera.picture) : oldPhoneRest(camera.picture, OLD_LONG_PHONE),
    outline: laptop ? OLD_LAPTOP.screenWidth + 2 * (OLD_LAPTOP.bezel + OLD_LAPTOP.baseOverhang) : OLD_PHONE.width * OLD_LONG_PHONE.scale,
    area: inset ? oldInsetArea(inset) : OLD_AREA,
  }
}

/** Where a scene that continues the one before it starts, from oldStageOf (continuityOf without its checks, which the format does not touch). */
function oldFrom(scenes, index, frames) {
  const scene = scenes[index]
  if (!scene.continues) return null
  const before = scenes[index - 1]
  const [was, is] = [oldStageOf(before, frames), oldStageOf(scene, frames)]
  const end = sceneView({ frame: before.endFrame, scene: before, ...was, from: oldFrom(scenes, index - 1, frames), tempo: TRACK, pulse: false })
  return viewInArea(end, was.area, is.area)
}

/** A frames.json with every picture and box of the long cut, all of them invented numbers (the recorder's pictures are not in the repository). */
const frames = () => ({
  pictures: Object.fromEntries(
    PROMO_PICTURES.map((name) => {
      const size = screenOf(name)?.device === 'computer' ? { width: 2560, height: 1600 } : name === 'committee-print-sign.png' ? { width: 1800, height: 2400 } : { width: 780, height: 1688 }
      const keys = BOXES[name] ?? []
      const rects = (rect) => Object.fromEntries(keys.map((key, n) => [key, { ...rect, x: rect.x + 13 * n, y: rect.y + 97 * n }]))
      return [name, { ...size, boxes: rects({ x: 40, y: 300, width: 300, height: 120 }), zooms: rects({ x: 0, y: 200, width: 390, height: 693 }) }]
    }),
  ),
})

describe('both vertical cuts with the format given as with the old constants', () => {
  it('stand the phone, the laptop and the picture in picture where they stood', () => {
    const phone = { width: 780, height: 1688 }
    const computer = { width: 2560, height: 1600 }
    expect(phoneBox(VERTICAL.phone, VERTICAL)).toEqual({ left: (1080 - OLD_PHONE.width * 1.5) / 2, top: 36, width: OLD_PHONE.width * 1.5, height: OLD_PHONE.height * 1.5 })
    expect(phoneBox(VERTICAL.longPhone)).toEqual({ left: (1080 - OLD_PHONE.width * 1.43) / 2, top: 104, width: OLD_PHONE.width * 1.43, height: OLD_PHONE.height * 1.43 })
    for (const place of [undefined, VERTICAL.phone, VERTICAL.longPhone]) {
      expect(phoneRest(phone, place, VERTICAL)).toEqual(oldPhoneRest(phone, place ?? OLD_PHONE))
      expect(phoneRest(phone, place)).toEqual(oldPhoneRest(phone, place ?? OLD_PHONE))
    }
    expect(laptopRest(computer, VERTICAL)).toEqual(oldLaptopRest(computer))
    expect(laptopRest(computer)).toEqual(oldLaptopRest(computer))
    for (const width of [undefined, 300]) {
      expect(insetHeight(phone, width, VERTICAL)).toBe(oldInsetHeight(phone, width))
      expect(insetTop(phone, width, VERTICAL)).toBe(oldInsetTop(phone, width))
    }
    expect(insetArea(phone, VERTICAL)).toEqual(oldInsetArea(phone))
    expect(insetArea(phone)).toEqual(oldInsetArea(phone))
  })

  it('draw the short cut from the same sizes: it reads only the phone at rest, the caption bar and the width of a whip', () => {
    const plan = planPromo('he', TRACK)
    expect(plan.totalFrames).toBe(1020) // 17 bars of two seconds, the format plays no part in the plan
    // No scene of the short cut has a camera, a picture in picture or a drawn picture over the frame: what its parts read of the frame is
    // where its phone stands (phone.jsx), the height of the caption bar (CaptionBar) and how far a whip slides (whip.jsx, the width).
    expect(plan.scenes.filter((scene) => scene.zoom || scene.inset || scene.later)).toEqual([])
    expect(phoneBox(VERTICAL.phone, VERTICAL)).toEqual({ left: (OLD.width - OLD_PHONE.width * OLD_PHONE.scale) / 2, top: OLD_PHONE.top, width: OLD_PHONE.width * OLD_PHONE.scale, height: OLD_PHONE.height * OLD_PHONE.scale })
    expect([VERTICAL.bar, VERTICAL.width]).toEqual([OLD.bar, OLD.width])
  })

  /** The long script with every scene joined to the one before it that it can continue (the same app on the same device, both zoomed). */
  const lastPicture = (scene) => scene.later?.at(-1)?.picture ?? scene.then ?? scene.picture
  const joined = {
    ...LONG,
    scenes: LONG.scenes.map((scene, index) => {
      const before = LONG.scenes[index - 1]
      const [was, is] = [before && screenOf(lastPicture(before)), screenOf(scene.picture)]
      const joins = was && is && was.app === is.app && was.device === is.device && before.zoom && scene.zoom && inDevice(lastPicture(before))
      return joins ? { ...scene, continues: true } : scene
    }),
  }

  it.each([
    ['the long cut', LONG],
    ['the long cut with every scene that can continue the one before it joined to it', joined],
  ])('move the camera of every scene of %s the same at every frame, its whip included', (_, script) => {
    const f = frames()
    const plan = planPromo('he', TRACK, script)
    let checked = 0
    plan.scenes.forEach((scene, index) => {
      const stage = stageOf(scene, f, VERTICAL)
      const old = oldStageOf(scene, f)
      expect(stage === null, scene.id).toBe(old === null)
      if (!stage) return
      expect(stage, scene.id).toEqual(old)
      expect(stageOf(scene, f), scene.id).toEqual(old)
      const from = continuityOf(plan.scenes, index, f, TRACK, undefined, VERTICAL)?.from ?? null
      expect(from, scene.id).toEqual(oldFrom(plan.scenes, index, f))
      const lead = index > 0 && !scene.continues ? WHIP_FRAMES : 0
      for (let frame = scene.startFrame - lead; frame < scene.endFrame; frame += 1) {
        const view = sceneView({ frame, scene, ...stage, from, tempo: TRACK })
        const was = sceneView({ frame, scene, ...old, from: oldFrom(plan.scenes, index, f), tempo: TRACK })
        expect(view, `${scene.id} at ${frame}`).toEqual(was)
        expect(cameraTransform(view, stage.rest, stage.area), `${scene.id} at ${frame}`).toEqual(cameraTransform(was, old.rest, old.area))
        checked += 1
      }
    })
    expect(checked).toBeGreaterThan(1000)
    if (script === joined) expect(plan.scenes.filter((scene) => scene.continues).length).toBeGreaterThan(0)
  })
})
