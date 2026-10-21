// Whether the published tutorial video is behind the app (scripts/video/gap.mjs), and the folder that the publish puts on GitHub
// Pages (scripts/video/render-all.mjs). No network, no database and no browser: the published site is a fake fetch, the frames are
// small PNGs made here, and every run writes into a folder of its own under the system's temporary folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidates, decodePng } from '../scripts/png.mjs'
import { SCENES, SCRIPTS } from '../video/script/index.js'
import { buildScenes, spokenLine } from '../scripts/video/script.mjs'
import { PUBLISHED_VOICE_CACHE, cacheKey, scriptLines } from '../scripts/video/voice.mjs'
import { ELEVENLABS_DEFAULTS } from '../scripts/video/voice-providers/elevenlabs.mjs'
import {
  PIXEL_THRESHOLD, PUBLISHED_SITE, VIDEO_SOURCES, changedScenes, checkLanguage, compareFrames, main, manifestOf, manifestUrl, siteUrl, sourcesFingerprint, summaryOf,
} from '../scripts/video/gap.mjs'
import { buildSite, playerPage, siteOnlyVoice, watchedSite, withoutKey } from '../scripts/video/render-all.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const SITE = 'https://example.github.io/video-test/'
const COMMIT = 'c'.repeat(40)

/** A PNG of `width` x `height` pixels of one colour, with `changes` ([x, y, [r, g, b]]) drawn on it. */
function png(width = 8, height = 8, colour = [240, 240, 250], changes = []) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p++) rgba.set([...colour, 255], p * 4)
  for (const [x, y, rgb] of changes) rgba.set([...rgb, 255], (y * width + x) * 4)
  return candidates({ width, height, rgba }).at(-1).bytes
}

/** The beats of the script, with a capture for each (the fields of scripts/video/script.mjs), as the recorder writes scenes.json. */
function fakeScenes() {
  const captures = {}
  for (const beat of SCENES.flatMap((scene) => scene.beats)) {
    captures[beat.id] = { image: `${beat.id}.png`, masked: `${beat.id}.masked.png`, width: 8, height: 8, scale: 1, tap: null, highlight: null }
  }
  return buildScenes('he', captures)
}

/** A fake site: `files` maps an address to bytes (or a status number); anything else is a 404. Every address asked is recorded. */
function fakeSite(files) {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(String(url))
    const file = files[String(url)]
    if (typeof file === 'number') return new Response('no', { status: file })
    if (file === undefined) return new Response('not found', { status: 404 })
    return new Response(file, { status: 200 })
  }
  return { fetch: fetchImpl, asked }
}

/** The site of a published video: its manifest and one masked frame per beat (all the same picture unless `frames` says otherwise). */
function publishedSite(manifest, frames = {}) {
  const url = manifestUrl(SITE, manifest.lang)
  const files = { [url]: JSON.stringify(manifest) }
  for (const beat of manifest.beats) files[new URL(beat.frame, url).href] = frames[beat.id] ?? png()
  return files
}

const sameFrames = () => png()

