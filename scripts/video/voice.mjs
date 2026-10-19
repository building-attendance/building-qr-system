// The narrator of the provider tutorial video: `npm run video:voice -- <lang>` gives every line of the script an audio file and
// writes video/out/<lang>/timings.json for the composer (the contract is in scripts/video/timings.mjs), and a page with one audio
// element per line (video/out/<lang>/voice/index.html) for a first listen.
//
//   node scripts/video/voice.mjs he [--voice elevenlabs|files|none] [--budget <characters>] [--out <folder>] [--recordings <folder>]
//
// - The lines are the `say` lines of video/script/, with every `{key}` resolved to the app's label and, in Hebrew, every word with its
//   vowel points from video/script/he-niqqud.js (spokenLine of scripts/video/script.mjs), so that a renamed button is spoken again.
//   No frames are needed.
// - The voice: `elevenlabs` when a key is in the environment (ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_FILE, see
//   voice-providers/elevenlabs.mjs), else `none`, which needs no secret and writes the seconds of the script. `files` takes a
//   recording per line (voice-providers/files.mjs), from --recordings or VIDEO_RECORDINGS_DIR, by default video/recordings/<lang>/.
// - A line is synthesized only when its text, voice or model changed: the cache key is a hash of the three and the language
//   (cacheKey). A line is
//   looked up on the last published site first (VIDEO_VOICE_CACHE_URL, by default PUBLISHED_VOICE_CACHE; empty turns it off), so
//   that the video keeps the take that was published, then in video/out/voice-cache/. Whatever is synthesized or fetched goes into
//   that local cache at once, so that a run that stops loses nothing that it paid for.
// - A budget of characters per run (--budget, by default DEFAULT_BUDGET): the run stops before the call that would pass it.
// - The run prints counts, the provider's model and voice, and file names; never the key, never what a service answered.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { hasSecretWord } from '../../shared/secretLike.js'
import { LANGUAGES, SCRIPTS } from '../../video/script/index.js'
import { beatsWithLines, spokenLine } from './script.mjs'
import { ROOT, VIDEO_OUT_DIR } from './settings.mjs'
import { buildTimings, mp3Seconds, spokenSeconds } from './timings.mjs'
import { KEY_FILE_VARIABLE, KEY_VARIABLE, elevenlabsProvider, elevenlabsSettings, keyIsSet, readKey } from './voice-providers/elevenlabs.mjs'
import { filesProvider } from './voice-providers/files.mjs'
import { readCapped } from './voice-providers/http.mjs'
import { noneProvider } from './voice-providers/none.mjs'

/** The characters that one run may send to a paid narrator. The whole Hebrew script is under 800 (19/10/2026). */
export const DEFAULT_BUDGET = 3000

/**
 * Where the last published video keeps the audio of its lines, one `<hash>.mp3` per line: the folder video/out/voice-cache/ of
 * the run that published it, deployed beside the video (T4).
 */
export const PUBLISHED_VOICE_CACHE = 'https://building-attendance.github.io/building-qr-system/video/voice-cache/'

/** The local cache, in the output folder: shared by the languages, since the key holds the language. */
export const CACHE_DIR_NAME = 'voice-cache'

/** The folder, in a language's output folder, of the audio that timings.json names, and of the listening page. */
export const VOICE_DIR_NAME = 'voice'

/** The largest file accepted from the published site. */
const MAX_SITE_BYTES = 10 * 1024 * 1024
const SITE_TIMEOUT_MS = 15_000
const HASH = /^[0-9a-f]{64}$/

/**
 * The cache key of a line: a hash of what is said, by which voice, with which model, and in which language (the narrator is told
 * the language, so the same words in two languages are two takes). A change of any of them is a new key, and so a new synthesis
 * (or a new recording).
 * @param {{ text: string, voice: string | null, model: string | null, lang: string }} line
 */
export function cacheKey({ text, voice, model, lang }) {
  return createHash('sha256').update(JSON.stringify({ text, voice, model, lang })).digest('hex')
}

/**
 * The lines of one language, in the order of the video: every beat that has a line of its own, with its say line as the narrator
 * reads it (labels resolved, Hebrew vowelled) and its planned seconds.
 * @param {string} lang
 */
