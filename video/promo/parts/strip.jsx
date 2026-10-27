// The progress strip (decision D3, instead of chapter cards): a thin band at the top of the frame with the four labelled stages in order,
// right to left; the scene's stage is lit, the stages before it done, the ones after it dim, and the opening and the AI light none
// (stripStates in moves.js). Its ground is solid, and a zoom fills the frame below it (PICTURE_AREA in moves.js). The words come from the
// script's labels (he-long.js), never from here.
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { isRtl } from '../../src/timing.js'
import { KEYWORD_COLOR, STAGES, STRIP_STAGES } from '../script/index.js'
import { STRIP_HEIGHT, stripStates } from './moves.js'

const LOOK = Object.freeze({
  lit: { text: COLORS.barText, weight: 700, bar: KEYWORD_COLOR, barOpacity: 1, textOpacity: 1 },
  done: { text: COLORS.barText, weight: 500, bar: COLORS.barText, barOpacity: 0.7, textOpacity: 0.8 },
  dim: { text: COLORS.barText, weight: 400, bar: COLORS.barText, barOpacity: 0.22, textOpacity: 0.5 },
})

/**
 * @param {{ stage: string, labels: Record<string, string>, lang: string, strip?: readonly string[], stages?: readonly string[] }} props
 * `labels` are the words of the four stages (`labels.stages` of the script), keyed by stage.
 */
export function ProgressStrip({ stage, labels, lang, strip = STRIP_STAGES, stages = STAGES }) {
  const states = stripStates(stage, strip, stages)
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: STRIP_HEIGHT,
        boxSizing: 'border-box',
        padding: '16px 40px 0',
        display: 'flex',
        gap: 20,
        direction: isRtl(lang) ? 'rtl' : 'ltr',
        background: COLORS.barBackground, // solid, so that nothing under it reads as half a line
        fontFamily: FONT_FAMILY,
      }}
    >
      {strip.map((one, index) => {
        const look = LOOK[states[index]]
        return (
          <div key={one} style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 27, lineHeight: 1.2, fontWeight: look.weight, color: look.text, opacity: look.textOpacity, whiteSpace: 'nowrap' }}>{labels[one]}</div>
            <div style={{ alignSelf: 'stretch', height: 7, borderRadius: 4, background: look.bar, opacity: look.barOpacity }} />
          </div>
        )
      })}
    </div>
  )
}
