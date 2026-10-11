// Two design rules, checked on the stylesheets (src/**/*.css) and on the inline styles of the components (`style={{ ... }}` in
// src/**/*.jsx). The rule ids are the ones of docs/design.md.
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
// V1  Hard-coded values. Spacing (margin, padding, gap, inset, top, bottom, left, right), border radius and font size are written as
//     px or rem literals today. Tokens for them (a spacing scale, radii, font sizes, like the colour and weight tokens of src/ui/ui.css)
//     are planned. Until they exist the count of literals may only go DOWN: tests/design-budget.json holds the count of each file under
//     `literalBudget`, and this test fails on both sides of it. Above the budget, a declaration was added with a literal in it: use a token
//     when there is one, and until then reuse the value of a neighbour or leave it out. Below the budget, a literal was removed:
//     the test says what to lower the budget to, so that the new count is the ceiling (a ratchet). Raising a budget is a decision of the
//     owner and a P1 finding in the code review (Code Review Rules of AGENTS.md), never a way to get the test green. A file that is not
//     in the budget has a budget of 0. What is counted: a px or rem literal in a spacing, radius or font-size declaration, outside a
//     custom property (`--x: 8px` is the definition of a token), and in a component the numbers that React reads as px (`padding: 8`) and
//     the px and rem strings (`'6px 12px'`); a 0 is not a literal. A literal inside calc(), max() or var(--x, 8px) counts.
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

/** The properties whose px and rem literals are counted: spacing, border radius, font size. */
const COUNTED = [
  /^(margin|padding)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/,
  /^(gap|row-gap|column-gap)$/,
  /^inset(-(block|inline|block-start|block-end|inline-start|inline-end))?$/,
  /^(top|bottom|left|right)$/,
  /^border-radius$/,
  /^border-(start|end)-(start|end)-radius$/,
  /^border-(top|bottom)-(left|right)-radius$/,
  /^font-size$/,
]
const isCounted = (property) => COUNTED.some((pattern) => pattern.test(property))

const LITERAL = /(?<![\w.$])-?(?:\d+\.?\d*|\.\d+)(?:px|rem)\b/gi

/** How many hard-coded values this declaration holds. In a stylesheet only px and rem count; in a component a bare number is px too. */
function literalCount(property, value, inComponent) {
  if (!isCounted(property)) return 0
  let count = [...value.matchAll(LITERAL)].length
  if (inComponent) {
    const outsideStrings = value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, ' ')
    count += [...outsideStrings.matchAll(/(?<![\w.$])-?(?:\d+\.?\d*|\.\d+)(?![\w.])/g)].filter((m) => Number(m[0]) !== 0).length
  }
  return count
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
})
