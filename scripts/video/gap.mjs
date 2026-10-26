// Whether the published tutorial video is behind the app (decision D5): the frames and the lines of a new recording are compared
// with the published video's manifest, beat by beat, and the scenes that changed are the gap. It never publishes anything.
//
//   node scripts/video/gap.mjs [<lang> ...] [--site <url>] [--out <folder>]
//
// - The new run is video/out/<lang>/scenes.json and its masked frames (`npm run video:frames`), described by manifestOf: per beat
//   its scene, its caption (resolveLine, as scenes.json has it), the line as the narrator reads it (spokenLine) and its masked frame.
// - The published run is <site>/video/<lang>/manifest.json, written by the same manifestOf when the video was published
//   (scripts/video/render-all.mjs), with the masked frames beside it. No manifest (404): the video was never published, no gap.
//   Any other failure to read it stops the run with an error: a gap that cannot be checked is not reported as "none".
// - A beat is a gap when its caption or its spoken line changed, when it is new or was removed, or when its masked frame differs:
//   a different size, or one pixel whose colour moved further than PIXEL_THRESHOLD, measured the way the visual tests of
//   e2e/visual.spec.js measure it (Playwright's pixelmatch, anti-aliasing ignored), with the same threshold.
// - Output: the JSON of the gap on stdout ({ published, since, languages, scenes, beats }), the log on stderr. With --out, the
//   published and the new frame of every changed beat are copied there (the workflow keeps them as an artifact), with gap.json. In
//   GitHub Actions the step's outputs are `scenes` and `languages` (ids, comma-separated) and `since` (the commit of the published
//   video, or empty), and a table goes to the step summary.
// Node built-ins and the project's own modules only. Nothing here sends a credential anywhere.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { decodePng } from '../png.mjs'
import { isMain } from '../ci-git.mjs'
import { LANGUAGES, SCRIPTS } from '../../video/script/index.js'
import { spokenLine } from './script.mjs'
import { ROOT, languageOutDir } from './settings.mjs'
import { PUBLISHED_VOICE_CACHE } from './voice.mjs'
import { readCapped } from './voice-providers/http.mjs'
import { elevenlabsSettings } from './voice-providers/elevenlabs.mjs'

/** The published site of the video: the root of the repository's GitHub Pages, two folders above the voice cache. */
export const PUBLISHED_SITE = new URL('../../', PUBLISHED_VOICE_CACHE).href

/**
 * The per-pixel threshold of a frame: the same number as PIXEL_THRESHOLD of e2e/visual.spec.js (the owner's decision of 14/10/2026,
 * the comment there says what it measures). A copy, because importing a spec file would register its tests; tests/video-gap.test.js
 * holds that the two are the same.
 */
export const PIXEL_THRESHOLD = 0.01

/** The version of manifest.json. A manifest of another version is not compared (the run stops and says so). */
export const MANIFEST_VERSION = 1

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMIT = /^[0-9a-f]{40}$/
const FRAME = /^frames\/[a-z0-9]+(?:-[a-z0-9]+)*\.masked\.png$/
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 15_000

/** The address of a language's manifest on the site. */
/** The folders whose tracked files make the published video besides the app (decision D18): its editing, script, site and tools. */
export const VIDEO_SOURCES = Object.freeze(['video', 'scripts/video'])
/**
 * The files under VIDEO_SOURCES that never count:
 * - a Markdown file cannot change a frame or a line (the push trigger of video.yml ignores them too);
 * - video/promo/ is the promotional video's own folder (decision D7 of the promo topic, 25/10/2026), not a source of the
 *   tutorial, so a change there opens no `video-gap` issue. The pathspec is literal and ends with a slash, so it takes the files
 *   under that one folder and no other path (not video/promo.js, video/promotion/, video/src/promo/ or scripts/video/promo/).
 *   It is safe only while the tutorial depends on nothing in that folder: tests/video-gap.test.js fails when a file of the
 *   tutorial imports from it.
 */
const FINGERPRINT_EXCLUDED = Object.freeze([':(exclude)*.md', ':(exclude,literal)video/promo/'])
const FINGERPRINT = /^[0-9a-f]{64}$/

