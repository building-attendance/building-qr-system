// The ElevenLabs narrator (decision D2): one call of the text-to-speech API per line that is in no cache, within the budget of the
// run that voice.mjs keeps.
//
// The key (a secret, docs/runbooks/secrets.md):
//  - it comes from the environment only: ELEVENLABS_API_KEY, or ELEVENLABS_API_KEY_FILE (the path of a file that holds only the
//    key, so that a local run never puts the key on a command line). Never both;
//  - it is read once (readKey), kept in the closure of the provider (never a property, so printing the provider shows nothing),
//    and sent only in the `xi-api-key` header of a request to ELEVENLABS_API, whose address is a constant, not a setting;
//  - it is never printed, logged, written to a file or put into an error: an error names the HTTP status, or the kind of network
//    failure, and the line's id, and nothing that the service answered.
// tests/video-voice.test.js holds all of it with a fake HTTP layer: no test calls the service.

import fs from 'node:fs'
import { readCapped } from './http.mjs'

/** The one address the key is ever sent to. */
export const ELEVENLABS_API = 'https://api.elevenlabs.io'

/**
 * The settings of the narrator, each of which an environment variable may change for one run (elevenlabsSettings). The model is
 * one of the Hebrew-capable models of the owner's account (eleven_v4, eleven_v4_turbo, eleven_v3 on 11/10/2026), and the voice
 * is that account's Hebrew voice Maya. 128 kbit/s mp3 is the best format of the free plan.
 */
export const ELEVENLABS_DEFAULTS = Object.freeze({
  model: 'eleven_v4',
  voice: 'Eeft0b98WgvueYFzGZAg',
  outputFormat: 'mp3_44100_128',
})

export const KEY_VARIABLE = 'ELEVENLABS_API_KEY'
export const KEY_FILE_VARIABLE = 'ELEVENLABS_API_KEY_FILE'

/** A key: one run of printable ASCII without spaces. ElevenLabs' keys are `sk_` and 48 hex digits; the bounds leave room. */
const KEY_SHAPE = /^[\x21-\x7e]{16,256}$/

/** The id of a model or a voice: it goes into a path of the API and into the cache key. */
const SETTING_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/

/** The largest answer accepted for one line (about ten minutes of 128 kbit/s mp3; a line of the script is seconds long). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** How long one call may take before it is given up. */
const TIMEOUT_MS = 120_000

/** The models that refuse the `language_code` field (the ElevenLabs docs: "not supported for multilingual_v2 models"). */
const NO_LANGUAGE_CODE = /^eleven_multilingual_/

const isSet = (value) => typeof value === 'string' && value.trim() !== ''

/** True when either key variable is set (to something that is not blank). Reads no file. */
export function keyIsSet(env = process.env) {
  return isSet(env[KEY_VARIABLE]) || isSet(env[KEY_FILE_VARIABLE])
}

/** The text of a key file: UTF-8 or the UTF-16 that Windows PowerShell writes, without a byte order mark. */
function decodeKeyFile(bytes) {
  const utf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const text = utf16 ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * The key, from ELEVENLABS_API_KEY or from the file that ELEVENLABS_API_KEY_FILE names, or null when neither is set. Throws when
 * both are set, when the file cannot be read, or when what was read is not the shape of a key; no message holds the key or any
 * part of the file.
 * @param {Record<string, string | undefined>} [env]
 * @param {(path: string) => Buffer} [readFile]
 */
export function readKey(env = process.env, readFile = (file) => fs.readFileSync(file)) {
  const direct = isSet(env[KEY_VARIABLE])
  const fromFile = isSet(env[KEY_FILE_VARIABLE])
  if (direct && fromFile) throw new Error(`Both ${KEY_VARIABLE} and ${KEY_FILE_VARIABLE} are set: set one of them.`)
  if (!direct && !fromFile) return null
  let key
  if (direct) {
    key = env[KEY_VARIABLE].trim()
  } else {
    try {
      key = decodeKeyFile(readFile(env[KEY_FILE_VARIABLE].trim())).trim()
    } catch (err) {
      throw new Error(`${KEY_FILE_VARIABLE} names a file that cannot be read (${err?.code ?? err?.name}).`, { cause: err })
    }
  }
  if (!KEY_SHAPE.test(key)) {
    throw new Error(`What ${direct ? KEY_VARIABLE : KEY_FILE_VARIABLE} holds is not an ElevenLabs key (one line of 16 to 256 printable characters, no space).`)
  }
  return key
}

/**
 * The model and the voice of this run: ELEVENLABS_MODEL and ELEVENLABS_VOICE_ID when they are set, else the defaults.
 * @param {Record<string, string | undefined>} [env]
 */
export function elevenlabsSettings(env = process.env) {
  const model = isSet(env.ELEVENLABS_MODEL) ? env.ELEVENLABS_MODEL.trim() : ELEVENLABS_DEFAULTS.model
  const voice = isSet(env.ELEVENLABS_VOICE_ID) ? env.ELEVENLABS_VOICE_ID.trim() : ELEVENLABS_DEFAULTS.voice
  for (const [name, value] of [['ELEVENLABS_MODEL', model], ['ELEVENLABS_VOICE_ID', voice]]) {
    if (!SETTING_SHAPE.test(value)) throw new Error(`${name} is not an id of ElevenLabs (letters, digits, "_", "." and "-", at most 64).`)
  }
  return { model, voice }
}

/**
 * @param {{ key: string, model?: string, voice?: string, fetch?: typeof globalThis.fetch }} options
 * @returns {import('./types.mjs').Provider}
 */
export function elevenlabsProvider({ key, model = ELEVENLABS_DEFAULTS.model, voice = ELEVENLABS_DEFAULTS.voice, fetch = globalThis.fetch }) {
  if (!KEY_SHAPE.test(String(key))) throw new Error('The ElevenLabs narrator needs a key.')
  const url = `${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${ELEVENLABS_DEFAULTS.outputFormat}`

  async function synthesize({ id, text, lang }) {
    const body = { text, model_id: model }
    if (!NO_LANGUAGE_CODE.test(model)) body.language_code = lang
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify(body),
        // A redirect would carry the key's header to wherever it points (fetch drops only `authorization` and cookies), so none
        // is followed.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new Error(`ElevenLabs could not be reached for the line "${id}" (${err?.name ?? 'Error'}).`, { cause: err })
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`ElevenLabs answered ${res.status} for the line "${id}".`)
    }
    let audio
    try {
      audio = await readCapped(res, MAX_AUDIO_BYTES)
    } catch (err) {
      throw new Error(`ElevenLabs broke off its answer for the line "${id}" (${err?.name ?? 'Error'}).`, { cause: err })
    }
    if (!audio) throw new Error(`ElevenLabs answered more than ${MAX_AUDIO_BYTES} bytes for the line "${id}".`)
    return audio
  }

  return Object.freeze({ name: 'elevenlabs', kind: 'synthesize', voice, model, label: `elevenlabs (model ${model}, voice ${voice})`, synthesize })
}
