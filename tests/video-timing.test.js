// The timing of the provider tutorial video (video/src/timing.js, pure) and the facts about its composition that can be checked without
// rendering: the contrast of the caption bar and of every text on the screen, the pinned dependencies of video/ and that nothing of them
// reaches the root package.json. The render itself needs a browser and the frames of `npm run video:frames`, so it is not run here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SCENES, SCRIPTS } from '../video/script/index.js'
import { COLORS, TEXT_PAIRS } from '../video/src/theme.js'
import { QR_TOKEN_PREFIX } from '../shared/contract.js'
import {
  DEMO_QR,
  FPS,
  LAYOUT,
  HEIGHT,
  WIDTH,
  beatMotion,
  captionFontSize,
  captionGroups,
  centerOf,
  contrastRatio,
  dotsAt,
  isRtl,
  isSafeAudioName,
  planBeats,
  scaleBox,
  tapFrames,
  toVtt,
  voiceTracks,
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
        tap: ['list', 'password', 'submit', 'pending'].includes(beat.id) ? { x: 20, y: 300, w: 350, h: 60 } : null,
        highlight: beat.id === 'sign' ? { x: 204, y: 234, w: 491, h: 491 } : null,
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
