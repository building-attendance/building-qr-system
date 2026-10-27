// The caption of a scene and its words (W1), moved from Promo.jsx without a change: each phrase on its beat, its words spread over that
// beat with a short overshoot, the keyword in its accent colour, and a Latin word isolated inside a right-to-left caption. On the settled
// frame 0 of the clock (clock.jsx) every word is already in its place.
import { Fragment } from 'react'
import { interpolate, spring } from 'remotion'
import { FONT_FAMILY } from '../../src/theme.js'
import { isRtl } from '../../src/timing.js'
import { KEYWORD_COLOR } from '../script/index.js'
import { FPS, keywordRange, wordFrames } from '../timing.js'
import { clamp, useClock } from './clock.jsx'

/** A word rises this far while it lands, growing from this share of its size; the keyword lands with a bigger overshoot. */
const RISE_PX = 36
const WORD_FROM = 0.62
const WORD_SPRING = { damping: 11, stiffness: 240, mass: 0.7 }
const KEYWORD_SPRING = { damping: 7, stiffness: 240, mass: 0.7 }

/** A Latin word (QR, GitHub, an address) inside a right-to-left caption is isolated, so that its neighbours never reorder it. */
const LATIN_WORD = /([A-Za-z][A-Za-z0-9]*(?:[._/-][A-Za-z0-9]+)*)/
function isolateLatin(text) {
  return text.split(LATIN_WORD).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} style={{ unicodeBidi: 'isolate', direction: 'ltr' }}>
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/** One word of a caption: invisible until its frame, then it lands with a spring (a short overshoot). */
function Word({ at, keyword, children }) {
  const { frame, settled } = useClock()
  const landed = settled ? 1 : spring({ frame: Math.max(0, frame - at), fps: FPS, config: keyword ? KEYWORD_SPRING : WORD_SPRING })
  const opacity = settled ? 1 : interpolate(frame, [at, at + 3], [0, 1], clamp)
  return (
    <span
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        opacity,
        color: keyword ? KEYWORD_COLOR : undefined,
        transform: `translateY(${(1 - landed) * RISE_PX}px) scale(${WORD_FROM + (1 - WORD_FROM) * landed})`,
      }}
    >
      {isolateLatin(children)}
    </span>
  )
}

/** The caption of a scene: its words in logical order, each one on its frame (the space is kept from the start, so nothing moves). */
export function Caption({ scene, lang, size, weight, color, keyword }) {
  const { tempo } = useClock()
  const range = keywordRange(scene.phrases.map((phrase) => phrase.text).join(' '), keyword)
  let before = 0 // the words of the caption before this phrase
  return (
    <div style={{ direction: isRtl(lang) ? 'rtl' : 'ltr', textAlign: 'center', fontFamily: FONT_FAMILY, fontWeight: weight, fontSize: size, lineHeight: 1.3, color, textWrap: 'balance' }}>
      {scene.phrases.map((phrase, index) => {
        const words = phrase.text.split(/\s+/).filter(Boolean)
        const frames = wordFrames(phrase.frame, words.length, tempo)
        const first = before
        before += words.length
        return (
          <Fragment key={phrase.frame}>
            {words.map((word, n) => (
              <Fragment key={n}>
                <Word at={frames[n] - scene.startFrame} keyword={range !== null && first + n >= range.start && first + n < range.start + range.count}>
                  {word}
                </Word>
                {n < words.length - 1 ? ' ' : null}
              </Fragment>
            ))}
            {index < scene.phrases.length - 1 ? ' ' : null}
          </Fragment>
        )
      })}
    </div>
  )
}

export const captionSize = (scene, long, short) => (scene.phrases.map((phrase) => phrase.text).join(' ').length > 28 ? long : short)
