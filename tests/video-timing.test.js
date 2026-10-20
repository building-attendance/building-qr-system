// The timing of the provider tutorial video (video/src/timing.js, pure) and the facts about its composition that can be checked without
// rendering: the contrast of the caption bar and of every text on the screen, the pinned dependencies of video/ and that nothing of them
// reaches the root package.json. The render itself needs a browser and the frames of `npm run video:frames`, so it is not run here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SCENES, SCRIPTS } from '../video/script/index.js'
import { COLORS, TEXT_PAIRS } from '../video/src/theme.js'
import { QR_TOKEN_PREFIX } from '../shared/contract.js'
import { PAUSE_SECONDS } from '../scripts/video/timings.mjs'
import { MUSIC_RATE, musicWav } from '../video/src/make-music.mjs'
import {
  CAPTION_FADE_IN_SECONDS,
  CAPTION_RISE_PX,
  DEMO_QR,
  FADE_SECONDS,
  FPS,
  LAYOUT,
  HEIGHT,
  MAX_TRANSITION_SECONDS,
  MUSIC,
  MUSIC_FILE,
  SCENE_PUSH_PX,
  TAP_VOLUME,
  VOICE_PAUSE_SECONDS,
  WIDTH,
  beatMotion,
  captionAt,
  captionFontSize,
  captionGroups,
  centerOf,
  contrastRatio,
  dotsAt,
  entranceAt,
  isRtl,
  isSafeAudioName,
  musicVolumeAt,
  planBeats,
  risingCaptions,
  sceneEntrance,
  scaleBox,
  tapFrames,
  toVtt,
  voiceTracks,
  voicedSpans,
  vttTime,
} from '../video/src/timing.js'

const read = (file) => fs.readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')

/** A scenes.json as the recorder writes it (beats with a picture, its size and its boxes), from the real script and its captions. */
function scenesFile(lang = 'he') {
  return {
    lang,
    seconds: SCENES.reduce((sum, scene) => sum + scene.seconds, 0),
    scenes: SCENES.map((scene) => ({
      id: scene.id,
      seconds: scene.seconds,
      beats: scene.beats.map((beat) => ({
        id: beat.id,
        image: `${beat.id}.png`,
        masked: `${beat.id}.masked.png`,
        width: beat.id === 'sign' ? 900 : 390,
        height: beat.id === 'sign' ? 1200 : 844,
        scale: 2,
        tap: ['list', 'password', 'submit', 'recorded', 'far', 'pending', 'language'].includes(beat.id) ? { x: 20, y: 300, w: 350, h: 60 } : null,
        highlight: ['sign', 'submit', 'home', 'queued', 'sent'].includes(beat.id) ? { x: 204, y: 234, w: 491, h: 491 } : null,
        caption: beat.continues ? null : SCRIPTS[lang][beat.id].caption,
        say: beat.continues ? null : SCRIPTS[lang][beat.id].say,
        seconds: beat.seconds,
      })),
    })),
  }
}

