// The composition of the promo video (1080x1920): per scene of the plan (timing.js), the text on the violet ground, a screenshot in a drawn
// phone with its caption in a solid bar under it, the camera scene (the tutorial's `CameraScene`, over a drawn sign), or the closing card
// with the repository's address and its QR code. The caption comes in word by word (each phrase on its beat, its words spread over that
// beat, with a short overshoot), and one keyword per caption is drawn in an accent colour. The text is always on a flat colour, never over
// a picture. The effects of decision D16 are all placed on the beats of the plan by timing.js:
// - W2: on every bar line the ground brightens a little and the phone grows by 2% for a beat; the first beat of the groove (scene 3) is a
//   bigger punch. A pulse falls over a beat and the bar lines are at least 1.2 s apart, so never three changes of brightness in a second.
// - W3: the phone enters tilted about 22 degrees to 0 in 3D over a beat, then pushes in slowly, from 1.0 to 1.06, through its scene.
// - W4: a whip of 8 frames at every scene boundary, ending on the bar line: the old scene slides out and the new one in, side by side.
// - W5: the sounds of make-sounds.mjs (a whoosh at each whip, an impact on the groove, a ding at the check-in screen), when `sounds` is on.
// - W6: the closing card's QR tile springs in and, on the first beat of the last bar, pops while a burst of confetti (drawn shapes, a fixed
//   seed, so every render is the same) flies out from behind it and is gone before the last second and a half, so the code is clean again.
// The change between the two pictures of a scene still cross-fades over a fifth of a second. The track is staged by render.mjs when it is
// given one (music.js): started at the frame it names, faded in at the start and out over the last second and a half. The effect sounds
// are quiet next to it and none plays in that last second and a half.
import { Fragment, createContext, useContext } from 'react'
import { AbsoluteFill, Easing, Html5Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion'
import { DRAWN } from '../script/drawn.js'
import { CameraScene } from '../src/Screens.jsx'
import { COLORS, FONT_FAMILY } from '../src/theme.js'
import { LAYOUT, isRtl } from '../src/timing.js'
import { volumeAt } from './fade.js'
import { KEYWORDS, KEYWORD_COLOR, REPOSITORY_URL } from './script/index.js'
import { REPOSITORY_QR, SIGN } from './stage.js'
import { DEFAULT_TEMPO, FPS, GROOVE_SCENE, HEIGHT, PULSE, WHIP_FRAMES, WIDTH, beatFrames, burstFrame, keywordRange, planPromo, pulseAt, punchAt, soundCues, wordFrames } from './timing.js'

export const PROMO = Object.freeze({ id: 'Promo', fps: FPS, width: WIDTH, height: HEIGHT })

const SCREEN = { width: LAYOUT.screenWidth, height: LAYOUT.screenHeight }
const PHONE = { scale: 1.5, top: 36, width: SCREEN.width + LAYOUT.bezel * 2, height: SCREEN.height + LAYOUT.bezel * 2 }
const BAR_HEIGHT = 400
/** A word rises this far while it lands, growing from this share of its size; the keyword lands with a bigger overshoot. */
const RISE_PX = 36
const WORD_FROM = 0.62
const WORD_SPRING = { damping: 11, stiffness: 240, mass: 0.7 }
const KEYWORD_SPRING = { damping: 7, stiffness: 240, mass: 0.7 }
/** The change between the two pictures of a scene cross-fades over this many frames. */
const CROSS_FADE_FRAMES = 6
/** The phone enters tilted by this many degrees (about 25 in the plan, 22 so the near edge stays in the frame), pushes in to this scale through its scene, and the camera of the 3D tilt is this far away. */
const TILT_DEGREES = 22
const PUSH_TO = 1.06
const PERSPECTIVE_PX = 3200
/** The whip blurs its scenes by this much at its fastest. */
const WHIP_BLUR_PX = 14

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const GROUND = `linear-gradient(165deg, ${COLORS.groundFrom} 0%, ${COLORS.groundTo} 100%)`
const WHIP_EASING = Easing.bezier(0.7, 0, 0.25, 1)

/** The clock of a scene: its own frame (negative while the whip brings it in), the frame of the video, and the tempo. */
const Clock = createContext({ frame: 0, global: 0, tempo: DEFAULT_TEMPO })
const useClock = () => useContext(Clock)

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

/** A white layer over the ground, for the pulse: `amount` is its opacity. It sits under the text. */
const Glow = ({ amount }) => <div style={{ position: 'absolute', inset: 0, background: '#ffffff', opacity: amount }} />

/** One word of a caption: invisible until its frame, then it lands with a spring (a short overshoot). */
function Word({ at, keyword, children }) {
  const { frame } = useClock()
  const landed = spring({ frame: Math.max(0, frame - at), fps: FPS, config: keyword ? KEYWORD_SPRING : WORD_SPRING })
  const opacity = interpolate(frame, [at, at + 3], [0, 1], clamp)
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
function Caption({ scene, lang, size, weight, color, keyword }) {
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

const captionSize = (scene, long, short) => (scene.phrases.map((phrase) => phrase.text).join(' ').length > 28 ? long : short)

function TextScene({ scene, lang, keyword }) {
  const { global, tempo } = useClock()
  const pulse = pulseAt(global, tempo)
  return (
    <AbsoluteFill style={{ background: GROUND, alignItems: 'center', justifyContent: 'center', padding: '0 96px' }}>
      <Glow amount={PULSE.text * pulse} />
      <div style={{ width: '100%', transform: `scale(${1 + 0.015 * pulse})` }}>
        <Caption scene={scene} lang={lang} size={captionSize(scene, 112, 136)} weight={700} color={COLORS.cardText} keyword={keyword} />
      </div>
    </AbsoluteFill>
  )
}

/** One screenshot, filling the phone's screen (390x844 pictures at twice the density, the same proportions as the screen). */
const Picture = ({ file }) => <Img src={staticFile(file)} style={{ position: 'absolute', inset: 0, width: SCREEN.width, height: SCREEN.height }} />

function PhoneScreen({ scene, strings }) {
  const { frame } = useClock()
  const thenAt = scene.thenFrame == null ? null : scene.thenFrame - scene.startFrame
  const second = thenAt == null ? 0 : interpolate(frame, [thenAt, thenAt + CROSS_FADE_FRAMES], [0, 1], clamp)
  const cameraFrames = thenAt ?? scene.endFrame - scene.startFrame // how long the camera is on the screen: until the change of picture, or the whole scene
  return (
    <>
      {second < 1 ? scene.picture === 'camera' ? <CameraScene beat={signBeat(cameraFrames)} frame={Math.max(0, frame)} strings={strings} /> : <Picture file={scene.picture} /> : null}
      {second > 0 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: second }}>
          <Picture file={scene.then} />
        </div>
      ) : null}
    </>
  )
}

