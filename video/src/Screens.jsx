// The pieces that are drawn over the recorded screens, in pixels of the phone's screen in the video (LAYOUT of timing.js): the tap mark,
// the outline of what a line points at, the two drawn scenes (the camera at the sign, the phone's question about the location) and the
// title cards of the opening and the end. Nothing here is a copy of a dialog of Android or of iOS.
import { Easing, Img, interpolate, staticFile } from 'remotion'
import { COLORS, FONT_FAMILY } from './theme.js'
import { DEMO_QR, LAYOUT, dotsAt, isRtl, scaleBox } from './timing.js'

const SCREEN = { width: LAYOUT.screenWidth, height: LAYOUT.screenHeight }

const MARK_FILL = 'rgba(91, 75, 219, 0.3)'

/** A tap that grows on a point (and, when `box` is given, an outline that opens around that box) and fades. */
export function TapMark({ point, box, frame, start, length }) {
  const p = (frame - start) / length
  if (p < 0 || p > 1) return null
  const grow = Easing.out(Easing.cubic)(p)
  const fade = interpolate(p, [0, 0.15, 0.55, 1], [0, 1, 1, 0])
  const size = 30 + 62 * grow
  return (
    <>
      {box ? (
        <div
          style={{
            position: 'absolute',
            left: box.x - 4 - 8 * grow,
            top: box.y - 4 - 8 * grow,
            width: box.w + 8 + 16 * grow,
            height: box.h + 8 + 16 * grow,
            borderRadius: 22,
            border: `3px solid ${COLORS.mark}`,
            boxShadow: `0 0 0 2px ${COLORS.markOnDark}`,
            opacity: fade,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: point.x - size / 2,
          top: point.y - size / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          background: MARK_FILL,
          border: `4px solid ${COLORS.mark}`,
          boxShadow: `0 0 0 3px ${COLORS.markOnDark}`,
          opacity: fade,
        }}
      />
    </>
  )
}

/** The outline of the element that the line points at (without a tap). */
export function HighlightBox({ box, frame, start }) {
  const appear = interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const pulse = 1 + 0.018 * Math.sin((frame - start) / 8)
  if (appear <= 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - 8,
        top: box.y - 8,
        width: box.w + 16,
        height: box.h + 16,
        borderRadius: 20,
        border: `4px solid ${COLORS.mark}`,
        boxShadow: `0 0 0 3px ${COLORS.markOnDark}, 0 0 24px rgba(91, 75, 219, 0.45)`,
        opacity: appear,
        transform: `scale(${pulse})`,
      }}
    />
  )
}

/** The password dots, typed one by one: the dots of the sign-in button's own picture (`source`), uncovered from the left. */
export function TypedDots({ typing, beat, source, frame }) {
  const count = dotsAt(typing, frame)
  if (!count || !source || !beat.tap) return null
  const fx = SCREEN.width / beat.width
  const fy = SCREEN.height / beat.height
  const field = scaleBox(beat.tap, beat, SCREEN)
  const left = typing.fromX * fx
  const right = (typing.firstX + typing.step * count) * fx
  return (
    <Img
      src={staticFile(source.image)}
      style={{
        position: 'absolute',
        inset: 0,
        width: SCREEN.width,
        height: SCREEN.height,
        clipPath: `inset(${field.y + typing.inset * fy}px ${SCREEN.width - right}px ${SCREEN.height - field.y - field.h + typing.inset * fy}px ${left}px)`,
      }}
    />
  )
}

const PinIcon = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const LinkIcon = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
)

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

/**
 * The first drawn scene: a phone's camera held at the printed sign. The picture is the sign as the committee prints it (the beat's own
 * picture), seen a little tilted and coming closer. A sharp demo QR code (DEMO_QR: plain text, so scanning the screen opens nothing)
 * covers the code of the picture (`highlight` of the beat). A viewfinder closes around it, and a link chip rises under it.
 */
