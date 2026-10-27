// The script and the timing of the promo video (video/promo/script, video/promo/timing.js, pure): every caption gets its reading time, every
// cut falls on a beat, the video ends on a bar, and a tempo or a caption that cannot work is refused with the scene's name. The render
// itself (a browser, the music) is not run here.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { PEAK, RATE, makeSounds } from '../video/promo/make-sounds.mjs'
import { MUSIC_FADE_IN_SECONDS, checkMusicPath, checkMusicStart, stagedMusicFile, startFrameOf, volumeAt } from '../video/promo/music.js'
import { DRAWN_PICTURES, KEYWORDS, KEYWORD_COLOR, LANGUAGES, REPOSITORY_URL, SCENES, SCRIPTS } from '../video/promo/script/index.js'
import {
  BEATS_PER_BAR,
  DEFAULT_TEMPO,
  FPS,
  GROOVE_SCENE,
  HEIGHT,
  MAX_BPM,
  MIX_GAIN,
  MIN_BPM,
  MIN_CUT_BEATS,
  MUSIC_FADE_OUT_SECONDS,
  PULSE,
  SOUNDS,
  WHIP_FRAMES,
  WIDTH,
  barPhase,
  beatFrame,
  beatFrames,
  burstFrame,
  keywordRange,
  phrasesOf,
  planPromo,
  pulseAt,
  punchAt,
  readingSeconds,
  soundCues,
  wordFrames,
  wordsOf,
} from '../video/promo/timing.js'
import { COLORS } from '../video/src/theme.js'
import { contrastRatio } from '../video/src/timing.js'
import { REPOSITORY_QR, REPOSITORY_QR_OPTIONS, SIGN, demoQrSvg, repositoryQrSvg, signSvg, stagedPictures } from '../video/promo/stage.js'

const SCREENSHOTS = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
const TRACK = { bpm: 120, firstBeat: 0 }
// Tempos that the video may be planned at: the default, the chosen track (decision D17), the first track (D14), and a first beat that
// is late in the bar.
const TEMPOS = [DEFAULT_TEMPO, TRACK, { bpm: 122, firstBeat: 0 }, { bpm: 122, firstBeat: 0.265 }, { bpm: 100, firstBeat: 0 }, { bpm: 132, firstBeat: 0 }]

const isBarFrame = (frame, tempo) => Array.from({ length: 200 }, (_, bar) => beatFrame(bar * BEATS_PER_BAR, tempo)).includes(frame)
const isBeatFrame = (frame, tempo) => Array.from({ length: 800 }, (_, beat) => beatFrame(beat, tempo)).includes(frame)

describe('the promo script', () => {
  it('has the seven scenes of the plan, with unique ids and a caption in every language', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['question', 'providers', 'scan', 'offline', 'committee', 'open', 'closing'])
    expect(new Set(SCENES.map((scene) => scene.id)).size).toBe(SCENES.length)
    expect(LANGUAGES).toEqual(['he'])
    for (const lang of LANGUAGES) {
      expect(Object.keys(SCRIPTS[lang]).sort()).toEqual(SCENES.map((scene) => scene.id).sort())
    }
    expect(SCENES.reduce((sum, scene) => sum + scene.bars, 0)).toBe(17)
  })

  it('writes the captions as plain text: no vowel points and no long dash', () => {
    for (const lang of LANGUAGES) {
      for (const [id, caption] of Object.entries(SCRIPTS[lang])) {
        expect(caption, id).toBe(caption.trim())
        expect(caption, id).not.toMatch(/[֑-ׇֽֿׁׂׅׄ]/) // niqqud and cantillation (not the maqaf or the paseq)
        expect(caption, id).not.toMatch(/[‒-―]/) // figure dash, en dash, em dash, horizontal bar
      }
    }
  })

  it('keeps out the promises the app does not make (D2): no "free" alone and no claim that presence is verified', () => {
    const all = SCENES.map((scene) => SCRIPTS.he[scene.id]).join(' ')
    expect(all).not.toMatch(/חינם|מוודא|מאמת|אימות/)
  })

  it('names every picture that is a file of docs/screenshots/ by a file that exists, and the others by the fixed list', () => {
    for (const scene of SCENES) {
      for (const picture of [scene.picture, scene.then].filter(Boolean)) {
        if (DRAWN_PICTURES.includes(picture)) continue
        expect(picture, scene.id).toMatch(/^[a-z0-9-]+\.png$/)
        expect(fs.existsSync(SCREENSHOTS + picture), `${scene.id}: ${picture}`).toBe(true)
      }
    }
  })

  it('points the closing card at the public repository, never at the live app of a building', () => {
    expect(REPOSITORY_URL).toBe('https://github.com/building-attendance/building-qr-system')
  })
})

