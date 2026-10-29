// The script of the promo video: its scenes, how many bars each one runs, what each one shows, and the caption of each scene in every
// language of the video. Plain data (no Remotion, no React): video/promo/timing.js turns it into frames and tests/video-promo.test.js
// holds the rules. The message of each scene is checked against the code or the docs (the topic plan's table); what the video leaves out
// on purpose: that the app verifies presence (the GPS is soft), "free" without a condition (Vercel Hobby is for non-commercial use), and
// the committee's AI agent (an optional scene, off by default).
//
// - A scene is measured in bars of four beats, so that every cut falls on a beat of the music.
// - `picture` is what the scene shows first: a recorded screen (a name of PROMO_PICTURES in long.js, which the recorder writes into
//   video/out/promo-frames/he/), 'camera' (the drawn sign and camera scene), 'text' (words on the violet ground) or 'closing' (the card
//   with the repository's address and its QR code). `then` is an optional second screen that replaces the first at the middle of the
//   scene (timing.js plans that cut, on a beat).
//
// The long promo (topic "promo-long") is a second script beside this one, LONG at the end of the file: its scenes are in long.js and its
// captions in he-long.js. The short script above it keeps its scenes, bars, captions and keywords (decision D7); since decision E8 of
// the topic "promo-web-flow" its four screens are the recorder's pictures of the same moments, the app of today in the long cut's
// building, and no longer the README's (docs/screenshots/). planPromo takes a script, and SHORT is its default.
import he, { keywords as heKeywords } from './he.js'
import heLong, { keywords as heLongKeywords } from './he-long.js'
import { LONG_DRAWN_PICTURES, LONG_SCENES } from './long.js'

/** The captions of each language, keyed by scene id. A new language is a file next to he.js and a line here. */
export const SCRIPTS = Object.freeze({ he: Object.freeze(he) })

/**
 * The keyword of each caption, keyed like SCRIPTS: one or two consecutive words of the caption, as plain text (decision D16, W1). It is
 * drawn in KEYWORD_COLOR, which must pass AA (4.5:1) on both backgrounds a caption sits on: the lightest point of the violet ground of
 * the text scenes (with the brightest pulse of the ground over it, see PULSE in timing.js) and the dark caption bar (the test holds it).
 */
export const KEYWORDS = Object.freeze({ he: Object.freeze(heKeywords) })
export const KEYWORD_COLOR = '#ffec8a'

/** The languages of the video, the first one being the language that the video is made in first. */
export const LANGUAGES = Object.freeze(Object.keys(SCRIPTS))

/** The public address that the closing card shows and encodes (a repository, never the live app of a building). */
export const REPOSITORY_URL = 'https://github.com/building-attendance/building-qr-system'

/** The pictures that are not a file of the recorder (video/out/promo-frames/he/, for both cuts): drawn by the composition. */
export const DRAWN_PICTURES = Object.freeze([...new Set(['camera', 'text', 'closing', ...LONG_DRAWN_PICTURES])])

/** @typedef {{ id: string, bars: number, picture: string, then?: string }} Scene */

/** @type {readonly Scene[]} */
export const SCENES = Object.freeze(
  [
    { id: 'question', bars: 2, picture: 'text' },
    { id: 'providers', bars: 2, picture: 'text' },
    { id: 'scan', bars: 3, picture: 'camera', then: 'provider-recorded.png' },
    { id: 'offline', bars: 2, picture: 'provider-queued.png' },
    { id: 'committee', bars: 3, picture: 'committee-home.png', then: 'committee-history.png' },
    { id: 'open', bars: 2, picture: 'text' },
    { id: 'closing', bars: 3, picture: 'closing' },
  ].map((scene) => Object.freeze(scene)),
)

export { BOXES, PROMO_PICTURES, SHEET_BOXES, STAGES, STRIP_STAGES, WIDE_ZOOMS } from './long.js'
export { agentChat, labels as LONG_LABELS } from './he-long.js'

/**
 * A script is what planPromo plans: the scenes, the captions and the keywords of each language, and the sounds that are not the whoosh
 * of a cut. A sound is `{ kind, scene, at }`: `at` is `start` (the first beat of the scene) or `then` (the beat where its second picture
 * comes in). timing.js plays the sounds of a scene after its whoosh, in this order.
 * @typedef {{ name: string, scenes: readonly object[], scripts: Record<string, Record<string, string>>, keywords: Record<string, Record<string, string>>, sounds: readonly { kind: string, scene: string, at: 'start' | 'then' }[] }} PromoScript
 */

/** The short promo (34 s): the approved video of 27/10/2026, whose plan does not change (its screens are the recording's since E8). The impact is the first beat of the groove, the ding the check-in screen. */
export const SHORT = Object.freeze({
  name: 'short',
  scenes: SCENES,
  scripts: SCRIPTS,
  keywords: KEYWORDS,
  sounds: Object.freeze([
    Object.freeze({ kind: 'impact', scene: 'scan', at: 'start' }),
    Object.freeze({ kind: 'ding', scene: 'scan', at: 'then' }),
  ]),
})

/**
 * The long promo (1:56, 58 bars at 120 bpm), opening on a title card of two bars. The groove of the track enters on bar 6, where the
 * check mark of the scan comes in (the impact); the ding is the first beat of the "recorded" screen; the track's quiet break (bars 26
 * and 27) is the offline scene.
 */
export const LONG = Object.freeze({
  name: 'long',
  scenes: LONG_SCENES,
  scripts: Object.freeze({ he: Object.freeze(heLong) }),
  keywords: Object.freeze({ he: Object.freeze(heLongKeywords) }),
  sounds: Object.freeze([
    Object.freeze({ kind: 'impact', scene: 'sign', at: 'then' }),
    Object.freeze({ kind: 'ding', scene: 'recorded', at: 'start' }),
  ]),
})