/**
 * One hash of the video's own sources (decision D18, the owner, 19/10/2026): the blob id of every file that git tracks under
 * VIDEO_SOURCES except the Markdown ones (video/README.md, video/ASSETS.md: documents, not inputs of the video), read from the
 * index (so an untracked or ignored file, such as video/out, never counts, and the line endings of a checkout do not matter), and
 * the voice settings that a publish reads (the model and the voice). A publish writes it into the manifest, and the gap check
 * compares it, so that a change of the video's own sources is behind even where no screen changed.
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, git?: (args: string[]) => { status: number | null, stdout: string } }} [options]
 */
export function sourcesFingerprint({ cwd = ROOT, env = process.env, git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' }) } = {}) {
  const listed = git(['ls-files', '--stage', '-z', '--', ...VIDEO_SOURCES, ...FINGERPRINT_EXCLUDED])
  if (listed.status !== 0) throw new Error('git ls-files failed, so the sources of the video cannot be fingerprinted.')
  const entries = String(listed.stdout).split('\0').filter(Boolean).sort()
  if (!entries.length) throw new Error(`git tracks no file under ${VIDEO_SOURCES.join(' or ')}.`)
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(`${entry}\n`)
  hash.update(JSON.stringify(elevenlabsSettings(env)))
  return hash.digest('hex')
}
export const manifestUrl = (site, lang) => new URL(`video/${lang}/manifest.json`, site.endsWith('/') ? site : `${site}/`).href

/** The site from --site, VIDEO_SITE_URL or the published one: https, or http on this machine (for a local test server). */
export function siteUrl(value) {
  const url = new URL(value || PUBLISHED_SITE)
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) throw new Error('The site of the video is not an https address.')
  if (url.search || url.hash || url.username || url.password) throw new Error('The site of the video is a plain address (no query, no fragment, no user).')
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

/**
 * The manifest of one language's run: what the gap check compares, and what the published site keeps beside the video.
 * @param {string} lang
 * @param {{ scenes: { id: string, beats: { id: string, masked: string, caption: string | null }[] }[] }} scenes  scenes.json
 * @param {{ commit?: string | null }} [about]
 */
export function manifestOf(lang, scenes, { commit = null, sources = null } = {}) {
  const lines = SCRIPTS[lang]
  if (!lines) throw new Error(`The video script has no language "${lang}" (video/script/index.js has ${LANGUAGES.join(', ')}).`)
  return {
    version: MANIFEST_VERSION,
    lang,
    commit,
    sources,
    beats: scenes.scenes.flatMap((scene) =>
      scene.beats.map((beat) => {
        if (!ID.test(scene.id) || !ID.test(beat.id)) throw new Error(`scenes.json has an id that cannot name a file ("${scene.id}", "${beat.id}").`)
        return {
          scene: scene.id,
          id: beat.id,
          caption: beat.caption ?? null,
          spoken: beat.caption == null ? null : spokenLine(lang, lines[beat.id].say),
          frame: `frames/${beat.id}.masked.png`,
        }
      }),
    ),
  }
}

/** Throws unless `manifest` has the shape that manifestOf writes. */
function checkManifest(manifest, lang) {
  if (manifest?.version !== MANIFEST_VERSION) throw new Error(`The published manifest of "${lang}" is not of version ${MANIFEST_VERSION}: publish the video again to compare with it.`)
  if (manifest.lang !== lang || !Array.isArray(manifest.beats)) throw new Error(`The published manifest of "${lang}" is not a manifest of that language.`)
  if (manifest.sources != null && !FINGERPRINT.test(manifest.sources)) throw new Error(`The published manifest of "${lang}" has a fingerprint of its sources that is not one.`)
  for (const beat of manifest.beats) {
    const text = (value) => value === null || typeof value === 'string'
    const id = (value) => typeof value === 'string' && ID.test(value) // (a regex reads undefined as the word "undefined")
    if (!id(beat?.scene) || !id(beat?.id) || typeof beat.frame !== 'string' || !FRAME.test(beat.frame) || !text(beat.caption) || !text(beat.spoken)) {
      throw new Error(`The published manifest of "${lang}" has a beat that is not well formed.`)
    }
  }
}

// ---- the frames, compared as Playwright compares a screenshot with its baseline ----------------------------------------------------
// The functions below are pixelmatch as Playwright bundles it (packages/utils/third_party/pixelmatch.js, the YIQ version), so that a
// frame counts as changed exactly when a visual test would fail. pixelmatch: ISC License, Copyright (c) 2019, Mapbox. Permission to
// use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
// WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR
// BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR
// PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
// PERFORMANCE OF THIS SOFTWARE.

const blend = (c, a) => 255 + (c - 255) * a
const rgb2y = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223
const rgb2i = (r, g, b) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189
const rgb2q = (r, g, b) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694

/** The squared YIQ distance of two pixels (negative when the first is brighter), or the brightness difference alone. */
function colorDelta(img1, img2, k, m, yOnly = false) {
  let [r1, g1, b1, a1] = [img1[k], img1[k + 1], img1[k + 2], img1[k + 3]]
  let [r2, g2, b2, a2] = [img2[m], img2[m + 1], img2[m + 2], img2[m + 3]]
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0
  if (a1 < 255) {
    a1 /= 255
    ;[r1, g1, b1] = [blend(r1, a1), blend(g1, a1), blend(b1, a1)]
  }
  if (a2 < 255) {
    a2 /= 255
    ;[r2, g2, b2] = [blend(r2, a2), blend(g2, a2), blend(b2, a2)]
  }
  const y1 = rgb2y(r1, g1, b1)
  const y2 = rgb2y(r2, g2, b2)
  const y = y1 - y2
  if (yOnly) return y
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
  return y1 > y2 ? -delta : delta
}

/** True when at least three of the eight pixels around (x1, y1) have exactly its colour. */
function hasManySiblings(img, x1, y1, width, height) {
  const [x0, y0, x2, y2] = [Math.max(x1 - 1, 0), Math.max(y1 - 1, 0), Math.min(x1 + 1, width - 1), Math.min(y1 + 1, height - 1)]
  const pos = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const pos2 = (y * width + x) * 4
      if (img[pos] === img[pos2] && img[pos + 1] === img[pos2 + 1] && img[pos + 2] === img[pos2 + 2] && img[pos + 3] === img[pos2 + 3]) zeroes++
      if (zeroes > 2) return true
    }
  }
  return false
}

