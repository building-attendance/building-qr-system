// The pieces that the long cut draws instead of a recorded screen:
// - CheckMark: the check of a scan received, over the camera scene (`camera-checked`), landing on the groove;
// - PrintedSign: the printed sign of a point (the recorder's picture of the sheet) over the whole picture area, with the demo code over
//   the sample point's code, as the camera scene does, so that nobody scans a sample code off a screen;
// - AgentChat: the drawn chat of the committee's AI (decision D8), neutral and without a brand: the question, then the answer on the next
//   beat but one, with the tag that says it is an illustration on sample data, above the words.
// Their words come from the script and the sample (stage.js, agentAnswer), never from here.
import { AbsoluteFill, Img, interpolate, spring, staticFile } from 'remotion'
import { COLORS, FONT_FAMILY } from '../../src/theme.js'
import { DEMO_QR, isRtl } from '../../src/timing.js'
import { FPS, WIDTH, beatFrames } from '../timing.js'
import { GROUND, clamp, useClock } from './clock.jsx'
import { BAR_HEIGHT, PICTURE_AREA, STRIP_HEIGHT } from './moves.js'
import { CROSS_FADE_FRAMES, SCREEN } from './phone.jsx'
import { Tag } from './tag.jsx'

/** The success colours of the app (--w-success and --w-success-bg of its light theme). */
const SUCCESS = '#0f7b4f'
const SUCCESS_BG = '#e3f5ec'
const LANDING = { damping: 11, stiffness: 190, mass: 0.7 }

/** The check mark over the camera, in the units of the phone's screen, from `at` frames into the scene. */
export function CheckMark({ at }) {
  const { frame } = useClock()
  if (frame < at) return null
  const landed = spring({ frame: frame - at, fps: FPS, config: { damping: 9, stiffness: 220, mass: 0.7 } })
  const veil = interpolate(frame, [at, at + CROSS_FADE_FRAMES], [0, 0.45], clamp)
  const size = 168
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: COLORS.camera, opacity: veil }} />
      <div
        style={{
          position: 'absolute',
          left: SCREEN.width / 2 - size / 2,
          top: SCREEN.height * 0.4 - size / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          background: SUCCESS,
          boxShadow: `0 0 0 16px ${SUCCESS_BG}, 0 12px 40px rgba(0, 0, 0, 0.5)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${landed})`,
        }}
      >
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
    </>
  )
}

/** The printed sign drawn this wide in the frame. */
const SHEET_WIDTH = 900

/**
 * @param {{ file: string, entry: { width: number, height: number, boxes: Record<string, { x: number, y: number, width: number, height: number }> }, from: number }} props
 * `entry` is the picture's entry of frames.json: its `sign` box is the sheet, its `qr` box the code that the demo code covers. `from` is
 * the frame of the video where it comes in.
 */
export function PrintedSign({ file, entry, from }) {
  const { global } = useClock()
  if (global < from) return null
  const { sign, qr } = entry.boxes
  const k = SHEET_WIDTH / sign.width
  const height = sign.height * k
  const shown = interpolate(global, [from, from + CROSS_FADE_FRAMES], [0, 1], clamp)
  const landed = spring({ frame: global - from, fps: FPS, config: LANDING })
  return (
    <AbsoluteFill style={{ background: GROUND, opacity: shown }}>
      <div
        style={{
          position: 'absolute',
          left: (WIDTH - SHEET_WIDTH) / 2,
          top: PICTURE_AREA.top + (PICTURE_AREA.height - height) / 2,
          width: SHEET_WIDTH,
          height,
          overflow: 'hidden',
          borderRadius: 14,
          background: '#ffffff',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
          transform: `scale(${0.92 + 0.08 * landed})`,
        }}
      >
        <Img src={staticFile(file)} style={{ position: 'absolute', left: -sign.x * k, top: -sign.y * k, width: entry.width * k, height: entry.height * k }} />
        <div style={{ position: 'absolute', left: qr.x * k, top: qr.y * k, width: qr.width * k, height: qr.height * k, background: '#ffffff' }}>
          <Img src={staticFile(DEMO_QR.file)} style={{ display: 'block', width: '100%', height: '100%' }} />
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** A bubble of the chat: it springs up from its side on its frame. */
function Bubble({ at, mine, children }) {
  const { global } = useClock()
  if (global < at) return null
  const landed = spring({ frame: global - at, fps: FPS, config: LANDING })
  return (
    <div
      style={{
        alignSelf: mine ? 'flex-start' : 'flex-end',
        maxWidth: '84%',
        padding: '30px 38px',
        borderRadius: 44,
        [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: 12,
        background: mine ? COLORS.sheetButton : COLORS.sheetBackground,
        color: mine ? COLORS.sheetButtonText : COLORS.sheetText,
        border: mine ? 'none' : '3px solid #d9d4ff',
        fontSize: 52,
        fontWeight: 500,
        lineHeight: 1.35,
        opacity: interpolate(global, [at, at + 3], [0, 1], clamp),
        transformOrigin: mine ? 'bottom right' : 'bottom left',
        transform: `translateY(${(1 - landed) * 40}px) scale(${0.85 + 0.15 * landed})`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * @param {{ chat: { question: string, parts: { text: string, place?: string }[] }, from: number, until: number, lang: string, label: string }} props
 * `chat` is the question and the answer (stage.js, agentAnswer), `from` and `until` the frames of the video between which it shows, and
 * `label` the words of the tag. The answer's places are bold and isolated (a name in parentheses, a date), so their order never changes.
 */
export function AgentChat({ chat, from, until, lang, label }) {
  const { global, tempo } = useClock()
  if (global < from || global >= until + CROSS_FADE_FRAMES) return null
  const shown = Math.min(interpolate(global, [from, from + CROSS_FADE_FRAMES], [0, 1], clamp), interpolate(global, [until, until + CROSS_FADE_FRAMES], [1, 0], clamp))
  const rtl = isRtl(lang)
  return (
    <AbsoluteFill style={{ background: GROUND, opacity: shown, fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: 'absolute',
          left: 48,
          right: 48,
          top: STRIP_HEIGHT + 40,
          bottom: BAR_HEIGHT + 40,
          borderRadius: 48,
          background: '#f4f2fa',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
          direction: rtl ? 'rtl' : 'ltr',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 44,
          padding: '140px 44px 56px',
        }}
      >
        <Tag text={label} lang={lang} corner={rtl ? 'top-right' : 'top-left'} size={36} offset={40} />
        <Bubble at={from + 3} mine>
          {chat.question}
        </Bubble>
        <Bubble at={from + 2 * beatFrames(tempo)}>
          {chat.parts.map((part, index) =>
            part.place ? (
              <span key={index} style={{ fontWeight: 700, unicodeBidi: 'isolate', direction: part.place === 'missingDate' ? 'ltr' : undefined }}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </Bubble>
      </div>
    </AbsoluteFill>
  )
}
