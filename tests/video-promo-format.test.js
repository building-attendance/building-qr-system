// The format of the promo's frame (video/promo/format.js, task W3a of the topic "promo-web-flow"): VERTICAL holds the numbers that both
// vertical cuts were drawn with before the format existed, the old constants are its numbers, and the camera and the devices of both cuts
// are the same at every planned frame with the format given as with the old constants (written out here as they were, numbers and all).
// The render itself (a browser) is not run here: the renders of both cuts are compared by SSIM in the pull request.
import { describe, it, expect } from 'vitest'
import { FORMATS, VERTICAL, WIDE } from '../video/promo/format.js'
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
  EDGE,
  LIFE,
  MAX_PUSH,
  cameraTransform,
  chatBox,
  insetArea,
  insetHeight,
  insetTop,
  laptopOutline,
  laptopRest,
  lifeScale,
  phoneBox,
  phoneRest,
  pushLimit,
  sceneView,
  viewInArea,
} from '../video/promo/parts/moves.js'
import { lensAt, lensesOf, liftProgress } from '../video/promo/parts/magnifier.jsx'
import { cameraOf, continuityOf, inDevice, pictureEnd, pictureTimeline, stageOf } from '../video/promo/parts/screens.js'
import { BOXES, LONG, LONG_LABELS, PROMO_PICTURES, REPOSITORY_URL, SHORT, STRIP_STAGES } from '../video/promo/script/index.js'
import { LENSES } from '../video/promo/script/long.js'
import { HEIGHT, WHIP_FRAMES, WIDTH, beatFrames, planPromo, pulseAt, screenOf } from '../video/promo/timing.js'
import { LANDING, captionLayout, cardLayout, closingCode, closingLayout, inColumn, labelShown, textWidth, titleLayout, wideAddress, wrapLines } from '../video/promo/wide.js'
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
    expect(FORMATS).toEqual({ vertical: VERTICAL, wide: WIDE })
    // No stage and no column: every part draws the vertical frame as it did before the wide one existed.
    expect([VERTICAL.stage, VERTICAL.column, VERTICAL.left, VERTICAL.chat.zoom]).toEqual([undefined, undefined, undefined, undefined])
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

// ---- The wide frame (task W3b): its numbers, the caption column's lines, and the safe area at every planned frame of both cuts ----

const textOf = (scene) => scene.phrases.map((phrase) => phrase.text).join(' ')
const inside = (box, safe) => box.left >= safe.left - 1e-6 && box.right <= safe.right + 1e-6 && box.top >= safe.top - 1e-6 && box.bottom <= safe.bottom + 1e-6
/** A box of words that land (wide.js, LANDING): the first word of each line, at the right edge of a right-to-left block, grows past it. */
const landing = (box, lines, size) => {
  const first = Math.max(...lines.map((line) => textWidth(line.text.split(' ')[0], size)))
  return { ...box, left: box.left - LANDING.side * first, right: box.right + LANDING.side * first, bottom: box.bottom + LANDING.below }
}
/** A box grown by `scale` about its own middle. */
const grown = (box, scale) => {
  const [x, y] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2]
  return { left: x - ((x - box.left) * scale), right: x + ((box.right - x) * scale), top: y - ((y - box.top) * scale), bottom: y + ((box.bottom - y) * scale) }
}

