// The computer of the long cut (scene `filters`): a recorded screen of the committee's app on a computer (at twice its density) in a drawn
// laptop, its caption in the bar under it. Like the phone of a scene with zooms, the laptop stands flat and still in the middle of the
// picture area and the camera (zoom.jsx) is its movement; the ground pulses on every bar line (W2).
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { PULSE, WIDTH, pulseAt } from '../timing.js'
import { GROUND, Glow, useClock } from './clock.jsx'
import { PICTURE_AREA } from './moves.js'
import { CaptionBar } from './phone.jsx'
import { Zoom } from './zoom.jsx'

/** The laptop: its screen this wide in the frame at rest, its bezel, and the base under it. */
export const LAPTOP = Object.freeze({ screenWidth: 1000, bezel: 18, baseHeight: 34, baseOverhang: 40 })

/**
 * Where a picture of the computer sits in the frame when the laptop is at rest (its top left corner and the pixels of the frame per pixel
 * of the picture): the laptop in the middle of the picture area.
 * @param {{ width: number, height: number }} picture
 */
export function laptopRest(picture) {
  const height = (LAPTOP.screenWidth * picture.height) / picture.width
  const total = height + 2 * LAPTOP.bezel + LAPTOP.baseHeight
  return { x: (WIDTH - LAPTOP.screenWidth) / 2, y: PICTURE_AREA.top + (PICTURE_AREA.height - total) / 2 + LAPTOP.bezel, scale: LAPTOP.screenWidth / picture.width }
}

/**
 * @param {{ scene: object, lang: string, keyword?: string, file: string, camera: { picture: { width: number, height: number }, moves: object[] },
 *   overlay?: import('react').ReactNode, children?: import('react').ReactNode }} props
 * `overlay` is drawn over the screen in the picture's space scaled to the screen (the rings), `children` over the whole frame (the strip).
 */
export function LaptopScene({ scene, lang, keyword, file, camera, overlay, children }) {
  const { global, tempo, settled } = useClock()
  const pulse = settled ? 0 : pulseAt(global, tempo)
  const rest = laptopRest(camera.picture)
  const width = LAPTOP.screenWidth
  const height = rest.scale * camera.picture.height
  const { bezel, baseHeight, baseOverhang } = LAPTOP
  return (
    <AbsoluteFill style={{ background: GROUND }}>
      <Glow amount={PULSE.ground * pulse} />
      <Zoom moves={camera.moves} picture={camera.picture} rest={rest}>
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
