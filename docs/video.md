# The provider tutorial video

A video of about a minute and a half that shows a service provider how to check in. It is made from the real provider app
(the screens are recorded, with the made-up sample building, never real data), so it can be rebuilt when the app changes.

## Where it is

On this project's GitHub Pages, one page and one file per language:

- The video: https://building-attendance.github.io/building-qr-system/video/he.mp4
- The player page: https://building-attendance.github.io/building-qr-system/video/he/

Today only Hebrew is published (narrated, with captions). The provider app has a link, "Watch the tutorial
video (a minute and a half)" in English, on the sign-in screen and on the home screen (`src/worker/tutorial.js`). A language that has no video of its own is sent to the
Hebrew page, so the link never opens a 404. The link is a plain navigation: the app fetches nothing from the site. The sign-in screen's link opens the player page at the start. Each publish also writes `video/<lang>/after-sign-in/`, the same video starting at the scene `locating` (the first after the sign-in), with a link back to the whole video; the home screen's link opens it ("Watch the tutorial video (about a minute)" in English): the site step writes that page and computes the start from the plan of the render, so it follows the video when a scene moves, and it starts at 0 when the scene is missing.

## How it is made

The pipeline is described in [video/README.md](../video/README.md) (the composition, the captions, the sounds, the render)
and the sounds, the font and their licences in [video/ASSETS.md](../video/ASSETS.md). In short, four steps, run in order by
`scripts/video/render-all.mjs`:

1. **frames**: the recorder (Playwright) takes one still picture of the provider app per step, against a scratch database
   with the fake sample data.
2. **voice**: the narrator (ElevenLabs) reads each line of the script in `video/script/`. A line whose text did not change
   keeps the audio that the site already published, so the narrator is called only for a new or changed line.
3. **render**: Remotion composes the pictures, the captions, the tap marks and the sound into the mp4.
4. **site**: the folder that GitHub Pages publishes (the mp4, the player page, the captions, a manifest and the voice cache).

## How it stays up to date

The workflow is `.github/workflows/video.yml` ("Tutorial video"). It does two separate things.

**The gap check, automatic.** On every push to the default branch (a change that is only Markdown or `docs/` is ignored,
because it cannot change a frame or a line), the workflow records the app again and compares it with what was published:
the caption and the spoken line of each beat, the picture of each beat (by the threshold of the visual tests), and a
fingerprint of the video's own sources (`video/`, `scripts/video/`, Markdown files aside, and the voice settings). The comparison decides, not a
list of watched files. When anything is behind, it opens one issue labelled `video-gap`, or quietly rewrites the
description of the open one, so the owner hears once, when a gap first opens. When nothing is behind any more it closes the
issue. It never publishes and never opens a pull request.

**The publish, by hand.** The owner starts it: Actions, "Tutorial video", Run workflow, from the default branch. It records,
voices, renders and deploys the video to GitHub Pages, then closes the `video-gap` issue when the default branch has not
moved since the published commit. If the narration itself must change, that goes in a pull request first, and the publish
comes after it.

The ElevenLabs key is held in the GitHub environment `video` (deployment branches: the default branch only) and only the
voice step receives it ([secrets.md](runbooks/secrets.md), the row `ELEVENLABS_API_KEY`). No pull request runs this
workflow, so code of a pull request never reaches the key. The workflow's header lists what every job may do.

## Render it on your computer

```
node scripts/video/render-all.mjs --voice site
```

This runs the four steps and writes the result to `video/out/` (ignored by git). `--voice site` takes the voice that the site
already published and needs no key; a line that is new or changed is silent. The recorder needs the non-production database
of `.env.local` ([testing.md](testing.md)). Remotion downloads its browser on the first render. `--step frames|voice|render|site`
runs one step alone, and `--voice none` makes every line silent. The script's header explains each option.

## In a copy of the repository

The video workflow is **off** in a copy. Its jobs run only in `building-attendance/building-qr-system`, or in a copy whose
repository variable `VIDEO_ENABLED` is set to `true`. With the variable unset, the workflow starts and every job is skipped:
nothing is recorded, rendered or published, and no issue is opened.

A copy has two choices:

- **Do nothing.** The copy's app links to this project's video, which shows only the made-up sample building. This is enough
  for most committees.
- **Publish its own video**, for example in the committee's own words. This needs the Remotion licence below.

To turn it on, a copy needs: GitHub Pages with the source "GitHub Actions"; the label `video-gap` (an issue cannot be
opened with a label that does not exist); the repository variable `VIDEO_ENABLED` set to `true`; and, if it wants a narrator,
the secret `ELEVENLABS_API_KEY` in an environment named `video`. Without the key the publish still works, but a line that
the copy's own site has not published yet is silent. The site is the copy's own Pages address,
`https://<owner>.github.io/<repository>/`. The home screen link (`TUTORIAL_BASE` in `src/worker/tutorial.js`) is this
project's address, so a copy that publishes its own video also changes that constant.

**The Remotion licence.** Remotion, the tool that draws the video, is not open source. Its licence is free for an individual,
for a non-profit organisation and for a for-profit company of up to 3 employees (`LICENSE.md` of the package, read on
19/10/2026). A building committee is within the free terms. A management company with more than 3 employees that runs a copy
needs a Remotion company licence **before** it sets `VIDEO_ENABLED`. The app, its CI and the Vercel build never install
Remotion (it is in `video/`, with its own lockfile), so a copy that leaves the workflow off never uses it.
