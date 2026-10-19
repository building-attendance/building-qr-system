// The colours of the video: the tokens of src/ui/ui.css (the light and the dark theme of the app), copied here because the video has
// no CSS of the app. No Remotion import: tests/video-timing.test.js holds the contrast of the pairs that carry text.

export const COLORS = Object.freeze({
  // The ground behind the phone: the violet of the app (--w-primary and --w-hero of the light theme, --w-tint-violet-ink's dark side).
  groundFrom: '#5b4bdb',
  groundTo: '#2e2670',
  // The caption bar: the dark theme's background and text.
  barBackground: '#15121f',
  barText: '#f4f2fa',
  barAccent: '#a79bff',
  // The phone's outline.
  phone: '#15121f',
  // The marks over the screen: the violet of the light theme, and white over the dark camera.
  mark: '#5b4bdb',
  markOnDark: '#ffffff',
  // The title card over the home screen: the dark violet, with white text.
  card: '#2e2670',
  cardText: '#ffffff',
  cardTextSecondary: '#d9d4ff',
  // The drawn scenes.
  camera: '#0c0b12',
  chipBackground: '#ffffff',
  chipText: '#1e1b2e',
  sheetBackground: '#ffffff',
  sheetText: '#1e1b2e',
  sheetTextSecondary: '#3d3850',
  sheetButton: '#5b4bdb',
  sheetButtonText: '#ffffff',
})

/** The pairs of text and background, each with the ratio that it must reach (WCAG 1.4.3 AA: 4.5 for text). */
export const TEXT_PAIRS = Object.freeze([
  ['caption', COLORS.barText, COLORS.barBackground],
  ['caption accent', COLORS.barAccent, COLORS.barBackground],
  ['title card', COLORS.cardText, COLORS.card],
  ['title card secondary', COLORS.cardTextSecondary, COLORS.card],
  ['link chip', COLORS.chipText, COLORS.chipBackground],
  ['sheet text', COLORS.sheetText, COLORS.sheetBackground],
  ['sheet secondary text', COLORS.sheetTextSecondary, COLORS.sheetBackground],
  ['sheet button', COLORS.sheetButtonText, COLORS.sheetButton],
])

/** The Rubik of the app (@fontsource-variable/rubik, the same files). */
export const FONT_FAMILY = "'Rubik Variable', system-ui, sans-serif"
