// `PromoParts`: a short composition that shows each part the long cut adds (the zoom, the ring, the picture in picture, the progress strip,
// frame 0 with its caption whole, and the tag) on the recorder's real pictures, for the stills of parts/stills.mjs. Its scenes are planned
// in showcase.js; the rectangles come from frames.json, which the stills script checks (stage.js, checkFrames) and passes as `frames`.
// The parts take everything as props; reading the plan and frames.json is this composition's job.
import { AbsoluteFill } from 'remotion'
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { LONG_LABELS } from '../script/index.js'
import { DEFAULT_TEMPO, FPS, HEIGHT, WIDTH } from '../timing.js'
import { useClock } from './clock.jsx'
import { Inset } from './inset.jsx'
import { PhoneScene, SCREEN } from './phone.jsx'
import { Ring } from './ring.jsx'
import { SHOWCASE, planShowcase, walkingStage } from './showcase.js'
import { ProgressStrip } from './strip.jsx'
import { Tag } from './tag.jsx'
import { TextScene } from './text.jsx'
import { SceneTrack } from './track.jsx'

export const PROMO_PARTS = Object.freeze({ id: 'PromoParts', fps: FPS, width: WIDTH, height: HEIGHT })
/** The tag sits this far into the screen, under the app's header (the strip covers the top of the phone in this showcase). */
const TAG_OFFSET = 84

export const promoPartsDefaultProps = Object.freeze({ lang: 'he', frames: null, firstFrameWhole: true })

/** The plan of the showcase, made once and only when this composition is drawn or measured (never by the short cut's render). */
let plan = null
export const showcasePlan = () => (plan ??= planShowcase(DEFAULT_TEMPO))

/** The strip of a scene: its own stage, or every stage in turn for the scene that walks through them. */
function Strip({ scene, source, lang }) {
  const { global, tempo } = useClock()
  return <ProgressStrip stage={source.stages ? walkingStage(scene, global, tempo) : scene.stage} labels={LONG_LABELS.stages} lang={lang} />
}

function ShowcaseScene({ scene, source, lang, frames }) {
  const keyword = SHOWCASE.keywords[lang][scene.id]
  if (scene.picture === 'text') {
    return (
      <>
        <TextScene scene={scene} lang={lang} keyword={keyword} />
        <Strip scene={scene} source={source} lang={lang} />
      </>
    )
  }
  const entry = frames.pictures[scene.picture]
  const picture = { width: entry.width, height: entry.height }
  const camera = scene.zoom ? { picture, moves: scene.zoom.map((move) => ({ frame: move.frame, rect: entry.zooms[move.box], box: entry.boxes[move.box] })) } : null
  const overlay = (
    <>
      {(scene.ring ?? []).map((ring) => (
        <Ring key={`${ring.box}-${ring.frame}`} box={entry.boxes[ring.box]} frame={ring.frame} scale={SCREEN.width / entry.width} />
      ))}
      {source.tag ? <Tag text={LONG_LABELS.illustration} lang={lang} offset={TAG_OFFSET} /> : null}
    </>
  )
  const inset = scene.inset ? frames.pictures[scene.inset.picture] : null
  return (
    <PhoneScene scene={scene} lang={lang} keyword={keyword} camera={camera} overlay={overlay}>
      {inset ? <Inset file={scene.inset.picture} picture={inset} frame={scene.inset.frame} /> : null}
      <Strip scene={scene} source={source} lang={lang} />
    </PhoneScene>
  )
}

/**
 * @param {{ lang: string, frames: { pictures: Record<string, { width: number, height: number, boxes: object, zooms: object }> } | null, firstFrameWhole?: boolean }} props
 * `frames` is the recorder's frames.json; `firstFrameWhole` draws frame 0 settled (decision "frame 0" of the long cut).
 */
export function PromoParts({ lang, frames, firstFrameWhole = true }) {
  if (!frames) throw new Error('PromoParts needs the frames.json of the recorder as its `frames`: run node video/promo/parts/stills.mjs.')
  return (
    <AbsoluteFill style={{ background: COLORS.groundTo, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      <SceneTrack
        plan={showcasePlan()}
        lang={lang}
        tempo={DEFAULT_TEMPO}
        firstFrameWhole={firstFrameWhole}
        render={(scene, index) => <ShowcaseScene scene={scene} source={SHOWCASE.scenes[index]} lang={lang} frames={frames} />}
      />
    </AbsoluteFill>
  )
}
