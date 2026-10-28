// The laptop's magnifier (topic "promo-web-flow", W2): on the computer, a move of the scene is not a push of the camera but a lens. The
// move's box (frames.json `boxes`: the filters, then the Excel button) lifts out of the laptop's screen to about 2 pixels of the video per
// CSS pixel of the recorded page (a picture pixel is half a CSS pixel), with a shadow, over one beat, and the rest of the screen dims by
// 30%. The laptop stays where it is, with both its sides in the frame (moves.js, pushLimit), and the lens is drawn in the laptop's own
// layer, so it drifts and pulses with the camera (zoom.jsx) like the rest. When one move follows another, the lens that is up lowers as the
// next one lifts, and the dim stays. The arithmetic is plain functions (no Remotion), so that tests/video-promo.test.js holds it.
import { Children, cloneElement, isValidElement } from 'react'
import { beatFrames } from '../timing.js'
import { useClock } from './clock.jsx'
import { PICTURE_AREA } from './moves.js'

/**
 * The lens: the picture pixels of margin around a box that the lens shows with it, the most it magnifies (rest units, which are pixels of
 * the video at the laptop's rest, per picture pixel: 1 is 2 pixels per CSS pixel of a page recorded at twice its density), the room it
 * keeps from the frame's side edges (the shadow's), how much the screen dims behind it, and the corner of the lens.
 */
export const LENS = Object.freeze({ pad: 28, maxScale: 1.5, margin: 16, dim: 0.3, radius: 18 })

/** A lift: slow, fast, slow. */
export const liftEase = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

const clamp01 = (value) => Math.min(1, Math.max(0, value))
const between = (value, least, most) => Math.max(least, Math.min(most, value))
const lerp = (a, b, t) => a + (b - a) * t

/**
 * What a move lifts, as a rectangle of the picture in its own pixels: `override` when the scene gives one (script/long.js, LENSES), or the
 * move's box with LENS.pad around it, inside the picture.
 * @param {import('./moves.js').Rect} box
 * @param {{ width: number, height: number }} picture
 * @param {import('./moves.js').Rect | null} [override]
 * @returns {import('./moves.js').Rect}
 */
export function lensRect(box, picture, override = null) {
  if (override) return { ...override }
  const left = Math.max(0, box.x - LENS.pad)
  const top = Math.max(0, box.y - LENS.pad)
  const right = Math.min(picture.width, box.x + box.width + LENS.pad)
  const bottom = Math.min(picture.height, box.y + box.height + LENS.pad)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Where a lens stands when it is up, in the units of the laptop's drawing: its size (`scale` per pixel of the picture, as large as
 * LENS.maxScale or the frame allows, with the camera at its largest, `limit`, which is moves.js pushLimit of the laptop), centred on the
 * place of its rectangle on the screen, then moved inside the frame (its side edges LENS.margin from it, however the camera drifts and
 * pulses) and inside the picture area.
 * @param {import('./moves.js').Rect} rect
 * @param {import('./moves.js').Rest} rest where the laptop's screen is at rest
 * @param {number} limit
 * @param {{ top?: number, width: number, height: number }} [area]
 */
export function liftedLens(rect, rest, limit, area = PICTURE_AREA) {
  const across = area.width // the frame's width, or the stage's on the wide frame: the camera centres the laptop across it
  const scale = Math.min(LENS.maxScale, (across - 2 * LENS.margin) / (rect.width * limit))
  const width = rect.width * scale
  const height = rect.height * scale
  const half = (across / 2 - LENS.margin) / limit // how far from the middle of the frame an edge may be, at the largest the camera is
  const x = between(rest.x + rest.scale * (rect.x + rect.width / 2) - width / 2, across / 2 - half, across / 2 + half - width)
  // The same upward and downward: the camera grows the layer about the middle of the picture area, so an edge may be this far from it.
  const middle = (area.top ?? 0) + area.height / 2
  const reach = (area.height / 2 - LENS.margin) / limit
  const y = between(rest.y + rest.scale * (rect.y + rect.height / 2) - height / 2, middle - reach, middle + reach - height)
  return { x, y, width, height, scale }
}

/**
 * How far up each lens is at `frame`, from 0 to 1: it lifts over `length` frames from the frame of its move, and lowers over the same
 * length from the frame of the next move, which lifts then.
 * @param {number} frame
 * @param {{ frame: number }[]} moves
 * @param {number} length
 * @returns {number[]}
 */
