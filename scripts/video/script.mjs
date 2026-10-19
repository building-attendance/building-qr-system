// The script of the provider tutorial video (video/script/), checked and resolved: the rules that tests/video-script.test.js holds and
// that the recorder checks again before it starts, and the scenes.json that the recorder writes beside its frames for the composer (T2)
// and the narrator (T3). Node built-ins, the app's dictionaries and the project's text rules only.
//
// A `{key}` in a line is a label of the app (a key of src/i18n/he.js and of the three other dictionaries). It is replaced with the
// label in the language of the line by translate() of src/i18n/core.js, so that a renamed button renames the caption and the narration.

import { DICTS, translate } from '../../src/i18n/core.js'
import { findDashLines } from '../text-rules.mjs'
import { LANGUAGES, SCENES, SCRIPTS } from '../../video/script/index.js'

/** Every `{...}` in a line. Whatever is between the braces is taken for a key, so `{name}` is reported as a key that does not exist. */
const REFERENCE = /\{([^{}]*)\}/g

/** A parameter in a label of the app (`{count}`): such a label is a sentence with a hole in it, never a name to quote. */
const PARAMETER = /\{\w+\}/

/**
 * A date or a time (DD/MM/YYYY, DD/MM, HH:MM, an ISO date). The video is watched for months after it is made, and a person reads a date
 * only as shared/datetime.js writes it, so a line never says one.
 */
export const DATE_OR_TIME = /\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}/

/** The ids of beats and scenes: lower-case words with hyphens, because they name files. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The keys that a line refers to, in order. */
export function referencedKeys(text) {
  return [...String(text).matchAll(REFERENCE)].map((match) => match[1])
}

/** The dictionaries that lack this key (none when every one of the four has it). */
export function dictionariesWithout(key) {
  return Object.keys(DICTS).filter((lang) => !Object.hasOwn(DICTS[lang], key))
}

/**
 * The line with every `{key}` replaced by the label of the app in `lang`. Throws, naming the key, for a key that a dictionary lacks or
 * whose label has a parameter: the script is checked first (checkScript), so the recorder never writes a caption with a hole in it.
 * @param {string} lang
 * @param {string} text
 */
export function resolveLine(lang, text) {
  if (!Object.hasOwn(DICTS, lang)) throw new Error(`"${lang}" is not a language of the app (src/i18n has ${Object.keys(DICTS).join(', ')}).`)
  return String(text).replace(REFERENCE, (_, key) => {
    const missing = dictionariesWithout(key)
    if (missing.length) throw new Error(`The video script refers to {${key}}, which is not a key of src/i18n (${missing.join(', ')}).`)
    const label = translate(lang, key)
    if (PARAMETER.test(label)) throw new Error(`The video script refers to {${key}}, whose label has a parameter: quote a label without one.`)
    return label
  })
}

/** The beats that need a line of their own (every beat but those that continue the line before them), in the order of the video. */
export function beatsWithLines(scenes = SCENES) {
  return scenes.flatMap((scene) => scene.beats.filter((beat) => !beat.continues))
}

/**
 * Every problem of the script, as sentences (none: the script is good). `scripts` and `scenes` are the script's own unless a test
 * passes others. What is checked:
 *  - the scenes and beats: ids that can name a file, used once, a positive duration for each, and beats that add up to their scene;
 *    the first beat of a scene has a line of its own;
 *  - every language: a caption and a say line, both non-empty text, for every beat that needs one, and no line for any other id;
 *  - every line: each `{key}` is a key of all four dictionaries whose label has no parameter, no long dash (scripts/text-rules.mjs),
 *    and no date or time, before and after its keys are resolved.
 * @param {Record<string, Record<string, { caption?: unknown, say?: unknown }>>} [scripts]
 * @param {readonly { id: string, seconds: number, beats: readonly { id: string, seconds: number, continues?: boolean }[] }[]} [scenes]
 */