function PhoneScene({ scene, lang, strings, keyword }) {
  const { frame, global, tempo } = useClock()
  const left = (WIDTH - PHONE.width * PHONE.scale) / 2
  const punching = scene.id === GROOVE_SCENE
  const pulse = pulseAt(global, tempo)
  const punch = punching ? punchAt(global, scene.startFrame, tempo) : 0
  // The tilt starts on the bar line, as the whip ends (until then the phone is tilted), and takes a beat; the spring overshoots a little past flat. Then the slow push-in.
  const landed = spring({ frame: Math.max(0, frame), fps: FPS, durationInFrames: beatFrames(tempo), config: { damping: 11, stiffness: 120, mass: 0.9 } })
  const push = interpolate(frame, [0, scene.endFrame - scene.startFrame], [1, PUSH_TO], clamp)
  const grow = push * (1 + PULSE.phone * pulse + PULSE.punchPhone * punch)
  return (
    <AbsoluteFill style={{ background: GROUND, perspective: PERSPECTIVE_PX, perspectiveOrigin: '50% 35%' }}>
      <Glow amount={Math.max(PULSE.ground * pulse, PULSE.punchGround * punch)} />
      <div
        style={{
          position: 'absolute',
          left,
          top: PHONE.top,
          width: PHONE.width * PHONE.scale,
          height: PHONE.height * PHONE.scale,
          transformOrigin: '50% 30%',
          transform: `rotateY(${TILT_DEGREES * (1 - landed)}deg) scale(${grow})`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
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
        <Caption scene={scene} lang={lang} size={captionSize(scene, 66, 84)} weight={500} color={COLORS.barText} keyword={keyword} />
      </div>
    </AbsoluteFill>
  )
}

/** The confetti: drawn shapes from a fixed seed (the same at every render), in violets with a few of white and of the keyword's gold. */
const CONFETTI_FRAMES = 52
const CONFETTI_COLORS = ['#a79bff', '#8b7dff', '#c7bfff', '#7c6cff', '#ffffff', '#d9d4ff', KEYWORD_COLOR]
const CONFETTI = (() => {
  let state = 20261026
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: 110 }, () => {
    const angle = next() * Math.PI * 2
    const speed = 28 + next() * 34
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      size: 18 + next() * 26,
      round: next() < 0.3,
      color: CONFETTI_COLORS[Math.floor(next() * CONFETTI_COLORS.length)],
      rotation: next() * 360,
      spin: (next() - 0.5) * 34,
      flip: 0.2 + next() * 0.4,
      life: 38 + Math.floor(next() * (CONFETTI_FRAMES - 38)),
    }
  })
})()