/** True when the pixel looks like the anti-aliasing of an edge (V. Vysniauskas, 2009), which pixelmatch never counts. */
function antialiased(img, x1, y1, width, height, img2) {
  const [x0, y0, x2, y2] = [Math.max(x1 - 1, 0), Math.max(y1 - 1, 0), Math.min(x1 + 1, width - 1), Math.min(y1 + 1, height - 1)]
  const pos = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  let [min, max, minX, minY, maxX, maxY] = [0, 0, 0, 0, 0, 0]
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const delta = colorDelta(img, img, pos, (y * width + x) * 4, true)
      if (delta === 0) {
        zeroes++
        if (zeroes > 2) return false
      } else if (delta < min) {
        ;[min, minX, minY] = [delta, x, y]
      } else if (delta > max) {
        ;[max, maxX, maxY] = [delta, x, y]
      }
    }
  }
  if (min === 0 || max === 0) return false
  return (
    (hasManySiblings(img, minX, minY, width, height) && hasManySiblings(img2, minX, minY, width, height)) ||
    (hasManySiblings(img, maxX, maxY, width, height) && hasManySiblings(img2, maxX, maxY, width, height))
  )
}

/**
 * How two PNG frames differ: `size` when their sizes differ, else the number of pixels that count (0: the same frame for a visual
 * test). A file that is not a PNG this reader knows counts as a different frame.
 * @param {Uint8Array} published
 * @param {Uint8Array} current
 * @param {number} [threshold]
 * @returns {{ size: boolean, pixels: number }}
 */
