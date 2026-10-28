// The frame of the promo video and the layout numbers that its parts read from it, as one object per format: the width and the height,
// the caption bar and the progress strip, the picture area between them, where the phone stands in each cut, the laptop, the picture in
// picture, the printed sign and the chat. The parts read the format from the composition (parts/format.jsx, useFormat) and the pure
// functions of parts/moves.js and parts/screens.js take it as a parameter, never a module constant, so that another format (16:9, task
// W3b of the topic "promo-web-flow", decision E6) is a new object here and not a change to the parts. No import at all: timing.js, the
// unit run and the render read it as they are.
//
// VERTICAL is the format of both cuts today (1080x1920), with the numbers they were drawn with before the format existed.

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

/** The formats by name. */
export const FORMATS = Object.freeze({ [VERTICAL.name]: VERTICAL })
