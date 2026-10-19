// The timings of the provider tutorial video: how long each line of the narration really runs, and the timings.json that the
// narrator (scripts/video/voice.mjs) writes for the composer (video/, T2). Node built-ins only.
//
// The contract with the composer: video/out/<lang>/timings.json is
//   { lang, voice: 'elevenlabs' | 'files' | 'none', beats: { <beat id>: { seconds, audio } } }
// with one entry for every beat that has a line of its own (a beat that `continues` the line before it is never in it, and keeps
// the seconds of scenes.json). `audio` is the name of an mp3 in video/out/<lang>/voice/, or null; `seconds` is the length of that
// audio plus the pause after the line (PAUSE_SECONDS). With the voice `none` every beat has `audio: null` and the seconds of the
// script (video/script/index.js), which are the estimates.
//
// The length of an mp3 is read from its own frame headers (mp3Seconds), so neither a decoder nor the provider's word timings are
// needed, and the three sources of a line (the published site, the local cache, a fresh synthesis or a recording) are measured the
// same way.

/** The silence after each spoken line before the next beat starts, in seconds. */
export const PAUSE_SECONDS = 0.5

/** The names of the voices that timings.json may carry. */
export const VOICES = Object.freeze(['elevenlabs', 'files', 'none'])

// MPEG audio, layer III only (what ElevenLabs answers and what an mp3 encoder writes). The tables are those of ISO 11172-3 and
// ISO 13818-3: the bit rate in kbit/s by its index (0 is "free format" and 15 is invalid, both refused), the sample rate in Hz by
// its index (3 is reserved), for MPEG-1 and for MPEG-2 and 2.5.
const BITRATES = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/**
 * The frame that starts at `pos`, or null when no valid layer III frame header is there.
 * @param {Uint8Array} bytes
 * @param {number} pos
 */
function frameAt(bytes, pos) {
  if (pos + 4 > bytes.length) return null
  const [b0, b1, b2] = [bytes[pos], bytes[pos + 1], bytes[pos + 2]]
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null
  const version = (b1 >> 3) & 3 // 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5, 1 reserved
  const layer = (b1 >> 1) & 3 // 1 is layer III
  if (version === 1 || layer !== 1) return null
  const kbps = (version === 3 ? BITRATES.mpeg1 : BITRATES.mpeg2)[b2 >> 4]
  const rate = SAMPLE_RATES[version][(b2 >> 2) & 3]
  if (!kbps || !rate) return null
  const padding = (b2 >> 1) & 1
  const samples = version === 3 ? 1152 : 576
  const length = Math.floor(((samples / 8) * kbps * 1000) / rate) + padding
  return { length, seconds: samples / rate }
}

/** The length of an ID3v2 tag at the start of the file (0 when there is none). */
function id3Length(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0 // "ID3"
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  const footer = bytes[5] & 0x10 ? 10 : 0
  return 10 + size + footer
}

/**
 * How long an mp3 runs, in seconds: the sum of its frames, after an ID3v2 tag. A byte that does not start a frame is skipped, so
 * an ID3v1 tag at the end or a stray byte costs nothing. Throws when the bytes hold no complete frame (not an mp3).
 * @param {Uint8Array} bytes
 */
export function mp3Seconds(bytes) {
  const start = id3Length(bytes)
  let pos = start
  let seconds = 0
  let covered = 0
  while (pos + 4 <= bytes.length) {
    const frame = frameAt(bytes, pos)
    if (frame && pos + frame.length <= bytes.length) {
      seconds += frame.seconds
      covered += frame.length
      pos += frame.length
    } else {
      pos += 1
    }
  }
  // In an mp3 the frames are nearly every byte after the tag. Another kind of audio (a WAV, an M4A saved as .mp3) can hold a few
  // bytes that read as a frame header, but they never cover most of the file.
  if (!covered || covered < MIN_COVERED * (bytes.length - start)) throw new Error('not an mp3 (no run of MPEG layer III frames)')
  return seconds
}

/** The share of the bytes after an ID3v2 tag that frames must cover for the bytes to be an mp3. */
const MIN_COVERED = 0.9

/** Seconds rounded to the millisecond, so that timings.json does not carry the noise of floating point. */
const round = (seconds) => Math.round(seconds * 1000) / 1000

/**
 * The seconds of a beat whose line was spoken: the audio and the pause after it.
 * @param {number} audioSeconds
 */
export function spokenSeconds(audioSeconds) {
  return round(audioSeconds + PAUSE_SECONDS)
}

/**
 * The content of timings.json.
 * @param {string} lang
 * @param {'elevenlabs' | 'files' | 'none'} voice
 * @param {readonly { id: string, seconds: number, audio: string | null }[]} beats  in the order of the video
 */
export function buildTimings(lang, voice, beats) {
  if (!VOICES.includes(voice)) throw new Error(`"${voice}" is not a voice of timings.json (${VOICES.join(', ')}).`)
  return {
    lang,
    voice,
    beats: Object.fromEntries(beats.map((beat) => [beat.id, { seconds: round(beat.seconds), audio: beat.audio }])),
  }
}
