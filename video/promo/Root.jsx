// The Remotion root of the promo: one composition, "Promo", whose length comes from the plan (timing.js) at the tempo it is given, and the
// Rubik of the app, which the frames wait for. Copied from the tutorial's root (video/src/Root.jsx), which registers its own composition.
import '@fontsource-variable/rubik'
import { Composition, cancelRender, continueRender, delayRender } from 'remotion'
import { PROMO, Promo, promoDefaultProps } from './Promo.jsx'
import { planPromo } from './timing.js'

// Rubik has a file per script. The browser fetches a file only when a letter of its script is drawn, so one sample of each script it
// draws here (Latin for the address, Hebrew for the captions) is asked for before the first frame, in every weight that the promo uses.
const SAMPLES = ['Abc', 'אבג'] // the second is three Hebrew letters
const handle = delayRender('Rubik, the font of the captions', { timeoutInMilliseconds: 60000 })
Promise.all(SAMPLES.flatMap((text) => [400, 500, 700].map((weight) => globalThis.document.fonts.load(`${weight} 40px "Rubik Variable"`, text))))
  .then(() => globalThis.document.fonts.ready)
  .then(() => continueRender(handle))
  .catch((error) => cancelRender(error))

export function Root() {
  return (
    <Composition
      id={PROMO.id}
      component={Promo}
      width={PROMO.width}
      height={PROMO.height}
      fps={PROMO.fps}
      durationInFrames={1}
      defaultProps={promoDefaultProps}
      calculateMetadata={({ props }) => ({ durationInFrames: planPromo(props.lang, { bpm: props.bpm, firstBeat: props.firstBeat }).totalFrames })}
    />
  )
}