describe('planBeats', () => {
  it('without timings, runs the estimates: contiguous beats from frame 0, 94 seconds in all', () => {
    const plan = planBeats(scenesFile())
    expect(plan.beats).toHaveLength(17)
    expect(plan.beats[0].startFrame).toBe(0)
    plan.beats.forEach((beat, i) => {
      if (i) expect(beat.startFrame).toBe(plan.beats[i - 1].endFrame)
      expect(beat.frames).toBeGreaterThan(0)
      expect(beat.audio).toBeNull()
    })
    expect(plan.totalFrames).toBe(94 * FPS)
    expect(plan.seconds).toBeCloseTo(94, 6)
  })

  it('keeps the caption of the line before a beat that continues it', () => {
    const plan = planBeats(scenesFile())
    const byId = Object.fromEntries(plan.beats.map((beat) => [beat.id, beat]))
    expect(byId.sent.caption).toBe(byId.pending.caption)
    for (const id of ['language-en', 'language-ru', 'language-ar']) expect(byId[id].caption).toBe(byId.language.caption)
    expect(byId.list.caption).not.toBe(byId.password.caption)
  })

  it('takes the real seconds of a line from timings.json, and keeps the estimate of a beat that is not in it', () => {
    const timings = { lang: 'he', voice: 'files', beats: { intro: { seconds: 6.5, audio: 'intro.mp3' }, list: { seconds: 4.2, audio: null } } }
    const plan = planBeats(scenesFile(), timings)
    const byId = Object.fromEntries(plan.beats.map((beat) => [beat.id, beat]))
    expect(byId.intro.seconds).toBe(6.5)
    expect(byId.intro.audio).toBe('intro.mp3')
    expect(byId.list.seconds).toBe(4.2)
    expect(byId.list.audio).toBeNull()
    expect(byId.sign.seconds).toBe(12) // not in timings.json
    expect(plan.seconds).toBeCloseTo(94 + 2.5 - 2.8, 6)
    expect(voiceTracks(plan)).toEqual([{ id: 'intro', file: 'intro.mp3', startFrame: 0 }])
  })

  it('never lets timings.json time a beat that continues a line, and ignores a number that is not a duration', () => {
    const timings = { beats: { sent: { seconds: 40, audio: 'sent.mp3' }, far: { seconds: 0, audio: null }, home: { seconds: Number.NaN, audio: null }, outro: { seconds: -2 } } }
    const byId = Object.fromEntries(planBeats(scenesFile(), timings).beats.map((beat) => [beat.id, beat]))
    expect(byId.sent.seconds).toBe(3)
    expect(byId.sent.audio).toBeNull()
    expect(byId.far.seconds).toBe(8)
    expect(byId.home.seconds).toBe(7)
    expect(byId.outro.seconds).toBe(4)
  })

  it('keeps the screens that continue a line after its audio, except the language beat, which shares its audio with them', () => {
    const timings = { beats: { pending: { seconds: 3, audio: null }, language: { seconds: 6.5, audio: null } } }
    const plan = planBeats(scenesFile(), timings)
    const byId = Object.fromEntries(plan.beats.map((beat) => [beat.id, beat]))
    expect(byId.pending.seconds).toBe(3)
    expect(byId.sent.seconds).toBe(3) // after the line, in silence
    expect(byId.language.seconds).toBeCloseTo(6.5 - 3.75, 6) // the three screens are named while the line is said
    expect(byId['language-ar'].endFrame).toBe(plan.beats.find((beat) => beat.id === 'outro').startFrame)
    const language = plan.beats.filter((beat) => beat.id.startsWith('language'))
    expect((language[language.length - 1].endFrame - language[0].startFrame) / FPS).toBeCloseTo(6.5, 1)
  })

  it('gives no voice to a line whose duration is not a duration (its audio would overlap the next line)', () => {
    const plan = planBeats(scenesFile(), { beats: { intro: { seconds: 0, audio: 'a.mp3' }, list: { audio: 'b.mp3' } } })
    expect(voiceTracks(plan)).toEqual([])
    expect(plan.totalFrames).toBe(94 * FPS)
  })

  it('does not pass a lead beat below a short floor when its audio is shorter than its screens', () => {
    const plan = planBeats(scenesFile(), { beats: { language: { seconds: 2, audio: null } } })
    expect(plan.beats.find((beat) => beat.id === 'language').seconds).toBe(1.5)
  })

  it('accepts only the name of an mp3 file as audio, never a path', () => {
    for (const name of ['a.mp3', 'intro-3f2a.mp3', 'x_1.2.mp3']) expect(isSafeAudioName(name)).toBe(true)
    for (const name of ['../a.mp3', 'voice/a.mp3', 'a\\b.mp3', '/etc/a.mp3', 'a.wav', '.mp3', 'a..mp3', '', null, undefined, 4, 'a b.mp3', 'a.mp3?x=1']) expect(isSafeAudioName(name)).toBe(false)
    const plan = planBeats(scenesFile(), { beats: { intro: { seconds: 5, audio: '../../secrets.mp3' } } })
    expect(plan.beats[0].audio).toBeNull()
    expect(plan.beats[0].seconds).toBe(5)
  })
})

