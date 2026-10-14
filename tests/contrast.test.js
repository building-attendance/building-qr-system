// Both themes are held to WCAG AA (4.5:1 for text, 3:1 for the edge of a control and for the focus ring), computed
// from the real tokens in src/ui/ui.css, so a colour change that breaks readability fails here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { CHROME_COLORS } from '../src/ui/theme.js'

const css = fs.readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const block = (selectorStart) => {
  const at = css.indexOf(selectorStart)
  if (at < 0) throw new Error(`no rule starting with ${selectorStart}`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}
const tokens = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))

const parse = (value) => {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 }
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/)
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] }
  throw new Error(`cannot parse colour ${value}`)
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

const themes = {
  dark: tokens(block('.w-app, .a-app')),
  light: tokens(block(":root[data-theme='light'] .w-app")),
}
// The light block only overrides: anything it does not mention comes from the dark one, so check the merge.
themes.light = { ...themes.dark, ...themes.light }

describe.each(Object.entries(themes))('%s theme meets WCAG AA', (name, t) => {
  const c = (token) => parse(t[token])
  const pairs = []
  const check = (label, fg, bg, min) => pairs.push([label, fg, bg, min])

  const surfaces = { bg: c('--w-bg'), surface: c('--w-surface'), 'surface-2': c('--w-surface-2') }
  for (const [sn, s] of Object.entries(surfaces)) {
    for (const k of ['--w-text', '--w-text-2', '--w-text-3']) check(`${k} on ${sn}`, c(k), s, 4.5)
  }
  // Text and icons on a filled primary button (.w-btn, the round add button of the committee app). White on the light violet of the
  // dark theme would be 2.4:1, so the colour on it is a token of its own: white in the light theme, the dark background in the dark one.
  check('--w-on-primary on primary', c('--w-on-primary'), c('--w-primary'), 4.5)
  check('--w-on-primary on primary (hover)', c('--w-on-primary'), c('--w-primary-hover'), 4.5)
  // The summary card of the Home screen (--w-hero) and the text on it.
  check('--w-on-hero on hero', c('--w-on-hero'), c('--w-hero'), 4.5)
  // The four tints of tiles, chips and badges: the ink of each, the body text, and the focus ring of something drawn on it.
  for (const tint of ['violet', 'peach', 'mint', 'sky']) {
    const bg = c(`--w-tint-${tint}`)
    check(`--w-tint-${tint}-ink on its tint`, c(`--w-tint-${tint}-ink`), bg, 4.5)
    check(`--w-text on the ${tint} tint`, c('--w-text'), bg, 4.5)
    check(`focus ring on the ${tint} tint`, c('--w-focus'), bg, 3)
  }
  for (const sn of ['surface', 'surface-2', 'bg']) {
    check(`field border on ${sn}`, c('--w-field-border'), surfaces[sn], 3)
    check(`field border (hover) on ${sn}`, c('--w-field-border-hover'), surfaces[sn], 3)
    check(`focus ring on ${sn}`, c('--w-focus'), surfaces[sn], 3)
  }
  for (const kind of ['success', 'warn', 'danger', 'info']) {
    for (const sn of ['surface', 'bg']) {
      check(`--w-${kind} on ${sn}`, c(`--w-${kind}`), surfaces[sn], 4.5)
      const tint = over(c(`--w-${kind}-bg`), surfaces[sn])
      check(`--w-${kind} on its tint over ${sn}`, c(`--w-${kind}`), tint, 4.5)
      check(`--w-text on the ${kind} tint over ${sn}`, c('--w-text'), tint, 4.5)
    }
  }

  // The four steps of the count cells of the Home table (--w-count-1 to 4, used by .a-count in src/admin/admin.css): a tint of violet
  // over the surface of the table. The number in a cell is --w-text (4.5:1), and the focus ring, which is drawn inside the cell, has to
  // stand out from the step it is on (3:1). So does the hover ring, which is --w-info: it used to be the focus colour in both themes, and
  // with the violet palette it is a deeper violet (light) or a paler one (dark), so it is checked on every step by itself.
  const step = (n) => over(c(`--w-count-${n}`), surfaces.surface)
  for (const n of [1, 2, 3, 4]) {
    check(`--w-text on count step ${n} over surface`, c('--w-text'), step(n), 4.5)
    check(`focus ring on count step ${n} over surface`, c('--w-focus'), step(n), 3)
    check(`hover ring (--w-info) on count step ${n} over surface`, c('--w-info'), step(n), 3)
  }

  it.each(pairs)(`${name}: %s`, (label, fg, bg, min) => {
    expect(ratio(fg, bg), `${label}: ${ratio(fg, bg).toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min)
  })

  it('the count steps get deeper: each is further from the surface than the one before, and the first can be seen', () => {
    const away = [1, 2, 3, 4].map((n) => ratio(step(n), surfaces.surface))
    for (let i = 1; i < away.length; i++) expect(away[i], `step ${i + 1} against step ${i}`).toBeGreaterThan(away[i - 1])
    expect(away[0], 'step 1 against the surface').toBeGreaterThan(1.05)
  })

})

describe('controls do not lose their own type and colour to the reset', () => {
  // `.w-app button { font: inherit; color: inherit }` outranked a plain `.w-btn { color: #fff; font-weight: ... }`, so a
  // button took the colour around it (green on blue on the "recorded" screen; dark on blue in the light theme) and
  // lost its weight and size. The reset must have no specificity of its own.
  it('resets controls inside :where(), so the class rules win', () => {
    expect(css).toContain(':where(.w-app, .a-app) :where(button, select, input, textarea) { font: inherit; color: inherit; }')
    expect(css).not.toMatch(/\.w-app button|\.a-app button/)
  })
  it('the filled button is --w-on-primary on the primary colour', () => {
    expect(css).toMatch(/\.w-btn \{[^}]*background: var\(--w-primary\); color: var\(--w-on-primary\);/)
  })
})

describe('the two themes define the same set of tokens', () => {
  it('light overrides only tokens that exist in dark, and every dark token is themed', () => {
    const raw = tokens(block(":root[data-theme='light'] .w-app"))
    for (const token of Object.keys(raw)) expect(themes.dark, token).toHaveProperty(token)
    // every token of the two blocks is a colour or a shadow, and the light block sets each one (a forgotten one would stay dark on a
    // light page)
    const mustDiffer = Object.keys(themes.dark)
    expect(mustDiffer.length).toBeGreaterThan(40)
    for (const token of mustDiffer) expect(raw[token], `${token} is not themed`).toBeDefined()
  })
})

describe('the page around the apps and the browser bar take --w-bg of each theme', () => {
  // --w-bg is scoped to the two app roots, so the page behind them (src/ui/base.css), the colour of the browser's own bar (CHROME_COLORS
  // in src/ui/theme.js, which tests/theme.test.js holds in step with public/theme-boot.js) and the first colour of the installed app (the
  // meta tag of index.html and the manifest) repeat it. A new palette has to move them too, or a strip of the old colour shows.
  const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const dark = themes.dark['--w-bg']
  const light = themes.light['--w-bg']

  it('src/ui/base.css paints the page in it', () => {
    const base = read('src/ui/base.css')
    expect(base).toContain(`html, body { margin: 0; padding: 0; background: ${dark}; }`)
    expect(base).toContain(`html[data-theme='light'], html[data-theme='light'] body { background: ${light}; }`)
  })

  it('the browser bar of each theme, and the first paint of the installed app, are in it', () => {
    expect(CHROME_COLORS).toEqual({ dark, light })
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${dark}" />`)
    const config = read('vite.config.js')
    expect(config).toContain(`theme_color: '${dark}',`)
    expect(config).toContain(`background_color: '${dark}',`)
  })
})
