// Renders the promo video of one language: `node video/promo/render.mjs he`, from the root of the repository, at 120 bpm with only the effect sounds, or with the
// owner's licensed track on its own beat:
//   node video/promo/render.mjs he --music <file> --bpm <tempo> --first-beat <seconds> [--start <seconds>]
// `--music` is a local .mp3, .wav or .m4a that is never committed (music.js refuses a path inside the repository except under video/out/);
// `--bpm` and `--first-beat` (the second of the first beat after the start) are required with it and make the plan; `--start` is the second
// of the file where the music starts (default 0). The track is copied into the staged public folder, faded in and out by music.js.
//
// Writes video/out/promo/promo-<lang>.mp4 (1080x1920 at 30 fps, H.264 and AAC), promo-<lang>.jpg (the poster) and, in stills/, one picture
// per scene taken at its last frame (and, for a scene that changes its picture, one just before the change), for looking at each scene,
// and one per effect (effect-*.jpg). The sounds of the effects (make-sounds.mjs) are made at every render and staged with the pictures.
// The plan is video/promo/timing.js at the tempo it is given (120 bpm without a track). The pictures that the scenes name are copied from docs/screenshots/
// into a staged public folder with the drawn sign and the two QR codes (stage.js), which is the only folder the bundle reads.
//
// Node built-ins, Remotion's bundler and renderer, and the pure modules of video/promo/. Nothing is sent anywhere: the browser that Remotion
// renders with (Chrome Headless Shell) is downloaded by it, once, into video/node_modules/.remotion.
import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process, { exit, hrtime, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bundle } from '@remotion/bundler'
import { RenderInternals, renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { DEMO_QR } from '../src/timing.js'
import { writeSounds } from './make-sounds.mjs'
import { checkMusicPath, checkMusicStart, stagedMusicFile, startFrameOf } from './music.js'
import { LANGUAGES } from './script/index.js'
import { REPOSITORY_QR, SIGN, demoQrSvg, repositoryQrSvg, signSvg, stagedPictures } from './stage.js'
import { DEFAULT_TEMPO, FPS, GROOVE_SCENE, HEIGHT, WHIP_FRAMES, WIDTH, burstFrame, planPromo } from './timing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const videoDir = path.resolve(here, '..')
const screenshotsDir = path.resolve(videoDir, '..', 'docs', 'screenshots')

const say = (line) => stdout.write(`${line}\n`)
const fail = (line) => {
  stderr.write(`${line}\n`)
  exit(1)
}

const repositoryRoot = path.resolve(videoDir, '..')

/** A number option, read strictly: `Number('')` is 0 and `Number('1e3')` is 1000, so the text must be a plain decimal, and none is negative. */
function numberOption(name, text) {
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`--${name} needs a number of zero or more, not "${text}"`)
  return Number(text)
}

let lang
let tempo = DEFAULT_TEMPO
let music = null // { path, start } when a track is given
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { music: { type: 'string' }, bpm: { type: 'string' }, 'first-beat': { type: 'string' }, start: { type: 'string' } },
    strict: true,
  })
  if (positionals.length !== 1) throw new Error('one language is needed')
  lang = positionals[0]
  if (!LANGUAGES.includes(lang)) throw new Error(`no script in "${lang}"`)
  if (values.music === undefined) {
    if (values.bpm !== undefined || values['first-beat'] !== undefined || values.start !== undefined) throw new Error('--bpm, --first-beat and --start go with --music')
  } else {
    if (values.bpm === undefined || values['first-beat'] === undefined) throw new Error('--music needs --bpm and --first-beat (the tempo of the track and the second of its first beat after the start)')
    tempo = { bpm: numberOption('bpm', values.bpm), firstBeat: numberOption('first-beat', values['first-beat']) }
    music = { path: checkMusicPath(values.music, repositoryRoot), start: values.start === undefined ? 0 : numberOption('start', values.start) }
  }
} catch (error) {
  fail(
    `${error.message}\nUsage: node video/promo/render.mjs <language> [--music <file> --bpm <tempo> --first-beat <seconds> [--start <seconds>]]\n` +
      `(from the root of the repository; the languages: ${LANGUAGES.join(', ')}; a track is a local .mp3, .wav or .m4a that is never committed)`,
  )
}

let plan
try {
  plan = planPromo(lang, tempo) // refuses a tempo at which a caption does not fit, naming its scene
} catch (error) {
  fail(error.message)
}

if (music) {
  // The length of the file, by the ffprobe that Remotion ships, so that a start that leaves too little of the track is refused before the render.
  try {
    const probe = await RenderInternals.callFf({
      bin: 'ffprobe',
      args: ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', music.path],
      indent: false,
      logLevel: 'error',
      binariesDirectory: null,
      cancelSignal: undefined,
    })
    const seconds = Number(probe.stdout.trim())
    if (!Number.isFinite(seconds)) throw new Error('no length')
    // The start is snapped to a frame, as the audio takes it, and the check is made on that.
    checkMusicStart(startFrameOf(music.start) / FPS, seconds, plan.totalFrames / FPS)
  } catch (error) {
    fail(/^The (track|start)/.test(error.message) ? error.message : `The length of the music file "${path.basename(music.path)}" could not be read: is it a sound file?`)
  }
}

