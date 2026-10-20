// Writes video/src/assets/tap.wav, the soft tick that plays at every tap of the video (decisions D10 and D16). It is made here, from a
// sine with a short downward glide and its octave below, so that no third party's sound is in the repository: lower, rounder and
// gentler than the first version (a pitch of 1500 Hz and a 1 ms attack). The file is committed (about 12 KB); run this only to change
// the sound: `node video/src/make-tap-sound.mjs`. How loud it plays is TAP_VOLUME in timing.js.
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const RATE = 44100
const SECONDS = 0.14
const ATTACK_SECONDS = 0.006 // a gentle start, no click
const samples = Math.round(RATE * SECONDS)
const data = Buffer.alloc(samples * 2)
for (let i = 0; i < samples; i += 1) {
  const t = i / RATE
  const decay = Math.exp(-t * 34)
  const attack = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t / ATTACK_SECONDS))
  // The pitch starts at 450 Hz and settles to 360 Hz within about 25 ms, like a finger on a soft surface; the phase is the integral.
  const phase = 2 * Math.PI * (360 * t + (90 * (1 - Math.exp(-40 * t))) / 40)
  const tone = Math.sin(phase) * 0.7 + Math.sin(phase / 2) * 0.3
  data.writeInt16LE(Math.round(tone * decay * attack * 0.4 * 32767), i * 2)
}

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

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'tap.wav')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, data]))
