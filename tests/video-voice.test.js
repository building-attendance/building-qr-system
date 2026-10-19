// The narrator of the provider tutorial video (scripts/video/voice.mjs, its providers and timings.mjs). No network and no
// database: the outside service is a fake HTTP layer, the published site a fake fetch, and every run writes into a folder of its
// own under the system's temporary folder. What is held: timings.json for the composer, the cache (a hit, a miss, a changed line,
// the published site first), the budget that stops before the call that would pass it, a missing recording, the length of an mp3,
// and that the key never reaches an output (a log, an error, a file).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasSecretWord } from '../shared/secretLike.js'
import { SAMPLE_PROVIDER_NAMES } from '../scripts/sample-data.mjs'
import { LANGUAGES } from '../video/script/index.js'
import { beatsWithLines } from '../scripts/video/script.mjs'
import { PAUSE_SECONDS, buildTimings, mp3Seconds, spokenSeconds } from '../scripts/video/timings.mjs'
import { DEFAULT_BUDGET, PUBLISHED_VOICE_CACHE, cacheKey, lineProblems, main, runVoice, scriptLines, siteCache } from '../scripts/video/voice.mjs'
import { ELEVENLABS_API, ELEVENLABS_DEFAULTS, elevenlabsProvider, elevenlabsSettings, keyIsSet, readKey } from '../scripts/video/voice-providers/elevenlabs.mjs'
import { RECORDING_MODEL, RECORDING_VOICE, filesProvider } from '../scripts/video/voice-providers/files.mjs'
import { noneProvider } from '../scripts/video/voice-providers/none.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

// A made-up key, different on every run, so that finding it in an output can only mean that the narrator wrote it there.
const KEY = ['fake', 'elevenlabs', 'key', 'for', 'tests', String(Date.now())].join('-')

/**
 * The bytes of an mp3 of `frames` silent frames: MPEG-1 layer III, 128 kbit/s, 44,100 Hz, no padding (417 bytes and 1152 samples
 * a frame), so it runs frames * 1152 / 44100 seconds.
 */
function fakeMp3(frames) {
  const frame = new Uint8Array(417)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  const bytes = new Uint8Array(417 * frames)
  for (let i = 0; i < frames; i++) bytes.set(frame, i * 417)
  return bytes
}
const FRAME_SECONDS = 1152 / 44100

/** A narrator that speaks through nothing: it counts its calls and answers an mp3 a frame per character. */
function fakeNarrator({ voice = 'fake-voice', model = 'fake-model' } = {}) {
  const calls = []
  return {
    calls,
    provider: {
      name: 'elevenlabs',
      kind: 'synthesize',
      voice,
      model,
      label: `fake (model ${model}, voice ${voice})`,
      async synthesize(line) {
        calls.push(line)
        return fakeMp3([...line.text].length)
      },
    },
  }
}

/** A Response of the fetch API. */
const answer = (status, body = null, headers = {}) => new Response(body, { status, headers })

let out
let logs
const log = (line) => logs.push(line)
beforeEach(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'video-voice-'))
  logs = []
})
afterEach(() => {
  fs.rmSync(out, { recursive: true, force: true })
})

const readTimings = (lang = 'he') => JSON.parse(fs.readFileSync(path.join(out, lang, 'timings.json'), 'utf8'))

/** Every file under a folder, as text (an mp3 too: the key would show in it all the same). */
function everyFile(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
}

// ---- timings.json without a voice -------------------------------------------------------------------------------

