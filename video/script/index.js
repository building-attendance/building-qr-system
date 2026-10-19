// The script of the provider tutorial video: its scenes, the beats of each scene, and the narration of each beat in every language
// of the video. Plain data: scripts/video/script.mjs checks it and resolves its `{key}` labels, scripts/video/record.spec.mjs takes
// one picture of the app per beat, and tests/video-script.test.js holds the rules below.
//
// - A scene is one thing that a service provider has to understand (the topic plan's table of 11 scenes, in its order). `seconds` is
//   how long it is planned to run; the seconds of its beats add up to it.
// - A beat is one picture of the app: the recorder saves it as `<id>.png` (and the box of the element to tap, when there is one).
//   Every beat has a line (caption and say) in every language, except a beat that `continues`: it changes the picture while the line
//   of the beat before it is still being said (the screens of the other languages, the notice that the visits were sent).
// - The ids are lower-case words with hyphens: they name the files, and the lines of each language are keyed by them.
import he from './he.js'

/** The narration of each language, keyed by beat id. A new language is a file next to he.js and a line here. */
export const SCRIPTS = Object.freeze({ he })

/** The languages of the video, the first one being the language that the video is made in first. */
export const LANGUAGES = Object.freeze(Object.keys(SCRIPTS))

/** @typedef {{ id: string, seconds: number, continues?: boolean }} Beat */
/** @typedef {{ id: string, seconds: number, beats: readonly Beat[] }} Scene */

/** @type {readonly Scene[]} */
export const SCENES = Object.freeze([
  { id: 'intro', seconds: 4, beats: [{ id: 'intro', seconds: 4 }] },
  { id: 'sign', seconds: 12, beats: [{ id: 'sign', seconds: 12 }] },
  { id: 'list', seconds: 7, beats: [{ id: 'list', seconds: 7 }] },
  { id: 'password', seconds: 12, beats: [{ id: 'password', seconds: 5 }, { id: 'submit', seconds: 7 }] },
  { id: 'locating', seconds: 12, beats: [{ id: 'locating', seconds: 12 }] },
  { id: 'recorded', seconds: 8, beats: [{ id: 'recorded', seconds: 8 }] },
  { id: 'home', seconds: 7, beats: [{ id: 'home', seconds: 7 }] },
  { id: 'far', seconds: 8, beats: [{ id: 'far', seconds: 8 }] },
  {
    id: 'offline',
    seconds: 14,
    beats: [{ id: 'queued', seconds: 6 }, { id: 'pending', seconds: 5 }, { id: 'sent', seconds: 3, continues: true }],
  },
  {
    id: 'language',
    seconds: 6,
    beats: [
      { id: 'language', seconds: 2.25 },
      { id: 'language-en', seconds: 1.25, continues: true },
      { id: 'language-ru', seconds: 1.25, continues: true },
      { id: 'language-ar', seconds: 1.25, continues: true },
    ],
  },
  { id: 'outro', seconds: 4, beats: [{ id: 'outro', seconds: 4 }] },
])
