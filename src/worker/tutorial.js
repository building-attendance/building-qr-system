/**
 * The tutorial video of the provider app: a page on GitHub Pages with a player, one per language, published by the video workflow
 * (.github/workflows/video.yml, from `video/`). The sign-in screen and the home screen link to it, and a link is a navigation: nothing
 * here is fetched by the app, so the Content-Security-Policy and the precache do not change.
 */

export const TUTORIAL_BASE = 'https://building-attendance.github.io/building-qr-system/video/'

/** The languages whose video is published. Add a code here only after its player page answers (a link must never open a 404). */
export const TUTORIAL_LANGS = ['he']

/** The language a person without a video of their own is shown. */
const FALLBACK_LANG = 'he'

/**
 * The folder of the page that starts the same video after the sign-in (at the scene `locating`). The site step writes it
 * (AFTER_SIGN_IN_DIR in scripts/video/render-all.mjs); tests/video-after-sign-in.test.js pins the two names equal.
 */
export const AFTER_SIGN_IN_DIR = 'after-sign-in'

/**
 * The address of the player page for a language: that language when its video is published, else the Hebrew one. With `afterSignIn`,
 * the page of the same video that starts after the sign-in, for a person who is already signed in.
 * @param {string} lang
 * @param {{ afterSignIn?: boolean }} [options]
 */
export function tutorialUrl(lang, { afterSignIn = false } = {}) {
  return `${TUTORIAL_BASE}${TUTORIAL_LANGS.includes(lang) ? lang : FALLBACK_LANG}/${afterSignIn ? `${AFTER_SIGN_IN_DIR}/` : ''}`
}