describe('with no voice', () => {
  it('writes timings.json from the seconds of the script, every line without audio, and says "voice: none"', async () => {
    await runVoice({ lang: 'he', provider: noneProvider(), outRoot: out, log })
    const timings = readTimings()
    expect(timings.lang).toBe('he')
    expect(timings.voice).toBe('none')
    const withLines = beatsWithLines()
    expect(Object.keys(timings.beats)).toEqual(withLines.map((beat) => beat.id))
    for (const beat of withLines) expect(timings.beats[beat.id]).toEqual({ seconds: beat.seconds, audio: null })
    expect(logs).toContain('voice: none')
    expect(fs.readdirSync(path.join(out, 'he', 'voice')).filter((name) => name.endsWith('.mp3'))).toEqual([])
    expect(fs.readFileSync(path.join(out, 'he', 'voice', 'index.html'), 'utf8')).toContain('(no audio)')
  })

  it('leaves out every beat that continues the line before it', async () => {
    await runVoice({ lang: 'he', provider: noneProvider(), outRoot: out, log })
    for (const id of ['sent', 'language-en', 'language-ru', 'language-ar']) expect(readTimings().beats).not.toHaveProperty(id)
  })

  it('is what the command does when no key is set, and it exits 0', () => {
    const env = { ...process.env }
    for (const name of ['ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY_FILE']) delete env[name]
    const run = spawnSync(process.execPath, ['scripts/video/voice.mjs', 'he', '--out', out], { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout.split(/\r?\n/)).toContain('voice: none')
    expect(readTimings().voice).toBe('none')
  })

  it('is run by npm run video:voice', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['video:voice']).toBe('node scripts/video/voice.mjs')
  })
})

// ---- the cache --------------------------------------------------------------------------------------------------

