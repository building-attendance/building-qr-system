// Where the text of the wide frame goes (format.js, WIDE), as plain functions (no Remotion, no React, no browser), so that the parts
// (parts/wide.jsx, text.jsx, closing.jsx) place their words with them and tests/video-promo-format.test.js holds that no text leaves the
// safe area and that no caption takes a fourth line. A line is wrapped the way the browser wraps the caption's words (between words,
// never inside one), from the advance of each character in Rubik, measured in the browser that renders the promo.

import { WIDE } from './format.js'
import { WHIP_FRAMES } from './timing.js'

/**
 * The advance of each character in Rubik, in thousandths of the font size, the wider of weights 600 and 700 (measured on 28/10/2026 with
 * the files of @fontsource-variable/rubik; the Hebrew letters have no kerning, so a word is the sum of its letters): the 27 letters of
 * Hebrew from U+05D0, and the printable ASCII from the space. Any other character counts as a whole em, which is wider than any of these.
 */
const HEBREW = [634, 574, 482, 558, 645, 290, 415, 649, 647, 282, 557, 550, 535, 633, 675, 284, 440, 647, 630, 582, 584, 548, 585, 664, 551, 762, 709]
const ASCII = [
  221, 291, 452, 689, 668, 807, 742, 243, 384, 384, 445, 611, 278, 479, 284, 534, 680, 497, 650, 659, 682, 646, 651, 573, 677, 641, 292, 300, 517, 567, 516, 597,
  845, 716, 704, 702, 716, 639, 617, 720, 745, 324, 670, 662, 597, 827, 719, 712, 676, 712, 691, 662, 630, 725, 693, 830, 690, 681, 650, 383, 533, 383, 464, 739,
  398, 590, 631, 590, 631, 594, 442, 634, 650, 285, 303, 584, 286, 915, 642, 610, 631, 631, 454, 553, 467, 641, 595, 838, 588, 597, 552, 425, 265, 425, 556,
]

/** @param {string} char */
function advance(char) {
  const code = char.codePointAt(0)
  if (code >= 0x5d0 && code < 0x5d0 + HEBREW.length) return HEBREW[code - 0x5d0] / 1000
  if (code >= 0x20 && code < 0x20 + ASCII.length) return ASCII[code - 0x20] / 1000
  return 1
}

/** The width of `text` on one line at `size` pixels. */
export const textWidth = (text, size) => [...text].reduce((sum, char) => sum + advance(char), 0) * size

/**
 * The lines of `text` at `size` in a box `width` wide, each with its width: the words in order, as many on a line as fit (a word wider than
 * the box has a line of its own). Two pixels of the box are kept for the rounding of the browser.
 * @param {string} text
 * @param {number} size
 * @param {number} width
 */
export function wrapLines(text, size, width) {
  const space = textWidth(' ', size)
  const lines = []
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1)
    const w = textWidth(word, size)
    if (last && last.width + space + w <= width - 2) {
      last.text += ` ${word}`
      last.width += space + w
    } else lines.push({ text: word, width: w })
  }
  return lines
}

/** @typedef {{ left: number, right: number, top: number, bottom: number }} Box a box of the frame, in pixels */

/**
 * The room that a word takes beyond its place while it lands (parts/caption.jsx): it rises from 36 px under it (RISE_PX), and at the top
 * of its spring the keyword is about 16% larger than its size (KEYWORD_SPRING overshoots by about 41% of the 38% that it grows), so 8% of
 * its width on each side. Every word is held to the keyword's room.
 */
export const LANDING = Object.freeze({ below: 36, side: 0.08 })

/**
 * The caption of a scene in the column: its size (the first of the column's sizes at which it takes at most its lines), its lines, and
 * the box of its words, from the right edge of the column (right to left) and from the column's top.
 * @param {string} text
 * @param {typeof WIDE} [format]
 */
export function captionLayout(text, format = WIDE) {
  const { column } = format
  const width = column.right - column.left
  let lines = []
  let size = column.sizes[0]
  for (size of column.sizes) {
    lines = wrapLines(text, size, width)
    if (lines.length <= column.lines) break
  }
  const widest = Math.max(...lines.map((line) => line.width))
  return { size, lines, box: { left: column.right - widest, right: column.right, top: column.top, bottom: column.top + lines.length * size * column.lineHeight } }
}

/** The middle of the safe area, top to bottom: a block of text that the wide frame centres stands about it. */
export const safeMiddle = (format = WIDE) => (format.safe.top + format.safe.bottom) / 2