describe('phrasesOf', () => {
  it('cuts after each sentence or clause mark and keeps the words in order', () => {
    expect(phrasesOf('ספקים באים והולכים. ומי רושם?')).toEqual(['ספקים באים והולכים.', 'ומי רושם?'])
    expect(phrasesOf('גם בלי קליטה: הנוכחות נשמרת ונשלחת כשהקליטה חוזרת.')).toEqual(['גם בלי קליטה:', 'הנוכחות נשמרת ונשלחת כשהקליטה חוזרת.'])
    expect(phrasesOf('קוד פתוח. עותק משלכם, והנתונים בחשבונות שלכם.')).toEqual(['קוד פתוח.', 'עותק משלכם,', 'והנתונים בחשבונות שלכם.'])
    expect(phrasesOf('a b, c d? e')).toEqual(['a b,', 'c d?', 'e'])
    // A mark inside a token (a number, a time, an address) does not end a phrase.
    expect(phrasesOf('at 10:30 on github.com, v1.2.')).toEqual(['at 10:30 on github.com,', 'v1.2.'])
  })

  it('gives one phrase to a caption with no mark inside it, and none to an empty one', () => {
    expect(phrasesOf('one two three')).toEqual(['one two three'])
    expect(phrasesOf('')).toEqual([])
    expect(phrasesOf('  ')).toEqual([])
  })

  it('splits every caption of the script into phrases that join back to the caption', () => {
    for (const caption of Object.values(SCRIPTS.he)) expect(phrasesOf(caption).join(' ')).toBe(caption)
  })
})

describe('the reading time', () => {
  it('is 2 seconds at least and 0.4 second a word', () => {
    expect(wordsOf('a  b c')).toBe(3)
    expect(readingSeconds('one two')).toBe(2)
    expect(readingSeconds('one two three four five six seven eight')).toBeCloseTo(3.2)
  })
})