export function liftProgress(frame, moves, length) {
  return moves.map((move, n) => {
    const up = liftEase(clamp01((frame - move.frame) / length))
    const next = moves[n + 1]
    return next ? up * (1 - liftEase(clamp01((frame - next.frame) / length))) : up
  })
}

/** How much the screen is dimmed at those lifts: full while one lens is up, and still full while one lowers as the next one lifts. */
export const dimAt = (progress) => LENS.dim * Math.min(1, progress.reduce((sum, one) => sum + one, 0))

/**
 * A lens at its lift `progress`: from its rectangle where it sits on the screen at rest to where it stands when it is up.
 * @param {import('./moves.js').Rect} rect
 * @param {import('./moves.js').Rest} rest
 * @param {ReturnType<typeof liftedLens>} up
 * @param {number} progress
 */
export function lensAt(rect, rest, up, progress) {
  const from = { x: rest.x + rest.scale * rect.x, y: rest.y + rest.scale * rect.y, width: rest.scale * rect.width, height: rest.scale * rect.height }
  const width = lerp(from.width, up.width, progress)
  return { x: lerp(from.x, up.x, progress), y: lerp(from.y, up.y, progress), width, height: lerp(from.height, up.height, progress), scale: width / rect.width }
}

/**
 * What the camera of the laptop's scene gives the magnifier: the lens of each move (its rectangle, and where it stands when it is up) and
 * the laptop's `limit`.
 * @param {{ picture: { width: number, height: number }, moves: { frame: number, box?: import('./moves.js').Rect | null }[] }} camera
 * @param {import('./moves.js').Rest} rest
 * @param {number} limit
 * @param {(import('./moves.js').Rect | null)[]} [overrides] by the order of the moves
 * @param {{ top?: number, width: number, height: number }} [area] the area that the laptop's camera frames (the vertical frame's when not given)
 */
export function lensesOf(camera, rest, limit, overrides = [], area = PICTURE_AREA) {
  return camera.moves.map((move, n) => {
    const rect = lensRect(move.box ?? { x: 0, y: 0, ...camera.picture }, camera.picture, overrides[n] ?? null)
    return { frame: move.frame, rect, up: liftedLens(rect, rest, limit, area) }
  })
}

/** The lift of each lens and the dim of the screen at this frame of the video (the laptop's scene reads both). */
export function useLift(lenses) {
  const { global, tempo } = useClock()
  const progress = liftProgress(global, lenses, beatFrames(tempo))
  return { progress, dim: dimAt(progress) }
}

/** The dark layer that dims the screen behind the lens, inside the screen's own box. */
export const ScreenDim = ({ amount }) => (amount > 0 ? <div style={{ position: 'absolute', inset: 0, background: 'rgb(21, 18, 31)', opacity: amount }} /> : null)

/**
 * The lenses that are up (or lifting or lowering) in the laptop's layer, over the screen and the base. Each shows its rectangle of the
 * screen's own content (`children`: the picture and the rings, in the units of the screen at rest, `screen` wide and tall), scaled to the
 * lens and cut to it, with a shadow that grows with the lift. The line of a ring stays as thick on screen however far the lens magnifies
 * (its `line` is divided by the magnification); its gap to its box and its corners grow with the lens, like the box.
 * @param {{ lenses: ReturnType<typeof lensesOf>, progress: number[], rest: import('./moves.js').Rest, screen: { width: number, height: number }, children?: import('react').ReactNode }} props
 */
export function Lenses({ lenses, progress, rest, screen, children }) {
  return lenses.map((lens, n) => {
    const p = progress[n]
    if (p <= 0) return null
    const at = lensAt(lens.rect, rest, lens.up, p)
    const k = at.scale / rest.scale // the lens magnifies the screen's content this many times
    const content = Children.map(children, (child) =>
      isValidElement(child) && typeof child.props.line === 'number' ? cloneElement(child, { line: child.props.line / k }) : child,
    )
    return (
      <div
        key={n}
        style={{
          position: 'absolute',
          left: at.x,
          top: at.y,
          width: at.width,
          height: at.height,
          overflow: 'hidden',
          borderRadius: LENS.radius * p,
          background: '#f7f5ff',
          boxShadow: `0 ${28 * p}px ${64 * p}px rgba(10, 6, 30, ${0.5 * p}), 0 0 0 ${3 * p}px rgba(255, 255, 255, 0.9)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: screen.width,
            height: screen.height,
            transformOrigin: '0 0',
            transform: `translate(${-lens.rect.x * at.scale}px, ${-lens.rect.y * at.scale}px) scale(${k})`,
          }}
        >
          {content}
        </div>
      </div>
    )
  })
}
