// The closing card and its confetti (W6), moved from Promo.jsx without a change: the caption, the QR code of the repository on a white
// tile that springs in, and its address under it without `https://`. On the first beat of the last bar the tile pops while a burst of
// confetti (drawn shapes, a fixed seed, so every render is the same) flies out from behind it and is gone half a second before the end.
import { AbsoluteFill, Img, interpolate, spring, staticFile } from 'remotion'
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { isRtl } from '../../src/timing.js'
import { KEYWORD_COLOR, REPOSITORY_URL } from '../script/index.js'
import { REPOSITORY_QR } from '../stage.js'
import { FPS, PULSE, pulseAt } from '../timing.js'
import { closingCode, closingLayout, wideAddress } from '../wide.js'
import { Caption } from './caption.jsx'
import { Glow, clamp, useClock } from './clock.jsx'
import { useFormat } from './format.jsx'
import { WideBlock } from './wide.jsx'

/** The confetti: drawn shapes from a fixed seed (the same at every render), in violets with a few of white and of the keyword's gold. */
const CONFETTI_FRAMES = 44
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
      life: 30 + Math.floor(next() * (CONFETTI_FRAMES - 30)),
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
    <div style={{ position: 'absolute', left: '50%', top, width: 0, height: 0, zIndex: -1 }}>
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

/** The address without `https://`, in two lines for the long cut's large address: the owner's part (with its slash) and the repository. */
const addressLines = (large) => {
  const address = REPOSITORY_URL.replace(/^https:\/\//, '')
  const cut = address.lastIndexOf('/') + 1
  return large ? [address.slice(0, cut), address.slice(cut)] : [address]
}

/**
 * The closing card of the wide frame (format.js, WIDE): the code on the stage, springing in and popping with the confetti as in the
 * vertical card, the guide's label under it, and in the column the caption with the address large under it, still, to be read and typed
 * off the screen (wide.js, closingLayout and closingCode). `motion` is the vertical card's own springs, at this frame.
 */
function WideClosing({ scene, lang, keyword, guide, motion }) {
  const format = useFormat()
  const { closing, column, stage } = format
  const address = wideAddress(REPOSITORY_URL)
  const words = closingLayout(scene.phrases.map((phrase) => phrase.text).join(' '), address, format)
  const code = closingCode(format)
  return (
    <AbsoluteFill style={{ background: COLORS.card, isolation: 'isolate', fontFamily: FONT_FAMILY }}>
      <Glow amount={PULSE.ground * motion.pulse} />
      <WideBlock box={words.caption.box} width={column.right - column.left}>
        <Caption scene={scene} lang={lang} size={closing.caption} weight={700} color={COLORS.cardText} keyword={keyword} align="start" lineHeight={closing.lineHeight} />
      </WideBlock>
      <div
        style={{
          position: 'absolute',
          top: words.address.box.top,
          right: format.width - column.right,
          opacity: motion.shown,
          direction: 'ltr',
          unicodeBidi: 'isolate',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontWeight: 700,
          fontSize: closing.address,
          lineHeight: closing.lineHeight,
          color: COLORS.cardText,
        }}
      >
        {address.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: code.qr.left, top: code.qr.top, width: closing.qr, height: closing.qr, opacity: motion.shown }}>
        <Confetti since={motion.since} top={closing.qr / 2} />
        <Img src={staticFile(REPOSITORY_QR.file)} style={{ display: 'block', width: closing.qr, height: closing.qr, borderRadius: 32, background: '#ffffff', transform: `scale(${(0.4 + 0.6 * motion.landed) * (1 + 0.08 * motion.pop)})` }} />
      </div>
      {guide ? (
        <div style={{ position: 'absolute', left: stage.left, width: stage.width, top: code.guideTop, display: 'flex', justifyContent: 'center', opacity: motion.shown }}>
          <div style={{ padding: '8px 28px', borderRadius: 40, background: COLORS.cardTextSecondary, color: COLORS.card, fontWeight: 700, fontSize: closing.guide, lineHeight: 1.2, direction: isRtl(lang) ? 'rtl' : 'ltr' }}>{guide}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

/**
 * The closing card: the caption, the QR code of the repository on a white tile that springs in, and its address under it without `https://`.
 * The long cut gives `guide`, a label shown by the code (the guide is in English), and `large`, the address large on two lines, to be read
 * off the screen (a phone that plays the video cannot scan it).
 * @param {{ scene: object, lang: string, keyword?: string, burst: number, guide?: string | null, large?: boolean }} props
 */
export function ClosingScene({ scene, lang, keyword, burst, guide = null, large = false }) {
  const { frame, global, tempo } = useClock()
  const pulse = pulseAt(global, tempo)
  const at = scene.phrases[0].frame - scene.startFrame + 15
  const landed = spring({ frame: Math.max(0, frame - at), fps: FPS, config: { damping: 9, stiffness: 150, mass: 0.8 } })
  const shown = interpolate(frame, [at, at + 4], [0, 1], clamp)
  // On the first beat of the last bar the tile pops (it jumps up in size, then rings back) as the confetti bursts.
  const since = global - burst
  const pop = since >= 0 ? 1 - spring({ frame: since, fps: FPS, config: { damping: 6, stiffness: 240, mass: 0.6 } }) : 0
  const format = useFormat()
  if (format.column) return <WideClosing scene={scene} lang={lang} keyword={keyword} guide={guide} motion={{ pulse, landed, shown, since, pop }} />
  return (
    <AbsoluteFill style={{ background: COLORS.card, alignItems: 'center', justifyContent: 'center', padding: '0 80px', gap: 72, isolation: 'isolate' }}>
      <Glow amount={PULSE.ground * pulse} />
      <Caption scene={scene} lang={lang} size={96} weight={700} color={COLORS.cardText} keyword={keyword} />
      <div style={{ position: 'relative', opacity: shown, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Confetti since={since} top={QR_SIZE / 2} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 48, transformOrigin: `50% ${QR_SIZE / 2}px`, transform: `scale(${(0.4 + 0.6 * landed) * (1 + 0.08 * pop)})` }}>
          <Img src={staticFile(REPOSITORY_QR.file)} style={{ width: QR_SIZE, height: QR_SIZE, borderRadius: 32, background: '#ffffff' }} />
          {guide ? (
            <div style={{ marginTop: -16, padding: '8px 28px', borderRadius: 40, background: COLORS.cardTextSecondary, color: COLORS.card, fontFamily: FONT_FAMILY, fontWeight: 700, fontSize: 40, direction: isRtl(lang) ? 'rtl' : 'ltr' }}>
              {guide}
            </div>
          ) : null}
          <div
            style={{
              direction: 'ltr',
              unicodeBidi: 'isolate',
              textAlign: 'center',
              overflowWrap: 'anywhere',
              fontFamily: FONT_FAMILY,
              fontWeight: large ? 700 : 500,
              fontSize: large ? 50 : 34,
              lineHeight: large ? 1.25 : undefined,
              // Each of the two large lines stays whole, wider than the code above it if it must.
              whiteSpace: large ? 'nowrap' : undefined,
              color: COLORS.cardText,
            }}
          >
            {large ? addressLines(true).map((line) => <div key={line}>{line}</div>) : addressLines(false)[0]}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