/**
 * A block of text of `size`, wrapped at `width` and centred on `middle` (top to bottom), from `right` leftward or, without it, centred
 * across on `centre`: its lines and its box.
 * @param {string} text
 * @param {{ size: number, lineHeight: number, width: number, middle: number, right?: number, centre?: number }} at
 */
export function blockLayout(text, { size, lineHeight, width, middle, right, centre }) {
  const lines = wrapLines(text, size, width)
  const widest = Math.max(...lines.map((line) => line.width))
  const height = lines.length * size * lineHeight
  const left = right === undefined ? centre - widest / 2 : right - widest
  return { lines, box: { left, right: left + widest, top: middle - height / 2, bottom: middle + height / 2 } }
}

/** The title card's question, in the column beside the phone, in the middle of the safe area. */
export const titleLayout = (text, format = WIDE) =>
  blockLayout(text, { size: format.title.size, lineHeight: format.title.lineHeight, width: format.column.right - format.column.left, middle: safeMiddle(format), right: format.column.right })

/** A text card's words, across the middle of the frame: the card's first size for a caption longer than 28 characters (captionSize). */
export function cardLayout(text, format = WIDE) {
  const size = text.length > 28 ? format.card.sizes[0] : format.card.sizes[1]
  return { size, ...blockLayout(text, { size, lineHeight: format.card.lineHeight, width: format.card.width, middle: safeMiddle(format), centre: format.width / 2 }) }
}

/**
 * The closing card's column: the caption, then the address in its lines (`address`, left to right, each line whole), as one block in the
 * middle of the safe area, both from the right edge of the column. The guide's label stands under the code, on the stage.
 * @param {string} text
 * @param {string[]} address
 * @param {typeof WIDE} [format]
 */
export function closingLayout(text, address, format = WIDE) {
  const { closing, column } = format
  const width = column.right - column.left
  const caption = wrapLines(text, closing.caption, width)
  const captionHeight = caption.length * closing.caption * closing.lineHeight
  const addressHeight = address.length * closing.address * closing.lineHeight
  const top = safeMiddle(format) - (captionHeight + closing.gap + addressHeight) / 2
  const widest = (lines) => Math.max(...lines.map((line) => line.width))
  const addressWidth = Math.max(...address.map((line) => textWidth(line, closing.address)))
  return {
    caption: { lines: caption, box: { left: column.right - widest(caption), right: column.right, top, bottom: top + captionHeight } },
    address: { box: { left: column.right - addressWidth, right: column.right, top: top + captionHeight + closing.gap, bottom: top + captionHeight + closing.gap + addressHeight } },
  }
}

/** A scene whose caption stands in the column: any but a text card and the closing card, whose words stand where the stage's name would. */
export const inColumn = (scene) => scene.picture !== 'text' && scene.picture !== 'closing'

/**
 * How much of the stage's name shows at `frame`, from 0 to 1 (the long cut, PromoLong.jsx): over a scene whose caption is in the column,
 * and not over a card; it fades out over the whip into a card, and in over the whip out of one.
 * @param {{ scenes: readonly { picture: string, endFrame: number }[] }} plan
 * @param {number} frame
 */
export function labelShown(plan, frame) {
  const index = plan.scenes.findIndex((one) => frame < one.endFrame)
  const at = index < 0 ? plan.scenes.length - 1 : index
  const [scene, next] = [plan.scenes[at], plan.scenes[at + 1]]
  const own = inColumn(scene) ? 1 : 0
  if (!next) return own
  const into = Math.min(1, Math.max(0, (frame - (scene.endFrame - WHIP_FRAMES)) / WHIP_FRAMES))
  return own + ((inColumn(next) ? 1 : 0) - own) * into
}

/** The address of the closing card on the wide frame, without `https://`: three lines, each but the last ending on its slash. */
export const wideAddress = (url) => url.replace(/^https:\/\//, '').split(/(?<=\/)/)

/** The code of the closing card on the stage, in the middle of the safe area, and the guide's label under it: their boxes in the frame. */
export function closingCode(format = WIDE) {
  const { closing, stage } = format
  const left = stage.left + (stage.width - closing.qr) / 2
  const top = safeMiddle(format) - closing.qr / 2 - closing.guide
  return { qr: { left, right: left + closing.qr, top, bottom: top + closing.qr }, guideTop: top + closing.qr + 24 }
}
