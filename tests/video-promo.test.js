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
  SHEET_BOXES,
  WIDE_ZOOMS,
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
import { LENSES, SPARE } from '../video/promo/script/long.js'
import { LENS, dimAt, liftEase, liftProgress, lensAt, lensRect, lensesOf } from '../video/promo/parts/magnifier.jsx'
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
  screenOf,
  soundCues,
  wordFrames,
  wordsOf,
} from '../video/promo/timing.js'
import { COLORS } from '../video/src/theme.js'
import { contrastRatio } from '../video/src/timing.js'
import { REPOSITORY_QR, REPOSITORY_QR_OPTIONS, SIGN, agentAnswer, checkFrames, demoQrSvg, repositoryQrSvg, signSvg, stagedPictures } from '../video/promo/stage.js'
import {
  BAR_HEIGHT,
  DRIFT,
  EDGE,
  LAPTOP,
  LAPTOP_OUTLINE,
  LIFE,
  LONG_PHONE,
  MAX_PUSH,
  PHONE,
  PICTURE_AREA,
  STRIP_HEIGHT,
  blendViews,
  cameraTransform,
  driftView,
  laptopRest,
  lifeScale,
  liveView,
  moveViews,
  phoneRest,
  pushLimit,
  pushView,
  restView,
  sceneView,
  spanRect,
  stripOpacity,
  stripStates,
  viewInArea,
} from '../video/promo/parts/moves.js'
import {
  BEZELS,
  OVER_FRAME,
  bezelOf,
  cameraOf,
  continuityOf,
  drawnPictures,
  inDevice,
  pictureAt,
  pictureEnd,
  pictureTimeline,
  ringsOf,
  stageOf,
} from '../video/promo/parts/screens.js'
import { SHOWCASE, planShowcase, showcaseStills, walkingStage } from '../video/promo/parts/showcase.js'

