// A small PNG reader and writer on node:zlib alone (no dependency), for scripts/make-icons.mjs and the tests that look at the
// icons. It reads 8 bits a channel, not interlaced, as RGB, RGBA or indexed (what Chromium writes and what the icons are), and
// it writes the smallest file that holds exactly the same pixels.
//
// Why: Chromium's screenshot is a fast encoder, so the icons it writes are bigger than they have to be, and every phone downloads
// three of them with each version of the app (the precache). Nothing here changes a pixel: `smallestLossless` builds the
// candidates (an indexed PNG when the picture has 256 colours or fewer, a truecolor one with its rows filtered the best way and
// compressed at the highest level), reads each one back, and keeps a candidate only when every pixel of its RGBA is the same as the
// original's. A picture is never quantized: a picture with more than 256 colours simply has no indexed candidate.
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Bytes that one pixel takes in the image data, by colour type: 2 is RGB, 3 is indexed, 6 is RGBA. */
const BYTES_PER_PIXEL = { 2: 3, 3: 1, 6: 4 }

/**
 * Reads a PNG file.
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number, colorType: number, rgba: Buffer }} `rgba` holds four bytes a pixel, row after row.
 */
export function decodePng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file')
  let header = null
  let palette = null
  let alphas = null
  const data = []
  for (let at = 8; at < bytes.length; ) {
    if (at + 12 > bytes.length) throw new Error('a PNG chunk is cut short')
    const length = bytes.readUInt32BE(at)
    if (at + 12 + length > bytes.length) throw new Error('a PNG chunk is cut short')
    const type = bytes.toString('ascii', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (zlib.crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) throw new Error(`the ${type} chunk has a wrong checksum`)
    at += 12 + length
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), bitDepth: body[8], colorType: body[9], interlace: body[12] }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alphas = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
  }
  if (!header) throw new Error('the PNG has no header')
  const { width, height, bitDepth, colorType, interlace } = header
  if (bitDepth !== 8 || interlace !== 0) throw new Error('only 8 bits a channel, not interlaced, is supported')
  const bpp = BYTES_PER_PIXEL[colorType]
  if (!bpp) throw new Error(`colour type ${colorType} is not supported`)
  if (colorType === 3 && !palette) throw new Error('an indexed PNG has no palette')
  if (colorType === 2 && alphas) throw new Error('a transparent colour of an RGB PNG is not supported')

  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = width * bpp
  if (raw.length !== (stride + 1) * height) throw new Error('the image data is not the size of the picture')
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error(`unknown PNG filter ${filter}`)
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? pixels[y * stride + i - bpp] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0
      const upLeft = y > 0 && i >= bpp ? pixels[(y - 1) * stride + i - bpp] : 0
      pixels[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predict(filter, left, up, upLeft)) & 255
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    if (colorType === 6) pixels.copy(rgba, p * 4, p * 4, p * 4 + 4)
    else if (colorType === 2) {
      pixels.copy(rgba, p * 4, p * 3, p * 3 + 3)
      rgba[p * 4 + 3] = 255
    } else {
      const entry = pixels[p]
      if (entry * 3 + 3 > palette.length) throw new Error('a pixel points past the end of the palette')
      palette.copy(rgba, p * 4, entry * 3, entry * 3 + 3)
      rgba[p * 4 + 3] = alphas && entry < alphas.length ? alphas[entry] : 255
    }
  }
  return { width, height, colorType, rgba }
}

/** The value that a row filter predicts for a byte, from the byte to its left, above it and above-left. */
function predict(filter, left, up, upLeft) {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  const guess = left + up - upLeft
  const [distLeft, distUp, distUpLeft] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)]
  return distLeft <= distUp && distLeft <= distUpLeft ? left : distUp <= distUpLeft ? up : upLeft
}

/** Filters the rows of an image, either with no filter at all or, row by row, with the filter that leaves the smallest numbers. */
function filterRows(pixels, width, height, bpp, mode) {
  const stride = width * bpp
  const out = Buffer.alloc((stride + 1) * height)
  const candidate = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    let bestCost = Infinity
    for (const filter of mode === 'none' ? [0] : [0, 1, 2, 3, 4]) {
      let cost = 0
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? pixels[y * stride + i - bpp] : 0
        const up = y > 0 ? pixels[(y - 1) * stride + i] : 0
        const upLeft = y > 0 && i >= bpp ? pixels[(y - 1) * stride + i - bpp] : 0
        const value = (pixels[y * stride + i] - predict(filter, left, up, upLeft)) & 255
        candidate[i] = value
        cost += value < 128 ? value : 256 - value
      }
      if (cost < bestCost) {
        bestCost = cost
        out[y * (stride + 1)] = filter
        candidate.copy(out, y * (stride + 1) + 1)
      }
    }
  }
  return out
}

