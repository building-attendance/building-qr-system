// The clock that every scene part of the promo reads, and the pieces of the ground that both cuts share: the violet gradient and the
// white layer of the pulse (W2). Moved from Promo.jsx without a change, so that the long cut draws them the same way.
import { createContext, useContext } from 'react'
import { COLORS } from '../../src/theme.js'
import { DEFAULT_TEMPO } from '../timing.js'

/**
 * The clock of a scene: its own frame (negative while the whip brings it in), the frame of the video, the tempo, and `settled`, true only
 * on frame 0 of a composition that asks for its first frame whole (the thumbnail that a platform takes from frame 0). A scene that the next
 * one continues without a whip also has `captionShown`, the opacity of its caption, which falls to 0 where its whip would be (whip.jsx).
 */
export const Clock = createContext({ frame: 0, global: 0, tempo: DEFAULT_TEMPO, settled: false })
export const useClock = () => useContext(Clock)

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
export const GROUND = `linear-gradient(165deg, ${COLORS.groundFrom} 0%, ${COLORS.groundTo} 100%)`

/** A white layer over the ground, for the pulse: `amount` is its opacity. It sits under the text. */
export const Glow = ({ amount }) => <div style={{ position: 'absolute', inset: 0, background: '#ffffff', opacity: amount }} />
