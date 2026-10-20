# Assets of the provider video

Every sound, font and picture that the video uses, where it comes from and under what licence (decision D14 of the topic).
The rule: a sound is made from code at render time, and no file of a third party is committed to this public MIT repository.
A third-party file is allowed only if the render fetches it, it is never saved in the repository, and its licence allows use in a
published video; there is none today. A new asset gets its row here in the same pull request that adds it, and
`tests/video-timing.test.js` fails when a file under `src/assets/` or a `src/make-*.mjs` generator has no row.

| Asset | What it is | How it is made | Source | Licence |
|-------|------------|----------------|--------|---------|
| `src/assets/tap.wav` | the soft tick that plays at every tap (committed, about 12 KB) | `src/make-tap-sound.mjs`: a sine with a short downward glide and its octave below, a gentle attack and a fast decay. Run `node video/src/make-tap-sound.mjs` only to change it | this repository | ours (MIT, like the code) |
| `src/make-music.mjs` (the music bed) | a slow pad with no beat and no tune, very quiet, that ducks under the narrator and fades in and out | `src/make-music.mjs`: a few sine partials in four slow chords with long attack and release, the same file at every render. `src/render.mjs` writes it to the staged public folder as `music.wav` and it is never committed | this repository | ours (MIT, like the code) |
| Rubik | the font of the captions and the title cards | the package `@fontsource-variable/rubik`, the same one that the app uses | Rubik (Google Fonts), through Fontsource | SIL Open Font License 1.1 |
| The narration | the voice of the lines, in Hebrew (the other languages have none yet) | `scripts/video/voice.mjs` (ElevenLabs), fetched again from the published site by the render without a key; the mp3 files are in `video/out/` and on GitHub Pages, never in the repository | ElevenLabs (the credit "Voice: ElevenLabs" is on the closing card) | the terms of the owner's ElevenLabs plan |
| The recorded screens | one still picture of the provider app per step | `npm run video:frames` (Playwright, the fake sample data of the dev seed), in `video/out/`, never committed | this repository | ours (MIT, like the code) |
| The demo QR code | the sharp code that the camera scene shows over the printed sign | `src/render.mjs`, with the pinned `qrcode`, at every render; it holds the word "DEMO", never a link or a point's token | this repository | ours (MIT, like the code) |
