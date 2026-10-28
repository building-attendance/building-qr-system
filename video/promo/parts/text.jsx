// The text scene: the caption alone on the violet ground, which brightens and grows a little on every bar line (W2). Moved from Promo.jsx;
// on the settled frame 0 of the clock (clock.jsx, the long cut's title card) it is drawn at rest, without the pulse, as the phone is.
// On the wide frame (format.js, WIDE) the card's words stand across the middle of its safe area (wide.js, cardLayout), and the first scene
// of either cut is TitleCard: the phone on the stage at the camera's green check, and the question in the column beside it.
import { AbsoluteFill } from 'remotion'
import { CameraScene } from '../../src/Screens.jsx'
import { COLORS } from '../../src/theme.js'
import { FPS, PULSE, pulseAt } from '../timing.js'
import { cardLayout, titleLayout } from '../wide.js'
import { Caption, captionSize } from './caption.jsx'
import { GROUND, Glow, useClock } from './clock.jsx'
import { CheckMark } from './drawn.jsx'
import { useFormat } from './format.jsx'
import { PhoneScene, SCREEN, signBeat } from './phone.jsx'
import { WideBlock } from './wide.jsx'

const textOf = (scene) => scene.phrases.map((phrase) => phrase.text).join(' ')

export function TextScene({ scene, lang, keyword }) {
  const { global, tempo, settled } = useClock()
  const format = useFormat()
  const pulse = settled ? 0 : pulseAt(global, tempo)
  if (format.column) {
    const { size, box } = cardLayout(textOf(scene), format)
    return (
      <AbsoluteFill style={{ background: GROUND }}>
        <Glow amount={PULSE.text * pulse} />
        <WideBlock box={box} width={format.card.width} align="center">
          <div style={{ transform: `scale(${1 + 0.015 * pulse})` }}>
            <Caption scene={scene} lang={lang} size={size} weight={format.card.weight} color={COLORS.cardText} keyword={keyword} lineHeight={format.card.lineHeight} />
          </div>
        </WideBlock>
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ background: GROUND, alignItems: 'center', justifyContent: 'center', padding: '0 96px' }}>
      <Glow amount={PULSE.text * pulse} />
      <div style={{ width: '100%', transform: `scale(${1 + 0.015 * pulse})` }}>
        <Caption scene={scene} lang={lang} size={captionSize(scene, 112, 136)} weight={700} color={COLORS.cardText} keyword={keyword} />
      </div>
    </AbsoluteFill>
  )
}

/** The camera at the sign of the title card, this many frames in: close on the code, its link chip up, every bracket drawn. */
const TITLE_CAMERA_FRAMES = 60

/**
 * The wide frame's title card (frame 0, the thumbnail): the provider's phone on the stage, the camera on the sign with the green check of a
 * scan received (drawn.jsx, CheckMark), and the question in the column beside it, in the middle of the safe area. The phone has the
 * camera's life without a move (it drifts and pulses, moves.js), and stands at rest on the settled frame 0.
 * @param {{ scene: object, lang: string, keyword?: string, strings: object }} props
 */
export function TitleCard({ scene, lang, keyword, strings }) {
  const format = useFormat()
  const { title, column, stage } = format
  const { box } = titleLayout(textOf(scene), format)
  return (
    <PhoneScene
      scene={scene}
      lang={lang}
      keyword={keyword}
      place={stage.phone}
      camera={{ picture: SCREEN, moves: [] }}
      screen={
        <>
          <CameraScene beat={signBeat(TITLE_CAMERA_FRAMES)} frame={TITLE_CAMERA_FRAMES} strings={strings} />
          <CheckMark at={-10 * FPS} />
        </>
      }
      caption={
        <WideBlock box={box} width={column.right - column.left}>
          <Caption scene={scene} lang={lang} size={title.size} weight={title.weight} color={COLORS.cardText} keyword={keyword} align="start" lineHeight={title.lineHeight} />
        </WideBlock>
      }
    />
  )
}
