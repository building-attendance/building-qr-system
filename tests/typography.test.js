// One typeface (Rubik, since direction B of the redesign: owner decision of 14/10/2026) for the whole app; the only thing that varies
// is the weight, in four named steps.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const files = (ext) => walk(path.join(decodeURIComponent(root), 'src')).filter((f) => f.endsWith(ext))
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const css = files('.css').map((f) => ({ f: path.basename(f), text: strip(fs.readFileSync(f, 'utf8')) }))
const jsx = files('.jsx').concat(files('.js')).map((f) => ({ f: path.basename(f), text: fs.readFileSync(f, 'utf8') }))

describe('one typeface: Rubik', () => {
  it('every font-family in the stylesheets is Rubik (with generic fallbacks) or inherits', () => {
    for (const { f, text } of css) {
      for (const [, value] of text.matchAll(/font-family:\s*([^;}]+)/g)) {
        expect(value.trim(), `${f}: ${value}`).toMatch(/^(inherit|'Rubik Variable'[^;]*)$/)
      }
    }
  })

  it('no stylesheet or component names another typeface, a monospace face or a serif', () => {
    const banned = /(Heebo|Assistant|Roboto|Arial|Helvetica|Tahoma|Courier|Consolas|Menlo|ui-monospace|monospace|serif\b(?!\s*;))/
    for (const { f, text } of [...css, ...jsx]) {
      // `sans-serif` as the last generic fallback of the Rubik stack is fine; nothing else on this list is
      const cleaned = text.replace(/system-ui, -apple-system, 'Segoe UI', sans-serif/g, '')
      expect(cleaned.match(banned)?.[0], `${f} mentions ${cleaned.match(banned)?.[0]}`).toBeUndefined()
    }
  })

  it('loads the bundled Rubik variable font, and no other font package', () => {
    const main = fs.readFileSync(path.join(decodeURIComponent(root), 'src', 'main.jsx'), 'utf8')
    expect(main).toContain("@fontsource-variable/rubik'")
    expect(main).not.toMatch(/@fontsource(?!-variable\/rubik)/)
    const pkg = JSON.parse(fs.readFileSync(path.join(decodeURIComponent(root), 'package.json'), 'utf8'))
    const fonts = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n.startsWith('@fontsource'))
    expect(fonts).toEqual(['@fontsource-variable/rubik'])
  })

  it('precaches every subset of it, so a provider who reads the app in Russian or Arabic keeps the typeface offline', () => {
    // The import above is the whole package (Hebrew, Latin, Latin Extended, Cyrillic, Cyrillic Extended, Arabic), and the service
    // worker globs every woff2 file of the build: nothing of the font may be left out of it (owner decision of 14/10/2026).
    const config = fs.readFileSync(path.join(decodeURIComponent(root), 'vite.config.js'), 'utf8')
    expect(config).toMatch(/globPatterns: \[[^\]]*\bwoff2\b/)
    const ignores = config.match(/globIgnores: \[([^\]]*)\]/)?.[1]
    expect(ignores, 'vite.config.js has no globIgnores list').toBeDefined()
    expect(ignores).not.toMatch(/rubik|woff/i)
  })
})

describe('weight is the only typographic variable', () => {
  it('uses the four named weight steps instead of raw numbers', () => {
    for (const { f, text } of css) {
      for (const [, value] of text.matchAll(/font-weight:\s*([^;}]+)/g)) {
        expect(value.trim(), `${f}: font-weight ${value}`).toMatch(/^var\(--w-weight-(regular|medium|semibold|bold)\)$/)
      }
    }
  })

  it('defines exactly those four steps', () => {
    const base = css.find((c) => c.f === 'base.css').text
    const steps = Object.fromEntries([...base.matchAll(/--w-weight-(\w+):\s*(\d+)/g)].map((m) => [m[1], +m[2]]))
    expect(steps).toEqual({ regular: 400, medium: 500, semibold: 600, bold: 700 })
  })

  it('does not vary the letter-spacing or the style of the type', () => {
    for (const { f, text } of css) {
      expect(text, `${f} adjusts letter-spacing`).not.toMatch(/letter-spacing/)
      expect(text, `${f} uses italics`).not.toMatch(/font-style:\s*(italic|oblique)/)
      expect(text, `${f} uses another text transform`).not.toMatch(/font-variant(?!-numeric)|text-transform:\s*(uppercase|capitalize)/)
    }
  })
})