describe('the cache', () => {
  it('synthesizes every line once, and a second run makes no call', async () => {
    const narrator = fakeNarrator()
    const first = await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, log })
    const lines = scriptLines('he')
    expect(narrator.calls.map((call) => call.id)).toEqual(lines.map((line) => line.id))
    expect(narrator.calls.every((call) => call.lang === 'he')).toBe(true)
    expect(first.counts.synthesized).toBe(lines.length)

    const second = await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, log })
    expect(narrator.calls).toHaveLength(lines.length)
    expect(second.counts).toMatchObject({ synthesized: 0, cache: lines.length, characters: 0 })
    expect(logs[logs.length - 2]).toMatch(/0 synthesized \(0 of a budget of 3000 characters\)/)
  })

  it('writes the real length of each line plus the pause, and its audio beside timings.json', async () => {
    const narrator = fakeNarrator()
    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, log })
    const timings = readTimings()
    expect(timings.voice).toBe('elevenlabs')
    for (const line of scriptLines('he')) {
      const beat = timings.beats[line.id]
      expect(beat.audio).toBe(`${line.id}.mp3`)
      expect(beat.seconds).toBeCloseTo([...line.text].length * FRAME_SECONDS + PAUSE_SECONDS, 3)
      expect(fs.existsSync(path.join(out, 'he', 'voice', beat.audio))).toBe(true)
    }
    const page = fs.readFileSync(path.join(out, 'he', 'voice', 'index.html'), 'utf8')
    expect(page.match(/<audio /g)).toHaveLength(scriptLines('he').length)
  })

  it('speaks again only the line whose text changed', async () => {
    const narrator = fakeNarrator()
    const lines = [
      { id: 'one', seconds: 2, text: 'first line' },
      { id: 'two', seconds: 2, text: 'second line' },
    ]
    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, log })
    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines: [lines[0], { ...lines[1], text: 'second line, changed' }], log })
    expect(narrator.calls.map((call) => call.text)).toEqual(['first line', 'second line', 'second line, changed'])
  })

  it('speaks every line again for another voice or another model', async () => {
    const lines = [{ id: 'one', seconds: 2, text: 'first line' }]
    await runVoice({ lang: 'he', provider: fakeNarrator().provider, outRoot: out, lines, log })
    const otherVoice = fakeNarrator({ voice: 'another-voice' })
    const otherModel = fakeNarrator({ model: 'another-model' })
    await runVoice({ lang: 'he', provider: otherVoice.provider, outRoot: out, lines, log })
    await runVoice({ lang: 'he', provider: otherModel.provider, outRoot: out, lines, log })
    expect(otherVoice.calls).toHaveLength(1)
    expect(otherModel.calls).toHaveLength(1)
  })

  it('keys a line by its text, voice, model and language together', () => {
    const base = { text: 'a line', voice: 'v', model: 'm', lang: 'he' }
    const keys = new Set([base, { ...base, text: 'a line.' }, { ...base, voice: 'w' }, { ...base, model: 'n' }, { ...base, lang: 'en' }].map(cacheKey))
    expect(keys.size).toBe(5)
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(cacheKey({ ...base })).toBe(cacheKey(base))
  })

  it('takes a line from the published site first, keeps it in the local cache, and sends the site no credential', async () => {
    const lines = [
      { id: 'one', seconds: 2, text: 'first line' },
      { id: 'two', seconds: 2, text: 'second line' },
    ]
    const narrator = fakeNarrator()
    const published = cacheKey({ text: 'first line', voice: narrator.provider.voice, model: narrator.provider.model, lang: 'he' })
    const asked = []
    const fetch = async (url, init) => {
      asked.push({ url: String(url), init })
      return String(url).endsWith(`/${published}.mp3`) ? answer(200, fakeMp3(40)) : answer(404)
    }
    const site = siteCache({ url: 'https://example.test/video/voice-cache', fetch, log })
    const result = await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, site, log })
    expect(narrator.calls.map((call) => call.id)).toEqual(['two'])
    expect(result.counts).toMatchObject({ site: 1, synthesized: 1 })
    expect(asked.map((request) => request.url)).toEqual([
      `https://example.test/video/voice-cache/${published}.mp3`,
      `https://example.test/video/voice-cache/${cacheKey({ text: 'second line', voice: 'fake-voice', model: 'fake-model', lang: 'he' })}.mp3`,
    ])
    for (const request of asked) expect(JSON.stringify(request.init ?? {})).not.toMatch(/xi-api-key|authorization/i)
    expect(fs.existsSync(path.join(out, 'voice-cache', `${published}.mp3`))).toBe(true)
    expect(readTimings().beats.one.seconds).toBeCloseTo(spokenSeconds(40 * FRAME_SECONDS), 3)
  })

  it('stops asking a site that cannot be reached, and falls back to the local cache', async () => {
    const lines = [{ id: 'one', seconds: 2, text: 'first line' }, { id: 'two', seconds: 2, text: 'second line' }]
    const narrator = fakeNarrator()
    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, log })
    let asked = 0
    const fetch = async () => {
      asked += 1
      throw new TypeError('fetch failed')
    }
    const result = await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, site: siteCache({ url: PUBLISHED_VOICE_CACHE, fetch, log }), log })
    expect(asked).toBe(1)
    expect(result.counts).toMatchObject({ site: 0, cache: 2, synthesized: 0 })
  })

  it('falls back when the site breaks off an answer, and refuses an answer that is too large', async () => {
    const lines = [{ id: 'one', seconds: 2, text: 'first line' }, { id: 'two', seconds: 2, text: 'second line' }]
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xfb]))
        controller.error(new DOMException('timed out', 'TimeoutError'))
      },
    })
    const narrator = fakeNarrator()
    const breaking = siteCache({ url: PUBLISHED_VOICE_CACHE, fetch: async () => new Response(broken), log })
    const result = await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, site: breaking, log })
    expect(result.counts).toMatchObject({ site: 0, synthesized: 2 })
    expect(logs).toContain('voice: the published site broke off an answer (TimeoutError); only the local cache from now on')

    const huge = siteCache({ url: PUBLISHED_VOICE_CACHE, fetch: async () => answer(200, new Uint8Array(11 * 1024 * 1024)) })
    expect(await huge.get('a'.repeat(64))).toBeNull()
  })

  it('leaves the last good timings.json and its audio as they were when a run stops', async () => {
    const lines = [{ id: 'one', seconds: 2, text: 'first line' }]
    await runVoice({ lang: 'he', provider: fakeNarrator().provider, outRoot: out, lines, log })
    const before = fs.readFileSync(path.join(out, 'he', 'timings.json'), 'utf8')
    const changed = [{ id: 'one', seconds: 2, text: 'first line, changed' }]
    await expect(runVoice({ lang: 'he', provider: fakeNarrator().provider, outRoot: out, lines: changed, budget: 1, log })).rejects.toThrow(/budget/)
    expect(fs.readFileSync(path.join(out, 'he', 'timings.json'), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(out, 'he', 'voice', 'one.mp3'))).toBe(true)
  })

  it('writes only under a language code', async () => {
    await expect(runVoice({ lang: '../x', provider: noneProvider(), outRoot: out, lines: [], log })).rejects.toThrow(/not a language code/)
  })

  it('refuses a site that is not https', () => {
    expect(() => siteCache({ url: 'http://example.test/cache/' })).toThrow(/not an https address/)
    expect(siteCache({ url: '' })).toBeNull()
  })

  it('does not trust a cached file that is not an mp3', async () => {
    const lines = [{ id: 'one', seconds: 2, text: 'first line' }]
    const narrator = fakeNarrator()
    const hash = cacheKey({ text: 'first line', voice: 'fake-voice', model: 'fake-model', lang: 'he' })
    fs.mkdirSync(path.join(out, 'voice-cache'), { recursive: true })
    fs.writeFileSync(path.join(out, 'voice-cache', `${hash}.mp3`), 'not audio')
    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, log })
    expect(narrator.calls).toHaveLength(1)
  })
})

