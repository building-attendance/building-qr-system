// The script of the provider tutorial video (video/script/), checked and resolved: the rules that tests/video-script.test.js holds and
// that the recorder checks again before it starts, and the scenes.json that the recorder writes beside its frames for the composer (T2)
// and the narrator (T3). Node built-ins, the app's dictionaries and the project's text rules only.
//
// A `{key}` in a line is a label of the app (a key of src/i18n/he.js and of the three other dictionaries). It is replaced with the
// label in the language of the line by translate() of src/i18n/core.js, so that a renamed button renames the caption and the narration.

import { DICTS, translate } from '../../src/i18n/core.js'
import { findDashLines } from '../text-rules.mjs'
import { LANGUAGES, SCENES, SCRIPTS, VOWELS } from '../../video/script/index.js'

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

/**
 * The languages whose narrator reads vowelled words: those that have a dictionary of vowel points (VOWELS of video/script/index.js;
 * Hebrew, because the narrator misread plain Hebrew, the owner, 19/10/2026). In these the caption and the say line are both plain and
 * carry the same words, and the narrator gets each Hebrew word of the say line with its vowel points from the dictionary (spokenLine).
 */
export const VOWELLED_LANGUAGES = Object.freeze(Object.keys(VOWELS))

/** A vowel point (niqqud) on a Hebrew letter: U+05B0 to U+05C7, without the punctuation among them. */
const NIQQUD = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/
/** Every mark that sits on a Hebrew letter: the cantillation (U+0591 to U+05AF) and the vowel points. */
const MARK = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/
/** A plain Hebrew word: Hebrew letters only, so any punctuation, the maqaf included, ends it. */
const PLAIN_HEBREW_WORD = /[\u05D0-\u05EA]+/g
const HEBREW_LETTER = /[\u05D0-\u05EA]/
const VAV = '\u05D5'
const YOD = '\u05D9'
/** The vowels that a yod of the plain spelling may stand for (hiriq, tsere), and those that a vav may stand for (holam, kubutz). */
const YOD_VOWELS = /[\u05B4\u05B5]/
const VAV_VOWELS = /[\u05B9\u05BA\u05BB]/
/** The end of a spoken sentence: a full stop, a question mark or an exclamation mark, then perhaps a closing quote. */
const SENTENCE_END = /[.?!]["'\u05F4)]*$/

/** The words of a line, in order: the letters and digits of any script, split at spaces and at every punctuation mark (a maqaf too). */
export function wordsOf(text) {
  return String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/**
 * Why a vowelled word is not its plain word, or null when it is. The vowelled word is read letter by letter with its marks, and it may
 * leave out only a vav or a yod of the plain word that doubles the letter before it (a doubled vav or yod), or that stands for the
 * vowel of the letter before it (a yod for hiriq or tsere, a vav for holam or kubutz). Nothing else may differ, so a word never becomes
 * another word, and it must carry at least one vowel point.
 */
export function vowelledWordProblem(plain, vowelled) {
  const units = []
  for (const char of String(vowelled)) {
    if (!MARK.test(char)) units.push({ letter: char, marks: '' })
    else if (units.length) units[units.length - 1].marks += char
    else return 'it starts with a mark'
  }
  if (!units.some((unit) => NIQQUD.test(unit.marks))) return 'it has no vowel point'
  const letters = [...String(plain)]
  let next = 0
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i]
    if (next < units.length && units[next].letter === letter) {
      next++
      continue
    }
    const before = units[next - 1]
    const doubled = i > 0 && letters[i - 1] === letter && (letter === VAV || letter === YOD)
    const forVowel = Boolean(before) && ((letter === YOD && YOD_VOWELS.test(before.marks)) || (letter === VAV && VAV_VOWELS.test(before.marks)))
    if (!doubled && !forVowel) return `its letters are not the word's (at letter ${i + 1})`
  }
  return next === units.length ? null : 'it has letters that the word has not'
}

/**
 * The line as the narrator reads it: its `{key}` labels resolved and, in a vowelled language, every Hebrew word with its vowel points
 * from the dictionary. Throws for a word that the dictionary lacks, so the narrator never reads a plain word (checkScript reports it
 * first). `vowels` is the script's own unless a test passes others.
 * @param {string} lang
 * @param {string} text
 * @param {Record<string, Record<string, string>>} [vowels]
 */