export function scriptLines(lang) {
  if (!LANGUAGES.includes(lang)) throw new Error(`The video script has no language "${lang}" (video/script/index.js has ${LANGUAGES.join(', ')}).`)
  return beatsWithLines().map((beat) => ({ id: beat.id, seconds: beat.seconds, text: spokenLine(lang, SCRIPTS[lang][beat.id].say) }))
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const WEB_ADDRESS = /https?:\/\/|www\./i
const LONG_NUMBER = /\d[\d\s().-]{5,}\d/

/**
 * What makes a line unfit to send to an outside service: the script is fixed text written by us, so a line that holds something
 * that looks like a secret (shared/secretLike.js), an e-mail, a web address or a long number (a phone, an id) is a mistake.
 * @param {string} text
 */
export function lineProblems(text) {
  const problems = []
  if (hasSecretWord(text)) problems.push('a word that looks like a secret')
  if (EMAIL.test(text)) problems.push('an e-mail address')
  if (WEB_ADDRESS.test(text)) problems.push('a web address')
  if (LONG_NUMBER.test(text)) problems.push('a long number')
  return problems
}

/**
 * The published site as a cache: `get(hash)` gives the mp3 of a line, or null when the site has none (or cannot be reached: after
 * the first network failure it is not asked again in this run). It sends no credential. Null when `url` is empty.
 * @param {{ url: string | undefined, fetch?: typeof globalThis.fetch, log?: (line: string) => void }} options
 */
export function siteCache({ url, fetch = globalThis.fetch, log = () => {} }) {
  if (!url) return null
  const base = new URL(url.endsWith('/') ? url : `${url}/`)
  const local = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)
  if (base.protocol !== 'https:' && !local) throw new Error('VIDEO_VOICE_CACHE_URL is not an https address.')
  let reachable = true
  return {
    url: base.href,
    async get(hash) {
      if (!reachable || !HASH.test(hash)) return null
      let res
      try {
        res = await fetch(new URL(`${hash}.mp3`, base), { signal: AbortSignal.timeout(SITE_TIMEOUT_MS) })
      } catch (err) {
        reachable = false
        log(`voice: the published site cannot be reached (${err?.name ?? 'Error'}); only the local cache from now on`)
        return null
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        if (res.status !== 404) log(`voice: the published site answered ${res.status} for a line; it is taken from elsewhere`)
        return null
      }
      try {
        return await readCapped(res, MAX_SITE_BYTES)
      } catch (err) {
        reachable = false
        log(`voice: the published site broke off an answer (${err?.name ?? 'Error'}); only the local cache from now on`)
        return null
      }
    },
  }
}

/** The local cache: one `<hash>.mp3` per line, in `dir`. */
export function localCache(dir) {
  const file = (hash) => path.join(dir, `${hash}.mp3`)
  return {
    dir,
    get(hash) {
      try {
        return fs.readFileSync(file(hash))
      } catch (err) {
        if (err?.code === 'ENOENT') return null
        throw err
      }
    },
    put(hash, bytes) {
      fs.mkdirSync(dir, { recursive: true })
      const temporary = `${file(hash)}.${process.pid}.tmp`
      fs.writeFileSync(temporary, bytes)
      fs.renameSync(temporary, file(hash))
    },
  }
}

/** The length of an mp3, or null when the bytes are not one. */
function secondsOf(bytes) {
  try {
    return mp3Seconds(bytes)
  } catch {
    return null
  }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The listening page: every line, its text, the file a recording must have, and its audio when there is one. */
function listeningPage(lang, provider, beats) {
  const dir = ['he', 'ar'].includes(lang) ? 'rtl' : 'ltr'
  const items = beats.map((beat) => {
    const facts = [`${beat.seconds} s`, beat.hash ? `file ${beat.hash}.mp3` : null].filter(Boolean).join(', ')
    const audio = beat.audio ? `<audio controls preload="none" src="${escapeHtml(beat.audio)}"></audio>` : '<p>(no audio)</p>'
    return `<li><p><b>${escapeHtml(beat.id)}</b> (${escapeHtml(facts)})</p><p lang="${lang}" dir="${dir}">${escapeHtml(beat.text)}</p>${audio}</li>`
  })
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<meta charset="utf-8">',
    `<title>The narration of the provider video (${lang})</title>`,
    `<h1>The narration of the provider video (${lang})</h1>`,
    `<p>voice: ${escapeHtml(provider.label)}</p>`,
    `<ol>${items.join('\n')}</ol>`,
    '',
  ].join('\n')
}

