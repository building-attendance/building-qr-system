// Renders the provider tutorial video of one language: `npm --prefix video run render -- he`.
//
// Reads video/out/<lang>/ (the frames and scenes.json of `npm run video:frames`, and timings.json and voice/ when the narrator has written
// them) and writes, beside them, provider-<lang>.mp4 (720x1280, H.264 and AAC, at most 8 MB), provider-<lang>.jpg (the poster) and
// provider-<lang>.vtt (the captions). Without a timings.json the video runs the estimated seconds of scenes.json and has no voice (only the
// tap sounds): a silent render.
//
// Node built-ins, Remotion's bundler and renderer, and timing.js (pure). Nothing of the app is imported, and nothing is sent anywhere: the
// browser that Remotion renders with (Chrome Headless Shell) is downloaded by it, once, into video/node_modules/.remotion.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { argv, exit, hrtime, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { FPS, isSafeAudioName, planBeats, toVtt } from './timing.js'

/** The most that the mp4 may weigh (it goes to a page and to a phone). */
const MAX_BYTES = 8 * 1024 * 1024

/** The frame of the poster: the title card of the opening, once it has faded in. */
const POSTER_FRAME = 25

const here = path.dirname(fileURLToPath(import.meta.url))
const videoDir = path.resolve(here, '..')

const say = (line) => stdout.write(`${line}\n`)
const warn = (line) => stderr.write(`${line}\n`)
const fail = (line) => {
  warn(line)
  exit(1)
}

const lang = argv[2]
if (!lang || !/^[a-z]{2}$/.test(lang)) fail('Usage: npm --prefix video run render -- <language>   (for example: he)')

const outDir = path.join(videoDir, 'out', lang)
const scenesPath = path.join(outDir, 'scenes.json')
if (!existsSync(scenesPath)) fail(`No ${path.relative(videoDir, scenesPath)}: run "npm run video:frames" at the root of the repository first.`)
const scenes = JSON.parse(readFileSync(scenesPath, 'utf8'))
if (scenes.lang !== lang) fail(`scenes.json is of "${scenes.lang}", not "${lang}".`)

// timings.json, when the narrator has written it: the real seconds of each line and the file that says it. A beat whose audio file is
// missing keeps its seconds and has no voice, with a warning, never a silent gap in the middle of a line.
let timings = null
const timingsPath = path.join(outDir, 'timings.json')
if (existsSync(timingsPath)) {
  const read = JSON.parse(readFileSync(timingsPath, 'utf8'))
  if (read.lang !== lang) fail(`timings.json is of "${read.lang}", not "${lang}".`)
  const beats = {}
  for (const [id, entry] of Object.entries(read.beats ?? {})) {
    const audio = isSafeAudioName(entry?.audio) && existsSync(path.join(outDir, 'voice', entry.audio)) ? entry.audio : null
    if (entry?.audio && !audio) warn(`timings.json: the audio of "${id}" (${String(entry.audio).slice(0, 60)}) is not a file of voice/: no voice for that beat.`)
    beats[id] = { seconds: entry?.seconds, audio }
  }
  timings = { lang, voice: read.voice ?? 'none', beats }
  say(`voice: ${timings.voice} (timings.json, ${Object.keys(beats).length} beat(s))`)
} else {
  say('voice: none (no timings.json: the estimated seconds of scenes.json)')
}

const inputProps = { lang, scenes, timings }
const plan = planBeats(scenes, timings)
say(`${plan.beats.length} beats, ${plan.totalFrames} frames, ${plan.seconds.toFixed(1)} seconds`)

const started = hrtime.bigint()
const seconds = () => Number((hrtime.bigint() - started) / 1000000n) / 1000

// staticFile('list.png') and staticFile('voice/<file>') are read from a copy of what the composition needs (the pictures and the voice), not
// from the folder of the language itself: that folder also holds the output of the last render, which the bundle would copy again.
const publicDir = path.join(videoDir, 'out', `.public-${lang}`)
rmSync(publicDir, { recursive: true, force: true })
mkdirSync(publicDir, { recursive: true })
for (const file of readdirSync(outDir)) {
  if (/^[a-z0-9-]+\.png$/.test(file) && !file.endsWith('.masked.png')) cpSync(path.join(outDir, file), path.join(publicDir, file))
}
if (existsSync(path.join(outDir, 'voice'))) cpSync(path.join(outDir, 'voice'), path.join(publicDir, 'voice'), { recursive: true })

const serveUrl = await bundle({ entryPoint: path.join(here, 'index.jsx'), publicDir })
const composition = await selectComposition({ serveUrl, id: 'Provider', inputProps })

const mp4 = path.join(outDir, `provider-${lang}.mp4`)
let lastTenth = -1
await renderMedia({
  composition,
  serveUrl,
  inputProps,
  codec: 'h264',
  audioCodec: 'aac',
  audioBitrate: '96k',
  enforceAudioTrack: true, // a silent render still has an audio track (the tap sounds), so that every player and every mix treats it the same
  pixelFormat: 'yuv420p',
  crf: 28,
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

rmSync(publicDir, { recursive: true, force: true })

const poster = path.join(outDir, `provider-${lang}.jpg`)
await renderStill({ composition, serveUrl, inputProps, frame: POSTER_FRAME, imageFormat: 'jpeg', jpegQuality: 88, output: poster, overwrite: true })

const vtt = path.join(outDir, `provider-${lang}.vtt`)
mkdirSync(outDir, { recursive: true })
writeFileSync(vtt, toVtt(plan, FPS))

const bytes = statSync(mp4).size
say(`rendered in ${seconds().toFixed(1)} s: ${path.relative(videoDir, mp4)} ${(bytes / 1024 / 1024).toFixed(2)} MB, ${path.relative(videoDir, poster)}, ${path.relative(videoDir, vtt)}`)
if (bytes > MAX_BYTES) fail(`The video is ${(bytes / 1024 / 1024).toFixed(2)} MB, more than the ${MAX_BYTES / 1024 / 1024} MB that it may weigh.`)
