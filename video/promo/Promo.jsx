// The composition of the promo video (1080x1920): per scene of the plan (timing.js), the text on the violet ground, a screenshot in a drawn
// phone with its caption in a solid bar under it, the camera scene (the tutorial's `CameraScene`, over a drawn sign), or the closing card
// with the repository's address and its QR code. The caption comes in word by word (each phrase on its beat, its words spread over that
// beat, with a short overshoot), and one keyword per caption is drawn in an accent colour. The text is always on a flat colour, never over
// a picture. The scenes are drawn by the parts in parts/, which the long cut shares; the effects of decision D16 are all placed on the
// beats of the plan by timing.js:
// - W2: on every bar line the ground brightens a little and the phone grows by 2% for a beat; the first beat of the groove (scene 3) is a
//   bigger punch. A pulse falls over a beat and the bar lines are at least 1.2 s apart, so never three changes of brightness in a second.
// - W3: the phone enters tilted about 22 degrees to 0 in 3D over a beat, then pushes in slowly, from 1.0 to 1.04, through its scene (parts/phone.jsx).
// - W4: a whip of 8 frames at every scene boundary, ending on the bar line: the old scene slides out and the new one in, side by side (parts/whip.jsx).
// - W5: the sounds of make-sounds.mjs (a whoosh at each whip, an impact on the groove, a ding at the check-in screen), when `sounds` is on.
// - W6: the closing card's QR tile springs in and, on the first beat of the last bar, pops while a burst of confetti flies out from behind
//   it and is gone half a second before the end, so the code is clean again (parts/closing.jsx).
// The track is staged by render.mjs when it is given one (music.js): started at the frame it names, faded in at the start and out over the
// last second and a half. The effect sounds are quiet next to it and none plays in that last second and a half.
import { Html5Audio, Sequence, staticFile } from 'remotion'
import { DRAWN } from '../script/drawn.js'
import { COLORS, FONT_FAMILY } from '../src/theme.js'
import { volumeAt } from './fade.js'
import { VERTICAL } from './format.js'
import { ClosingScene } from './parts/closing.jsx'
import { FormatFrame } from './parts/format.jsx'
import { PhoneScene } from './parts/phone.jsx'
import { TextScene } from './parts/text.jsx'
import { SceneTrack } from './parts/track.jsx'
import { KEYWORDS } from './script/index.js'
import { DEFAULT_TEMPO, FPS, MIX_GAIN, burstFrame, planPromo, soundCues } from './timing.js'

export const PROMO = Object.freeze({ id: 'Promo', fps: FPS, width: VERTICAL.width, height: VERTICAL.height })

/**
 * @param {{ lang: string, bpm: number, firstBeat: number, music?: { file: string, startFrame: number } | null, sounds?: boolean }} props
 * `music` is the staged track and the frame of it where the music starts; without it there is no music. `sounds` plays the effect sounds
 * that render.mjs stages (make-sounds.mjs); off, the composition is silent apart from the track. `format` is the frame and the layout that
 * the parts read (format.js): VERTICAL, the only one so far.
 */
export function Promo({ lang, bpm, firstBeat, music = null, sounds = false, format = VERTICAL }) {
  const tempo = { bpm, firstBeat }
  const plan = planPromo(lang, tempo)
  const strings = DRAWN[lang] ?? DRAWN.en
  const keywords = KEYWORDS[lang] ?? {}
  const burst = burstFrame(plan, tempo)
  return (
    <FormatFrame format={format} style={{ background: COLORS.groundTo, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {music ? <Html5Audio src={staticFile(music.file)} trimBefore={music.startFrame} volume={(frame) => MIX_GAIN * volumeAt(frame, plan)} /> : null}
      {sounds
        ? soundCues(plan).map((cue) => (
            <Sequence key={`${cue.kind}-${cue.frame}`} from={cue.frame} durationInFrames={cue.frames} name={cue.kind}>
              <Html5Audio src={staticFile(cue.file)} volume={MIX_GAIN * cue.volume} />
            </Sequence>
          ))
        : null}
      <SceneTrack
        plan={plan}
        lang={lang}
        tempo={tempo}
        render={(scene) =>
          scene.picture === 'text' ? (
            <TextScene scene={scene} lang={lang} keyword={keywords[scene.id]} />
          ) : scene.picture === 'closing' ? (
            <ClosingScene scene={scene} lang={lang} keyword={keywords[scene.id]} burst={burst} />
          ) : (
            <PhoneScene scene={scene} lang={lang} strings={strings} keyword={keywords[scene.id]} />
          )
        }
      />
    </FormatFrame>
  )
}

export const promoDefaultProps = Object.freeze({ lang: 'he', bpm: DEFAULT_TEMPO.bpm, firstBeat: DEFAULT_TEMPO.firstBeat, music: null, sounds: false })
