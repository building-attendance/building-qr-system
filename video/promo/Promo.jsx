// The composition of the promo video (1080x1920): per scene of the plan (timing.js), the text on the violet ground, a screenshot in a drawn
// phone with its caption in a solid bar under it, the camera scene (the tutorial's `CameraScene`, over a drawn sign), or the closing card
// with the repository's address and its QR code. The caption comes in phrase by phrase, each phrase on its beat. Every cut is a hard cut
// on a beat, except the change between the two pictures of a scene, which cross-fades over a fifth of a second (less than one beat). The
// text is always on a flat colour, never over a picture. No sound: the music is T5.
import { Fragment } from 'react'
import { AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { DRAWN } from '../script/drawn.js'
import { CameraScene } from '../src/Screens.jsx'
import { COLORS, FONT_FAMILY } from '../src/theme.js'
import { LAYOUT, isRtl } from '../src/timing.js'
import { REPOSITORY_URL } from './script/index.js'
import { REPOSITORY_QR, SIGN } from './stage.js'
import { DEFAULT_TEMPO, FPS, HEIGHT, WIDTH, planPromo } from './timing.js'

export const PROMO = Object.freeze({ id: 'Promo', fps: FPS, width: WIDTH, height: HEIGHT })

const SCREEN = { width: LAYOUT.screenWidth, height: LAYOUT.screenHeight }
const PHONE = { scale: 1.5, top: 36, width: SCREEN.width + LAYOUT.bezel * 2, height: SCREEN.height + LAYOUT.bezel * 2 }
const BAR_HEIGHT = 400
/** A phrase rises this far while it fades in, over this many frames (nine frames: less than a beat at any tempo the plan accepts). */
const RISE_PX = 28
const RISE_FRAMES = 9
/** The change between the two pictures of a scene cross-fades over this many frames. */
const CROSS_FADE_FRAMES = 6

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const GROUND = `linear-gradient(165deg, ${COLORS.groundFrom} 0%, ${COLORS.groundTo} 100%)`

/** The sign of the camera scene as `CameraScene` takes a beat: a picture, its size, and the box of the code on it. */
const signBeat = (frames) => ({ image: SIGN.file, width: SIGN.width, height: SIGN.height, highlight: SIGN.qr, frames })

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

/** The caption of a scene: its phrases in logical order, each one invisible until its beat, then rising and fading in. The space is kept from the start, so nothing moves. */
function Caption({ scene, lang, size, weight, color }) {
  const frame = useCurrentFrame()
  return (
    <div style={{ direction: isRtl(lang) ? 'rtl' : 'ltr', textAlign: 'center', fontFamily: FONT_FAMILY, fontWeight: weight, fontSize: size, lineHeight: 1.3, color, textWrap: 'balance' }}>
      {scene.phrases.map((phrase, index) => {
        const at = phrase.frame - scene.startFrame
        const shown = interpolate(frame, [at, at + RISE_FRAMES], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
        return (
          <Fragment key={phrase.frame}>
            <span style={{ display: 'inline-block', maxWidth: '100%', opacity: shown, transform: `translateY(${(1 - shown) * RISE_PX}px)` }}>{isolateLatin(phrase.text)}</span>
            {index < scene.phrases.length - 1 ? ' ' : null}
          </Fragment>
        )
      })}
    </div>
  )
}

const captionSize = (scene, long, short) => (scene.phrases.map((phrase) => phrase.text).join(' ').length > 28 ? long : short)

function TextScene({ scene, lang }) {
  return (
    <AbsoluteFill style={{ background: GROUND, alignItems: 'center', justifyContent: 'center', padding: '0 96px' }}>
      <Caption scene={scene} lang={lang} size={captionSize(scene, 112, 136)} weight={700} color={COLORS.cardText} />
    </AbsoluteFill>
  )
}

/** One screenshot, filling the phone's screen (390x844 pictures at twice the density, the same proportions as the screen). */
const Picture = ({ file }) => <Img src={staticFile(file)} style={{ position: 'absolute', inset: 0, width: SCREEN.width, height: SCREEN.height }} />

function PhoneScreen({ scene, strings }) {
  const frame = useCurrentFrame()
  const thenAt = scene.thenFrame == null ? null : scene.thenFrame - scene.startFrame
  const second = thenAt == null ? 0 : interpolate(frame, [thenAt, thenAt + CROSS_FADE_FRAMES], [0, 1], clamp)
  return (
    <>
      {second < 1 ? scene.picture === 'camera' ? <CameraScene beat={signBeat(thenAt)} frame={frame} strings={strings} /> : <Picture file={scene.picture} /> : null}
      {second > 0 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: second }}>
          <Picture file={scene.then} />
        </div>
      ) : null}
    </>
  )
}