describe('the captions', () => {
  it('are one per line: a beat that continues the line extends its caption', () => {
    const plan = planBeats(scenesFile())
    const groups = captionGroups(plan)
    expect(groups).toHaveLength(13)
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]))
    const beat = Object.fromEntries(plan.beats.map((entry) => [entry.id, entry]))
    expect(byId.pending.endFrame).toBe(beat.sent.endFrame)
    expect(byId.language.endFrame).toBe(beat['language-ar'].endFrame)
    expect(groups[0].startFrame).toBe(0)
    expect(groups[groups.length - 1].endFrame).toBe(plan.totalFrames)
  })

  it('go out as WebVTT: a header, numbered cues in order that do not overlap, HH:MM:SS.mmm', () => {
    const vtt = toVtt(planBeats(scenesFile()))
    const lines = vtt.split('\n')
    expect(lines[0]).toBe('WEBVTT')
    expect(vtt.endsWith('\n')).toBe(true)
    const times = [...vtt.matchAll(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/gm)]
    expect(times).toHaveLength(13)
    let previousEnd = ''
    for (const [, start, end] of times) {
      expect(start < end).toBe(true)
      expect(start >= previousEnd).toBe(true)
      previousEnd = end
    }
    expect(times[0][1]).toBe('00:00:00.000')
    expect(times[times.length - 1][2]).toBe('00:01:34.000')
    expect(vtt).toContain(SCRIPTS.he.intro.caption)
  })

  it('escape a caption that holds markup or an arrow, so that it cannot break a cue', () => {
    const plan = { beats: [{ id: 'a', caption: 'a <b>x</b> --> y & z\n\nnext', startFrame: 0, endFrame: 30 }] }
    const cue = toVtt(plan).trim().split('\n\n')[1].split('\n')
    expect(cue[2]).toBe('a &lt;b&gt;x&lt;/b&gt; --&gt; y &amp; z next')
    expect(cue).toHaveLength(3)
  })

  it('write a timestamp from frames', () => {
    expect(vttTime(0)).toBe('00:00:00.000')
    expect(vttTime(45)).toBe('00:00:01.500')
    expect(vttTime(FPS * 3661)).toBe('01:01:01.000')
  })

  it('fit the bar at the size they are set in, for every caption of every language of the script (a conservative estimate of the line breaks)', () => {
    const inner = WIDTH - 80 // the padding of the bar
    const room = LAYOUT.barHeight - 4 - 40 // the accent line and a margin
    for (const [lang, lines] of Object.entries(SCRIPTS)) {
      for (const [id, line] of Object.entries(lines)) {
        const size = captionFontSize(line.caption)
        const perLine = Math.floor(inner / (size * 0.55)) // a Rubik letter is about 0.5 em wide, with room for the words that do not break
        const rows = Math.ceil((line.caption.length * 1.08) / perLine)
        expect(rows * size * 1.4, `${lang} ${id}`).toBeLessThanOrEqual(room)
        expect(size).toBeGreaterThanOrEqual(34) // readable when the video is shown at half its width on a phone (17 CSS pixels)
      }
    }
  })

  it('run right to left in Hebrew and Arabic only', () => {
    expect(['he', 'ar', 'en', 'ru'].map(isRtl)).toEqual([true, true, false, false])
  })
})

describe('the layout', () => {
  it('puts the phone and the caption bar inside the 720x1280 video, in the proportions of the 390x844 recording', () => {
    const bottom = LAYOUT.phoneTop + LAYOUT.bezel * 2 + LAYOUT.screenHeight
    expect(bottom).toBeLessThanOrEqual(HEIGHT - LAYOUT.barHeight)
    expect(LAYOUT.screenWidth + LAYOUT.bezel * 2).toBeLessThan(WIDTH)
    expect(LAYOUT.screenWidth / LAYOUT.screenHeight).toBeCloseTo(390 / 844, 2)
  })

  it('scales a box of the recording onto the screen of the video', () => {
    const to = { width: LAYOUT.screenWidth, height: LAYOUT.screenHeight }
    const box = scaleBox({ x: 0, y: 0, w: 390, h: 844 }, { width: 390, height: 844 }, to)
    expect(box).toEqual({ x: 0, y: 0, w: LAYOUT.screenWidth, h: LAYOUT.screenHeight })
    const half = scaleBox({ x: 195, y: 422, w: 39, h: 84.4 }, { width: 390, height: 844 }, to)
    expect(half.x).toBeCloseTo(LAYOUT.screenWidth / 2, 6)
    expect(half.w).toBeCloseTo(LAYOUT.screenWidth / 10, 6)
    expect(centerOf({ x: 10, y: 20, w: 30, h: 40 })).toEqual({ x: 25, y: 40 })
  })
})

