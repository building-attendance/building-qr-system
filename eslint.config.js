// ESLint, flat config. `npm run lint` runs it and CI runs the same command in the guards job.
//
// The linter is here for correctness, not for looks: there is no formatting rule and no Prettier. The code style
// (no semicolons, single quotes, two spaces, long lines) is kept by the people and the agents who write it.
//
// What it checks: `@eslint/js` recommended for every file (unused variables and imports, undefined names, unreachable
// code, and the like), the React hooks rules for the app in `src/`, and, for the code that runs in the browser, no built-in
// that the browsers of build.target lack (eslint-plugin-es-x, below). The globals of each folder say where the code
// runs (browser, Node, or both), so that a browser name used in server code is an error.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import esX from 'eslint-plugin-es-x'
import { defineConfig, globalIgnores } from 'eslint/config'

// The names that Node and the browser both define (console, setTimeout, URL, fetch, ...).
const inBoth = Object.fromEntries(Object.entries(globals.node).filter(([name]) => name in globals.browser))

// The code that runs in the browser: what Vite builds into the two apps (src/, and shared/, which the server imports too) and
// the theme script that Vite copies as it is (public/theme-boot.js). build.target in vite.config.js is ES2020 with Chrome 87,
// Edge 88, Firefox 78 and Safari 14, on purpose: the service providers' phones are not known. Vite lowers the syntax of the
// code to that target, but it adds no built-in that a browser lacks: `days.at(-1)` reaches Safari 14 as it is written and
// throws a TypeError there, which stops the screen. So this code may use only the built-ins of ES2020 and of those browsers.
// tests/browser-target.test.js shows what is refused and what is not, and pins the target that this is written for.
//
// eslint-plugin-es-x knows what each edition of ECMAScript added. Every one of its presets for what came after ES2020 is on
// (each year from 2021, its Intl part, and `esnext`), taken from the plugin by name, so that a newer version of the plugin
// brings a newer edition in by itself. The line is the `es2020` of the target, not a table of versions, so it is a little
// stricter than the four browsers (`replaceAll` is in all of them, `Promise.any` in all but Firefox 78). Only the names are
// listed first: reading one of the plugin's old, deprecated presets prints a warning.
const AFTER_ES2020 = /^flat\/no-new-in-es(20(2[1-9]|[3-9]\d)|next)(-intl-api)?$/
const afterES2020 = Object.assign(
  {},
  ...Object.keys(esX.configs).filter((name) => AFTER_ES2020.test(name)).map((name) => esX.configs[name].rules),
)

// The syntax of those editions that Vite lowers to build.target (checked with Vite 8's own transform): what Vite builds may use
// it, the theme script that Vite copies as it is may not. Regular expressions are not on this list on purpose: Vite turns a
// pattern that the target cannot read (the `d` or the `v` flag, a lookbehind) into `new RegExp(...)`, which still throws on
// the old phone, when it runs instead of when it loads.
const LOWERED_BY_VITE = [
  'no-numeric-separators', // 1_000
  'no-logical-assignment-operators', // a ??= b
  'no-class-instance-fields',
  'no-class-static-fields',
  'no-class-private-fields',
  'no-class-private-methods',
  'no-class-static-block',
  'no-private-in', // #field in object
].map((rule) => `es-x/${rule}`)
const afterES2020NotLowered = Object.fromEntries(Object.entries(afterES2020).filter(([rule]) => !LOWERED_BY_VITE.includes(rule)))

// The plugin's aggressive mode (on below) reports a method of a prototype (`rows.findLast(...)`, `rows.toSorted()`) on any
// value, because without TypeScript it knows the type of few. These rules keep the plugin's default instead, which reports
// them only on a value that it knows: the helpers of an iterator that have the names of an array's methods of ES5 and ES2019
// (aggressive mode would refuse every `rows.map(...)`; `map.values().map(...)` is still refused), and `at`, which is also
// the name of a field in this app (the time of a scan or of an audit entry, `entry.at`): its call is refused below instead.
const SAME_NAME_AS_OLDER = [
  'no-array-prototype-at',
  'no-string-prototype-at',
  ...['every', 'filter', 'find', 'flatmap', 'foreach', 'map', 'reduce', 'some'].map((method) => `no-iterator-prototype-${method}`),
].map((rule) => `es-x/${rule}`)

const AT_IS_NEWER =
  'Array.prototype.at and String.prototype.at are ES2022 (Safari 15.4): Safari 14, a browser of build.target in vite.config.js, ' +
  'throws a TypeError. Use list[list.length - 1] or text[i].'
const newerThan = (what, since) => `${what} is in Safari only from ${since}: Safari 14, a browser of build.target in vite.config.js, lacks it.`

