// scripts/png.mjs: the PNG reader and writer that `npm run icons` uses to make the icons smaller without changing a pixel. The
// promise is that the file it writes holds the same RGBA values, byte for byte, as the picture that Chromium drew, and that a picture
// with more than 256 colours is never reduced to fit a palette.
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { decodePng, candidates, smallestLossless } from '../scripts/png.mjs'

/** A picture as a Chromium screenshot would hold it: RGBA, `paint(x, y)` gives [red, green, blue, alpha]. */
function picture(width, height, paint) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4)
  return { width, height, rgba }
}

/** How many different RGBA values a picture holds. */
const distinct = (rgba) => new Set(Array.from({ length: rgba.length / 4 }, (_, p) => rgba.readUInt32LE(p * 4))).size

/** A PNG file written the plain way (no filter, truecolor), which is what the optimiser starts from. */
function plainPng({ width, height, rgba }, withAlpha) {
  const bpp = withAlpha ? 4 : 3
  const raw = Buffer.alloc((width * bpp + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.copy(raw, y * (width * bpp + 1) + 1 + x * bpp, (y * width + x) * 4, (y * width + x) * 4 + bpp)
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'ascii')
    body.copy(out, 8)
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = withAlpha ? 6 : 2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Few colours, with see-through pixels: a rounded-off corner like the icons have, white on violet, and a half see-through edge.
const FEW = picture(24, 24, (x, y) => {
  if (x < 2 && y < 2) return [0, 0, 0, 0]
  if (x === 2 && y === 2) return [91, 75, 219, 128]
  return x > 8 && x < 16 && y > 8 && y < 16 ? [255, 255, 255, 255] : [91, 75, 219, 255]
})
// More than 256 different colours: a gradient in which every pixel is its own colour (32 x 32 = 1024 of them).
const MANY = picture(32, 32, (x, y) => [x * 8, y * 8, (x + y) % 256, 255])

describe('candidates and smallestLossless', () => {
  it('give a picture of 256 colours or fewer an indexed file, with its see-through entries in a tRNS chunk, and every candidate reads back the same', () => {
    const found = candidates(FEW)
    expect(found.some((option) => option.kind.startsWith('indexed'))).toBe(true)
    for (const option of found) {
      const back = decodePng(option.bytes)
      expect([back.width, back.height], option.kind).toEqual([FEW.width, FEW.height])
      expect(back.rgba.equals(FEW.rgba), `${option.kind} has the same RGBA values`).toBe(true)
    }
    const indexed = found.find((option) => option.kind.startsWith('indexed'))
    expect(decodePng(indexed.bytes).colorType).toBe(3)
    expect(indexed.bytes.includes('tRNS')).toBe(true)
  })

  it('never quantizes: a picture of more than 256 colours has no indexed candidate, and what it gets reads back the same', () => {
    const found = candidates(MANY)
    expect(found.length).toBeGreaterThan(0)
    for (const option of found) {
      expect(option.kind, 'no palette for 1024 colours').not.toMatch(/indexed/)
      expect(decodePng(option.bytes).rgba.equals(MANY.rgba), `${option.kind} has the same RGBA values`).toBe(true)
    }
    const best = smallestLossless(plainPng(MANY, false))
    expect(best.colours).toBe(1024)
    expect(distinct(FEW.rgba), 'the few-colour picture really has few').toBe(4)
    expect(decodePng(best.bytes).rgba.equals(MANY.rgba)).toBe(true)
  })

  it('hands back a file that is no bigger than the one it was given and has the same pixels, counting the colours', () => {
    for (const [image, withAlpha] of [[FEW, true], [FEW, false], [MANY, false]]) {
      const original = plainPng(image, withAlpha)
      const best = smallestLossless(original)
      const expected = decodePng(original).rgba
      expect(best.colours, 'the number of different RGBA values').toBe(distinct(expected))
      expect(best.original).toBe(original.length)
      expect(best.bytes.length).toBeLessThanOrEqual(original.length)
      expect(decodePng(best.bytes).rgba.equals(expected)).toBe(true)
    }
  })

  it('keeps the file as it is when nothing smaller holds the same pixels', () => {
    const tiny = picture(1, 1, () => [1, 2, 3, 255])
    const original = candidates(tiny).map((option) => option.bytes).sort((a, b) => a.length - b.length)[0]
    expect(smallestLossless(original).bytes.equals(original)).toBe(true)
  })
})

describe('decodePng', () => {
  it('refuses what it cannot read exactly, instead of guessing', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/)
    const good = plainPng(FEW, true)
    // a flipped byte in the header chunk: the checksum no longer matches
    const bad = Buffer.from(good)
    bad[16] ^= 1
    expect(() => decodePng(bad)).toThrow(/checksum/)
    // 16 bits a channel
    const sixteen = Buffer.from(good)
    sixteen[24] = 16
    sixteen.writeUInt32BE(zlib.crc32(sixteen.subarray(12, 29)), 29)
    expect(() => decodePng(sixteen)).toThrow(/8 bits/)
  })
})
