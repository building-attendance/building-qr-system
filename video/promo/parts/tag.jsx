// The tag (decision D8): a small pill that a scene puts in a corner of its picture, over what is drawn and not recorded (the chat of the
// AI). Its words are the script's (`labels.illustration` of he-long.js), never written here.
import { FONT_FAMILY } from '../../src/theme.js'
import { isRtl } from '../../src/timing.js'

/**
 * @param {{ text: string, lang: string, corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right', size?: number, offset?: number }} props
 * `size` is the size of its words in the units of the layer it is drawn in (the phone's screen: half as big again in the frame), and
 * `offset` its distance from the two edges of its corner, in the same units (a little less than its size when not given).
 */
export function Tag({ text, lang, corner = 'top-left', size = 16, offset = size * 0.9 }) {
  const [vertical, side] = corner.split('-')
  return (
    <div
      style={{
        position: 'absolute',
        [vertical]: offset,
        [side]: offset,
        padding: `${size * 0.3}px ${size * 0.75}px`,
        borderRadius: size * 2,
        background: 'rgba(21, 18, 31, 0.82)',
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        direction: isRtl(lang) ? 'rtl' : 'ltr',
      }}
    >
      {text}
    </div>
  )
}