/**
 * One run of the narrator for one language. Writes `<outRoot>/<lang>/timings.json`, the audio of every line in
 * `<outRoot>/<lang>/voice/` and the listening page there, and fills `<outRoot>/voice-cache/`. Throws, after writing the listening
 * page, when a recording is missing; throws before the call that would pass the budget.
 * @param {{
 *   lang: string,
 *   provider: import('./voice-providers/types.mjs').Provider,
 *   outRoot: string,
 *   budget?: number,
 *   site?: { get: (hash: string) => Promise<Uint8Array | null> } | null,
 *   lines?: readonly { id: string, seconds: number, text: string }[],
 *   log?: (line: string) => void,
 * }} options
 */
export async function runVoice({ lang, provider, outRoot, budget = DEFAULT_BUDGET, site = null, lines = scriptLines(lang), log = console.log }) {
  if (!Number.isInteger(budget) || budget < 0) throw new Error('The budget is not a whole number of characters.')
  for (const line of lines) {
    const problems = lineProblems(line.text)
    if (problems.length) throw new Error(`The line "${line.id}" is not sent to a narrator: it holds ${problems.join(', ')}.`)
  }
  if (!/^[a-z]{2}$/.test(lang)) throw new Error(`"${lang}" is not a language code.`)
  const langDir = path.join(outRoot, lang)
  const voiceDir = path.join(langDir, VOICE_DIR_NAME)
  fs.mkdirSync(voiceDir, { recursive: true })
  const timingsPath = path.join(langDir, 'timings.json')
  const pagePath = path.join(voiceDir, 'index.html')
  const counts = { lines: lines.length, site: 0, cache: 0, synthesized: 0, recorded: 0, characters: 0 }
  log(`voice: ${provider.label}`)

  /** @type {{ id: string, seconds: number, audio: string | null, text: string, hash?: string }[]} */
  let beats
  /** The audio of each line by beat id, with its length: collected before anything in the voice folder is replaced. */
  const audio = new Map()
  if (provider.kind === 'silent') {
    beats = lines.map((line) => ({ id: line.id, seconds: line.seconds, audio: null, text: line.text }))
  } else {
    const keyed = lines.map((line) => ({ ...line, hash: cacheKey({ text: line.text, voice: provider.voice, model: provider.model, lang }) }))
    if (provider.kind === 'recordings') {
      for (const line of keyed) {
        const bytes = provider.read(line.hash)
        if (!bytes) continue
        const seconds = secondsOf(bytes)
        if (seconds === null) throw new Error(`The recording of the line "${line.id}" (${line.hash}.mp3) is not an mp3.`)
        audio.set(line.id, { bytes, seconds })
      }
      counts.recorded = audio.size
      const missing = keyed.filter((line) => !audio.has(line.id))
      if (missing.length) {
        fs.writeFileSync(pagePath, listeningPage(lang, provider, keyed.map((line) => ({ ...line, audio: null }))))
        throw new Error(
          `${missing.length} line(s) have no recording (the list is in ${path.relative(ROOT, pagePath)}):\n  ` +
            missing.map((line) => `"${line.id}": ${line.hash}.mp3 for "${line.text}"`).join('\n  '),
        )
      }
    } else {
      const local = localCache(path.join(outRoot, CACHE_DIR_NAME))
      for (const line of keyed) {
        const published = site ? await site.get(line.hash) : null
        const publishedSeconds = published && secondsOf(published)
        if (publishedSeconds) {
          local.put(line.hash, published)
          audio.set(line.id, { bytes: published, seconds: publishedSeconds })
          counts.site += 1
          continue
        }
        const cached = local.get(line.hash)
        const cachedSeconds = cached && secondsOf(cached)
        if (cachedSeconds) {
          audio.set(line.id, { bytes: cached, seconds: cachedSeconds })
          counts.cache += 1
          continue
        }
        const size = [...line.text].length
        if (counts.characters + size > budget) {
          throw new Error(
            `The budget of this run is ${budget} characters, and the line "${line.id}" (${size}) would pass it after ${counts.characters}. ` +
              `The ${counts.synthesized} line(s) spoken so far are in the cache; run again with a larger --budget to go on.`,
          )
        }
        const bytes = await provider.synthesize({ id: line.id, text: line.text, lang })
        counts.synthesized += 1
        counts.characters += size
        const seconds = secondsOf(bytes)
        if (!seconds) throw new Error(`The narrator's audio for the line "${line.id}" is not an mp3.`)
        local.put(line.hash, bytes)
        audio.set(line.id, { bytes, seconds })
      }
    }
    beats = keyed.map((line) => ({ id: line.id, seconds: spokenSeconds(audio.get(line.id).seconds), audio: `${line.id}.mp3`, text: line.text, hash: line.hash }))
  }

  // Every line has its audio now, so the voice folder is replaced only here: a run that stopped above left the last good
  // timings.json and the files it names as they were.
  for (const name of fs.readdirSync(voiceDir)) if (name.endsWith('.mp3')) fs.rmSync(path.join(voiceDir, name))
  for (const [id, { bytes }] of audio) fs.writeFileSync(path.join(voiceDir, `${id}.mp3`), bytes)

  const timings = buildTimings(lang, provider.name, beats)
  fs.writeFileSync(timingsPath, `${JSON.stringify(timings, null, 2)}\n`)
  fs.writeFileSync(pagePath, listeningPage(lang, provider, beats))
  const total = beats.reduce((sum, beat) => sum + beat.seconds, 0)
  if (provider.kind === 'synthesize') {
    log(
      `voice: ${counts.lines} lines: ${counts.site} from the published site, ${counts.cache} from the cache, ` +
        `${counts.synthesized} synthesized (${counts.characters} of a budget of ${budget} characters)`,
    )
  } else if (provider.kind === 'recordings') {
    log(`voice: ${counts.lines} lines, ${counts.recorded} recorded`)
  } else {
    log(`voice: ${counts.lines} lines, no audio: the seconds of the script`)
  }
  log(`voice: ${path.relative(ROOT, timingsPath)} (${Math.round(total * 10) / 10} seconds of lines), the listening page ${path.relative(ROOT, pagePath)}`)
  return { timings, counts, timingsPath, pagePath }
}

