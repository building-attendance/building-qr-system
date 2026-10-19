// Writes video/src/assets/tap.wav, the soft tick that plays at every tap of the video (decision D10: no music, a narrator and a tap
// sound). It is made here, from two sine waves with a fast decay, so that no third party's sound is in the repository. The file is
// committed (8 KB); run this only to change the sound: `node video/src/make-tap-sound.mjs`.
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const RATE = 44100
const SECONDS = 0.09
const samples = Math.round(RATE * SECONDS)
const data = Buffer.alloc(samples * 2)
for (let i = 0; i < samples; i += 1) {
  const t = i / RATE
  const decay = Math.exp(-t * 60)
  const attack = Math.min(1, i / 40) // no click at the very start
  const tone = Math.sin(2 * Math.PI * 1500 * t) * 0.6 + Math.sin(2 * Math.PI * 750 * t) * 0.4
  data.writeInt16LE(Math.round(tone * decay * attack * 0.45 * 32767), i * 2)
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
