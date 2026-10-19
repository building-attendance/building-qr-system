// The provider tutorial video: its script (video/script/) and its recorder (npm run video:frames). No browser and no database: the
// script is checked for a line in every language, labels that exist in all four dictionaries, the text rules and its durations; the
// recorder is checked for being kept out of the E2E run (so CI never records), for its own ports and schema, and for what its guard
// refuses; and its frames are checked for never being committed.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import he from '../src/i18n/he.js'
import { DICTS } from '../src/i18n/core.js'
import { EM_DASH } from '../scripts/text-rules.mjs'
import { LANGUAGES, SCENES, SCRIPTS, VOWELS } from '../video/script/index.js'
import {
  VOWELLED_LANGUAGES, beatsWithLines, buildScenes, checkScript, referencedKeys, resolveLine, spokenLine, unusedVowels,
  vowelledWordProblem, wordsOf,
} from '../scripts/video/script.mjs'
import { VIDEO_APP_PORT, VIDEO_API_PORT, VIDEO_OUT_DIR, VIDEO_SCHEMA, assertLocalVideo } from '../scripts/video/settings.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

// ---- the script --------------------------------------------------------------------------------------------------

describe('the script of the video', () => {
  it('has the 11 scenes of the topic plan, in their order, about a minute and a half long', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['intro', 'sign', 'list', 'password', 'locating', 'recorded', 'home', 'far', 'offline', 'language', 'outro'])
    expect(SCENES.reduce((sum, scene) => sum + scene.seconds, 0)).toBe(94)
  })

  it('is Hebrew first, and every language of index.js is a language of the app', () => {
    expect(LANGUAGES[0]).toBe('he')
    for (const lang of LANGUAGES) expect(Object.keys(DICTS)).toContain(lang)
  })

  it('has no problem: lines in every language, labels in all four dictionaries, the text rules, positive durations', () => {
    expect(checkScript()).toEqual([])
  })

  it.each(LANGUAGES)('in %s, every scene has a caption and a say line, and every beat that needs one has both', (lang) => {
    for (const scene of SCENES) {
      expect(scene.beats[0].continues, `${scene.id} starts with a line`).toBeFalsy()
    }
    for (const beat of beatsWithLines()) {
      expect(SCRIPTS[lang][beat.id]?.caption, `${lang} ${beat.id}`).toEqual(expect.stringMatching(/\S/))
      expect(SCRIPTS[lang][beat.id]?.say, `${lang} ${beat.id}`).toEqual(expect.stringMatching(/\S/))
    }
  })

  it('refers to every label by a key that all four dictionaries have', () => {
    const keys = LANGUAGES.flatMap((lang) => Object.values(SCRIPTS[lang]).flatMap((line) => [...referencedKeys(line.caption), ...referencedKeys(line.say)]))
    expect(keys.length, 'the script quotes the buttons of the app').toBeGreaterThan(3)
    for (const key of keys) {
      for (const [lang, dict] of Object.entries(DICTS)) expect(Object.hasOwn(dict, key), `{${key}} in ${lang}`).toBe(true)
    }
  })

  it('has positive durations, and the beats of a scene add up to it', () => {
    for (const scene of SCENES) {
      expect(scene.seconds).toBeGreaterThan(0)
      for (const beat of scene.beats) expect(beat.seconds, beat.id).toBeGreaterThan(0)
      expect(scene.beats.reduce((sum, beat) => sum + beat.seconds, 0), scene.id).toBeCloseTo(scene.seconds, 5)
    }
  })

  it('resolves a label from src/i18n, so that a renamed button renames the narration', () => {
    expect(resolveLine('he', SCRIPTS.he.submit.caption)).toContain(`"${he['login.submit']}"`)
    expect(resolveLine('he', SCRIPTS.he.submit.say)).toContain(`"${he['login.remember']}"`)
    expect(resolveLine('he', 'x {checkin.done} y')).toBe(`x ${he['checkin.done']} y`)
    expect(resolveLine('en', '{checkin.done}')).toBe(DICTS.en['checkin.done'])
  })
})

// ---- the vowelled narration --------------------------------------------------------------------------------------

