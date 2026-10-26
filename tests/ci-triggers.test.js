// The four checks that .github/rulesets/master-gates.json requires, and the events that run them. GitHub counts a check
// that was skipped as passed, so the workflow that runs on an edit of a pull request's title, description or labels
// (guards.yml) holds only `guards`, which it never skips, and the tests (ci.yml) run only for a change of the code. The
// header of guards.yml says why. The workflows are read as text: nothing here runs them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// with LF line ends, as git holds them (a Windows checkout may have CRLF)
const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const DIR = '.github/workflows'
const FILES = fs.readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((file) => /\.ya?ml$/.test(file))

const gates = JSON.parse(read('.github/rulesets/master-gates.json'))
const REQUIRED = gates.rules.find((rule) => rule.type === 'required_status_checks').parameters.required_status_checks.map(
  (check) => check.context,
)

/** The lines of a top-level key (`on:`, `jobs:`), up to the next one. */
function section(text, key) {
  const lines = text.split('\n')
  const start = lines.indexOf(`${key}:`)
  if (start === -1) return []
  const end = lines.findIndex((line, i) => i > start && /^[^\s#]/.test(line))
  return lines.slice(start + 1, end === -1 ? lines.length : end)
}

/** Each job of a workflow: its id, the name of its check (its `name:`, or its id), and its own lines. */
function jobs(text) {
  const result = []
  for (const line of section(text, 'jobs')) {
    const id = /^ {2}([\w-]+):\s*$/.exec(line)?.[1]
    if (id) result.push({ id, lines: [] })
    else if (result.length) result[result.length - 1].lines.push(line)
  }
  return result.map(({ id, lines }) => {
    const name = lines.map((line) => /^ {4}name: (.+)$/.exec(line)?.[1]).find(Boolean)
    return { id, check: (name ?? id).replace(/^(['"])(.*)\1$/, '$2'), lines }
  })
}

/** The types of the pull_request trigger, as written in the `on:` block. */
function pullRequestTypes(text) {
  const on = section(text, 'on').join('\n')
  return /\n? {2}pull_request:\n(?: {4}.*\n)*? {4}types: \[([^\]]*)\]/.exec(`${on}\n`)?.[1].split(/,\s*/)
}

const workflow = (file) => read(`${DIR}/${file}`)

describe('the required checks and their triggers', () => {
  it('reads four required checks from the rulesets', () => {
    expect(REQUIRED).toEqual(['guards', 'unit', 'e2e (android-chrome)', 'e2e (iphone-webkit)'])
  })

  it('has each required check as one job of one workflow: guards in guards.yml, the tests in ci.yml', () => {
    for (const check of REQUIRED) {
      const owners = FILES.flatMap((file) => jobs(workflow(file)).filter((job) => job.check === check).map(() => file))
      expect(owners, check).toEqual([check === 'guards' ? 'guards.yml' : 'ci.yml'])
    }
  })

  it('runs the tests only for a change of the code, never for an edit, a label or a base branch', () => {
    expect(pullRequestTypes(workflow('ci.yml'))).toEqual(['opened', 'synchronize', 'reopened'])
  })

  it('runs guards for a change of the code and for each event that changes the title, the description or the labels', () => {
    expect(pullRequestTypes(workflow('guards.yml'))).toEqual(['opened', 'synchronize', 'reopened', 'edited', 'labeled', 'unlabeled'])
  })

  it('has guards as the only job of guards.yml, with nothing that skips it or lets it fail', () => {
    const all = jobs(workflow('guards.yml'))
    expect(all.map((job) => job.id)).toEqual(['guards'])
    const own = all[0].lines.filter((line) => /^ {4}\S/.test(line))
    expect(own.filter((line) => /^ {4}(if|continue-on-error|needs):/.test(line))).toEqual([])
  })

  it('starts both workflows on the same pushes, merge groups and manual runs', () => {
    const rest = (file) => section(workflow(file), 'on').filter((line) => !/^\s*#/.test(line)).join('\n').replace(/^ {2}pull_request:\n(?: {4}.*\n)*/m, '')
    expect(rest('guards.yml')).toBe(rest('ci.yml'))
    expect(rest('ci.yml')).toMatch(/^ {2}push:$/m)
    expect(rest('ci.yml')).toMatch(/^ {2}merge_group:$/m)
  })

  it('keeps the two workflows in concurrency groups of their own, so an edit never cancels the tests', () => {
    const group = (file) => /^concurrency:\n {2}group: (.+)$/m.exec(workflow(file))?.[1]
    expect(group('ci.yml')).toBe('ci-${{ github.ref }}')
    expect(group('guards.yml')).toBe('guards-${{ github.ref }}')
  })
})