export function checkScript(scripts = SCRIPTS, scenes = SCENES) {
  const problems = []
  const seen = new Set()
  for (const scene of scenes) {
    if (!ID.test(scene.id)) problems.push(`scene "${scene.id}": the id is not lower-case words with hyphens`)
    if (!(Number.isFinite(scene.seconds) && scene.seconds > 0)) problems.push(`scene "${scene.id}": its seconds are not a positive number`)
    if (!scene.beats.length) problems.push(`scene "${scene.id}": it has no beat`)
    if (scene.beats[0]?.continues) problems.push(`scene "${scene.id}": its first beat continues, so the scene has no line of its own`)
    let sum = 0
    for (const beat of scene.beats) {
      if (!ID.test(beat.id)) problems.push(`beat "${beat.id}": the id is not lower-case words with hyphens`)
      if (seen.has(beat.id)) problems.push(`beat "${beat.id}": the id is used twice`)
      seen.add(beat.id)
      if (!(Number.isFinite(beat.seconds) && beat.seconds > 0)) problems.push(`beat "${beat.id}": its seconds are not a positive number`)
      sum += beat.seconds
    }
    if (Math.abs(sum - scene.seconds) > 0.001) problems.push(`scene "${scene.id}": its beats run ${sum} seconds, the scene ${scene.seconds}`)
  }

  const needed = beatsWithLines(scenes).map((beat) => beat.id)
  for (const [lang, lines] of Object.entries(scripts)) {
    // translate() falls back to Hebrew for a language it does not know, so a misspelled code would quote Hebrew labels.
    if (!Object.hasOwn(DICTS, lang)) {
      problems.push(`${lang}: not a language of the app (src/i18n has ${Object.keys(DICTS).join(', ')})`)
      continue
    }
    for (const id of needed) {
      const line = lines[id]
      for (const field of ['caption', 'say']) {
        const text = line?.[field]
        if (typeof text !== 'string' || !text.trim()) {
          problems.push(`${lang} "${id}": no ${field}`)
          continue
        }
        const where = `${lang} "${id}" ${field}`
        for (const key of referencedKeys(text)) {
          const missing = dictionariesWithout(key)
          if (missing.length) problems.push(`${where}: {${key}} is not a key of src/i18n (missing in ${missing.join(', ')})`)
          else if (PARAMETER.test(translate(lang, key))) problems.push(`${where}: {${key}} has a parameter in its label`)
        }
        let resolved = text
        try {
          resolved = resolveLine(lang, text)
        } catch {
          // already reported above, key by key
        }
        for (const version of new Set([text, resolved])) {
          for (const found of findDashLines(version)) problems.push(`${where}: a long dash (${found.dashes.join(', ')})`)
          if (DATE_OR_TIME.test(version)) problems.push(`${where}: a date or a time`)
        }
      }
    }
    for (const id of Object.keys(lines)) {
      if (!needed.includes(id)) problems.push(`${lang} "${id}": a line for a beat that has none (unknown, or it continues the line before it)`)
    }
  }
  return problems
}

/** Throws with every problem of the script, or returns quietly. */
export function assertScript(scripts = SCRIPTS, scenes = SCENES) {
  const problems = checkScript(scripts, scenes)
  if (problems.length) throw new Error(`The video script (video/script/) has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
}

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box  a box on the picture, in CSS pixels from its top left corner
 * @typedef {{ image: string, masked: string, width: number, height: number, scale: number, tap: Box | null, highlight: Box | null }} Capture
 *   what the recorder saved for one beat: the picture and its copy with the dates, the times and the build label masked (file names in
 *   the language's folder), the size of the picture in CSS pixels and how many pixels of the image are one CSS pixel, the element to tap,
 *   and the element that the line points at without a tap
 */

/**
 * The content of scenes.json for one language: the scenes in order, each with its beats, and each beat with its picture (`captures`,
 * by beat id), its caption and say line resolved (null for a beat that continues the line before it) and its planned seconds. Throws
 * when the script has a problem or when a beat has no picture.
 * @param {string} lang
 * @param {Record<string, Capture>} captures
 */
export function buildScenes(lang, captures) {
  if (!LANGUAGES.includes(lang)) throw new Error(`The video script has no language "${lang}" (video/script/index.js has ${LANGUAGES.join(', ')}).`)
  assertScript()
  const lines = SCRIPTS[lang]
  const missing = SCENES.flatMap((scene) => scene.beats).filter((beat) => !captures[beat.id]).map((beat) => beat.id)
  if (missing.length) throw new Error(`The recorder saved no picture for the beat(s) ${missing.join(', ')}.`)
  return {
    lang,
    seconds: SCENES.reduce((sum, scene) => sum + scene.seconds, 0),
    scenes: SCENES.map((scene) => ({
      id: scene.id,
      seconds: scene.seconds,
      beats: scene.beats.map((beat) => ({
        id: beat.id,
        ...captures[beat.id],
        caption: beat.continues ? null : resolveLine(lang, lines[beat.id].caption),
        say: beat.continues ? null : resolveLine(lang, lines[beat.id].say),
        seconds: beat.seconds,
      })),
    })),
  }
}