// ---- the budget -------------------------------------------------------------------------------------------------

describe('the budget of a run', () => {
  it('is 3,000 characters unless the run asks for another', () => {
    expect(DEFAULT_BUDGET).toBe(3000)
  })

  it('stops before the call that would pass it, keeps what was spoken, and a later run goes on from there', async () => {
    const lines = [
      { id: 'one', seconds: 2, text: 'a'.repeat(10) },
      { id: 'two', seconds: 2, text: 'b'.repeat(10) },
      { id: 'three', seconds: 2, text: 'c'.repeat(10) },
    ]
    const narrator = fakeNarrator()
    await expect(runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, budget: 25, log })).rejects.toThrow(
      /budget of this run is 25 characters, and the line "three" \(10\) would pass it after 20/,
    )
    expect(narrator.calls.map((call) => call.id)).toEqual(['one', 'two'])
    expect(fs.existsSync(path.join(out, 'he', 'timings.json'))).toBe(false)

    await runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines, budget: 10, log })
    expect(narrator.calls.map((call) => call.id)).toEqual(['one', 'two', 'three'])
  })

  it('makes no call at all when the first line is over it', async () => {
    const narrator = fakeNarrator()
    await expect(runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, budget: 0, log })).rejects.toThrow(/budget/)
    expect(narrator.calls).toEqual([])
  })

  it('is a whole number', async () => {
    await expect(runVoice({ lang: 'he', provider: noneProvider(), outRoot: out, budget: -1, log })).rejects.toThrow(/whole number/)
    expect(await main(['he', '--voice', 'none', '--budget', 'lots', '--out', out], {}, log, log)).toBe(1)
    expect(logs).toContain('voice: --budget is not a whole number of characters.')
  })
})

// ---- the recordings ---------------------------------------------------------------------------------------------

describe('the recorded voice', () => {
  const lines = [
    { id: 'one', seconds: 2, text: 'first line' },
    { id: 'two', seconds: 2, text: 'second line' },
  ]
  const hashOf = (text) => cacheKey({ text, voice: RECORDING_VOICE, model: RECORDING_MODEL, lang: 'he' })

  it('fails on a missing recording with the line id, its text and the file it needs, never a silent gap', async () => {
    const dir = path.join(out, 'recordings')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, `${hashOf('first line')}.mp3`), fakeMp3(30))
    const run = runVoice({ lang: 'he', provider: filesProvider({ dir }), outRoot: out, lines, log })
    await expect(run).rejects.toThrow(`"two": ${hashOf('second line')}.mp3 for "second line"`)
    await expect(run).rejects.toThrow(/^1 line\(s\) have no recording/)
    expect(fs.existsSync(path.join(out, 'he', 'timings.json'))).toBe(false)
    // The page lists every file a recording must have, for the person who records them.
    expect(fs.readFileSync(path.join(out, 'he', 'voice', 'index.html'), 'utf8')).toContain(`${hashOf('second line')}.mp3`)
  })

  it('times every line by its recording when all of them are there', async () => {
    const dir = path.join(out, 'recordings')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, `${hashOf('first line')}.mp3`), fakeMp3(30))
    fs.writeFileSync(path.join(dir, `${hashOf('second line')}.mp3`), fakeMp3(60))
    await runVoice({ lang: 'he', provider: filesProvider({ dir }), outRoot: out, lines, log })
    const timings = readTimings()
    expect(timings.voice).toBe('files')
    expect(timings.beats.two).toEqual({ seconds: spokenSeconds(60 * FRAME_SECONDS), audio: 'two.mp3' })
  })

  it('refuses a recording that is not an mp3', async () => {
    const dir = path.join(out, 'recordings')
    fs.mkdirSync(dir)
    for (const line of lines) fs.writeFileSync(path.join(dir, `${hashOf(line.text)}.mp3`), 'a voice memo')
    await expect(runVoice({ lang: 'he', provider: filesProvider({ dir }), outRoot: out, lines, log })).rejects.toThrow(/"one".*is not an mp3/)
  })
})