const BROWSER_TARGET = {
  ...Object.fromEntries(SAME_NAME_AS_OLDER.map((rule) => [rule, ['error', { aggressive: false }]])),
  // ES2018, so in none of the presets above, but Safari reads it only from 16.4 (and Vite does not lower a pattern, see above).
  'es-x/no-regexp-lookbehind-assertions': 'error',
  // A call of `.at(...)` on anything, the plain and the optional call and `['at']`. Reading a field named `at` is not a call.
  // And AbortSignal's two newer methods when the class is reached through the global object (`window.AbortSignal.timeout`).
  'no-restricted-syntax': [
    'error',
    { selector: "CallExpression > MemberExpression.callee[computed=false][property.name='at']", message: AT_IS_NEWER },
    { selector: "CallExpression > MemberExpression.callee[computed=true][property.value='at']", message: AT_IS_NEWER },
    { selector: "MemberExpression[object.property.name='AbortSignal'][property.name='timeout']", message: newerThan('AbortSignal.timeout', '16') },
    { selector: "MemberExpression[object.property.name='AbortSignal'][property.name='any']", message: newerThan('AbortSignal.any', '17.4') },
  ],
  // Built-ins of the web platform, not of ECMAScript, so the plugin does not know them: the ones that a modern habit reaches for.
  // A name on its own (`structuredClone`) and the same name read from the global object (`window.structuredClone`,
  // `globalThis.crypto.randomUUID`): structuredClone and randomUUID are refused on any object, which here is only ever that one.
  'no-restricted-globals': ['error', { name: 'structuredClone', message: newerThan('structuredClone', '15.4') }],
  'no-restricted-properties': [
    'error',
    { property: 'structuredClone', message: newerThan('structuredClone', '15.4') },
    { property: 'randomUUID', message: `${newerThan('crypto.randomUUID', '15.4')} Use uuid() of src/worker/uuid.js.` },
    { object: 'AbortSignal', property: 'timeout', message: newerThan('AbortSignal.timeout', '16') },
    { object: 'AbortSignal', property: 'any', message: newerThan('AbortSignal.any', '17.4') },
  ],
}

export default defineConfig([
  globalIgnores([
    'dist/', // the build output
    'dev-dist/', // the output of the PWA plugin in development
    'test-results/', // Playwright: traces and screenshots
    'playwright-report/',
    'blob-report/',
    '**/node_modules/',
  ]),

  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      // Every package.json in the repository is "type": "module", so every file is an ES module.
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: {
      // An `eslint-disable` comment that switches off nothing is a leftover: report it, so that a disable comment never
      // outlives the code it was written for.
      reportUnusedDisableDirectives: 'error',
    },
  },

  // The app runs in the browser.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
  },

  // The one file of public/ that is JavaScript: the theme script that index.html loads before the first paint
  // (public/theme-boot.js). Vite copies it as it is, so it is not a module and not part of the bundle: a classic browser
  // script. Only the names change for it (the browser's) and the kind of file (a script, not a module); every rule stays on.
  {
    files: ['public/theme-boot.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },

  // The two classic React hooks rules, for the app only (the only place that has components and hooks).
  //
  // Not the whole `recommended` preset of eslint-plugin-react-hooks 7: it adds the rules of the React Compiler (`refs`,
  // `set-state-in-effect`, `immutability`, `purity`, ...). This app does not use the compiler, and it uses on purpose
  // what those rules forbid: the "latest value" ref that is assigned while rendering, and the effect that calls a
  // `load()` function which sets state. Rewriting that is a refactor of its own, not a lint rule to switch on.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Code that runs on the server, in a script or in the tooling.
  {
    files: [
      'api/**/*.js',
      'server/**/*.{js,mjs}',
      'scripts/**/*.mjs',
      '*.config.js', // vite, vitest, playwright and this file
    ],
    languageOptions: { globals: globals.node },
  },

  // Code that is imported by the browser and by the server alike: only the names that both of them have (`window` or
  // `process` here would break one of the two).
  {
    files: ['shared/**/*.js'],
    languageOptions: { globals: inBoth },
  },

  // The code that runs in the browser uses only what the browsers of build.target have (see AFTER_ES2020 at the top): what
  // Vite builds may use the syntax that Vite lowers, the theme script that Vite copies as it is may not.
  {
    files: ['src/**/*.{js,jsx}', 'shared/**/*.js'],
    plugins: { 'es-x': esX },
    settings: { 'es-x': { aggressive: true } },
    rules: { ...afterES2020NotLowered, ...BROWSER_TARGET },
  },
  {
    files: ['public/theme-boot.js'],
    plugins: { 'es-x': esX },
    settings: { 'es-x': { aggressive: true } },
    rules: { ...afterES2020, ...BROWSER_TARGET },
  },

  // Vitest tests run in Node. Vitest is configured without globals (vitest.config.js), so every test imports `describe`,
  // `it` and `expect`. The component tests run in jsdom, which gives them the browser's names too.
  {
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/components/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Playwright specs run in Node, but the functions that they pass to `page.evaluate` run in the page.
  {
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // The kill switch of the old app's service worker, a separate deployable (legacy-redirect/, on Firebase Hosting).
  {
    files: ['legacy-redirect/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
])