describe('planPromo', () => {
  it('plans 17 bars in 34 seconds at 120 bpm (1020 frames, 1080x1920 at 30 fps)', () => {
    const plan = planPromo('he')
    expect(plan.bars).toBe(17)
    expect(plan.totalFrames).toBe(34 * FPS)
    expect(plan.scenes[0].startFrame).toBe(0)
    expect([FPS, WIDTH, HEIGHT]).toEqual([30, 1080, 1920])
    expect(plan.scenes.map((scene) => (scene.endFrame - scene.startFrame) / FPS)).toEqual([4, 4, 6, 4, 6, 4, 6])
  })

  it('plans 17 bars in 34 seconds (1020 frames) at the chosen track, 120 bpm with the first beat at 0 (D17)', () => {
    const plan = planPromo('he', TRACK)
    expect(plan.bars).toBe(17)
    expect(plan.totalFrames).toBe(1020)
    expect(plan.fadeOutFrame).toBe(1020 - Math.round(MUSIC_FADE_OUT_SECONDS * FPS))
  })

  it('plans 17 bars in 33.44 seconds (1003 frames) at 122 bpm with the first beat at 0 (the first track, D14)', () => {
    const plan = planPromo('he', { bpm: 122, firstBeat: 0 })
    expect(plan.bars).toBe(17)
    expect(plan.totalFrames).toBe(1003)
    expect(plan.totalFrames / FPS).toBeCloseTo(33.44, 1)
    expect(plan.fadeOutFrame).toBe(1003 - Math.round(MUSIC_FADE_OUT_SECONDS * FPS))
  })

  it.each(TEMPOS)('gives every caption of every language its reading time at %o', (tempo) => {
    for (const lang of LANGUAGES) {
      const plan = planPromo(lang, tempo)
      for (const [index, scene] of plan.scenes.entries()) {
        // Computed from the tempo and the bars, not from the plan's own frames.
        const first = SCENES.slice(0, index).reduce((sum, s) => sum + s.bars, 0) * BEATS_PER_BAR
        const seconds = (beatFrame(first + SCENES[index].bars * BEATS_PER_BAR, tempo) - beatFrame(first, tempo)) / FPS
        expect(seconds, `${lang}/${scene.id}`).toBeGreaterThanOrEqual(readingSeconds(SCRIPTS[lang][scene.id]))
      }
    }
  })

  it.each(TEMPOS)('starts and ends every scene on a bar, brings every phrase in on a beat before the middle, and ends on a bar at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const barsBefore = SCENES.map((_, index) => SCENES.slice(0, index).reduce((sum, scene) => sum + scene.bars, 0))
    plan.scenes.forEach((scene, index) => {
      if (index > 0) expect(isBarFrame(scene.startFrame, tempo), `${scene.id} start`).toBe(true)
      else expect(scene.startFrame).toBe(0)
      expect(isBarFrame(scene.endFrame, tempo), `${scene.id} end`).toBe(true)
      if (index > 0) expect(scene.startFrame).toBe(plan.scenes[index - 1].endFrame)
      const middle = (scene.startFrame + scene.endFrame) / 2
      scene.phrases.forEach((phrase, n) => {
        expect(isBeatFrame(phrase.frame, tempo), `${scene.id} phrase ${n}`).toBe(true)
        expect(phrase.frame, `${scene.id} phrase ${n}`).toBeLessThan(middle)
        if (n > 0) expect(phrase.frame).toBeGreaterThan(scene.phrases[n - 1].frame)
      })
      expect(scene.phrases[0].frame).toBe(beatFrame(barsBefore[index] * BEATS_PER_BAR, tempo))
    })
    expect(plan.totalFrames).toBe(plan.scenes[plan.scenes.length - 1].endFrame)
    expect(plan.totalFrames).toBe(beatFrame(17 * BEATS_PER_BAR, tempo))
    expect(plan.fadeOutFrame).toBeLessThan(plan.totalFrames)
  })

  it('makes the video exactly whole bars long when the first beat is 0', () => {
    for (const bpm of [100, 120, 122, 132]) {
      const plan = planPromo('he', { bpm, firstBeat: 0 })
      expect(plan.totalFrames).toBe(Math.round(((17 * BEATS_PER_BAR * 60) / bpm) * FPS))
    }
  })

  it.each(TEMPOS)('keeps every cut at least two beats from the next, so there are never three in one second at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const cuts = plan.scenes.flatMap((scene, index) => [index > 0 ? scene.startFrame : null, scene.thenFrame ?? null]).filter((frame) => frame !== null)
    expect(cuts.length).toBe(6 + 2)
    const minGap = beatFrame(MIN_CUT_BEATS, { ...tempo, firstBeat: 0 }) - 1
    for (let i = 1; i < cuts.length; i += 1) expect(cuts[i] - cuts[i - 1], `cut ${i}`).toBeGreaterThanOrEqual(minGap)
    // Any window of one second holds at most two cuts.
    for (const start of cuts) expect(cuts.filter((frame) => frame >= start && frame < start + FPS).length).toBeLessThanOrEqual(2)
  })

  it('cuts to the second picture of a scene on a beat, after its phrases are in', () => {
    for (const tempo of TEMPOS) {
      const plan = planPromo('he', tempo)
      for (const scene of plan.scenes.filter((planned) => planned.then)) {
        expect(isBeatFrame(scene.thenFrame, tempo), scene.id).toBe(true)
        expect(scene.thenFrame, scene.id).toBeGreaterThan(scene.startFrame)
        expect(scene.thenFrame, scene.id).toBeLessThan(scene.endFrame)
        expect(scene.thenFrame, scene.id).toBeGreaterThanOrEqual(scene.phrases[scene.phrases.length - 1].frame)
      }
    }
  })

  it('carries each scene id, picture and phrases through', () => {
    const plan = planPromo('he')
    expect(plan.scenes.map(({ id, picture }) => ({ id, picture }))).toEqual(SCENES.map(({ id, picture }) => ({ id, picture })))
    expect(plan.scenes[1].phrases.map((phrase) => phrase.text)).toEqual(['ספקים באים והולכים.', 'ומי רושם?'])
    expect(plan.scenes[1].phrases.map((phrase) => phrase.frame - plan.scenes[1].startFrame)).toEqual([0, 15])
  })

  it('refuses, naming the scene, a caption that is too long for its scene at 200 bpm', () => {
    expect(() => planPromo('he', { bpm: MAX_BPM, firstBeat: 0 })).toThrow(/scene "offline"/)
  })

  it('refuses a tempo outside 60 to 200 bpm and accepts the edges', () => {
    expect(() => planPromo('he', { bpm: MIN_BPM - 1, firstBeat: 0 })).toThrow(/59 bpm/)
    expect(() => planPromo('he', { bpm: MAX_BPM + 1, firstBeat: 0 })).toThrow(/201 bpm/)
    expect(() => planPromo('he', { bpm: Number.NaN, firstBeat: 0 })).toThrow(/bpm/)
    expect(() => planPromo('he', { bpm: MIN_BPM, firstBeat: 0 })).not.toThrow()
    // 200 bpm cannot read the longest caption, which is the reading rule and not the tempo rule.
    expect(() => planPromo('he', { bpm: MAX_BPM, firstBeat: 0 })).toThrow(/needs/)
  })

  it('refuses a first beat that is negative or later than one bar, and accepts a first beat of exactly one bar', () => {
    expect(() => planPromo('he', { bpm: 120, firstBeat: -0.1 })).toThrow(/first beat/)
    expect(() => planPromo('he', { bpm: 120, firstBeat: 2.01 })).toThrow(/first beat/)
    expect(() => planPromo('he', { bpm: 120, firstBeat: Number.NaN })).toThrow(/first beat/)
    expect(() => planPromo('he', { bpm: 120, firstBeat: 2 })).not.toThrow()
    expect(() => planPromo('he', { bpm: 120, firstBeat: 0 })).not.toThrow()
  })

  it('refuses a language that has no script', () => {
    expect(() => planPromo('xx')).toThrow(/"xx"/)
  })
})

