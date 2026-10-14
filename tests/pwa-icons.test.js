// The PNG icons (npm run icons) and the places that point at them. iOS ignores an SVG as the Home Screen icon, so the
// app links a 180x180 PNG; the manifest lists 192 and 512 PNGs, and a maskable 512 one that Android can crop to the shape
// of its launcher. The browser test (e2e/pwa.spec.js) checks what a real browser sees, this one checks the files
// themselves, with no browser.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { decodePng as decodeBytes } from '../scripts/png.mjs'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts))
const text = (...parts) => read(...parts).toString('utf8')

/** The width and height written in a PNG's header (IHDR), after checking the file really is a PNG. */
function pngSize(file) {
  const bytes = read('public', file)
  expect(bytes.subarray(0, 8).toString('hex'), `${file} is a PNG file`).toBe('89504e470d0a1a0a')
  expect(bytes.subarray(12, 16).toString('ascii'), `${file} starts with its header chunk`).toBe('IHDR')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

/**
 * The pixels of a PNG of public/: `at(x, y)` is [red, green, blue, alpha]. scripts/png.mjs reads the files (8 bits a channel, not
 * interlaced, RGB, RGBA or indexed, whatever the icons script chose for each) and throws on one it cannot read, which fails the test.
 */
function decodePng(file) {
  const { width, height, rgba } = decodeBytes(read('public', file))
  return { width, height, at: (x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] }
}

// The artwork's own violet (BRAND in scripts/make-icons.mjs, #5B4BDB): the background of every icon, and the colour of the
// corners of the two that are a full square.
const VIOLET = [91, 75, 219]

describe('PNG icons', () => {
  it('are real PNG files of the sizes they are named and listed for', () => {
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180])
    expect(pngSize('pwa-192x192.png')).toEqual([192, 192])
    expect(pngSize('pwa-512x512.png')).toEqual([512, 512])
    expect(pngSize('pwa-maskable-512x512.png')).toEqual([512, 512])
  })

  it('the page links the 180x180 PNG as its Home Screen icon, and keeps the SVG as the browser tab icon', () => {
    const html = text('index.html')
    expect(html).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/)
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/pwa-192x192\.svg" \/>/)
  })

  it('the manifest lists the 192 and 512 PNGs, and the build ships the Home Screen icon', () => {
    const config = text('vite.config.js')
    expect(config).toContain("{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }")
    expect(config).toContain("{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }")
    expect(config).toMatch(/includeAssets: \[[^\]]*'apple-touch-icon\.png'/)
  })

  it('can be made again from the SVG with one command', () => {
    expect(JSON.parse(text('package.json')).scripts.icons).toBe('node scripts/make-icons.mjs')
    expect(text('scripts', 'make-icons.mjs')).toContain("'pwa-512x512.svg'")
    expect(fs.existsSync(path.join(root, 'public', 'pwa-512x512.svg'))).toBe(true)
  })

  // iOS paints a see-through pixel of its Home Screen icon black, so that file is a full square on the violet. The two icons of the
  // manifest keep the artwork's rounded corners: see-through outside them, the violet inside. (e2e/pwa.spec.js checks the same
  // on what a browser decodes; this reads the files, whichever way scripts/png.mjs wrote them.)
  it('the Home Screen icon is violet to the edge with no see-through pixel, and the two manifest icons have see-through rounded corners', () => {
    const home = decodePng('apple-touch-icon.png')
    for (let y = 0; y < home.height; y++) for (let x = 0; x < home.width; x++) if (home.at(x, y)[3] !== 255) throw new Error(`apple-touch-icon.png is see-through at ${x},${y}`)
    const last = home.width - 1
    for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]]) expect(home.at(x, y), `the corner ${x},${y} of the Home Screen icon`).toEqual([...VIOLET, 255])
    for (const [file, size] of [['pwa-192x192.png', 192], ['pwa-512x512.png', 512]]) {
      const icon = decodePng(file)
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) expect(icon.at(x, y)[3], `the corner ${x},${y} of ${file}`).toBe(0)
      expect(icon.at(0, size / 2), `the middle of the left edge of ${file}`).toEqual([...VIOLET, 255])
    }
  })

  // The icon is the app's primary violet and white, nothing else: a colour of an older logo (the old blue) left in
  // one of the files would show on a Home Screen or in a browser tab.
  it('are drawn in the one violet of the app and in white, in the script, in both SVGs and in the stylesheet', () => {
    const brand = /const BRAND = '(#[0-9A-Fa-f]{6})'/.exec(text('scripts', 'make-icons.mjs'))?.[1]
    expect(brand?.toUpperCase(), 'the colour that the script paints behind the artwork').toBe('#5B4BDB')
    expect(text('src', 'ui', 'ui.css').toLowerCase(), 'it is the primary colour of the light theme').toContain(`--w-primary: ${brand.toLowerCase()};`)
    for (const file of ['pwa-512x512.svg', 'pwa-192x192.svg']) {
      const svg = text('public', file)
      expect(svg, `${file} has the brand colour behind the artwork`).toMatch(new RegExp(`<rect width="512" height="512" rx="80" fill="${brand}"/>`, 'i'))
      const colours = [...svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1].toLowerCase())
      expect(new Set(colours), `${file} paints only the brand violet and white`).toEqual(new Set([brand.toLowerCase(), '#fff', 'none']))
    }
  })
})

