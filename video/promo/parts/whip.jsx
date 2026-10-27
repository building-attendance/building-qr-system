// The whip (W4), moved from Promo.jsx without a change: 8 frames at every scene boundary, ending on the bar line, the old scene sliding
// out and the new one in, side by side, blurred at its fastest. Each scene's layer also gives its parts their clock (clock.jsx).
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion'
import { isRtl } from '../../src/timing.js'
import { WHIP_FRAMES, WIDTH } from '../timing.js'
import { Clock } from './clock.jsx'

/** The whip blurs its scenes by this much at its fastest. */
const WHIP_BLUR_PX = 14
const WHIP_EASING = Easing.bezier(0.7, 0, 0.25, 1)

/**
 * A scene on its layer of the whip: it slides in over the first WHIP_FRAMES of its sequence (which starts that many frames before the bar
 * line) and, when another scene follows, out over its last WHIP_FRAMES; the strip moves towards the side a right-to-left page turns to.
 * `firstFrameWhole` (frame 0, see clock.jsx): on frame 0 of the video the scene is drawn settled, its caption already whole.
 */
export function SceneLayer({ scene, lang, lead, hasNext, tempo, firstFrameWhole = false, children }) {
  const local = useCurrentFrame()
  const frame = local - lead
  const length = scene.endFrame - scene.startFrame
  const entering = lead > 0 ? Math.min(1, local / lead) : 1
  const leaving = hasNext ? Math.min(1, Math.max(0, (frame - (length - WHIP_FRAMES)) / WHIP_FRAMES)) : 0
  const side = isRtl(lang) ? 1 : -1 // the old scene leaves towards this side of the screen, the new one comes from the other
  const x = (leaving > 0 ? side * WHIP_EASING(leaving) : -side * (1 - WHIP_EASING(entering))) * WIDTH
  const moving = leaving > 0 ? leaving : entering
  const blur = moving > 0 && moving < 1 ? WHIP_BLUR_PX * Math.sin(Math.PI * moving) : 0
  const global = scene.startFrame + frame
  return (
    <Clock.Provider value={{ frame, global, tempo, settled: firstFrameWhole && global === 0 }}>
      <AbsoluteFill style={{ transform: `translateX(${x}px)`, filter: blur > 0.5 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
    </Clock.Provider>
  )
}
