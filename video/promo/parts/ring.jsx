// The ring (decision D3): a rounded outline that draws itself around a box of the picture (frames.json `boxes`) over half a beat, in the
// keyword's colour, from its frame to the end of the scene. It is drawn in the picture's space (inside the screen), so it follows the zoom,
// and its line keeps the same thickness on screen at any zoom. The keyword's light gold sits on a dark line, so it reads on a white screen too.
import { Easing, interpolate } from 'remotion'
import { KEYWORD_COLOR } from '../script/index.js'
import { beatFrames } from '../timing.js'
import { clamp, useClock } from './clock.jsx'
import { useCameraScale } from './zoom.jsx'

const RING_EASING = Easing.out(Easing.cubic)

/**
 * @param {{ box: import('./moves.js').Rect, frame: number, scale: number, line?: number, color?: string }} props
 * `box` in the picture's own pixels, `frame` the frame of the video where it starts drawing (the plan's), `scale` the units of the layer it
 * is drawn in per pixel of the picture (the phone's screen: its width over the picture's), `line` its thickness in those units at rest.
 */
export function Ring({ box, frame, scale, line = 5, color = KEYWORD_COLOR }) {
  const { global, tempo, settled } = useClock()
  const zoom = useCameraScale()
  // On the settled frame 0 (clock.jsx) a ring that starts with the scene is already whole.
  const drawn = settled && global >= frame ? 1 : RING_EASING(interpolate(global, [frame, frame + beatFrames(tempo) / 2], [0, 1], clamp))
  if (drawn <= 0) return null
  const width = line / zoom
  const pad = 6 / zoom + width
  const w = box.width * scale + 2 * pad
  const h = box.height * scale + 2 * pad
  const radius = Math.min(16, h / 2, w / 2) // a small square box gets a circle
  const outline = { x: width, y: width, width: w, height: h, rx: radius, pathLength: 1, fill: 'none', strokeLinecap: 'round', strokeDasharray: `${drawn} 1` }
  return (
    <svg
      style={{ position: 'absolute', left: box.x * scale - pad - width, top: box.y * scale - pad - width, overflow: 'visible', pointerEvents: 'none' }}
      width={w + 2 * width}
      height={h + 2 * width}
    >
      <rect {...outline} stroke="rgba(21, 18, 31, 0.8)" strokeWidth={width * 2.2} />
      <rect {...outline} stroke={color} strokeWidth={width} />
    </svg>
  )
}
