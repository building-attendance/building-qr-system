// The agent loop (.github/workflows/claude.yml) never changes the project's rules: AGENTS.md and CLAUDE.md, the
// AGENTS.override.md that Codex reads in place of the AGENTS.md of its folder, and the lower-case names that a file system
// which ignores case (Windows, macOS) finds for them. Two places say so: the tools that edit a file are denied on those
// names, and the job `check` refuses a run that touched one. The workflow is read as text: nothing here runs it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// with LF line ends, as git holds it (a Windows checkout may have CRLF)
const workflow = fs.readFileSync(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const NAMES = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'agents.md', 'agents.override.md', 'claude.md']

describe('the rules files in the agent loop', () => {
  it('denies Edit, Write and MultiEdit on every name, at the root and at any depth', () => {
    const lists = [...workflow.matchAll(/--disallowedTools "([^"]*)"/g)].map((match) => match[1].split(','))
    expect(lists).toHaveLength(1)
    const [denied] = lists
    for (const name of NAMES) {
      for (const tool of ['Edit', 'Write', 'MultiEdit']) {
        for (const where of ['./', './**/']) expect(denied).toContain(`${tool}(${where}${name})`)
      }
    }
  })

  it('has the check after the run refuse the three names in any case, at any depth', () => {
    const body = /protected\(\) \{\n([\s\S]*?)\n {10}\}\n/.exec(workflow)?.[1]
    expect(body).toBeDefined()
    // the file name only (any folder), in lower case
    expect(body).toContain(`case "$(printf '%s' "\${1##*/}" | tr '[:upper:]' '[:lower:]')" in`)
    expect(body).toMatch(/^\s*agents\.md\|agents\.override\.md\|claude\.md\) return 0 ;;$/m)
  })
})