export function compareFrames(published, current, threshold = PIXEL_THRESHOLD) {
  let a
  let b
  try {
    a = decodePng(Buffer.from(published))
    b = decodePng(Buffer.from(current))
  } catch {
    return { size: true, pixels: 0 }
  }
  if (a.width !== b.width || a.height !== b.height) return { size: true, pixels: 0 }
  if (a.rgba.equals(b.rgba)) return { size: false, pixels: 0 }
  const maxDelta = 35215 * threshold * threshold
  let pixels = 0
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const pos = (y * a.width + x) * 4
      if (Math.abs(colorDelta(a.rgba, b.rgba, pos, pos)) <= maxDelta) continue
      if (antialiased(a.rgba, x, y, a.width, a.height, b.rgba) || antialiased(b.rgba, x, y, a.width, a.height, a.rgba)) continue
      pixels++
    }
  }
  return { size: false, pixels }
}

// ---- the check ---------------------------------------------------------------------------------------------------------------

/** GET a file of the site with a size cap and a time limit: its bytes, null for a 404, or an error for anything else. */
async function fetchFile(url, max, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new Error(`The published site cannot be reached (${err?.name ?? 'Error'}).`, { cause: err })
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`The published site answered ${res.status}.`)
  }
  const bytes = await readCapped(res, max)
  if (!bytes) throw new Error(`The published site answered more than ${max} bytes for one file.`)
  return bytes
}

/**
 * The gap of one language. `current` is the manifest of the new run (manifestOf), `readFrame(id)` the bytes of its masked frame of
 * a beat. Returns whether a video was published, the changed beats (each with its scene and what changed) and, for each changed
 * frame, both files.
 * @param {{
 *   lang: string,
 *   current: ReturnType<typeof manifestOf>,
 *   readFrame: (id: string) => Uint8Array,
 *   site: string,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (line: string) => void,
 * }} options
 */
export async function checkLanguage({ lang, current, readFrame, site, fetch = globalThis.fetch, log = () => {} }) {
  const url = manifestUrl(site, lang)
  const raw = await fetchFile(url, MAX_MANIFEST_BYTES, fetch)
  if (raw === null) {
    log(`gap: ${lang}: the video was never published (no ${url}), so there is nothing to be behind`)
    return { lang, published: false, commit: null, sources: null, beats: [], frames: [] }
  }
  let published
  try {
    published = JSON.parse(Buffer.from(raw).toString('utf8'))
  } catch {
    throw new Error(`The published manifest of "${lang}" is not JSON.`)
  }
  checkManifest(published, lang)
  log(`gap: ${lang}: comparing with the video published from ${typeof published.commit === 'string' ? published.commit.slice(0, 12) : 'an unknown commit'}`)

  const before = new Map(published.beats.map((beat) => [beat.id, beat]))
  const beats = []
  const frames = []
  for (const beat of current.beats) {
    const old = before.get(beat.id)
    before.delete(beat.id)
    if (!old) {
      beats.push({ scene: beat.scene, beat: beat.id, changes: ['new'] })
      continue
    }
    const changes = []
    if (old.scene !== beat.scene) changes.push('scene')
    if (old.caption !== beat.caption) changes.push('caption')
    if (old.spoken !== beat.spoken) changes.push('spoken')
    const oldFrame = await fetchFile(new URL(old.frame, url).href, MAX_FRAME_BYTES, fetch)
    const newFrame = readFrame(beat.id)
    let pixels = 0
    if (oldFrame === null) changes.push('frame')
    else {
      const diff = compareFrames(oldFrame, newFrame)
      pixels = diff.pixels
      if (diff.size || diff.pixels > 0) {
        changes.push('frame')
        frames.push({ beat: beat.id, published: oldFrame, current: newFrame })
      }
    }
    if (changes.length) beats.push({ scene: beat.scene, beat: beat.id, changes, ...(pixels ? { pixels } : {}) })
  }
  for (const old of before.values()) beats.push({ scene: old.scene, beat: old.id, changes: ['removed'] })
  return { lang, published: true, commit: COMMIT.test(published.commit ?? '') ? published.commit : null, sources: published.sources ?? null, beats, frames }
}

/** The scene ids of a gap, in the order they were found, each once. */
export const changedScenes = (results) => [...new Set(results.flatMap((result) => result.beats.map((beat) => beat.scene)))]

