// The picture in picture (scene `visit` of the long cut): a second picture in a small drawn phone, about a third of the frame's width, in a
// corner of the picture area, that springs in on its frame and stays to the end of the scene. It is drawn over the whole frame, so the
// camera does not move it.
import { Img, interpolate, spring, staticFile } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { FPS } from '../timing.js'
import { clamp, useClock } from './clock.jsx'
import { BAR_HEIGHT, INSET, STRIP_HEIGHT, insetHeight } from './moves.js'

const { margin: MARGIN, bezel: BEZEL, width: INSET_WIDTH } = INSET

/**
 * @param {{ file: string, picture: { width: number, height: number }, frame: number, corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', width?: number }} props
 * `file` is the staged picture, `picture` its size (for its shape), `frame` the frame of the video where it comes in (the plan's), and
 * `width` its width in the frame with the bezel. Bottom means just above the caption bar, top just under the progress strip.
 */
export function Inset({ file, picture, frame, corner = 'bottom-left', width = INSET_WIDTH }) {
  const { frame: local, global } = useClock()
  // An inset on the scene's first beat is there, landed, from the first frame of its sequence (the whip brings it in with its scene).
  const since = frame <= global - local ? Infinity : global - frame
  if (since < 0) return null
  const landed = since === Infinity ? 1 : spring({ frame: since, fps: FPS, config: { damping: 12, stiffness: 170, mass: 0.8 } })
  const shown = since === Infinity ? 1 : interpolate(since, [0, 4], [0, 1], clamp)
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