/** Where a piece is `since` frames after the burst: it flies out, slows down and falls. */
function place(piece, since) {
  let x = 0
  let y = 0
  let vx = piece.vx
  let vy = piece.vy
  for (let step = 0; step < since; step += 1) {
    x += vx
    y += vy
    vx *= 0.94
    vy = vy * 0.94 + 1.1
  }
  return { x, y }
}

/** The burst, from the centre of the QR tile (the box has no size, so the pieces are placed from its corner). */
function Confetti({ since, top }) {
  if (since < 0 || since >= CONFETTI_FRAMES) return null
  return (
    <div style={{ position: 'absolute', left: '50%', top, width: 0, height: 0 }}>
      {CONFETTI.map((piece, index) => {
        if (since >= piece.life) return null
        const { x, y } = place(piece, since)
        const fade = interpolate(since, [piece.life - 10, piece.life], [1, 0], clamp)
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: x - piece.size / 2,
              top: y - piece.size / 4,
              width: piece.size,
              height: piece.size / 2,
              borderRadius: piece.round ? piece.size / 2 : 4,
              background: piece.color,
              opacity: fade,
              transform: `rotate(${piece.rotation + piece.spin * since}deg) scaleY(${Math.cos(piece.flip * since)})`,
            }}
          />
        )
      })}
    </div>
  )
}

const QR_SIZE = 560

/** The closing card: the caption, the QR code of the repository on a white tile that springs in, and its address under it without `https://`. */
function ClosingScene({ scene, lang, keyword, burst }) {
  const { frame, global, tempo } = useClock()
  const pulse = pulseAt(global, tempo)
  const at = scene.phrases[0].frame - scene.startFrame + 15
  const landed = spring({ frame: Math.max(0, frame - at), fps: FPS, config: { damping: 9, stiffness: 150, mass: 0.8 } })
  const shown = interpolate(frame, [at, at + 4], [0, 1], clamp)
  // On the first beat of the last bar the tile pops (it jumps up in size, then rings back) as the confetti bursts.
  const since = global - burst
  const pop = since >= 0 ? 1 - spring({ frame: since, fps: FPS, config: { damping: 6, stiffness: 240, mass: 0.6 } }) : 0
  return (
    <AbsoluteFill style={{ background: COLORS.card, alignItems: 'center', justifyContent: 'center', padding: '0 80px', gap: 72 }}>
      <Glow amount={PULSE.ground * pulse} />
      <Caption scene={scene} lang={lang} size={96} weight={700} color={COLORS.cardText} keyword={keyword} />
      <div style={{ position: 'relative', opacity: shown, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Confetti since={since} top={QR_SIZE / 2} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 48, transform: `scale(${(0.4 + 0.6 * landed) * (1 + 0.08 * pop)})` }}>
          <Img src={staticFile(REPOSITORY_QR.file)} style={{ width: QR_SIZE, height: QR_SIZE, borderRadius: 32, background: '#ffffff' }} />
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
      </div>
    </AbsoluteFill>
  )
}

