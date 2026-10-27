// Renders the stills of `PromoParts` (PromoParts.jsx), one picture of each part of the long cut before it moves, while it moves and settled:
//   node video/promo/parts/stills.mjs
// from the root of the repository, after `npm run promo:frames` has recorded the pictures into video/out/promo-frames/he/. It checks that
// folder's frames.json (stage.js, checkFrames), copies the pictures the showcase shows into a staged public folder, and writes
// video/out/promo-parts/<name>.png (under video/out/, which git ignores). Node built-ins, Remotion's bundler and renderer, and the pure
// modules of video/promo/. Nothing is sent anywhere.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process, { exit, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { checkFrames, stagedPictures } from '../stage.js'
import { DEFAULT_TEMPO } from '../timing.js'
import { SHOWCASE_SCENES, planShowcase, showcaseStills } from './showcase.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const videoDir = path.resolve(here, '..', '..')
const framesDir = path.join(videoDir, 'out', 'promo-frames', 'he')
const outDir = path.join(videoDir, 'out', 'promo-parts')
const publicDir = path.join(videoDir, 'out', '.public-promo-parts')
const bundleDir = path.join(videoDir, 'out', '.bundle-promo-parts')

const say = (line) => stdout.write(`${line}\n`)
const fail = (line) => {
  stderr.write(`${line}\n`)
  exit(1)
}

const framesFile = path.join(framesDir, 'frames.json')
if (!existsSync(framesFile)) fail(`No ${path.relative(videoDir, framesFile)}. Run \`npm run promo:frames\` to record the pictures of the long promo.`)
const pictures = stagedPictures(SHOWCASE_SCENES) // only what the showcase shows: a recording that lacks another picture does not stop it
let frames
try {
  frames = checkFrames(readFileSync(framesFile, 'utf8'), { pictures })
} catch (error) {
  fail(error.message)
}
for (const file of pictures) {
  if (!existsSync(path.join(framesDir, file))) fail(`No ${file} in ${path.relative(videoDir, framesDir)}. Run \`npm run promo:frames\` to record the pictures of the long promo.`)
}

const cleanUp = () => {
  rmSync(publicDir, { recursive: true, force: true })
  rmSync(bundleDir, { recursive: true, force: true })
}
cleanUp()
process.on('exit', cleanUp)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(publicDir, { recursive: true })
mkdirSync(outDir, { recursive: true })
for (const file of pictures) cpSync(path.join(framesDir, file), path.join(publicDir, file))

const inputProps = { lang: 'he', frames, firstFrameWhole: true }
const serveUrl = await bundle({ entryPoint: path.join(here, '..', 'index.jsx'), publicDir, outDir: bundleDir })
const composition = await selectComposition({ serveUrl, id: 'PromoParts', inputProps })
const stills = showcaseStills(planShowcase(DEFAULT_TEMPO), DEFAULT_TEMPO)
for (const [name, frame] of stills) {
  const output = path.join(outDir, `${name}.png`)
  await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: 'png', output, overwrite: true })
  say(`  ${path.relative(videoDir, output)} (frame ${frame})`)
}
say(`${stills.length} stills of ${composition.durationInFrames} frames in ${path.relative(videoDir, outDir)}`)