// ---- the ElevenLabs provider, against a fake HTTP layer -----------------------------------------------------------

describe('the ElevenLabs narrator', () => {
  /** A fake fetch that records the requests and answers each with `respond`. */
  function fakeHttp(respond) {
    const requests = []
    const fetch = async (url, init) => {
      requests.push({ url: String(url), init })
      return respond(url, init)
    }
    return { requests, fetch }
  }

  it('asks the text-to-speech API for an mp3 of the line, with the key in its header only', async () => {
    const http = fakeHttp(() => answer(200, fakeMp3(20), { 'content-type': 'audio/mpeg' }))
    const provider = elevenlabsProvider({ key: KEY, fetch: http.fetch })
    const audio = await provider.synthesize({ id: 'intro', text: 'a line to say', lang: 'he' })
    expect(mp3Seconds(audio)).toBeCloseTo(20 * FRAME_SECONDS, 6)
    const [request] = http.requests
    expect(request.url).toBe(`${ELEVENLABS_API}/v1/text-to-speech/${ELEVENLABS_DEFAULTS.voice}?output_format=mp3_44100_128`)
    expect(request.init.method).toBe('POST')
    expect(request.init.redirect).toBe('error')
    expect(request.init.headers['xi-api-key']).toBe(KEY)
    expect(JSON.parse(request.init.body)).toEqual({ text: 'a line to say', model_id: ELEVENLABS_DEFAULTS.model, language_code: 'he' })
    expect(request.url).not.toContain(KEY)
    expect(request.init.body).not.toContain(KEY)
  })

  it('does not send a language code to a multilingual v2 model, which refuses it', async () => {
    const http = fakeHttp(() => answer(200, fakeMp3(5)))
    await elevenlabsProvider({ key: KEY, model: 'eleven_multilingual_v2', fetch: http.fetch }).synthesize({ id: 'x', text: 'y', lang: 'he' })
    expect(JSON.parse(http.requests[0].init.body)).toEqual({ text: 'y', model_id: 'eleven_multilingual_v2' })
  })

  it('has the defaults of the topic plan, and takes another model or voice from the environment', () => {
    expect(ELEVENLABS_DEFAULTS).toMatchObject({ model: 'eleven_v4', voice: 'Eeft0b98WgvueYFzGZAg' })
    expect(elevenlabsSettings({})).toEqual({ model: 'eleven_v4', voice: 'Eeft0b98WgvueYFzGZAg' })
    expect(elevenlabsSettings({ ELEVENLABS_MODEL: 'eleven_v3', ELEVENLABS_VOICE_ID: 'abc123' })).toEqual({ model: 'eleven_v3', voice: 'abc123' })
    expect(() => elevenlabsSettings({ ELEVENLABS_VOICE_ID: '../voices' })).toThrow(/ELEVENLABS_VOICE_ID/)
  })

  it.each([
    ['a refusal', () => answer(401, JSON.stringify({ detail: { message: `invalid key ${KEY}` } })), /^ElevenLabs answered 401 for the line "intro"\.$/],
    ['a server error', () => answer(500, `trace with ${KEY}`), /^ElevenLabs answered 500 for the line "intro"\.$/],
    ['a network failure', () => Promise.reject(new TypeError(`fetch failed for ${KEY}`)), /^ElevenLabs could not be reached for the line "intro" \(TypeError\)\.$/],
  ])('fails on %s with the status and the line id only, never what the service answered', async (_, respond, message) => {
    const provider = elevenlabsProvider({ key: KEY, fetch: fakeHttp(respond).fetch })
    const error = await provider.synthesize({ id: 'intro', text: 'a line', lang: 'he' }).catch((err) => err)
    expect(error.message).toMatch(message)
    expect(error.message).not.toContain(KEY)
  })

  it('refuses an answer that is not an mp3', async () => {
    const provider = elevenlabsProvider({ key: KEY, fetch: async () => answer(200, '{"audio_base64": "..."}') })
    await expect(runVoice({ lang: 'he', provider, outRoot: out, lines: [{ id: 'one', seconds: 1, text: 'x' }], log })).rejects.toThrow(
      /audio for the line "one" is not an mp3/,
    )
  })

  it('keeps the key out of the provider, so printing it shows nothing', () => {
    const provider = elevenlabsProvider({ key: KEY, fetch: async () => answer(200) })
    expect(JSON.stringify(provider)).not.toContain(KEY)
    expect(provider.label).not.toContain(KEY)
    expect(() => elevenlabsProvider({ key: '' })).toThrow(/needs a key/)
  })
})

