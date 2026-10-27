# The provider tutorial video

A short video that shows a service provider how to check in, made from the real app. `npm run video:frames` (at the root)
records one still picture of the provider app per step; this folder composes those pictures into the video, with captions, a
mark where to tap, and the narrator's voice when there is one. The script (the lines, in the app's four languages) is in
`video/script/`.

## Render it

```
npm run video:frames                      # at the root: the pictures, video/out/he/ (needs .env.local, see docs/testing.md)
npm --prefix video install                # once: Remotion and the Rubik font, in this folder only
npm --prefix video run render -- he       # video/out/he/provider-he.mp4, provider-he.jpg (poster) and provider-he.vtt (captions)
```

The first render downloads the browser that Remotion draws with (Chrome Headless Shell, about 115 MB) into
`video/node_modules/.remotion`. A render of the 94 seconds takes about a minute on a laptop. It stops with an error if the mp4
is more than 8 MB (it is about 3 MB).

- **Without a voice** (no `timings.json`): the video runs the estimated seconds of `scenes.json`, with the captions, a soft
  tap sound and the music bed, and no narrator.
- **With a voice**: when the narrator (`scripts/video/voice.mjs`) has written `video/out/he/timings.json` and the mp3 files in
  `video/out/he/voice/`, the render reads the real length of each line from it and plays each file where its beat starts. A beat
  that is missing from `timings.json`, or whose file is missing, keeps its estimated seconds (with a warning for the file).
  `timings.json` is `{lang, voice, beats: {<beat id>: {seconds, audio}}}`: `seconds` includes the pause after the line, and
  `audio` is a plain file name of an mp3 in `voice/` (a path is refused). A beat that continues the line before it is never in it.
  The beat of the languages shares its audio with the three screens that follow it, so that the screens change while the
  languages are named (`SPEECH_OVER_CONTINUATIONS` in `src/timing.js`).
- **The credit**: a voice from `elevenlabs` puts "Voice: ElevenLabs" on the closing card.

## What is in it

- `src/timing.js`: the timing, as pure functions (when each beat starts, when a caption is on the screen, when a tap happens, the
  WebVTT file). It imports nothing, so `tests/video-timing.test.js` runs it in the root unit run.
- `src/theme.js`: the colours (the tokens of `src/ui/ui.css`) and the pairs of text and background whose contrast is tested (AA).
- `src/Video.jsx` and `src/Screens.jsx`: the composition. The violet ground, the phone, the recorded screens (stills at twice the
  density, each cross-fading into the next), the caption bar under the phone (Rubik, from right to left for Hebrew and Arabic,
  42 to 34 pixels by the length of the line), a tap mark that grows on the box that the recorder measured, and the password dots
  typed one by one (uncovered from the picture of the sign-in button, so they are the app's own dots).
- Two scenes are drawn, because a phone's own screens cannot be recorded in the browser: the camera held at the printed sign (a
  sharp demo QR code covers the sign's own code: `render.mjs` makes it with `qrcode` at every render, and it holds the plain text
  "DEMO", never a link or a point's token, so scanning the screen opens nothing; a link chip rises under it), and a neutral question about the
  location over the "checking location" screen. Neither copies the dialog of Android or iOS. Their words, and the title cards,
  are in `video/script/drawn.js`, in the four languages.
- **Sound.** `src/assets/tap.wav` is the tap sound, made by `src/make-tap-sound.mjs` (a soft, low tick) and played at
  `TAP_VOLUME`. The music bed is a slow pad with no beat, made at every render by `src/make-music.mjs` into the staged folder as
  `music.wav` (never committed). Its volume is a pure function in `timing.js` (`musicVolumeAt`): a low level, lower again from a
  moment before each line of the narrator to the end of its audio, faded in at the start and out at the end. Every sound, font
  and picture, its source and its licence is in `ASSETS.md`; nothing of a third party is committed.
- **Motion.** A change of scene fades for 0.35 seconds (never more than 0.4) and, when no tap mark or outline shows then, the new picture
  rises 8 pixels as it comes in; a caption rises 8 pixels while it fades in over a quarter of a second. Nothing moves while a
  tap mark or an outline is on the screen (`isCalm` in `timing.js`), and none of it changes the length of the video.
- `src/render.mjs`: the render. It writes next to the pictures, in `video/out/<lang>/` (ignored by git).

## The promo video

A 34-second vertical video (1080x1920) that shows the two apps and where to find the repository, for a committee that has not
seen them. It is separate from the tutorial: the code is in `video/promo/` (its own entry point and composition, built on the same
pinned Remotion), the tutorial never reads it, and nothing is published by a workflow: the owner renders it and publishes it.

```
npm --prefix video ci                     # once, as above
node video/promo/render.mjs he            # silent, on a 120 bpm grid
node video/promo/render.mjs he --music <file> --bpm <tempo> --first-beat <seconds> [--start <seconds>]
```

It writes `video/out/promo/promo-he.mp4`, `promo-he.jpg` (the poster) and, in `stills/`, one picture per scene. The scenes are
whole bars of the music, every cut falls on a beat and the video ends on a bar (`promo/timing.js`).

- `--music` is a local `.mp3`, `.wav` or `.m4a`. `--bpm` and `--first-beat` (the second of the first beat after the start) are
  required with it, and the plan is made at that tempo: a tempo at which a caption cannot be read is refused with the scene's
  name. `--start` is the second of the file where the music starts (default 0); it must leave at least the video's length of the
  file. The music fades in over half a second and out over the last second and a half, so it is silent at the last frame.
- **The track is the owner's licensed file and is never committed.** Keep it outside the repository, or under `video/out/` (ignored
  by git); the render refuses any other path inside the repository. Its page, author and licence are in `ASSETS.md`. The render
  copies it into a staged folder that it deletes at the end.
