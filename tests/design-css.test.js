// Two design rules and one guard on the cascade, checked on the stylesheets (src/**/*.css) and on the inline styles of the components
// (`style={{ ... }}` in src/**/*.jsx). The rule ids are the ones of docs/design.md.
//
// R1  Logical properties. The provider app is written in two directions (Hebrew and Arabic run right to left, English and Russian left
//     to right), so a box is placed by the start and the end of the line, never by left and right: margin-inline-start, padding-inline,
//     inset-inline-end, text-align: start. A physical property is a bug in one of the two directions. What this flags: margin, padding,
//     border (and its width, style, colour and corner radius), `left`, `right`, `text-align` / `float` / `clear` set to left or right, a
//     background or object position that names left or right, and the four-value shorthands of margin, padding and inset whose right and
//     left differ. A physical property that is right on purpose is listed in tests/design-budget.json under `physicalExceptions`, with
//     the reason, matched exactly (file, selector or line, property). An exception whose declaration is gone fails, as an entry of
//     e2e/a11y-baseline.js does, so the list cannot go stale. (Only the physical properties of the line are flagged. `top` and `bottom`
//     are the same in both directions.)
//
// V1  Hard-coded values. Spacing (margin, padding, gap, inset, top, bottom, left, right), border radius and font size come from tokens
//     (--w-space-*, --w-radius-*, --w-font-*, defined once on :root in src/ui/base.css, next to the weight tokens). Two checks keep it so.
//     First, a literal whose size IS a token must be written as the token: `padding: 8px` is `padding: var(--w-space-2)`, `-8px` is
//     `calc(-1 * var(--w-space-2))`, in a stylesheet and in the inline style of a component, and the failure names the token to use.
//     The tokens are read from base.css, never copied here, so a step added there is enforced at once. Second, what is not on a scale yet
//     (a 3px or a 56px, a font size that no token has) is a literal that may only go DOWN: tests/design-budget.json holds the count of
//     each file under `literalBudget`, and this test fails on both sides of it. Above the budget, a declaration was added with a literal
//     in it: use a token, or the value of a neighbour, or leave it out. Below the budget, a literal was removed: the test says what to
//     lower the budget to, so that the new count is the ceiling (a ratchet). Raising a budget is a decision of the owner and a P1
//     finding in the code review (Code Review Rules of AGENTS.md), never a way to get the test green. A file that is not in the budget has
//     a budget of 0. What is counted: a px or rem literal in a spacing, radius or font-size declaration, outside a custom property
//     (`--x: 8px` is the definition of a token), and in a component the numbers that React reads as px (`padding: 8`) and the px and rem
//     strings (`'6px 12px'`); a 0 is not a literal. A literal inside calc(), max() or var(--x, 8px) counts.
//
// Reset  A reset has no specificity. `.w-app p { margin: 0; padding: 0; border: 0 }` (0,1,1) outranks any rule of one class (0,1,0), so
//     a class that gave its paragraph or heading a margin, a padding or a border was cancelled, with no sign of it: the privacy note of the
//     provider's sign-in screen came out with no padding at all (the shield touched the edge of its box), and so did four other rules (the
//     title of a section, the heads of the days, the building's name on the committee's sign-in, the build label). A rule that sets the
//     margin, padding or border of elements by their TYPE, scoped by nothing but the roots of the apps (.w-app, .a-app), is a reset, and its
//     specificity must stay under that of one class: the roots go in `:where()`, as `:where(.w-app, .a-app) :where(h1, h2, h3, p)` does.
//     A rule that is scoped by a class of a component (`.a-head p`) is that component's own and is not a reset.
//
// The scanner is checked by itself first (the cases at the end), because a scanner that finds nothing would pass every day.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ---- reading the sources ------------------------------------------------------------------------------------------------

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const sources = (ext) =>
  walk(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }))
    .sort((a, b) => a.file.localeCompare(b.file))

/** The text with every comment turned into spaces (the line breaks stay, so that a line number is still right). */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

const lineOf = (text, index) => text.slice(0, index).split('\n').length

/**
 * Cuts `text` at every character that matches `separator`, except inside quotes and brackets. Returns the pieces with their
 * position in `text` (empty pieces are dropped).
 * @returns {{ text: string, index: number }[]}
 */
function splitTop(text, separator) {
  const pieces = []
  let depth = 0
  let quote = null
  let from = 0
  const cut = (to) => {
    const raw = text.slice(from, to)
    const trimmed = raw.trim()
    if (trimmed) pieces.push({ text: trimmed, index: from + raw.indexOf(trimmed) })
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (depth === 0 && separator.test(ch)) {
      cut(i)
      from = i + 1
    }
  }
  cut(text.length)
  return pieces
}

// ---- the declarations of a stylesheet -----------------------------------------------------------------------------------

/**
 * Every declaration of a stylesheet: { line, where (the selector of the rule it is in, spaces collapsed), property (lower case), value }.
 * A rule inside @media, @supports or @layer reports its own selector; the declaration of an @page or @font-face reports the at-rule.
 */