describe('the maskable icon', () => {
  const FILE = 'pwa-maskable-512x512.png'
  const SIZE = 512
  // What every launcher shape keeps, whatever it is: the circle in the centre with a diameter of 80% of the width.
  const SAFE_RADIUS = 0.4 * SIZE

  it('is listed in the manifest as a maskable 512x512 PNG, and the script that makes the PNGs makes it', () => {
    const config = text('vite.config.js')
    expect(config).toContain("{ src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }")
    const script = text('scripts', 'make-icons.mjs')
    expect(script).toMatch(/file: 'pwa-maskable-512x512\.png', size: 512, background: BRAND/)
  })

  it('is a full square without one transparent pixel, because a launcher paints transparent pixels in its own colour', () => {
    const icon = decodePng(FILE)
    expect([icon.width, icon.height]).toEqual([SIZE, SIZE])
    const see = []
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (icon.at(x, y)[3] !== 255) see.push([x, y])
    expect(see, 'pixels that are not fully opaque').toEqual([])
    const last = SIZE - 1
    for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]]) expect(icon.at(x, y), `the corner ${x},${y}`).toEqual([...VIOLET, 255])
  })

  // The artwork is a white scan frame (four corner brackets) with a QR inside it, drawn straight on the background: there is
  // no tile, so the test looks at every pixel that is not the background. That is stricter than looking at a tile, because
  // the frame's brackets are the part of the drawing that reaches farthest from the centre.
  it('keeps all of its artwork inside the safe zone, and the artwork is there, centred and not tiny', () => {
    const icon = decodePng(FILE)
    let farthest = 0
    let [left, top, right, bottom] = [SIZE, SIZE, -1, -1]
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const pixel = icon.at(x, y)
        // Blending the artwork's rounded violet corners over the same violet can be one level off in a channel: still the background
        if (VIOLET.every((level, channel) => Math.abs(pixel[channel] - level) <= 2)) continue
        // the far corner of the pixel, so that a pixel that only touches the circle with its corner counts as outside it
        farthest = Math.max(farthest, Math.hypot(Math.abs(x + 0.5 - SIZE / 2) + 0.5, Math.abs(y + 0.5 - SIZE / 2) + 0.5))
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
    expect(right, 'the icon is not just one colour').toBeGreaterThan(left)
    expect(farthest, 'every pixel that is not the background violet lies inside the centre circle of 80% of the width').toBeLessThanOrEqual(SAFE_RADIUS)
    // the frame is a square that fills more than half of the width (the QR alone, without its frame, would be 30%): not
    // shrunk to a speck, and in the middle
    expect(right - left + 1).toBeGreaterThanOrEqual(0.5 * SIZE)
    expect(bottom - top + 1).toBeGreaterThanOrEqual(0.5 * SIZE)
    expect(Math.abs(left + right + 1 - SIZE), 'centred left and right').toBeLessThanOrEqual(2)
    expect(Math.abs(top + bottom + 1 - SIZE), 'centred top and bottom').toBeLessThanOrEqual(2)
  })
})

describe('the manifest and the precache', () => {
  const config = text('vite.config.js')

  it('has an explicit id that is the same identity as the start URL gave before, so installed copies are not duplicated', () => {
    expect(config).toMatch(/\bid: '\/',\s*start_url: '\/',/)
  })

  it('keeps the maskable icon out of the precache: the system fetches it at install time, no page shows it', () => {
    // globIgnores keeps it out of the globbed files; the plugin's own addition of every manifest icon is off, because
    // globIgnores does not apply to what is added by hand (e2e/pwa.spec.js checks the built service worker)
    expect(config).toMatch(/globIgnores: \[[^\]]*'\*\*\/pwa-maskable-\*'/)
    expect(config).toContain('includeManifestIcons: false')
  })
})