describe("the Hebrew narrator reads the caption's words, vowelled from one dictionary", () => {
  const POINT = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/

  it('is the rule for Hebrew, whose dictionary is video/script/he-niqqud.js', () => {
    expect(VOWELLED_LANGUAGES).toEqual(['he'])
    expect(Object.keys(VOWELS.he).length).toBeGreaterThan(50)
  })

  it("keeps every caption and say line plain, and the say line has exactly the caption's words, ending a sentence", () => {
    for (const beat of beatsWithLines()) {
      const { caption, say } = SCRIPTS.he[beat.id]
      expect(POINT.test(caption), `he ${beat.id} caption`).toBe(false)
      expect(POINT.test(say), `he ${beat.id} say`).toBe(false)
      expect(wordsOf(resolveLine('he', say)), `he ${beat.id}`).toEqual(wordsOf(resolveLine('he', caption)))
      expect(say.trim(), `he ${beat.id}`).toMatch(/[.?!]["')]*$/)
    }
  })

  it('has an entry for every word that a say line says, labels of the app included, and no entry that no line says', () => {
    for (const beat of beatsWithLines()) expect(() => spokenLine('he', SCRIPTS.he[beat.id].say), `he ${beat.id}`).not.toThrow()
    expect(unusedVowels('he')).toEqual([])
  })

  it('holds every entry to its word, letter by letter', () => {
    for (const [word, vowelled] of Object.entries(VOWELS.he)) expect(vowelledWordProblem(word, vowelled), word).toBeNull()
  })

  it('gives the narrator the line with its labels resolved and every Hebrew word vowelled', () => {
    const spoken = spokenLine('he', SCRIPTS.he.submit.say)
    expect(spoken).toContain(`"${VOWELS.he['כניסה']}"`)
    expect(POINT.test(spoken)).toBe(true)
    expect(spokenLine('he', 'קוד QR.')).toBe(`${VOWELS.he['קוד']} QR.`)
    expect(() => spokenLine('he', 'מילה חדשה.')).toThrow(/"מילה"/)
  })

  it('lets a vowelled word leave out only a doubled vav or yod, or one that stands for its vowel', () => {
    for (const [plain, vowelled] of [['נקודה', 'נְקֻדָּה'], ['בבניין', 'בַּבִּנְיָן'], ['מכוונים', 'מְכַוְּנִים'], ['ללחוץ', 'לִלְחֹץ'], ['בית', 'בַּיִת'], ['עכשיו', 'עַכְשָׁיו']]) {
      expect(vowelledWordProblem(plain, vowelled), plain).toBeNull()
    }
    expect(vowelledWordProblem('בית', 'בַּת')).toBe("its letters are not the word's (at letter 2)")
    expect(vowelledWordProblem('עכשיו', 'עַכְשָׁו')).toBe("its letters are not the word's (at letter 4)")
    expect(vowelledWordProblem('בית', 'בַּיִתָה')).toBe('it has letters that the word has not')
    expect(vowelledWordProblem('בית', 'בית')).toBe('it has no vowel point')
  })

  it('splits words at spaces and at every punctuation mark, a maqaf too', () => {
    const maqaf = String.fromCodePoint(0x05be)
    expect(wordsOf(`שלום${maqaf}עולם, ושוב.`)).toEqual(['שלום', 'עולם', 'ושוב'])
    expect(wordsOf('קוד QR, English.')).toEqual(['קוד', 'QR', 'English'])
  })
})

// ---- what the check reports --------------------------------------------------------------------------------------

describe('the check of the script reports', () => {
  const scenes = [{ id: 'one', seconds: 3, beats: [{ id: 'one', seconds: 3 }] }]
  const script = (caption, say = caption) => ({ he: { one: { caption, say } } })
  const vowels = { he: { 'שלום': 'שָׁלוֹם', 'עולם': 'עוֹלָם', 'בית': 'בַּיִת', 'לוחצים': 'לוֹחֲצִים', [he['login.submit']]: 'כְּנִיסָה' } }

  it('a made-up key, by its name, and refuses to resolve it', () => {
    const problems = checkScript(script('press "{login.madeUpButton}"'), scenes)
    expect(problems).toHaveLength(2) // the caption and the say line
    expect(problems[0]).toMatch(/\{login\.madeUpButton\} is not a key of src\/i18n \(missing in he, en, ru, ar\)/)
    expect(() => resolveLine('he', '{login.madeUpButton}')).toThrow(/\{login\.madeUpButton\}/)
  })

  it('a language that the app does not have, whose labels would fall back to Hebrew', () => {
    expect(checkScript({ ra: { one: { caption: 'a', say: 'a' } } }, scenes)).toEqual(['ra: not a language of the app (src/i18n has he, en, ru, ar)'])
    expect(() => resolveLine('ra', '{checkin.done}')).toThrow(/"ra" is not a language of the app/)
  })

  it('a label with a parameter, which is a sentence and not a name to quote', () => {
    expect(checkScript(script('{home.pendingCount}'), scenes)[0]).toMatch(/\{home\.pendingCount\} has a parameter/)
    expect(() => resolveLine('he', '{home.pendingCount}')).toThrow(/parameter/)
  })

  it('a long dash, and a date or a time', () => {
    expect(checkScript(script(`a ${EM_DASH} b`, 'ok'), scenes)).toEqual(['he "one" caption: a long dash (em dash)'])
    for (const when of ['12:30', '19/10/2026', '19/10', '2026-10-19']) {
      expect(checkScript(script('ok', `at ${when}`), scenes), when).toEqual(['he "one" say: a date or a time'])
    }
  })

  it('a missing caption or say line, and a line for a beat that has none', () => {
    expect(checkScript({ he: { one: { caption: 'ok' } } }, scenes)).toEqual(['he "one": no say'])
    expect(checkScript({ he: { one: { caption: ' ', say: 'ok' }, two: { caption: 'a', say: 'a' } } }, scenes)).toEqual([
      'he "one": no caption',
      'he "two": a line for a beat that has none (unknown, or it continues the line before it)',
    ])
  })

  it('in Hebrew: a vowel point in a caption or a say line, whose words come from the dictionary instead', () => {
    expect(checkScript(script('שָׁלוֹם.', 'שָׁלוֹם.'), scenes, vowels)).toEqual([
      'he "one" caption: a vowel point (the lines are plain, the narrator\'s vowels come from video/script/he-niqqud.js)',
      'he "one" say: a vowel point (the lines are plain, the narrator\'s vowels come from video/script/he-niqqud.js)',
    ])
  })

  it("in Hebrew: a say line whose words are not the caption's, even by one vav or yod", () => {
    expect(checkScript(script('בית.', 'בת.'), scenes, vowels)).toEqual([
      'he "one" say: not the caption\'s words (the say line has "בת", the caption "בית")',
      'he "one" say: no vowels for בת (add them to video/script/he-niqqud.js)',
    ])
  })

  it('in Hebrew: a word that the dictionary lacks, a line that is only a label of the app included', () => {
    expect(checkScript(script('{login.submit}.', '{login.submit}.'), scenes, { he: {} })).toEqual([
      `he "one" say: no vowels for ${he['login.submit']} (add them to video/script/he-niqqud.js)`,
    ])
    expect(checkScript(script('{login.submit}.', '{login.submit}.'), scenes, vowels)).toEqual([])
  })

  it('in Hebrew: an entry of the dictionary that is another word', () => {
    expect(checkScript(script('בית.', 'בית.'), scenes, { he: { 'בית': 'בַּת' } })).toEqual(['he-niqqud.js "בית": its letters are not the word\'s (at letter 2)'])
  })

  it('in Hebrew: a say line that does not end a sentence, which the narrator would read on without a stop', () => {
    expect(checkScript(script('שלום', 'שלום'), scenes, vowels)).toEqual(['he "one" say: it does not end a sentence (a full stop, a question mark or an exclamation mark)'])
    for (const say of ['שלום.', 'שלום?', 'שלום!', '"שלום".', '"שלום."']) expect(checkScript(script('שלום', say), scenes, vowels), say).toEqual([])
  })

  it('in Hebrew: punctuation that only the say line has, a maqaf where the caption has a space included', () => {
    const maqaf = String.fromCodePoint(0x05be)
    expect(checkScript(script('שלום עולם: לוחצים.', `שלום${maqaf}עולם. לוחצים.`), scenes, vowels)).toEqual([])
  })

  it('a duration that is not positive, beats that do not add up, a repeated or a bad id, and a scene that starts by continuing', () => {
    const bad = [
      { id: 'one', seconds: 3, beats: [{ id: 'one', seconds: 0 }, { id: 'one', seconds: 2 }] },
      { id: 'Two', seconds: 1, beats: [{ id: 'two', seconds: 1, continues: true }] },
    ]
    const problems = checkScript({ he: { one: { caption: 'a', say: 'a' } } }, bad)
    expect(problems).toEqual(expect.arrayContaining([
      'beat "one": its seconds are not a positive number',
      'beat "one": the id is used twice',
      'scene "one": its beats run 2 seconds, the scene 3',
      'scene "Two": the id is not lower-case words with hyphens',
      'scene "Two": its first beat continues, so the scene has no line of its own',
    ]))
  })
})

describe('scenes.json', () => {
  const capture = (id) => ({ image: `${id}.png`, masked: `${id}.masked.png`, width: 390, height: 844, scale: 2, tap: null, highlight: null })
  const allBeats = SCENES.flatMap((scene) => scene.beats)

  it('has every scene and beat in order, with the picture, the resolved lines (null where a beat continues) and the seconds', () => {
    const scenes = buildScenes('he', Object.fromEntries(allBeats.map((beat) => [beat.id, capture(beat.id)])))
    expect(scenes.lang).toBe('he')
    expect(scenes.seconds).toBe(94)
    expect(scenes.scenes.map((scene) => scene.id)).toEqual(SCENES.map((scene) => scene.id))
    const beats = scenes.scenes.flatMap((scene) => scene.beats)
    expect(beats.map((beat) => beat.id)).toEqual(allBeats.map((beat) => beat.id))
    const submit = beats.find((beat) => beat.id === 'submit')
    expect(submit).toMatchObject({ image: 'submit.png', masked: 'submit.masked.png', seconds: 7 })
    expect(submit.caption).toContain(he['login.submit'])
    expect(submit.caption).not.toMatch(/[{}]/)
    expect(beats.find((beat) => beat.id === 'sent')).toMatchObject({ caption: null, say: null })
  })

  it('is refused when a beat has no picture, or for a language that the script does not have', () => {
    expect(() => buildScenes('he', { intro: capture('intro') })).toThrow(/no picture for the beat\(s\) sign, list/)
    expect(() => buildScenes('xx', {})).toThrow(/no language "xx"/)
  })
})

// ---- the recorder is not an E2E run ------------------------------------------------------------------------------

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const videoConfig = 'playwright.video.config.js'
/** `playwright test --list` with these arguments, in the project folder: lists the tests without starting a server. */
const list = (...args) =>
  spawnSync(process.execPath, [cli, 'test', '--list', ...args], {
    cwd: root,
    env: { ...process.env, E2E_APP_PORT: '', E2E_API_PORT: '', E2E_SCHEMA: '', CI: '' },
    encoding: 'utf8',
    timeout: 60_000,
  })

describe('the recorder is not part of the E2E run, so that CI never records', () => {
  it('has a config of its own, at the project root, whose specs are not under e2e/ or tests/', () => {
    const source = fs.readFileSync(path.join(root, videoConfig), 'utf8')
    const testDir = /testDir:\s*'([^']+)'/.exec(source)?.[1]
    expect(testDir).toBe('./scripts/video')
    expect(fs.existsSync(path.join(root, testDir, 'record.spec.mjs'))).toBe(true)
  })

  it('is run by npm run video:frames with that config, and npm run test:e2e and npm test do not use it', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(scripts['video:frames']).toBe(`playwright test --config ${videoConfig}`)
    expect(scripts['test:e2e']).toBe('playwright test')
    expect(scripts.test).not.toContain('video')
  })

  it('is not listed by the E2E config, which reads ./e2e and nothing else', () => {
    const result = list()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/Total: \d+ tests in \d+ files/)
    expect(result.stdout).not.toContain('record.spec')
  })

  it('is listed by its own config: one spec, and none of the E2E specs', () => {
    const result = list('--config', videoConfig)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('record.spec.mjs')
    expect(result.stdout).toMatch(/Total: \d+ tests in 1 file/)
    expect(result.stdout).not.toMatch(/(?:^|[\\/\s])e2e[\\/]/m)
  })
})

