// Renders the promo video of one language, silent (the music is a later step): `node video/promo/render.mjs he`, from the root of the repository.
//
// Writes video/out/promo/promo-<lang>.mp4 (1080x1920 at 30 fps, H.264 and AAC), promo-<lang>.jpg (the poster) and, in stills/, one picture
// per scene taken at its last frame (and, for a scene that changes its picture, one just before the change), for looking at each scene.
// The plan is video/promo/timing.js at the default tempo of 120 bpm. The pictures that the scenes name are copied from docs/screenshots/
// into a staged public folder with the drawn sign and the two QR codes (stage.js), which is the only folder the bundle reads.
//
// Node built-ins, Remotion's bundler and renderer, and the pure modules of video/promo/. Nothing is sent anywhere: the browser that Remotion
// renders with (Chrome Headless Shell) is downloaded by it, once, into video/node_modules/.remotion.
import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { exit, hrtime, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { DEMO_QR } from '../src/timing.js'
import { LANGUAGES } from './script/index.js'
import { REPOSITORY_QR, SIGN, demoQrSvg, repositoryQrSvg, signSvg, stagedPictures } from './stage.js'
import { DEFAULT_TEMPO, FPS, HEIGHT, WIDTH, planPromo } from './timing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const videoDir = path.resolve(here, '..')
const screenshotsDir = path.resolve(videoDir, '..', 'docs', 'screenshots')

const say = (line) => stdout.write(`${line}\n`)
const fail = (line) => {
  stderr.write(`${line}\n`)
  exit(1)
}

let lang
try {
  const { positionals } = parseArgs({ allowPositionals: true, options: {}, strict: true })
  if (positionals.length !== 1) throw new Error('one language is needed')
  lang = positionals[0]
  if (!LANGUAGES.includes(lang)) throw new Error(`no script in "${lang}"`)
} catch (error) {
  fail(`${error.message}\nUsage: node video/promo/render.mjs <language>   (from the root of the repository; the languages: ${LANGUAGES.join(', ')})`)
}

const inputProps = { lang, bpm: DEFAULT_TEMPO.bpm, firstBeat: DEFAULT_TEMPO.firstBeat }
const plan = planPromo(lang, DEFAULT_TEMPO)
say(`${plan.scenes.length} scenes, ${plan.bars} bars, ${plan.totalFrames} frames, ${(plan.totalFrames / FPS).toFixed(1)} seconds at ${DEFAULT_TEMPO.bpm} bpm (silent)`)

const started = hrtime.bigint()
const elapsed = () => Number((hrtime.bigint() - started) / 1000000n) / 1000

// staticFile('...') is read from a copy of what the composition needs, never from docs/screenshots/ itself.
const outDir = path.join(videoDir, 'out', 'promo')
const stillsDir = path.join(outDir, 'stills')
const publicDir = path.join(videoDir, 'out', `.public-promo-${lang}`)
rmSync(publicDir, { recursive: true, force: true })
rmSync(stillsDir, { recursive: true, force: true })
mkdirSync(publicDir, { recursive: true })
mkdirSync(stillsDir, { recursive: true })
for (const file of stagedPictures()) cpSync(path.join(screenshotsDir, file), path.join(publicDir, file))
writeFileSync(path.join(publicDir, SIGN.file), signSvg())
writeFileSync(path.join(publicDir, DEMO_QR.file), await demoQrSvg())
writeFileSync(path.join(publicDir, REPOSITORY_QR.file), await repositoryQrSvg()) // from the repository's address, at every render

const serveUrl = await bundle({ entryPoint: path.join(here, 'index.jsx'), publicDir })
const composition = await selectComposition({ serveUrl, id: 'Promo', inputProps })
if (composition.width !== WIDTH || composition.height !== HEIGHT || composition.durationInFrames !== plan.totalFrames) {
  fail(`The composition is ${composition.width}x${composition.height} for ${composition.durationInFrames} frames, not the plan's ${WIDTH}x${HEIGHT} for ${plan.totalFrames}.`)
}

const mp4 = path.join(outDir, `promo-${lang}.mp4`)
let lastTenth = -1
await renderMedia({
  composition,
  serveUrl,
  inputProps,
  codec: 'h264',
  audioCodec: 'aac',
  audioBitrate: '96k',
  enforceAudioTrack: true, // a silent render still has an audio track, so that every player and every mix treats it the same
  pixelFormat: 'yuv420p',
  crf: 23, // flat colours and large text: a lower crf than the tutorial's keeps the gradient from banding
  x264Preset: 'slow',
  imageFormat: 'jpeg',
  jpegQuality: 92,
  outputLocation: mp4,
  overwrite: true,
  onProgress: ({ progress }) => {
    const tenth = Math.floor(progress * 10)
    if (tenth !== lastTenth) {
      lastTenth = tenth
      say(`  render ${tenth * 10}%`)
    }
  },
})

// The poster: the opening question, once its caption is in.
const poster = path.join(outDir, `promo-${lang}.jpg`)
await renderStill({ composition, serveUrl, inputProps, frame: plan.scenes[0].phrases[0].frame + 24, imageFormat: 'jpeg', jpegQuality: 90, output: poster, overwrite: true })

// One still per scene at its last frame, and one just before the change of picture of a scene that has two.
const stills = []
for (const [index, scene] of plan.scenes.entries()) {
  const name = `${String(index + 1).padStart(2, '0')}-${scene.id}`
  const frames = scene.thenFrame == null ? [[name, scene.endFrame - 1]] : [[`${name}-first`, scene.thenFrame - 1], [name, scene.endFrame - 1]]
  for (const [still, frame] of frames) {
    const output = path.join(stillsDir, `${still}.jpg`)
    await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: 'jpeg', jpegQuality: 90, output, overwrite: true })
    stills.push(output)
  }
}
rmSync(publicDir, { recursive: true, force: true })

const bytes = statSync(mp4).size
say(`rendered in ${elapsed().toFixed(1)} s: ${path.relative(videoDir, mp4)} ${(plan.totalFrames / FPS).toFixed(1)} seconds, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${path.relative(videoDir, poster)}, ${stills.length} stills in ${path.relative(videoDir, stillsDir)}`)
