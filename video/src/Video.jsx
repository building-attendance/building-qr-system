// The composition of the provider tutorial video: the violet ground, the phone with the recorded screen of each beat (a still, which
// cross-fades into the next), the tap marks and outlines over it, the two drawn scenes, and the caption bar under the phone. The numbers
// (when each beat starts, when a tap happens) come from timing.js, so that this file only draws.
import { AbsoluteFill, Html5Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { DRAWN } from '../script/drawn.js'
import tapSound from './assets/tap.wav'
import { CameraScene, HighlightBox, LocationQuestion, TapMark, TitleCard, TypedDots, allowButtonBox } from './Screens.jsx'
import { COLORS, FONT_FAMILY } from './theme.js'
import { FADE_SECONDS, FPS, HEIGHT, LAYOUT, WIDTH, beatMotion, captionFontSize, captionGroups, centerOf, isRtl, planBeats, scaleBox, tapFrames, voiceTracks } from './timing.js'

const SCREEN = { width: LAYOUT.screenWidth, height: LAYOUT.screenHeight }
const FADE_FRAMES = Math.round(FADE_SECONDS * FPS)
const PHONE_WIDTH = SCREEN.width + LAYOUT.bezel * 2
const PHONE_HEIGHT = SCREEN.height + LAYOUT.bezel * 2

/** One recorded screen, with whatever is drawn over it, for the beat that starts where this Sequence starts. */
function Beat({ beat, plan, lang, strings, credit }) {
  const frame = useCurrentFrame()
  const motion = beatMotion(beat, beat.frames)
  const from = { width: beat.width, height: beat.height }
  const opacity = beat.index === 0 ? 1 : interpolate(frame, [0, FADE_FRAMES], [0, 1], { extrapolateRight: 'clamp' })
  const tapBox = beat.tap ? scaleBox(beat.tap, from, SCREEN) : null
  const highlight = beat.highlight && beat.id !== 'sign' ? scaleBox(beat.highlight, from, SCREEN) : null
  const taps = motion.taps.map((start) => ({ start, length: motion.tapLength }))
  const typingSource = motion.typing ? plan.beats.find((other) => other.id === motion.typing.source) : null

  let body
  if (beat.id === 'sign' && beat.highlight) {
    body = <CameraScene beat={beat} frame={frame} strings={strings} chipTap={taps[0]} />
  } else {
    body = (
      <>
        <Img src={staticFile(beat.image)} style={{ position: 'absolute', inset: 0, width: SCREEN.width, height: SCREEN.height }} />
        {motion.typing ? <TypedDots typing={motion.typing} beat={beat} source={typingSource} frame={frame} /> : null}
        {highlight ? <HighlightBox box={highlight} frame={frame} start={motion.highlightFrame} /> : null}
        {beat.id === 'locating' ? (
          <LocationQuestion frame={frame} total={beat.frames} strings={strings} lang={lang} tapStart={taps[0].start} tapLength={motion.tapLength} />
        ) : null}
        {beat.id === 'intro' || beat.id === 'outro' ? <TitleCard kind={beat.id} frame={frame} strings={strings} lang={lang} credit={credit} /> : null}
        {beat.id === 'locating' && taps[0] ? (
          <TapMark point={centerOf(allowButtonBox())} box={allowButtonBox()} frame={frame} start={taps[0].start} length={taps[0].length} />
        ) : null}
        {beat.id !== 'locating' && tapBox && taps[0] ? (
          <TapMark point={centerOf(tapBox)} box={tapBox} frame={frame} start={taps[0].start} length={taps[0].length} />
        ) : null}
      </>
    )
  }
  return <AbsoluteFill style={{ opacity }}>{body}</AbsoluteFill>
}

/** The caption of each line, in the bar under the phone: Rubik, from right to left for Hebrew and Arabic, fading between two lines. */
function CaptionBar({ groups, lang }) {
  const frame = useCurrentFrame()
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: LAYOUT.barHeight,
        background: COLORS.barBackground,
        borderTop: `4px solid ${COLORS.barAccent}`,
        boxSizing: 'border-box',
      }}
    >
      {groups.map((group) => {
        if (frame < group.startFrame - 1 || frame > group.endFrame + 1) return null
        const opacity = interpolate(frame, [group.startFrame, group.startFrame + 7, group.endFrame - 6, group.endFrame], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        return (
          <div
            key={group.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 40px',
              boxSizing: 'border-box',
              opacity,
              direction: isRtl(lang) ? 'rtl' : 'ltr',
              textAlign: 'center',
              color: COLORS.barText,
              fontFamily: FONT_FAMILY,
              fontWeight: 500,
              fontSize: captionFontSize(group.text),
              lineHeight: 1.4,
            }}
          >
            {group.text}
          </div>
        )
      })}
    </div>
  )
}

/**
 * @param {{ lang: string, scenes: any, timings: any }} props  the scenes.json of the language, and its timings.json (null: the estimates)
 */
export function ProviderVideo({ lang, scenes, timings }) {
  const plan = planBeats(scenes, timings)
  const groups = captionGroups(plan)
  const strings = DRAWN[lang] ?? DRAWN.en
  const credit = timings?.voice === 'elevenlabs' ? strings.voiceCredit : null
  const left = (WIDTH - PHONE_WIDTH) / 2
  return (
    <AbsoluteFill style={{ background: `linear-gradient(165deg, ${COLORS.groundFrom} 0%, ${COLORS.groundTo} 100%)`, fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: 'absolute',
          left,
          top: LAYOUT.phoneTop,
          width: PHONE_WIDTH,
          height: PHONE_HEIGHT,
          boxSizing: 'border-box',
          padding: LAYOUT.bezel,
          borderRadius: 60,
          background: COLORS.phone,
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.14)',
        }}
      >
        <div style={{ position: 'relative', width: SCREEN.width, height: SCREEN.height, borderRadius: 46, overflow: 'hidden', background: '#f7f5ff' }}>
          {plan.beats.map((beat, i) => {
            const last = i === plan.beats.length - 1
            return (
              <Sequence key={beat.id} from={beat.startFrame} durationInFrames={beat.frames + (last ? 0 : FADE_FRAMES)} name={beat.id}>
                <Beat beat={beat} plan={plan} lang={lang} strings={strings} credit={credit} />
              </Sequence>
            )
          })}
        </div>
      </div>
      <CaptionBar groups={groups} lang={lang} />
      {tapFrames(plan).map((start) => (
        <Sequence key={`tap-${start}`} from={start} durationInFrames={6}>
          <Html5Audio src={tapSound} volume={0.35} />
        </Sequence>
      ))}
      {voiceTracks(plan).map((track) => (
        <Sequence key={`voice-${track.id}`} from={track.startFrame} name={`voice ${track.id}`}>
          <Html5Audio src={staticFile(`voice/${track.file}`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

export const VIDEO = Object.freeze({ id: 'Provider', fps: FPS, width: WIDTH, height: HEIGHT })
