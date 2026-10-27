// The text scene: the caption alone on the violet ground, which brightens and grows a little on every bar line (W2). Moved from Promo.jsx
// without a change.
import { AbsoluteFill } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { PULSE, pulseAt } from '../timing.js'
import { Caption, captionSize } from './caption.jsx'
import { GROUND, Glow, useClock } from './clock.jsx'

export function TextScene({ scene, lang, keyword }) {
  const { global, tempo } = useClock()
  const pulse = pulseAt(global, tempo)
  return (
    <AbsoluteFill style={{ background: GROUND, alignItems: 'center', justifyContent: 'center', padding: '0 96px' }}>
      <Glow amount={PULSE.text * pulse} />
      <div style={{ width: '100%', transform: `scale(${1 + 0.015 * pulse})` }}>
        <Caption scene={scene} lang={lang} size={captionSize(scene, 112, 136)} weight={700} color={COLORS.cardText} keyword={keyword} />
      </div>
    </AbsoluteFill>
  )
}
