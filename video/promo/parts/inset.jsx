// The picture in picture (scene `visit` of the long cut): a second picture in a small drawn phone, about a third of the frame's width, in a
// corner of the picture area, that springs in on its frame and stays to the end of the scene. It is drawn over the whole frame, so the
// camera does not move it.
import { Img, interpolate, spring, staticFile } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { FPS, HEIGHT, WIDTH } from '../timing.js'
import { clamp, useClock } from './clock.jsx'
import { BAR_HEIGHT, STRIP_HEIGHT } from './moves.js'

const MARGIN = 48
const BEZEL = 10
/** The inset is this wide in the frame, with its bezel, when its scene does not say. */
const INSET_WIDTH = Math.round(WIDTH / 3)

/** The height of an inset of `width` in the frame, with its bezel, for a picture of this shape. */
const insetHeight = (picture, width) => Math.round(((width - 2 * BEZEL) * picture.height) / picture.width) + 2 * BEZEL

/**
 * The top of an inset in a bottom corner, in pixels of the frame: the long cut frames its zoom above it, so that the picture in picture
 * never covers what the camera shows.
 * @param {{ width: number, height: number }} picture
 * @param {number} [width]
 */
export const insetTop = (picture, width = INSET_WIDTH) => HEIGHT - BAR_HEIGHT - MARGIN - insetHeight(picture, width)

/**
 * @param {{ file: string, picture: { width: number, height: number }, frame: number, corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', width?: number }} props
 * `file` is the staged picture, `picture` its size (for its shape), `frame` the frame of the video where it comes in (the plan's), and
 * `width` its width in the frame with the bezel. Bottom means just above the caption bar, top just under the progress strip.
 */
export function Inset({ file, picture, frame, corner = 'bottom-left', width = INSET_WIDTH }) {
  const { global } = useClock()
  if (global < frame) return null
  const landed = spring({ frame: global - frame, fps: FPS, config: { damping: 12, stiffness: 170, mass: 0.8 } })
  const shown = interpolate(global - frame, [0, 4], [0, 1], clamp)
  const height = insetHeight(picture, width)
  const [vertical, side] = corner.split('-')
  return (
    <div
      style={{
        position: 'absolute',
        [side]: MARGIN,
        [vertical]: (vertical === 'bottom' ? BAR_HEIGHT : STRIP_HEIGHT) + MARGIN,
        width,
        height,
        boxSizing: 'border-box',
        padding: BEZEL,
        borderRadius: 40,
        background: COLORS.phone,
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5), 0 0 0 3px rgba(255, 255, 255, 0.5)',
        opacity: shown,
        transformOrigin: `${vertical === 'bottom' ? 'bottom' : 'top'} ${side}`,
        transform: `scale(${0.5 + 0.5 * landed})`,
      }}
    >
      <Img src={staticFile(file)} style={{ display: 'block', width: '100%', height: '100%', borderRadius: 30 }} />
    </div>
  )
}