const inputProps = {
  lang,
  bpm: tempo.bpm,
  firstBeat: tempo.firstBeat,
  music: music ? { file: stagedMusicFile(music.path), startFrame: startFrameOf(music.start) } : null,
  sounds: true, // the effect sounds of make-sounds.mjs, written to the staged folder below
}
say(
  `${plan.scenes.length} scenes, ${plan.bars} bars, ${plan.totalFrames} frames, ${(plan.totalFrames / FPS).toFixed(1)} seconds at ${tempo.bpm} bpm ` +
    (music ? `(music: ${path.basename(music.path)} from ${music.start} s)` : '(no music, the effect sounds only)'),
)

const started = hrtime.bigint()
const elapsed = () => Number((hrtime.bigint() - started) / 1000000n) / 1000

// staticFile('...') is read from a copy of what the composition needs, never from docs/screenshots/ itself.
const outDir = path.join(videoDir, 'out', 'promo')
const stillsDir = path.join(outDir, 'stills')
const publicDir = path.join(videoDir, 'out', `.public-promo-${lang}`)
// The bundle copies the public folder, so it is written here too (not to the system's temp folder) and removed with it: the track is left nowhere.
const bundleDir = path.join(videoDir, 'out', `.bundle-promo-${lang}`)
const cleanUp = () => {
  rmSync(publicDir, { recursive: true, force: true })
  rmSync(bundleDir, { recursive: true, force: true })
}
cleanUp()
process.on('exit', cleanUp) // also when a step fails or fail() exits
rmSync(stillsDir, { recursive: true, force: true })
mkdirSync(publicDir, { recursive: true })
mkdirSync(stillsDir, { recursive: true })
for (const file of stagedPictures()) cpSync(path.join(screenshotsDir, file), path.join(publicDir, file))
if (music) cpSync(music.path, path.join(publicDir, inputProps.music.file)) // the staged folder is removed on exit, so the track stays only where it was
writeSounds(publicDir) // the whoosh, the impact and the ding: made from code at every render, never committed
writeFileSync(path.join(publicDir, SIGN.file), signSvg())
writeFileSync(path.join(publicDir, DEMO_QR.file), await demoQrSvg())
writeFileSync(path.join(publicDir, REPOSITORY_QR.file), await repositoryQrSvg()) // from the repository's address, at every render

const serveUrl = await bundle({ entryPoint: path.join(here, 'index.jsx'), publicDir, outDir: bundleDir })
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
  enforceAudioTrack: true, // a render without music still has an audio track, so that every player and every mix treats it the same
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

// One still per scene at its last frame before the whip that takes it out (the last scene: its last frame), and one just before the change of
// picture of a scene that has two.
const stills = []
for (const [index, scene] of plan.scenes.entries()) {
  const name = `${String(index + 1).padStart(2, '0')}-${scene.id}`
  const settled = scene.endFrame - 1 - (index < plan.scenes.length - 1 ? WHIP_FRAMES : 0)
  const frames = scene.thenFrame == null ? [[name, settled]] : [[`${name}-first`, scene.thenFrame - 1], [name, settled]]
  for (const [still, frame] of frames) {
    const output = path.join(stillsDir, `${still}.jpg`)
    await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: 'jpeg', jpegQuality: 90, output, overwrite: true })
    stills.push(output)
  }
}

// One still per effect, for looking at it: the whip halfway, the punch of the groove with the phone still tilted, the phone settling, and the
// confetti twice (just after the burst and as it falls).
const groove = plan.scenes.find((scene) => scene.id === GROOVE_SCENE)
const burst = burstFrame(plan, tempo)
const effects = [
  ['whip', plan.scenes[1].endFrame - WHIP_FRAMES / 2],
  ['punch-and-tilt', groove.startFrame + 1],
  ['tilt-settling', groove.startFrame + 6],
  ['confetti-burst', burst + 6],
  ['confetti-fall', burst + 24],
]
for (const [name, frame] of effects) {
  const output = path.join(stillsDir, `effect-${name}.jpg`)
  await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: 'jpeg', jpegQuality: 90, output, overwrite: true })
  stills.push(output)
}

const bytes = statSync(mp4).size
say(`rendered in ${elapsed().toFixed(1)} s: ${path.relative(videoDir, mp4)} ${(plan.totalFrames / FPS).toFixed(1)} seconds, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${path.relative(videoDir, poster)}, ${stills.length} stills in ${path.relative(videoDir, stillsDir)}`)
