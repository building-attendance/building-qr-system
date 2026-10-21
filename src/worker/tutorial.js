/**
 * The tutorial video of the provider app: a page on GitHub Pages with a player, one per language, published by the video workflow
 * (.github/workflows/video.yml, from `video/`). The sign-in screen and the home screen both link to it, the whole video from the start (the
 * owner, 21/10/2026), and a link is a navigation: nothing here is fetched by the app, so the Content-Security-Policy and the precache do
 * not change.
 */

export const TUTORIAL_BASE = 'https://building-attendance.github.io/building-qr-system/video/'

/** The languages whose video is published. Add a code here only after its player page answers (a link must never open a 404). */
export const TUTORIAL_LANGS = ['he']

/** The language a person without a video of their own is shown. */
const FALLBACK_LANG = 'he'

/**
 * The address of the player page for a language: that language when its video is published, else the Hebrew one.
 * @param {string} lang
 */
export function tutorialUrl(lang) {
  return `${TUTORIAL_BASE}${TUTORIAL_LANGS.includes(lang) ? lang : FALLBACK_LANG}/`
}