function cssDeclarations(source) {
  const text = blankComments(source)
  const found = []
  const open = [] // the preludes of the blocks that are open now
  let start = 0 // where the current statement began
  let depth = 0 // parentheses
  let quote = null
  const declare = (raw, at) => {
    const statement = raw.trim()
    const colon = statement.indexOf(':')
    if (!statement || statement.startsWith('@') || colon < 1 || open.length === 0) return
    const property = statement.slice(0, colon).trim().toLowerCase()
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(property)) return
    const where = [...open].reverse().find((prelude) => !prelude.startsWith('@')) ?? open[open.length - 1]
    found.push({ line: lineOf(text, at + raw.indexOf(statement)), where, property, value: statement.slice(colon + 1).trim() })
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth > 0) continue
    else if (ch === '{') {
      open.push(text.slice(start, i).trim().replace(/\s+/g, ' '))
      start = i + 1
    } else if (ch === ';' || ch === '}') {
      declare(text.slice(start, i), start)
      if (ch === '}') open.pop()
      start = i + 1
    }
  }
  return found
}

// ---- the inline styles of a component -----------------------------------------------------------------------------------

/** The position of the `}` that closes the `{` at `open`, or -1. */
function matchingBrace(text, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

const kebab = (key) => (key === 'cssFloat' ? 'float' : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))

/**
 * Every entry of every `style={{ ... }}` of a component: { line, where (the trimmed source line), property (as CSS, lower case), value
 * (the source of the value, quotes included) }. Spreads, shorthand entries and custom properties ('--x') are left out.
 */
