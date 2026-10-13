// The code that runs in the browser uses only the built-ins of the browsers that the build targets (eslint.config.js, "The code
// that runs in the browser"). build.target in vite.config.js is ES2020 with Chrome 87, Edge 88, Firefox 78 and Safari 14; Vite
// lowers the syntax to it but adds no built-in, so a newer one is a TypeError on an older phone (`days.at(-1)`, found by the
// review of #201). These tests run the project's own ESLint configuration on short pieces of code, as if they were files of
// src/, shared/, server/ or the theme script, and show what the guard refuses, what it lets through, and where.
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import esX from 'eslint-plugin-es-x'
import { loadConfigFromFile, transformWithOxc } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: ROOT })

/** The rules of the guard (the plugin and the three `no-restricted-*`) that report `code` as the file `file` (it need not exist). */
async function refusedBy(code, file) {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${file} does not parse: ${fatal.message}\n${code}`)
  return result.messages.map((message) => message.ruleId).filter((rule) => /^(es-x\/|no-restricted-)/.test(rule ?? ''))
}

// [code, the rule that refuses it, where it starts]. The first ones are the list of the review of #201; where they start is from
// MDN's compatibility data (Safari and iOS Safari together).
const NEWER = [
  ['export const last = (days) => days.at(-1)', 'no-restricted-syntax', 'ES2022, Safari 15.4'],
  ['export const last = (days) => days?.at(-1)', 'no-restricted-syntax', 'ES2022, Safari 15.4'],
  ["export const first = (text) => text['at'](0)", 'no-restricted-syntax', 'ES2022, Safari 15.4'],
  ['export const last = (rows) => rows.findLast((row) => row.ok)', 'es-x/no-array-prototype-findlast-findlastindex', 'ES2023, Safari 15.4'],
  ['export const index = (rows) => rows.findLastIndex((row) => row.ok)', 'es-x/no-array-prototype-findlast-findlastindex', 'ES2023, Safari 15.4'],
  ['export const sorted = (rows) => rows.toSorted()', 'es-x/no-array-prototype-tosorted', 'ES2023, Safari 16'],
  ['export const reversed = (rows) => rows.toReversed()', 'es-x/no-array-prototype-toreversed', 'ES2023, Safari 16'],
  ['export const spliced = (rows) => rows.toSpliced(0, 1)', 'es-x/no-array-prototype-tospliced', 'ES2023, Safari 16'],
  ['export const changed = (rows) => rows.with(0, null)', 'es-x/no-array-prototype-with', 'ES2023, Safari 16'],
  ["export const own = (detail) => Object.hasOwn(detail, 'name')", 'es-x/no-object-hasown', 'ES2022, Safari 15.4'],
  ['export const copy = (detail) => structuredClone(detail)', 'no-restricted-globals', 'the web platform, Safari 15.4'],
  ['export const all = (pages) => Array.fromAsync(pages)', 'es-x/no-array-fromasync', 'Safari 16.4'],
  ['export const byDay = (rows) => Object.groupBy(rows, (row) => row.day)', 'es-x/no-object-groupby', 'ES2024, Safari 17.4'],
  ['export const later = () => Promise.withResolvers()', 'es-x/no-promise-withresolvers', 'ES2024, Safari 17.4'],
  // More of the same kind.
  ['export const fastest = (tries) => Promise.any(tries)', 'es-x/no-promise-any', 'ES2021, Firefox 79'],
  ['export const weak = (detail) => new WeakRef(detail)', 'es-x/no-weakrefs', 'ES2021, Safari 14.1'],
  ["export const plain = (text) => text.replaceAll('-', ' ')", 'es-x/no-string-prototype-replaceall', 'ES2021: in all four browsers, but after es2020'],
  ['export const values = () => new Map().values().map((value) => value)', 'es-x/no-iterator-prototype-map', 'ES2025, Safari 18.4'],
  ['export const both = (a, b) => new Set(a).union(new Set(b))', 'es-x/no-set-prototype-union', 'ES2025, Safari 17'],
  ['export const id = () => crypto.randomUUID()', 'no-restricted-properties', 'the web platform, Safari 15.4'],
  ['export const signal = () => AbortSignal.timeout(5000)', 'no-restricted-properties', 'the web platform, Safari 16'],
  // The same, read from the global object (the review of #203).
  ['export const copy = (detail) => window.structuredClone(detail)', 'no-restricted-properties', 'the web platform, Safari 15.4'],
  ["export const copy = (detail) => globalThis['structuredClone'](detail)", 'no-restricted-properties', 'the web platform, Safari 15.4'],
  ['export const id = () => globalThis.crypto.randomUUID()', 'no-restricted-properties', 'the web platform, Safari 15.4'],
  ['export const id = () => { const { randomUUID } = crypto; return randomUUID() }', 'no-restricted-properties', 'the web platform, Safari 15.4'],
  ['export const signal = () => window.AbortSignal.timeout(5000)', 'no-restricted-syntax', 'the web platform, Safari 16'],
  ['export const signal = (signals) => globalThis.AbortSignal.any(signals)', 'no-restricted-syntax', 'the web platform, Safari 17.4'],
  ["export const signal = () => window['AbortSignal'].timeout(5000)", 'no-restricted-syntax', 'the web platform, Safari 16'],
  ["export const signal = (signals) => window.AbortSignal['any'](signals)", 'no-restricted-syntax', 'the web platform, Safari 17.4'],
  ['export const signal = () => window.AbortSignal?.timeout(5000)', 'no-restricted-syntax', 'the web platform, Safari 16'],
  ["export const signal = () => AbortSignal['timeout'](5000)", 'no-restricted-properties', 'the web platform, Safari 16'],
  ['export const last = (days) => Array.prototype.at.call(days, -1)', 'es-x/no-array-prototype-at', 'ES2022, Safari 15.4'],
  ["export const own = (detail) => globalThis.Object.hasOwn(detail, 'name')", 'es-x/no-object-hasown', 'ES2022, Safari 15.4'],
  ['export const later = () => globalThis.Promise.withResolvers()', 'es-x/no-promise-withresolvers', 'ES2024, Safari 17.4'],
  ['export const domain = (email) => /(?<=@)\\w+/.exec(email)', 'es-x/no-regexp-lookbehind-assertions', 'ES2018, but Safari 16.4'],
  ['export const indices = (text) => /a/d.exec(text)', 'es-x/no-regexp-d-flag', 'ES2022, Safari 15'],
]

// What the target has, and what only looks like something newer.
const ALLOWED = [
  'export const time = (entry) => entry.at', // a field named `at` (the time of a scan or of an audit entry), not the method
  'export const time = ({ at }) => at',
  'export const wait = (options) => options.timeout ?? options.any', // fields named like AbortSignal's methods
  "export const wait = (options) => options['timeout'] ?? options.request.any",
  'export const signal = (controller) => controller.signal', // AbortController is older than the target
  'export const last = (days) => days[days.length - 1]',
  "export const own = (detail) => Object.prototype.hasOwnProperty.call(detail, 'name')",
  // An array's methods of ES5 and ES2019, with the names of an iterator's helpers of ES2025.
  'export const names = (rows) => rows.map((row) => row.name).filter(Boolean)',
  'export const first = (rows) => rows.find((row) => row.ok)',
  'export const some = (rows) => rows.some((row) => row.ok) || rows.every((row) => row.ok)',
  'export const items = (rows) => rows.flatMap((row) => row.items)',
  'export const total = (rows) => rows.reduce((sum, row) => sum + row.count, 0)',
  'export const each = (rows) => rows.forEach((row) => row.ok)',
  // ES2019 and ES2020.
  'export const pairs = (entries) => Object.fromEntries(entries)',
  'export const settled = (tries) => Promise.allSettled(tries)',
  'export const words = (text) => [...text.matchAll(/\\w+/g)]',
  "export const plain = (text) => text.replace(/-/g, ' ')",
  'export const domain = (email) => /@(?<domain>\\w+)/.exec(email)?.groups.domain',
  // The syntax after ES2020 that Vite lowers (the last test shows that it does).
  'export const big = 1_000_000',
  'export const fill = (value) => { let result = value; result ??= 1; return result }',
  'export class Box { size = 1; static kind = "box"; #count = 0; static { Box.ready = true } #next() { return ++this.#count } static is(o) { return #count in o } }',
]

describe('the code that runs in the browser uses only what build.target has', () => {
  it('is written for the target of vite.config.js: ES2020 with Chrome 87, Edge 88, Firefox 78 and Safari 14', async () => {
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(ROOT, 'vite.config.js'), ROOT, 'silent')
    expect(
      loaded.config.build.target,
      'build.target changed: the guard in eslint.config.js refuses what came after ES2020 for these browsers, move it with the target',
    ).toEqual(['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'])
  })

  it.each(['src/probe.js', 'src/admin/views/Probe.jsx', 'shared/probe.js'])('refuses a built-in newer than the target in %s', async (file) => {
    for (const [code, rule, since] of NEWER) {
      expect(await refusedBy(code, file), `${code} (${since})`).toContain(rule)
    }
  })

  it('refuses them in the theme script too, which Vite copies as it is', async () => {
    expect(await refusedBy('var first = function (days) { return days.at(0); };', 'public/theme-boot.js')).toContain('no-restricted-syntax')
    expect(await refusedBy('var copy = function (o) { return structuredClone(o); };', 'public/theme-boot.js')).toContain('no-restricted-globals')
  })

  it('lets through what the target has, and what only looks like something newer', async () => {
    for (const code of ALLOWED) {
      for (const file of ['src/probe.js', 'shared/probe.js']) expect(await refusedBy(code, file), `${code} in ${file}`).toEqual([])
    }
  })

  it('lets the server, the scripts and the tests use them all (they run on Node 24, which has every one)', async () => {
    for (const file of ['server/probe.js', 'api/probe.js', 'scripts/probe.mjs', 'tests/probe.test.js']) {
      for (const [code] of NEWER) expect(await refusedBy(code, file), `${code} in ${file}`).toEqual([])
    }
  })

  it('refuses in the theme script even the syntax that Vite lowers: nothing lowers that file', async () => {
    expect(await refusedBy('var big = 1_000;', 'public/theme-boot.js')).toContain('es-x/no-numeric-separators')
    expect(await refusedBy('var choice = null; choice ??= "system";', 'public/theme-boot.js')).toContain('es-x/no-logical-assignment-operators')
  })
})

describe('the rules of eslint-plugin-es-x', () => {
  // Every rule of every preset that the plugin has for an edition after ES2020 (and `esnext`), read from the plugin here and not
  // from eslint.config.js, so that a rule left out of the configuration is seen. Only the names are listed first: reading one of
  // the plugin's old, deprecated presets prints a warning.
  const after2020 = Object.keys(esX.configs)
    .filter((name) => {
      const edition = /^flat\/no-new-in-es(\d{4}|next)(-intl-api)?$/.exec(name)?.[1]
      return edition === 'next' || Number(edition) > 2020
    })
    .flatMap((name) => Object.keys(esX.configs[name].rules))
  const severity = (config, rule) => (Array.isArray(config.rules[rule]) ? config.rules[rule][0] : config.rules[rule])

  // A piece of code for each rule that src/ and shared/ may break, because Vite lowers that syntax.
  const LOWERED = {
    'es-x/no-numeric-separators': 'export const big = 1_000_000',
    'es-x/no-logical-assignment-operators': 'export const fill = (a, b, c) => { a ??= 1; b ||= 2; c &&= 3; return [a, b, c] }',
    'es-x/no-class-instance-fields': 'export class A { size = 1 }',
    'es-x/no-class-static-fields': 'export class A { static kind = "a" }',
    'es-x/no-class-private-fields': 'export class A { #n = 1; get() { return this.#n } }',
    'es-x/no-class-private-methods': 'export class A { #m() { return 1 } run() { return this.#m() } }',
    'es-x/no-class-static-block': 'export class A { static { A.ready = true } }',
    'es-x/no-private-in': 'export class A { #n = 1; static is(o) { return #n in o } }',
  }

  it('has presets after ES2020 to take (the plugin still names them as eslint.config.js expects)', () => {
    expect(after2020).toEqual(expect.arrayContaining(['es-x/no-object-hasown', 'es-x/no-array-prototype-findlast-findlastindex', 'es-x/no-object-groupby']))
  })

  it('are all on for the theme script, and all but the lowered syntax for src/ and shared/', async () => {
    const theme = await eslint.calculateConfigForFile(path.join(ROOT, 'public/theme-boot.js'))
    const missing = after2020.filter((rule) => severity(theme, rule) !== 2)
    expect(missing, 'rules of the plugin that are not on for public/theme-boot.js').toEqual([])
    for (const file of ['src/probe.js', 'src/probe.jsx', 'shared/probe.js']) {
      const config = await eslint.calculateConfigForFile(path.join(ROOT, file))
      const off = after2020.filter((rule) => severity(config, rule) !== 2)
      expect(off.sort(), `the rules of the plugin that are not on for ${file}`).toEqual(Object.keys(LOWERED).sort())
    }
  })

  it('lets src/ and shared/ write only the syntax that Vite really lowers to build.target', async () => {
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(ROOT, 'vite.config.js'), ROOT, 'silent')
    const target = loaded.config.build.target
    for (const [rule, code] of Object.entries(LOWERED)) {
      const only = new ESLint({
        overrideConfigFile: true,
        overrideConfig: { plugins: { 'es-x': esX }, languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }, rules: { [rule]: 'error' } },
      })
      const reports = async (text) => (await only.lintText(text))[0].messages.map((message) => message.ruleId ?? message.message)
      expect(await reports(code), `the piece of code for ${rule} uses that syntax`).toContain(rule)
      const built = await transformWithOxc(code, 'probe.js', { target })
      expect(await reports(built.code), `Vite does not lower ${rule} for ${target.join(', ')}:\n${built.code}`).toEqual([])
    }
  })
})