- The track now used is "Afrobeat 01" by vjgalaxy (Pixabay): `--bpm 120 --first-beat 0 --start 2.435`, which starts it on its
  second bar so that the full groove comes in with the scan scene.
- A copy of this repository that renders the promo falls under the same Remotion terms as the tutorial (the next section and
  [docs/video.md](../docs/video.md), "The Remotion licence").

### The long promo

A 2:16 cut of the same promo (68 bars at 120 bpm, `promo/PromoLong.jsx`, its script in `promo/script/long.js` and
`he-long.js`) shows both sides of the app, end to end, to a committee member who knows nothing about it: what the committee
prepares, what a service provider does and sees, what the committee sees, its AI, and what it takes. The short cut stays as it
is: `--cut` is `short` when it is not given.

```
npm run promo:frames                      # records the screens of both apps, on invented sample data (scripts/promo/)
node video/promo/render.mjs he --cut long --music <file> --bpm 120 --first-beat 0 --start 2.435
```

It writes `video/out/promo/promo-long-he.mp4`, `promo-long-he.jpg` (its frame 0, drawn settled for the thumbnail) and, in
`stills-long/`, one picture per scene and one just before each change of picture. It reads the recorder's pictures and
`frames.json` from `video/out/promo-frames/he/` and refuses to run, naming `npm run promo:frames`, when a picture, a box or the
sample counts of the AI scene are missing. A screen is whole for a beat at most, then zoomed (`promo/parts/screens.js` and
`moves.js`, never more than 1.7 pixels of the video per pixel of the picture); the printed sign shows the demo code over the
sample point's code; the AI's answer is made of the agent API's counts of the sample week, under the tag that says it is an illustration
("המחשה, נתוני דוגמה").

## Licence

Remotion is not open source: its licence (https://www.remotion.pro/license, `LICENSE.md` of the package) is free for an
individual, for a non-profit organisation, and for a for-profit company of up to 3 employees; a larger company needs a paid
company licence. A building committee is within the free terms. A copy of this repository that a management company with more
than 3 employees runs needs that licence, or should leave this folder alone: the app, the CI jobs and Vercel never install
it (it is not in the root `package.json`, and `video/` has its own lockfile), and the workflow that publishes the video runs
only in the original repository, or in a copy that sets the repository variable `VIDEO_ENABLED` to `true` (decision D4 of the
topic; [docs/video.md](../docs/video.md), "In a copy of the repository").

The versions are pinned to exact numbers in `package.json` (all the `remotion` and `@remotion/*` packages to the same one), at
least two weeks old when they were chosen. Update them on purpose, all together, and render once to see the video.
The Rubik font (`@fontsource-variable/rubik`, SIL Open Font License) is the package that the app uses.
