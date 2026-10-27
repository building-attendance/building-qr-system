// The long promo's scenes: 28 scenes in 68 bars (2:16 at 120 bpm), the script of the topic plan "promo-long" (README, "the recommended
// script"; decisions D1 to D4 and D7). Plain data, like index.js: video/promo/timing.js plans it (planPromo with this script) and
// tests/video-promo.test.js holds its rules. The captions are in he-long.js, keyed by scene id.
//
// A scene is `{ id, bars, stage, picture, ... }` and may carry, all of them optional:
// - `then`: a second picture that replaces the first on a beat, `thenBeat` beats after the scene starts (the middle of the scene when
//   it is not given), and `later`: more pictures, each `{ picture, beat }`, in order (the languages scene swaps four home screens).
// - `zoom`: `[{ box, beat }]`, the camera moves from where it is to the rectangle `box` of the picture on screen, starting on `beat`
//   and landing one beat later. A `beat` of 0 means the scene starts already on the rectangle. A screen is shown whole for a beat at
//   most and then zoomed (decision D3), except where the screen is the proof itself.
// - `ring`: `[{ box, beat }]`, a ring that draws around the rectangle `box` of the picture on screen, on `beat`.
// - `inset`: `{ picture, beat }`, a second picture that shows small in a corner from `beat` to the end of the scene (scene 18).
// - `stage`: where the progress strip stands (STAGES).
// Beats are counted from the first beat of the scene. A `box` is a key of `boxes` in the picture's entry of L1's frames.json; BOXES
// lists the keys each picture must have, so that the recorder (L1) and the composition (L3) read one list.

/** The stages of the video, in order. The strip at the top shows the four labelled ones (he-long.js); the opening and the AI show none of them lit by themselves. */
export const STAGES = Object.freeze(['opening', 'prepare', 'scan', 'see', 'ai', 'need'])
/** The stages that the progress strip labels, in order. */
export const STRIP_STAGES = Object.freeze(['prepare', 'scan', 'see', 'need'])

/** The pictures that are not a recorded screen: drawn by the composition. */
export const LONG_DRAWN_PICTURES = Object.freeze(['camera', 'camera-checked', 'text', 'agent', 'closing'])

/**
 * The recorded screens the long promo needs (the recorder writes one PNG of each name into video/out/promo-frames/he/): the provider's
 * app on a phone, the committee's app on a phone, and the committee's app on a computer. Each name is a state of a screen, not a place:
 * the same screen zoomed in two scenes is one picture.
 */
export const PROMO_PICTURES = Object.freeze([
  // The provider's app (phone)
  'provider-list.png', // the login screen: the list of accounts, with the privacy notice under it
  'provider-password.png', // a password typed (dots)
  'provider-recorded.png', // "the check-in was recorded", with "the location was verified: 7 m from the point"
  'provider-queued.png', // no connection: saved on the phone, waiting to be sent
  'provider-sent.png', // the same visit once the connection is back: received
  'provider-far.png', // "it does not look like you are near the point"
  'provider-home.png', // today's visits
  'provider-lang-en.png', // the home screen in English, Russian and Arabic (Hebrew is provider-home.png)
  'provider-lang-ru.png',
  'provider-lang-ar.png',
  // The committee's app (phone)
  'committee-home.png', // the week at a glance: a row per provider, a dot per day, one day empty
  'committee-history.png', // the history, as it opens
  'committee-history-from-home.png', // the history filtered by a click on a row of the home screen (the 08:06 visit and the 08:24 one)
  'committee-history-refused.png', // "not received" with the reason
  'committee-points.png', // the list of points
  'committee-points-map.png', // adding a point: the map, with the pin and the circle
  'committee-print-sign.png', // the printed sign of a point, in four languages (the sheet as an image)
  'committee-access.png', // "who may scan here" in a point
  'committee-providers-password.png', // the dialog of a new provider, with a personal password
  'committee-void-dialog.png', // cancelling a visit
  'committee-audit.png', // the audit log
  'committee-admins.png', // the members of the committee and the Google button
  'committee-agent.png', // the agent screen, "read only"
  // The committee's app (computer, at scale factor 2)
  'computer-history.png', // the history with its filters open and the Excel button
])

/** The boxes (zoom and ring rectangles) that each picture must have in frames.json for the scenes below. */
export const BOXES = Object.freeze({
  'committee-home.png': Object.freeze(['empty-day', 'provider-row']),
  'provider-list.png': Object.freeze(['list-top', 'name-row', 'privacy']),
  'committee-points-map.png': Object.freeze(['pin', 'circle']),
  'committee-providers-password.png': Object.freeze(['password']),
  'provider-recorded.png': Object.freeze(['verified-line']),
  'committee-history-from-home.png': Object.freeze(['row-0806', 'row-0824']),
  'committee-history-refused.png': Object.freeze(['refused-row']),
  'computer-history.png': Object.freeze(['filters', 'excel']),
  'committee-audit.png': Object.freeze(['audit-row']),
  'committee-admins.png': Object.freeze(['google-button']),
  'provider-home.png': Object.freeze(['tutorial-link']),
})

/** @typedef {{ box: string, beat: number }} Move */
/** @typedef {{ id: string, bars: number, stage: string, picture: string, then?: string, thenBeat?: number, later?: { picture: string, beat: number }[], zoom?: Move[], ring?: Move[], inset?: { picture: string, beat: number } }} LongScene */