// ---- the key ----------------------------------------------------------------------------------------------------

describe('the key', () => {
  it('comes from ELEVENLABS_API_KEY or from the file that ELEVENLABS_API_KEY_FILE names, and is null without either', () => {
    expect(readKey({})).toBeNull()
    expect(readKey({ ELEVENLABS_API_KEY: '  ' })).toBeNull()
    expect(keyIsSet({})).toBe(false)
    expect(readKey({ ELEVENLABS_API_KEY: ` ${KEY}\n` })).toBe(KEY)
    const file = path.join(out, 'key.txt')
    fs.writeFileSync(file, `${KEY}\r\n`)
    expect(readKey({ ELEVENLABS_API_KEY_FILE: file })).toBe(KEY)
    expect(keyIsSet({ ELEVENLABS_API_KEY_FILE: file })).toBe(true)
  })

  it('reads a key file that Windows PowerShell wrote (UTF-16 or UTF-8 with a byte order mark)', () => {
    const utf16 = path.join(out, 'utf16.key')
    fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${KEY}\r\n`, 'utf16le')]))
    expect(readKey({ ELEVENLABS_API_KEY_FILE: utf16 })).toBe(KEY)
    const bom = path.join(out, 'bom.key')
    fs.writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(KEY)]))
    expect(readKey({ ELEVENLABS_API_KEY_FILE: bom })).toBe(KEY)
  })

  it('is refused when both variables are set, or when it is not the shape of a key, without saying what it holds', () => {
    const file = path.join(out, 'key.txt')
    fs.writeFileSync(file, KEY)
    const refusals = [
      () => readKey({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_KEY_FILE: file }),
      () => readKey({ ELEVENLABS_API_KEY: `${KEY} ${KEY}` }),
      () => readKey({ ELEVENLABS_API_KEY_FILE: path.join(out, 'missing.key') }),
    ]
    for (const refusal of refusals) {
      let message = ''
      try {
        refusal()
      } catch (err) {
        message = err.message
      }
      expect(message).toMatch(/ELEVENLABS_API_KEY/)
      expect(message).not.toContain(KEY)
      expect(message).not.toContain(out)
    }
  })

  it('never reaches a log, an error or a file of a run, whether the service answers or refuses', async () => {
    let calls = 0
    const fetch = async () => (++calls <= 2 ? answer(200, fakeMp3(10)) : answer(429, `quota of ${KEY}`))
    const provider = elevenlabsProvider({ key: KEY, fetch })
    const lines = [{ id: 'one', seconds: 1, text: 'first' }, { id: 'two', seconds: 1, text: 'second' }]
    await runVoice({ lang: 'he', provider, outRoot: out, lines, log })
    const failure = await runVoice({ lang: 'he', provider, outRoot: out, lines: [...lines, { id: 'three', seconds: 1, text: 'third' }], log }).catch((err) => err)
    expect(failure.message).toBe('ElevenLabs answered 429 for the line "three".')
    const outputs = [...logs, failure.message, ...everyFile(out).filter((file) => !file.endsWith('key.txt')).map((file) => fs.readFileSync(file, 'latin1'))]
    expect(outputs.length).toBeGreaterThan(5)
    for (const output of outputs) expect(output).not.toContain(KEY)
  })

  describe('in the command', () => {
    const run = (args, extra) => {
      const env = { ...process.env, VIDEO_VOICE_CACHE_URL: '', ...extra }
      for (const name of ['ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY_FILE']) if (!(name in extra)) delete env[name]
      return spawnSync(process.execPath, ['scripts/video/voice.mjs', 'he', '--out', out, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
    }

    it('chooses ElevenLabs when a key is set, and stops at the budget before any call, printing no part of the key', () => {
      const result = run(['--budget', '1'], { ELEVENLABS_API_KEY: KEY })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('voice: elevenlabs (model eleven_v4, voice Eeft0b98WgvueYFzGZAg)')
      expect(result.stderr).toMatch(/budget of this run is 1 characters/)
      expect(result.stdout + result.stderr).not.toContain(KEY)
      expect(result.stdout + result.stderr).not.toContain(KEY.slice(0, 12))
    })

    it('reads the key from a file, and prints neither the key nor the file', () => {
      const file = path.join(out, 'key.txt')
      fs.writeFileSync(file, KEY)
      const result = run(['--budget', '1'], { ELEVENLABS_API_KEY_FILE: file })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('voice: elevenlabs')
      expect(result.stdout + result.stderr).not.toContain(KEY)
    })

    it('refuses both variables at once, before anything else', () => {
      const file = path.join(out, 'key.txt')
      fs.writeFileSync(file, KEY)
      const result = run([], { ELEVENLABS_API_KEY: KEY, ELEVENLABS_API_KEY_FILE: file })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Both ELEVENLABS_API_KEY and ELEVENLABS_API_KEY_FILE are set')
      expect(result.stdout + result.stderr).not.toContain(KEY)
      expect(fs.existsSync(path.join(out, 'he'))).toBe(false)
    })

    it('takes the key out of the environment once it is read', async () => {
      const env = { ELEVENLABS_API_KEY: KEY, VIDEO_VOICE_CACHE_URL: '' }
      expect(await main(['he', '--budget', '0', '--out', out], env, log, log)).toBe(1)
      expect(env).not.toHaveProperty('ELEVENLABS_API_KEY')
      for (const line of logs) expect(line).not.toContain(KEY)
    })

    it('refuses --voice elevenlabs without a key, and an unknown voice', async () => {
      expect(await main(['he', '--voice', 'elevenlabs', '--out', out], {}, log, log)).toBe(1)
      expect(await main(['he', '--voice', 'piper', '--out', out], {}, log, log)).toBe(1)
      expect(logs).toContain('voice: --voice elevenlabs needs a key in ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_FILE.')
      expect(logs).toContain('voice: --voice is one of elevenlabs, files, none, not "piper".')
    })
  })
})

// ---- what is sent to the outside service --------------------------------------------------------------------------

describe('the lines sent to a narrator', () => {
  const everyLine = LANGUAGES.flatMap((lang) => scriptLines(lang).map((line) => ({ lang, ...line })))

  it.each(everyLine.map((line) => [line.lang, line.id, line.text]))('%s "%s" holds nothing that looks like a secret or contact data', (_, __, text) => {
    expect(hasSecretWord(text)).toBe(false)
    expect(lineProblems(text)).toEqual([])
  })

  it.each(everyLine.map((line) => [line.lang, line.id, line.text]))('%s "%s" names no person', (_, __, text) => {
    // The sample people of the dev seed (scripts/sample-data.mjs, scripts/dev-seed.mjs): the picture may show them, the narration
    // never says a name. And no pair of capitalised words, the shape of a first and a last name in a Latin script.
    for (const name of [...Object.values(SAMPLE_PROVIDER_NAMES), 'John', 'Иван', 'Dev Admin']) expect(text).not.toContain(name)
    expect(text).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/)
  })

  it('refuses a line with a secret, an e-mail, a web address or a phone number, before any call', async () => {
    expect(lineProblems('call 050-1234567')).toEqual(['a long number'])
    expect(lineProblems('write to someone@example.test')).toEqual(['an e-mail address'])
    expect(lineProblems('see https://example.test')).toEqual(['a web address'])
    expect(lineProblems('the token abc_def123ghi')).toEqual(['a word that looks like a secret'])
    const narrator = fakeNarrator()
    await expect(runVoice({ lang: 'he', provider: narrator.provider, outRoot: out, lines: [{ id: 'one', seconds: 1, text: 'key abc_def123ghi' }], log })).rejects.toThrow(
      /"one" is not sent to a narrator/,
    )
    expect(narrator.calls).toEqual([])
  })
})

// ---- the length of an mp3, and timings.json ------------------------------------------------------------------------

describe('the length of an mp3', () => {
  it('is the sum of its frames', () => {
    expect(mp3Seconds(fakeMp3(100))).toBeCloseTo(100 * FRAME_SECONDS, 9)
  })

  it('skips an ID3v2 tag in front and an ID3v1 tag behind', () => {
    const tag = new Uint8Array(10 + 300)
    tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 2, 44]) // "ID3", version 4, size 300 as a syncsafe integer (2 * 128 + 44)
    tag.fill(0xff, 10) // a body that would read as frame sync if the tag were not skipped
    const tail = new TextEncoder().encode('TAG'.padEnd(128, ' '))
    const bytes = new Uint8Array([...tag, ...fakeMp3(10), ...tail])
    expect(mp3Seconds(bytes)).toBeCloseTo(10 * FRAME_SECONDS, 9)
  })

  it('reads MPEG-2 frames (half the samples)', () => {
    // MPEG-2 layer III, 64 kbit/s, 24,000 Hz: 72 * 64000 / 24000 = 192 bytes and 576 samples a frame.
    const frame = new Uint8Array(192)
    frame.set([0xff, 0xf3, 0x84, 0x00])
    const bytes = new Uint8Array(192 * 50)
    for (let i = 0; i < 50; i++) bytes.set(frame, i * 192)
    expect(mp3Seconds(bytes)).toBeCloseTo((50 * 576) / 24000, 9)
  })

  it('refuses other audio that holds a few bytes that read as a frame header', () => {
    const wav = new Uint8Array(20000).fill(0x11)
    for (let at = 1000; at < 20000; at += 3000) wav.set([0xff, 0xfb, 0x90, 0x00], at) // six stray headers, 417 bytes each
    expect(() => mp3Seconds(wav)).toThrow(/not an mp3/)
  })

  it('refuses what is not an mp3', () => {
    expect(() => mp3Seconds(new TextEncoder().encode('{"audio_base64": "..."}'))).toThrow(/not an mp3/)
    expect(() => mp3Seconds(new Uint8Array(0))).toThrow(/not an mp3/)
  })
})

describe('timings.json', () => {
  it('has the shape of the contract with the composer', () => {
    expect(buildTimings('he', 'files', [{ id: 'a', seconds: 1.23456, audio: 'a.mp3' }, { id: 'b', seconds: 2, audio: null }])).toEqual({
      lang: 'he',
      voice: 'files',
      beats: { a: { seconds: 1.235, audio: 'a.mp3' }, b: { seconds: 2, audio: null } },
    })
    expect(() => buildTimings('he', 'piper', [])).toThrow(/not a voice/)
  })

  it('adds a pause of about half a second after a spoken line', () => {
    expect(PAUSE_SECONDS).toBe(0.5)
    expect(spokenSeconds(2.0004)).toBe(2.5)
  })
})