/**
 * A scene on its layer of the whip: it slides in over the first WHIP_FRAMES of its sequence (which starts that many frames before the bar
 * line) and, when another scene follows, out over its last WHIP_FRAMES; the strip moves towards the side a right-to-left page turns to.
 */
function SceneLayer({ scene, lang, lead, hasNext, tempo, children }) {
  const local = useCurrentFrame()
  const frame = local - lead
  const length = scene.endFrame - scene.startFrame
  const entering = lead > 0 ? Math.min(1, local / lead) : 1
  const leaving = hasNext ? Math.min(1, Math.max(0, (frame - (length - WHIP_FRAMES)) / WHIP_FRAMES)) : 0
  const side = isRtl(lang) ? 1 : -1 // the old scene leaves towards this side of the screen, the new one comes from the other
  const x = (leaving > 0 ? side * WHIP_EASING(leaving) : -side * (1 - WHIP_EASING(entering))) * WIDTH
  const moving = leaving > 0 ? leaving : entering
  const blur = moving > 0 && moving < 1 ? WHIP_BLUR_PX * Math.sin(Math.PI * moving) : 0
  return (
    <Clock.Provider value={{ frame, global: scene.startFrame + frame, tempo }}>
      <AbsoluteFill style={{ transform: `translateX(${x}px)`, filter: blur > 0.5 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
    </Clock.Provider>
  )
}

/**
 * @param {{ lang: string, bpm: number, firstBeat: number, music?: { file: string, startFrame: number } | null, sounds?: boolean }} props
 * `music` is the staged track and the frame of it where the music starts; without it there is no music. `sounds` plays the effect sounds
 * that render.mjs stages (make-sounds.mjs); off, the composition is silent apart from the track.
 */
export function Promo({ lang, bpm, firstBeat, music = null, sounds = false }) {
  const tempo = { bpm, firstBeat }
  const plan = planPromo(lang, tempo)
  const strings = DRAWN[lang] ?? DRAWN.en
  const keywords = KEYWORDS[lang] ?? {}
  const burst = burstFrame(plan, tempo)
  return (
    <AbsoluteFill style={{ background: COLORS.groundTo, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {music ? <Html5Audio src={staticFile(music.file)} trimBefore={music.startFrame} volume={(frame) => volumeAt(frame, plan)} /> : null}
      {sounds
        ? soundCues(plan).map((cue) => (
            <Sequence key={`${cue.kind}-${cue.frame}`} from={cue.frame} durationInFrames={cue.frames} name={cue.kind}>
              <Html5Audio src={staticFile(cue.file)} volume={cue.volume} />
            </Sequence>
          ))
        : null}
      {plan.scenes.map((scene, index) => {
        const lead = index > 0 ? WHIP_FRAMES : 0
        return (
          <Sequence key={scene.id} from={scene.startFrame - lead} durationInFrames={scene.endFrame - scene.startFrame + lead} name={scene.id}>
            <SceneLayer scene={scene} lang={lang} lead={lead} hasNext={index < plan.scenes.length - 1} tempo={tempo}>
              {scene.picture === 'text' ? (
                <TextScene scene={scene} lang={lang} keyword={keywords[scene.id]} />
              ) : scene.picture === 'closing' ? (
                <ClosingScene scene={scene} lang={lang} keyword={keywords[scene.id]} burst={burst} />
              ) : (
                <PhoneScene scene={scene} lang={lang} strings={strings} keyword={keywords[scene.id]} />
              )}
            </SceneLayer>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

export const promoDefaultProps = Object.freeze({ lang: 'he', bpm: DEFAULT_TEMPO.bpm, firstBeat: DEFAULT_TEMPO.firstBeat, music: null, sounds: false })