/** @type {readonly LongScene[]} */
export const LONG_SCENES = Object.freeze(
  [
    // The opening: money and a provider, the answer within 16 seconds (bars 1 to 8)
    { id: 'pays', bars: 2, stage: 'opening', picture: 'committee-home.png', ring: [{ box: 'empty-day', beat: 0 }] },
    // The groove of the track enters on bar 5, with the check mark of the scan.
    { id: 'sign', bars: 3, stage: 'opening', picture: 'camera', then: 'camera-checked', thenBeat: 8 },
    { id: 'sees', bars: 3, stage: 'opening', picture: 'committee-history.png' },
    // The committee prepares (bars 9 to 17)
    { id: 'points', bars: 2, stage: 'prepare', picture: 'committee-points.png' },
    { id: 'map', bars: 3, stage: 'prepare', picture: 'committee-points-map.png', then: 'committee-print-sign.png', zoom: [{ box: 'pin', beat: 0 }], ring: [{ box: 'circle', beat: 2 }] },
    { id: 'access', bars: 2, stage: 'prepare', picture: 'committee-access.png' },
    { id: 'provider', bars: 2, stage: 'prepare', picture: 'committee-providers-password.png', zoom: [{ box: 'password', beat: 0 }] },
    // The providers scan (bars 18 to 37)
    {
      id: 'signin',
      bars: 2,
      stage: 'scan',
      picture: 'provider-list.png',
      then: 'provider-password.png',
      zoom: [{ box: 'list-top', beat: 0 }],
      ring: [{ box: 'name-row', beat: 2 }],
    },
    { id: 'notice', bars: 2, stage: 'scan', picture: 'provider-list.png', zoom: [{ box: 'privacy', beat: 0 }] },
    { id: 'recorded', bars: 3, stage: 'scan', picture: 'provider-recorded.png', zoom: [{ box: 'verified-line', beat: 1 }] },
    // The track's quiet break (bars 25 and 26) is the lost connection; the groove is back on bar 27, when the visit is sent.
    { id: 'offline', bars: 4, stage: 'scan', picture: 'provider-queued.png', then: 'provider-sent.png', thenBeat: 8 },
    { id: 'far', bars: 3, stage: 'scan', picture: 'provider-far.png' },
    { id: 'today', bars: 2, stage: 'scan', picture: 'provider-home.png' },
    {
      id: 'languages',
      bars: 2,
      stage: 'scan',
      picture: 'provider-home.png',
      then: 'provider-lang-en.png',
      thenBeat: 2,
      later: [
        { picture: 'provider-lang-ru.png', beat: 4 },
        { picture: 'provider-lang-ar.png', beat: 6 },
      ],
    },
    { id: 'tutorial', bars: 2, stage: 'scan', picture: 'provider-home.png', zoom: [{ box: 'tutorial-link', beat: 0 }] },
    // The committee sees (bars 38 to 57)
    { id: 'week', bars: 2, stage: 'see', picture: 'committee-home.png' },
    { id: 'counts', bars: 3, stage: 'see', picture: 'committee-home.png', zoom: [{ box: 'provider-row', beat: 0 }], ring: [{ box: 'empty-day', beat: 2 }] },
    {
      id: 'visit',
      bars: 2,
      stage: 'see',
      picture: 'committee-history-from-home.png',
      ring: [{ box: 'row-0806', beat: 0 }],
      inset: { picture: 'provider-recorded.png', beat: 2 },
    },
    { id: 'late', bars: 2, stage: 'see', picture: 'committee-history-from-home.png', zoom: [{ box: 'row-0824', beat: 0 }] },
    { id: 'refused', bars: 2, stage: 'see', picture: 'committee-history-refused.png', ring: [{ box: 'refused-row', beat: 0 }] },
    {
      id: 'filters',
      bars: 3,
      stage: 'see',
      picture: 'computer-history.png',
      zoom: [
        { box: 'filters', beat: 1 },
        { box: 'excel', beat: 5 },
      ],
    },
    { id: 'cancel', bars: 2, stage: 'see', picture: 'committee-void-dialog.png' },
    { id: 'audit', bars: 2, stage: 'see', picture: 'committee-audit.png', zoom: [{ box: 'audit-row', beat: 0 }] },
    { id: 'admins', bars: 2, stage: 'see', picture: 'committee-admins.png', ring: [{ box: 'google-button', beat: 0 }] },
    // The committee's AI (bars 58 to 61): "read only" once, the drawn chat (decision D8), then back to the home row that proves the answer.
    {
      id: 'agent',
      bars: 4,
      stage: 'ai',
      picture: 'committee-agent.png',
      then: 'agent',
      thenBeat: 6,
      later: [{ picture: 'committee-home.png', beat: 12 }],
      zoom: [{ box: 'provider-row', beat: 12 }],
    },
    // What it takes, and the closing card (bars 62 to 68)
    { id: 'open', bars: 2, stage: 'need', picture: 'text' },
    { id: 'install', bars: 2, stage: 'need', picture: 'text' },
    { id: 'closing', bars: 3, stage: 'need', picture: 'closing' },
  ].map((scene) => Object.freeze(scene)),
)
