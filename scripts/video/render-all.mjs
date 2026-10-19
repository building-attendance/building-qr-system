// The whole provider tutorial video, from the app to the folder that GitHub Pages publishes (decision D6):
//
//   node scripts/video/render-all.mjs [--step frames|voice|render|site|all] [--voice elevenlabs|site|none] [--site <url>]
//
// The steps, in order (`all`, the default, runs the four):
//  1. frames  `npm run video:frames`: the recorder (Playwright, its own ports and scratch schema, the fake sample data).
//  2. voice   per language, video/out/<lang>/timings.json and voice/*.mp3:
//               - `elevenlabs` (the default when ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_FILE is set): scripts/video/voice.mjs, which
//                 takes every line from the published site or the local cache first and synthesizes only a line whose text changed;
//               - `site` (the default without a key, as in a copy of the repository): no narrator is called. A line that the published
//                 site (or the local cache) has keeps that audio, any other line is silent and runs the seconds of the script. The
//                 step names the silent lines in its log and in the step summary of GitHub Actions;
//               - `none`: every line silent.
//  3. render  per language, `npm --prefix video run render -- <lang>` (it installs video/ first when video/node_modules is missing).
//  4. site    video/out/site/, the folder that is published at the root of the site:
//               video/<lang>.mp4, video/<lang>/index.html (the player page of video/site/), video/<lang>/poster.jpg,
//               video/<lang>/captions.vtt, video/<lang>/manifest.json and video/<lang>/frames/<beat>.masked.png (what the gap check
//               of scripts/video/gap.mjs compares with), video/player.css, and video/voice-cache/<hash>.mp3 (every line's audio, so that
//               the next run fetches it instead of synthesizing it again: PUBLISHED_VOICE_CACHE of voice.mjs).
//
// The key of the narrator reaches the voice step only: the other steps run with ELEVENLABS_API_KEY and ELEVENLABS_API_KEY_FILE taken
// out of their environment, and the workflow (.github/workflows/video.yml) gives it to that step alone. Nothing here prints it.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { isMain } from '../ci-git.mjs'
import { LANGS } from '../../src/i18n/core.js'
import { DRAWN } from '../../video/script/drawn.js'
import { LANGUAGES } from '../../video/script/index.js'
import { HEIGHT, WIDTH } from '../../video/src/timing.js'
import { manifestOf, siteUrl } from './gap.mjs'
import { ROOT, VIDEO_OUT_DIR, languageOutDir } from './settings.mjs'
import { buildTimings, mp3Seconds, spokenSeconds } from './timings.mjs'
import { CACHE_DIR_NAME, VOICE_DIR_NAME, cacheKey, localCache, scriptLines, siteCache } from './voice.mjs'
import { KEY_FILE_VARIABLE, KEY_VARIABLE, elevenlabsSettings, keyIsSet } from './voice-providers/elevenlabs.mjs'

export const STEPS = Object.freeze(['frames', 'voice', 'render', 'site'])
export const VOICES = Object.freeze(['elevenlabs', 'site', 'none'])

/** The size of the video (video/src/timing.js, which imports nothing), for the player page and its preview tags. */
const VIDEO_SIZE = Object.freeze({ width: WIDTH, height: HEIGHT })

const OUT_ROOT = path.join(ROOT, VIDEO_OUT_DIR)
export const SITE_DIR = path.join(OUT_ROOT, 'site')
const TEMPLATE_DIR = path.join(ROOT, 'video', 'site')
const HASH_FILE = /^[0-9a-f]{64}\.mp3$/
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMIT = /^[0-9a-f]{40}$/

/** The environment without the narrator's key: what every step but the voice gets. */
export function withoutKey(env) {
  const rest = { ...env }
  delete rest[KEY_VARIABLE]
  delete rest[KEY_FILE_VARIABLE]
  return rest
}