describe('what the render stages (video/promo/stage.js)', () => {
  it('stages each picture of docs/screenshots/ that the scenes name once, and none of the drawn ones', () => {
    expect(stagedPictures()).toEqual(['provider-phone-check-in.png', 'provider-phone-saved-offline.png', 'committee-phone-home.png', 'committee-phone-history.png'])
    for (const file of stagedPictures()) expect(fs.existsSync(SCREENSHOTS + file), file).toBe(true)
    for (const drawn of DRAWN_PICTURES) expect(stagedPictures()).not.toContain(drawn)
    expect(stagedPictures([{ picture: 'a.png', then: 'b.png' }, { picture: 'a.png' }, { picture: 'text' }])).toEqual(['a.png', 'b.png'])
  })

  it('makes the QR code of the closing card byte for byte from the repository address (no phone scan was done)', async () => {
    expect(REPOSITORY_QR.text).toBe(REPOSITORY_URL)
    const svg = await repositoryQrSvg()
    expect(svg).toBe(await QRCode.toString(REPOSITORY_URL, REPOSITORY_QR_OPTIONS))
    expect(svg).toMatch(/<svg /)
    // The quiet zone is the standard four modules, so that the code reads off a screen; the demo code of the camera scene is another code.
    expect(REPOSITORY_QR_OPTIONS.margin).toBe(4)
    expect(svg).not.toBe(await demoQrSvg())
  })

  it('draws a sign with no words and a place for the code inside it', () => {
    const svg = signSvg()
    expect(svg).toMatch(/^<svg /)
    expect(svg).not.toMatch(/<text/)
    expect(svg).toMatch(/^[\x20-\x7e]+$/) // plain ASCII: no word of any language
    expect(SIGN.qr.x + SIGN.qr.w).toBeLessThanOrEqual(SIGN.width)
    expect(SIGN.qr.y + SIGN.qr.h).toBeLessThanOrEqual(SIGN.height)
  })
})

