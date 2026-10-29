// The long promo's scenes: 22 scenes in 58 bars (1:56 at 120 bpm), the edit of the topic plan "promo-web-flow" (decision E3, and E7,
// which brings the privacy notice back): the morning of one cleaner, with a whip only where the app or the place changes, behind a title
// card (topic "promo-long", decisions D1 to D4 and D7, for the rest). Plain data, like index.js: video/promo/timing.js plans it (planPromo with this
// script) and tests/video-promo.test.js holds its rules. The captions are in he-long.js, keyed by scene id.
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
// - `continues: true`: the scene follows the one before it on the same device without a whip (topic "promo-web-flow", decision E2):
//   neither scene slides or blurs, the camera starts where the scene before ended and glides to this scene's first move over one beat
//   (a move on beat 0 glides from the scene's first frame), the old caption fades out over its last 8 frames and the new one comes in on
//   the bar line. The scene before must end on a recorded screen of the same app on the same device as this one starts on (timing.js,
//   planPromo refuses it otherwise, and on the first scene), zoomed and not under a picture drawn over the whole frame (parts/screens.js).
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
  'provider-list.png', // the login screen: the list of accounts, with the button of the privacy notice above it
  'provider-privacy-sheet.png', // the same list with the short privacy notice open in its sheet, and the link to the whole notice
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

/**
 * The boxes that a picture drawn over the whole frame needs (no zoom or ring uses them): the printed sign is cut to its `sign` box, and
 * its `qr` box is where the demo code covers the sample point's code (parts/drawn.jsx). They are in BOXES, so that frames.json is
 * checked for them before the render starts.
 */
export const SHEET_BOXES = Object.freeze({ 'committee-print-sign.png': Object.freeze(['sign', 'qr']) })

/** The boxes (zoom and ring rectangles, and the boxes of SHEET_BOXES) that each picture must have in frames.json for the scenes below. */
export const BOXES = Object.freeze({
  'committee-home.png': Object.freeze(['empty-day', 'provider-row', 'week']),
  'provider-list.png': Object.freeze(['list-top', 'name-row', 'privacy']),
  'provider-privacy-sheet.png': Object.freeze(['sheet', 'full-notice']),
  'provider-password.png': Object.freeze(['password']), // the ring of the sign-in on the password field, beside the "stay signed in" tick that has no box of its own
  'committee-points-map.png': Object.freeze(['pin', 'circle']),
  'committee-providers-password.png': Object.freeze(['password']),
  'provider-recorded.png': Object.freeze(['verified-line']),
  'committee-history-from-home.png': Object.freeze(['row-0806', 'row-0824', 'offline-badge']),
  'committee-history-refused.png': Object.freeze(['refused-row']),
  'computer-history.png': Object.freeze(['filters', 'excel']),
  'committee-audit.png': Object.freeze(['audit-row']),
  'committee-admins.png': Object.freeze(['google-button']),
  'provider-home.png': Object.freeze(['tutorial-link', 'visits']),
  'committee-history.png': Object.freeze(['first-row']),
  'committee-points.png': Object.freeze(['point-row']),
  'committee-access.png': Object.freeze(['access-list']),
  'provider-queued.png': Object.freeze(['status']),
  'provider-sent.png': Object.freeze(['status', 'visit']),
  'provider-far.png': Object.freeze(['message', 'retry']),
  'provider-lang-en.png': Object.freeze(['hello']),
  'provider-lang-ru.png': Object.freeze(['hello']),
  'provider-lang-ar.png': Object.freeze(['hello']),
  'committee-void-dialog.png': Object.freeze(['reason']),
  'committee-agent.png': Object.freeze(['read-only']),
  ...SHEET_BOXES,
})

/**
 * The zooms that do not take the rectangle of frames.json but span several boxes of the picture side by side: on the computer the
 * filters (the dates, the point and the provider) run across the page to the Excel button at its other end, so the zoom on `filters`
 * spans both, and the caption's "date, point and provider" are all in view (parts/moves.js, spanRect).
 */
export const WIDE_ZOOMS = Object.freeze({
  'computer-history.png': Object.freeze({ filters: Object.freeze(['filters', 'excel']) }),
})

/**
 * The magnifier of the computer's scene (parts/magnifier.jsx, parts/laptop.jsx): a move of the scene lifts the `box` of its zoom out of
 * the laptop's screen, and `LENSES` says, by scene id and then by the order of its moves, what a move lifts when it is not its box: a
 * rectangle of the picture in its own pixels, or null for the box. The recorder's `filters` box holds the dates and the type, which are
 * the right-hand part of the filters (scripts/promo/capture.spec.mjs); the point and the provider are at its left with no box of their
 * own, so the first three moves of `filters` lift each by a rectangle (measured on the recording of 28/10/2026, each with its labels
 * and the next field's edge left out) until the recorder boxes them: the dates (the box with a narrower margin, so that its words come out
 * at 28 pixels or more), then the point, then the provider at its left. The point and the provider are two lenses and not one, because
 * both together are too wide to be lifted at the size that their words need.
 */
