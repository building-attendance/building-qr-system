// The phone scene: a screenshot in a drawn phone with its caption in a solid bar under it, or the camera scene (the tutorial's
// `CameraScene`, over a drawn sign). Moved from Promo.jsx without a change; what the long cut adds is optional and draws nothing when it
// is not given, so the short cut is the same tree as before:
// - `camera`: the zooms of the scene (zoom.jsx), with the size of the picture they are measured on. A scene with a camera does not tilt in,
//   push in, pulse or punch its phone (the ground still pulses): the camera is its movement (it pushes in, drifts and pulses on the bar
//   line), and it aims at a flat phone at rest. `from`: where the camera starts in a scene that continues the one before it.
// - `screen`: what the screen shows instead of the scene's picture (more pictures, a drawn chat).
// - `overlay`: what is drawn over the screen in its own space, so it follows the zoom (a ring, the tag).
// - `children`: what is drawn over the whole frame, above the phone and under the caption bar (the picture in picture).
// - `place`: where the phone stands at rest and how large (the format's `phone` when not given; the long cut stands it under its progress
//   strip), and `area`: the part of the frame that a zoom frames (zoom.jsx; the format's picture area when not given). The sizes of the
//   frame come from the composition's format (format.jsx).
// - `bezel`: the colour of the phone's bezel (the dark one when not given; the long cut gives the committee's phone a light one).
// - `punchFrame`: the frame of the bigger punch of the groove (the first frame of the short cut's scan scene when not given).
// The effects (D16): the phone enters tilted about 22 degrees to 0 in 3D over a beat (W3), then pushes in slowly from 1.0 to 1.04 (1.06
// would hide the bottom of the screen under the caption bar); on every bar line the ground brightens and the phone grows by 2% for a beat,
// and the first beat of the groove is a bigger punch (W2). The change between the two pictures of a scene cross-fades over a fifth of a second.
import { AbsoluteFill, Img, interpolate, spring, staticFile } from 'remotion'
import { CameraScene } from '../../src/Screens.jsx'
import { COLORS } from '../../src/theme.js'
import { LAYOUT } from '../../src/timing.js'
import { SIGN } from '../stage.js'
import { FPS, GROOVE_SCENE, PULSE, beatFrames, pulseAt, punchAt } from '../timing.js'
import { Caption, captionSize } from './caption.jsx'
import { GROUND, Glow, clamp, useClock } from './clock.jsx'
import { useFormat } from './format.jsx'
import { BEZELS, PHONE, SCREEN, phoneBox, phoneRest } from './moves.js'
import { Zoom } from './zoom.jsx'

export { PHONE, SCREEN }
/** The change between the two pictures of a scene cross-fades over this many frames. */
export const CROSS_FADE_FRAMES = 6
/** The phone enters tilted by this many degrees (about 25 in the plan, 22 so the near edge stays in the frame), pushes in to this scale through its scene, and the camera of the 3D tilt is this far away. */
const TILT_DEGREES = 22
const PUSH_TO = 1.04
const PERSPECTIVE_PX = 3200

/** The sign of the camera scene as `CameraScene` takes a beat: a picture, its size, and the box of the code on it. */
export const signBeat = (frames) => ({ image: SIGN.file, width: SIGN.width, height: SIGN.height, highlight: SIGN.qr, frames })

/** One screenshot, filling the phone's screen (pictures at a higher density with the same proportions as the screen). */
export const Picture = ({ file }) => <Img src={staticFile(file)} style={{ position: 'absolute', inset: 0, width: SCREEN.width, height: SCREEN.height }} />

function PhoneScreen({ scene, strings }) {
  const { frame } = useClock()
  const thenAt = scene.thenFrame == null ? null : scene.thenFrame - scene.startFrame
  const second = thenAt == null ? 0 : interpolate(frame, [thenAt, thenAt + CROSS_FADE_FRAMES], [0, 1], clamp)
  const cameraFrames = thenAt ?? scene.endFrame - scene.startFrame // how long the camera is on the screen: until the change of picture, or the whole scene
  return (
    <>
      {second < 1 ? scene.picture === 'camera' ? <CameraScene beat={signBeat(cameraFrames)} frame={Math.max(0, frame)} strings={strings} /> : <Picture file={scene.picture} /> : null}
      {second > 0 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: second }}>
          <Picture file={scene.then} />
        </div>
      ) : null}
    </>
  )
}