/** One chunk of a PNG file: length, type, body and the checksum of type and body. */
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  body.copy(out, 8)
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}

/** A whole PNG file from the image data (already filtered). */
function file(width, height, colorType, imageData, extraChunks = []) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits a channel
  header[9] = colorType
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...extraChunks,
    chunk('IDAT', zlib.deflateSync(imageData, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Every encoding that is worth trying for a picture, as PNG files: an indexed one when it has 256 colours or fewer (the palette
 * holds every RGBA value exactly, so nothing is rounded), and a truecolor one (RGB when no pixel is see-through, RGBA when one is),
 * each with the unfiltered and with the adaptively filtered rows. None of them is checked here: `smallestLossless` reads them back.
 * @param {{ width: number, height: number, rgba: Buffer }} image
 * @returns {{ kind: string, bytes: Buffer }[]}
 */
export function candidates({ width, height, rgba }) {
  const count = width * height
  const found = []

  const colours = new Map()
  for (let p = 0; p < count && colours.size <= 256; p++) {
    const key = rgba.readUInt32LE(p * 4)
    if (!colours.has(key)) colours.set(key, colours.size)
  }
  if (colours.size <= 256) {
    // See-through entries first, so that the tRNS chunk only has to list those (an entry that it does not list is opaque).
    const entries = [...colours.keys()].sort((a, b) => (a >>> 24) - (b >>> 24) || colours.get(a) - colours.get(b))
    const slot = new Map(entries.map((key, index) => [key, index]))
    const plte = Buffer.alloc(entries.length * 3)
    const alphas = []
    entries.forEach((key, index) => {
      plte[index * 3] = key & 255
      plte[index * 3 + 1] = (key >>> 8) & 255
      plte[index * 3 + 2] = (key >>> 16) & 255
      if (key >>> 24 !== 255) alphas.push(key >>> 24)
    })
    const indexes = Buffer.alloc(count)
    for (let p = 0; p < count; p++) indexes[p] = slot.get(rgba.readUInt32LE(p * 4))
    const extra = [chunk('PLTE', plte), ...(alphas.length ? [chunk('tRNS', Buffer.from(alphas))] : [])]
    for (const mode of ['none', 'adaptive']) found.push({ kind: `indexed, ${mode} filter`, bytes: file(width, height, 3, filterRows(indexes, width, height, 1, mode), extra) })
  }

  let opaque = true
  for (let p = 0; p < count && opaque; p++) opaque = rgba[p * 4 + 3] === 255
  const bpp = opaque ? 3 : 4
  const pixels = Buffer.alloc(count * bpp)
  for (let p = 0; p < count; p++) rgba.copy(pixels, p * bpp, p * 4, p * 4 + bpp)
  for (const mode of ['none', 'adaptive']) found.push({ kind: `${opaque ? 'RGB' : 'RGBA'}, ${mode} filter`, bytes: file(width, height, opaque ? 2 : 6, filterRows(pixels, width, height, bpp, mode)) })
  return found
}

/**
 * The smallest PNG file with exactly the pixels of `original`. A candidate counts only when it is read back to the same RGBA, byte
 * for byte, as the original; if none is smaller than the original, the original is returned as it is.
 * @param {Buffer} original a PNG file
 * @returns {{ bytes: Buffer, kind: string, colours: number, original: number }} `colours` is the number of different RGBA values.
 */
export function smallestLossless(original) {
  const image = decodePng(original)
  const seen = new Set()
  for (let p = 0; p < image.width * image.height; p++) seen.add(image.rgba.readUInt32LE(p * 4))
  let best = { bytes: original, kind: 'as Chromium wrote it' }
  for (const option of candidates(image)) {
    if (option.bytes.length >= best.bytes.length) continue
    if (!decodePng(option.bytes).rgba.equals(image.rgba)) continue
    best = option
  }
  return { ...best, colours: seen.size, original: original.length }
}