describe('the motion inside a beat', () => {
  const plan = planBeats(scenesFile())
  const beat = (id) => plan.beats.find((entry) => entry.id === id)

  it('puts every tap inside its beat, with room to finish before the next screen', () => {
    for (const entry of plan.beats) {
      const { taps, tapLength } = beatMotion(entry, entry.frames)
      for (const start of taps) {
        expect(start).toBeGreaterThanOrEqual(0)
        expect(start + tapLength).toBeLessThanOrEqual(entry.frames)
      }
    }
  })

  it('taps the box of a beat that has one, the drawn taps of the camera and of the question, and nothing else', () => {
    expect(beatMotion(beat('list'), beat('list').frames).taps).toHaveLength(1)
    expect(beatMotion(beat('sign'), beat('sign').frames).taps).toHaveLength(1)
    expect(beatMotion(beat('locating'), beat('locating').frames).taps).toHaveLength(1)
    expect(beatMotion(beat('home'), beat('home').frames).taps).toEqual([])
    expect(beatMotion(beat('intro'), beat('intro').frames).taps).toEqual([])
  })

  it('still places a tap in a beat that is short (the timing of a short line)', () => {
    const short = { ...beat('list'), frames: 40 }
    const { taps, tapLength } = beatMotion(short, short.frames)
    expect(taps[0] + tapLength).toBeLessThanOrEqual(40)
  })

  it('types the password dots one by one during the password beat, and shows them all by its end', () => {
    const { typing } = beatMotion(beat('password'), beat('password').frames)
    expect(typing.source).toBe('submit')
    expect(dotsAt(typing, 0)).toBe(0)
    let previous = 0
    for (let frame = 0; frame <= beat('password').frames; frame += 1) {
      const now = dotsAt(typing, frame)
      expect(now).toBeGreaterThanOrEqual(previous)
      expect(now - previous).toBeLessThanOrEqual(1)
      previous = now
    }
    expect(previous).toBe(typing.dots)
    expect(beatMotion(beat('list'), beat('list').frames).typing).toBeNull()
  })

  it('lists the frame of every tap sound in order of the video, inside it', () => {
    const frames = tapFrames(plan)
    expect(frames.length).toBeGreaterThanOrEqual(4)
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
    for (const frame of frames) expect(frame).toBeLessThan(plan.totalFrames)
  })
})

describe('the colours', () => {
  it('give the caption bar and every text on the screen the contrast of WCAG AA (4.5:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    for (const [name, text, background] of TEXT_PAIRS) expect(contrastRatio(text, background), name).toBeGreaterThanOrEqual(4.5)
  })

  it('give the tap mark 3:1 on the light screen and on the dark camera (WCAG 1.4.11)', () => {
    expect(contrastRatio(COLORS.mark, '#f7f5ff')).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(COLORS.markOnDark, COLORS.camera)).toBeGreaterThanOrEqual(3)
  })
})

describe('the video folder', () => {
  const lock = JSON.parse(read('video/package.json'))
  const exact = /^\d+\.\d+\.\d+$/

  it('pins every dependency to one exact version, and the Remotion packages to the same one', () => {
    for (const [name, version] of Object.entries(lock.dependencies)) expect(version, name).toMatch(exact)
    const remotion = Object.entries(lock.dependencies).filter(([name]) => name === 'remotion' || name.startsWith('@remotion/'))
    expect(remotion.length).toBeGreaterThanOrEqual(3)
    expect(new Set(remotion.map(([, version]) => version)).size).toBe(1)
  })

  it('has a lockfile of its own, and adds nothing to the root package.json (the app, CI and Vercel never install it)', () => {
    expect(fs.existsSync(fileURLToPath(new URL('../video/package-lock.json', import.meta.url)))).toBe(true)
    const root = JSON.parse(read('package.json'))
    const all = { ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies }
    expect(Object.keys(all).filter((name) => name === 'remotion' || name.startsWith('@remotion/'))).toEqual([])
    expect(root.workspaces).toBeUndefined()
  })

  it('keeps the timing file free of Remotion and of any browser name, so that the unit run can read it', () => {
    const source = read('video/src/timing.js')
    expect(source).not.toMatch(/from 'remotion'|from "remotion"|@remotion|globalThis|window\./)
  })

  it('uses the Rubik of the app, from the same package', () => {
    expect(lock.dependencies['@fontsource-variable/rubik']).toBeDefined()
    expect(read('video/src/Root.jsx')).toContain("import '@fontsource-variable/rubik'")
  })
})