describe('the config of the recorder', () => {
  async function loadVideoConfig() {
    vi.resetModules()
    vi.stubEnv('E2E_APP_PORT', '3100')
    vi.stubEnv('E2E_API_PORT', '3101')
    vi.stubEnv('E2E_SCHEMA', 'e2e')
    return (await import('../playwright.video.config.js')).default
  }
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('serves its own ports and works in its own schema, whatever an E2E run left in the environment', async () => {
    const config = await loadVideoConfig()
    const [api, preview] = config.webServer
    const build = `node_modules/.cache/bqr-e2e/${VIDEO_SCHEMA}/dist`
    expect(config.use.baseURL).toBe(`http://localhost:${VIDEO_APP_PORT}`)
    expect(api.command).toBe(
      `node scripts/dev-seed.mjs ${VIDEO_SCHEMA} --drop && node scripts/dev-seed.mjs ${VIDEO_SCHEMA} && node server/dev.mjs --schema=${VIDEO_SCHEMA}`,
    )
    expect(api.url).toBe(`http://localhost:${VIDEO_API_PORT}/api/public/providers`)
    expect(preview.command).toBe(`npm run build -- --outDir ${build} && npx vite preview --port ${VIDEO_APP_PORT} --strictPort --outDir ${build}`)
    for (const server of [api, preview]) expect(server.reuseExistingServer).toBe(false)
    expect(config.globalTeardown).toBe('./e2e/global-teardown.js') // drops the schema of this run
    expect(config.projects.map((project) => project.name)).toEqual(['video'])
  })

  it('shares no port and no schema with the other tools', () => {
    expect([VIDEO_APP_PORT, VIDEO_API_PORT]).toEqual([3600, 3601])
    for (const taken of [3000, 3001, 3100, 3101, 3200, 3201, 3300, 3301, 3400, 3401]) expect([VIDEO_APP_PORT, VIDEO_API_PORT]).not.toContain(taken)
    expect(VIDEO_APP_PORT < 3700 && VIDEO_API_PORT < 3700).toBe(true)
    expect(VIDEO_SCHEMA).toBe('video')
  })
})

