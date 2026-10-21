// The page that starts the tutorial video after the sign-in (scripts/video/render-all.mjs, video/site/player.html), and the app's address
// for it (src/worker/tutorial.js). No network and no browser: the frames are small PNGs made here, in a folder of the system's temporary one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidates } from '../scripts/png.mjs'
import { SCENES } from '../video/script/index.js'
import { buildScenes } from '../scripts/video/script.mjs'
import { AFTER_SIGN_IN_BEAT, AFTER_SIGN_IN_DIR, afterSignInStart, buildSite, playerPage } from '../scripts/video/render-all.mjs'
import { AFTER_SIGN_IN_DIR as APP_AFTER_SIGN_IN_DIR, TUTORIAL_BASE, tutorialUrl } from '../src/worker/tutorial.js'
import { DRAWN } from '../video/script/drawn.js'
import { LANGS } from '../src/i18n/core.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const SITE = 'https://example.github.io/video-test/'
const COMMIT = 'c'.repeat(40)

/** The scenes.json of the script: a capture for each beat, as the recorder writes it. */
function fakeScenes() {
  const captures = {}
  for (const beat of SCENES.flatMap((scene) => scene.beats)) {
    captures[beat.id] = { image: `${beat.id}.png`, masked: `${beat.id}.masked.png`, width: 8, height: 8, scale: 1, tap: null, highlight: null }
  }
  return buildScenes('he', captures)
}

const withoutBeat = (scenes, id) => ({ ...scenes, scenes: scenes.scenes.map((scene) => ({ ...scene, beats: scene.beats.filter((beat) => beat.id !== id) })).filter((scene) => scene.beats.length) })

/** The seconds of the beats before `id`, as the plan without timings adds them up. */
function secondsBefore(scenes, id) {
  const beats = scenes.scenes.flatMap((scene) => scene.beats)
  return beats.slice(0, beats.findIndex((beat) => beat.id === id)).reduce((sum, beat) => sum + beat.seconds, 0)
}

describe('where the page that starts after the sign-in starts the video', () => {
  it('is the start of the beat locating, from the estimates of scenes.json when there is no timings.json', () => {
    const scenes = fakeScenes()
    expect(AFTER_SIGN_IN_BEAT).toBe('locating')
    const start = afterSignInStart(scenes)
    expect(start).toBeGreaterThan(0)
    expect(start).toBeCloseTo(secondsBefore(scenes, 'locating'), 1)
  })

  it('follows the timings of the narrator, so that it moves with the video', () => {
    const scenes = fakeScenes()
    const before = afterSignInStart(scenes)
    const sign = scenes.scenes.flatMap((scene) => scene.beats).find((beat) => beat.id === 'sign')
    const timings = { beats: { sign: { seconds: sign.seconds + 3, audio: 'sign.mp3' } } }
    expect(afterSignInStart(scenes, timings)).toBeCloseTo(before + 3, 1)
    // A line with no real duration changes nothing (planBeats), and a beat after locating does not move the start.
    expect(afterSignInStart(scenes, { beats: { sign: { seconds: 0, audio: null } } })).toBe(before)
    expect(afterSignInStart(scenes, { beats: { recorded: { seconds: 40, audio: null } } })).toBe(before)
  })

  it('is on a frame of the video (30 per second) and rounded to the millisecond', () => {
    const scenes = fakeScenes()
    const timings = { beats: { sign: { seconds: 11.2345, audio: null } } }
    const start = afterSignInStart(scenes, timings)
    expect(start).toBe(Math.round(start * 1000) / 1000)
    expect(Math.abs(start * 30 - Math.round(start * 30))).toBeLessThan(0.05)
  })

  it('is null when the video has no such beat', () => {
    expect(afterSignInStart(withoutBeat(fakeScenes(), 'locating'))).toBeNull()
    expect(afterSignInStart({ scenes: [] })).toBeNull()
  })
})

