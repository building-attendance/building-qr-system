// The closing card and its confetti (W6), moved from Promo.jsx without a change: the caption, the QR code of the repository on a white
// tile that springs in, and its address under it without `https://`. On the first beat of the last bar the tile pops while a burst of
// confetti (drawn shapes, a fixed seed, so every render is the same) flies out from behind it and is gone half a second before the end.
import { AbsoluteFill, Img, interpolate, spring, staticFile } from 'remotion'
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { KEYWORD_COLOR, REPOSITORY_URL } from '../script/index.js'
import { REPOSITORY_QR } from '../stage.js'
import { FPS, PULSE, pulseAt } from '../timing.js'
import { Caption } from './caption.jsx'
import { Glow, clamp, useClock } from './clock.jsx'

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

/** The closing card: the caption, the QR code of the repository on a white tile that springs in, and its address under it without `https://`. */
export function ClosingScene({ scene, lang, keyword, burst }) {
  const { frame, global, tempo } = useClock()
  const pulse = pulseAt(global, tempo)
  const at = scene.phrases[0].frame - scene.startFrame + 15
  const landed = spring({ frame: Math.max(0, frame - at), fps: FPS, config: { damping: 9, stiffness: 150, mass: 0.8 } })
  const shown = interpolate(frame, [at, at + 4], [0, 1], clamp)
  // On the first beat of the last bar the tile pops (it jumps up in size, then rings back) as the confetti bursts.
  const since = global - burst
  const pop = since >= 0 ? 1 - spring({ frame: since, fps: FPS, config: { damping: 6, stiffness: 240, mass: 0.6 } }) : 0
  return (
    <AbsoluteFill style={{ background: COLORS.card, alignItems: 'center', justifyContent: 'center', padding: '0 80px', gap: 72, isolation: 'isolate' }}>
      <Glow amount={PULSE.ground * pulse} />
      <Caption scene={scene} lang={lang} size={96} weight={700} color={COLORS.cardText} keyword={keyword} />
      <div style={{ position: 'relative', opacity: shown, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Confetti since={since} top={QR_SIZE / 2} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 48, transformOrigin: `50% ${QR_SIZE / 2}px`, transform: `scale(${(0.4 + 0.6 * landed) * (1 + 0.08 * pop)})` }}>
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
