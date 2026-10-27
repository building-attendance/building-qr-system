// The zoom (decision D3): the camera moves from the whole screen to a rectangle of the picture over one beat, eased, starting on the
// frame of the plan, and holds there; a second move in the same scene goes from the first rectangle to the next, and a move on the
// scene's first frame starts there already. The device (a phone, a computer) is drawn at rest inside it and scales with its picture,
// so the rectangle fills the width of the picture area (between the progress strip and the caption bar) and the bezel leaves the frame.
// The arithmetic is moves.js.
import { createContext, useContext } from 'react'
import { AbsoluteFill, Easing } from 'remotion'
import { beatFrame, beatFrames } from '../timing.js'
import { useClock } from './clock.jsx'
import { cameraTransform, restView, viewAt, zoomView } from './moves.js'

/** How much larger than at rest the camera shows its device now (1 at rest): a ring reads it to keep its line as thick on screen. */
const CameraScale = createContext(1)
export const useCameraScale = () => useContext(CameraScale)

const ZOOM_EASING = Easing.bezier(0.65, 0, 0.35, 1)

/**
 * @param {{
 *   moves: { frame: number, rect: import('./moves.js').Rect, box?: import('./moves.js').Rect | null }[],
 *   picture: { width: number, height: number },
 *   rest: import('./moves.js').Rest,
 *   children: import('react').ReactNode,
 * }} props
 * `moves` are the scene's zooms in order: the frame of the video where each starts (the plan's), its rectangle (frames.json `zooms`) and
 * the element it is for (frames.json `boxes`), which the camera keeps in view. `picture` is the size of the picture on screen, `rest`
 * where that picture is drawn when the camera is at rest (phoneRest in phone.jsx).
 */
export function Zoom({ moves, picture, rest, children }) {
  const { frame, global, tempo } = useClock()
  // The scene's first beat: its first frame, or for the first scene of a track whose first beat is late, that beat (planPromo starts the
  // first scene at frame 0 and its beat 0 a little later), so a move on beat 0 starts there already in every scene.
  const start = Math.max(global - frame, beatFrame(0, tempo))
  const views = moves.map((move) => ({ frame: move.frame, view: zoomView(move.rect, move.box ?? null, picture) }))
  const view = viewAt(global, start, restView(rest), views, beatFrames(tempo), ZOOM_EASING)
  const { scale, x, y } = cameraTransform(view, rest)
  return (
    <CameraScale.Provider value={scale}>
      <AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${scale})` }}>{children}</AbsoluteFill>
    </CameraScale.Provider>
  )
}
