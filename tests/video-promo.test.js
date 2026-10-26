// The script and the timing of the promo video (video/promo/script, video/promo/timing.js, pure): every caption gets its reading time, every
// cut falls on a beat, the video ends on a bar, and a tempo or a caption that cannot work is refused with the scene's name. The render
// itself (a browser, the music) is not run here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { DRAWN_PICTURES, LANGUAGES, REPOSITORY_URL, SCENES, SCRIPTS } from '../video/promo/script/index.js'
import {
  BEATS_PER_BAR,
  DEFAULT_TEMPO,
  FPS,
  HEIGHT,
  MAX_BPM,
  MIN_BPM,
  MIN_CUT_BEATS,
  MUSIC_FADE_OUT_SECONDS,
  WIDTH,
  beatFrame,
  phrasesOf,
  planPromo,
  readingSeconds,
  wordsOf,
} from '../video/promo/timing.js'
import { REPOSITORY_QR, REPOSITORY_QR_OPTIONS, SIGN, demoQrSvg, repositoryQrSvg, signSvg, stagedPictures } from '../video/promo/stage.js'

const SCREENSHOTS = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
const TRACK = { bpm: 122, firstBeat: 0 }
// Tempos that the video may be planned at: the default, the chosen track (decision D14), and a first beat that is late in the bar.
const TEMPOS = [DEFAULT_TEMPO, TRACK, { bpm: 122, firstBeat: 0.265 }, { bpm: 100, firstBeat: 0 }, { bpm: 132, firstBeat: 0 }]

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

  it('plans 17 bars in 33.44 seconds (1003 frames) at the chosen track, 122 bpm with the first beat at 0 (D14)', () => {
    const plan = planPromo('he', TRACK)
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
