// The scenes of a plan, one after the other: each in its own sequence, which starts a whip before its bar line (the first scene has no
// whip in), on its layer of the whip (whip.jsx). Moved from Promo.jsx without a change, so that every composition of the promo lays out its
// scenes the same way; what each scene draws is the composition's (`render`). A scene that continues the one before it (`continues`, the
// long cut) has no whip: neither scene slides, and the caption of the one before fades out where its whip would be.
import { Sequence } from 'remotion'
import { WHIP_FRAMES } from '../timing.js'
import { SceneLayer } from './whip.jsx'

/**
 * @param {{ plan: { scenes: { id: string, startFrame: number, endFrame: number, continues?: boolean }[] }, lang: string, tempo: { bpm: number, firstBeat: number },
 *   firstFrameWhole?: boolean, render: (scene: any, index: number) => import('react').ReactNode }} props
 */
export function SceneTrack({ plan, lang, tempo, firstFrameWhole = false, render }) {
  return plan.scenes.map((scene, index) => {
    const lead = index > 0 && !scene.continues ? WHIP_FRAMES : 0
    const next = plan.scenes[index + 1]
    return (
      <Sequence key={scene.id} from={scene.startFrame - lead} durationInFrames={scene.endFrame - scene.startFrame + lead} name={scene.id}>
        <SceneLayer scene={scene} lang={lang} lead={lead} hasNext={Boolean(next) && !next.continues} captionOut={Boolean(next?.continues)} tempo={tempo} firstFrameWhole={firstFrameWhole}>
          {render(scene, index)}
        </SceneLayer>
      </Sequence>
    )
  })
}