// ---- the guard ---------------------------------------------------------------------------------------------------

describe('the guard of the recorder', () => {
  it.each(['http://localhost:3600', 'http://127.0.0.1:3600', 'http://localhost'])('lets %s through, with its scratch schema', (baseURL) => {
    expect(assertLocalVideo({ baseURL, schema: 'video' })).toMatchObject({ schema: 'video' })
  })

  it.each([
    'https://example.com',
    'http://example.com:3600',
    'https://localhost:3600',
    'http://192.168.1.20:3600',
    'http://0.0.0.0:3600',
    'http://[::1]:3600',
    'http://localhost.example.com',
    'http://localhost@example.com',
    'localhost:3600',
    '',
    undefined,
  ])('refuses the address %j, and says why', (baseURL) => {
    expect(() => assertLocalVideo({ baseURL, schema: 'video' })).toThrow(/^Refusing to record the video/)
  })

  it.each(['e2e', 'screenshots', 'ui_review', 'perf', 'perf_api', 'perf_screens', 'public', 'neon_auth', 'dev_ui', '', undefined, 'Video', 'a-b'])(
    'refuses the schema %j on a local address',
    (schema) => {
      expect(() => assertLocalVideo({ baseURL: 'http://localhost:3600', schema })).toThrow(/^Refusing to record the video/)
    },
  )

  it("names the other tool whose schema it is", () => {
    expect(() => assertLocalVideo({ baseURL: 'http://localhost:3600', schema: 'e2e' })).toThrow(/E2E run's/)
    expect(() => assertLocalVideo({ baseURL: 'http://localhost:3600', schema: 'screenshots' })).toThrow(/README screenshots'/)
  })
})

// ---- the frames are never committed ------------------------------------------------------------------------------

describe('the frames of the recorder', () => {
  it('go to a folder that .gitignore covers', () => {
    expect(VIDEO_OUT_DIR).toBe('video/out')
    const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)
    expect(lines).toContain(`${VIDEO_OUT_DIR}/`)
  })

  it('are not tracked by git', () => {
    const result = spawnSync('git', ['ls-files', VIDEO_OUT_DIR], { cwd: root, encoding: 'utf8', timeout: 30_000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})
