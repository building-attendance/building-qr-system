// The frame of the promo video and the layout numbers that its parts read from it, as one object per format: the width and the height,
// the caption bar and the progress strip, the picture area between them, where the phone stands in each cut, the laptop, the picture in
// picture, the printed sign and the chat. The parts read the format from the composition (parts/format.jsx, useFormat) and the pure
// functions of parts/moves.js and parts/screens.js take it as a parameter, never a module constant, so that another format (16:9, task
// W3b of the topic "promo-web-flow", decision E6) is a new object here and not a change to the parts. No import at all: timing.js, the
// unit run and the render read it as they are.
//
// VERTICAL is the format of both vertical cuts (1080x1920), with the numbers they were drawn with before the format existed; WIDE, at the
// end of the file, is the web screen's.

/**
 * @typedef {{ top: number, width: number, height: number }} Area a band of the frame, from `top`, as wide as the frame
 * @typedef {{
 *   name: string,
 *   width: number,
 *   height: number,
 *   bar: number,
 *   strip: number,
 *   pictureArea: Area,
 *   phone: { scale: number, top: number },
 *   longPhone: { scale: number, top: number },
 *   laptop: { screenWidth: number, bezel: number, baseHeight: number, baseOverhang: number },
 *   inset: { margin: number, bezel: number, width: number, gap: number },
 *   sheetWidth: number,
 *   chat: { side: number, gap: number },
 * }} Format
 */

/**
 * A format from its frame and its layout: the picture area is the band between the strip and the caption bar, and the picture in picture
 * is a third of the frame wide.
 * @param {Omit<Format, 'pictureArea' | 'inset'> & { inset: Omit<Format['inset'], 'width'> }} layout
 * @returns {Readonly<Format>}
 */
function makeFormat(layout) {
  const { width, height, bar, strip } = layout
  return Object.freeze({
    ...layout,
    pictureArea: Object.freeze({ top: strip, width, height: height - bar - strip }),
    phone: Object.freeze({ ...layout.phone }),
    longPhone: Object.freeze({ ...layout.longPhone }),
    laptop: Object.freeze({ ...layout.laptop }),
    inset: Object.freeze({ ...layout.inset, width: Math.round(width / 3) }),
    chat: Object.freeze({ ...layout.chat }),
  })
}

const STRIP = 84

export const VERTICAL = makeFormat({
  name: 'vertical',
  width: 1080,
  height: 1920,
  /** The caption bar at the bottom of a scene with a picture is this tall, and the progress strip at the top this tall (strip.jsx). */
  bar: 400,
  strip: STRIP,
  /** Where the short cut stands its phone (its top 36 px from the frame's) and how large, in pixels of the frame per unit of the phone. */
  phone: { scale: 1.5, top: 36 },
  /**
   * The long cut's phone at rest stands this far under the strip, as large as the space down to the caption bar allows: 973 units tall
   * at this scale end 25 px above the bar.
   */
  longPhone: { scale: 1.43, top: STRIP + 20 },
  /**
   * The laptop of the long cut: its screen this wide in the frame at rest, its bezel, and the base under it, which overhangs the bezel on
   * each side. The whole laptop is 988 px wide, so that it can drift and pulse with both its sides in the frame (moves.js, pushLimit).
   */
  laptop: { screenWidth: 920, bezel: 18, baseHeight: 34, baseOverhang: 16 },
  /** The picture in picture (inset.jsx): its margin from the edges, its bezel, and the room the camera leaves above it. */
  inset: { margin: 48, bezel: 10, gap: 24 },
  /** The printed sign drawn this wide in the frame (drawn.jsx). */
  sheetWidth: 900,
  /** The chat (drawn.jsx) stands this far from the frame's sides, and this far under the strip and above the caption bar. */
  chat: { side: 48, gap: 40 },
})

