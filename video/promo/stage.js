// What the promo render stages beside the composition, as plain functions (no Remotion, no browser, no file system), so that the unit run
// of the repository can test them (tests/video-promo.test.js) and render.mjs and Promo.jsx read the same names: which pictures the scenes
// use, the check of the recorder's frames.json (the long cut's boxes and zooms), the drawn sign of the camera scene, and the two QR codes.
// Only `qrcode` is imported (a dependency of the root package and of video/), and shared/datetime.js, which writes the date of the
// AI's answer as the app does.
import QRCode from 'qrcode'
import { formatDay } from '../../shared/datetime.js'
import { COLORS } from '../src/theme.js'
import { DEMO_QR } from '../src/timing.js'
import { BOXES, DRAWN_PICTURES, PROMO_PICTURES, REPOSITORY_URL, SCENES, agentChat } from './script/index.js'

/**
 * The picture files that the scenes name (the first, the second, the later ones and the picture in picture), each once, in the order of
 * the scenes: of the recorder's folder (video/out/promo-frames/he/), for both cuts (the short one's scenes when none are given).
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

/**
 * The shape of a zoom rectangle as the recorder cuts it (scripts/promo/settings.mjs, FRAME_ASPECT): 9:16, the shape of the vertical frame
 * it was made for. It is a check of the recording, not a size of the frame, and no format (format.js) reads it: since decision E2 the
 * camera reads only a rectangle's vertical middle (parts/moves.js, pushView) and pushes the device in by its own limit, so the same
 * recording serves a frame of any shape.
 */
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

/** The visits a week of the agreement that the AI's question names (`agentChat.question`, its 5). */
export const AGREED_DAYS = 5

/**
 * The drawn chat of the long cut's AI scene (decision D8): the question as the script writes it, and the answer's template filled from
 * `agentSample` of frames.json, the agent API's own counts of the sample week. The provider is the one cleaning provider (the question
 * is about the cleaning), `days` the days of that week on which a visit of theirs was recorded (the API counts check-ins, two a day,
 * so the days are counted from `byDay`), fewer than AGREED_DAYS, and `missingDate` the recorder's `missingDay`, which must be a workday
 * (Sunday to Thursday) of the sample without one. Returns the question and the answer as parts, each place marked by its name so that
 * the composition can isolate it; refuses, naming `npm run promo:frames`, a frames.json without the sample or with a sample that does
 * not hold the story.
 * @param {{ agentSample?: { days: string[], byProvider: { provider_name: string, service_type: string }[], byDay: { day: string, provider_name: string, count: number }[] }, missingDay?: string }} frames
 * @param {{ question: string, answer: string }} [chat]
 */
export function agentAnswer(frames, chat = agentChat) {
  const sample = frames?.agentSample
  if (!sample || !Array.isArray(sample.days) || !Array.isArray(sample.byProvider) || !Array.isArray(sample.byDay)) {
    throw new Error(`frames.json has no agentSample (the agent API's counts of the sample week), which the AI scene's answer is made of. ${RECORD}`)
  }
  const cleaners = sample.byProvider.filter((row) => row.service_type === 'cleaning')
  if (cleaners.length !== 1) throw new Error(`The agentSample of frames.json has ${cleaners.length} cleaning providers, not one. ${RECORD}`)
  const provider = cleaners[0].provider_name
  const days = new Set(sample.byDay.filter((row) => row.provider_name === provider && row.count > 0 && sample.days.includes(row.day)).map((row) => row.day))
  // The question's agreement is five visits a week, Sunday to Thursday: the answer is true only for a week with fewer, and an empty workday.
  if (days.size >= AGREED_DAYS) throw new Error(`The agentSample of frames.json has the cleaning on ${days.size} days, not fewer than ${AGREED_DAYS}. ${RECORD}`)
  const missing = frames.missingDay
  const workday = typeof missing === 'string' && new Date(`${missing}T12:00:00Z`).getUTCDay() <= 4
  if (!sample.days.includes(missing) || days.has(missing) || !workday) throw new Error(`The missingDay of frames.json is not a workday of the sample without a visit. ${RECORD}`)
  const values = { provider, days: String(days.size), missingDate: formatDay(missing) }
  const parts = chat.answer
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part) => {
      const place = /^\{(\w+)\}$/.exec(part)?.[1]
      if (place && !Object.hasOwn(values, place)) throw new Error(`The answer of the AI chat has the place {${place}}, which the sample does not fill.`)
      return place ? { text: values[place], place } : { text: part }
    })
  return { question: chat.question, parts, answer: parts.map((part) => part.text).join('') }
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