/** The whole number of a --budget, or an error. */
function parseBudget(value) {
  if (value === undefined) return DEFAULT_BUDGET
  if (!/^\d+$/.test(value)) throw new Error('--budget is not a whole number of characters.')
  return Number(value)
}

/**
 * The command. Returns the exit code; prints counts and errors (their message only, with the key, if one was read, taken out as a
 * last guard).
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {(line: string) => void} [log]
 * @param {(line: string) => void} [warn]
 */
export async function main(argv, env, log = console.log, warn = console.error) {
  let key = null
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { voice: { type: 'string' }, budget: { type: 'string' }, out: { type: 'string' }, recordings: { type: 'string' } },
    })
    if (positionals.length !== 1) throw new Error(`Name one language: node scripts/video/voice.mjs <${LANGUAGES.join('|')}> [--voice elevenlabs|files|none] [--budget <characters>]`)
    const [lang] = positionals
    if (!LANGUAGES.includes(lang)) throw new Error(`The video script has no language "${lang}" (video/script/index.js has ${LANGUAGES.join(', ')}).`)
    const budget = parseBudget(values.budget)
    const outRoot = path.resolve(values.out ?? path.join(ROOT, VIDEO_OUT_DIR))
    const voice = values.voice ?? (keyIsSet(env) ? 'elevenlabs' : 'none')

    let provider
    if (voice === 'none') {
      provider = noneProvider()
      if (!values.voice) log(`voice: no ElevenLabs key in the environment (${KEY_VARIABLE} or ${KEY_FILE_VARIABLE})`)
    } else if (voice === 'files') {
      provider = filesProvider({ dir: path.resolve(values.recordings ?? env.VIDEO_RECORDINGS_DIR ?? path.join(ROOT, 'video', 'recordings', lang)) })
    } else if (voice === 'elevenlabs') {
      key = readKey(env)
      if (!key) throw new Error(`--voice elevenlabs needs a key in ${KEY_VARIABLE} or ${KEY_FILE_VARIABLE}.`)
      delete env[KEY_VARIABLE]
      provider = elevenlabsProvider({ key, ...elevenlabsSettings(env) })
    } else {
      throw new Error(`--voice is one of elevenlabs, files, none, not "${voice}".`)
    }
    const site = provider.kind === 'synthesize' ? siteCache({ url: env.VIDEO_VOICE_CACHE_URL ?? PUBLISHED_VOICE_CACHE, log }) : null
    await runVoice({ lang, provider, outRoot, budget, site, log })
    return 0
  } catch (err) {
    const message = String(err?.message ?? err)
    warn(`voice: ${key ? message.split(key).join('[the key]') : message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