/** The markdown table of a gap, for the step summary. Ids and change names only (both checked against fixed shapes). */
export function summaryOf(results, { sourcesChanged = false } = {}) {
  const rows = results.flatMap((result) =>
    result.beats.map((beat) => `| ${result.lang} | ${beat.scene} | ${beat.beat} | ${beat.changes.join(', ')}${beat.pixels ? ` (${beat.pixels} pixels)` : ''} |`),
  )
  const never = results.filter((result) => !result.published).map((result) => result.lang)
  const lines = ['## Is the tutorial video behind the app?', '']
  if (never.length) lines.push(`Never published: ${never.join(', ')} (nothing to compare with).`, '')
  if (sourcesChanged) lines.push("The video's own sources changed since the last publish.", '')
  if (!rows.length) lines.push('No scene changed.')
  else lines.push('| Language | Scene | Beat | What changed |', '|---|---|---|---|', ...rows)
  return `${lines.join('\n')}\n`
}

/**
 * The command. Returns the exit code.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch?: typeof globalThis.fetch, outDir?: (lang: string) => string, log?: (line: string) => void, print?: (text: string) => void, fingerprint?: () => string }} [io]
 */
export async function main(argv, env, { fetch = globalThis.fetch, outDir = languageOutDir, log = (line) => console.error(line), print = (text) => console.log(text), fingerprint = () => sourcesFingerprint({ env }) } = {}) {
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { site: { type: 'string' }, out: { type: 'string' } } })
    const langs = positionals.length ? positionals : [...LANGUAGES]
    for (const lang of langs) if (!LANGUAGES.includes(lang)) throw new Error(`The video script has no language "${lang}" (video/script/index.js has ${LANGUAGES.join(', ')}).`)
    const site = siteUrl(values.site ?? env.VIDEO_SITE_URL)
    const results = []
    for (const lang of langs) {
      const dir = outDir(lang)
      const scenesPath = path.join(dir, 'scenes.json')
      if (!fs.existsSync(scenesPath)) throw new Error(`No ${scenesPath}: record the frames first (npm run video:frames).`)
      const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'))
      const masked = new Map(scenes.scenes.flatMap((scene) => scene.beats.map((beat) => [beat.id, beat.masked])))
      const readFrame = (id) => fs.readFileSync(path.join(dir, path.basename(masked.get(id) ?? `${id}.masked.png`)))
      results.push(await checkLanguage({ lang, current: manifestOf(lang, scenes), readFrame, site, fetch, log }))
    }
    const scenes = changedScenes(results)
    const languages = results.filter((result) => result.beats.length).map((result) => result.lang)
    // The commit of the published video (of the first language that names one), for a link to every change since it.
    const since = results.find((result) => result.commit)?.commit ?? null
    // The video's own sources (D18): behind when the fingerprint differs from the published one (or the manifest has none).
    const current = results.some((result) => result.published) ? fingerprint() : null
    const sourcesChanged = results.some((result) => result.published && result.sources !== current)
    const gap = {
      published: results.some((result) => result.published),
      since,
      languages,
      scenes,
      sources: sourcesChanged ? 'changed' : 'same',
      beats: results.flatMap((result) => result.beats.map((beat) => ({ lang: result.lang, ...beat }))),
    }
    log(scenes.length ? `gap: the video is behind the app in ${scenes.length} scene(s): ${scenes.join(', ')}` : 'gap: no scene changed')
    if (sourcesChanged) log("gap: the video's own sources changed since the last publish")
    if (values.out) {
      const out = path.resolve(values.out)
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, 'gap.json'), `${JSON.stringify(gap, null, 2)}\n`)
      for (const result of results) {
        for (const frame of result.frames) {
          fs.writeFileSync(path.join(out, `${result.lang}-${frame.beat}.published.png`), frame.published)
          fs.writeFileSync(path.join(out, `${result.lang}-${frame.beat}.new.png`), frame.current)
        }
      }
    }
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `scenes=${scenes.join(',')}\nlanguages=${languages.join(',')}\nsince=${since ?? ''}\nsources=${sourcesChanged ? 'changed' : 'same'}\n`)
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summaryOf(results, { sourcesChanged }))
    print(JSON.stringify(gap))
    return 0
  } catch (err) {
    log(`gap: ${String(err?.message ?? err)}`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