describe('the wide format (video/promo/format.js, WIDE)', () => {
  const { stage, safe, column } = WIDE

  it('is a 1920x1080 frame with the stage at the left, the caption column at the right and the safe area of a web player', () => {
    expect([WIDE.name, WIDE.width, WIDE.height]).toEqual(['wide', 1920, 1080])
    expect(safe).toEqual({ left: 96, right: 1824, top: 80, bottom: 930 }) // the top 80 px for an embed's overlays, the bottom 150 for the controls
    expect([stage.left, stage.left + stage.width, stage.height]).toEqual([96, 861, 1080]) // committee/04-web-distribution.md, section 4
    expect([column.left, column.right]).toEqual([1010, 1792]) // 1010 to 1824, its words 32 px short of the edge for a landing keyword
    expect(column.sizes).toEqual([72, 64])
    expect(column.lines).toBe(3)
    expect(WIDE.label.top + WIDE.label.size * WIDE.label.lineHeight + 17).toBeLessThan(column.top) // the stage's name, its bar under it, above the caption
    expect(stage.pictureArea).toEqual({ top: 80, width: 765, height: 850 }) // a zoom keeps its element inside y 80 to 930
    expect(Object.isFrozen(WIDE) && Object.isFrozen(stage) && Object.isFrozen(column) && Object.isFrozen(safe)).toBe(true)
  })

  it('stands the phone 860 to 900 px tall, its screen inside the safe area, both its sides on the stage at the largest push', () => {
    for (const place of [stage.phone, stage.longPhone]) {
      const box = phoneBox(place, stage)
      expect(box.height).toBeGreaterThanOrEqual(860)
      expect(box.height).toBeLessThanOrEqual(900)
      expect(place.top + LAYOUT.bezel * place.scale).toBeGreaterThanOrEqual(safe.top)
      expect(place.top + (PHONE.height - LAYOUT.bezel) * place.scale).toBeLessThanOrEqual(safe.bottom)
      expect(box.left + box.width / 2).toBe(stage.width / 2) // centred on the stage
      // W1's rules hold here: the camera may push it in to MAX_PUSH, and its sides stay EDGE inside the stage.
      expect(pushLimit(box.width, stage.width)).toBe(MAX_PUSH)
      expect(box.width * MAX_PUSH).toBeLessThanOrEqual(stage.width - 2 * EDGE)
    }
    // The laptop is as wide as can drift and pulse with both its sides EDGE inside the stage.
    const limit = pushLimit(laptopOutline(stage.laptop), stage.width)
    expect(limit).toBeGreaterThanOrEqual(LIFE)
    expect(laptopOutline(stage.laptop) * limit).toBeLessThanOrEqual(stage.width - 2 * EDGE + 1e-9)
  })

  it('wraps a caption the way the browser does: the advances are those measured in Rubik, never narrower', () => {
    // The widths of the words of one caption at 72 px, weight 600, as the browser measured them (28/10/2026): the table holds the wider of
    // weights 600 and 700, so a word is as wide as the browser draws it or up to 2% wider, never narrower.
    const measured = [87, 172, 302, 211, 99, 277, 226]
    LONG.scripts.he.signin.split(' ').forEach((word, n) => {
      expect(textWidth(word, 72)).toBeGreaterThanOrEqual(measured[n] - 0.5)
      expect(textWidth(word, 72)).toBeLessThanOrEqual(measured[n] * 1.02 + 0.5)
    })
    // The browser puts that caption on three lines of the column at 72 px, and the model agrees.
    expect(wrapLines(LONG.scripts.he.signin, 72, column.right - column.left)).toHaveLength(3)
  })

  it.each([
    ['the short cut', SHORT],
    ['the long cut', LONG],
  ])('puts every caption of %s on three lines at most in the column, at 72 px or else 64', (_, script) => {
    for (const [id, text] of Object.entries(script.scripts.he)) {
      const { size, lines, box } = captionLayout(text)
      expect(lines.length, id).toBeLessThanOrEqual(column.lines)
      expect(column.sizes, id).toContain(size)
      if (size !== column.sizes[0]) expect(wrapLines(text, column.sizes[0], column.right - column.left).length, id).toBeGreaterThan(column.lines)
      expect(box.left, id).toBeGreaterThanOrEqual(column.left)
    }
  })

  /** Every box of text that the wide frame draws at a frame of a scene that is not in a whip (a whip slides the whole scene). */
  function sceneText(plan, index, frame, cut, f) {
    const scene = plan.scenes[index]
    const boxes = []
    if (scene.picture === 'text' && index === 0) {
      const { lines, box } = titleLayout(textOf(scene))
      boxes.push(['title', landing(box, lines, WIDE.title.size)])
    } else if (scene.picture === 'text') {
      const { size, lines, box } = cardLayout(textOf(scene))
      boxes.push(['card', grown(landing(box, lines, size), 1 + 0.015 * pulseAt(frame, TRACK))])
    } else if (scene.picture === 'closing') {
      const words = closingLayout(textOf(scene), wideAddress(REPOSITORY_URL))
      boxes.push(['closing caption', landing(words.caption.box, words.caption.lines, WIDE.closing.caption)], ['address', words.address.box])
      if (cut === LONG) {
        const width = textWidth(LONG_LABELS.guide, WIDE.closing.guide) + 56
        const top = closingCode().guideTop
        boxes.push(['guide', { left: stage.left + (stage.width - width) / 2, right: stage.left + (stage.width + width) / 2, top, bottom: top + WIDE.closing.guide * 1.2 + 16 }])
      }
    } else {
      const { size, lines, box } = captionLayout(textOf(scene))
      boxes.push(['caption', landing(box, lines, size)])
    }
    // The drawn chat, scaled to its room and alive (drawn.jsx): every word of it is inside its box.
    const talk = pictureTimeline(scene).find((one) => one.picture === 'agent')
    if (talk && frame >= talk.frame) {
      const { zoom, place } = chatBox(stage)
      const box = { left: stage.left + place.left, right: stage.left + place.left + place.width, top: place.top, bottom: place.top + place.height }
      boxes.push(['chat', grown(box, zoom * lifeScale(frame, talk.frame, pictureEnd(scene, talk.frame), TRACK))])
    }
    // The laptop's lenses (magnifier.jsx), where the camera has them: on the stage, never over the column.
    const at = cut === LONG ? stageOf(scene, f, stage) : null
    if (at?.laptop) {
      const lenses = lensesOf(at.camera, at.rest, pushLimit(at.outline, at.area.width), LENSES[scene.id], at.area)
      const view = cameraTransform(sceneView({ frame, scene, ...at, tempo: TRACK }), at.rest, at.area)
      liftProgress(frame, lenses, beatFrames(TRACK)).forEach((p, n) => {
        if (p <= 0) return
        const lens = lensAt(lenses[n].rect, at.rest, lenses[n].up, p)
        const left = stage.left + view.x + view.scale * lens.x
        const top = view.y + view.scale * lens.y
        boxes.push([`lens ${n}`, { left, right: left + view.scale * lens.width, top, bottom: top + view.scale * lens.height }])
      })
    }
    return boxes
  }

  it.each([
    ['the short cut', SHORT],
    ['the long cut', LONG],
  ])('keeps every word of %s inside x 96 to 1824 and y 80 to 930 at every planned frame', (_, cut) => {
    const f = frames()
    const plan = planPromo('he', TRACK, cut)
    let checked = 0
    const kinds = new Set()
    plan.scenes.forEach((scene, index) => {
      const next = plan.scenes[index + 1]
      const end = scene.endFrame - (next && !next.continues ? WHIP_FRAMES : 0)
      for (let frame = scene.startFrame; frame < end; frame += 1) {
        for (const [kind, box] of sceneText(plan, index, frame, cut, f)) {
          expect(inside(box, safe), `${kind} of ${scene.id} at ${frame}: ${JSON.stringify(box)}`).toBe(true)
          kinds.add(kind)
          checked += 1
        }
      }
    })
    // The stage's name, which stays still through the whips, at every frame where it shows (the long cut, PromoLong.jsx).
    if (cut === LONG) {
      for (let frame = 0; frame < plan.totalFrames; frame += 1) {
        const scene = plan.scenes.find((one) => frame < one.endFrame)
        // Never over a card, whose words stand where the name would: gone by the end of the whip into it, back only in the whip out of it.
        if (!inColumn(scene) && frame < scene.endFrame - WHIP_FRAMES) expect(labelShown(plan, frame), `the stage's name over ${scene.id} at ${frame}`).toBe(0)
        if (!STRIP_STAGES.includes(scene.stage) || labelShown(plan, frame) === 0) continue
        const { label } = WIDE
        const box = { left: column.right - textWidth(LONG_LABELS.stages[scene.stage], label.size), right: column.right, top: label.top, bottom: label.top + label.size * label.lineHeight + 17 }
        expect(inside(box, safe), `the stage's name at ${frame}`).toBe(true)
        kinds.add('label')
      }
      expect([...kinds].sort()).toEqual(['address', 'caption', 'card', 'chat', 'closing caption', 'guide', 'label', 'lens 0', 'lens 1', 'lens 2', 'lens 3', 'title'])
    } else expect([...kinds].sort()).toEqual(['address', 'caption', 'card', 'closing caption', 'title'])
    expect(checked).toBeGreaterThan(cut === LONG ? 2800 : 800)
  })
})