/** Runs a command of the project in the foreground, with its output shown; throws when it fails. */
function run(command, args, env) {
  // npm and npx are .cmd files on Windows, which only a shell starts. The arguments are fixed words of this file.
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? result.signal}).`)
}

/** The narrator's address of the published voice cache: VIDEO_VOICE_CACHE_URL, else the site's own folder. */
const voiceCacheUrl = (env, site) => env.VIDEO_VOICE_CACHE_URL ?? new URL('video/voice-cache/', site).href

/**
 * The voice without a narrator: every line that the published site (or the local cache) has keeps its audio, every other line is
 * silent with the seconds of the script. The cache key is the narrator's (its voice and model, from the same settings), so a line is
 * found exactly when the narrator would have found it. Writes timings.json and voice/ as voice.mjs does, and puts what the site gave
 * into the local cache, so that the site step publishes it again. Throws, before it writes anything, when the site says it had
 * trouble (watchedSite).
 * @param {{ lang: string, outRoot: string, site: { get: (hash: string) => Promise<Uint8Array | null>, troubled?: () => boolean } | null, env: Record<string, string | undefined>, log?: (line: string) => void }} options
 * @returns {Promise<{ spoken: string[], silent: string[], voice: 'elevenlabs' | 'none' }>}
 */
export async function siteOnlyVoice({ lang, outRoot, site, env, log = console.log }) {
  const { voice, model } = elevenlabsSettings(env)
  const local = localCache(path.join(outRoot, CACHE_DIR_NAME))
  const langDir = path.join(outRoot, lang)
  const voiceDir = path.join(langDir, VOICE_DIR_NAME)
  fs.mkdirSync(voiceDir, { recursive: true })
  const audio = new Map()
  const beats = []
  for (const line of scriptLines(lang)) {
    const hash = cacheKey({ text: line.text, voice, model, lang })
    let bytes = site ? await site.get(hash) : null
    let seconds = bytes && secondsOf(bytes)
    if (seconds) local.put(hash, bytes)
    else {
      bytes = local.get(hash)
      seconds = bytes && secondsOf(bytes)
    }
    if (seconds) {
      audio.set(line.id, bytes)
      beats.push({ id: line.id, seconds: spokenSeconds(seconds), audio: `${line.id}.mp3` })
    } else {
      beats.push({ id: line.id, seconds: line.seconds, audio: null })
    }
  }
  if (site?.troubled?.()) {
    throw new Error('The published voice could not be read for every line, so the voice step stops rather than publish lines silent (and drop their audio from the site). Run it again.')
  }
  for (const name of fs.readdirSync(voiceDir)) if (name.endsWith('.mp3')) fs.rmSync(path.join(voiceDir, name))
  for (const [id, bytes] of audio) fs.writeFileSync(path.join(voiceDir, `${id}.mp3`), bytes)
  const spoken = beats.filter((beat) => beat.audio).map((beat) => beat.id)
  const silent = beats.filter((beat) => !beat.audio).map((beat) => beat.id)
  // The credit "Voice: ElevenLabs" of the closing card goes with any line that the narrator spoke.
  const name = spoken.length ? 'elevenlabs' : 'none'
  fs.writeFileSync(path.join(langDir, 'timings.json'), `${JSON.stringify(buildTimings(lang, name, beats), null, 2)}\n`)
  log(`voice: ${lang}: no narrator key, ${spoken.length} line(s) from the published voice, ${silent.length} silent${silent.length ? `: ${silent.join(', ')}` : ''}`)
  return { spoken, silent, voice: name }
}

/**
 * The published voice cache (siteCache of voice.mjs) that remembers trouble: a network failure, a status other than 200 or 404, or
 * an answer that is not an mp3. Every deploy replaces the whole site, so its voice cache holds only what the run publishes again: a
 * line that the site did not answer for would be published silent and its audio lost from the site for good. Null without a url.
 * @param {{ url: string, fetch?: typeof globalThis.fetch, log?: (line: string) => void }} options
 */
export function watchedSite({ url, fetch = globalThis.fetch, log = () => {} }) {
  let trouble = 0
  const watched = async (input, options) => {
    try {
      const res = await fetch(input, options)
      if (res.status !== 200 && res.status !== 404) trouble += 1
      return res
    } catch (err) {
      trouble += 1
      throw err
    }
  }
  const cache = siteCache({ url, fetch: watched, log })
  if (!cache) return null
  return {
    async get(hash) {
      const bytes = await cache.get(hash)
      if (bytes && !secondsOf(bytes)) {
        trouble += 1
        return null
      }
      return bytes
    },
    troubled: () => trouble > 0,
  }
}

function secondsOf(bytes) {
  try {
    return mp3Seconds(bytes)
  } catch {
    return null
  }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * The player page of one language: video/site/player.html with its fields filled, each value escaped.
 * @param {string} template
 * @param {string} lang
 * @param {string} site  the address of the published site, with its closing slash
 */
export function playerPage(template, lang, site) {
  const words = DRAWN[lang]
  const language = LANGS.find((entry) => entry.code === lang)
  if (!words || !language) throw new Error(`The video has no words for the language "${lang}" (video/script/drawn.js, src/i18n/core.js).`)
  const fields = {
    lang,
    dir: language.dir,
    locale: { he: 'he_IL', en: 'en_US', ru: 'ru_RU', ar: 'ar_IL' }[lang] ?? lang,
    title: words.introTitle,
    description: words.introSubtitle,
    languageName: language.label,
    pageUrl: new URL(`video/${lang}/`, site).href,
    posterUrl: new URL(`video/${lang}/poster.jpg`, site).href,
    videoUrl: new URL(`video/${lang}.mp4`, site).href,
    width: String(VIDEO_SIZE.width),
    height: String(VIDEO_SIZE.height),
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`video/site/player.html has the unknown field ${match}.`)
    return escapeHtml(fields[name])
  })
}

/** The commit that the site is made of: GITHUB_SHA in Actions, else the checkout's HEAD, else null. */
function currentCommit(env) {
  if (COMMIT.test(env.GITHUB_SHA ?? '')) return env.GITHUB_SHA
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  const sha = head.status === 0 ? head.stdout.trim() : ''
  return COMMIT.test(sha) ? sha : null
}

/**
 * The site folder: every language's video, player page, poster, captions, manifest and masked frames, the style of the page, and the
 * voice cache. Throws when a file that a page needs is missing.
 * @param {{ langs: readonly string[], site: string, commit: string | null, outRoot?: string, siteDir?: string, outDir?: (lang: string) => string }} options
 */
export function buildSite({ langs, site, commit, outRoot = OUT_ROOT, siteDir = SITE_DIR, outDir = languageOutDir }) {
  fs.rmSync(siteDir, { recursive: true, force: true })
  const videoDir = path.join(siteDir, 'video')
  fs.mkdirSync(videoDir, { recursive: true })
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'player.css'), path.join(videoDir, 'player.css'))
  const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'player.html'), 'utf8')
  for (const lang of langs) {
    const from = outDir(lang)
    const need = (name) => {
      const file = path.join(from, name)
      if (!fs.existsSync(file)) throw new Error(`No ${path.relative(ROOT, file)}: run the steps before the site.`)
      return file
    }
    const scenes = JSON.parse(fs.readFileSync(need('scenes.json'), 'utf8'))
    const pageDir = path.join(videoDir, lang)
    fs.mkdirSync(path.join(pageDir, 'frames'), { recursive: true })
    fs.copyFileSync(need(`provider-${lang}.mp4`), path.join(videoDir, `${lang}.mp4`))
    fs.copyFileSync(need(`provider-${lang}.jpg`), path.join(pageDir, 'poster.jpg'))
    fs.copyFileSync(need(`provider-${lang}.vtt`), path.join(pageDir, 'captions.vtt'))
    const manifest = manifestOf(lang, scenes, { commit })
    for (const beat of scenes.scenes.flatMap((scene) => scene.beats)) {
      if (!ID.test(beat.id)) throw new Error(`scenes.json has a beat id that cannot name a file ("${beat.id}").`)
      fs.copyFileSync(need(path.basename(beat.masked)), path.join(pageDir, 'frames', `${beat.id}.masked.png`))
    }
    fs.writeFileSync(path.join(pageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    fs.writeFileSync(path.join(pageDir, 'index.html'), playerPage(template, lang, site))
  }
  const cacheFrom = path.join(outRoot, CACHE_DIR_NAME)
  const cacheTo = path.join(videoDir, 'voice-cache')
  fs.mkdirSync(cacheTo, { recursive: true })
  let lines = 0
  if (fs.existsSync(cacheFrom)) {
    for (const name of fs.readdirSync(cacheFrom)) {
      if (!HASH_FILE.test(name)) continue
      fs.copyFileSync(path.join(cacheFrom, name), path.join(cacheTo, name))
      lines += 1
    }
  }
  return { siteDir, lines }
}

/** Appends a line to the step summary of GitHub Actions, when there is one. */
function summary(env, text) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)
}

/**
 * The command. Returns the exit code.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export async function main(argv, env, log = console.log, warn = console.error) {
  try {
    const { values } = parseArgs({ args: argv, options: { step: { type: 'string' }, voice: { type: 'string' }, site: { type: 'string' } } })
    const step = values.step ?? 'all'
    if (step !== 'all' && !STEPS.includes(step)) throw new Error(`--step is one of ${[...STEPS, 'all'].join(', ')}, not "${step}".`)
    const voice = values.voice ?? (keyIsSet(env) ? 'elevenlabs' : 'site')
    if (!VOICES.includes(voice)) throw new Error(`--voice is one of ${VOICES.join(', ')}, not "${voice}".`)
    const site = siteUrl(values.site ?? env.VIDEO_SITE_URL)
    const steps = step === 'all' ? STEPS : [step]
    const quiet = withoutKey(env)
    const started = Date.now()

    if (steps.includes('frames')) run('npm', ['run', 'video:frames'], quiet)

    if (steps.includes('voice')) {
      const cache = voice === 'site' ? watchedSite({ url: voiceCacheUrl(env, site), log }) : null
      for (const lang of LANGUAGES) {
        if (voice === 'site') {
          const { spoken, silent } = await siteOnlyVoice({ lang, outRoot: OUT_ROOT, site: cache, env, log })
          summary(env, `Voice (${lang}): no narrator key. ${spoken.length} line(s) keep the published voice; ${silent.length ? `silent: ${silent.join(', ')}` : 'none is silent'}.`)
        } else {
          // voice.mjs reads the key itself and takes it out of its own environment once it has it.
          run(process.execPath, ['scripts/video/voice.mjs', lang, '--voice', voice], { ...env, VIDEO_VOICE_CACHE_URL: voiceCacheUrl(env, site) })
          summary(env, `Voice (${lang}): ${voice === 'none' ? 'silent (--voice none)' : 'ElevenLabs, every line from the published voice or the cache unless its text changed'}.`)
        }
      }
    }

    if (steps.includes('render')) {
      if (!fs.existsSync(path.join(ROOT, 'video', 'node_modules'))) run('npm', ['--prefix', 'video', 'ci'], quiet)
      for (const lang of LANGUAGES) run('npm', ['--prefix', 'video', 'run', 'render', '--', lang], quiet)
    }

    if (steps.includes('site')) {
      const built = buildSite({ langs: LANGUAGES, site, commit: currentCommit(env) })
      log(`site: ${path.relative(ROOT, built.siteDir)} (${LANGUAGES.join(', ')}, ${built.lines} line(s) of voice), for ${site}`)
      for (const lang of LANGUAGES) {
        const bytes = fs.statSync(path.join(built.siteDir, 'video', `${lang}.mp4`)).size
        summary(env, `Video (${lang}): ${(bytes / 1024 / 1024).toFixed(2)} MB, ${new URL(`video/${lang}/`, site).href}`)
      }
    }
    log(`render-all: ${steps.join(', ')} in ${Math.round((Date.now() - started) / 1000)} s`)
    return 0
  } catch (err) {
    warn(`render-all: ${String(err?.message ?? err)}`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