export const LENSES = Object.freeze({
  filters: Object.freeze([Object.freeze({ x: 1074, y: 264, width: 762, height: 416 }), Object.freeze({ x: 530, y: 268, width: 450, height: 208 }), Object.freeze({ x: 84, y: 268, width: 440, height: 208 }), null]),
})

/**
 * What the recorder still takes and no scene of this edit shows (the recorder's contract, PROMO_PICTURES and BOXES, is kept whole until
 * scripts/promo changes with it): the first history, which "sees" no longer opens on (the short cut shows it, index.js), and the members
 * of the committee, whom the edit leaves out. Each picture with its boxes, and the boxes that the edit leaves out of pictures that it
 * still shows.
 */
export const SPARE = Object.freeze({
  pictures: Object.freeze(['committee-history.png', 'committee-admins.png']),
  boxes: Object.freeze({
    'committee-history.png': Object.freeze(['first-row']),
    'committee-admins.png': Object.freeze(['google-button']),
    'provider-home.png': Object.freeze(['tutorial-link']),
  }),
})

/** @typedef {{ box: string, beat: number }} Move */
/** @typedef {{ id: string, bars: number, stage: string, picture: string, then?: string, thenBeat?: number, later?: { picture: string, beat: number }[], zoom?: Move[], ring?: Move[], inset?: { picture: string, beat: number }, continues?: boolean }} LongScene */