describe('the demo QR code of the camera scene', () => {
  it('holds plain text: no link, no address and never the token of a point (a secret), so scanning the screen opens nothing', () => {
    expect(DEMO_QR.text).toBe('DEMO')
    expect(DEMO_QR.text).not.toMatch(/[:/.]/)
    expect(DEMO_QR.text.toUpperCase()).not.toContain(QR_TOKEN_PREFIX.toUpperCase())
  })

  it('is made at every render as vector graphics, with the pinned qrcode of video/, and covers the code of the printed sign', () => {
    expect(DEMO_QR.file).toMatch(/^[a-z-]+\.svg$/)
    expect(JSON.parse(read('video/package.json')).dependencies.qrcode).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read('video/src/render.mjs')).toContain("type: 'svg'")
    const camera = read('video/src/Screens.jsx')
    expect(camera).toContain('staticFile(DEMO_QR.file)')
    expect(camera).not.toContain('blur(')
  })
})

/** The timings.json of a narrator that voiced every line of the script except the ones in `silent` (6 seconds a line, the pause included). */
function voicedTimings(silent = []) {
  const beats = {}
  for (const scene of SCENES) {
    for (const beat of scene.beats) if (!beat.continues && !silent.includes(beat.id)) beats[beat.id] = { seconds: 6, audio: `${beat.id}.mp3` }
  }
  return { lang: 'he', voice: 'files', beats }
}

