// What the promo render stages beside the composition, as plain functions (no Remotion, no browser, no file system), so that the unit run
// of the repository can test them (tests/video-promo.test.js) and render.mjs and Promo.jsx read the same names: which pictures the scenes
// use, the check of the recorder's frames.json (the long cut's boxes and zooms), the drawn sign of the camera scene, and the two QR codes.
// Only `qrcode` is imported (a dependency of the root package and of video/).
import QRCode from 'qrcode'
import { COLORS } from '../src/theme.js'
import { DEMO_QR } from '../src/timing.js'
import { BOXES, DRAWN_PICTURES, PROMO_PICTURES, REPOSITORY_URL, SCENES } from './script/index.js'

/**
 * The picture files that the scenes name (the first, the second, the later ones and the picture in picture), each once, in the order of
 * the scenes: of docs/screenshots/ for the short cut, of the recorder's folder (video/out/promo-frames/he/) for the long one.
 * @param {readonly { picture: string, then?: string, later?: readonly { picture: string }[], inset?: { picture: string } }[]} [scenes]
 */
export function stagedPictures(scenes = SCENES) {
  const files = scenes
    .flatMap((scene) => [scene.picture, scene.then, ...(scene.later ?? []).map((later) => later.picture), scene.inset?.picture])
    .filter((picture) => picture && !DRAWN_PICTURES.includes(picture))
  return [...new Set(files)]
}

/** What to run when the recorder's pictures are missing or out of date. */
const RECORD = 'Run `npm run promo:frames` to record the pictures of the long promo.'

/** The shape of a zoom rectangle: the video's frame (1080x1920), as the recorder cuts it (scripts/promo/settings.mjs, FRAME_ASPECT). */
const ZOOM_ASPECT = 9 / 16

const isRect = (rect) => rect != null && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]) && rect[key] >= 0) && rect.width > 0 && rect.height > 0

/**
 * The recorder's frames.json (its text), checked before anything is drawn from it: every picture of PROMO_PICTURES with its size, and
 * every box of BOXES with its element (`boxes`, for a ring) and its 9:16 rectangle (`zooms`, for a zoom), each inside its picture (a
 * composition that shows only some of the pictures passes them as `pictures`). Returns the parsed file; refuses, naming the picture and
 * the box and `npm run promo:frames`, a file that lacks one.
 * @param {string} text
 * @param {{ pictures?: readonly string[], boxes?: Readonly<Record<string, readonly string[]>> }} [wanted]
 */
export function checkFrames(text, { pictures = PROMO_PICTURES, boxes = BOXES } = {}) {
  let frames
  try {
    frames = JSON.parse(text)
  } catch {
    throw new Error(`frames.json is not JSON. ${RECORD}`)
  }
  if (frames == null || typeof frames.pictures !== 'object' || frames.pictures === null) throw new Error(`frames.json has no pictures. ${RECORD}`)
  for (const name of pictures) {
    const entry = frames.pictures[name]
    if (!entry || !Number.isFinite(entry.width) || !Number.isFinite(entry.height) || entry.width <= 0 || entry.height <= 0) throw new Error(`frames.json has no picture "${name}" with its size. ${RECORD}`)
    for (const box of boxes[name] ?? []) {
      for (const kind of ['boxes', 'zooms']) {
        const rect = entry[kind]?.[box]
        // A zoom is cut to the frame's 9:16, in whole pixels.
        const shaped = (one) => kind === 'boxes' || Math.abs(one.width / one.height - ZOOM_ASPECT) < 0.01
        if (!isRect(rect) || !shaped(rect) || rect.x + rect.width > entry.width || rect.y + rect.height > entry.height) {
          throw new Error(`frames.json has no ${kind === 'boxes' ? 'box' : 'zoom'} "${box}" inside the picture "${name}". ${RECORD}`)
        }
      }
    }
  }
  return frames
}

/** The QR code of the closing card: dark violet on white with the four-module quiet zone of the standard, so that a phone reads it off a screen. */
export const REPOSITORY_QR = Object.freeze({ file: 'repo-qr.svg', text: REPOSITORY_URL })
export const REPOSITORY_QR_OPTIONS = Object.freeze({ type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#1e1b2e', light: '#ffffff' } })

/** The QR code of the closing card, as vector graphics, made from the repository's address at every render. */
export const repositoryQrSvg = () => QRCode.toString(REPOSITORY_QR.text, { ...REPOSITORY_QR_OPTIONS, color: { ...REPOSITORY_QR_OPTIONS.color } })

/** The demo QR code that the camera scene lays over the sign: the same code as the tutorial's (plain text, never a link). */
export const demoQrSvg = () => QRCode.toString(DEMO_QR.text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } })

/**
 * The sign of the camera scene, drawn here because the recorded picture of the printed sign needs the app and its database. It has no
 * words (a sign's words are the committee's own): a violet head with the pin, a white place for the QR code (`qr`, in the sign's own
 * units, which `CameraScene` covers with the demo code) and two lines of small print as bars.
 */
export const SIGN = Object.freeze({ file: 'sign.svg', width: 600, height: 840, qr: Object.freeze({ x: 100, y: 250, w: 400, h: 400 }) })

export function signSvg() {
  const { width, height, qr } = SIGN
  const pin = '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="36" fill="#ffffff"/>`,
    `<path d="M0 36a36 36 0 0 1 36-36h528a36 36 0 0 1 36 36v134H0Z" fill="${COLORS.mark}"/>`,
    `<circle cx="300" cy="85" r="52" fill="#ffffff"/>`,
    `<g transform="translate(264 49) scale(3)" fill="none" stroke="${COLORS.mark}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pin}</g>`,
    `<rect x="${qr.x}" y="${qr.y}" width="${qr.w}" height="${qr.h}" fill="#ffffff"/>`,
    `<rect x="150" y="700" width="300" height="20" rx="10" fill="#d9d4ff"/>`,
    `<rect x="195" y="744" width="210" height="20" rx="10" fill="#d9d4ff"/>`,
    '</svg>',
  ].join('')
}
