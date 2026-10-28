// The words of the wide frame (format.js, WIDE), placed by the pure layout of ../wide.js: the caption of a scene in the column at the
// right, on the violet ground with no bar, its phrases still landing on their beats with the yellow keyword; and the name of the scene's
// stage above it, which takes the place of the vertical cut's progress strip. The column's sizes are the format's, so that no caption takes
// a fourth line and no word leaves the safe area (tests/video-promo-format.test.js).
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { isRtl } from '../../src/timing.js'
import { KEYWORD_COLOR, STRIP_STAGES } from '../script/index.js'
import { captionLayout } from '../wide.js'
import { Caption } from './caption.jsx'
import { useClock } from './clock.jsx'
import { useFormat } from './format.jsx'

/**
 * A block of words at a box of the wide frame, from its right edge (its start, in a right-to-left language) or centred.
 * @param {{ box: { left: number, right: number, top: number }, width: number, align?: string, children?: import('react').ReactNode }} props
 */
export function WideBlock({ box, width, align = 'start', children }) {
  const frame = useFormat().width
  const place = align === 'center' ? { left: (box.left + box.right - width) / 2 } : { right: frame - box.right }
  return <div style={{ position: 'absolute', top: box.top, width, ...place }}>{children}</div>
}

/** The caption of a scene in the column of the wide frame (CaptionBar draws it there in this format). */
export function CaptionColumn({ scene, lang, keyword }) {
  const { captionShown = 1 } = useClock()
  const format = useFormat()
  const { column } = format
  const text = scene.phrases.map((phrase) => phrase.text).join(' ')
  const { size, box } = captionLayout(text, format)
  return (
    <WideBlock box={{ ...box, right: column.right }} width={column.right - column.left}>
      <div style={{ opacity: captionShown }}>
        <Caption scene={scene} lang={lang} size={size} weight={column.weight} color={COLORS.cardText} keyword={keyword} align="start" lineHeight={column.lineHeight} />
      </div>
    </WideBlock>
  )
}

/**
 * The name of the stage of the scene on screen, above the caption, with the yellow bar of the strip's lit stage under it: nothing for a
 * stage that the strip does not name (the opening, the AI). `labels` are the words of the four stages, keyed by stage.
 * @param {{ stage: string, labels: Record<string, string>, lang: string }} props
 */
export function StageLabel({ stage, labels, lang }) {
  const { width, column, label } = useFormat()
  if (!STRIP_STAGES.includes(stage)) return null
  return (
    <div style={{ position: 'absolute', top: label.top, right: width - column.right, direction: isRtl(lang) ? 'rtl' : 'ltr', fontFamily: FONT_FAMILY, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ fontSize: label.size, lineHeight: label.lineHeight, fontWeight: 700, color: COLORS.barText, whiteSpace: 'nowrap' }}>{labels[stage]}</div>
      <div style={{ alignSelf: 'stretch', height: 7, borderRadius: 4, background: KEYWORD_COLOR }} />
    </div>
  )
}