describe('the music bed', () => {
  const plan = planBeats(scenesFile(), voicedTimings(['far']))
  const spans = voicedSpans(plan)
  const volume = (frame) => musicVolumeAt(spans, frame, plan.totalFrames)
  const beat = (id) => plan.beats.find((entry) => entry.id === id)
  const middle = (id) => beat(id).startFrame + Math.floor(beat(id).frames / 2)
  const pauseFrames = Math.round(VOICE_PAUSE_SECONDS * FPS)

  it('is lower while the narrator speaks than in a quiet stretch, and both levels are within their bounds', () => {
    const voiced = volume(middle('list'))
    const quiet = volume(middle('far')) // the one line that has no voice in this plan
    expect(voiced).toBeCloseTo(MUSIC.duckedLevel, 6)
    expect(quiet).toBeCloseTo(MUSIC.level, 6)
    expect(voiced).toBeLessThan(quiet)
    expect(MUSIC.duckedLevel).toBeGreaterThan(0)
    expect(MUSIC.level).toBeLessThanOrEqual(0.3) // a bed, never a rival of the voice
    expect(MUSIC.level / MUSIC.duckedLevel).toBeGreaterThanOrEqual(1.5)
  })

  it('dips a moment before a line starts and rises a moment after it ends, never jumping', () => {
    const next = beat('queued')
    expect(volume(next.startFrame - Math.round(MUSIC.leadSeconds * FPS))).toBeCloseTo(MUSIC.duckedLevel, 6)
    expect(volume(next.startFrame - Math.round((MUSIC.leadSeconds + MUSIC.rampSeconds) * FPS) - 1)).toBeCloseTo(MUSIC.level, 6)
    const before = spans.find((entry) => entry.startFrame === beat('home').startFrame)
    expect(volume(before.endFrame + Math.round((MUSIC.tailSeconds + MUSIC.rampSeconds) * FPS) + 1)).toBeGreaterThan(MUSIC.duckedLevel)
    for (let frame = 1; frame < plan.totalFrames; frame += 1) {
      expect(Math.abs(volume(frame) - volume(frame - 1))).toBeLessThan(0.02)
    }
  })

  it('fades in at the start and out at the end, and stays within 0 and the quiet level', () => {
    expect(volume(0)).toBe(0)
    expect(volume(plan.totalFrames)).toBe(0)
    const rise = []
    for (let frame = 0; frame <= MUSIC.fadeInSeconds * FPS; frame += 1) rise.push(musicVolumeAt([], frame, plan.totalFrames))
    expect(rise).toEqual([...rise].sort((a, b) => a - b))
    expect(rise[rise.length - 1]).toBeCloseTo(MUSIC.level, 6)
    const fall = []
    for (let frame = plan.totalFrames - Math.round(MUSIC.fadeOutSeconds * FPS); frame <= plan.totalFrames; frame += 1) fall.push(musicVolumeAt([], frame, plan.totalFrames))
    expect(fall).toEqual([...fall].sort((a, b) => b - a))
    for (let frame = 0; frame <= plan.totalFrames; frame += 1) {
      expect(volume(frame)).toBeGreaterThanOrEqual(0)
      expect(volume(frame)).toBeLessThanOrEqual(MUSIC.level)
    }
  })

  it('treats the audio of a line, not its pause, as the voiced part, and a line over the screens that continue it as one stretch', () => {
    const lead = beat('list')
    expect(spans.find((entry) => entry.startFrame === lead.startFrame).endFrame).toBe(lead.endFrame - pauseFrames)
    const language = spans.find((entry) => entry.startFrame === beat('language').startFrame)
    expect(language.endFrame).toBe(beat('language-ar').endFrame - pauseFrames)
    expect(spans.some((entry) => entry.startFrame === beat('language-en').startFrame)).toBe(false)
    expect(spans.some((entry) => entry.startFrame === beat('far').startFrame)).toBe(false)
    expect(VOICE_PAUSE_SECONDS).toBe(PAUSE_SECONDS) // the narrator step's pause, which the music must not duck for
  })

  it('does not change the length of the video: the music and the motion are not in the plan', () => {
    expect(planBeats(scenesFile()).totalFrames).toBe(Math.round(SCENES.reduce((sum, scene) => sum + scene.seconds, 0) * FPS))
    expect(plan.totalFrames).toBe(Math.round(plan.seconds * FPS))
    expect(plan.seconds).toBeCloseTo(plan.beats.reduce((total, entry) => total + entry.seconds, 0), 6)
  })

  it('is made in code: a stereo WAV of the length asked for, the same bytes every time, quiet and not silent', () => {
    const wav = musicWav(12)
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
    expect(wav.toString('latin1', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(2)
    expect(wav.readUInt32LE(24)).toBe(MUSIC_RATE)
    expect(wav.length).toBe(44 + 12 * MUSIC_RATE * 4)
    expect(Buffer.compare(wav, musicWav(12))).toBe(0)
    let peak = 0
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)))
    expect(peak / 32767).toBeGreaterThan(0.05)
    expect(peak / 32767).toBeLessThan(0.5)
  })

  it('is written by the render into the staged folder and played by the composition, and no audio but the tap is committed', () => {
    expect(MUSIC_FILE).toMatch(/^[a-z-]+\.wav$/)
    expect(read('video/src/render.mjs')).toContain('musicWav(')
    expect(read('video/src/Video.jsx')).toContain('staticFile(MUSIC_FILE)')
    expect(fs.readdirSync(fileURLToPath(new URL('../video/src/assets', import.meta.url)))).toEqual(['tap.wav'])
  })
})