/** The solid bar under the picture, with the caption of the scene. */
export function CaptionBar({ scene, lang, keyword }) {
  // At a boundary without a whip (a scene that the next one continues) the caption fades out over the frames where its whip would be.
  const { captionShown = 1 } = useClock()
  const { bar } = useFormat()
  const caption = <Caption scene={scene} lang={lang} size={captionSize(scene, 66, 84)} weight={500} color={COLORS.barText} keyword={keyword} />
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: bar,
        boxSizing: 'border-box',
        background: COLORS.barBackground,
        borderTop: `6px solid ${COLORS.barAccent}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 64px',
      }}
    >
      {captionShown < 1 ? <div style={{ opacity: captionShown }}>{caption}</div> : caption}
    </div>
  )
}

/**
 * @param {{ scene: object, lang: string, strings?: object, keyword?: string, camera?: { picture: { width: number, height: number }, moves: object[] } | null,
 *   screen?: import('react').ReactNode, overlay?: import('react').ReactNode, children?: import('react').ReactNode,
 *   place?: { scale: number, top: number }, area?: { top: number, width: number, height: number }, punchFrame?: number | null,
 *   from?: import('./moves.js').View | null, bezel?: { color: string, ring: string, screen?: string } }} props
 * `bezel` is the colour of the bezel, of the thin ring around the phone and of a line around its screen (none when not given).
 */
export function PhoneScene({ scene, lang, strings, keyword, camera = null, from = null, screen, overlay, children, place = null, area = null, bezel = BEZELS.provider, punchFrame }) {
  const { frame, global, tempo, settled, captionShown = 1 } = useClock()
  // At a boundary without a whip, what belongs to this scene alone (its rings, its picture in picture) fades out with its caption.
  const fading = (layer) => (captionShown < 1 && layer ? <div style={{ position: 'absolute', inset: 0, opacity: captionShown }}>{layer}</div> : layer)
  const format = useFormat()
  const at = place ?? format.phone
  const box = phoneBox(at, format)
  const hitFrame = punchFrame === undefined ? (scene.id === GROOVE_SCENE ? scene.startFrame : null) : punchFrame
  const pulse = settled ? 0 : pulseAt(global, tempo)
  const punch = hitFrame == null ? 0 : punchAt(global, hitFrame, tempo)
  // The tilt starts on the bar line, as the whip ends (until then the phone is tilted), and takes a beat; the spring overshoots a little past flat. Then the slow push-in.
  // A scene with a camera holds the phone flat and still (the zoom aims at a flat phone at rest): the camera is its movement.
  const landed = settled || camera ? 1 : spring({ frame: Math.max(0, frame), fps: FPS, durationInFrames: beatFrames(tempo), config: { damping: 11, stiffness: 120, mass: 0.9 } })
  const push = camera ? 1 : interpolate(frame, [0, scene.endFrame - scene.startFrame], [1, PUSH_TO], clamp)
  // Two layers, so that the phone stays in the frame at its largest: the punch and the tilt hang from the top edge (the phone is 36 px from
  // the top of the frame, and the camera of the tilt is at the top too, so the near edge only moves down), and the push-in and the pulse
  // grow from 40% of its height, which keeps its bottom close to the caption bar.
  const hit = camera ? 1 : 1 + PULSE.punchPhone * punch
  const grow = camera ? 1 : push * (1 + PULSE.phone * pulse)
  const phone = (
    <div
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        transformOrigin: '50% 0',
        transform: `rotateY(${TILT_DEGREES * (1 - landed)}deg) scale(${hit})`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', transformOrigin: '50% 40%', transform: `scale(${grow})` }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: PHONE.width,
          height: PHONE.height,
          boxSizing: 'border-box',
          padding: LAYOUT.bezel,
          borderRadius: 60,
          background: bezel.color,
          boxShadow: `0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 2px ${bezel.ring}`,
          transformOrigin: '0 0',
          transform: `scale(${at.scale})`,
        }}
      >
        <div style={{ position: 'relative', width: SCREEN.width, height: SCREEN.height, borderRadius: 46, overflow: 'hidden', background: '#f7f5ff', ...(bezel.screen ? { boxShadow: `0 0 0 2px ${bezel.screen}` } : {}) }}>
          {screen ?? <PhoneScreen scene={scene} strings={strings} />}
          {fading(overlay)}
        </div>
      </div>
      </div>
    </div>
  )
  return (
    <AbsoluteFill style={{ background: GROUND, perspective: PERSPECTIVE_PX, perspectiveOrigin: '50% 0%' }}>
      <Glow amount={Math.max(PULSE.ground * pulse, PULSE.punchGround * punch)} />
      {camera ? (
        // The camera's layer has no perspective of its own, so the tilt gets its perspective from a layer inside it, as at rest.
        <Zoom scene={scene} moves={camera.moves} picture={camera.picture} rest={phoneRest(camera.picture, at, format)} outline={box.width} from={from} area={area ?? format.pictureArea}>
          <AbsoluteFill style={{ perspective: PERSPECTIVE_PX, perspectiveOrigin: '50% 0%' }}>{phone}</AbsoluteFill>
        </Zoom>
      ) : (
        phone
      )}
      {fading(children)}
      <CaptionBar scene={scene} lang={lang} keyword={keyword} />
    </AbsoluteFill>
  )
}