export function spokenLine(lang, text, vowels = VOWELS) {
  const resolved = resolveLine(lang, text)
  const dictionary = vowels[lang]
  if (!dictionary) return resolved
  return resolved.replace(PLAIN_HEBREW_WORD, (word) => {
    if (!Object.hasOwn(dictionary, word)) throw new Error(`The video script says "${word}", which video/script/${lang}-niqqud.js does not have.`)
    return dictionary[word]
  })
}

/** The entries of a vowel dictionary that no line of the script says (each is a word to delete, or a word that a line lost). */
export function unusedVowels(lang, scripts = SCRIPTS, vowels = VOWELS) {
  const said = new Set(beatsWithLines().flatMap((beat) => resolveLine(lang, scripts[lang][beat.id].say).match(PLAIN_HEBREW_WORD) ?? []))
  return Object.keys(vowels[lang] ?? {}).filter((word) => !said.has(word))
}

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
 *    and no date or time, before and after its keys are resolved;
 *  - a vowelled language (VOWELLED_LANGUAGES): no vowel point in a caption or a say line; once their labels are resolved, the say line
 *    has exactly the caption's words (its punctuation may differ) and ends a sentence; and every Hebrew word it says has an entry in
 *    the dictionary that matches the word letter by letter (vowelledWordProblem).
 * @param {Record<string, Record<string, { caption?: unknown, say?: unknown }>>} [scripts]
 * @param {readonly { id: string, seconds: number, beats: readonly { id: string, seconds: number, continues?: boolean }[] }[]} [scenes]
 * @param {Record<string, Record<string, string>>} [vowels]
 */
export function checkScript(scripts = SCRIPTS, scenes = SCENES, vowels = VOWELS) {
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
      if (Object.hasOwn(vowels, lang)) problems.push(...vowelledProblems(lang, id, line, vowels[lang]))
    }
    for (const id of Object.keys(lines)) {
      if (!needed.includes(id)) problems.push(`${lang} "${id}": a line for a beat that has none (unknown, or it continues the line before it)`)
    }
  }
  return [...new Set(problems)]
}

/** The problems of one line of a vowelled language (none when its caption or say line is missing: checkScript reports that). */
function vowelledProblems(lang, id, line, dictionary) {
  const { caption, say } = line ?? {}
  if (typeof caption !== 'string' || typeof say !== 'string') return []
  const problems = []
  const plain = `the lines are plain, the narrator's vowels come from video/script/${lang}-niqqud.js`
  if (NIQQUD.test(caption)) problems.push(`${lang} "${id}" caption: a vowel point (${plain})`)
  if (NIQQUD.test(say)) problems.push(`${lang} "${id}" say: a vowel point (${plain})`)
  if (problems.length) return problems // its words cannot be compared or looked up until the line is plain
  let spoken = say
  let shown = caption
  try {
    spoken = resolveLine(lang, say)
    shown = resolveLine(lang, caption)
  } catch {
    // a key problem, already reported line by line
  }
  // Once the labels are resolved: a line that is only a label of the app is Hebrew too, and is checked like any other.
  if (!HEBREW_LETTER.test(spoken + shown)) return problems
  const said = wordsOf(spoken).join(' ')
  const written = wordsOf(shown).join(' ')
  if (said !== written) problems.push(`${lang} "${id}" say: not the caption's words (the say line has "${said}", the caption "${written}")`)
  if (!SENTENCE_END.test(say.trim())) problems.push(`${lang} "${id}" say: it does not end a sentence (a full stop, a question mark or an exclamation mark)`)
  const words = [...new Set(spoken.match(PLAIN_HEBREW_WORD) ?? [])]
  const missing = words.filter((word) => !Object.hasOwn(dictionary, word))
  if (missing.length) problems.push(`${lang} "${id}" say: no vowels for ${missing.slice(0, 5).join(', ')} (add them to video/script/${lang}-niqqud.js)`)
  for (const word of words.filter((w) => Object.hasOwn(dictionary, w))) {
    const problem = vowelledWordProblem(word, dictionary[word])
    if (problem) problems.push(`${lang}-niqqud.js "${word}": ${problem}`)
  }
  return problems
}

/** Throws with every problem of the script, or returns quietly. */
export function assertScript(scripts = SCRIPTS, scenes = SCENES, vowels = VOWELS) {
  const problems = checkScript(scripts, scenes, vowels)
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