describe('the music (video/promo/music.js)', () => {
  /** A throwaway "repository" and a folder outside it, with fake files: nothing real is read or written. */
  let root
  let outside
  const touch = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x')
    return file
  }
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-root-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-outside-'))
  })
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('refuses a file that does not exist, naming the file and not its folder', () => {
    expect(() => checkMusicPath(path.join(outside, 'missing.mp3'), root)).toThrow(/"missing\.mp3" does not exist/)
    expect(() => checkMusicPath('', root)).toThrow(/not given/)
    expect(() => checkMusicPath(outside, root)).toThrow(/does not exist/) // a folder is not a track
  })

  it('refuses an extension other than .mp3, .wav or .m4a', () => {
    expect(() => checkMusicPath(touch(path.join(outside, 'track.flac')), root)).toThrow(/\.flac/)
    expect(() => checkMusicPath(touch(path.join(outside, 'track')), root)).toThrow(/the render takes/)
    for (const name of ['a.mp3', 'b.WAV', 'c.m4a']) expect(checkMusicPath(touch(path.join(outside, name)), root)).toBe(path.join(outside, name))
  })

  it('refuses a path inside the repository anywhere but under video/out/, so the track cannot be committed by accident', () => {
    for (const where of ['video/src/track.mp3', 'video/promo/track.mp3', 'video/track.mp3', 'docs/track.mp3', 'track.mp3', 'video/outer/track.mp3', '..drafts/track.mp3']) {
      expect(() => checkMusicPath(touch(path.join(root, where)), root), where).toThrow(/inside the repository/)
    }
  })

  it('accepts a file under video/out/ (ignored by git) and one outside the repository', () => {
    const ignored = touch(path.join(root, 'video', 'out', 'track.mp3'))
    expect(checkMusicPath(ignored, root)).toBe(ignored)
    const elsewhere = touch(path.join(outside, 'track.mp3'))
    expect(checkMusicPath(elsewhere, root)).toBe(elsewhere)
  })

  it('does not let a path with .. back out of video/out/ into the repository', () => {
    touch(path.join(root, 'video', 'src', 'sneaky.mp3'))
    expect(() => checkMusicPath(path.join(root, 'video', 'out', '..', 'src', 'sneaky.mp3'), root)).toThrow(/inside the repository/)
  })

  it('stages the track under a fixed name that keeps its extension', () => {
    expect(stagedMusicFile('C:/anywhere/Minimal House (final).MP3')).toBe('music.mp3')
    expect(stagedMusicFile('a.m4a')).toBe('music.m4a')
  })

  it('refuses a start that is negative or leaves less of the file than the video, and accepts one that fits', () => {
    expect(() => checkMusicStart(-0.1, 78.733, 33.44)).toThrow(/not a second of the file/)
    expect(() => checkMusicStart(Number.NaN, 78.733, 33.44)).toThrow(/not a second/)
    expect(() => checkMusicStart(50, 78.733, 33.44)).toThrow(/end before the video/)
    expect(() => checkMusicStart(8.132, Number.NaN, 33.44)).toThrow(/end before the video/)
    expect(() => checkMusicStart(0, 78.733, 33.44)).not.toThrow()
    expect(() => checkMusicStart(8.132, 78.733, 1003 / FPS)).not.toThrow()
    expect(() => checkMusicStart(45, 78.44, 33.44)).not.toThrow()
  })

  it('passes the start to the audio as a frame: 8.132 s is frame 244 at 30 fps', () => {
    expect(startFrameOf(0)).toBe(0)
    expect(startFrameOf(8.132)).toBe(244)
  })

  describe.each([DEFAULT_TEMPO, TRACK])('volumeAt at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const last = plan.totalFrames - 1

    it('is silent at the first frame and at the last, and full in the middle', () => {
      expect(volumeAt(0, plan)).toBe(0)
      expect(volumeAt(last, plan)).toBe(0)
      expect(volumeAt(Math.floor(plan.totalFrames / 2), plan)).toBe(1)
    })

    it('rises over the fade in, stays full, then falls over the last 1.5 seconds, always between 0 and 1', () => {
      const fadeInFrames = Math.round(MUSIC_FADE_IN_SECONDS * FPS)
      expect(volumeAt(fadeInFrames, plan)).toBe(1)
      expect(volumeAt(plan.fadeOutFrame, plan)).toBe(1)
      expect(plan.totalFrames - plan.fadeOutFrame).toBe(Math.round(MUSIC_FADE_OUT_SECONDS * FPS))
      for (let frame = 1; frame <= fadeInFrames; frame += 1) expect(volumeAt(frame, plan)).toBeGreaterThan(volumeAt(frame - 1, plan))
      for (let frame = plan.fadeOutFrame + 1; frame <= last; frame += 1) expect(volumeAt(frame, plan)).toBeLessThan(volumeAt(frame - 1, plan))
      for (let frame = 0; frame < plan.totalFrames; frame += 1) {
        expect(volumeAt(frame, plan)).toBeGreaterThanOrEqual(0)
        expect(volumeAt(frame, plan)).toBeLessThanOrEqual(1)
      }
    })

    it('ends on a bar: the video is 17 whole bars long, so the fade ends where the next bar would begin', () => {
      expect(plan.totalFrames).toBe(beatFrame(17 * BEATS_PER_BAR, tempo))
    })
  })
})