describe('the player page', () => {
  const template = fs.readFileSync(path.join(root, 'video', 'site', 'player.html'), 'utf8')

  it('is as before for the whole video: its own folder, no fragment, no link back', () => {
    const page = playerPage(template, 'he', SITE)
    expect(page).not.toMatch(/\{\{/)
    expect(page).not.toContain('<!--after-sign-in')
    expect(page).not.toContain('<a href="../">')
    expect(page).toContain('<link rel="stylesheet" href="../player.css">')
    expect(page).toContain('poster="poster.jpg"')
    expect(page).toContain('<source src="../he.mp4" type="video/mp4">')
    expect(page).toContain('<track kind="captions" src="captions.vtt"')
    expect(page).toContain(`<meta property="og:url" content="${SITE}video/he/">`)
    expect(page).not.toContain(DRAWN.he.watchFromStart)
  })

  it('after the sign-in, sits one folder deeper, starts at the fragment, links back to the start and is its own address', () => {
    const page = playerPage(template, 'he', SITE, { start: 36.333 })
    expect(page).not.toMatch(/\{\{/)
    expect(page).not.toMatch(/<script/i)
    expect(page).toContain('<link rel="stylesheet" href="../../player.css">')
    expect(page).toContain('poster="../poster.jpg"')
    expect(page).toContain('<source src="../../he.mp4#t=36.333" type="video/mp4">')
    expect(page).toContain('<track kind="captions" src="../captions.vtt"')
    expect(page).toContain('<a href="../">' + DRAWN.he.watchFromStart + '</a>')
    expect(page).toContain(`<meta property="og:url" content="${SITE}video/he/${AFTER_SIGN_IN_DIR}/">`)
    // The preview of a shared link shows the whole video, not a fragment.
    expect(page).toContain(`<meta property="og:video" content="${SITE}video/he.mp4">`)
    expect(page).toContain(`<meta property="og:image" content="${SITE}video/he/poster.jpg">`)
  })

  it('starts at 0 (no fragment) when the beat is missing, and still links back', () => {
    const page = playerPage(template, 'he', SITE, { start: null })
    expect(page).toContain('<source src="../../he.mp4" type="video/mp4">')
    expect(page).toContain(DRAWN.he.watchFromStart)
  })

  it('has the words of the link back in every language of the app, in the language of the page', () => {
    for (const { code } of LANGS) {
      expect(DRAWN[code].watchFromStart, code).toMatch(/\S/)
      expect(playerPage(template, code, SITE, { start: 1 }), code).toContain(`>${DRAWN[code].watchFromStart}</a>`)
    }
  })
})

describe('the site step writes the page that starts after the sign-in', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-after-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function record(scenes, timings = null) {
    const recorded = path.join(dir, 'out', 'he')
    fs.mkdirSync(recorded, { recursive: true })
    fs.writeFileSync(path.join(recorded, 'scenes.json'), JSON.stringify(scenes))
    if (timings) fs.writeFileSync(path.join(recorded, 'timings.json'), JSON.stringify(timings))
    const frame = candidates({ width: 8, height: 8, rgba: Buffer.alloc(8 * 8 * 4, 255) }).at(-1).bytes
    for (const beat of scenes.scenes.flatMap((scene) => scene.beats)) fs.writeFileSync(path.join(recorded, beat.masked), frame)
    for (const name of ['provider-he.mp4', 'provider-he.jpg', 'provider-he.vtt']) fs.writeFileSync(path.join(recorded, name), name)
    const siteDir = path.join(dir, 'site')
    buildSite({ langs: ['he'], site: SITE, commit: COMMIT, sources: 'f'.repeat(64), outRoot: path.join(dir, 'out'), siteDir, outDir: () => recorded })
    return siteDir
  }

  it('with the fragment of the beat locating, and leaves the main page as it was', () => {
    const scenes = fakeScenes()
    const siteDir = record(scenes)
    const page = fs.readFileSync(path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR, 'index.html'), 'utf8')
    expect(page).toContain(`<source src="../../he.mp4#t=${afterSignInStart(scenes)}" type="video/mp4">`)
    const main = fs.readFileSync(path.join(siteDir, 'video', 'he', 'index.html'), 'utf8')
    expect(main).toBe(playerPage(fs.readFileSync(path.join(root, 'video', 'site', 'player.html'), 'utf8'), 'he', SITE))
    // Every file that the deeper page names is where its relative address leads.
    const folder = path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR)
    for (const [, address] of page.matchAll(/(?:src|href)="(\.\.\/[^"#]*)/g)) expect(fs.existsSync(path.resolve(folder, address)), address).toBe(true)
  })

  it('takes the timings of the render into account', () => {
    const scenes = fakeScenes()
    const timings = { lang: 'he', voice: 'none', beats: { sign: { seconds: 20, audio: null } } }
    const siteDir = record(scenes, timings)
    const page = fs.readFileSync(path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR, 'index.html'), 'utf8')
    expect(page).toContain(`he.mp4#t=${afterSignInStart(scenes, timings)}"`)
    expect(afterSignInStart(scenes, timings)).toBeGreaterThan(afterSignInStart(scenes))
  })

  it('without the fragment when the video has no such beat', () => {
    const siteDir = record(withoutBeat(fakeScenes(), 'locating'))
    const page = fs.readFileSync(path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR, 'index.html'), 'utf8')
    expect(page).toContain('<source src="../../he.mp4" type="video/mp4">')
    expect(page).not.toContain('#t=')
  })
})

describe('the address of the app', () => {
  it('names the same folder as the site step, so that the link of the home screen never opens a 404', () => {
    expect(APP_AFTER_SIGN_IN_DIR).toBe(AFTER_SIGN_IN_DIR)
    expect(AFTER_SIGN_IN_DIR).toBe('after-sign-in')
  })

  it('is the player page from the start, or the page after the sign-in, falling back to Hebrew', () => {
    expect(tutorialUrl('he')).toBe(`${TUTORIAL_BASE}he/`)
    expect(tutorialUrl('he', { afterSignIn: true })).toBe(`${TUTORIAL_BASE}he/after-sign-in/`)
    for (const lang of ['en', 'ru', 'ar', 'xx', undefined]) {
      expect(tutorialUrl(lang), String(lang)).toBe(`${TUTORIAL_BASE}he/`)
      expect(tutorialUrl(lang, { afterSignIn: true }), String(lang)).toBe(`${TUTORIAL_BASE}he/after-sign-in/`)
    }
  })
})