describe('the motion between scenes and of the captions', () => {
  const plan = planBeats(scenesFile(), voicedTimings())

  it('never takes a scene change longer than 0.4 seconds, and gives the first picture no fade', () => {
    expect(FADE_SECONDS).toBeLessThanOrEqual(MAX_TRANSITION_SECONDS)
    plan.beats.forEach((entry, i) => {
      const entrance = sceneEntrance(plan, i)
      expect(entrance.frames / FPS).toBeLessThanOrEqual(MAX_TRANSITION_SECONDS)
      expect(entrance.frames).toBeLessThanOrEqual(entry.frames)
    })
    expect(sceneEntrance(plan, 0)).toEqual({ frames: 0, push: 0 })
    expect(entranceAt(sceneEntrance(plan, 0), 0)).toEqual({ opacity: 1, offsetY: 0 })
  })

  it('pushes only where a new scene starts, and never while a tap mark or an outline is on the screen', () => {
    const pushed = []
    plan.beats.forEach((entry, i) => {
      const entrance = sceneEntrance(plan, i)
      if (!entrance.push) return
      pushed.push(entry.id)
      expect(entrance.push).toBe(SCENE_PUSH_PX)
      expect(entry.sceneId).not.toBe(plan.beats[i - 1].sceneId)
      for (const start of beatMotion(entry, entry.frames).taps) expect(start).toBeGreaterThanOrEqual(entrance.frames)
      expect(entry.highlight).toBeFalsy()
      expect(plan.beats[i - 1].highlight).toBeFalsy()
    })
    expect(pushed.length).toBeGreaterThanOrEqual(2)
    expect(pushed).toContain('outro')
    for (const id of ['sign', 'submit', 'home', 'language-en']) expect(pushed).not.toContain(id)
  })

  it('rises and fades in smoothly, and ends at rest', () => {
    const entrance = { frames: 10, push: SCENE_PUSH_PX }
    expect(entranceAt(entrance, 0)).toEqual({ opacity: 0, offsetY: SCENE_PUSH_PX })
    expect(entranceAt(entrance, 10)).toEqual({ opacity: 1, offsetY: 0 })
    expect(entranceAt(entrance, 40)).toEqual({ opacity: 1, offsetY: 0 })
    let before = entranceAt(entrance, 0)
    for (let frame = 1; frame <= 10; frame += 1) {
      const now = entranceAt(entrance, frame)
      expect(now.opacity).toBeGreaterThanOrEqual(before.opacity)
      expect(now.offsetY).toBeLessThanOrEqual(before.offsetY)
      before = now
    }
  })

  it('raises a caption 8 pixels while it fades in over a quarter of a second, and not while an outline comes in', () => {
    expect(CAPTION_RISE_PX).toBe(8)
    expect(CAPTION_FADE_IN_SECONDS).toBe(0.25)
    const groups = risingCaptions(plan)
    const group = (id) => groups.find((entry) => entry.id === id)
    expect(group('list').rise).toBe(true)
    for (const id of ['sign', 'submit', 'home', 'queued']) expect(group(id).rise, id).toBe(false)
    const rising = { startFrame: 100, endFrame: 400, rise: true }
    expect(captionAt(rising, 100)).toEqual({ opacity: 0, offsetY: CAPTION_RISE_PX })
    expect(captionAt(rising, 100 + CAPTION_FADE_IN_SECONDS * FPS)).toEqual({ opacity: 1, offsetY: 0 })
    expect(captionAt(rising, 200)).toEqual({ opacity: 1, offsetY: 0 })
    expect(captionAt(rising, 397).offsetY).toBe(0) // it fades out without moving
    expect(captionAt(rising, 397).opacity).toBeLessThan(1)
    expect(captionAt(rising, 400).opacity).toBe(0)
    expect(captionAt({ ...rising, rise: false }, 100).offsetY).toBe(0)
  })

  it('plays the tap softer than before (it was 0.35)', () => {
    expect(TAP_VOLUME).toBeLessThan(0.35)
    expect(TAP_VOLUME).toBeGreaterThan(0)
  })
})

describe('the assets of the video', () => {
  const assets = read('video/ASSETS.md')

  it('are all listed in video/ASSETS.md: every file under src/assets and every generated sound', () => {
    for (const file of fs.readdirSync(fileURLToPath(new URL('../video/src/assets', import.meta.url)))) expect(assets, file).toContain(file)
    const generators = fs.readdirSync(fileURLToPath(new URL('../video/src', import.meta.url))).filter((name) => /^make-.*\.mjs$/.test(name))
    expect(generators).toEqual(expect.arrayContaining(['make-music.mjs', 'make-tap-sound.mjs']))
    for (const file of generators) expect(assets, file).toContain(file)
    expect(assets).toContain('@fontsource-variable/rubik')
  })

  it('say that nothing of a third party is committed, and give every row a licence', () => {
    expect(assets).toContain('no file of a third party is committed')
    const rows = assets.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Asset'))
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const row of rows) expect(row.split('|').filter((cell) => cell.trim()).length, row).toBe(5)
  })
})
