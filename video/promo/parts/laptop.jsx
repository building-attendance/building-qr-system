// The computer of the long cut (scene `filters`): a recorded screen of the committee's app on a computer (at twice its density) in a drawn
// laptop, its caption in the bar under it. Like the phone of a scene with zooms, the laptop stands flat in the middle of the picture area
// and the camera (zoom.jsx) is its movement: the laptop is narrow enough that the camera can drift and pulse with both its sides in the
// frame, so it pushes in hardly at all (decision E2). What the scene shows of the screen is a magnifier (magnifier.jsx): each move of the
// scene lifts its box out of the screen, the rest of the screen dims, and the words of the filters and of the Excel button come out as
// large as on a phone. The ground pulses on every bar line (W2). `from`: where the camera starts in a scene that continues the one before it.
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { COLORS } from '../../src/theme.js'
import { LENSES } from '../script/long.js'
import { PULSE, pulseAt } from '../timing.js'
import { GROUND, Glow, useClock } from './clock.jsx'
import { Lenses, ScreenDim, lensesOf, useLift } from './magnifier.jsx'
import { Stage, stageFormat, useFormat } from './format.jsx'
import { laptopOutline, laptopRest, pushLimit } from './moves.js'
import { CaptionBar } from './phone.jsx'
import { Zoom } from './zoom.jsx'

/**
 * @param {{ scene: object, lang: string, keyword?: string, file: string, camera: { picture: { width: number, height: number }, moves: object[] },
 *   from?: import('./moves.js').View | null, area?: { top?: number, width: number, height: number }, overlay?: import('react').ReactNode, children?: import('react').ReactNode }} props
 * `overlay` is drawn over the screen in the picture's space scaled to the screen (the rings), `children` over the whole frame (the strip).
 */
export function LaptopScene({ scene, lang, keyword, file, camera, from = null, area: given = null, overlay, children }) {
  const { global, tempo, settled } = useClock()
  const format = stageFormat(useFormat()) // the laptop stands on the stage of a wide frame (format.jsx, Stage)
  const { laptop } = format
  const area = given ?? format.pictureArea
  const outline = laptopOutline(laptop)
  const pulse = settled ? 0 : pulseAt(global, tempo)
  const rest = laptopRest(camera.picture, format)
  const width = laptop.screenWidth
  const height = rest.scale * camera.picture.height
  const { bezel, baseHeight, baseOverhang } = laptop
  // The magnifier lifts what each move of the scene names; the scene's `LENSES` say what a move lifts when it is not its box. The lens
  // stays inside the area that the camera frames (the stage, on the wide frame), so it never covers the caption's column.
  const lenses = lensesOf(camera, rest, pushLimit(outline, area.width), LENSES[scene.id], area)
  const { progress, dim } = useLift(lenses)
  const picture = <Img src={staticFile(file)} style={{ position: 'absolute', inset: 0, width, height }} />
  return (
    <AbsoluteFill style={{ background: GROUND }}>
      <Glow amount={PULSE.ground * pulse} />
      <Stage>
        <Zoom scene={scene} moves={camera.moves} picture={camera.picture} rest={rest} outline={outline} from={from} area={area}>
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
              {picture}
              {overlay}
              <ScreenDim amount={dim} />
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
          <Lenses lenses={lenses} progress={progress} rest={rest} screen={{ width, height }}>
            {picture}
            {overlay}
          </Lenses>
        </Zoom>
        {children}
      </Stage>
      <CaptionBar scene={scene} lang={lang} keyword={keyword} />
    </AbsoluteFill>
  )
}
