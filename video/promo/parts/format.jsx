// The format of the frame that the parts draw in (../format.js): a composition draws everything inside its FormatFrame, which sets the
// format once, and the parts read their sizes from here (useFormat), never from a module constant. Without one it is VERTICAL.
// A format with a stage (WIDE) draws its devices and pictures inside Stage, which places the stage in the frame and gives what is inside
// it the stage's own format, so that the phone, the laptop, the camera and the drawn pictures centre on the stage as they do on the
// vertical frame; the vertical format has no stage, and Stage draws its children as they are.
import { createContext, useContext } from 'react'
import { AbsoluteFill } from 'remotion'
import { VERTICAL } from '../format.js'
import { GROUND } from './clock.jsx'

const FrameFormat = createContext(VERTICAL)
/** @returns {import('../format.js').Format} */
export const useFormat = () => useContext(FrameFormat)

/** The format that a scene's devices and pictures are drawn in: the stage of a format that has one, or the format itself. */
export const stageFormat = (format) => format.stage ?? format

/**
 * The whole frame of a composition, in `format`: what is drawn inside it reads that format.
 * @param {{ format: import('../format.js').Format, style?: object, children?: import('react').ReactNode }} props
 */
export const FormatFrame = ({ format, style, children }) => (
  <FrameFormat.Provider value={format}>
    <AbsoluteFill style={style}>{children}</AbsoluteFill>
  </FrameFormat.Provider>
)

/**
 * The stage of the format, at its place in the frame, as tall as the frame: what is inside reads the stage's format. Without a stage, the
 * children as they are (the vertical frame, whose tree does not change).
 * @param {{ style?: object, children?: import('react').ReactNode }} props
 */
export function Stage({ style, children }) {
  const format = useFormat()
  if (!format.stage) return children
  const { left, width, height } = format.stage
  return (
    <FrameFormat.Provider value={format.stage}>
      <div style={{ position: 'absolute', left, top: 0, width, height, ...style }}>{children}</div>
    </FrameFormat.Provider>
  )
}

/**
 * The violet ground for a layer that covers what is under it (the printed sign, the chat): on a stage, the frame's own gradient, placed
 * where the stage is in the frame, so that its edges do not show.
 */
export function useGround() {
  const format = useFormat()
  if (format.left === undefined) return { background: GROUND }
  return { backgroundImage: GROUND, backgroundSize: `${format.frameWidth}px ${format.height}px`, backgroundPosition: `${-format.left}px 0` }
}