const RENDER = fs.readFileSync(fileURLToPath(new URL('../video/promo/render.mjs', import.meta.url)), 'utf8')
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

  it("names every picture by a recorded screen of the recorder's list (E8), never a file of docs/screenshots/, and the others by the fixed list", () => {
    const recorded = []
    for (const scene of SCENES) {
      for (const picture of [scene.picture, scene.then].filter(Boolean)) {
        if (DRAWN_PICTURES.includes(picture)) continue
        expect(PROMO_PICTURES, `${scene.id}: ${picture}`).toContain(picture)
        recorded.push(picture)
      }
    }
    expect(recorded).toEqual(['provider-recorded.png', 'provider-queued.png', 'committee-home.png', 'committee-history.png'])
    // The render copies every picture from the recorder's folder, and names no other folder of pictures.
    expect(RENDER).toContain('for (const file of pictures) cpSync(path.join(framesDir, file), path.join(publicDir, file))')
    expect(RENDER).not.toMatch(/'screenshots'|docs\/screenshots\/'|screenshotsDir/)
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
          then: 'provider-recorded.png',
          thenFrame: 330,
        },
        {
          id: 'offline',
          picture: 'provider-queued.png',
          startFrame: 420,
          endFrame: 540,
          phrases: [
            { text: 'גם בלי קליטה:', frame: 420 },
            { text: 'הנוכחות נשמרת ונשלחת כשהקליטה חוזרת.', frame: 435 },
          ],
        },
        {
          id: 'committee',
          picture: 'committee-home.png',
          startFrame: 540,
          endFrame: 720,
          phrases: [
            { text: 'הוועד רואה מי הגיע,', frame: 540 },
            { text: 'מתי ולאיזו נקודה.', frame: 555 },
          ],
          then: 'committee-history.png',
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

  // The plan's prints changed once, with the names of its four pictures (E8, the recorder's instead of the README's): with the old names
  // put back, each plan gives the print it had before (the third column, the prints of 27/10/2026), and the cues' prints did not change.
  const README_NAMES = { 'provider-recorded.png': 'provider-phone-check-in.png', 'provider-queued.png': 'provider-phone-saved-offline.png', 'committee-home.png': 'committee-phone-home.png', 'committee-history.png': 'committee-phone-history.png' }
  const withReadmeNames = (plan) => JSON.parse(JSON.stringify(plan, (key, value) => (typeof value === 'string' && Object.hasOwn(README_NAMES, value) ? README_NAMES[value] : value)))
  it.each([
    [{ bpm: 100, firstBeat: 0 }, '3e6ca2ecebbfdf41', '303a2e9f94817609', '8a98ee7a651c70d1'],
    [{ bpm: 120, firstBeat: 0 }, '7e5699818d6d8749', '5920d1df8896dab6', 'e6f9efb80fac27c2'],
    [{ bpm: 122, firstBeat: 0 }, 'b948a9ecb57af9bf', '2f9b8777d80b1b75', '78efc752721d7840'],
    [{ bpm: 122, firstBeat: 0.265 }, '115682110df76fd5', '4e602019439d3698', '3c549ef52a426f05'],
    [{ bpm: 132, firstBeat: 0 }, '5758cc950714d7f7', '6c1d3c8d0dbb5018', 'a7fd44439397ca18'],
  ])('plans and sounds the same at %o (fingerprints of the plan, of the plan with the old names, and of the cues)', (tempo, planPrint, oldPrint, cuesPrint) => {
    const plan = planPromo('he', tempo)
    expect(fingerprintOf(plan)).toBe(planPrint)
    expect(fingerprintOf(withReadmeNames(plan))).toBe(oldPrint)
    expect(fingerprintOf(soundCues(plan))).toBe(cuesPrint)
  })

  it('keeps the scenes, the captions and the keywords of the short script as they were', () => {
    expect(SCENES.map((scene) => ({ ...scene }))).toEqual([
      { id: 'question', bars: 2, picture: 'text' },
      { id: 'providers', bars: 2, picture: 'text' },
      { id: 'scan', bars: 3, picture: 'camera', then: 'provider-recorded.png' },
      { id: 'offline', bars: 2, picture: 'provider-queued.png' },
      { id: 'committee', bars: 3, picture: 'committee-home.png', then: 'committee-history.png' },
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

  it("has the 21 scenes of the story editor's table and the privacy notice behind its title card, in 58 bars, each with a caption and a keyword (E3, E7)", () => {
    expect(ids).toEqual(['question', 'pays', 'sign', 'sees', 'points', 'access', 'notice', 'signin', 'far', 'recorded', 'offline', 'today', 'counts', 'visit', 'late', 'refused', 'filters', 'cancel', 'agent', 'open', 'install', 'closing'])
    expect(new Set(ids).size).toBe(22)
    expect(LONG.scenes.reduce((sum, scene) => sum + scene.bars, 0)).toBe(58)
    expect(LONG.scenes.map((scene) => scene.bars)).toEqual([2, 2, 2, 3, 3, 3, 2, 2, 3, 3, 4, 3, 3, 2, 2, 2, 3, 3, 4, 2, 2, 3])
    expect(Object.keys(captions).sort()).toEqual([...ids].sort())
    expect(Object.keys(LONG.keywords.he).sort()).toEqual([...ids].sort())
  })

  it("opens on the short cut's question alone for two bars, so that frame 0 (the poster and the thumbnail) is the same clean card", () => {
    expect(LONG.scenes[0]).toEqual({ id: 'question', bars: 2, stage: 'opening', picture: 'text' })
    expect(captions.question).toBe(SHORT.scripts.he.question)
    expect(LONG.keywords.he.question).toBe(SHORT.keywords.he.question)
  })

  it('keeps the first bar of each part of the story where the plan puts it: the groove on bar 6, the quiet break on the offline scene, the AI on bar 48', () => {
    const startBar = (id) => barsBefore(ids.indexOf(id)) + 1
    expect(startBar('question')).toBe(1) // the title card
    expect(startBar('pays')).toBe(3)
    expect(startBar('sign')).toBe(5) // one bar of the camera, then the check mark on bar 6
    expect(startBar('sees')).toBe(7)
    expect(startBar('points')).toBe(10) // the committee prepares
    expect(startBar('notice')).toBe(16) // the providers scan, from the privacy notice above the list (E7)
    expect(startBar('signin')).toBe(18)
    expect(startBar('offline')).toBe(26) // the quiet break of the track is bars 26 and 27 (decision D4, E3), the track started on its bar 1
    expect(startBar('counts')).toBe(33) // the committee sees
    expect(startBar('agent')).toBe(48)
    expect(startBar('open')).toBe(52) // what it takes
    expect(startBar('closing')).toBe(56)
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
    // The recorder is asked for nothing that no scene shows, but what the edit of E3 left out and the recorder still takes (SPARE).
    for (const name of PROMO_PICTURES) expect(used.has(name) !== SPARE.pictures.includes(name), name).toBe(true)
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
    // The boxes of a picture drawn over the whole frame (the printed sign) are read by the composition, not by a zoom or a ring.
    for (const [picture, boxes] of Object.entries(SHEET_BOXES)) {
      expect(LONG.scenes.some((scene) => scene.then === picture || scene.picture === picture || scene.later?.some((later) => later.picture === picture)), picture).toBe(true)
      for (const box of boxes) used.add(`${picture} ${box}`)
    }
    expect(SHEET_BOXES['committee-print-sign.png']).toEqual(['sign', 'qr'])
    // Every box is used, but the ones of SPARE: what the edit of E3 left out and the recorder still takes.
    const spare = Object.entries(SPARE.boxes).flatMap(([picture, boxes]) => boxes.map((box) => `${picture} ${box}`))
    const listed = Object.entries(BOXES).flatMap(([picture, boxes]) => boxes.map((box) => `${picture} ${box}`))
    expect([...used].sort()).toEqual(listed.filter((one) => !spare.includes(one)).sort())
    for (const one of spare) expect(listed, one).toContain(one)
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
    // The answer counts days, reads right for a provider of either gender, and never puts a parenthesis after the name (which has the company in its own).
    expect(agentChat.answer).toMatch(/נרשמו ביקורים של \{provider\} ב-\{days\} ימים מתוך 5/)
    expect(agentChat.answer).not.toMatch(/\{provider\}\s*\(/)
    expect(LONG_LABELS.illustration).toBe('המחשה, נתוני דוגמה')
    expect(LONG_LABELS.guide).toBe('המדריך באנגלית')
    for (const text of [agentChat.question, agentChat.answer, ...Object.values(LONG_LABELS.stages)]) expect(text).not.toMatch(/[‒-―]/)
  })
})

describe('planPromo with the long script', () => {
  const plan = planPromo('he', TRACK, LONG)

  it('plans 58 bars in 116 seconds at 120 bpm: 3480 frames, 60 frames a bar, ending on a bar (E3, E7)', () => {
    expect(plan.bars).toBe(58)
    expect(plan.totalFrames).toBe(3480)
    expect(plan.totalFrames).toBe(58 * 60)
    expect(plan.totalFrames).toBe(beatFrame(58 * BEATS_PER_BAR, TRACK))
    expect(plan.fadeOutFrame).toBe(3480 - Math.round(MUSIC_FADE_OUT_SECONDS * FPS))
    expect(plan.scenes).toHaveLength(22)
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
    // The four languages swap on every second beat of the scene, once the caption has named them all.
    const today = plan.scenes.find((scene) => scene.id === 'today')
    expect([today.thenFrame, ...today.later.map((later) => later.frame)].map((frame) => frame - today.startFrame)).toEqual([60, 90, 120])
    expect([today.picture, today.then, ...today.later.map((later) => later.picture)]).toEqual(['provider-home.png', 'provider-lang-en.png', 'provider-lang-ru.png', 'provider-lang-ar.png'])
  })

  it('puts the groove on bar 6 with the check mark, the quiet break on the offline scene and the visit sent on bar 28', () => {
    const sign = plan.scenes.find((scene) => scene.id === 'sign')
    expect(sign.then).toBe('camera-checked')
    expect(sign.thenFrame).toBe(5 * 60) // bar 6
    expect(sign.thenFrame - sign.startFrame).toBe(60) // the camera has one bar before the check mark
    expect(grooveFrame(plan, LONG)).toBe(300)
    const offline = plan.scenes.find((scene) => scene.id === 'offline')
    expect(offline.startFrame).toBe(25 * 60) // bar 26: the quiet break begins (decision D4)
    expect(offline.endFrame).toBe(29 * 60) // bar 29 is the last bar of the scene
    expect(offline.thenFrame).toBe(27 * 60) // bar 28: the groove is back and the visit is sent
    expect([offline.picture, offline.then]).toEqual(['provider-queued.png', 'provider-sent.png'])
    // The impact of the short promo is on its own scene, as it was.
    expect(grooveFrame(planPromo('he', TRACK))).toBe(240)
  })

  it('plans a whoosh before every scene but the one that continues, the impact on bar 6, the ding when the recorded screen appears, none in the fade out', () => {
    const cues = soundCues(plan, LONG)
    expect(cues.filter((cue) => cue.kind === 'whoosh').map((cue) => cue.hit)).toEqual(plan.scenes.slice(1).filter((scene) => !scene.continues).map((scene) => scene.startFrame))
    expect(plan.scenes.filter((scene) => scene.continues).map((scene) => scene.id)).toEqual(['signin', 'late'])
    expect(cues.filter((cue) => cue.kind === 'impact').map((cue) => cue.hit)).toEqual([300])
    expect(cues.filter((cue) => cue.kind === 'ding').map((cue) => cue.hit)).toEqual([plan.scenes.find((scene) => scene.id === 'recorded').startFrame])
    expect(plan.scenes.find((scene) => scene.id === 'recorded').picture).toBe('provider-recorded.png')
    for (const cue of cues) {
      expect(isBeatFrame(cue.hit, TRACK), `${cue.kind} at ${cue.hit}`).toBe(true)
      expect(cue.frame).toBeGreaterThanOrEqual(0)
      expect(cue.frame + cue.frames, `${cue.kind} at ${cue.hit} plays into the fade out`).toBeLessThanOrEqual(plan.fadeOutFrame)
    }
    expect(burstFrame(plan, TRACK)).toBe(57 * 60)
  })

  it('never cuts from a recorded screen to the same screen without `continues` (E3): a whip only where the screen, the app or the place changes', () => {
    const last = (scene) => scene.later?.at(-1)?.picture ?? scene.then ?? scene.picture
    LONG.scenes.slice(1).forEach((scene, n) => {
      const before = LONG.scenes[n]
      if (screenOf(scene.picture) && last(before) === scene.picture) expect(scene.continues, `${before.id} to ${scene.id}`).toBe(true)
    })
    // The visit and the basement visit are a pair that the edit joins: two scenes of one screen.
    expect(LONG.scenes.find((scene) => scene.id === 'visit').picture).toBe(LONG.scenes.find((scene) => scene.id === 'late').picture)
    // The privacy notice and the sign-in are the other (E7): the notice ends on its sheet over the list, and the sign-in continues on the list.
    const [notice, signin] = ['notice', 'signin'].map((id) => LONG.scenes.find((scene) => scene.id === id))
    expect([notice.picture, notice.then, signin.picture]).toEqual(['provider-list.png', 'provider-privacy-sheet.png', 'provider-list.png'])
    expect(signin.continues).toBe(true)
  })

  it('is readable up to 124 bpm and refuses 125 bpm naming the first scene of nine words in two bars', () => {
    expect(() => planPromo('he', { bpm: 124, firstBeat: 0 }, LONG)).not.toThrow()
    expect(() => planPromo('he', { bpm: 125, firstBeat: 0 }, LONG)).toThrow(/scene "pays".*before it slides out/)
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
    // A plan and the sounds of another script (a long plan passed without its script) are refused, not played as silence.
    expect(() => soundCues(plan)).toThrow(/pass the script that made the plan/)
    expect(() => soundCues(planPromo('he', TRACK), LONG)).toThrow(/scene "sign"/)
    expect(() => grooveFrame(plan)).toThrow(/pass the script/)
    // A sound on a second picture that the scene does not have.
    expect(() => soundCues(planPromo('he', TRACK, script(base)), { ...SHORT, sounds: [{ kind: 'ding', scene: 'x', at: 'then' }] })).toThrow(/second picture/)
  })

  it('knows the app and the device of a recorded screen by its name, and none for a drawn picture', () => {
    expect(screenOf('provider-home.png')).toEqual({ app: 'provider', device: 'phone' })
    expect(screenOf('committee-home.png')).toEqual({ app: 'committee', device: 'phone' })
    expect(screenOf('computer-history.png')).toEqual({ app: 'committee', device: 'computer' })
    for (const drawn of DRAWN_PICTURES) expect(screenOf(drawn), drawn).toBeNull()
    for (const name of PROMO_PICTURES) expect(screenOf(name), name).not.toBeNull()
  })

  it('carries `continues` into the plan without a whoosh, and refuses it on the first scene and after another app or device', () => {
    // The edit joins two boundaries: the sign-in continues the privacy notice on the provider's list (E7), and the visit at 08:24 the one at
    // 08:06, on the same screen of the committee's app (E3).
    expect(LONG.scenes.filter((one) => one.continues).map((one) => one.id)).toEqual(['signin', 'late'])
    expect(plan.scenes.filter((one) => 'continues' in one).map((one) => one.id)).toEqual(['signin', 'late'])
    const joined = (ids) => ({ ...LONG, scenes: LONG.scenes.map((one) => (ids.includes(one.id) ? { ...one, continues: true } : one)) })
    const plain = (scenes) => scenes.map((one) => Object.fromEntries(Object.entries(one).filter(([key]) => key !== 'continues')))
    // The same app on the same device: the provider's too-far screen after the password typed, the provider's home after the sent
    // visit, the history after the home, and the refused scan after the history.
    const ok = planPromo('he', TRACK, joined(['far', 'today', 'visit', 'refused']))
    const continuing = ok.scenes.filter((one) => one.continues).map((one) => one.id)
    expect(continuing).toEqual(['signin', 'far', 'today', 'visit', 'late', 'refused'])
    // Everything else about the plan is the same, the reading time included.
    expect(plain(ok.scenes)).toEqual(plain(plan.scenes))
    const whooshes = soundCues(ok, LONG).filter((cue) => cue.kind === 'whoosh').map((cue) => cue.hit)
    expect(whooshes).toEqual(ok.scenes.slice(1).filter((one) => !one.continues).map((one) => one.startFrame))
    // Refused: the first scene, a phone after the laptop, the provider's app after the committee's, after a text or the camera.
    expect(() => planPromo('he', TRACK, joined(['question']))).toThrow(/scene "question" continues the scene before it, and it is the first/i)
    expect(() => planPromo('he', TRACK, joined(['cancel']))).toThrow(/scene "cancel".*"computer-history.png".*same app on the same device/i)
    expect(() => planPromo('he', TRACK, joined(['filters']))).toThrow(/scene "filters".*"committee-history-refused.png"/i)
    expect(() => planPromo('he', TRACK, joined(['notice']))).toThrow(/scene "notice".*"committee-providers-password.png"/i)
    expect(() => planPromo('he', TRACK, joined(['pays']))).toThrow(/scene "pays".*"text"/i)
    expect(() => planPromo('he', TRACK, joined(['sees']))).toThrow(/scene "sees".*"camera-checked"/i)
  })
})

describe('what the render stages (video/promo/stage.js)', () => {
  it("stages each recorded picture that the short cut's scenes name once, from the recorder's list (E8), and none of the drawn ones", () => {
    expect(stagedPictures()).toEqual(['provider-recorded.png', 'provider-queued.png', 'committee-home.png', 'committee-history.png'])
    for (const file of stagedPictures()) expect(PROMO_PICTURES, file).toContain(file)
    for (const drawn of DRAWN_PICTURES) expect(stagedPictures()).not.toContain(drawn)
    expect(stagedPictures([{ picture: 'a.png', then: 'b.png' }, { picture: 'a.png' }, { picture: 'text' }])).toEqual(['a.png', 'b.png'])
  })

  it('stages the later pictures and the picture in picture too: every recorded picture of the long cut, and none of the drawn ones', () => {
    expect(stagedPictures([{ picture: 'a.png', then: 'b.png', later: [{ picture: 'c.png' }, { picture: 'a.png' }], inset: { picture: 'd.png' } }, { picture: 'agent', inset: { picture: 'e.png' } }])).toEqual([
      'a.png',
      'b.png',
      'c.png',
      'd.png',
      'e.png',
    ])
    expect([...stagedPictures(LONG.scenes)].sort()).toEqual(PROMO_PICTURES.filter((name) => !SPARE.pictures.includes(name)).sort())
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

describe("the check of the recorder's frames.json (video/promo/stage.js, checkFrames)", () => {
  /** A frames.json with every picture and box the long cut needs, all of them invented numbers. */
  const sample = () => ({
    day: '2026-01-04',
    pictures: Object.fromEntries(
      PROMO_PICTURES.map((name) => {
        const keys = BOXES[name] ?? []
        const rects = (rect) => Object.fromEntries(keys.map((key) => [key, { ...rect }]))
        return [name, { width: 780, height: 1688, scale: 2, boxes: rects({ x: 40, y: 500, width: 700, height: 200 }), zooms: rects({ x: 0, y: 0, width: 780, height: 1387 }) }]
      }),
    ),
  })
  const RECORD = /npm run promo:frames/

  it('returns a frames.json that has every picture of PROMO_PICTURES and every box of BOXES', () => {
    const frames = sample()
    expect(checkFrames(JSON.stringify(frames))).toEqual(frames)
  })

  it('refuses, naming the picture, the box and npm run promo:frames, a file that lacks one or is not JSON', () => {
    const without = (change) => {
      const frames = sample()
      change(frames)
      return () => checkFrames(JSON.stringify(frames))
    }
    expect(() => checkFrames('{')).toThrow(RECORD)
    expect(() => checkFrames('null')).toThrow(RECORD)
    expect(without((frames) => delete frames.pictures['committee-agent.png'])).toThrow(/"committee-agent\.png".*npm run promo:frames/)
    expect(without((frames) => delete frames.pictures['committee-home.png'].width)).toThrow(/"committee-home\.png"/)
    expect(without((frames) => delete frames.pictures['committee-home.png'].boxes['empty-day'])).toThrow(/box "empty-day" inside the picture "committee-home\.png".*npm run promo:frames/)
    expect(without((frames) => delete frames.pictures['provider-list.png'].zooms.privacy)).toThrow(/zoom "privacy" inside the picture "provider-list\.png"/)
    expect(without((frames) => (frames.pictures['computer-history.png'].zooms.excel.height = 2000))).toThrow(/zoom "excel"/)
    expect(without((frames) => (frames.pictures['computer-history.png'].boxes.filters.width = 0))).toThrow(/box "filters"/)
    expect(without((frames) => (frames.pictures['committee-home.png'].width = '780'))).toThrow(/"committee-home\.png" with its size/)
    // A zoom that is not the frame's 9:16 would show far more than its rectangle.
    expect(without((frames) => (frames.pictures['committee-home.png'].zooms['provider-row'].height = 600))).toThrow(/zoom "provider-row"/)
    // A composition that shows only some pictures checks only those.
    expect(without((frames) => delete frames.pictures['computer-history.png'])).toThrow(/computer-history/)
    const some = sample()
    delete some.pictures['computer-history.png']
    expect(() => checkFrames(JSON.stringify(some), { pictures: ['committee-home.png'] })).not.toThrow()
  })
})

describe('the camera of the zoom and the progress strip (video/promo/parts/moves.js)', () => {
  const picture = { width: 780, height: 1688 }
  const rest = { x: 212.25, y: 57, scale: 0.84 }
  const close = (a, b) => {
    for (const key of Object.keys(b)) expect(a[key], key).toBeCloseTo(b[key], 6)
  }

  it('leaves the drawing as it is at rest', () => {
    close(cameraTransform(restView(rest), rest), { scale: 1, x: 0, y: 0 })
    // The area is the frame between the progress strip and the caption bar.
    expect(PICTURE_AREA).toEqual({ top: STRIP_HEIGHT, width: WIDTH, height: HEIGHT - BAR_HEIGHT - STRIP_HEIGHT })
  })

  // The long cut's phone at rest, and where a point of the picture (in its pixels) is on screen in a view.
  const phone = phoneRest(picture, LONG_PHONE)
  const phoneWidth = PHONE.width * LONG_PHONE.scale
  const limit = pushLimit(phoneWidth)
  const onScreen = (view, at, area = PICTURE_AREA) => {
    const { scale, x, y } = cameraTransform(view, at, area)
    return { x: (px) => x + scale * (at.x + at.scale * px), y: (py) => y + scale * (at.y + at.scale * py), push: scale }
  }
  /** The view at its most alive: drifted all the way toward its anchor, on the peak of a pulse. */
  const mostAlive = (view, anchor) => {
    const drifted = driftView(view, anchor, 1)
    return { ...drifted, scale: drifted.scale * (1 + PULSE.phone) }
  }

  it('pushes the device in to MAX_PUSH at the most, its life included, centred across the frame with both side edges in it (E2)', () => {
    expect(MAX_PUSH).toBe(1.5)
    expect(DRIFT).toBe(0.03)
    expect(LIFE).toBeCloseTo(1.03 * 1.02, 12)
    expect(limit).toBe(MAX_PUSH) // the long cut's phone, 665 px wide at rest, could go further: the cap is the decision
    const rect = { x: 213, y: 850, width: 390, height: 693 }
    const box = { x: 396, y: 1185, width: 24, height: 24 }
    const view = pushView(rect, box, picture, phone, limit)
    expect(view.scale / phone.scale).toBeCloseTo(MAX_PUSH / LIFE, 9)
    expect(view.cx).toBeCloseTo(picture.width / 2, 9) // centred across, as at rest
    for (const shown of [view, mostAlive(view, box.y + box.height / 2)]) {
      const at = onScreen(shown, phone)
      expect(at.push).toBeLessThanOrEqual(MAX_PUSH + 1e-9)
      // The bezel's outer edges, at rest 14 units of the phone (LAYOUT.bezel) outside the screen on each side.
      const left = at.x(0) - at.push * 14 * LONG_PHONE.scale
      const right = at.x(picture.width) + at.push * 14 * LONG_PHONE.scale
      expect(left).toBeGreaterThanOrEqual(EDGE - 1e-9)
      expect(right).toBeLessThanOrEqual(WIDTH - EDGE + 1e-9)
      expect((left + right) / 2).toBeCloseTo(WIDTH / 2, 6)
      // The element is in the picture area.
      expect(at.y(box.y)).toBeGreaterThanOrEqual(STRIP_HEIGHT - 1e-9)
      expect(at.y(box.y + box.height)).toBeLessThanOrEqual(HEIGHT - BAR_HEIGHT + 1e-9)
    }
    // A box near the bottom of the picture moves the window down to it, with the room its life takes, and the window never leaves the picture.
    const tall = PICTURE_AREA.height / view.scale
    const low = pushView({ x: 0, y: 0, width: 780, height: 1387 }, { x: 40, y: 1450, width: 700, height: 130 }, picture, phone, limit)
    expect(low.cy + tall / 2).toBeGreaterThan(1580)
    expect(low.cy + tall / 2).toBeLessThanOrEqual(picture.height + 1e-9)
    const top = pushView({ x: 0, y: 0, width: 780, height: 1387 }, { x: 40, y: 0, width: 700, height: 10 }, picture, phone, limit)
    expect(top.cy - tall / 2).toBeCloseTo(0, 6)
    const bottom = pushView({ x: 0, y: 301, width: 780, height: 1387 }, null, picture, phone, limit)
    expect(bottom.cy + tall / 2).toBeLessThanOrEqual(picture.height + 1e-9)
    // An element taller than the pushed-in window lowers the push until it fits, alive; never below the device at rest.
    const big = { x: 40, y: 200, width: 700, height: 1300 }
    const fitted = pushView({ x: 0, y: 150, width: 780, height: 1387 }, big, picture, phone, limit)
    expect(fitted.scale * big.height * LIFE).toBeCloseTo(PICTURE_AREA.height, 6)
    const short = { top: STRIP_HEIGHT, width: WIDTH, height: 600 }
    expect(pushView(rect, { x: 0, y: 0, width: 780, height: 1688 }, picture, phone, limit, short).scale).toBe(phone.scale)
  })

  it('lets the laptop push in only as far as keeps its sides in the frame, and refuses a device too wide to drift and pulse', () => {
    expect(LAPTOP_OUTLINE).toBe(LAPTOP.screenWidth + 2 * (LAPTOP.bezel + LAPTOP.baseOverhang))
    const laptop = pushLimit(LAPTOP_OUTLINE)
    expect(laptop).toBeLessThan(MAX_PUSH)
    expect(laptop).toBeGreaterThanOrEqual(LIFE)
    expect(LAPTOP_OUTLINE * laptop).toBeLessThanOrEqual(WIDTH - 2 * EDGE + 1e-9)
    expect(() => pushLimit(1060)).toThrow(/cannot drift and pulse/)
    // The computer's picture fits the window whole: the view keeps it where the rest view has it.
    const computer = { width: 2560, height: 1600 }
    const at = laptopRest(computer)
    const view = pushView({ x: 56, y: 56, width: 1792, height: 635 }, { x: 1092, y: 276, width: 732, height: 391 }, computer, at, laptop)
    close(view, { scale: (at.scale * laptop) / LIFE, cx: restView(at).cx, cy: restView(at).cy })
  })

  it('moves over its length from where the camera is, starts zoomed on the first frame of the scene, and a second move starts from the first', () => {
    // Without the drift and the pulse (`drift: 0`), the camera moves as the long cut's camera always moved.
    const at = restView(rest)
    const a = pushView({ x: 0, y: 301, width: 780, height: 1387 }, null, picture, rest, limit)
    const b = pushView({ x: 213, y: 850, width: 390, height: 693 }, null, picture, rest, limit)
    const still = (frame, moves) => liveView({ frame, start: 90, end: 500, rest: at, moves, length: 15, drift: 0 })
    expect(still(100, [{ frame: 105, view: a }])).toEqual(at)
    expect(still(105, [{ frame: 105, view: a }])).toEqual(at)
    close(still(120, [{ frame: 105, view: a }]), a)
    close(still(500, [{ frame: 105, view: a }]), a)
    const half = still(112.5, [{ frame: 105, view: a }])
    expect(half.scale).toBeCloseTo(Math.sqrt(at.scale * a.scale), 9)
    // On the scene's first frame, and during the whip before it, the camera is there already.
    close(still(82, [{ frame: 90, view: a }]), a)
    close(still(90, [{ frame: 90, view: a }]), a)
    const moves = [{ frame: 90, view: a }, { frame: 150, view: b }]
    close(still(140, moves), a)
    close(blendViews(a, b, 0.5), still(157.5, moves))
    close(still(170, moves), b)
    // A move that starts before the one before it has landed starts from where that one got to.
    const early = [{ frame: 100, view: a }, { frame: 105, view: b }]
    close(still(105, early), blendViews(at, a, 5 / 15))
  })

  it('drifts toward its element over the rest of each hold, evenly and by DRIFT at the most, keeping the element where it is on screen', () => {
    const at = restView(phone)
    const box = { x: 40, y: 1000, width: 700, height: 200 }
    const anchor = box.y + box.height / 2
    const view = pushView({ x: 0, y: 301, width: 780, height: 1387 }, box, picture, phone, limit)
    const moves = [{ frame: 105, view, anchor }]
    const live = (frame) => liveView({ frame, start: 90, end: 210, rest: at, moves, length: 15 })
    // Before the first move the device at rest drifts toward that move's element too, then the move starts from there.
    expect(live(90).scale).toBe(at.scale)
    expect(live(105).scale).toBeCloseTo(at.scale * (1 + DRIFT), 9)
    close(live(120), view) // landed
    let last = live(120).scale
    for (let frame = 121; frame <= 210; frame += 1) {
      const now = live(frame).scale
      expect(now, `frame ${frame}`).toBeGreaterThan(last)
      expect(now - last).toBeCloseTo((view.scale * DRIFT) / 90, 9) // evenly
      last = now
    }
    expect(last / view.scale).toBeCloseTo(1 + DRIFT, 9)
    expect(live(400).scale).toBe(last) // and no further after the end
    // The element's centre stays on the same line of the frame while the camera drifts toward it.
    const line = (frame) => onScreen(live(frame), phone).y(anchor)
    for (const frame of [130, 170, 209]) expect(line(frame)).toBeCloseTo(line(120), 6)
    expect(onScreen(live(209), phone).x(picture.width / 2)).toBeCloseTo(WIDTH / 2, 6)
    // A view without an element pushes in on the centre of the area.
    expect(driftView(view, null, 1)).toEqual({ ...view, scale: view.scale * (1 + DRIFT) })
  })

  it('pulses the view by PULSE.phone on the bar line, and not on the settled frame 0', () => {
    const scene = { startFrame: 60, endFrame: 180 }
    const camera = { picture, moves: [{ frame: 60, rect: { x: 0, y: 301, width: 780, height: 1387 }, box: { x: 40, y: 1000, width: 700, height: 200 } }] }
    const base = { scene, camera, rest: phone, outline: phoneWidth, tempo: TRACK }
    const bar = beatFrame(BEATS_PER_BAR, TRACK) // frame 60, a bar line
    const calm = sceneView({ ...base, frame: bar, pulse: false })
    expect(sceneView({ ...base, frame: bar }).scale / calm.scale).toBeCloseTo(1 + PULSE.phone, 9)
    expect(sceneView({ ...base, frame: bar, settled: true }).scale).toBe(calm.scale)
    expect(sceneView({ ...base, frame: bar + beatFrames(TRACK) }).scale).toBe(sceneView({ ...base, frame: bar + beatFrames(TRACK), pulse: false }).scale)
    const peak = liveView({ frame: 0, start: 0, end: 10, rest: restView(phone), moves: [], length: 15, pulse: 1 })
    expect(peak).toEqual({ ...restView(phone), scale: phone.scale * (1 + PULSE.phone) })
  })

  it('gives a picture drawn over the whole frame (the printed sign, the chat) the same life: a drift of DRIFT until it goes, and the pulse', () => {
    // From the bar line of frame 60 at 120 bpm (the next one is frame 120) to frame 165.
    expect(lifeScale(60, 60, 165, TRACK, true)).toBe(1)
    expect(lifeScale(60, 60, 165, TRACK)).toBeCloseTo(1 + PULSE.phone, 12)
    expect(lifeScale(60 + 15, 60, 165, TRACK)).toBeCloseTo(1 + (DRIFT * 15) / 105, 12)
    expect(lifeScale(120, 60, 165, TRACK)).toBeCloseTo((1 + (DRIFT * 60) / 105) * (1 + PULSE.phone), 12)
    expect(lifeScale(400, 60, 165, TRACK)).toBeCloseTo(1 + DRIFT, 12)
    let last = 0
    for (let frame = 121 + beatFrames(TRACK); frame < 165; frame += 1) {
      expect(lifeScale(frame, 60, 165, TRACK)).toBeGreaterThan(last)
      last = lifeScale(frame, 60, 165, TRACK)
    }
  })

  it('starts a scene that continues the one before it where that camera ended, and glides to its first move over one beat', () => {
    const at = restView(phone)
    const from = pushView({ x: 0, y: 0, width: 780, height: 1387 }, { x: 40, y: 200, width: 700, height: 200 }, picture, phone, limit)
    const to = pushView({ x: 0, y: 301, width: 780, height: 1387 }, { x: 40, y: 1300, width: 700, height: 200 }, picture, phone, limit)
    const live = (frame) => liveView({ frame, start: 90, end: 210, rest: at, from, moves: [{ frame: 90, view: to, anchor: 1400 }], length: 15, drift: 0 })
    close(live(90), from) // not at rest, and not there already
    close(live(97.5), blendViews(from, to, 0.5))
    close(live(105), to)
    // A first move on a later beat glides from the scene's first frame too: `from` has drifted already, so it never drifts twice.
    const later = (frame) => liveView({ frame, start: 90, end: 210, rest: at, from, moves: [{ frame: 150, view: to, anchor: 1400 }], length: 15 })
    close(later(90), from)
    expect(later(97.5).scale).toBeLessThan(Math.max(from.scale, to.scale) + 1e-9)
    expect(later(105).scale).toBeCloseTo(to.scale, 9)
    expect(later(209).scale / to.scale).toBeLessThanOrEqual(1 + DRIFT + 1e-9)
    // The same place of the camera in another area keeps the device where it is on screen.
    const small = { top: STRIP_HEIGHT, width: WIDTH, height: 600 }
    const moved = viewInArea(from, PICTURE_AREA, small)
    expect(onScreen(moved, phone, small).y(500)).toBeCloseTo(onScreen(from, phone).y(500), 6)
    expect(onScreen(moved, phone, small).x(100)).toBeCloseTo(onScreen(from, phone).x(100), 6)
  })

  it('spans boxes side by side with a margin, inside the picture', () => {
    const computer = { width: 2560, height: 1600 }
    expect(spanRect([{ x: 1092, y: 276, width: 732, height: 391 }, { x: 80, y: 80, width: 88, height: 88 }], computer)).toEqual({ x: 56, y: 56, width: 1848 - 56, height: 691 - 56 })
    expect(spanRect([{ x: 10, y: 10, width: 2540, height: 100 }], computer)).toEqual({ x: 0, y: 0, width: 2560, height: 134 })
  })

  it('lights the stage of the scene, marks the ones before it done, and lights none on the opening and the AI (D3)', () => {
    expect(stripStates('opening')).toEqual(['dim', 'dim', 'dim', 'dim'])
    expect(stripStates('prepare')).toEqual(['lit', 'dim', 'dim', 'dim'])
    expect(stripStates('scan')).toEqual(['done', 'lit', 'dim', 'dim'])
    expect(stripStates('see')).toEqual(['done', 'done', 'lit', 'dim'])
    expect(stripStates('ai')).toEqual(['done', 'done', 'done', 'dim'])
    expect(stripStates('need')).toEqual(['done', 'done', 'done', 'lit'])
    expect(() => stripStates('closing')).toThrow(/"closing"/)
  })

  it('leaves the strip off the title card and fades it in over the whip that ends the card, and shows it from frame 0 on a cut that opens on a screen', () => {
    const plan = planPromo('he', TRACK, LONG)
    const card = plan.scenes[0]
    expect(card.picture).toBe('text')
    expect(stripOpacity(plan, 0)).toBe(0)
    expect(stripOpacity(plan, card.endFrame - WHIP_FRAMES)).toBe(0)
    expect(stripOpacity(plan, card.endFrame - WHIP_FRAMES / 2)).toBe(0.5)
    expect(stripOpacity(plan, card.endFrame)).toBe(1)
    expect(stripOpacity(plan, plan.totalFrames - 1)).toBe(1)
    expect(stripOpacity(planPromo('he', TRACK, { ...LONG, scenes: LONG.scenes.slice(1) }), 0)).toBe(1)
  })
})

describe('the showcase of the parts (video/promo/parts/showcase.js)', () => {
  const plan = planShowcase(TRACK)

  it('plans its scenes like a cut, on the long scenes it borrows, and shows every box and picture it names', () => {
    expect(plan.scenes.map((scene) => scene.id)).toEqual(SHOWCASE.scenes.map((scene) => scene.id))
    for (const scene of SHOWCASE.scenes) {
      expect(LONG.scripts.he[scene.caption], scene.id).toBeTypeOf('string')
      for (const { box } of [...(scene.zoom ?? []), ...(scene.ring ?? [])]) expect(BOXES[scene.picture] ?? [], `${scene.id} ${box}`).toContain(box)
      for (const picture of stagedPictures([scene])) expect(PROMO_PICTURES, scene.id).toContain(picture)
    }
    // A zoom that starts with its scene, a second zoom, and a picture in picture are all there.
    const twice = plan.scenes.find((scene) => scene.id === 'zoom-twice')
    expect(twice.zoom[0].frame).toBe(twice.startFrame)
    expect(twice.zoom).toHaveLength(2)
    expect(plan.scenes.some((scene) => scene.inset)).toBe(true)
  })

  it('takes every still inside the composition, frame 0 first, and walks the strip through every stage', () => {
    const stills = showcaseStills(plan, TRACK)
    expect(stills[0]).toEqual(['01-first-frame-0', 0])
    expect(new Set(stills.map(([name]) => name)).size).toBe(stills.length)
    for (const [name, frame] of stills) {
      expect(frame, name).toBeGreaterThanOrEqual(0)
      expect(frame, name).toBeLessThan(plan.totalFrames)
    }
    const strip = plan.scenes.find((scene) => scene.id === 'strip')
    const shown = stills.filter(([name]) => name.includes('-strip-')).map(([, frame]) => walkingStage(strip, frame, TRACK))
    expect(shown).toEqual([...STAGES])
  })
})

describe('what the long cut shows (video/promo/parts/screens.js, and the AI answer of stage.js)', () => {
  const plan = planPromo('he', TRACK, LONG)
  const scene = (id) => plan.scenes.find((one) => one.id === id)
  /** A frames.json with every picture and box, all of them invented numbers: the phone's pictures, the computer's and the printed sheet. */
  const frames = () => ({
    pictures: Object.fromEntries(
      PROMO_PICTURES.map((name) => {
        const size = name === 'computer-history.png' ? { width: 2560, height: 1600 } : name === 'committee-print-sign.png' ? { width: 1800, height: 2400 } : { width: 780, height: 1688 }
        const keys = BOXES[name] ?? []
        const rects = (rect) => Object.fromEntries(keys.map((key, n) => [key, { ...rect, x: rect.x + n }]))
        return [name, { ...size, boxes: rects({ x: 40, y: 500, width: 300, height: 200 }), zooms: rects({ x: 0, y: 0, width: 390, height: 693 }) }]
      }),
    ),
  })

  it('follows the pictures of a scene in order and knows until when each one shows', () => {
    const languages = scene('today')
    expect(pictureTimeline(languages).map((one) => one.picture)).toEqual(['provider-home.png', 'provider-lang-en.png', 'provider-lang-ru.png', 'provider-lang-ar.png'])
    expect(pictureAt(languages, languages.startFrame)).toBe('provider-home.png')
    expect(pictureAt(languages, languages.thenFrame)).toBe('provider-lang-en.png')
    expect(pictureEnd(languages, languages.startFrame)).toBe(languages.thenFrame)
    expect(pictureEnd(languages, languages.later[1].frame)).toBe(languages.endFrame)
    // The printed sign and the chat are drawn over the whole frame, the device keeps its picture under them.
    expect(OVER_FRAME).toEqual(['committee-print-sign.png', 'agent'])
    expect(inDevice('committee-print-sign.png')).toBe(false)
    expect(inDevice('camera-checked')).toBe(false)
    expect(inDevice('computer-history.png')).toBe(true)
  })

  it('zooms every recorded screen within a beat of its scene, and shows a screen with the version line at its bottom only zoomed (D3)', () => {
    const versionLine = ['provider-home.png', 'provider-sent.png', 'provider-lang-en.png', 'provider-lang-ru.png', 'provider-lang-ar.png']
    for (const one of plan.scenes.filter((planned) => inDevice(planned.picture))) {
      expect(one.zoom?.[0]?.frame, one.id).toBeLessThanOrEqual(one.startFrame + beatFrames(TRACK))
      for (const shown of pictureTimeline(one).filter((picture) => versionLine.includes(picture.picture))) {
        // The camera starts on its rectangle with the scene, or has landed on one before the picture comes in.
        const first = one.zoom[0].frame
        expect(first === one.startFrame || first + beatFrames(TRACK) <= shown.frame, `${one.id}: ${shown.picture}`).toBe(true)
      }
    }
  })

  /** frames() with the filters of the computer at one end of the page and the Excel button at the other, as the recorder finds them. */
  const recorded = () => {
    const f = frames()
    Object.assign(f.pictures['computer-history.png'].boxes, { filters: { x: 1092, y: 276, width: 732, height: 391 }, excel: { x: 80, y: 80, width: 88, height: 88 } })
    return f
  }

  it('pushes no further than MAX_PUSH with its life, spans the filters to the Excel button, and keeps each ring to its picture', () => {
    const f = recorded()
    for (const one of plan.scenes.filter((planned) => planned.zoom)) {
      const { camera, rest, outline, area } = stageOf(one, f)
      for (const move of moveViews(camera.moves, camera.picture, rest, outline, area)) expect((move.view.scale / rest.scale) * LIFE, one.id).toBeLessThanOrEqual(MAX_PUSH + 1e-9)
    }
    for (const [picture, zooms] of Object.entries(WIDE_ZOOMS)) {
      for (const [box, boxes] of Object.entries(zooms)) for (const one of [box, ...boxes]) expect(BOXES[picture], `${picture} ${one}`).toContain(one)
    }
    const computer = f.pictures['computer-history.png']
    const filters = cameraOf(scene('filters'), f)
    expect(filters.picture).toEqual({ width: 2560, height: 1600 })
    expect(filters.moves[0].rect).toEqual(spanRect([computer.boxes.filters, computer.boxes.excel], computer))
    expect(filters.moves[0].box).toEqual(computer.boxes.filters)
    // The ring around the map's circle goes when the printed sign comes in; the ring on the home row stays to the end of the AI scene.
    const map = scene('points')
    expect(ringsOf(map, f).map((ring) => ring.until)).toEqual([map.later[0].frame])
    const agent = scene('agent')
    expect(ringsOf(agent, f).map((ring) => [ring.picture, ring.until])).toEqual([
      ['committee-agent.png', agent.thenFrame],
      ['committee-home.png', agent.endFrame],
    ])
    expect(cameraOf(agent, f).moves.map((move) => move.box)).toEqual([f.pictures['committee-agent.png'].boxes['read-only'], f.pictures['committee-home.png'].boxes['provider-row']])
    // A zoom on what the device does not show, or pictures of two sizes in one device, are refused.
    expect(() => cameraOf({ ...map, zoom: [{ box: 'qr', frame: map.later[0].frame }] }, f)).toThrow(/does not show/)
    expect(() => cameraOf({ ...map, then: 'computer-history.png' }, f)).toThrow(/different sizes/)
    expect(cameraOf(scene('closing'), f)).toBeNull()
    // A ring on the first beat starts with its scene: a cut that opens on a screen with a ring (the long cut from its visit scene on)
    // has it whole on frame 0 when the track's first beat is late.
    const late = planPromo('he', { bpm: 120, firstBeat: 0.4 }, { ...LONG, scenes: LONG.scenes.slice(LONG.scenes.findIndex((one) => one.id === 'visit')) }).scenes[0]
    expect(late.id).toBe('visit')
    expect(late.ring[0].frame).toBe(12)
    expect(ringsOf(late, f)[0].frame).toBe(0)
  })

  it('lifts the box of each move of the laptop scene out of its screen, at 2 pixels of the video per CSS pixel or more, inside the frame however the camera drifts and pulses', () => {
    const f = recorded()
    const filters = scene('filters')
    expect(LENSES.filters).toHaveLength(filters.zoom.length)
    expect(filters.zoom.map((move) => move.box)).toEqual(['filters', 'filters', 'filters', 'excel'])
    const { camera, rest, area } = stageOf(filters, f)
    const limit = pushLimit(LAPTOP_OUTLINE)
    const lenses = lensesOf(camera, rest, limit, LENSES.filters)
    expect(lenses).toHaveLength(4)
    const computer = f.pictures['computer-history.png']
    // What each lens lifts: the dates and the type (the recorder's box), the point and the provider (LENSES), then the Excel button.
    const dates = LENSES.filters[0]
    expect(lenses[0].rect).toEqual(dates)
    for (const [key, edge] of [['x', dates.x], ['y', dates.y]]) expect(computer.boxes.filters[key], key).toBeGreaterThanOrEqual(edge) // the box is inside its lens
    expect(computer.boxes.filters.x + computer.boxes.filters.width).toBeLessThanOrEqual(dates.x + dates.width)
    expect(computer.boxes.filters.y + computer.boxes.filters.height).toBeLessThanOrEqual(dates.y + dates.height)
    expect(lensRect(computer.boxes.excel, computer, null)).toEqual({ x: 52, y: 52, width: 144, height: 144 }) // a box with no lens of its own gets LENS.pad around it
    expect(lenses[1].rect).toEqual(LENSES.filters[1]) // the point
    expect(lenses[2].rect).toEqual(LENSES.filters[2]) // the provider
    expect(lenses[3].rect).toEqual(lensRect(computer.boxes.excel, computer))
    // The provider is at the left of the point, which is at the left of the dates, with no overlap.
    expect(lenses[2].rect.x + lenses[2].rect.width).toBeLessThanOrEqual(lenses[1].rect.x)
    expect(lenses[1].rect.x + lenses[1].rect.width).toBeLessThanOrEqual(computer.boxes.filters.x)
    for (const lens of lenses) {
      // A page recorded at twice its density: one unit of the picture is half a CSS pixel, so a scale of 1 is 2 video pixels per CSS pixel, and the
      // 14 CSS pixel words of the filters are 28 pixels tall or more.
      expect(lens.up.scale, `${lens.rect.x}`).toBeGreaterThanOrEqual(1)
      expect(lens.up.scale).toBeLessThanOrEqual(LENS.maxScale + 1e-9)
      expect(lens.rect.x).toBeGreaterThanOrEqual(0)
      expect(lens.rect.y).toBeGreaterThanOrEqual(0)
      expect(lens.rect.x + lens.rect.width).toBeLessThanOrEqual(computer.width)
      expect(lens.rect.y + lens.rect.height).toBeLessThanOrEqual(computer.height)
      // Both side edges stay LENS.margin inside the frame with the camera at its largest (its centre across does not move).
      expect(WIDTH / 2 + limit * (lens.up.x - WIDTH / 2)).toBeGreaterThanOrEqual(LENS.margin - 1e-6)
      expect(WIDTH / 2 + limit * (lens.up.x + lens.up.width - WIDTH / 2)).toBeLessThanOrEqual(WIDTH - LENS.margin + 1e-6)
      // The same up and down, about the middle of the picture area, so that the strip and the caption bar never cover it.
      const middle = area.top + area.height / 2
      expect(middle + limit * (lens.up.y - middle)).toBeGreaterThanOrEqual(area.top + LENS.margin - 1e-6)
      expect(middle + limit * (lens.up.y + lens.up.height - middle)).toBeLessThanOrEqual(area.top + area.height - LENS.margin + 1e-6)
    }
    // It lifts out of where the box is on the screen and ends where it is up, and the pictures it lifts are the screen's own.
    const [first] = lenses
    const from = lensAt(first.rect, rest, first.up, 0)
    expect([from.x, from.y, from.width]).toEqual([rest.x + rest.scale * first.rect.x, rest.y + rest.scale * first.rect.y, rest.scale * first.rect.width])
    expect(from.scale).toBeCloseTo(rest.scale, 9)
    const up = lensAt(first.rect, rest, first.up, 1)
    expect([up.x, up.y, up.width, up.height]).toEqual([first.up.x, first.up.y, first.up.width, first.up.height])
    expect(up.scale).toBeCloseTo(first.up.scale, 9)
  })

  it('lifts a lens over one beat, lowers it as the next one lifts, and dims the screen by 30% all the while', () => {
    const beat = beatFrames(TRACK)
    const moves = [{ frame: 100 }, { frame: 100 + 4 * beat }, { frame: 100 + 8 * beat }]
    expect(liftEase(0)).toBe(0)
    expect(liftEase(1)).toBe(1)
    expect(liftEase(0.5)).toBeCloseTo(0.5, 9)
    expect(liftProgress(99, moves, beat)).toEqual([0, 0, 0])
    expect(liftProgress(100 + beat, moves, beat)).toEqual([1, 0, 0])
    expect(dimAt(liftProgress(99, moves, beat))).toBe(0)
    expect(dimAt(liftProgress(100 + beat, moves, beat))).toBeCloseTo(0.3, 9)
    // Between the first lift and the second: the first holds until the second move starts, then lowers as the second lifts.
    expect(liftProgress(100 + 4 * beat - 1, moves, beat)).toEqual([1, 0, 0])
    for (let frame = 100 + 4 * beat; frame <= 100 + 5 * beat; frame += 1) {
      const progress = liftProgress(frame, moves, beat)
      expect(progress[0] + progress[1], `frame ${frame}`).toBeCloseTo(1, 9)
      expect(dimAt(progress), `frame ${frame}`).toBeCloseTo(LENS.dim, 9)
    }
    // The last lens stays up to the end of the scene, and the dim with it.
    expect(liftProgress(100 + 20 * beat, moves, beat)).toEqual([0, 0, 1])
    expect(dimAt([0, 0, 1])).toBeCloseTo(0.3, 9)
    expect(LENS.dim).toBe(0.3)
  })

  // The edit joins the basement visit to the visit; these are the long cut with four more pairs of scenes on the same device joined, one of
  // them on another picture and with its first move on beat 1 (the mechanism of W1, on the new edit).
  const JOINED = ['far', 'today', 'visit', 'late', 'refused']
  const joined = { ...LONG, scenes: LONG.scenes.map((one) => (JOINED.includes(one.id) ? { ...one, continues: true } : one)) }

  it.each([
    ['the long cut', LONG],
    ['the long cut with scenes that continue', joined],
  ])('keeps both sides of the phone or the laptop in the frame at every frame of %s, pushes no further than MAX_PUSH, and lands on each element', (_, script) => {
    const f = recorded()
    const planned = planPromo('he', TRACK, script)
    let checked = 0
    planned.scenes.forEach((one, index) => {
      const stage = stageOf(one, f)
      if (!stage) return
      const from = continuityOf(planned.scenes, index, f, TRACK)?.from ?? null
      const lead = index > 0 && !one.continues ? WHIP_FRAMES : 0
      for (let frame = one.startFrame - lead; frame < one.endFrame; frame += 1) {
        const view = sceneView({ frame, scene: one, ...stage, from, tempo: TRACK })
        const { scale, x } = cameraTransform(view, stage.rest, stage.area)
        const left = x + scale * ((WIDTH - stage.outline) / 2)
        const right = x + scale * ((WIDTH + stage.outline) / 2)
        expect(scale, `${one.id} at ${frame}`).toBeLessThanOrEqual(MAX_PUSH + 1e-9)
        expect(left, `${one.id} at ${frame}`).toBeGreaterThanOrEqual(EDGE - 1e-6)
        expect(right, `${one.id} at ${frame}`).toBeLessThanOrEqual(WIDTH - EDGE + 1e-6)
        checked += 1
      }
      // Where each move lands, its element is inside the area the camera frames.
      stage.camera.moves.forEach((move, n) => {
        const next = stage.camera.moves[n + 1]
        const land = Math.min(Math.max(move.frame, one.startFrame) + beatFrames(TRACK), next ? next.frame : Infinity, one.endFrame - 1)
        const view = sceneView({ frame: land, scene: one, ...stage, from, tempo: TRACK })
        const { scale, y } = cameraTransform(view, stage.rest, stage.area)
        const top = y + scale * (stage.rest.y + stage.rest.scale * move.box.y)
        const bottom = y + scale * (stage.rest.y + stage.rest.scale * (move.box.y + move.box.height))
        expect(top, `${one.id} move ${n}`).toBeGreaterThanOrEqual(stage.area.top - 1e-6)
        expect(bottom, `${one.id} move ${n}`).toBeLessThanOrEqual(stage.area.top + stage.area.height + 1e-6)
      })
    })
    expect(checked).toBeGreaterThan(2800)
    // The laptop of the filters is one view: every move keeps the whole laptop (the magnifier lifts what each move names out of it).
    const filters = stageOf(scene('filters'), f)
    expect(filters.laptop).toBe(true)
    const [first, ...others] = moveViews(filters.camera.moves, filters.camera.picture, filters.rest, filters.outline, filters.area)
    expect(others.length).toBeGreaterThan(0)
    for (const other of others) for (const key of ['scale', 'cx', 'cy']) expect(first.view[key], key).toBeCloseTo(other.view[key], 9)
  })

  it('draws the first picture of a scene during the whip that brings it in, and each later one from its own frame', () => {
    const fade = 6
    const recordedScene = scene('recorded')
    for (let frame = recordedScene.startFrame - WHIP_FRAMES; frame < recordedScene.startFrame + 3; frame += 1) {
      expect(drawnPictures(recordedScene, frame, fade), `frame ${frame}`).toEqual([{ picture: 'provider-recorded.png', frame: recordedScene.startFrame, opacity: 1 }])
    }
    const languages = scene('today')
    expect(drawnPictures(languages, languages.startFrame - WHIP_FRAMES, fade).map((one) => one.picture)).toEqual(['provider-home.png'])
    expect(drawnPictures(languages, languages.thenFrame - 1, fade).map((one) => one.picture)).toEqual(['provider-home.png'])
    expect(drawnPictures(languages, languages.thenFrame + 3, fade)).toEqual([
      { picture: 'provider-home.png', frame: languages.startFrame, opacity: 1 },
      { picture: 'provider-lang-en.png', frame: languages.thenFrame, opacity: 0.5 },
    ])
    expect(drawnPictures(languages, languages.thenFrame + fade, fade).map((one) => one.picture)).toEqual(['provider-lang-en.png'])
    // The printed sign and the chat are not drawn in the device: it keeps the picture before them.
    const map = scene('points')
    expect(drawnPictures(map, map.later[0].frame + 20, fade).map((one) => one.picture)).toEqual(['committee-points-map.png'])
    // A scene that continues on another picture cross-fades from the one the scene before ended on.
    expect(drawnPictures(scene('far'), scene('far').startFrame + 3, fade, 'provider-password.png')).toEqual([
      { picture: 'provider-password.png', frame: -Infinity, opacity: 1 },
      { picture: 'provider-far.png', frame: scene('far').startFrame, opacity: 0.5 },
    ])
    expect(drawnPictures(scene('far'), scene('far').startFrame, fade, 'provider-far.png').map((one) => one.picture)).toEqual(['provider-far.png'])
  })

  it('starts a scene that continues where the camera of the one before it ended, and refuses one after a scene it cannot continue', () => {
    const f = recorded()
    const planned = planPromo('he', TRACK, joined)
    const at = (id) => planned.scenes.findIndex((one) => one.id === id)
    expect(continuityOf(planned.scenes, at('counts'), f, TRACK)).toBeNull()
    for (const id of JOINED) {
      const index = at(id)
      const before = planned.scenes[index - 1]
      const [was, is] = [stageOf(before, f), stageOf(planned.scenes[index], f)]
      const { from, picture } = continuityOf(planned.scenes, index, f, TRACK)
      expect(picture, id).toBe(pictureAt(before, before.endFrame))
      // The device is where the last frame of the scene before left it, the pulse aside.
      const end = sceneView({ frame: before.endFrame - 1, scene: before, ...was, tempo: TRACK, pulse: false })
      const [a, b] = [cameraTransform(end, was.rest, was.area), cameraTransform(from, is.rest, is.area)]
      expect(b.scale, id).toBeCloseTo(a.scale, 2)
      expect(b.y, id).toBeCloseTo(a.y, -1)
      expect(b.x, id).toBeCloseTo(a.x, -1)
    }
    // After the camera of the sign, a scene ending on the printed sign or on the chat, there is no camera to continue.
    const continuing = (id) => planned.scenes.map((one, index) => (index === at(id) ? { ...one, continues: true } : one))
    expect(() => continuityOf(continuing('sees'), at('sees'), f, TRACK)).toThrow(/does not end on a zoomed screen/)
    expect(() => continuityOf(continuing('access'), at('access'), f, TRACK)).toThrow(/"points"/)
    expect(() => continuityOf(continuing('open'), at('open'), f, TRACK)).toThrow(/"agent"/)
  })

  it("gives the committee's phone a light bezel and the provider's a dark one, each one readable as a phone on the violet ground", () => {
    expect(bezelOf('committee-home.png')).toBe(BEZELS.committee)
    expect(bezelOf('committee-history-from-home.png')).toBe(BEZELS.committee)
    expect(bezelOf('provider-recorded.png')).toBe(BEZELS.provider)
    expect(bezelOf('camera')).toBe(BEZELS.provider)
    expect(BEZELS.provider.color).toBe(COLORS.phone) // the short cut's phone
    // WCAG 1.4.11: a part of a graphic that has to be seen stands out at 3:1 from what is next to it.
    for (const ground of [COLORS.groundFrom, COLORS.groundTo]) {
      expect(contrastRatio(BEZELS.committee.color, ground), ground).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(BEZELS.committee.color, BEZELS.provider.color)).toBeGreaterThanOrEqual(3)
    }
  })

  it('answers the AI question from the sample: the cleaning provider, the days with a visit (not the check-ins) and the empty day as DD/MM/YYYY', () => {
    const cleaner = 'נועה כהן (חברה לדוגמה)'
    const sample = () => ({
      missingDay: '2026-01-06',
      agentSample: {
        days: ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'],
        byProvider: [
          { provider_name: cleaner, service_type: 'cleaning', count: 8 },
          { provider_name: 'דנה לוי (גינה לדוגמה)', service_type: 'gardening', count: 1 },
        ],
        byDay: [
          ...['2026-01-04', '2026-01-05', '2026-01-07', '2026-01-08'].map((day) => ({ day, provider_name: cleaner, count: 2 })),
          { day: '2026-01-06', provider_name: 'דנה לוי (גינה לדוגמה)', count: 1 },
        ],
      },
    })
    const chat = agentAnswer(sample())
    expect(chat.question).toBe(agentChat.question)
    expect(chat.answer).toBe(`בשבוע האחרון נרשמו ביקורים של ${cleaner} ב-4 ימים מתוך 5. היום בלי ביקור: 06/01/2026.`)
    expect(chat.parts.filter((part) => part.place).map((part) => part.place)).toEqual(['provider', 'days', 'missingDate'])
    expect(chat.parts.map((part) => part.text).join('')).toBe(chat.answer)
    const RECORD = /npm run promo:frames/
    expect(() => agentAnswer({})).toThrow(/agentSample.*npm run promo:frames/)
    expect(() => agentAnswer({ ...sample(), missingDay: '2026-01-05' })).toThrow(RECORD)
    expect(() => agentAnswer({ ...sample(), missingDay: '2026-02-01' })).toThrow(RECORD)
    expect(() => agentAnswer({ ...sample(), missingDay: '2026-01-09' })).toThrow(/workday/) // a Friday: the agreement does not cover it
    // A day outside the sample's week is not counted, and a week with the five agreed days has no answer to give.
    const outside = sample()
    outside.agentSample.byDay.push({ day: '2025-12-31', provider_name: cleaner, count: 2 })
    expect(agentAnswer(outside).answer).toMatch(/ב-4 ימים/)
    const full = sample()
    full.agentSample.byDay.push({ day: '2026-01-09', provider_name: cleaner, count: 2 })
    expect(() => agentAnswer(full)).toThrow(/on 5 days, not fewer than 5/)
    const twoCleaners = sample()
    twoCleaners.agentSample.byProvider[1].service_type = 'cleaning'
    expect(() => agentAnswer(twoCleaners)).toThrow(/2 cleaning providers/)
    expect(() => agentAnswer(sample(), { question: 'q', answer: '{unknown}' })).toThrow(/\{unknown\}/)
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
