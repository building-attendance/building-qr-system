// The script of the promo video: its scenes, how many bars each one runs, what each one shows, and the caption of each scene in every
// language of the video. Plain data (no Remotion, no React): video/promo/timing.js turns it into frames and tests/video-promo.test.js
// holds the rules. The message of each scene is checked against the code or the docs (the topic plan's table); what the video leaves out
// on purpose: that the app verifies presence (the GPS is soft), "free" without a condition (Vercel Hobby is for non-commercial use), and
// the committee's AI agent (an optional scene, off by default).
//
// - A scene is measured in bars of four beats, so that every cut falls on a beat of the music.
// - `picture` is what the scene shows first: a file name of docs/screenshots/, 'camera' (the drawn sign and camera scene), 'text'
//   (words on the violet ground) or 'closing' (the card with the repository's address and its QR code). `then` is an optional second
//   screenshot that replaces the first at the middle of the scene (timing.js plans that cut, on a beat).
import he from './he.js'

/** The captions of each language, keyed by scene id. A new language is a file next to he.js and a line here. */
export const SCRIPTS = Object.freeze({ he: Object.freeze(he) })

/** The languages of the video, the first one being the language that the video is made in first. */
export const LANGUAGES = Object.freeze(Object.keys(SCRIPTS))

/** The public address that the closing card shows and encodes (a repository, never the live app of a building). */
export const REPOSITORY_URL = 'https://github.com/building-attendance/building-qr-system'

/** The pictures that are not a file of docs/screenshots/. */
export const DRAWN_PICTURES = Object.freeze(['camera', 'text', 'closing'])

/** @typedef {{ id: string, bars: number, picture: string, then?: string }} Scene */

/** @type {readonly Scene[]} */
export const SCENES = Object.freeze(
  [
    { id: 'question', bars: 2, picture: 'text' },
    { id: 'providers', bars: 2, picture: 'text' },
    { id: 'scan', bars: 3, picture: 'camera', then: 'provider-phone-check-in.png' },
    { id: 'offline', bars: 2, picture: 'provider-phone-saved-offline.png' },
    { id: 'committee', bars: 3, picture: 'committee-phone-home.png', then: 'committee-phone-history.png' },
    { id: 'open', bars: 2, picture: 'text' },
    { id: 'closing', bars: 3, picture: 'closing' },
  ].map((scene) => Object.freeze(scene)),
)
