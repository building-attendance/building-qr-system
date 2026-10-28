// The zoom (decisions D3 and E2): the camera pushes in from the whole device toward an element of the picture over one beat, eased,
// starting on the frame of the plan, to MAX_PUSH times the device at rest at the most, the device centred across the frame so that both
// its side edges stay in view; a second move in the same scene goes from the first view to the next, up or down, and a move on the
// scene's first frame starts there already. Between the moves the camera never holds still: it drifts toward its element and grows by 2%
// on every bar line (moves.js, liveView). A scene that continues the one before it starts where that one's camera ended (`from`). The
// device (a phone, a computer) is drawn at rest inside it and scales with its picture. The arithmetic is moves.js (sceneView).
import { createContext, useContext } from 'react'
import { AbsoluteFill, Easing } from 'remotion'
import { useClock } from './clock.jsx'
import { PICTURE_AREA, cameraTransform, sceneView } from './moves.js'

/** How much larger than at rest the camera shows its device now (1 at rest): a ring reads it to keep its line as thick on screen. */
const CameraScale = createContext(1)
export const useCameraScale = () => useContext(CameraScale)

export const ZOOM_EASING = Easing.bezier(0.65, 0, 0.35, 1)

/**
 * @param {{
 *   scene: { startFrame: number, endFrame: number },
 *   moves: { frame: number, rect: import('./moves.js').Rect, box?: import('./moves.js').Rect | null }[],
 *   picture: { width: number, height: number },
 *   rest: import('./moves.js').Rest,
 *   outline: number,
 *   from?: import('./moves.js').View | null,
 *   children: import('react').ReactNode,
 *   area?: { top?: number, width: number, height: number },
 * }} props
 * `moves` are the scene's zooms in order: the frame of the video where each starts (the plan's), its rectangle (frames.json `zooms`) and
 * the element it is for (frames.json `boxes`), which the camera keeps in view. `picture` is the size of the picture on screen, `rest`
 * where that picture is drawn when the camera is at rest (phoneRest in moves.js), `outline` the device's width at rest in pixels of the
 * frame (its bezel and a laptop's base included), and `from` the view where a scene that continues the one before it starts. `area` is
 * the part of the frame that the camera frames (the picture area of moves.js when not given; the long cut gives the part above its
 * picture in picture).
 */
export function Zoom({ scene, moves, picture, rest, outline, from = null, children, area = PICTURE_AREA }) {
  const { global, tempo, settled } = useClock()
  const view = sceneView({ frame: global, scene, camera: { picture, moves }, rest, outline, area, from, tempo, ease: ZOOM_EASING, settled })
  const { scale, x, y } = cameraTransform(view, rest, area)
  return (
    <CameraScale.Provider value={scale}>
      <AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${scale})` }}>{children}</AbsoluteFill>
    </CameraScale.Provider>
  )
}
