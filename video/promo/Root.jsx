// The Remotion root of the promo: the composition "Promo", whose length comes from the plan (timing.js) at the tempo it is given, and the
// Rubik of the app, which the frames wait for. Copied from the tutorial's root (video/src/Root.jsx), which registers its own composition.
// It registers "PromoLong" (PromoLong.jsx), the long cut, whose length is the long script's plan, and "PromoParts" (parts/PromoParts.jsx), which shows the parts of the long cut for their stills (parts/stills.mjs) and
// which render.mjs never renders.
import '@fontsource-variable/rubik'
import { Composition, cancelRender, continueRender, delayRender } from 'remotion'
import { PROMO, Promo, promoDefaultProps } from './Promo.jsx'
import { PROMO_LONG, PromoLong, promoLongDefaultProps } from './PromoLong.jsx'
import { PROMO_PARTS, PromoParts, promoPartsDefaultProps, showcasePlan } from './parts/PromoParts.jsx'
import { LONG } from './script/index.js'
import { planPromo } from './timing.js'

// Rubik has a file per script. The browser fetches a file only when a letter of its script is drawn, so one sample of each script it
// draws (Latin for the address, then the scripts of the video's languages) is asked for before the first frame, in every weight that the
// promo uses. The samples are escapes: three Hebrew letters, three Cyrillic and three Arabic (a new language is a script file, not a change here).
const SAMPLES = ['Abc', 'אבג', 'Абв', 'ابت']
const handle = delayRender('Rubik, the font of the captions', { timeoutInMilliseconds: 60000 })
Promise.all(SAMPLES.flatMap((text) => [400, 500, 700].map((weight) => globalThis.document.fonts.load(`${weight} 40px "Rubik Variable"`, text))))
  .then(() => globalThis.document.fonts.ready)
  .then(() => continueRender(handle))
  .catch((error) => cancelRender(error))

export function Root() {
  return (
    <>
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
      <Composition
        id={PROMO_LONG.id}
        component={PromoLong}
        width={PROMO_LONG.width}
        height={PROMO_LONG.height}
        fps={PROMO_LONG.fps}
        durationInFrames={1}
        defaultProps={promoLongDefaultProps}
        calculateMetadata={({ props }) => ({ durationInFrames: planPromo(props.lang, { bpm: props.bpm, firstBeat: props.firstBeat }, LONG).totalFrames })}
      />
      <Composition
        id={PROMO_PARTS.id}
        component={PromoParts}
        width={PROMO_PARTS.width}
        height={PROMO_PARTS.height}
        fps={PROMO_PARTS.fps}
        durationInFrames={1}
        defaultProps={promoPartsDefaultProps}
        calculateMetadata={() => ({ durationInFrames: showcasePlan().totalFrames })}
      />
    </>
  )
}
