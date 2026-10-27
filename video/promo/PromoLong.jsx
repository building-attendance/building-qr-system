// The composition of the long promo (1080x1920, 2:18 at 120 bpm): both sides of the app for a committee member who knows nothing about it
// (topic "promo-long", decisions D1 to D4 and D8). It plans the long script (script/long.js) with timing.js and draws each scene with the
// parts that the short cut shares (parts/), under the progress strip of the four stages, which comes in after the title card and then
// stays still over the rest of the track:
// - a recorded screen of either app in the drawn phone, standing under the strip, with its zooms, rings, later pictures and the picture
//   in picture (parts/screens.js reads them from the plan and from the recorder's frames.json, which render.mjs checks and passes);
// - the computer's history in a drawn laptop (parts/laptop.jsx), its zoom spanning the filters, then the Excel button;
// - the camera over the drawn sign, then the check mark landing on the groove (the impact sound is on that beat);
// - the printed sign over the whole picture area, the demo code over the sample point's code (parts/drawn.jsx);
// - the drawn chat of the committee's AI, made of the sample's own counts (stage.js, agentAnswer), then the home row that proves it;
// - the text scenes and the closing card of the short cut, the card with the address large and the label of the guide by its code.
// Frame 0 is the title card, the short cut's opening question alone on the violet ground, drawn settled with its caption whole (the poster
// and the thumbnail). The music and the effect sounds are staged by render.mjs, as for the short cut.
import { useMemo } from 'react'
import { AbsoluteFill, Html5Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { DRAWN } from '../script/drawn.js'
import { CameraScene } from '../src/Screens.jsx'
import { COLORS, FONT_FAMILY } from '../src/theme.js'
import { volumeAt } from './fade.js'
import { useClock, clamp } from './parts/clock.jsx'
import { ClosingScene } from './parts/closing.jsx'
import { AgentChat, CheckMark, PrintedSign } from './parts/drawn.jsx'
import { Inset, insetTop } from './parts/inset.jsx'
import { LAPTOP, LaptopScene } from './parts/laptop.jsx'
import { STRIP_HEIGHT, stripOpacity } from './parts/moves.js'
import { CROSS_FADE_FRAMES, PhoneScene, SCREEN, signBeat } from './parts/phone.jsx'
import { Ring } from './parts/ring.jsx'
import { cameraOf, inDevice, pictureEnd, pictureTimeline, ringsOf } from './parts/screens.js'
import { ProgressStrip } from './parts/strip.jsx'
import { TextScene } from './parts/text.jsx'
import { SceneTrack } from './parts/track.jsx'
import { LONG, LONG_LABELS } from './script/index.js'
import { agentAnswer } from './stage.js'
import { DEFAULT_TEMPO, FPS, HEIGHT, MIX_GAIN, WIDTH, burstFrame, planPromo, soundCues } from './timing.js'

export const PROMO_LONG = Object.freeze({ id: 'PromoLong', fps: FPS, width: WIDTH, height: HEIGHT })

/**
 * The phone at rest stands this far under the strip (the short cut's stands 48 px under where the strip would be), as large as the space
 * down to the caption bar allows: 973 units tall at this scale end 25 px above the bar.
 */
export const LONG_PHONE = Object.freeze({ scale: 1.43, top: STRIP_HEIGHT + 20 })
/** The words of the strip, large enough to read on a phone. */
const STRIP_SIZE = 34
/** The picture in picture leaves this much room above it for the zoomed picture. */
const INSET_GAP = 24

/**
 * The progress strip, over the whole track and outside the scenes' layers, so that it stays still through the whips: the stage of the
 * scene on screen. It is not on the title card, and fades in over the whip that ends it (moves.js, stripOpacity).
 */
function TrackStrip({ plan, lang }) {
  const frame = useCurrentFrame()
  const opacity = stripOpacity(plan, frame)
  if (opacity === 0) return null
  const scene = plan.scenes.find((one) => frame < one.endFrame) ?? plan.scenes[plan.scenes.length - 1]
  return (
    <div style={{ opacity }}>
      <ProgressStrip stage={scene.stage} labels={LONG_LABELS.stages} lang={lang} size={STRIP_SIZE} />
    </div>
  )
}

/** The recorded pictures of a scene in the device, each cross-fading in on its frame over the one before it. */
function DeviceScreens({ scene, width, height }) {
  const { global } = useClock()
  const shown = pictureTimeline(scene).filter((one) => inDevice(one.picture))
  // A picture that a later one covers whole is not drawn.
  const covered = (index) => index + 1 < shown.length && global >= shown[index + 1].frame + CROSS_FADE_FRAMES
  return shown.map((one, index) =>
    global < one.frame || covered(index) ? null : (
      <div key={`${one.picture}-${one.frame}`} style={{ position: 'absolute', inset: 0, opacity: index === 0 ? 1 : interpolate(global, [one.frame, one.frame + CROSS_FADE_FRAMES], [0, 1], clamp) }}>
        <Img src={staticFile(one.picture)} style={{ position: 'absolute', inset: 0, width, height }} />
      </div>
    ),
  )
}

/** The camera over the drawn sign, and the check mark from the change of picture (`camera-checked`) on. */
function CameraScreen({ scene, strings }) {
  const { frame } = useClock()
  const thenAt = scene.thenFrame - scene.startFrame
  return (
    <>
      <CameraScene beat={signBeat(thenAt)} frame={Math.max(0, frame)} strings={strings} />
      <CheckMark at={thenAt} />
    </>
  )
}

/** The rings of a scene, in the units of the screen they are drawn on (`scale` per pixel of the picture), each gone with its picture. */
const Rings = ({ scene, frames, scale, line }) =>
  ringsOf(scene, frames).map((ring) => <Ring key={ring.key} box={ring.box} frame={ring.frame} until={ring.until} scale={scale} line={line} />)

/** What a scene of the long plan draws, by its first picture. */
function LongScene({ scene, lang, frames, chat, keyword, burst, strings }) {
  if (scene.picture === 'text') return <TextScene scene={scene} lang={lang} keyword={keyword} />
  if (scene.picture === 'closing') return <ClosingScene scene={scene} lang={lang} keyword={keyword} burst={burst} guide={LONG_LABELS.guide} large />
  if (scene.picture === 'camera') {
    return <PhoneScene scene={scene} lang={lang} keyword={keyword} place={LONG_PHONE} screen={<CameraScreen scene={scene} strings={strings} />} punchFrame={scene.thenFrame} />
  }
  const camera = cameraOf(scene, frames)
  if (!camera) throw new Error(`Scene "${scene.id}" shows a recorded screen without a zoom: a whole screen is shown for a beat at most (decision D3).`)
  if (scene.picture === 'computer-history.png') {
    return (
      <LaptopScene
        scene={scene}
        lang={lang}
        keyword={keyword}
        file={scene.picture}
        camera={camera}
        overlay={<Rings scene={scene} frames={frames} scale={LAPTOP.screenWidth / camera.picture.width} line={7} />}
      />
    )
  }
  const timeline = pictureTimeline(scene)
  const sheet = timeline.find((one) => one.picture === 'committee-print-sign.png')
  const talk = timeline.find((one) => one.picture === 'agent')
  const inset = scene.inset ? frames.pictures[scene.inset.picture] : null
  // With a picture in picture, the camera frames its box in the part of the picture area above it, from the start of the scene, so that
  // it does not move when the inset lands.
  const area = inset ? { top: STRIP_HEIGHT, width: WIDTH, height: insetTop(inset) - INSET_GAP - STRIP_HEIGHT } : undefined
  return (
    <PhoneScene
      scene={scene}
      lang={lang}
      keyword={keyword}
      place={LONG_PHONE}
      area={area}
      camera={camera}
      screen={<DeviceScreens scene={scene} width={SCREEN.width} height={SCREEN.height} />}
      overlay={<Rings scene={scene} frames={frames} scale={SCREEN.width / camera.picture.width} />}
    >
      {inset ? <Inset file={scene.inset.picture} picture={inset} frame={scene.inset.frame} /> : null}
      {sheet ? <PrintedSign file={sheet.picture} entry={frames.pictures[sheet.picture]} from={sheet.frame} /> : null}
      {talk ? <AgentChat chat={chat} from={talk.frame} until={pictureEnd(scene, talk.frame)} lang={lang} label={LONG_LABELS.illustration} /> : null}
    </PhoneScene>
  )
}

/**
 * @param {{ lang: string, bpm: number, firstBeat: number, music?: { file: string, startFrame: number } | null, sounds?: boolean,
 *   frames: { pictures: Record<string, object>, agentSample?: object, missingDay?: string } | null }} props
 * `frames` is the recorder's frames.json, checked by render.mjs (stage.js, checkFrames); `music` and `sounds` as in Promo.jsx.
 */
export function PromoLong({ lang, bpm, firstBeat, music = null, sounds = false, frames }) {
  if (!frames) throw new Error('PromoLong needs the frames.json of the recorder as its `frames`: render it with node video/promo/render.mjs <language> --cut long.')
  // The plan and the chat depend on the props only: made once, not at every frame.
  const tempo = useMemo(() => ({ bpm, firstBeat }), [bpm, firstBeat])
  const plan = useMemo(() => planPromo(lang, tempo, LONG), [lang, tempo])
  const chat = useMemo(() => agentAnswer(frames), [frames]) // refuses a recording without the sample's counts
  const strings = DRAWN[lang] ?? DRAWN.en
  const keywords = LONG.keywords[lang] ?? {}
  const burst = burstFrame(plan, tempo)
  return (
    <AbsoluteFill style={{ background: COLORS.groundTo, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {music ? <Html5Audio src={staticFile(music.file)} trimBefore={music.startFrame} volume={(frame) => MIX_GAIN * volumeAt(frame, plan)} /> : null}
      {sounds
        ? soundCues(plan, LONG).map((cue) => (
            <Sequence key={`${cue.kind}-${cue.frame}`} from={cue.frame} durationInFrames={cue.frames} name={cue.kind}>
              <Html5Audio src={staticFile(cue.file)} volume={MIX_GAIN * cue.volume} />
            </Sequence>
          ))
        : null}
      <SceneTrack
        plan={plan}
        lang={lang}
        tempo={tempo}
        firstFrameWhole
        render={(scene) => <LongScene scene={scene} lang={lang} frames={frames} chat={chat} keyword={keywords[scene.id]} burst={burst} strings={strings} />}
      />
      <TrackStrip plan={plan} lang={lang} />
    </AbsoluteFill>
  )
}

export const promoLongDefaultProps = Object.freeze({ lang: 'he', bpm: DEFAULT_TEMPO.bpm, firstBeat: DEFAULT_TEMPO.firstBeat, music: null, sounds: false, frames: null })