export function CameraScene({ beat, frame, strings, chipTap }) {
  const { width: W, height: H } = SCREEN
  const qr = beat.highlight
  const qx = qr.x + qr.w / 2
  const qy = qr.y + qr.h / 2
  const closer = interpolate(frame, [0, beat.frames * 0.45], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
  const scale = ((W * 0.62) / qr.w) * (0.72 + 0.28 * closer)
  const cx = W / 2
  const cy = H * 0.4
  const left = cx - qx * scale + Math.sin(frame / 22) * 3
  const top = cy - qy * scale + Math.cos(frame / 27) * 3
  const tilt = -2.5 * (1 - closer) + Math.sin(frame / 35) * 0.4

  const pad = 18
  const bw = qr.w * scale + pad * 2
  const bh = qr.h * scale + pad * 2
  const bx = cx - bw / 2
  const by = cy - bh / 2
  const brackets = interpolate(frame, [8, 24], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
  const arm = 44
  const corner = (extra) => ({ position: 'absolute', width: arm, height: arm, borderColor: COLORS.mark, borderStyle: 'solid', borderWidth: 0, borderRadius: 10, ...extra })

  const chipStart = Math.round(beat.frames * 0.32)
  const chipIn = interpolate(frame, [chipStart, chipStart + 14], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
  const chipTop = Math.max(by + bh + 34, H * 0.69) // under the small print of the sign, which the chip would cover
  const chipHeight = 64

  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.camera, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: beat.width * scale,
          height: beat.height * scale,
          transform: `rotate(${tilt}deg)`,
          transformOrigin: `${qx * scale}px ${qy * scale}px`,
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
        }}
      >
        <Img src={staticFile(beat.image)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <Img src={staticFile(DEMO_QR.file)} style={{ position: 'absolute', left: qr.x * scale, top: qr.y * scale, width: qr.w * scale, height: qr.h * scale }} />
      </div>
      <div style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, opacity: brackets, transform: `scale(${1.12 - 0.12 * brackets})`, filter: 'drop-shadow(0 0 3px rgba(255, 255, 255, 0.9))' }}>
        <div style={corner({ left: 0, top: 0, borderLeftWidth: 5, borderTopWidth: 5 })} />
        <div style={corner({ right: 0, top: 0, borderRightWidth: 5, borderTopWidth: 5 })} />
        <div style={corner({ left: 0, bottom: 0, borderLeftWidth: 5, borderBottomWidth: 5 })} />
        <div style={corner({ right: 0, bottom: 0, borderRightWidth: 5, borderBottomWidth: 5 })} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: chipTop,
          height: chipHeight,
          display: 'flex',
          justifyContent: 'center',
          opacity: chipIn,
          transform: `translateY(${(1 - chipIn) * 22}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: chipHeight,
            padding: '0 26px',
            borderRadius: chipHeight / 2,
            background: COLORS.chipBackground,
            color: COLORS.chipText,
            fontFamily: FONT_FAMILY,
            fontWeight: 500,
            fontSize: 21,
            direction: 'ltr',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <LinkIcon size={26} color={COLORS.mark} />
          {strings.link}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: W / 2 - 44,
          bottom: 56,
          width: 88,
          height: 88,
          borderRadius: '50%',
          border: `6px solid ${COLORS.markOnDark}`,
          boxSizing: 'border-box',
          opacity: 0.85,
        }}
      />
      {chipTap ? (
        <TapMark
          point={{ x: W / 2, y: chipTop + chipHeight / 2 }}
          box={{ x: W / 2 - 190, y: chipTop, w: 380, h: chipHeight }}
          frame={frame}
          start={chipTap.start}
          length={chipTap.length}
        />
      ) : null}
    </div>
  )
}

/** The height of the phone's question (room for a title and a body of two lines each, as in Russian), and the place of its "allow" button in it (the buttons sit at the bottom of the sheet). */
const SHEET = { height: 400, bottom: 32, allowHeight: 60, denyHeight: 52, gap: 10 }

/** Where the "allow" button of the question is on the screen, for the tap mark. */
export const allowButtonBox = () => ({
  x: 24,
  y: SCREEN.height - SHEET.bottom - SHEET.denyHeight - SHEET.gap - SHEET.allowHeight,
  w: SCREEN.width - 48,
  h: SHEET.allowHeight,
})

/**
 * The second drawn scene: over the "checking location" screen, a neutral question from the phone, which "allow" answers (the tap).
 */
export function LocationQuestion({ frame, total, strings, lang, tapStart, tapLength }) {
  const rtl = isRtl(lang)
  const appear = Math.round(total * 0.12)
  const leave = tapStart + tapLength * 0.55
  const slideIn = interpolate(frame, [appear, appear + 14], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp })
  const slideOut = interpolate(frame, [leave, leave + 12], [0, 1], { easing: Easing.in(Easing.cubic), ...clamp })
  const shown = slideIn * (1 - slideOut)
  if (shown <= 0) return null
  const button = { display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, fontFamily: FONT_FAMILY }
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(30, 27, 46, 0.5)', opacity: shown }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: SHEET.height,
          boxSizing: 'border-box',
          padding: `0 24px ${SHEET.bottom}px`,
          borderRadius: '30px 30px 0 0',
          background: COLORS.sheetBackground,
          color: COLORS.sheetText,
          fontFamily: FONT_FAMILY,
          direction: rtl ? 'rtl' : 'ltr',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: 'stretch',
          textAlign: 'center',
          transform: `translateY(${(1 - shown) * SHEET.height}px)`,
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ alignSelf: 'center', width: 64, height: 64, borderRadius: '50%', background: COLORS.mark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PinIcon size={34} color={COLORS.markOnDark} />
        </div>
        <div style={{ marginTop: 14, fontSize: 27, fontWeight: 700, lineHeight: 1.25 }}>{strings.locationTitle}</div>
        <div style={{ marginTop: 6, marginBottom: 22, fontSize: 20, fontWeight: 400, lineHeight: 1.35, color: COLORS.sheetTextSecondary }}>{strings.locationBody}</div>
        <div style={{ ...button, height: SHEET.allowHeight, background: COLORS.sheetButton, color: COLORS.sheetButtonText, fontSize: 23, fontWeight: 600 }}>{strings.locationAllow}</div>
        <div style={{ ...button, height: SHEET.denyHeight, marginTop: SHEET.gap, color: COLORS.sheetButton, fontSize: 21, fontWeight: 500 }}>{strings.locationDeny}</div>
      </div>
    </>
  )
}

/** The title card over the home screen, at the opening and at the end (the credit of the voice, when it is a service's, under it). */
export function TitleCard({ kind, frame, strings, lang, credit }) {
  const appear = interpolate(frame, [0, 10], [0, 1], clamp)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(46, 38, 112, 0.96)',
        color: COLORS.cardText,
        fontFamily: FONT_FAMILY,
        direction: isRtl(lang) ? 'rtl' : 'ltr',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 36px',
        opacity: kind === 'intro' ? appear : 1,
      }}
    >
      <div style={{ width: 132, height: 132, borderRadius: '50%', background: COLORS.markOnDark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PinIcon size={72} color={COLORS.mark} />
      </div>
      <div style={{ marginTop: 34, fontSize: 46, fontWeight: 700, lineHeight: 1.2 }}>{kind === 'intro' ? strings.introTitle : strings.outroTitle}</div>
      <div style={{ marginTop: 14, fontSize: 26, fontWeight: 400, lineHeight: 1.35, color: COLORS.cardTextSecondary }}>
        {kind === 'intro' ? strings.introSubtitle : strings.outroSubtitle}
      </div>
      {kind === 'outro' && credit ? (
        <div style={{ position: 'absolute', bottom: 44, fontSize: 20, color: COLORS.cardTextSecondary, direction: 'ltr' }}>{credit}</div>
      ) : null}
    </div>
  )
}

