// The script and the timing of the promo video (video/promo/script, video/promo/timing.js, pure): every caption gets its reading time, every
// cut falls on a beat, the video ends on a bar, and a tempo or a caption that cannot work is refused with the scene's name. The render
// itself (a browser, the music) is not run here.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { PEAK, RATE, makeSounds } from '../video/promo/make-sounds.mjs'
import { MUSIC_FADE_IN_SECONDS, checkMusicNotCleared, checkMusicPath, checkMusicStart, stagedMusicFile, startFrameOf, volumeAt } from '../video/promo/music.js'
import {
  BOXES,
  DRAWN_PICTURES,
  KEYWORDS,
  KEYWORD_COLOR,
  LANGUAGES,
  LONG,
  LONG_LABELS,
  PROMO_PICTURES,
  REPOSITORY_URL,
  SCENES,
  SCRIPTS,
  SHORT,
  STAGES,
  STRIP_STAGES,
  agentChat,
} from '../video/promo/script/index.js'
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
  grooveFrame,
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

// The short promo is frozen (decision D7, the owner: "do not touch the current version"): its plan and its sound cues, frame by frame, as
// they were before the long promo existed. A change here is a change to the approved video; it is never a fix for a failing test.
const sortedKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortedKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key])]))
      : value
const fingerprintOf = (value) => crypto.createHash('sha256').update(JSON.stringify(sortedKeys(value))).digest('hex').slice(0, 16)