describe('the gap check', () => {
  it('uses the threshold of the visual tests', () => {
    const spec = fs.readFileSync(path.join(root, 'e2e', 'visual.spec.js'), 'utf8')
    const match = spec.match(/^const PIXEL_THRESHOLD = ([\d.]+)$/m)
    expect(match, 'e2e/visual.spec.js still defines PIXEL_THRESHOLD').not.toBeNull()
    expect(PIXEL_THRESHOLD).toBe(Number(match[1]))
  })

  it('looks for the published video beside the voice cache that the narrator reads', () => {
    expect(PUBLISHED_SITE).toBe('https://building-attendance.github.io/building-qr-system/')
    expect(new URL('video/voice-cache/', PUBLISHED_SITE).href).toBe(PUBLISHED_VOICE_CACHE)
    expect(manifestUrl(PUBLISHED_SITE, 'he')).toBe('https://building-attendance.github.io/building-qr-system/video/he/manifest.json')
  })

  it('describes each beat by its scene, its caption, its spoken line and its masked frame', () => {
    const manifest = manifestOf('he', fakeScenes(), { commit: COMMIT })
    expect(manifest.commit).toBe(COMMIT)
    expect(manifest.beats.map((beat) => beat.id)).toEqual(SCENES.flatMap((scene) => scene.beats.map((beat) => beat.id)))
    const list = manifest.beats.find((beat) => beat.id === 'list')
    expect(list.scene).toBe('list')
    expect(list.spoken).toBe(spokenLine('he', SCRIPTS.he.list.say))
    expect(list.frame).toBe('frames/list.masked.png')
    const sent = manifest.beats.find((beat) => beat.id === 'sent') // continues the line before it
    expect(sent).toMatchObject({ scene: 'offline', caption: null, spoken: null })
  })

  it('finds no gap when every frame and every line is the same', async () => {
    const current = manifestOf('he', fakeScenes())
    const site = fakeSite(publishedSite(current))
    const result = await checkLanguage({ lang: 'he', current, readFrame: sameFrames, site: SITE, fetch: site.fetch })
    expect(result).toMatchObject({ published: true, beats: [], frames: [] })
    expect(changedScenes([result])).toEqual([])
  })

  it('reports the scene of a changed label (a caption and its spoken line)', async () => {
    const current = manifestOf('he', fakeScenes())
    const published = structuredClone(current)
    const submit = published.beats.find((beat) => beat.id === 'submit')
    submit.caption = 'an older caption'
    submit.spoken = 'an older line'
    const site = fakeSite(publishedSite(published))
    const result = await checkLanguage({ lang: 'he', current, readFrame: sameFrames, site: SITE, fetch: site.fetch })
    expect(result.beats).toEqual([{ scene: 'password', beat: 'submit', changes: ['caption', 'spoken'] }])
    expect(changedScenes([result])).toEqual(['password'])
  })

  it('reports a frame with one pixel over the threshold, and keeps both frames', async () => {
    const current = manifestOf('he', fakeScenes())
    const moved = png(8, 8, [240, 240, 250], [[3, 4, [200, 200, 210]]])
    const site = fakeSite(publishedSite(current))
    const readFrame = (id) => (id === 'home' ? moved : png())
    const result = await checkLanguage({ lang: 'he', current, readFrame, site: SITE, fetch: site.fetch })
    expect(result.beats).toEqual([{ scene: 'home', beat: 'home', changes: ['frame'], pixels: 1 }])
    expect(result.frames).toHaveLength(1)
    expect(Buffer.from(result.frames[0].current).equals(moved)).toBe(true)
  })

  it('lets a pixel move within the threshold, as a visual test does', () => {
    // One level in every channel is 0.0039 on the scale of the threshold (e2e/visual.spec.js), under 0.01.
    expect(compareFrames(png(), png(8, 8, [240, 240, 250], [[3, 4, [241, 241, 251]]]))).toEqual({ size: false, pixels: 0 })
    // Five levels is over it.
    expect(compareFrames(png(), png(8, 8, [240, 240, 250], [[3, 4, [235, 235, 245]]]))).toEqual({ size: false, pixels: 1 })
    expect(compareFrames(png(), png(8, 9))).toEqual({ size: true, pixels: 0 })
    expect(compareFrames(png(), Buffer.from('not a png'))).toEqual({ size: true, pixels: 0 })
  })

  it('reports a beat that is new, and one that was removed', async () => {
    const current = manifestOf('he', fakeScenes())
    const published = structuredClone(current)
    published.beats = published.beats.filter((beat) => beat.id !== 'far')
    published.beats.push({ scene: 'old-scene', id: 'old-beat', caption: 'x', spoken: 'x', frame: 'frames/old-beat.masked.png' })
    const site = fakeSite(publishedSite(published))
    const result = await checkLanguage({ lang: 'he', current, readFrame: sameFrames, site: SITE, fetch: site.fetch })
    expect(result.beats).toEqual([
      { scene: 'far', beat: 'far', changes: ['new'] },
      { scene: 'old-scene', beat: 'old-beat', changes: ['removed'] },
    ])
  })

  it('finds no gap when the video was never published, and says so', async () => {
    const logs = []
    const site = fakeSite({})
    const result = await checkLanguage({ lang: 'he', current: manifestOf('he', fakeScenes()), readFrame: sameFrames, site: SITE, fetch: site.fetch, log: (line) => logs.push(line) })
    expect(result).toMatchObject({ published: false, beats: [] })
    expect(logs.join('\n')).toMatch(/never published/)
    expect(site.asked).toEqual([manifestUrl(SITE, 'he')])
  })

  it('stops, rather than reporting no gap, when the site cannot be read or the manifest is not one', async () => {
    const current = manifestOf('he', fakeScenes())
    const check = (files) => checkLanguage({ lang: 'he', current, readFrame: sameFrames, site: SITE, fetch: fakeSite(files).fetch })
    await expect(check({ [manifestUrl(SITE, 'he')]: 500 })).rejects.toThrow(/answered 500/)
    await expect(check({ [manifestUrl(SITE, 'he')]: 'not json' })).rejects.toThrow(/not JSON/)
    await expect(check({ [manifestUrl(SITE, 'he')]: JSON.stringify({ ...current, version: 2 }) })).rejects.toThrow(/version/)
    const outside = structuredClone(current)
    outside.beats[0].frame = 'https://elsewhere.example/x.png'
    await expect(check({ [manifestUrl(SITE, 'he')]: JSON.stringify(outside) })).rejects.toThrow(/not well formed/)
    const nameless = structuredClone(current)
    delete nameless.beats[0].id // a regex alone reads undefined as the word "undefined", which has the shape of an id
    await expect(check({ [manifestUrl(SITE, 'he')]: JSON.stringify(nameless) })).rejects.toThrow(/not well formed/)
    const unreachable = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(checkLanguage({ lang: 'he', current, readFrame: sameFrames, site: SITE, fetch: unreachable })).rejects.toThrow(/cannot be reached/)
  })

  it('takes only an https site, or one on this machine', () => {
    expect(siteUrl(undefined)).toBe(PUBLISHED_SITE)
    expect(siteUrl('https://example.github.io/repo')).toBe('https://example.github.io/repo/')
    expect(siteUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/')
    expect(() => siteUrl('http://example.github.io/repo/')).toThrow(/https/)
    expect(() => siteUrl('https://example.github.io/repo/?x=1')).toThrow(/plain/)
  })

  it('writes ids and change names only into the summary', () => {
    const text = summaryOf([{ lang: 'he', published: true, beats: [{ scene: 'home', beat: 'home', changes: ['frame'], pixels: 3 }], frames: [] }])
    expect(text).toContain('| he | home | home | frame (3 pixels) |')
    expect(summaryOf([{ lang: 'he', published: false, beats: [], frames: [] }])).toMatch(/Never published: he/)
  })
})

describe('the gap command', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-gap-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('prints the changed scenes as JSON, keeps the frames, and writes the output and the summary of the step', async () => {
    const recorded = path.join(dir, 'he')
    fs.mkdirSync(recorded)
    const scenes = fakeScenes()
    fs.writeFileSync(path.join(recorded, 'scenes.json'), JSON.stringify(scenes))
    for (const beat of scenes.scenes.flatMap((scene) => scene.beats)) fs.writeFileSync(path.join(recorded, beat.masked), png())
    fs.writeFileSync(path.join(recorded, 'list.masked.png'), png(8, 8, [10, 10, 10]))
    const site = fakeSite(publishedSite(manifestOf('he', scenes, { commit: COMMIT, sources: 'f'.repeat(64) })))
    const env = { GITHUB_OUTPUT: path.join(dir, 'output.txt'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') }
    const printed = []
    const code = await main(['he', '--site', SITE, '--out', path.join(dir, 'out')], env, { fetch: site.fetch, outDir: () => recorded, log: () => {}, print: (text) => printed.push(text), fingerprint: () => 'f'.repeat(64) })
    expect(code).toBe(0)
    const gap = JSON.parse(printed[0])
    expect(gap).toMatchObject({ published: true, since: COMMIT, languages: ['he'], scenes: ['list'], sources: 'same' })
    expect(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe(`scenes=list\nlanguages=he\nsince=${COMMIT}\nsources=same\n`)
    expect(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('| he | list | list | frame')
    expect(fs.readdirSync(path.join(dir, 'out')).sort()).toEqual(['gap.json', 'he-list.new.png', 'he-list.published.png'])
  })

  it("reports the video's own sources as behind when their fingerprint differs, though no screen changed, and not when it is the same", async () => {
    const recorded = path.join(dir, 'he')
    fs.mkdirSync(recorded)
    const scenes = fakeScenes()
    fs.writeFileSync(path.join(recorded, 'scenes.json'), JSON.stringify(scenes))
    for (const beat of scenes.scenes.flatMap((scene) => scene.beats)) fs.writeFileSync(path.join(recorded, beat.masked), png())
    const site = fakeSite(publishedSite(manifestOf('he', scenes, { commit: COMMIT, sources: 'f'.repeat(64) })))
    const run = async (fingerprint) => {
      const env = { GITHUB_OUTPUT: path.join(dir, `output-${fingerprint.slice(0, 1)}.txt`), GITHUB_STEP_SUMMARY: path.join(dir, `summary-${fingerprint.slice(0, 1)}.md`) }
      const printed = []
      expect(await main(['he', '--site', SITE], env, { fetch: site.fetch, outDir: () => recorded, log: () => {}, print: (text) => printed.push(text), fingerprint: () => fingerprint })).toBe(0)
      return { gap: JSON.parse(printed[0]), output: fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), summary: fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') }
    }
    const changed = await run('e'.repeat(64))
    expect(changed.gap).toMatchObject({ scenes: [], sources: 'changed' })
    expect(changed.output).toContain('sources=changed')
    expect(changed.summary).toContain("The video's own sources changed since the last publish.")
    const same = await run('f'.repeat(64))
    expect(same.gap).toMatchObject({ scenes: [], sources: 'same' })
    expect(same.output).toContain('sources=same')
  })

  it('exits 1 with the reason when nothing was recorded', async () => {
    const logs = []
    const code = await main(['he', '--site', SITE], {}, { fetch: fakeSite({}).fetch, outDir: () => path.join(dir, 'none'), log: (line) => logs.push(line), print: () => {} })
    expect(code).toBe(1)
    expect(logs.join('\n')).toMatch(/record the frames first/)
  })
})

describe('the published site', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-site-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('gives every step but the voice an environment without the key', () => {
    const env = withoutKey({ ELEVENLABS_API_KEY: 'x', ELEVENLABS_API_KEY_FILE: 'y', PATH: 'p' })
    expect(env).toEqual({ PATH: 'p' })
  })

  it('fills the player page, escapes each value, and loads nothing from elsewhere', () => {
    const template = fs.readFileSync(path.join(root, 'video', 'site', 'player.html'), 'utf8')
    const page = playerPage(template, 'he', SITE)
    expect(page).not.toMatch(/\{\{/)
    expect(page).not.toMatch(/<script/i)
    expect(page).toContain('<html lang="he" dir="rtl">')
    expect(page).toContain(`<meta property="og:image" content="${SITE}video/he/poster.jpg">`)
    expect(page).toContain(`<meta property="og:video" content="${SITE}video/he.mp4">`)
    expect(page).toContain('<source src="../he.mp4" type="video/mp4">')
    // Every address in an attribute is either one of the page's own files or the site itself.
    for (const [, url] of page.matchAll(/(?:src|href|content)="(https?:[^"]*)"/g)) expect(url.startsWith(SITE), url).toBe(true)
    expect(() => playerPage('{{nothing}}', 'he', SITE)).toThrow(/unknown field/)
    expect(playerPage('{{title}}', 'he', 'https://example.github.io/"<x>/')).not.toMatch(/[<>"]x/)
  })

  it('puts the video, its page, poster, captions, manifest, masked frames and voice where the site and the gap check expect them', () => {
    const recorded = path.join(dir, 'out', 'he')
    fs.mkdirSync(recorded, { recursive: true })
    const scenes = fakeScenes()
    fs.writeFileSync(path.join(recorded, 'scenes.json'), JSON.stringify(scenes))
    for (const beat of scenes.scenes.flatMap((scene) => scene.beats)) fs.writeFileSync(path.join(recorded, beat.masked), png())
    for (const name of ['provider-he.mp4', 'provider-he.jpg', 'provider-he.vtt']) fs.writeFileSync(path.join(recorded, name), name)
    const cache = path.join(dir, 'out', 'voice-cache')
    fs.mkdirSync(cache)
    fs.writeFileSync(path.join(cache, `${'a'.repeat(64)}.mp3`), 'mp3')
    fs.writeFileSync(path.join(cache, `${'a'.repeat(64)}.mp3.123.tmp`), 'half written')
    const siteDir = path.join(dir, 'site')
    const built = buildSite({ langs: ['he'], site: SITE, commit: COMMIT, sources: 'f'.repeat(64), outRoot: path.join(dir, 'out'), siteDir, outDir: () => recorded })
    expect(built.lines).toBe(1)
    const files = fs.readdirSync(siteDir, { recursive: true }).map((file) => String(file).replaceAll('\\', '/')).filter((file) => file.includes('.'))
    expect(files).toEqual(expect.arrayContaining([
      'video/he.mp4', 'video/player.css', 'video/he/index.html', 'video/he/poster.jpg', 'video/he/captions.vtt', 'video/he/manifest.json',
      'video/he/frames/list.masked.png', `video/voice-cache/${'a'.repeat(64)}.mp3`,
    ]))
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false)
    const manifest = JSON.parse(fs.readFileSync(path.join(siteDir, 'video', 'he', 'manifest.json'), 'utf8'))
    expect(manifest).toEqual(manifestOf('he', scenes, { commit: COMMIT, sources: 'f'.repeat(64) }))
    expect(manifest.sources).toBe('f'.repeat(64))
    // Every frame that the manifest names is in the site, where the gap check will look for it.
    for (const beat of manifest.beats) expect(fs.existsSync(path.join(siteDir, 'video', 'he', beat.frame)), beat.frame).toBe(true)
    expect(decodePng(fs.readFileSync(path.join(siteDir, 'video', 'he', 'frames', 'home.masked.png'))).width).toBe(8)
  })

  it('without a key, keeps the published voice of each line it has and leaves the others silent', async () => {
    const lines = scriptLines('he')
    const first = lines[0]
    const hash = cacheKey({ text: first.text, voice: ELEVENLABS_DEFAULTS.voice, model: ELEVENLABS_DEFAULTS.model, lang: 'he' })
    // An mp3 of 40 silent frames (MPEG-1 layer III, 128 kbit/s, 44,100 Hz), as tests/video-voice.test.js makes it.
    const frame = new Uint8Array(417)
    frame.set([0xff, 0xfb, 0x90, 0x00])
    const mp3 = new Uint8Array(417 * 40)
    for (let i = 0; i < 40; i++) mp3.set(frame, i * 417)
    const asked = []
    const site = { get: async (h) => (asked.push(h), h === hash ? mp3 : null) }
    const result = await siteOnlyVoice({ lang: 'he', outRoot: dir, site, env: {}, log: () => {} })
    expect(result.spoken).toEqual([first.id])
    expect(result.silent).toEqual(lines.slice(1).map((line) => line.id))
    expect(asked).toHaveLength(lines.length)
    const timings = JSON.parse(fs.readFileSync(path.join(dir, 'he', 'timings.json'), 'utf8'))
    expect(timings.voice).toBe('elevenlabs') // the credit stays with the lines that the narrator spoke
    expect(timings.beats[first.id].audio).toBe(`${first.id}.mp3`)
    expect(timings.beats[lines[1].id]).toEqual({ seconds: lines[1].seconds, audio: null })
    expect(fs.existsSync(path.join(dir, 'voice-cache', `${hash}.mp3`))).toBe(true) // so that the next publish keeps it
    const none = await siteOnlyVoice({ lang: 'he', outRoot: path.join(dir, 'silent'), site: null, env: {}, log: () => {} })
    expect(none).toMatchObject({ spoken: [], voice: 'none' })
  })

  it('without a key, stops before it writes anything when the site did not answer for every line', async () => {
    // A 404 is a line that the site does not have; a 503, a network failure, a 200 whose body breaks off or passes the size limit, or
    // an answer that is not an mp3 is trouble, which would publish a line silent and drop its audio from the site.
    const brokenBody = () => new Response(new ReadableStream({ start: (controller) => controller.error(new Error('connection reset')) }), { status: 200 })
    const tooLarge = () => new Response(new Uint8Array(11 * 1024 * 1024), { status: 200 })
    for (const answer of [
      () => new Response('busy', { status: 503 }),
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Response('not an mp3', { status: 200 }),
      brokenBody,
      tooLarge,
    ]) {
      const site = watchedSite({ url: `${SITE}video/voice-cache/`, fetch: async () => answer() })
      const outRoot = path.join(dir, String(Math.random()).slice(2))
      await expect(siteOnlyVoice({ lang: 'he', outRoot, site, env: {}, log: () => {} })).rejects.toThrow(/could not be read for every line/)
      expect(fs.existsSync(path.join(outRoot, 'he', 'timings.json'))).toBe(false)
    }
    const quiet = watchedSite({ url: `${SITE}video/voice-cache/`, fetch: async () => new Response('not found', { status: 404 }) })
    await expect(siteOnlyVoice({ lang: 'he', outRoot: dir, site: quiet, env: {}, log: () => {} })).resolves.toMatchObject({ spoken: [], voice: 'none' })
    expect(watchedSite({ url: '' })).toBe(null)
  })
})

// ---- the steps of video.yml that write to GitHub ---------------------------------------------------------------------
//
// A dry run of the issue step on a computer once reached the real gh (19/10/2026; GitHub refused only because the label was
// missing). So every step that calls gh defines one gh() that refuses unless it runs in GitHub Actions on the default branch, or
// a person sets VIDEO_GH_LIVE=1, and these tests run the steps against a fake gh that only writes down its calls.

describe('the steps of video.yml that write to GitHub never reach gh outside GitHub Actions on the default branch', () => {
  const NL = String.fromCharCode(10)
  const lines = fs.readFileSync(path.join(root, '.github/workflows/video.yml'), 'utf8').replaceAll(String.fromCharCode(13), '').split(NL)
  const rule = lines.find((line) => line.startsWith('  VIDEO_GAP_OURS: ')).trim().slice('VIDEO_GAP_OURS: '.length + 1, -1)

  /** Every `run: |` script of the workflow, without its indentation. */
  const runScripts = () => {
    const scripts = []
    lines.forEach((line, at) => {
      if (line.trim() !== 'run: |') return
      const indent = ' '.repeat(line.length - line.trimStart().length + 2)
      const body = []
      for (let i = at + 1; i < lines.length && (lines[i].trim() === '' || lines[i].startsWith(indent)); i++) body.push(lines[i].slice(indent.length))
      scripts.push({ at, body: body.join(NL) })
    })
    return scripts
  }
  /** The run script of the step named `name`. */
  const runOf = (name) => {
    const step = lines.findIndex((line) => line.trim() === `- name: ${name}`)
    return runScripts().find((script) => script.at > step).body
  }

  /** Runs a step under `bash -e` with a fake gh first on the PATH and none of this machine's GITHUB_* or GH_* settings. */
  const runStep = (name, settings) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-gh-'))
    const bin = path.join(dir, 'bin')
    fs.mkdirSync(bin)
    const log = path.join(dir, 'gh.log')
    // The fake gh writes down its calls, and answers like gh would after its --jq. FAKE_GH_ISSUES lists the open video-gap
    // issues as `<number>:<author>`; a list answers with the numbers of those that the workflow opened (VIDEO_GAP_OURS: the
    // login github-actions or app/github-actions). It also answers the body (FAKE_GH_BODY) and the head of the branch (FAKE_GH_HEAD).
    const fake = [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$FAKE_GH_LOG"',
      'case "$1 $2" in',
      '  "issue list") for entry in ${FAKE_GH_ISSUES:-}; do case "${entry#*:}" in github-actions | app/github-actions) echo "${entry%%:*}" ;; esac; done ;;',
      '  "issue view") echo "${FAKE_GH_BODY:-}" ;;',
      '  api*) echo "${FAKE_GH_HEAD:-}" ;;',
      'esac',
      '',
    ]
    fs.writeFileSync(path.join(bin, 'gh'), fake.join(NL), { mode: 0o755 })
    const script = path.join(dir, 'step.sh')
    fs.writeFileSync(script, runOf(name))
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(GITHUB_|GH_|VIDEO_GH_LIVE$|PATH$)/i.test(key)),
    )
    Object.assign(env, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`, FAKE_GH_LOG: log, RUNNER_TEMP: dir, GH_REPO: 'example/video-test', VIDEO_GAP_OURS: rule, ...settings })
    const result = spawnSync('bash', ['-e', script], { env, encoding: 'utf8' })
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(NL).filter(Boolean) : []
    const issue = path.join(dir, 'issue.md')
    const body = fs.existsSync(issue) ? fs.readFileSync(issue, 'utf8') : null
    fs.rmSync(dir, { recursive: true, force: true })
    return { status: result.status, calls, error: result.error, body }
  }

  const ISSUE_STEP = 'Open, update or close the video-gap issue'
  const CLOSE_STEP = 'Close the video-gap issue if the default branch is still the published commit'
  const issueSettings = {
    SCENES: 'password',
    LANGUAGES: 'he',
    SINCE: 'c'.repeat(40),
    MERGE_SHA: 'd'.repeat(40),
    REPO_URL: 'https://github.com/example/video-test',
    RUN_URL: 'https://github.com/example/video-test/actions/runs/1',
  }
  const closeSettings = { PUBLISHED_SHA: 'd'.repeat(40), RUN_URL: 'https://github.com/example/video-test/actions/runs/1' }

  it('guards every step that calls gh', () => {
    const withGh = runScripts().filter((script) => /(^|[^a-z_.-])gh [a-z]/m.test(script.body))
    expect(withGh.length).toBe(2)
    for (const script of withGh) expect(script.body, `the run script at line ${script.at + 1}`).toContain('live || {')
  })

  it('refuses on a computer: no GitHub Actions, so the fake gh is never called', () => {
    for (const [name, settings] of [[ISSUE_STEP, issueSettings], [CLOSE_STEP, closeSettings]]) {
      const run = runStep(name, { ...settings, DEFAULT_BRANCH: 'master' })
      expect(run.error, name).toBeUndefined()
      expect(run.status, name).toBe(97)
      expect(run.calls, name).toEqual([])
    }
  })

  it('refuses in GitHub Actions on another branch', () => {
    const run = runStep(ISSUE_STEP, { ...issueSettings, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/feature', DEFAULT_BRANCH: 'master' })
    expect(run.status).toBe(97)
    expect(run.calls).toEqual([])
  })

  it('reaches gh in GitHub Actions on the default branch, and with VIDEO_GH_LIVE=1 set on purpose', () => {
    const inActions = runStep(ISSUE_STEP, { ...issueSettings, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/master', DEFAULT_BRANCH: 'master' })
    expect(inActions.status).toBe(0)
    expect(inActions.calls[0]).toMatch(/^issue list --label video-gap/)
    expect(inActions.calls.at(-1)).toMatch(/^issue create --title/)
    const live = runStep(CLOSE_STEP, { ...closeSettings, DEFAULT_BRANCH: 'master', VIDEO_GH_LIVE: '1' })
    expect(live.status).toBe(0)
    expect(live.calls[0]).toMatch(/^api repos[/]example[/]video-test[/]commits[/]master/)
    expect(live.calls).toContainEqual(expect.stringMatching(/^issue list --label video-gap/))
  })

  const inActions = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/master', DEFAULT_BRANCH: 'master' }
  // A person's issue with the label (8) beside the one that the workflow opened (7): no path ever writes to 8.
  const both = '8:a-person 7:github-actions'
  const writesTo = (calls, number) => calls.filter((call) => /^issue (edit|close|comment|reopen) /.test(call) && call.split(' ')[2] === String(number))

  it('update: rewrites its own open issue quietly when a later merge leaves scenes behind, never comments, never touches a person\'s', () => {
    const run = runStep(ISSUE_STEP, { ...issueSettings, ...inActions, FAKE_GH_ISSUES: both })
    expect(run.status).toBe(0)
    expect(run.calls).toContainEqual(expect.stringMatching(/^issue edit 7 --body-file /))
    expect(run.calls.some((call) => /^issue (comment|create)/.test(call))).toBe(false)
    expect(writesTo(run.calls, 8)).toEqual([])
  })

  it('opens its own issue when only a person\'s issue has the label', () => {
    const run = runStep(ISSUE_STEP, { ...issueSettings, ...inActions, FAKE_GH_ISSUES: '8:a-person' })
    expect(run.status).toBe(0)
    expect(run.calls.at(-1)).toMatch(/^issue create --title /)
    expect(writesTo(run.calls, 8)).toEqual([])
  })

  it('touches only the issues that it opened: one rule for both steps (VIDEO_GAP_OURS), by its own login, and no step comments', () => {
    const rule = lines.find((line) => line.startsWith('  VIDEO_GAP_OURS: '))
    expect(rule).toContain('select(.author.login | test("^(app/)?github-actions$"))')
    expect(lines[lines.indexOf(rule) - 1]).toBe('env:')
    const withList = runScripts().filter((script) => script.body.includes('gh issue list'))
    expect(withList.length).toBe(2)
    for (const script of withList) {
      expect(script.body, `the run script at line ${script.at + 1}`).toMatch(/--json number,author --jq "[[]?[$]VIDEO_GAP_OURS/)
      expect(script.body).not.toContain('gh issue comment')
      expect(script.body).not.toContain('select(.author')
    }
  })

  it('close on no gap: closes its own open issue when a push finds no scene behind, never a person\'s, and nothing when it has none', () => {
    const closes = runStep(ISSUE_STEP, { ...issueSettings, ...inActions, SCENES: '', LANGUAGES: '', FAKE_GH_ISSUES: both })
    expect(closes.status).toBe(0)
    expect(closes.calls).toContainEqual(expect.stringMatching(/^issue close 7 --reason completed/))
    expect(writesTo(closes.calls, 8)).toEqual([])
    const quiet = runStep(ISSUE_STEP, { ...issueSettings, ...inActions, SCENES: '', LANGUAGES: '', FAKE_GH_ISSUES: '8:a-person' })
    expect(quiet.status).toBe(0)
    expect(quiet.calls).toEqual([expect.stringMatching(/^issue list --label video-gap/)])
  })

  it("sources: a change of the video's own sources with no screen changed opens or updates the issue, saying so; the same sources add nothing", () => {
    const sourcesOnly = { ...issueSettings, ...inActions, SCENES: '', LANGUAGES: '', SOURCES: 'changed' }
    const updates = runStep(ISSUE_STEP, { ...sourcesOnly, FAKE_GH_ISSUES: both })
    expect(updates.status).toBe(0)
    expect(updates.calls).toContainEqual(expect.stringMatching(/^issue edit 7 --body-file /))
    expect(updates.body).toContain("The video's own sources changed since the last publish")
    expect(updates.body).not.toContain('Scenes behind')
    expect(writesTo(updates.calls, 8)).toEqual([])
    const opens = runStep(ISSUE_STEP, { ...sourcesOnly, FAKE_GH_ISSUES: '' })
    expect(opens.status).toBe(0)
    expect(opens.calls.at(-1)).toMatch(/^issue create --title /)
    const same = runStep(ISSUE_STEP, { ...sourcesOnly, SOURCES: 'same', FAKE_GH_ISSUES: both })
    expect(same.status).toBe(0)
    expect(same.calls).toContainEqual(expect.stringMatching(/^issue close 7 --reason completed/))
    const odd = runStep(ISSUE_STEP, { ...sourcesOnly, SOURCES: 'maybe', FAKE_GH_ISSUES: both })
    expect(odd.status).toBe(1)
    expect(odd.calls).toEqual([])
  })

  it('close after a publish: closes its own issue only when the default branch is still the published commit, never a person\'s', () => {
    const issues = '8:a-person 7:app/github-actions'
    const still = runStep(CLOSE_STEP, { ...closeSettings, ...inActions, FAKE_GH_ISSUES: issues, FAKE_GH_HEAD: closeSettings.PUBLISHED_SHA })
    expect(still.status).toBe(0)
    expect(still.calls).toContainEqual(expect.stringMatching(/^issue close 7 --reason completed/))
    expect(writesTo(still.calls, 8)).toEqual([])
    const moved = runStep(CLOSE_STEP, { ...closeSettings, ...inActions, FAKE_GH_ISSUES: issues, FAKE_GH_HEAD: 'e'.repeat(40) })
    expect(moved.status).toBe(0)
    expect(moved.calls).toContainEqual(expect.stringMatching(/^issue edit 7 --body-file /))
    expect(moved.calls.some((call) => /^issue close/.test(call))).toBe(false)
    expect(writesTo(moved.calls, 8)).toEqual([])
  })
})

describe('the conditions of video.yml', () => {
  const NL = String.fromCharCode(10)
  const yml = fs.readFileSync(path.join(root, '.github/workflows/video.yml'), 'utf8').replaceAll(String.fromCharCode(13), '')
  const lines = yml.split(NL)

  it('never runs a job from a tag that is named like the default branch: a ref name is compared only together with a branch ref', () => {
    const blocks = []
    lines.forEach((line, at) => {
      if (line.trim() !== 'if: >-') return
      const indent = ' '.repeat(line.length - line.trimStart().length + 2)
      const body = []
      for (let i = at + 1; i < lines.length && lines[i].startsWith(indent); i++) body.push(lines[i])
      blocks.push(body.join(' '))
    })
    const withRefName = blocks.filter((block) => block.includes('github.ref_name'))
    expect(withRefName.length).toBe(2)
    for (const block of withRefName) expect(block).toContain("github.ref_type == 'branch' && github.ref_name == github.event.repository.default_branch")
  })

  it('runs the gap check on every push to the default branch, ignoring only documentation, with no list of watched files', () => {
    const push = lines.findIndex((line) => line === '  push:')
    const dispatch = lines.findIndex((line) => line === '  workflow_dispatch:')
    const trigger = lines.slice(push, dispatch).map((line) => line.trim())
    expect(trigger).not.toContain('paths:')
    const start = trigger.indexOf('paths-ignore:')
    const ignored = []
    for (let i = start + 1; trigger[i]?.startsWith('- "'); i++) ignored.push(trigger[i].slice(3, -1))
    expect(ignored).toEqual(['**/*.md', 'docs/**'])
    expect(lines.some((line) => line.trim().startsWith("watched='"))).toBe(false)
  })
})

// ---- the fingerprint of the video's own sources (decision D18) ---------------------------------------------------------------

describe("the fingerprint of the video's own sources", () => {
  const NL = String.fromCharCode(10)
  let repo
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', '-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result
  }
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
  }
  const commitAll = () => {
    git('add', '-A')
    git('commit', '-q', '-m', 'step')
  }
  const fingerprint = (env = {}) => sourcesFingerprint({ cwd: repo, env })

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'video-fp-'))
    git('init', '-q')
    write('.gitignore', `video/out/${NL}`)
    write('video/src/Video.jsx', 'export default 1')
    write('video/script/he.js', 'export default {}')
    write('scripts/video/record.spec.mjs', '// the recorder')
    write('src/app.js', 'the app')
    commitAll()
  })
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('is one hash of every tracked file under video/ and scripts/video/ (Markdown aside), and the voice settings', () => {
    expect(VIDEO_SOURCES).toEqual(['video', 'scripts/video'])
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint()).toBe(fingerprint())
  })

  it('changes when a tracked file of the video changes, with no screen changed', () => {
    const before = fingerprint()
    write('video/src/Video.jsx', 'export default 2')
    commitAll()
    expect(fingerprint()).not.toBe(before)
    const again = fingerprint()
    write('scripts/video/record.spec.mjs', '// the recorder, changed')
    commitAll()
    expect(fingerprint()).not.toBe(again)
  })

  it('changes with the voice settings (the model or the voice)', () => {
    const before = fingerprint()
    expect(fingerprint({ ELEVENLABS_MODEL: 'eleven_v3' })).not.toBe(before)
    expect(fingerprint({ ELEVENLABS_VOICE_ID: 'another_voice' })).not.toBe(before)
  })

  it('ignores every Markdown file under the two folders, and still counts any other file', () => {
    const before = fingerprint()
    write('video/README.md', 'how to work on the video')
    write('video/ASSETS.md', 'where the assets come from')
    write('video/script/NOTES.md', 'a note in a nested folder')
    write('scripts/video/NOTES.md', 'a note beside the tools')
    commitAll()
    expect(fingerprint()).toBe(before)
    write('video/README.md', 'how to work on the video, rewritten')
    write('video/ASSETS.md', 'where the assets come from, rewritten')
    commitAll()
    expect(fingerprint()).toBe(before)
    // A file that only contains ".md" in its name is not a Markdown file, and a code file still changes the fingerprint.
    write('video/src/notes.md.js', 'export default 1')
    commitAll()
    const withNotes = fingerprint()
    expect(withNotes).not.toBe(before)
    write('video/script/he.js', 'export default { changed: true }')
    commitAll()
    expect(fingerprint()).not.toBe(withNotes)
  })

  it('ignores untracked and ignored files (video/out), and files outside the two folders', () => {
    const before = fingerprint()
    write('video/out/he/provider-he.mp4', 'a render')
    write('src/app.js', 'the app, changed')
    commitAll()
    write('video/untracked.txt', 'never added') // written after the commit, so git does not track it
    expect(fingerprint()).toBe(before)
  })
})
