// The Remotion root of the promo: the composition "Promo", whose length comes from the plan (timing.js) at the tempo it is given, and the
// Rubik of the app, which the frames wait for. Copied from the tutorial's root (video/src/Root.jsx), which registers its own composition.
// It registers "PromoLong" (PromoLong.jsx), the long cut, whose length is the long script's plan, and "PromoParts" (parts/PromoParts.jsx), which shows the parts of the long cut for their stills (parts/stills.mjs) and
// which render.mjs never renders. "PromoWide" and "PromoLongWide" are the two cuts on the wide frame (format.js, WIDE), for a web screen.
import '@fontsource-variable/rubik'
import { Composition, cancelRender, continueRender, delayRender } from 'remotion'
import { PROMO, PROMO_WIDE, Promo, PromoWide, promoDefaultProps } from './Promo.jsx'
import { PROMO_LONG, PROMO_LONG_WIDE, PromoLong, PromoLongWide, promoLongDefaultProps } from './PromoLong.jsx'
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
  // Each cut in each format (format.js): the vertical one, and the wide one for a web screen, from the same plan.
  const cuts = [
    [PROMO, Promo, promoDefaultProps, undefined],
    [PROMO_WIDE, PromoWide, promoDefaultProps, undefined],
    [PROMO_LONG, PromoLong, promoLongDefaultProps, LONG],
    [PROMO_LONG_WIDE, PromoLongWide, promoLongDefaultProps, LONG],
  ]
  return (
    <>
      {cuts.map(([cut, component, defaultProps, script]) => (
        <Composition
          key={cut.id}
          id={cut.id}
          component={component}
          width={cut.width}
          height={cut.height}
          fps={cut.fps}
          durationInFrames={1}
          defaultProps={defaultProps}
          calculateMetadata={({ props }) => ({ durationInFrames: planPromo(props.lang, { bpm: props.bpm, firstBeat: props.firstBeat }, script).totalFrames })}
        />
      ))}
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
