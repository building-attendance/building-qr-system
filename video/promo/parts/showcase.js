// The plan of `PromoParts`, the composition that shows each new part of the long cut on the recorder's real pictures, for its stills
// (parts/stills.mjs): a script of six short scenes, planned by timing.js like the two cuts (planPromo), so a zoom, a ring and the picture in
// picture take their frames from a plan. The captions are the long cut's own (he-long.js). Plain data and functions: no Remotion here, so
// that the stills script and the unit run can read it. It is never rendered by render.mjs.
import { LONG, STAGES } from '../script/index.js'
import { DEFAULT_TEMPO, beatFrames, planPromo } from '../timing.js'

/**
 * The scenes, each in the shape of long.js (`zoom`, `ring`, `inset`, `stage`), with `caption`, the long scene whose caption it shows, and
 * two of its own: `tag` puts the illustration tag on its picture, `stages` walks the strip through every stage, two beats each.
 */
export const SHOWCASE_SCENES = Object.freeze(
  [
    // Frame 0: the first frame shows the caption whole (the thumbnail), and a ring that starts with the scene.
    { id: 'first-frame', bars: 2, stage: 'opening', caption: 'pays', picture: 'committee-home.png', ring: [{ box: 'empty-day', beat: 0 }] },
    // A zoom from the whole screen to a rectangle, on beat 1, and a ring that follows it.
    { id: 'zoom', bars: 3, stage: 'see', caption: 'visit', picture: 'committee-history-from-home.png', zoom: [{ box: 'row-0806', beat: 1 }], ring: [{ box: 'row-0806', beat: 3 }] },
    // A scene that starts zoomed, then moves from that rectangle to the next.
    {
      id: 'zoom-twice',
      bars: 3,
      stage: 'see',
      caption: 'counts',
      picture: 'committee-home.png',
      zoom: [
        { box: 'provider-row', beat: 0 },
        { box: 'empty-day', beat: 4 },
      ],
      ring: [{ box: 'empty-day', beat: 6 }],
    },
    // The picture in picture of scene `visit`.
    { id: 'inset', bars: 2, stage: 'see', caption: 'visit', picture: 'committee-history-from-home.png', ring: [{ box: 'row-0806', beat: 0 }], inset: { picture: 'provider-recorded.png', beat: 2 } },
    // The tag in a corner of the picture.
    { id: 'tag', bars: 2, stage: 'ai', caption: 'agent', picture: 'committee-agent.png', tag: true },
    // The strip on each stage of the video in turn.
    { id: 'strip', bars: 3, stage: 'opening', caption: 'open', picture: 'text', stages: true },
  ].map((scene) => Object.freeze(scene)),
)

/** The showcase as a script that planPromo takes: the captions and keywords of the long scenes it borrows, and no sounds. */
export const SHOWCASE = Object.freeze({
  name: 'parts',
  scenes: SHOWCASE_SCENES,
  scripts: Object.freeze({ he: Object.freeze(Object.fromEntries(SHOWCASE_SCENES.map((scene) => [scene.id, LONG.scripts.he[scene.caption]]))) }),
  keywords: Object.freeze({ he: Object.freeze(Object.fromEntries(SHOWCASE_SCENES.map((scene) => [scene.id, LONG.keywords.he[scene.caption]]))) }),
  sounds: Object.freeze([]),
})

export const planShowcase = (tempo = DEFAULT_TEMPO) => planPromo('he', tempo, SHOWCASE)

/** The stage that the strip shows at a frame of a scene that walks through them (`stages`): each stage for two beats, the last one held. */
export function walkingStage(scene, frame, tempo = DEFAULT_TEMPO) {
  const beat = Math.floor((frame - scene.startFrame) / beatFrames(tempo))
  return STAGES[Math.min(STAGES.length - 1, Math.max(0, Math.floor(beat / 2)))]
}

/**
 * The stills of the showcase, `[name, frame]`, in the order of the scenes: each part before it moves, while it moves, and settled.
 * @param {ReturnType<typeof planShowcase>} plan
 * @param {{ bpm: number, firstBeat: number }} [tempo]
 */
export function showcaseStills(plan, tempo = DEFAULT_TEMPO) {
  const scene = (id) => plan.scenes.find((one) => one.id === id)
  const at = (id, beats) => scene(id).startFrame + Math.round(beats * beatFrames(tempo))
  const settled = (id) => scene(id).endFrame - 9 // the last frame before the whip takes it out
  return [
    ['01-first-frame-0', 0],
    ['02-first-frame-ring-drawing', at('first-frame', 0.25)],
    ['03-first-frame-settled', settled('first-frame')],
    ['04-zoom-whole-screen', at('zoom', 1)],
    ['05-zoom-moving', at('zoom', 1.5)],
    ['06-zoom-landed', at('zoom', 2)],
    ['07-zoom-ring', settled('zoom')],
    ['08-zoom-twice-starts-zoomed', at('zoom-twice', 0.5)],
    ['09-zoom-twice-moving', at('zoom-twice', 4.5)],
    ['10-zoom-twice-ring', settled('zoom-twice')],
    ['11-inset-before', at('inset', 1.5)],
    ['12-inset-springing', at('inset', 2) + 4],
    ['13-inset-settled', settled('inset')],
    ['14-tag', settled('tag')],
    ...STAGES.map((stage, index) => [`${15 + index}-strip-${stage}`, at('strip', 2 * index + 1)]),
  ]
}
