// The computer of the long cut (scene `filters`): a recorded screen of the committee's app on a computer (at twice its density) in a drawn
// laptop, its caption in the bar under it. Like the phone of a scene with zooms, the laptop stands flat and still in the middle of the
// picture area and the camera (zoom.jsx) is its movement: the laptop is narrow enough that the camera can drift and pulse with both its sides in
// the frame, so it pushes in hardly at all and shows the filters and the Excel button together (decision E2). The ground pulses on every
// bar line (W2). `from`: where the camera starts in a scene that continues the one before it.
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { PULSE, pulseAt } from '../timing.js'
import { GROUND, Glow, useClock } from './clock.jsx'
import { LAPTOP, LAPTOP_OUTLINE, PICTURE_AREA, laptopRest } from './moves.js'
import { CaptionBar } from './phone.jsx'
import { Zoom } from './zoom.jsx'

/**
 * @param {{ scene: object, lang: string, keyword?: string, file: string, camera: { picture: { width: number, height: number }, moves: object[] },
 *   from?: import('./moves.js').View | null, area?: { top?: number, width: number, height: number }, overlay?: import('react').ReactNode, children?: import('react').ReactNode }} props
 * `overlay` is drawn over the screen in the picture's space scaled to the screen (the rings), `children` over the whole frame (the strip).
 */
export function LaptopScene({ scene, lang, keyword, file, camera, from = null, area = PICTURE_AREA, overlay, children }) {
  const { global, tempo, settled } = useClock()
  const pulse = settled ? 0 : pulseAt(global, tempo)
  const rest = laptopRest(camera.picture)
  const width = LAPTOP.screenWidth
  const height = rest.scale * camera.picture.height
  const { bezel, baseHeight, baseOverhang } = LAPTOP
  return (
    <AbsoluteFill style={{ background: GROUND }}>
      <Glow amount={PULSE.ground * pulse} />
      <Zoom scene={scene} moves={camera.moves} picture={camera.picture} rest={rest} outline={LAPTOP_OUTLINE} from={from} area={area}>
        <div
          style={{
            position: 'absolute',
            left: rest.x - bezel,
            top: rest.y - bezel,
            width: width + 2 * bezel,
            height: height + 2 * bezel,
            boxSizing: 'border-box',
            padding: bezel,
            borderRadius: '28px 28px 6px 6px',
            background: COLORS.phone,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.14)',
          }}
        >
          <div style={{ position: 'relative', width, height, overflow: 'hidden', background: '#f7f5ff' }}>
            <Img src={staticFile(file)} style={{ position: 'absolute', inset: 0, width, height }} />
            {overlay}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: rest.x - bezel - baseOverhang,
            top: rest.y + height + bezel,
            width: width + 2 * (bezel + baseOverhang),
            height: baseHeight,
            borderRadius: '4px 4px 26px 26px',
            background: '#d9d4ff',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
          }}
        />
      </Zoom>
      {children}
      <CaptionBar scene={scene} lang={lang} keyword={keyword} />
    </AbsoluteFill>
  )
}
