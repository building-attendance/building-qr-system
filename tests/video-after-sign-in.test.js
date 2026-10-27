// The address /video/<lang>/after-sign-in/, which the home screen of release v2.8.0 opens: since the owner decided that both links open the
// whole video (21/10/2026), every publish keeps it as a page that forwards to the player page (scripts/video/render-all.mjs), and the app
// links only to the player page (src/worker/tutorial.js). No network and no browser: the frames are small PNGs made here, in a folder of
// the system's temporary one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidates } from '../scripts/png.mjs'
import { SCENES } from '../video/script/index.js'
import { buildScenes } from '../scripts/video/script.mjs'
import { AFTER_SIGN_IN_DIR, buildSite, forwardPage, playerPage } from '../scripts/video/render-all.mjs'
import { TUTORIAL_BASE, tutorialUrl } from '../src/worker/tutorial.js'
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

describe('the page at the after-sign-in address', () => {
  it('keeps the address that release v2.8.0 opens, so that an installed app never meets a 404', () => {
    expect(AFTER_SIGN_IN_DIR).toBe('after-sign-in')
  })

  it('forwards to the player page one folder up, the whole video, with no player, no start time and no script', () => {
    const page = forwardPage('he', SITE)
    expect(page).toContain('<meta http-equiv="refresh" content="0; url=../">')
    expect(page).toContain('<p><a href="../">' + DRAWN.he.introTitle + '</a></p>')
    expect(page).toContain(`<link rel="canonical" href="${SITE}video/he/">`)
    expect(page).toContain("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; base-uri 'none'; form-action 'none'\">")
    expect(page).toContain('<html lang="he" dir="rtl">')
    for (const absent of ['<video', '<source', '#t=', '<script', '.mp4']) expect(page, absent).not.toContain(absent)
  })

  it('is written in every language of the video, in that language', () => {
    for (const { code, dir } of LANGS) {
      const page = forwardPage(code, SITE)
      expect(page, code).toContain(`<html lang="${code}" dir="${dir}">`)
      expect(page, code).toContain(`<link rel="canonical" href="${SITE}video/${code}/">`)
    }
    expect(() => forwardPage('xx', SITE)).toThrow(/no words for the language/)
  })
})

describe('the site step', () => {
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

  it('writes the forwarding page beside the player page, and the player page starts at 0', () => {
    const siteDir = record(fakeScenes())
    const page = fs.readFileSync(path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR, 'index.html'), 'utf8')
    expect(page).toBe(forwardPage('he', SITE))
    const main = fs.readFileSync(path.join(siteDir, 'video', 'he', 'index.html'), 'utf8')
    expect(main).toBe(playerPage(fs.readFileSync(path.join(root, 'video', 'site', 'player.html'), 'utf8'), 'he', SITE, COMMIT))
    expect(main).toContain(`<source src="../he.mp4?v=${COMMIT.slice(0, 12)}" type="video/mp4">`)
    expect(main).not.toContain('#t=')
    // The page it forwards to is where its relative address leads.
    expect(fs.existsSync(path.resolve(path.join(siteDir, 'video', 'he', AFTER_SIGN_IN_DIR), '..', 'index.html'))).toBe(true)
  })
})

describe('the address of the app', () => {
  it('is the player page from the start in every language, never the after-sign-in address, falling back to Hebrew', () => {
    expect(tutorialUrl('he')).toBe(`${TUTORIAL_BASE}he/`)
    for (const lang of ['en', 'ru', 'ar', 'xx', undefined]) expect(tutorialUrl(lang), String(lang)).toBe(`${TUTORIAL_BASE}he/`)
    for (const lang of ['he', 'en', 'ru', 'ar']) expect(tutorialUrl(lang), lang).not.toContain(AFTER_SIGN_IN_DIR)
  })
})