/** @type {readonly LongScene[]} */
export const LONG_SCENES = Object.freeze(
  [
    // The title card (bars 1 and 2): the short cut's opening question alone on the violet ground, without the strip, so that frame 0,
    // the poster and the thumbnail that a platform takes from frame 0 are the same clean card as the short cut's poster (the owner,
    // 27/10/2026). Two bars, because one would not give its caption its reading time. The track starts a bar earlier under it (the
    // render's `--start`), and the camera of the sign has one bar instead of two, so that every scene from the check mark on keeps the
    // bar of the music it had.
    { id: 'question', bars: 2, stage: 'opening', picture: 'text' },
    // The opening: money and a provider, the answer within 18 seconds (bars 3 to 9). The home screen has no ring on the empty day here:
    // the payoff waits for the week scene and for the end of the AI scene (topic "promo-web-flow", P3).
    { id: 'pays', bars: 2, stage: 'opening', picture: 'committee-home.png', zoom: [{ box: 'provider-row', beat: 0 }] },
    // The groove of the track enters on bar 6, with the check mark of the scan.
    { id: 'sign', bars: 2, stage: 'opening', picture: 'camera', then: 'camera-checked', thenBeat: 4 },
    // The committee sees the scan that the viewer has just seen: the 08:06 visit at the lobby (P3).
    { id: 'sees', bars: 3, stage: 'opening', picture: 'committee-history-from-home.png', zoom: [{ box: 'row-0806', beat: 1 }] },
    // The committee prepares (bars 10 to 15): the points list for a beat, the pin of the map, the printed sign; then who may scan, and the
    // dialog of a provider with the ring on the password.
    {
      id: 'points',
      bars: 3,
      stage: 'prepare',
      picture: 'committee-points.png',
      then: 'committee-points-map.png',
      thenBeat: 3,
      later: [{ picture: 'committee-print-sign.png', beat: 7 }],
      zoom: [
        { box: 'point-row', beat: 1 },
        { box: 'pin', beat: 3 },
      ],
      ring: [{ box: 'circle', beat: 5 }],
    },
    {
      id: 'access',
      bars: 3,
      stage: 'prepare',
      picture: 'committee-access.png',
      then: 'committee-providers-password.png',
      thenBeat: 3,
      zoom: [
        { box: 'access-list', beat: 1 },
        { box: 'password', beat: 3 },
      ],
      ring: [{ box: 'password', beat: 5 }],
    },
    // The providers scan (bars 16 to 32): the morning of one cleaner. She reads the privacy notice above the list (topic "promo-web-flow",
    // E7), signs in, is too far, is recorded at 7 metres, loses the connection in the basement, and sees her day in four languages. The
    // notice and the sign-in are one screen in two scenes: the sign-in continues on the list, without a whip, as the sheet closes. The
    // notice's two bars are taken from the sign-in and the recorded screen (two and three bars, as before #368), so that the quiet break
    // of the track stays on the offline scene (bar 26).
    {
      id: 'notice',
      bars: 2,
      stage: 'scan',
      picture: 'provider-list.png',
      then: 'provider-privacy-sheet.png',
      thenBeat: 3,
      zoom: [
        { box: 'privacy', beat: 0 },
        { box: 'sheet', beat: 3 },
      ],
      ring: [
        { box: 'privacy', beat: 1 },
        { box: 'full-notice', beat: 5 },
      ],
    },
    {
      id: 'signin',
      bars: 2,
      stage: 'scan',
      picture: 'provider-list.png',
      continues: true,
      then: 'provider-password.png',
      thenBeat: 4,
      zoom: [{ box: 'list-top', beat: 0 }],
      ring: [
        { box: 'name-row', beat: 2 },
        { box: 'password', beat: 5 },
      ],
    },
    {
      id: 'far',
      bars: 3,
      stage: 'scan',
      picture: 'provider-far.png',
      zoom: [
        { box: 'message', beat: 1 },
        { box: 'retry', beat: 6 },
      ],
    },
    // The ding is the first beat of this screen.
    { id: 'recorded', bars: 3, stage: 'scan', picture: 'provider-recorded.png', zoom: [{ box: 'verified-line', beat: 1 }], ring: [{ box: 'verified-line', beat: 2 }] },
    // The track's quiet break (bars 26 and 27) is the lost connection; the groove is back on bar 28, when the visit is sent.
    // The sent screen and the home and language screens below show the app's version at their bottom: they are never shown whole.
    {
      id: 'offline',
      bars: 4,
      stage: 'scan',
      picture: 'provider-queued.png',
      then: 'provider-sent.png',
      thenBeat: 8,
      zoom: [
        { box: 'status', beat: 1 },
        { box: 'status', beat: 8 },
        { box: 'visit', beat: 11 },
      ],
    },
    {
      id: 'today',
      bars: 3,
      stage: 'scan',
      picture: 'provider-home.png',
      then: 'provider-lang-en.png',
      thenBeat: 4,
      later: [
        { picture: 'provider-lang-ru.png', beat: 6 },
        { picture: 'provider-lang-ar.png', beat: 8 },
      ],
      // Her visits of today, then the greeting and the instructions of each language, in the same place.
      zoom: [
        { box: 'visits', beat: 0 },
        { box: 'hello', beat: 4 },
        { box: 'hello', beat: 6 },
        { box: 'hello', beat: 8 },
      ],
    },
    // The committee sees (bars 33 to 47): the week chart for a beat, then the rows, with the empty day ringed.
    {
      id: 'counts',
      bars: 3,
      stage: 'see',
      picture: 'committee-home.png',
      zoom: [
        { box: 'week', beat: 0 },
        { box: 'provider-row', beat: 2 },
      ],
      ring: [{ box: 'empty-day', beat: 3 }],
    },
    // The visit and the basement visit are one screen in two scenes: the second continues the first, without a whip.
    {
      id: 'visit',
      bars: 2,
      stage: 'see',
      picture: 'committee-history-from-home.png',
      zoom: [{ box: 'row-0806', beat: 0 }],
      ring: [{ box: 'row-0806', beat: 0 }],
      inset: { picture: 'provider-recorded.png', beat: 2 },
    },
    { id: 'late', bars: 2, stage: 'see', picture: 'committee-history-from-home.png', continues: true, zoom: [{ box: 'row-0824', beat: 0 }], ring: [{ box: 'offline-badge', beat: 1 }] },
    {
      id: 'refused',
      bars: 2,
      stage: 'see',
      picture: 'committee-history-refused.png',
      zoom: [{ box: 'refused-row', beat: 0 }],
      ring: [{ box: 'refused-row', beat: 0 }],
    },
    // The computer: a laptop that stays where it is, and a magnifier (parts/magnifier.jsx) that lifts the dates out of its screen, then
    // the point, then the provider (LENSES), then the Excel button: each is up for two beats, and the next one lifts as it lowers.
    {
      id: 'filters',
      bars: 3,
      stage: 'see',
      picture: 'computer-history.png',
      zoom: [
        { box: 'filters', beat: 0 },
        { box: 'filters', beat: 3 },
        { box: 'filters', beat: 6 },
        { box: 'excel', beat: 9 },
      ],
      ring: [{ box: 'excel', beat: 10 }],
    },
    // The cancel dialog for a beat or two, then the audit log with the row of what was just done.
    {
      id: 'cancel',
      bars: 3,
      stage: 'see',
      picture: 'committee-void-dialog.png',
      then: 'committee-audit.png',
      thenBeat: 4,
      zoom: [
        { box: 'reason', beat: 1 },
        { box: 'audit-row', beat: 4 },
      ],
    },
    // The committee's AI (bars 48 to 51): "read only" for a beat, the drawn chat (decision D8) long enough to read its answer, then back
    // to the home row that proves it, with its empty day.
    {
      id: 'agent',
      bars: 4,
      stage: 'ai',
      picture: 'committee-agent.png',
      then: 'agent',
      thenBeat: 4,
      later: [{ picture: 'committee-home.png', beat: 13 }],
      zoom: [
        { box: 'read-only', beat: 1 },
        { box: 'provider-row', beat: 13 },
      ],
      ring: [
        { box: 'read-only', beat: 2 },
        { box: 'empty-day', beat: 14 },
      ],
    },
    // What it takes, and the closing card (bars 52 to 58)
    { id: 'open', bars: 2, stage: 'need', picture: 'text' },
    { id: 'install', bars: 2, stage: 'need', picture: 'text' },
    { id: 'closing', bars: 3, stage: 'need', picture: 'closing' },
  ].map((scene) => Object.freeze(scene)),
)
