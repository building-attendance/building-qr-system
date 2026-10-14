// Makes the PNG icons from the SVG artwork.   Usage: npm run icons
//
// iOS ignores an SVG as the Home Screen icon: it needs a PNG (180x180) that is a full square. It rounds the corners
// itself and paints every transparent pixel black, so that icon is drawn on a solid background. The manifest gets 192
// and 512 PNGs that keep the artwork's own rounded corners (transparent outside them), and a 512 maskable PNG.
//
// Android crops a launcher icon to the shape its maker chose (a circle, a squircle). An icon declared only as `any` is
// not cropped but shrunk onto a white disc, so the manifest also lists a `maskable` one: a full square with no
// transparent pixel, the whole artwork drawn at MASKABLE_SCALE of the width and centred, on the artwork's own background
// colour. The part that every shape keeps is the centre circle of 80% of the width, so everything that is not the
// background (the white scan frame with its four corners, and the QR inside it) has to end up inside that circle;
// tests/pwa-icons.test.js checks it on the PNG itself.
//
// The source is public/pwa-512x512.svg. To change the logo: replace that file, run `npm run icons`, commit the PNGs.
// The drawing is done by the Chromium that Playwright already installs for the end-to-end tests, so there is no
// extra tool to install.
//
// Chromium's PNG is written by a fast encoder, and every phone downloads three of these files with each version of the app
// (the precache), so each file is written again, smaller, by scripts/png.mjs: as an indexed PNG when its picture has 256 colours
// or fewer, otherwise as a truecolor one with better filtering and compression. Never by reducing the colours: the new file is
// read back and kept only if every pixel (every RGBA value) is the same as in Chromium's picture, and when no encoding is
// smaller the file stays as Chromium wrote it.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { smallestLossless } from './png.mjs'

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

// The colour behind the artwork. It fills the rounded-off corners of the SVG in the Home Screen icon and in the maskable
// icon, so it has to be the artwork's own background colour (the violet of its outer rectangle), which is also the app's
// primary colour (--w-primary in src/ui/ui.css). tests/pwa-icons.test.js keeps the three in step.
const BRAND = '#5B4BDB'

// The share of the width that the artwork takes in the maskable icon. The corners of the white scan frame are the part of
// the artwork that is farthest from the centre: at full size they are 43.9% of the width away from it, outside the safe
// circle (a radius of 40% of the width); at 0.8 they are 35.1% away, inside it.
const MASKABLE_SCALE = 0.8

const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, background: BRAND, scale: 1 },
  { file: 'pwa-192x192.png', size: 192, background: null, scale: 1 },
  { file: 'pwa-512x512.png', size: 512, background: null, scale: 1 },
  { file: 'pwa-maskable-512x512.png', size: 512, background: BRAND, scale: MASKABLE_SCALE },
]

const svg = fs.readFileSync(path.join(publicDir, 'pwa-512x512.svg'), 'utf8')
const browser = await chromium.launch()
try {
  for (const { file, size, background, scale } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    // The SVG is a vector: drawn at the target size it is sharp, nothing is scaled up from a bitmap.
    const drawn = size * scale
    const place = scale === 1 ? '' : `;position:absolute;left:${(size - drawn) / 2}px;top:${(size - drawn) / 2}px`
    const sized = svg.replace('<svg ', `<svg style="width:${drawn}px;height:${drawn}px;display:block${place}" `)
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${background ?? 'transparent'}">${sized}</body></html>`,
    )
    const rendered = await page.screenshot({ omitBackground: background === null })
    await page.close()
    const best = smallestLossless(rendered)
    fs.writeFileSync(path.join(publicDir, file), best.bytes)
    const note = background ? `on ${background}` : 'transparent corners'
    console.log(`${file}  ${size}x${size}  ${note}${scale === 1 ? '' : `  artwork at ${scale * 100}% of the width`}`)
    console.log(`  ${best.colours} different colours, written as ${best.kind}: ${best.bytes.length} bytes (Chromium's file: ${best.original})`)
  }
} finally {
  await browser.close()
}
