// The three sounds of the promo video's effects (decision D16, W5), made from code at every render and never committed, like the tutorial's
// tap (video/src/make-tap-sound.mjs): a whoosh at each transition, an impact on the first beat of the groove and a ding when the check-in
// screen appears. They are quiet next to the music (SOUNDS in timing.js sets how loud each plays) and the same bytes at every render:
// the noise of the whoosh comes from a fixed seed. render.mjs calls `writeSounds(folder)`; tests/video-promo.test.js calls `makeSounds()`.
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FPS, SOUNDS, WHIP_FRAMES } from './timing.js'

export const RATE = 44100
/** The loudest sample of a sound, as a share of full scale. */
export const PEAK = 0.8
const SEED = 20261026

/** A small seeded generator (mulberry32): the same numbers at every run. */
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)))

/** Scales the samples to PEAK, fades the last 10 ms to silence (no click at the end), and returns a 16-bit mono WAV file. */
function toWav(samples) {
  let top = 0
  for (const value of samples) top = Math.max(top, Math.abs(value))
  const tail = Math.round(RATE * 0.01)
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((value, index) => {
    const fade = Math.min(1, (samples.length - 1 - index) / tail)
    data.writeInt16LE(Math.round((value / top) * PEAK * fade * 32767), index * 2)
  })
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16) // the size of the format block
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28) // bytes per second
  header.writeUInt16LE(2, 32) // bytes per sample frame
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const count = (seconds) => Math.round(RATE * seconds)

/** Filtered noise whose centre climbs from 300 Hz to 5 kHz: it swells for the length of the whip, is loudest on the bar line, then falls away. */
function whoosh() {
  const next = random(SEED)
  const rise = WHIP_FRAMES / FPS
  const samples = new Float64Array(count(SOUNDS.whoosh.seconds))
  let low = 0
  let band = 0
  samples.forEach((_, index) => {
    const t = index / RATE
    const centre = 300 * (5000 / 300) ** Math.min(1, t / (SOUNDS.whoosh.seconds * 0.9))
    const f = 2 * Math.sin((Math.PI * centre) / RATE)
    const high = next() * 2 - 1 - low - band / 3 // a state-variable filter, Q of 3
    band += f * high
    low += f * band
    const swell = t < rise ? smooth(t / rise) ** 2 : Math.exp(-(t - rise) * 14)
    samples[index] = band * swell
  })
  return samples
}

/** A low sine that drops from about 130 Hz to 38 Hz, with its octave (so a phone's small speaker has something to play) and a short thud. */
function impact() {
  const next = random(SEED + 1)
  const samples = new Float64Array(count(SOUNDS.impact.seconds))
  let click = 0
  samples.forEach((_, index) => {
    const t = index / RATE
    const phase = 2 * Math.PI * (38 * t + (92 * (1 - Math.exp(-14 * t))) / 14)
    const attack = smooth(t / 0.003)
    click += 0.2 * (next() * 2 - 1 - click) // noise through a one-pole low-pass: a soft thud, not a hiss
    samples[index] = attack * (Math.sin(phase) * Math.exp(-t * 4.2) + 0.35 * Math.sin(phase * 2) * Math.exp(-t * 7) + 0.6 * click * Math.exp(-t * 60))
  })
  return samples
}

/** Two sines, a fifth apart (C6 and G6), the second a little after the first, each ringing out. */
function ding() {
  const samples = new Float64Array(count(SOUNDS.ding.seconds))
  samples.forEach((_, index) => {
    const t = index / RATE
    const first = Math.sin(2 * Math.PI * 1046.5 * t) * smooth(t / 0.004) * Math.exp(-t * 7)
    const late = t - 0.07
    const second = late > 0 ? Math.sin(2 * Math.PI * 1568 * late) * smooth(late / 0.004) * Math.exp(-late * 7) : 0
    samples[index] = first * 0.6 + second * 0.5
  })
  return samples
}

/** The three sounds as WAV files in memory, keyed like SOUNDS. */
export function makeSounds() {
  return { whoosh: toWav(whoosh()), impact: toWav(impact()), ding: toWav(ding()) }
}

/** Writes the three sounds into a folder (the staged public folder of the render). */
export function writeSounds(folder) {
  mkdirSync(folder, { recursive: true })
  const sounds = makeSounds()
  for (const [kind, wav] of Object.entries(sounds)) writeFileSync(path.join(folder, SOUNDS[kind].file), wav)
  return Object.keys(sounds).map((kind) => SOUNDS[kind].file)
}
