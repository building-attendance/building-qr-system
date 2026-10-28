// The format of the frame that the parts draw in (../format.js): a composition draws everything inside its FormatFrame, which sets the
// format once, and the parts read their sizes from here (useFormat), never from a module constant. Without one it is VERTICAL. The one
// part that does not yet is laptop.jsx, which still reads VERTICAL's laptop and picture area from moves.js (its rest, laptopRest, takes
// the format as a parameter for when it does).
import { createContext, useContext } from 'react'
import { AbsoluteFill } from 'remotion'
import { VERTICAL } from '../format.js'

const FrameFormat = createContext(VERTICAL)
/** @returns {import('../format.js').Format} */
export const useFormat = () => useContext(FrameFormat)

/**
 * The whole frame of a composition, in `format`: what is drawn inside it reads that format.
 * @param {{ format: import('../format.js').Format, style?: object, children?: import('react').ReactNode }} props
 */
export const FormatFrame = ({ format, style, children }) => (
  <FrameFormat.Provider value={format}>
    <AbsoluteFill style={style}>{children}</AbsoluteFill>
  </FrameFormat.Provider>
)