// WIDE is the web screen's frame (1920x1080, task W3b; committee/04-web-distribution.md, section 4): a new composition of the same
// scenes, never a crop of the vertical one. The devices and the drawn pictures stand on a stage at the left (`stage`, x 96 to 861), a
// format of its own that the parts draw in (format.jsx, Stage), so that they centre and push in on it as they do on the vertical frame;
// the caption stands in a column at the right (`column`, where a reader of Hebrew starts), with the name of the stage above it (`label`)
// instead of the progress strip; and no text leaves `safe`: the top 80 px stay free for an embed's overlays and the bottom 150 px for a
// player's controls. Its own `bar`, `strip` and devices are its stage's, which the parts read through `stage`.

/** The layout of the wide frame's stage: 150 px free at the bottom and 80 at the top, the devices and pictures sized to fit between. */
const STAGE_LAYOUT = Object.freeze({
  bar: 150,
  strip: 80,
  /**
   * Both cuts stand the phone 860 px tall (973 units at this scale), its top at y 70, so that its screen at rest is inside y 80 to 930. A
   * recorded screen is a picture, not words that the frame places: pushed in (or, in the short cut, punched and pushed), the phone goes
   * past the safe area, which holds every word that the frame draws (wide.js).
   */
  phone: { scale: 0.884, top: 70 },
  longPhone: { scale: 0.884, top: 70 },
  /** The laptop 696 px wide with its base, the widest that can drift and pulse with both sides 16 px inside the stage (moves.js, pushLimit). */
  laptop: { screenWidth: 648, bezel: 13, baseHeight: 24, baseOverhang: 11 },
  inset: { margin: 32, bezel: 8, gap: 20 },
  /** The printed sign 640 px wide is 720 px tall, inside y 80 to 930 with its life. */
  sheetWidth: 640,
  /** The chat is drawn at 1/zoom of the room it has and scaled down to it (drawn.jsx), so that its words are 35 px. */
  chat: { side: 32, gap: 28, zoom: 0.68 },
})

export const WIDE = (() => {
  const frame = { width: 1920, height: 1080 }
  const stage = makeFormat({ name: 'wide-stage', width: 765, height: frame.height, ...STAGE_LAYOUT, left: 96, frameWidth: frame.width })
  const freeze = (object) => Object.freeze({ ...object })
  return makeFormat({
    name: 'wide',
    ...frame,
    ...STAGE_LAYOUT,
    stage,
    safe: freeze({ left: 96, right: 1824, top: 80, bottom: 930 }),
    /**
     * The caption: Rubik 600, 72 px, or 64 px for a caption that 72 px would put on a fourth line (wide.js, captionLayout), at most three
     * lines, from the right edge of the column, the top of its first line at `top`. The words stop 32 px short of the safe area's right
     * edge, the room that a landing keyword takes at the top of its spring.
     */
    column: freeze({ left: 1010, right: 1792, top: 395, sizes: Object.freeze([72, 64]), lineHeight: 1.25, lines: 3, weight: 600 }),
    /** The name of the scene's stage, 32 px, above the caption, with the strip's yellow bar under it. */
    label: freeze({ top: 316, size: 32, lineHeight: 1.2 }),
    /** The title card's question in the column, beside the phone, in the middle of the safe area. */
    title: freeze({ size: 120, weight: 700, lineHeight: 1.3 }),
    /** A text card across the middle of the frame: a caption longer than 28 characters at the first size, a shorter one at the second. */
    card: freeze({ width: 1400, sizes: Object.freeze([96, 120]), weight: 700, lineHeight: 1.3 }),
    /** The closing card: the code on the stage, the caption and the address (three lines) in the column, the guide's label under the code. */
    closing: freeze({ qr: 520, caption: 88, address: 64, gap: 48, guide: 34, lineHeight: 1.25 }),
  })
})()

/** The formats by name. */
export const FORMATS = Object.freeze({ [VERTICAL.name]: VERTICAL, [WIDE.name]: WIDE })