/** The colour a share `amount` of white lays over `color`: what the pulse does to the ground at its first frame. */
const brightened = (color, amount) =>
  `#${[1, 3, 5].map((at) => Math.round(parseInt(color.slice(at, at + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0')).join('')}`

describe('the keywords (W1)', () => {
  it('has one keyword per caption, one or two whole consecutive words of it', () => {
    for (const lang of LANGUAGES) {
      expect(Object.keys(KEYWORDS[lang]).sort()).toEqual(SCENES.map((scene) => scene.id).sort())
      for (const [id, keyword] of Object.entries(KEYWORDS[lang])) {
        const range = keywordRange(SCRIPTS[lang][id], keyword)
        expect(range, `${lang}/${id}: "${keyword}" in "${SCRIPTS[lang][id]}"`).not.toBeNull()
        expect(range.count).toBe(wordsOf(keyword))
        expect(range.count).toBeLessThanOrEqual(2)
      }
    }
  })

  it('finds whole words only, and refuses a part of a word, a gap, an empty keyword and three words', () => {
    expect(keywordRange('a b c d', 'b c')).toEqual({ start: 1, count: 2 })
    expect(keywordRange('a b c d', 'a')).toEqual({ start: 0, count: 1 })
    expect(keywordRange('aa bb', 'a')).toBeNull()
    expect(keywordRange('a b c d', 'a c')).toBeNull()
    expect(keywordRange('a b c d', 'b c d')).toBeNull()
    expect(keywordRange('a b', '')).toBeNull()
    expect(keywordRange('a b', undefined)).toBeNull()
  })

  it('draws the keyword in a colour with AA contrast (4.5:1) on every background it sits on, the brightest pulse included', () => {
    // The lightest point of the violet ground of the text scenes at the first frame of a pulse; the dark caption bar; the closing card with its pulse.
    const lightest = brightened(COLORS.groundFrom, PULSE.text)
    expect(contrastRatio(KEYWORD_COLOR, lightest)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(COLORS.cardText, lightest)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(KEYWORD_COLOR, COLORS.barBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(KEYWORD_COLOR, brightened(COLORS.card, PULSE.ground))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(COLORS.cardText, brightened(COLORS.card, PULSE.ground))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the effects are placed on the beats of the plan (D16)', () => {
  it.each(TEMPOS)('lands every word of a phrase inside its own beat, two words on the beat and the half beat, at %o', (tempo) => {
    const beat = beatFrames(tempo)
    const plan = planPromo('he', tempo)
    for (const scene of plan.scenes) {
      const middle = (scene.startFrame + scene.endFrame) / 2
      for (const phrase of scene.phrases) {
        const words = wordsOf(phrase.text)
        const frames = wordFrames(phrase.frame, words, tempo)
        expect(frames, `${scene.id} ${phrase.text}`).toHaveLength(words)
        expect(frames[0]).toBe(phrase.frame)
        frames.forEach((frame, n) => {
          if (n > 0) expect(frame).toBeGreaterThan(frames[n - 1])
          expect(frame).toBeLessThan(phrase.frame + beat)
          expect(frame, `${scene.id} ${phrase.text}`).toBeLessThan(middle)
        })
        if (words === 2) expect(Math.abs(frames[1] - frames[0] - beat / 2)).toBeLessThanOrEqual(1)
      }
    }
  })

  it.each(TEMPOS)('puts the whip, the punch and the burst on bar lines, and the ding on a beat, at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const groove = plan.scenes.find((scene) => scene.id === GROOVE_SCENE)
    expect(isBarFrame(groove.startFrame, tempo)).toBe(true)
    expect(isBarFrame(burstFrame(plan, tempo), tempo)).toBe(true)
    expect(burstFrame(plan, tempo)).toBe(beatFrame((plan.bars - 1) * BEATS_PER_BAR, tempo))
    expect(burstFrame(plan, tempo)).toBeGreaterThanOrEqual(plan.scenes[plan.scenes.length - 1].startFrame)
    for (const scene of plan.scenes.slice(1)) {
      expect(isBarFrame(scene.startFrame, tempo), scene.id).toBe(true) // the whip ends on this frame
      expect(scene.startFrame - WHIP_FRAMES, scene.id).toBeGreaterThanOrEqual(0)
    }
    expect(isBeatFrame(groove.thenFrame, tempo)).toBe(true)
  })

  it('at the chosen track, punches on frame 240 (8.0 s), bursts on frame 960 and whips between scenes in 8 frames', () => {
    const plan = planPromo('he', TRACK)
    expect(plan.scenes.find((scene) => scene.id === GROOVE_SCENE).startFrame).toBe(240)
    expect(burstFrame(plan, TRACK)).toBe(960)
    expect(WHIP_FRAMES).toBe(8)
  })

  it.each(TEMPOS)('still gives every caption its reading time when the whip takes the last 8 frames of its scene and its last word lands a beat late, at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    for (const scene of plan.scenes) {
      const last = scene.phrases[scene.phrases.length - 1]
      const lastWord = wordFrames(last.frame, wordsOf(last.text), tempo).at(-1)
      const out = scene.endFrame - (scene === plan.scenes.at(-1) ? 0 : WHIP_FRAMES) // the last scene has no whip out
      expect(lastWord, scene.id).toBeLessThan(out)
      const caption = scene.phrases.map((phrase) => phrase.text).join(' ')
      expect((out - scene.phrases[0].frame) / FPS, `${scene.id} from its first word until it slides out`).toBeGreaterThanOrEqual(readingSeconds(caption))
    }
  })

  it('brings the whole mix down by at least 2 dB (the track alone peaks at +0.2 dBFS), so that it peaks under -1 dBFS', () => {
    expect(MIX_GAIN).toBeGreaterThan(0.5) // the track stays the music of the video
    expect(20 * Math.log10(MIX_GAIN)).toBeLessThanOrEqual(-2)
  })

  it.each(TEMPOS)('keeps every whip shorter than the two beats between cuts, at %o', (tempo) => {
    expect(WHIP_FRAMES).toBeLessThan(MIN_CUT_BEATS * beatFrames(tempo))
  })

  it.each(TEMPOS)('pulses once a bar: 1 on the bar line, falling to 0 a beat later, and never three brightness jumps in one second at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const beat = beatFrames(tempo)
    const bars = Array.from({ length: plan.bars }, (_, bar) => beatFrame(bar * BEATS_PER_BAR, tempo))
    for (const frame of bars) {
      if (frame === 0 && tempo.firstBeat > 0) continue // a lead-in before the first bar line
      expect(pulseAt(frame, tempo), `bar at ${frame}`).toBe(1)
      for (let since = 1; since <= beat; since += 1) expect(pulseAt(frame + since, tempo)).toBeLessThan(pulseAt(frame + since - 1, tempo) + 1e-12)
      expect(pulseAt(frame + beat, tempo)).toBe(0)
    }
    for (let frame = 0; frame < plan.totalFrames; frame += 1) {
      expect(pulseAt(frame, tempo)).toBeGreaterThanOrEqual(0)
      expect(pulseAt(frame, tempo)).toBeLessThanOrEqual(1)
    }
    // A jump is the first frame of a pulse (the punch starts on a bar line too), so these are all the jumps there are.
    for (const start of bars) expect(bars.filter((frame) => frame >= start && frame < start + FPS).length).toBeLessThanOrEqual(2)
  })

  it('has no pulse before the first bar line when the first beat is late, and finds the bar of a frame', () => {
    expect(barPhase(0, { bpm: 120, firstBeat: 0.5 })).toBeNull()
    expect(pulseAt(0, { bpm: 120, firstBeat: 0.5 })).toBe(0)
    expect(barPhase(15, { bpm: 120, firstBeat: 0.5 })).toEqual({ bar: 0, since: 0 })
    expect(barPhase(75, TRACK)).toEqual({ bar: 1, since: 15 })
  })

  it('punches on the first beat of the groove and fades over two beats', () => {
    expect(punchAt(240, 240, TRACK)).toBe(1)
    expect(punchAt(239, 240, TRACK)).toBe(0)
    expect(punchAt(240 + 30, 240, TRACK)).toBe(0)
    for (let frame = 241; frame < 270; frame += 1) expect(punchAt(frame, 240, TRACK)).toBeLessThan(punchAt(frame - 1, 240, TRACK))
    expect(PULSE.punchGround).toBeGreaterThan(PULSE.ground)
    expect(PULSE.phone).toBe(0.02)
  })

  it.each(TEMPOS)('plans a whoosh before every scene, the impact on the groove and the ding at the check-in screen, none in the fade out, at %o', (tempo) => {
    const plan = planPromo('he', tempo)
    const groove = plan.scenes.find((scene) => scene.id === GROOVE_SCENE)
    const cues = soundCues(plan)
    expect(cues.filter((cue) => cue.kind === 'whoosh').map((cue) => cue.hit)).toEqual(plan.scenes.slice(1).map((scene) => scene.startFrame))
    expect(cues.filter((cue) => cue.kind === 'impact').map((cue) => cue.hit)).toEqual([groove.startFrame])
    expect(cues.filter((cue) => cue.kind === 'ding').map((cue) => cue.hit)).toEqual([groove.thenFrame])
    for (const cue of cues) {
      expect(isBeatFrame(cue.hit, tempo), `${cue.kind} at ${cue.hit}`).toBe(true)
      expect(cue.frame).toBeGreaterThanOrEqual(0)
      expect(cue.frame + cue.frames, `${cue.kind} at ${cue.hit} plays into the fade out`).toBeLessThanOrEqual(plan.fadeOutFrame)
      expect(cue.frames / FPS).toBeGreaterThanOrEqual(SOUNDS[cue.kind].seconds)
      expect(cue.volume).toBeLessThan(1)
    }
    for (const cue of cues.filter((c) => c.kind === 'whoosh')) expect(cue.hit - cue.frame).toBe(WHIP_FRAMES)
  })
})

describe('the sounds of the effects (video/promo/make-sounds.mjs)', () => {
  const sounds = makeSounds()

  it('makes the same bytes every time, from a fixed seed', () => {
    const again = makeSounds()
    for (const kind of Object.keys(SOUNDS)) expect(again[kind].equals(sounds[kind]), kind).toBe(true)
    expect(sounds.whoosh.equals(sounds.impact)).toBe(false)
  })

  it.each(Object.keys(SOUNDS))('makes %s a 16-bit mono WAV of the planned length, under full scale and ending in silence', (kind) => {
    const wav = sounds[kind]
    const samples = Math.round(RATE * SOUNDS[kind].seconds)
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
    expect(wav.toString('latin1', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(RATE)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(samples * 2)
    expect(wav.length).toBe(44 + samples * 2)
    let top = 0
    for (let at = 44; at < wav.length; at += 2) top = Math.max(top, Math.abs(wav.readInt16LE(at)))
    expect(top).toBeLessThanOrEqual(Math.round(PEAK * 32767))
    expect(top).toBeGreaterThan(0.7 * PEAK * 32767)
    expect(wav.readInt16LE(wav.length - 2)).toBe(0)
  })
})