function inlineStyleDeclarations(source) {
  const found = []
  for (const opener of source.matchAll(/style=\{\{/g)) {
    const inner = opener.index + opener[0].length - 1
    const close = matchingBrace(source, inner)
    if (close < 0) continue
    const body = source.slice(inner + 1, close)
    for (const entry of splitTop(body, /,/)) {
      const colon = entry.text.indexOf(':')
      if (entry.text.startsWith('...') || colon < 1) continue
      const key = entry.text.slice(0, colon).trim().replace(/^['"]|['"]$/g, '')
      if (key.startsWith('--')) continue
      const at = inner + 1 + entry.index
      const lineStart = source.lastIndexOf('\n', at) + 1
      const lineEnd = source.indexOf('\n', at)
      found.push({
        line: lineOf(source, at),
        where: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim(),
        property: kebab(key).toLowerCase(),
        value: entry.text.slice(colon + 1).trim(),
      })
    }
  }
  return found
}

// ---- R1: what is physical -----------------------------------------------------------------------------------------------

const LEFT_OR_RIGHT = /^(left|right)$/i

/** The strings of a value as the source of a component writes it: the value itself, and what is between its quotes. */
const candidates = (value) => [value.replace(/^(['"`])(.*)\1$/, '$2'), ...[...value.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2])]

/** True when a physical (left or right) side is named by this value of this property, or by a four-value shorthand whose sides differ. */
function isPhysical(property, rawValue) {
  const value = rawValue.replace(/\s*!important\s*$/i, '').trim()
  if (/^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/.test(property)) return true
  if (/^border-(left|right)(-(width|style|color))?$/.test(property)) return true
  if (/^border-(top|bottom)-(left|right)-radius$/.test(property)) return true
  if (property === 'left' || property === 'right') return true
  if (/^(text-align|float|clear)$/.test(property)) return candidates(value).some((v) => LEFT_OR_RIGHT.test(v.trim()))
  if (/^(background-position(-x)?|object-position|mask-position|transform-origin|perspective-origin)$/.test(property)) {
    return candidates(value).some((v) => /(^|[\s(,])(left|right)(?![\w-])/i.test(v))
  }
  if (/^(margin|padding|inset)$/.test(property)) {
    const sides = candidates(value).map((v) => splitTop(v, /\s/).map((p) => p.text))
    return sides.some((s) => s.length === 4 && s[1] !== s[3])
  }
  return false
}

// ---- V1: what is a hard-coded value -------------------------------------------------------------------------------------

/** The properties whose px and rem literals are counted: spacing, border radius, font size. Each is paired with the family of tokens that stands for it. */
const COUNTED = [
  [/^(margin|padding)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/, 'space'],
  [/^(gap|row-gap|column-gap)$/, 'space'],
  [/^inset(-(block|inline|block-start|block-end|inline-start|inline-end))?$/, 'space'],
  [/^(top|bottom|left|right)$/, 'space'],
  [/^border-radius$/, 'radius'],
  [/^border-(start|end)-(start|end)-radius$/, 'radius'],
  [/^border-(top|bottom)-(left|right)-radius$/, 'radius'],
  [/^font-size$/, 'font'],
]
/** The family of tokens ('space', 'radius' or 'font') of a counted property, or null for any other property. */
const familyOf = (property) => COUNTED.find(([pattern]) => pattern.test(property))?.[1] ?? null

const LITERAL = /(?<![\w.$])-?(?:\d+\.?\d*|\.\d+)(?:px|rem)\b/gi

/** A literal as it is written (`text`) and its size without the sign (`value`: '8px', '0.875rem'), the way a token of base.css is compared. */
function sizeOf(text) {
  const [, sign, number, unit] = /^(-?)(\d+\.?\d*|\.\d+)(px|rem)$/i.exec(text)
  return { text, negative: sign === '-', value: `${Number(number)}${unit.toLowerCase()}` }
}

/** The hard-coded values of this declaration. In a stylesheet only px and rem count; in a component a bare number is px too. */
function literalsOf(property, value, inComponent) {
  if (!familyOf(property)) return []
  const found = [...value.matchAll(LITERAL)].map((m) => sizeOf(m[0]))
  if (inComponent) {
    const outsideStrings = value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, ' ')
    for (const m of outsideStrings.matchAll(/(?<![\w.$])-?(?:\d+\.?\d*|\.\d+)(?![\w.])/g)) if (Number(m[0]) !== 0) found.push(sizeOf(`${m[0]}px`))
  }
  return found
}

/** How many hard-coded values this declaration holds. */
const literalCount = (property, value, inComponent) => literalsOf(property, value, inComponent).length

// ---- V1: the size tokens ------------------------------------------------------------------------------------------------

const TOKEN_FILE = 'src/ui/base.css'
const TOKEN_PREFIX = { space: '--w-space-', radius: '--w-radius-', font: '--w-font-' }

/**
 * The size tokens, read from the declarations of the stylesheets: for each family, the size ('8px', '0.875rem') to the name of the
 * token that holds it. A token is defined only in src/ui/base.css, as one number with px or rem, and no two tokens of a family hold the
 * same size (the failure for a literal names ONE token). `problems` lists what breaks that.
 */
function readSizeTokens(declarations) {
  const tokens = { space: new Map(), radius: new Map(), font: new Map() }
  const problems = []
  for (const d of declarations) {
    const family = Object.keys(TOKEN_PREFIX).find((name) => d.property.startsWith(TOKEN_PREFIX[name]))
    if (!family) continue
    const value = /^(\d+\.?\d*|\.\d+)(px|rem)$/i.exec(d.value.trim())
    if (d.file !== TOKEN_FILE) problems.push(`${describeDeclaration(d)}\n    a size token is defined in ${TOKEN_FILE} only, so that there is one scale`)
    else if (!value) problems.push(`${describeDeclaration(d)}\n    a size token is one number with px or rem`)
    else {
      const size = `${Number(value[1])}${value[2].toLowerCase()}`
      const twin = tokens[family].get(size)
      if (twin) problems.push(`${d.property} and ${twin} are both ${size}: a size has one token, so that a literal can be told which one to use`)
      else tokens[family].set(size, d.property)
    }
  }
  return { tokens, problems }
}

/**
 * The literals of the declarations whose size is a token. A literal of a size that has a token is written as the token (the value is the
 * same, so no pixel moves): `var(--w-space-2)` for 8px, `calc(-1 * var(--w-space-2))` for -8px, a string in a component. Returns one
 * message per literal, naming the token to use.
 */
function checkTokens(declarations, tokens) {
  const problems = []
  for (const d of declarations) {
    const family = familyOf(d.property)
    for (const literal of literalsOf(d.property, d.value, d.inComponent)) {
      const token = tokens[family]?.get(literal.value)
      if (!token) continue
      const use = literal.negative ? `calc(-1 * var(${token}))` : `var(${token})`
      problems.push(`${describeDeclaration(d)}\n    ${literal.text} is the size of ${token}: write ${d.inComponent ? `'${use}'` : use}`)
    }
  }
  return problems
}

// ---- Reset: a reset has no specificity ----------------------------------------------------------------------------------

/** The classes that mark the root of an app: a selector scoped by these alone is global to the app. */
const APP_ROOTS = new Set(['w-app', 'a-app'])

/** The properties that a reset zeroes and a class sets again: margin, padding and the edge (not border-radius, which a reset leaves alone). */
const RESET_PROPERTY = /^(margin|padding)(-|$)|^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|style|color))?$/

/** The end of the identifier (a class, a type, a pseudo-class) that starts at `from`. */
function identEnd(text, from) {
  let i = from
  while (i < text.length && (/[\w-]/.test(text[i]) || text.charCodeAt(i) > 127 || text[i] === '\\')) i += text[i] === '\\' ? 2 : 1
  return i
}

const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * What one selector is made of, by the rules of Selectors Level 4: its specificity [ids, classes, types], the names of its classes, how
 * many ids, attributes and pseudo-classes it has (`others`), its types and whether it has a `*`. `:where()` counts nothing in the
 * specificity (what is in it is still listed, so that a reset written in it is still seen as one); `:is()`, `:not()` and `:has()` count the
 * most specific of their arguments; a pseudo-element counts as a type.
 * @returns {{ specificity: [number, number, number], classes: string[], others: number, types: number, universal: boolean }}
 */
function readSelector(selector) {
  const read = { specificity: [0, 0, 0], classes: [], others: 0, types: 0, universal: false }
  const walkSelector = (text, counts) => {
    const count = (kind, n = 1) => {
      if (counts) read.specificity[kind] += n
    }
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      if (ch === '#') {
        i = identEnd(text, i + 1)
        read.others++
        count(0)
      } else if (ch === '.') {
        const end = identEnd(text, i + 1)
        read.classes.push(text.slice(i + 1, end))
        i = end
        count(1)
      } else if (ch === '[') {
        i = text.indexOf(']', i) + 1 || text.length
        read.others++
        count(1)
      } else if (ch === ':') {
        const element = text[i + 1] === ':'
        const nameStart = i + (element ? 2 : 1)
        const nameEnd = identEnd(text, nameStart)
        const name = text.slice(nameStart, nameEnd).toLowerCase()
        let argument = ''
        i = nameEnd
        if (text[i] === '(') {
          let depth = 0
          let close = i
          for (; close < text.length; close++) {
            if (text[close] === '(') depth++
            else if (text[close] === ')' && --depth === 0) break
          }
          argument = text.slice(i + 1, close)
          i = close + 1
        }
        if (element || ['before', 'after', 'first-line', 'first-letter'].includes(name)) {
          read.types++
          count(2)
        } else if (name === 'where') {
          for (const part of splitTop(argument, /,/)) walkSelector(part.text, false)
        } else if (['is', 'not', 'has', 'matches'].includes(name)) {
          let widest = [0, 0, 0]
          for (const part of splitTop(argument, /,/)) {
            const inner = readSelector(part.text)
            read.classes.push(...inner.classes)
            read.types += inner.types
            if (compareSpecificity(inner.specificity, widest) > 0) widest = inner.specificity
          }
          read.others++
          for (let kind = 0; kind < 3; kind++) count(kind, widest[kind])
        } else {
          read.others++
          count(1)
        }
      } else if (ch === '*') {
        read.universal = true
        i++
      } else if (/[a-zA-Z_]/.test(ch) || ch.charCodeAt(0) > 127) {
        i = identEnd(text, i)
        read.types++
        count(2)
      } else i++ // a combinator, a space or the bar of a namespace
    }
  }
  walkSelector(selector, true)
  return read
}

const showSpecificity = (specificity) => `(${specificity.join(',')})`

/** True when this selector is a reset: the roots of the apps and types (or `*`), and no other class, id, attribute or pseudo-class. */
function isReset(selector) {
  const { classes, others, types, universal } = readSelector(selector)
  return others === 0 && classes.length > 0 && classes.every((name) => APP_ROOTS.has(name)) && (types > 0 || universal)
}

/**
 * The resets that outrank a class: a rule that sets the margin, padding or border of elements by their type under the roots of the apps,
 * with a selector whose specificity is that of one class or more. One entry per selector of a rule, with the properties it sets.
 * @returns {{ file: string, line: number, selector: string, properties: string[], specificity: number[] }[]}
 */
function checkResets(declarations) {
  const found = new Map()
  for (const d of declarations) {
    if (d.inComponent || !RESET_PROPERTY.test(d.property)) continue
    for (const part of splitTop(d.where, /,/)) {
      if (!isReset(part.text)) continue
      const { specificity } = readSelector(part.text)
      if (compareSpecificity(specificity, [0, 1, 0]) < 0) continue
      const key = JSON.stringify([d.file, d.where, part.text])
      const entry = found.get(key) ?? { file: d.file, line: d.line, selector: part.text, properties: [], specificity }
      entry.properties.push(d.property)
      found.set(key, entry)
    }
  }
  return [...found.values()]
}

// ---- the findings, and the budget file ----------------------------------------------------------------------------------

/** All declarations of the project, with the file they are in and whether they are in a component. */
function projectDeclarations() {
  return [
    ...sources('.css').flatMap(({ file, text }) => cssDeclarations(text).map((d) => ({ ...d, file, inComponent: false }))),
    ...sources('.jsx').flatMap(({ file, text }) => inlineStyleDeclarations(text).map((d) => ({ ...d, file, inComponent: true }))),
  ]
}

const describeDeclaration = (d) => `${d.file}:${d.line} ${d.inComponent ? d.where : `${d.where} { ${d.property}: ${d.value} }`}`

/**
 * Compares the physical declarations with the exceptions. `fresh`: physical and not listed. `gone`: listed, and no declaration
 * matches it any more. An exception matches the declarations of one file, one selector (or one line of a component) and one property.
 */
function checkPhysical(declarations, exceptions) {
  const physical = declarations.filter((d) => isPhysical(d.property, d.value))
  const keyOf = (file, where, property) => JSON.stringify([file, where, property])
  const listed = new Set(exceptions.map((e) => keyOf(e.file, e.selector ?? e.context, e.property)))
  const seen = new Set(physical.map((d) => keyOf(d.file, d.where, d.property)))
  return {
    fresh: physical.filter((d) => !listed.has(keyOf(d.file, d.where, d.property))),
    gone: exceptions.filter((e) => !seen.has(keyOf(e.file, e.selector ?? e.context, e.property))),
  }
}

/**
 * Compares the literals of each file with its budget (0 for a file that is not in it). Returns the messages of what is wrong: a file
 * above its budget (with the declarations of the file that hold a literal), and a file below it (with the number to lower it to).
 */
function checkBudget(declarations, budget) {
  const byFile = new Map()
  for (const d of declarations) {
    const count = literalCount(d.property, d.value, d.inComponent)
    if (!count) continue
    const entry = byFile.get(d.file) ?? { count: 0, held: [] }
    entry.count += count
    entry.held.push({ ...d, count })
    byFile.set(d.file, entry)
  }
  const problems = []
  for (const file of [...new Set([...byFile.keys(), ...Object.keys(budget)])].sort()) {
    const counted = byFile.get(file)?.count ?? 0
    const allowed = budget[file] ?? 0
    if (counted > allowed) {
      const held = byFile.get(file).held.map((d) => `    ${describeDeclaration(d)}  (${d.count})`).join('\n')
      problems.push(
        `${file} has ${counted} hard-coded px/rem values in spacing, radius or font size, the budget is ${allowed}: ${counted - allowed} too many. ` +
          `A new one is a declaration added with a literal in it (git diff -U0 -- ${file} shows it). The declarations that hold a literal:\n${held}`,
      )
    } else if (counted < allowed) {
      problems.push(
        counted === 0
          ? `${file} has no hard-coded values left: remove its entry from literalBudget in tests/design-budget.json (it was ${allowed}).`
          : `${file} has ${counted} hard-coded values, the budget is ${allowed}: lower the budget for ${file} to ${counted}.`,
      )
    }
  }
  return problems
}

const BUDGET_FILE = path.join(ROOT, 'tests', 'design-budget.json')
const budgetFile = () => JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'))

// ---- the rules, on the project ------------------------------------------------------------------------------------------

describe('R1: logical properties', () => {
  const { physicalExceptions } = budgetFile()
  const declarations = projectDeclarations()
  const { fresh, gone } = checkPhysical(declarations, physicalExceptions)

  it('the scan reads the stylesheets and the components', () => {
    expect(declarations.filter((d) => !d.inComponent).length).toBeGreaterThan(500)
    expect(declarations.filter((d) => d.inComponent).length).toBeGreaterThan(20)
  })

  it('no physical property (left or right) is used, except the ones listed in tests/design-budget.json with a reason', () => {
    const lines = fresh.map((d) => `${describeDeclaration(d)}\n    use the logical property (margin-inline-start, padding-inline, inset-inline-end, text-align: start, ...), or, if the physical side is right, list it in physicalExceptions of tests/design-budget.json with the reason`)
    expect(lines, `physical properties:\n${lines.join('\n')}`).toEqual([])
  })

  it('every exception is still in the code (a stale entry is removed)', () => {
    const lines = gone.map((e) => `${e.file} ${e.selector ?? e.context} ${e.property}\n    the declaration is gone or changed: remove this entry from physicalExceptions of tests/design-budget.json (or correct it, if the declaration only moved)`)
    expect(lines, `exceptions in tests/design-budget.json that no declaration matches any more:\n${lines.join('\n')}`).toEqual([])
  })

  it('every exception names its place and its reason, once', () => {
    const keys = new Set()
    for (const e of physicalExceptions) {
      expect(Object.keys(e).sort(), JSON.stringify(e)).toEqual([e.context === undefined ? 'selector' : 'context', 'file', 'property', 'reason'].sort())
      for (const field of Object.keys(e)) expect(typeof e[field] === 'string' && e[field].trim().length > 0, `${field} of ${JSON.stringify(e)}`).toBe(true)
      expect(e.reason.trim().length, `the reason of ${e.file} ${e.selector ?? e.context} ${e.property} says why`).toBeGreaterThan(30)
      const key = JSON.stringify([e.file, e.selector ?? e.context, e.property])
      expect(keys.has(key), `${key} is listed twice`).toBe(false)
      keys.add(key)
    }
  })
})

describe('V1: hard-coded values only go down', () => {
  const { literalBudget } = budgetFile()
  const problems = checkBudget(projectDeclarations(), literalBudget)

  it('the budget names files that exist, with whole numbers above 0', () => {
    const files = new Set([...sources('.css'), ...sources('.jsx')].map((s) => s.file))
    for (const [file, count] of Object.entries(literalBudget)) {
      expect(files.has(file), `${file} is in literalBudget and is not a stylesheet or a component of src/`).toBe(true)
      expect(Number.isInteger(count) && count > 0, `${file}: ${count}`).toBe(true)
    }
  })

  it('no file has more hard-coded px or rem values (spacing, radius, font size) than its budget, and none has fewer', () => {
    expect(problems, `\n${problems.join('\n')}`).toEqual([])
  })
})

describe('V1: a size that has a token is written as the token', () => {
  const declarations = projectDeclarations()
  const { tokens, problems: definitions } = readSizeTokens(declarations)
  const problems = checkTokens(declarations, tokens)

  it(`${TOKEN_FILE} defines the spacing, radius and font-size tokens, each size once, and nothing else defines one`, () => {
    for (const family of Object.keys(tokens)) expect(tokens[family].size, `the ${family} tokens of ${TOKEN_FILE}`).toBeGreaterThan(0)
    expect(definitions, `\n${definitions.join('\n')}`).toEqual([])
  })

  it('no spacing, radius or font size is a literal of a size that has a token', () => {
    expect(problems, `\nThese sizes have a token (defined in ${TOKEN_FILE}); write the token, the value is the same:\n${problems.join('\n')}`).toEqual([])
  })
})

describe('Reset: a reset of the margin, padding or border has no specificity', () => {
  const declarations = projectDeclarations()

  it('the scan finds the reset of the headings and paragraphs, and it has no specificity', () => {
    const selectors = declarations
      .filter((d) => !d.inComponent && d.property === 'margin')
      .flatMap((d) => splitTop(d.where, /,/).map((part) => part.text))
      .filter(isReset)
    expect(selectors.length, 'a rule that resets the margin under the roots of the apps').toBeGreaterThan(0)
    for (const selector of selectors) expect(readSelector(selector).specificity, selector).toEqual([0, 0, 0])
  })

  it('no rule that sets the margin, padding or border of a type of element under the roots of the apps outranks a class', () => {
    const lines = checkResets(declarations).map(
      (r) =>
        `${r.file}:${r.line} ${r.selector} { ${r.properties.join(', ')} }\n    its specificity is ${showSpecificity(r.specificity)}, so it beats a rule of one class (0,1,0) and cancels the margin, padding or border that a class gives to the same element: ` +
        'write the roots in :where(), as :where(.w-app, .a-app) :where(h1, h2, h3, p) does (src/ui/ui.css)',
    )
    expect(lines, `\n${lines.join('\n')}`).toEqual([])
  })
})

// ---- the scanner, on small cases ----------------------------------------------------------------------------------------

describe('the scanner itself', () => {
  const css = (source) => cssDeclarations(source)
  const physical = (source) => css(source).filter((d) => isPhysical(d.property, d.value)).map((d) => `${d.where} ${d.property}`)

  it('reads a declaration with its selector, its line and through comments, at-rules and a data address', () => {
    const found = css(`/* margin-left: 1px; */
.a, .b:hover {
  color: red; /* a note; with a semicolon */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='x' viewBox='0 0 1 1'%3E;{x}%3C/svg%3E");
}
@media (min-width: 640px) { .c { padding-left: 2px } }
@keyframes spin { to { transform: none; } }
@page { margin: 10mm; }`)
    expect(found.map((d) => [d.where, d.property, d.line])).toEqual([
      ['.a, .b:hover', 'color', 3],
      ['.a, .b:hover', 'background-image', 4],
      ['.c', 'padding-left', 6],
      ['to', 'transform', 7],
      ['@page', 'margin', 8],
    ])
  })

  it('flags a physical side, in every form it takes', () => {
    expect(
      physical(`.x { margin-left: 3px; margin-right: 0; padding-left: 1px; padding-right: 1px; left: 0; right: 4px; float: left; clear: right;
        border-left: 1px solid red; border-right-color: red; border-top-left-radius: 4px; text-align: left; text-align: right !important;
        background-position: left 12px center; background-position-x: right; transform-origin: top left; padding: 1px 2px 3px 4px; margin: 0 0 0 8px; inset: 0 1px 0 0 }`).length,
    ).toBe(19)
  })

  it('does not flag the logical forms, the vertical sides or a symmetric shorthand', () => {
    expect(
      physical(`.x { margin-inline-start: 3px; padding-inline: 1px 2px; inset-inline-end: 0; inset: 0; text-align: start; text-align: center; float: inline-start;
        border-inline-start: 1px solid red; border-start-start-radius: 4px; border-top: 1px solid; margin-top: 2px; padding-bottom: 3px; top: 0; bottom: 0;
        padding: 1px 2px; padding: 1px 2px 3px; padding: 1px 2px 3px 2px; margin: 0 auto; margin: 16px auto 0; background-position: center; --x-left: 4px;
        padding: max(24px, env(safe-area-inset-bottom)) 20px; background-image: url(left.svg) }`),
    ).toEqual([])
  })

  it('reads the inline styles of a component, and flags a physical key or a physical value', () => {
    const source = `const a = <p style={{ marginLeft: 4, textAlign: dir === 'rtl' ? 'right' : 'start', '--gap': '8px', ...rest }}>x</p>
const b = <i
  style={{
    paddingRight: 2, padding: '1px 2px 3px 4px', fontSize: '1.375rem',
  }}
/>`
    const found = inlineStyleDeclarations(source)
    expect(found.map((d) => [d.line, d.property])).toEqual([[1, 'margin-left'], [1, 'text-align'], [4, 'padding-right'], [4, 'padding'], [4, 'font-size']])
    expect(found.filter((d) => isPhysical(d.property, d.value)).map((d) => d.property)).toEqual(['margin-left', 'text-align', 'padding-right', 'padding'])
    expect(found[0].where).toBe(`const a = <p style={{ marginLeft: 4, textAlign: dir === 'rtl' ? 'right' : 'start', '--gap': '8px', ...rest }}>x</p>`)
  })

  it('counts px and rem literals of spacing, radius and font size, and nothing else', () => {
    const count = (source) => css(source).reduce((sum, d) => sum + literalCount(d.property, d.value, false), 0)
    expect(count('.x { padding: 12px 18px; margin-block: -9px 0; gap: 0.5rem; border-radius: 24px 24px 0 0; font-size: 1.0625rem; inset-block-start: 4px; top: 2px }')).toBe(9)
    expect(count('.x { padding-inline: max(20px, env(safe-area-inset-left)); margin: var(--a, 8px) }')).toBe(2)
    expect(count('.x { --space: 8px; width: 44px; min-height: 56px; border: 1px solid; line-height: 1.5; margin: 0; padding: 1em; margin-block: auto; font-size: var(--size) }')).toBe(0)
  })

  it('counts the numbers of a component that React reads as px, and not a zero', () => {
    const count = (source) => inlineStyleDeclarations(source).reduce((sum, d) => sum + literalCount(d.property, d.value, true), 0)
    expect(count(`<p style={{ marginBlockStart: 8, padding: 0, margin: 0, gap: 0, fontSize: '1.375rem', marginBlock: '6px 12px', margin: '16px auto 0', width: 24, lineHeight: 1.5 }} />`)).toBe(5)
    expect(count(`<p style={{ padding: big ? 8 : 12, borderWidth: 3, flex: 1 }} />`)).toBe(2)
  })

  it('reads the size tokens, and refuses a definition that is not one scale', () => {
    const read = (source, file = TOKEN_FILE) => readSizeTokens(css(source).map((d) => ({ ...d, file, inComponent: false })))
    const base = read(':root { --w-space-2: 8px; --w-space-1-5: 6px; --w-radius-md: 14px; --w-font-sm: 0.875rem; --w-weight-bold: 700; --w-bg: #fff }')
    expect(base.problems).toEqual([])
    expect(Object.fromEntries(Object.entries(base.tokens).map(([family, sizes]) => [family, [...sizes]]))).toEqual({
      space: [['8px', '--w-space-2'], ['6px', '--w-space-1-5']],
      radius: [['14px', '--w-radius-md']],
      font: [['0.875rem', '--w-font-sm']],
    })
    expect(read(':root { --w-space-2: 8px; --w-space-two: 8.0px }').problems).toEqual(['--w-space-two and --w-space-2 are both 8px: a size has one token, so that a literal can be told which one to use'])
    expect(read(':root { --w-space-9: calc(8px + 1px); --w-font-x: 1em }').problems).toHaveLength(2)
    expect(read(':root { --w-radius-md: 14px }', 'src/ui/ui.css').problems[0]).toContain(`a size token is defined in ${TOKEN_FILE} only`)
  })

  it('finds a literal that has a token, in its family, in a stylesheet and in a component, and names the token', () => {
    const { tokens } = readSizeTokens(css(':root { --w-space-2: 8px; --w-space-1-5: 6px; --w-radius-md: 14px; --w-font-sm: 0.875rem }').map((d) => ({ ...d, file: TOKEN_FILE, inComponent: false })))
    const inStylesheet = (source) => checkTokens(css(source).map((d) => ({ ...d, file: 'src/x.css', inComponent: false })), tokens)
    const inComponent = (source) => checkTokens(inlineStyleDeclarations(source).map((d) => ({ ...d, file: 'src/X.jsx', inComponent: true })), tokens)

    const found = inStylesheet('.x { padding: 8px 9px 6px; margin-inline: -8px 0; border-radius: 14px; font-size: 0.875rem }')
    expect(found).toHaveLength(5)
    expect(found[0]).toBe('src/x.css:1 .x { padding: 8px 9px 6px }\n    8px is the size of --w-space-2: write var(--w-space-2)')
    expect(found[1]).toContain('6px is the size of --w-space-1-5: write var(--w-space-1-5)')
    expect(found[2]).toContain('-8px is the size of --w-space-2: write calc(-1 * var(--w-space-2))')
    expect(found[3]).toContain('14px is the size of --w-radius-md: write var(--w-radius-md)')
    expect(found[4]).toContain('0.875rem is the size of --w-font-sm: write var(--w-font-sm)')

    expect(inStylesheet('.x { padding-inline: max(8px, env(safe-area-inset-left)); margin: var(--a, 8px) }')).toHaveLength(2)
    // a size belongs to its family: 14px is a radius token here and not a spacing or a font one, 8px is not a radius, 14px is not 0.875rem
    expect(inStylesheet('.x { padding: 14px; border-radius: 8px; font-size: 14px; gap: 9px; margin: 0 }')).toEqual([])
    // not a spacing, radius or font-size declaration, or the definition of a token
    expect(inStylesheet('.x { --gap: 8px; width: 8px; border: 8px solid; line-height: 8px; font-family: x }')).toEqual([])

    const component = inComponent(`<p style={{ padding: 8, marginBlock: '6px 9px', marginBlockStart: -8, fontSize: '0.875rem', borderRadius: 14, lineHeight: 8, width: 8 }} />`)
    expect(component).toHaveLength(5)
    expect(component[0]).toContain("8px is the size of --w-space-2: write 'var(--w-space-2)'")
    expect(component[1]).toContain("6px is the size of --w-space-1-5: write 'var(--w-space-1-5)'")
    expect(component[2]).toContain("-8px is the size of --w-space-2: write 'calc(-1 * var(--w-space-2))'")
    expect(component[3]).toContain("write 'var(--w-font-sm)'")
    expect(component[4]).toContain("write 'var(--w-radius-md)'")
    expect(inComponent(`<p style={{ padding: 'var(--w-space-2)', marginBlock: 'var(--w-space-1-5) 9px', fontSize: fs, margin: 0 }} />`)).toEqual([])
  })

  it('compares a file with its budget on both sides', () => {
    const declarations = css('.x { padding: 1px 2px; margin: 3px }').map((d) => ({ ...d, file: 'src/x.css', inComponent: false }))
    expect(checkBudget(declarations, { 'src/x.css': 3 })).toEqual([])
    expect(checkBudget(declarations, { 'src/x.css': 4 })).toEqual(['src/x.css has 3 hard-coded values, the budget is 4: lower the budget for src/x.css to 3.'])
    expect(checkBudget(declarations, { 'src/x.css': 2 })[0]).toMatch(/^src\/x\.css has 3 hard-coded px\/rem values .* the budget is 2: 1 too many\./)
    expect(checkBudget(declarations, { 'src/x.css': 2 })[0]).toContain('src/x.css:1 .x { margin: 3px }  (1)')
    expect(checkBudget(declarations, {})[0]).toContain('the budget is 0: 3 too many')
    expect(checkBudget([], { 'src/x.css': 1 })).toEqual(['src/x.css has no hard-coded values left: remove its entry from literalBudget in tests/design-budget.json (it was 1).'])
  })

  it('matches an exception exactly: file, selector, property', () => {
    const declarations = css('.x { margin-left: 1px }\n.y { margin-left: 1px }').map((d) => ({ ...d, file: 'src/x.css', inComponent: false }))
    const exception = (over = {}) => ({ file: 'src/x.css', selector: '.x', property: 'margin-left', reason: 'a reason', ...over })
    expect(checkPhysical(declarations, [exception()]).fresh.map((d) => d.where)).toEqual(['.y'])
    expect(checkPhysical(declarations, [exception(), exception({ selector: '.y' })])).toMatchObject({ fresh: [], gone: [] })
    expect(checkPhysical(declarations, [exception({ property: 'margin-right' })]).gone).toHaveLength(1)
    expect(checkPhysical(declarations, [exception({ file: 'src/other.css' })]).fresh).toHaveLength(2)
    expect(checkPhysical([], [exception()]).gone).toHaveLength(1)
  })

  it('computes the specificity of a selector, with :where() counting nothing', () => {
    const of = (selector) => readSelector(selector).specificity
    expect(of('p')).toEqual([0, 0, 1])
    expect(of('.w-app p')).toEqual([0, 1, 1])
    expect(of('.a-hero .a-hero__range')).toEqual([0, 2, 0])
    expect(of('.a-hero__range')).toEqual([0, 1, 0])
    expect(of('#root .x a:hover')).toEqual([1, 2, 1])
    expect(of('input[type="text"]::placeholder')).toEqual([0, 1, 2])
    expect(of('.x::before')).toEqual([0, 1, 1])
    expect(of('.a:not(.b, #c) > li')).toEqual([1, 1, 1])
    expect(of(':is(.a, p) span')).toEqual([0, 1, 1])
    expect(of('.w-app *')).toEqual([0, 1, 0])
    expect(of(':where(.w-app, .a-app) :where(h1, h2, h3, p)')).toEqual([0, 0, 0])
    expect(of(':where(.w-app, .a-app) :where(button, select)')).toEqual([0, 0, 0])
    expect(of(':where(.w-app) p')).toEqual([0, 0, 1])
    expect(of('.w-app :where(p)')).toEqual([0, 1, 0])
  })

  it('tells a reset (the roots of the apps and types) from a rule of a component or of a class', () => {
    expect(isReset('.w-app h1')).toBe(true)
    expect(isReset('.a-app p')).toBe(true)
    expect(isReset('.w-app > ul')).toBe(true)
    expect(isReset('.w-app *')).toBe(true)
    expect(isReset(':where(.w-app, .a-app) :where(h1, h2, h3, p)')).toBe(true)
    expect(isReset('.a-head p')).toBe(false) // a class of a component
    expect(isReset('.a-app .a-head p')).toBe(false)
    expect(isReset('.w-app')).toBe(false) // the root itself is a class rule, not a reset of a type
    expect(isReset('.w-app p:first-child')).toBe(false) // a pseudo-class makes it a rule of its own
    expect(isReset('.w-app a[href]')).toBe(false)
    expect(isReset('.w-note')).toBe(false)
    expect(isReset('p')).toBe(false) // no root: not scoped to an app
  })

  it('flags a reset that has the specificity of a class, and passes one that has none', () => {
    const resets = (source) => checkResets(css(source).map((d) => ({ ...d, file: 'src/x.css', inComponent: false })))
    // the reset as it was: three selectors, each reported once with the three properties it sets
    const old = resets('.w-app h1, .w-app h2, .a-app p { margin: 0; padding: 0; border: 0 }')
    expect(old.map((r) => r.selector)).toEqual(['.w-app h1', '.w-app h2', '.a-app p'])
    expect(old[0]).toMatchObject({ file: 'src/x.css', line: 1, properties: ['margin', 'padding', 'border'], specificity: [0, 1, 1] })
    // the same reset in :where(), or with a type only: less than a class
    expect(resets(':where(.w-app, .a-app) :where(h1, h2, h3, p) { margin: 0; padding: 0; border: 0 }')).toEqual([])
    expect(resets(':where(.w-app, .a-app) h1 { margin: 0 }')).toEqual([])
    // a root outside :where(), a rule in @media, the universal selector and a longhand of the edge are all caught
    expect(resets('.w-app :where(h1, p) { margin-block-start: 0 }')).toHaveLength(1)
    expect(resets('@media (min-width: 640px) { .a-app ul { padding-inline: 0 } }')).toHaveLength(1)
    expect(resets('.a-app * { border-block-end-width: 0 }')).toHaveLength(1)
    // not a reset, or not a property that a reset zeroes
    expect(resets('.a-head p { margin-block-start: 4px }')).toEqual([])
    expect(resets('.w-app { padding-left: 4px }')).toEqual([])
    expect(resets('.w-app p { color: red; border-radius: 4px; font: inherit; border-collapse: collapse }')).toEqual([])
    expect(resets('.w-app p:first-child { margin: 0 }')).toEqual([])
  })
})