describe('the short promo is frozen (D7)', () => {
  it('plans exactly the same frames at 120 bpm', () => {
    expect(planPromo('he', TRACK)).toEqual({
      scenes: [
        { id: 'question', picture: 'text', startFrame: 0, endFrame: 120, phrases: [{ text: 'מי היה היום בבניין?', frame: 0 }] },
        {
          id: 'providers',
          picture: 'text',
          startFrame: 120,
          endFrame: 240,
          phrases: [
            { text: 'ספקים באים והולכים.', frame: 120 },
            { text: 'ומי רושם?', frame: 135 },
          ],
        },
        {
          id: 'scan',
          picture: 'camera',
          startFrame: 240,
          endFrame: 420,
          phrases: [
            { text: 'סורקים את השלט עם המצלמה.', frame: 240 },
            { text: 'בלי להוריד אפליקציה.', frame: 255 },
          ],
          then: 'provider-phone-check-in.png',
          thenFrame: 330,
        },
        {
          id: 'offline',
          picture: 'provider-phone-saved-offline.png',
          startFrame: 420,
          endFrame: 540,
          phrases: [
            { text: 'גם בלי קליטה:', frame: 420 },
            { text: 'הנוכחות נשמרת ונשלחת כשהקליטה חוזרת.', frame: 435 },
          ],
        },
        {
          id: 'committee',
          picture: 'committee-phone-home.png',
          startFrame: 540,
          endFrame: 720,
          phrases: [
            { text: 'הוועד רואה מי הגיע,', frame: 540 },
            { text: 'מתי ולאיזו נקודה.', frame: 555 },
          ],
          then: 'committee-phone-history.png',
          thenFrame: 630,
        },
        {
          id: 'open',
          picture: 'text',
          startFrame: 720,
          endFrame: 840,
          phrases: [
            { text: 'קוד פתוח.', frame: 720 },
            { text: 'עותק משלכם,', frame: 735 },
            { text: 'והנתונים בחשבונות שלכם.', frame: 750 },
          ],
        },
        { id: 'closing', picture: 'closing', startFrame: 840, endFrame: 1020, phrases: [{ text: 'תעבירו למישהו טכני בבניין.', frame: 840 }] },
      ],
      totalFrames: 1020,
      fadeOutFrame: 975,
      bars: 17,
    })
  })

  it('plays exactly the same sounds at 120 bpm, and bursts on the same frame', () => {
    const whoosh = (hit) => ({ kind: 'whoosh', file: 'whoosh.wav', frame: hit - 8, hit, frames: 15, volume: 0.5 })
    expect(soundCues(planPromo('he', TRACK))).toEqual([
      whoosh(120),
      whoosh(240),
      { kind: 'impact', file: 'impact.wav', frame: 240, hit: 240, frames: 33, volume: 0.35 },
      { kind: 'ding', file: 'ding.wav', frame: 330, hit: 330, frames: 24, volume: 0.35 },
      whoosh(420),
      whoosh(540),
      whoosh(720),
      whoosh(840),
    ])
    expect(burstFrame(planPromo('he', TRACK), TRACK)).toBe(960)
    expect(GROOVE_SCENE).toBe('scan')
  })

  it.each([
    [{ bpm: 100, firstBeat: 0 }, '303a2e9f94817609', '8a98ee7a651c70d1'],
    [{ bpm: 120, firstBeat: 0 }, '5920d1df8896dab6', 'e6f9efb80fac27c2'],
    [{ bpm: 122, firstBeat: 0 }, '2f9b8777d80b1b75', '78efc752721d7840'],
    [{ bpm: 122, firstBeat: 0.265 }, '4e602019439d3698', '3c549ef52a426f05'],
    [{ bpm: 132, firstBeat: 0 }, '6c1d3c8d0dbb5018', 'a7fd44439397ca18'],
  ])('plans and sounds the same at %o (fingerprints of the plan and of the cues)', (tempo, planPrint, cuesPrint) => {
    const plan = planPromo('he', tempo)
    expect(fingerprintOf(plan)).toBe(planPrint)
    expect(fingerprintOf(soundCues(plan))).toBe(cuesPrint)
  })

  it('keeps the scenes, the captions and the keywords of the short script as they were', () => {
    expect(SCENES.map((scene) => ({ ...scene }))).toEqual([
      { id: 'question', bars: 2, picture: 'text' },
      { id: 'providers', bars: 2, picture: 'text' },
      { id: 'scan', bars: 3, picture: 'camera', then: 'provider-phone-check-in.png' },
      { id: 'offline', bars: 2, picture: 'provider-phone-saved-offline.png' },
      { id: 'committee', bars: 3, picture: 'committee-phone-home.png', then: 'committee-phone-history.png' },
      { id: 'open', bars: 2, picture: 'text' },
      { id: 'closing', bars: 3, picture: 'closing' },
    ])
    expect(KEYWORDS.he).toEqual({ question: 'מי', providers: 'רושם?', scan: 'סורקים', offline: 'בלי קליטה:', committee: 'רואה', open: 'קוד פתוח.', closing: 'טכני' })
    expect(DRAWN_PICTURES).toEqual(expect.arrayContaining(['camera', 'text', 'closing']))
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

describe('the long promo script (video/promo/script/long.js, he-long.js)', () => {
  const ids = LONG.scenes.map((scene) => scene.id)
  const captions = LONG.scripts.he
  const barsBefore = (index) => LONG.scenes.slice(0, index).reduce((sum, scene) => sum + scene.bars, 0)
  /** The picture on screen `beat` beats into a scene. */
  const pictureAt = (scene, beat) => {
    let picture = scene.picture
    if (scene.then && beat >= (scene.thenBeat ?? scene.bars * 2)) picture = scene.then
    for (const later of scene.later ?? []) if (beat >= later.beat) picture = later.picture
    return picture
  }

  it('has the 28 scenes of the recommended script in 68 bars, each with a caption and a keyword', () => {
    expect(ids).toHaveLength(28)
    expect(new Set(ids).size).toBe(28)
    expect(LONG.scenes.reduce((sum, scene) => sum + scene.bars, 0)).toBe(68)
    expect(LONG.scenes.map((scene) => scene.bars)).toEqual([2, 3, 3, 2, 3, 2, 2, 2, 2, 3, 4, 3, 2, 2, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 3])
    expect(Object.keys(captions).sort()).toEqual([...ids].sort())
    expect(Object.keys(LONG.keywords.he).sort()).toEqual([...ids].sort())
  })

  it('keeps the first bar of each part of the story where the plan puts it: the groove on bar 5, the quiet break on the offline scene, the AI on bar 58', () => {
    const startBar = (id) => barsBefore(ids.indexOf(id)) + 1
    expect(startBar('pays')).toBe(1)
    expect(startBar('points')).toBe(9) // the committee prepares
    expect(startBar('signin')).toBe(18) // the providers scan
    expect(startBar('offline')).toBe(25) // the quiet break of the track is bars 25 and 26 (decision D4)
    expect(startBar('week')).toBe(38) // the committee sees
    expect(startBar('agent')).toBe(58)
    expect(startBar('open')).toBe(62) // what it takes
    expect(startBar('closing')).toBe(66)
  })

  it('marks every scene with a stage, in order, and labels the four stages of the progress strip', () => {
    for (const scene of LONG.scenes) expect(STAGES, scene.id).toContain(scene.stage)
    const order = LONG.scenes.map((scene) => STAGES.indexOf(scene.stage))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(STRIP_STAGES).toEqual(['prepare', 'scan', 'see', 'need'])
    for (const stage of STRIP_STAGES) expect(LONG.scenes.some((scene) => scene.stage === stage), stage).toBe(true)
    expect(Object.keys(LONG_LABELS.stages)).toEqual([...STRIP_STAGES])
    expect(LONG_LABELS.stages).toEqual({ prepare: 'הוועד מכין', scan: 'נותני השירות סורקים', see: 'הוועד רואה', need: 'מה צריך' })
  })

  it('names every picture by a recorded screen of the list that the recorder shares, or a drawn one', () => {
    expect(new Set(PROMO_PICTURES).size).toBe(PROMO_PICTURES.length)
    for (const name of PROMO_PICTURES) expect(name).toMatch(/^[a-z0-9-]+\.png$/)
    const used = new Set()
    for (const scene of LONG.scenes) {
      const pictures = [scene.picture, scene.then, ...(scene.later ?? []).map((later) => later.picture), scene.inset?.picture].filter(Boolean)
      for (const picture of pictures) {
        expect(PROMO_PICTURES.includes(picture) || DRAWN_PICTURES.includes(picture), `${scene.id}: ${picture}`).toBe(true)
        used.add(picture)
      }
    }
    // The recorder is asked for nothing that no scene shows.
    for (const name of PROMO_PICTURES) expect(used.has(name), name).toBe(true)
    for (const drawn of DRAWN_PICTURES) expect(PROMO_PICTURES).not.toContain(drawn)
  })

  it('zooms and rings only a box that the picture on screen is asked to have, and every box is used', () => {
    expect(Object.keys(BOXES).every((name) => PROMO_PICTURES.includes(name))).toBe(true)
    const used = new Set()
    for (const scene of LONG.scenes) {
      for (const kind of ['zoom', 'ring']) {
        for (const { box, beat } of scene[kind] ?? []) {
          const picture = pictureAt(scene, beat)
          expect(BOXES[picture], `${scene.id} ${kind} "${box}" on ${picture}`).toContain(box)
          used.add(`${picture} ${box}`)
        }
      }
    }
    const listed = Object.entries(BOXES).flatMap(([picture, boxes]) => boxes.map((box) => `${picture} ${box}`))
    expect([...used].sort()).toEqual(listed.sort())
  })

  it('writes the captions as plain text: no vowel points, no long dash, at most 11 words, and the fixed terms', () => {
    for (const [id, caption] of Object.entries(captions)) {
      expect(caption, id).toBe(caption.trim())
      expect(caption, id).not.toMatch(/[֑-ׇֽֿׁׂׅׄ]/)
      expect(caption, id).not.toMatch(/[‒-―]/)
      expect(wordsOf(caption), id).toBeLessThanOrEqual(11)
      expect(phrasesOf(caption).join(' '), id).toBe(caption)
    }
    const all = Object.values(captions).join(' ')
    expect(all).not.toMatch(/ספק|חינם|אי אפשר לרמות|שעות עבודה|בזמן אמת|ה-AI שלנו|מוודא|מאמת|אימות/)
    expect(all).toMatch(/נותן שירות/)
  })

  it('has one keyword per caption, one or two whole consecutive words of it', () => {
    for (const [id, keyword] of Object.entries(LONG.keywords.he)) {
      const range = keywordRange(captions[id], keyword)
      expect(range, `${id}: "${keyword}" in "${captions[id]}"`).not.toBeNull()
      expect(range.count).toBe(wordsOf(keyword))
    }
  })

  it('draws the AI chat from a question and an answer template whose places are the ones the composition fills', () => {
    expect(agentChat.question).toMatch(/^לפי ההסכם הניקיון מגיע 5 פעמים בשבוע/)
    const places = [...agentChat.answer.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
    expect(places.sort()).toEqual([...agentChat.placeholders].sort())
    expect(agentChat.answer.replace(/\{\w+\}/g, '')).not.toMatch(/\d{2,}/) // no number is written here: the sample's own numbers fill the places
    expect(LONG_LABELS.illustration).toBe('המחשה, נתוני דוגמה')
    expect(LONG_LABELS.guide).toBe('המדריך באנגלית')
    for (const text of [agentChat.question, agentChat.answer, ...Object.values(LONG_LABELS.stages)]) expect(text).not.toMatch(/[‒-―]/)
  })
})

describe('planPromo with the long script', () => {
  const plan = planPromo('he', TRACK, LONG)

  it('plans 68 bars in 136 seconds at 120 bpm: 4080 frames, 60 frames a bar, ending on a bar', () => {
    expect(plan.bars).toBe(68)
    expect(plan.totalFrames).toBe(4080)
    expect(plan.totalFrames).toBe(68 * 60)
    expect(plan.totalFrames).toBe(beatFrame(68 * BEATS_PER_BAR, TRACK))
    expect(plan.fadeOutFrame).toBe(4080 - Math.round(MUSIC_FADE_OUT_SECONDS * FPS))
    expect(plan.scenes).toHaveLength(28)
    expect(plan.scenes[0].startFrame).toBe(0)
    plan.scenes.forEach((scene, index) => {
      expect(scene.startFrame, scene.id).toBe(LONG.scenes.slice(0, index).reduce((sum, one) => sum + one.bars, 0) * 60)
      if (index > 0) expect(scene.startFrame).toBe(plan.scenes[index - 1].endFrame)
    })
  })

  it('leaves the short promo to the default: no script given is the short script', () => {
    expect(planPromo('he', TRACK)).toEqual(planPromo('he', TRACK, SHORT))
    expect(soundCues(planPromo('he', TRACK))).toEqual(soundCues(planPromo('he', TRACK), SHORT))
  })

  it.each([TRACK, { bpm: 100, firstBeat: 0 }, { bpm: 90, firstBeat: 0 }, { bpm: MIN_BPM, firstBeat: 0 }])(
    'gives every caption its reading time from its first phrase to the start of its whip, with fewer phrases than half its beats, at %o',
    (tempo) => {
      const planned = planPromo('he', tempo, LONG)
      planned.scenes.forEach((scene, index) => {
        const caption = LONG.scripts.he[scene.id]
        const out = scene.endFrame - (index < planned.scenes.length - 1 ? WHIP_FRAMES : 0)
        expect((out - scene.phrases[0].frame) / FPS, `${scene.id} at ${tempo.bpm} bpm`).toBeGreaterThanOrEqual(readingSeconds(caption))
        expect(scene.phrases.length, scene.id).toBeLessThan(((LONG.scenes[index].bars * BEATS_PER_BAR) / 2))
        scene.phrases.forEach((phrase, n) => {
          expect(isBeatFrame(phrase.frame, tempo), `${scene.id} phrase ${n}`).toBe(true)
          expect(phrase.frame).toBeLessThan((scene.startFrame + scene.endFrame) / 2)
        })
        const last = scene.phrases.at(-1)
        expect(wordFrames(last.frame, wordsOf(last.text), tempo).at(-1), scene.id).toBeLessThan(out)
      })
    },
  )

  it('starts and ends every scene on a bar, and keeps every cut at least two beats from the last, with at most two in any second', () => {
    const cuts = plan.scenes.flatMap((scene, index) => [
      index > 0 ? scene.startFrame : null,
      scene.thenFrame ?? null,
      ...(scene.later ?? []).map((later) => later.frame),
    ]).filter((frame) => frame !== null)
    for (const scene of plan.scenes) {
      expect(isBarFrame(scene.startFrame, TRACK), scene.id).toBe(true)
      expect(isBarFrame(scene.endFrame, TRACK), scene.id).toBe(true)
    }
    expect(cuts).toEqual([...cuts].sort((a, b) => a - b))
    for (let i = 1; i < cuts.length; i += 1) expect(cuts[i] - cuts[i - 1], `cut ${i}`).toBeGreaterThanOrEqual(2 * beatFrames(TRACK))
    for (const start of cuts) expect(cuts.filter((frame) => frame >= start && frame < start + FPS).length).toBeLessThanOrEqual(2)
    for (const cut of cuts) expect(isBeatFrame(cut, TRACK)).toBe(true)
  })

  it('carries the stage, the pictures, the zooms and the rings through as frames on beats, inside their scenes', () => {
    plan.scenes.forEach((scene, index) => {
      const source = LONG.scenes[index]
      expect({ id: scene.id, picture: scene.picture, stage: scene.stage }, scene.id).toEqual({ id: source.id, picture: source.picture, stage: source.stage })
      expect(scene.then, scene.id).toBe(source.then)
      const frames = [scene.thenFrame, ...(scene.later ?? []).map((later) => later.frame), ...(scene.zoom ?? []).map((move) => move.frame), ...(scene.ring ?? []).map((move) => move.frame), scene.inset?.frame].filter((frame) => frame != null)
      for (const frame of frames) {
        expect(isBeatFrame(frame, TRACK), scene.id).toBe(true)
        expect(frame, scene.id).toBeGreaterThanOrEqual(scene.startFrame)
        expect(frame, scene.id).toBeLessThan(scene.endFrame)
      }
      if (scene.later) expect(scene.later.map((later) => later.picture)).toEqual(source.later.map((later) => later.picture))
      if (scene.thenFrame != null) expect(scene.thenFrame, scene.id).toBeGreaterThanOrEqual(scene.phrases.at(-1).frame)
    })
    // The four languages swap on every second beat of their scene.
    const languages = plan.scenes.find((scene) => scene.id === 'languages')
    expect([languages.thenFrame, ...languages.later.map((later) => later.frame)].map((frame) => frame - languages.startFrame)).toEqual([30, 60, 90])
    expect([languages.picture, languages.then, ...languages.later.map((later) => later.picture)]).toEqual(['provider-home.png', 'provider-lang-en.png', 'provider-lang-ru.png', 'provider-lang-ar.png'])
  })

  it('puts the groove on bar 5 with the check mark, the quiet break on the offline scene and the visit sent on bar 27', () => {
    const sign = plan.scenes.find((scene) => scene.id === 'sign')
    expect(sign.then).toBe('camera-checked')
    expect(sign.thenFrame).toBe(4 * 60) // bar 5
    expect(grooveFrame(plan, LONG)).toBe(240)
    const offline = plan.scenes.find((scene) => scene.id === 'offline')
    expect(offline.startFrame).toBe(24 * 60) // bar 25: the quiet break begins (decision D4)
    expect(offline.endFrame).toBe(28 * 60) // bar 28 is the last bar of the scene
    expect(offline.thenFrame).toBe(26 * 60) // bar 27: the groove is back and the visit is sent
    expect([offline.picture, offline.then]).toEqual(['provider-queued.png', 'provider-sent.png'])
    // The impact of the short promo is on its own scene, as it was.
    expect(grooveFrame(planPromo('he', TRACK))).toBe(240)
  })

  it('plans a whoosh before every scene, the impact on bar 5, the ding when the recorded screen appears, none in the fade out', () => {
    const cues = soundCues(plan, LONG)
    expect(cues.filter((cue) => cue.kind === 'whoosh').map((cue) => cue.hit)).toEqual(plan.scenes.slice(1).map((scene) => scene.startFrame))
    expect(cues.filter((cue) => cue.kind === 'impact').map((cue) => cue.hit)).toEqual([240])
    expect(cues.filter((cue) => cue.kind === 'ding').map((cue) => cue.hit)).toEqual([plan.scenes.find((scene) => scene.id === 'recorded').startFrame])
    expect(plan.scenes.find((scene) => scene.id === 'recorded').picture).toBe('provider-recorded.png')
    for (const cue of cues) {
      expect(isBeatFrame(cue.hit, TRACK), `${cue.kind} at ${cue.hit}`).toBe(true)
      expect(cue.frame).toBeGreaterThanOrEqual(0)
      expect(cue.frame + cue.frames, `${cue.kind} at ${cue.hit} plays into the fade out`).toBeLessThanOrEqual(plan.fadeOutFrame)
    }
    expect(burstFrame(plan, TRACK)).toBe(67 * 60)
  })

  it('refuses, naming the scene, a picture or a move that falls outside its scene or out of order', () => {
    const base = { id: 'x', bars: 2, stage: 'opening', picture: 'text' }
    const script = (scene) => ({ ...SHORT, scenes: [scene], scripts: { he: { x: 'מילה אחת' } }, sounds: [] })
    expect(() => planPromo('he', TRACK, script(base))).not.toThrow()
    expect(() => planPromo('he', TRACK, script({ ...base, then: 'a.png', thenBeat: 8 }))).toThrow(/scene "x"/)
    expect(() => planPromo('he', TRACK, script({ ...base, then: 'a.png', thenBeat: 0 }))).toThrow(/scene "x"/)
    expect(() => planPromo('he', TRACK, script({ ...base, thenBeat: 4 }))).toThrow(/no second picture/)
    expect(() => planPromo('he', TRACK, script({ ...base, then: 'a.png', thenBeat: 4, later: [{ picture: 'b.png', beat: 4 }] }))).toThrow(/not after/)
    expect(() => planPromo('he', TRACK, script({ ...base, then: 'a.png', thenBeat: 2, later: [{ picture: 'b.png', beat: 3 }] }))).toThrow(/less than 2 beats/)
    expect(() => planPromo('he', TRACK, script({ ...base, zoom: [{ box: 'a', beat: 8 }] }))).toThrow(/scene "x"/)
    expect(() => planPromo('he', TRACK, script({ ...base, ring: [{ box: 'a', beat: 3 }, { box: 'b', beat: 3 }] }))).toThrow(/not after/)
    expect(() => planPromo('he', TRACK, script({ ...base, zoom: [{ box: 'a', beat: 0 }], ring: [{ box: 'a', beat: 7 }], inset: { picture: 'c.png', beat: 7 } }))).not.toThrow()
    // A sound on a second picture that the scene does not have.
    expect(() => soundCues(planPromo('he', TRACK, script(base)), { ...SHORT, sounds: [{ kind: 'ding', scene: 'x', at: 'then' }] })).toThrow(/second picture/)
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

  it('refuses a track inside a folder or a file that the render clears or overwrites, naming it, and accepts the rest of video/out/ and anywhere outside the repository', () => {
    const out = path.join(root, 'video', 'out')
    const cleared = [path.join(out, 'promo', 'stills'), path.join(out, '.public-promo-he'), path.join(out, '.bundle-promo-he'), path.join(out, 'promo', 'promo-he.mp4'), path.join(out, 'promo', 'promo-he.jpg')]
    for (const [where, name] of [
      [path.join(out, 'promo', 'stills', 'track.mp3'), 'stills'],
      [path.join(out, 'promo', 'stills', 'nested', 'track.mp3'), 'stills'],
      [path.join(out, '.public-promo-he', 'track.mp3'), '.public-promo-he'],
      [path.join(out, '.bundle-promo-he', 'deep', 'track.mp3'), '.bundle-promo-he'],
    ]) {
      const track = touch(where)
      expect(checkMusicPath(track, root)).toBe(track) // video/out/ passes the first check
      expect(() => checkMusicNotCleared(track, cleared), where).toThrow(`inside "${name}"`)
    }
    // A track that is one of the files the render writes (its extension is the render's own, so it is the function that must refuse it).
    expect(() => checkMusicNotCleared(touch(path.join(out, 'promo', 'promo-he.mp4')), cleared)).toThrow('inside "promo-he.mp4"')
    // The folders need not exist yet, and a spelling with .. does not hide the track.
    expect(() => checkMusicNotCleared(path.join(out, 'promo', 'stills', '..', 'stills', 'track.mp3'), cleared)).toThrow(/stills/)
    expect(() => checkMusicNotCleared(touch(path.join(out, 'track.mp3')), cleared)).not.toThrow()
    expect(() => checkMusicNotCleared(touch(path.join(out, 'promo', 'track.mp3')), cleared)).not.toThrow()
    expect(() => checkMusicNotCleared(touch(path.join(out, 'promo', 'stills-other', 'track.mp3')), cleared)).not.toThrow() // a folder that only starts with the same letters
    expect(() => checkMusicNotCleared(touch(path.join(outside, 'track.mp3')), cleared)).not.toThrow()
    expect(() => checkMusicNotCleared(touch(path.join(outside, 'track2.mp3')), [path.join(root, 'nothing-here')])).not.toThrow()
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

  it('refuses, naming the scene, a tempo at which a caption is readable only while its scene slides out, such as 150 bpm for the offline caption', () => {
    expect(() => planPromo('he', { bpm: 150, firstBeat: 0 })).toThrow(/scene "offline".*before it slides out/)
    expect(() => planPromo('he', TRACK)).not.toThrow() // the chosen track
    expect(planPromo('he', TRACK).totalFrames).toBe(1020)
  })

  it('gives every caption its reading time before its whip at every tempo the plan accepts, up to the highest', () => {
    const accepted = []
    for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 1) {
      try {
        planPromo('he', { bpm, firstBeat: 0 })
        accepted.push(bpm)
      } catch (error) {
        expect(error.message, `${bpm} bpm`).toMatch(/needs .* to be read/)
      }
    }
    expect(accepted).toContain(120)
    expect(accepted).not.toContain(150)
    expect(accepted.at(-1)).toBeLessThan(150)
    for (const bpm of [accepted.at(-1), 120, MIN_BPM]) {
      const tempo = { bpm, firstBeat: 0 }
      const plan = planPromo('he', tempo)
      plan.scenes.forEach((scene, index) => {
        const out = scene.endFrame - (index < plan.scenes.length - 1 ? WHIP_FRAMES : 0)
        const caption = scene.phrases.map((phrase) => phrase.text).join(' ')
        expect((out - scene.phrases[0].frame) / FPS, `${scene.id} at ${bpm} bpm`).toBeGreaterThanOrEqual(readingSeconds(caption))
      })
    }
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
