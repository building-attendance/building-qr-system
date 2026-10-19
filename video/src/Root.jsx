// The Remotion root: one composition, "Provider", whose length comes from its inputs (the beats of scenes.json and, when the narrator has
// written it, timings.json), and the Rubik of the app (@fontsource-variable/rubik, the same files as src/main.jsx), which the frames wait for.
import '@fontsource-variable/rubik'
import { Composition, cancelRender, continueRender, delayRender } from 'remotion'
import { ProviderVideo, VIDEO } from './Video.jsx'
import { planBeats } from './timing.js'

// Rubik has a file per script. The browser fetches a file only when a letter of its script is drawn, so one sample of each script of the
// four languages is asked for before the first frame (a frame that is taken before the font arrives would be drawn in another typeface).
const SAMPLES = ['Abc', 'אבג', 'Абв', 'ابت']
const handle = delayRender('Rubik, the font of the captions', { timeoutInMilliseconds: 60000 })
Promise.all(SAMPLES.flatMap((text) => [400, 500, 600, 700].map((weight) => globalThis.document.fonts.load(`${weight} 40px "Rubik Variable"`, text))))
  .then(() => globalThis.document.fonts.ready)
  .then(() => continueRender(handle))
  .catch((error) => cancelRender(error))

const defaultProps = { lang: 'he', scenes: { scenes: [] }, timings: null }

export function Root() {
  return (
    <Composition
      id={VIDEO.id}
      component={ProviderVideo}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={1}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, planBeats(props.scenes, props.timings).totalFrames) })}
    />
  )
}