function PhoneScene({ scene, lang, strings }) {
  const left = (WIDTH - PHONE.width * PHONE.scale) / 2
  return (
    <AbsoluteFill style={{ background: GROUND }}>
      <div
        style={{
          position: 'absolute',
          left,
          top: PHONE.top,
          width: PHONE.width,
          height: PHONE.height,
          boxSizing: 'border-box',
          padding: LAYOUT.bezel,
          borderRadius: 60,
          background: COLORS.phone,
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.14)',
          transformOrigin: '0 0',
          transform: `scale(${PHONE.scale})`,
        }}
      >
        <div style={{ position: 'relative', width: SCREEN.width, height: SCREEN.height, borderRadius: 46, overflow: 'hidden', background: '#f7f5ff' }}>
          <PhoneScreen scene={scene} strings={strings} />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR_HEIGHT,
          boxSizing: 'border-box',
          background: COLORS.barBackground,
          borderTop: `6px solid ${COLORS.barAccent}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 64px',
        }}
      >
        <Caption scene={scene} lang={lang} size={captionSize(scene, 66, 84)} weight={500} color={COLORS.barText} />
      </div>
    </AbsoluteFill>
  )
}

/** The closing card: the caption, the QR code of the repository on a white tile, and its address under it without `https://`. */
function ClosingScene({ scene, lang }) {
  const frame = useCurrentFrame()
  const first = scene.phrases[0].frame - scene.startFrame
  const shown = interpolate(frame, [first + 15, first + 15 + RISE_FRAMES], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
  return (
    <AbsoluteFill style={{ background: COLORS.card, alignItems: 'center', justifyContent: 'center', padding: '0 80px', gap: 72 }}>
      <Caption scene={scene} lang={lang} size={96} weight={700} color={COLORS.cardText} />
      <div style={{ opacity: shown, transform: `translateY(${(1 - shown) * RISE_PX}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 48 }}>
        <Img src={staticFile(REPOSITORY_QR.file)} style={{ width: 560, height: 560, borderRadius: 32, background: '#ffffff' }} />
        <div
          style={{
            direction: 'ltr',
            unicodeBidi: 'isolate',
            textAlign: 'center',
            overflowWrap: 'anywhere',
            fontFamily: FONT_FAMILY,
            fontWeight: 500,
            fontSize: 34,
            color: COLORS.cardText,
          }}
        >
          {REPOSITORY_URL.replace(/^https:\/\//, '')}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/**
 * @param {{ lang: string, bpm: number, firstBeat: number }} props
 */
export function Promo({ lang, bpm, firstBeat }) {
  const plan = planPromo(lang, { bpm, firstBeat })
  const strings = DRAWN[lang] ?? DRAWN.en
  return (
    <AbsoluteFill style={{ background: COLORS.groundTo, fontFamily: FONT_FAMILY }}>
      {plan.scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.endFrame - scene.startFrame} name={scene.id}>
          {scene.picture === 'text' ? <TextScene scene={scene} lang={lang} /> : scene.picture === 'closing' ? <ClosingScene scene={scene} lang={lang} /> : <PhoneScene scene={scene} lang={lang} strings={strings} />}
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

export const promoDefaultProps = Object.freeze({ lang: 'he', bpm: DEFAULT_TEMPO.bpm, firstBeat: DEFAULT_TEMPO.firstBeat })
