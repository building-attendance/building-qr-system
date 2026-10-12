// @vitest-environment jsdom
// The short guide, a screen of its own ("איך עובדים עם המערכת": src/admin/views/HelpView.jsx, its text in src/admin/help.js): an <h1>,
// then flat <h2> topics, all of them on the screen at once, in Hebrew, short, and in the names that the screens use. The real screen,
// and the real settings screen to prove that the guide is no longer a section of it (it was a section that a button opened, in the
// screen that held the members, the building and the audit log), with the network (`adminApi`) answered by the test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, within, cleanup } from '@testing-library/react'
import HelpView from '../../src/admin/views/HelpView.jsx'
import SettingsView from '../../src/admin/views/SettingsView.jsx'
import { HELP_TOPICS, HELP_MAX_LENGTH } from '../../src/admin/help.js'
import { ToastProvider, ConfirmProvider } from '../../src/admin/ui.jsx'
import { adminApi } from '../../src/admin/api.js'
import { EM_DASH } from '../../scripts/text-rules.mjs'

vi.mock('../../src/api/client.js', () => ({ api: vi.fn() }))
vi.mock('../../src/admin/api.js', async (importOriginal) => ({ ...(await importOriginal()), adminApi: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const TITLE = 'איך עובדים עם המערכת'
// The topics, in the order of the screen: the names that the owner chose.
const TOPICS = [
  'נקודות ושלטי QR',
  'נותני שירות והטלפונים שלהם',
  "היסטוריה ו'לא נקלטו'",
  "האייג'נט",
  'יומן הפעולות',
  'כשמגיעה התראה',
  'כשטלפון תקוע',
]

const topics = () => screen.queryAllByRole('heading', { level: 2 })
/** Everything that a person can read on the screen: its heading and the topics. */
const readable = () => document.body.textContent
const mount = () => render(<HelpView />)

describe('the screen', () => {
  it('has the guide as its one <h1>, and shows every topic at once: nothing opens or closes', () => {
    mount()
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([TITLE])
    expect(topics()).toHaveLength(HELP_TOPICS.length)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('[aria-expanded], [hidden]')).toBeNull()
  })

  it('has no action in it: no button and no link', () => {
    mount()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('the topics', () => {
  it('has a heading for every topic, flat (<h2>, under the <h1>), in the order of the screen, and nothing else', () => {
    mount()
    expect(topics().map((h) => h.textContent)).toEqual(TOPICS)
    expect(topics()).toHaveLength(HELP_TOPICS.length)
    expect(screen.queryAllByRole('heading').filter((h) => !['H1', 'H2'].includes(h.tagName))).toHaveLength(0) // no heading of another level
  })

  it('has under each heading its sentences, as text', () => {
    mount()
    for (const topic of HELP_TOPICS) {
      const text = screen.getByText(topic.text)
      expect(text.tagName).toBe('P')
      const heading = screen.getByRole('heading', { level: 2, name: topic.title })
      expect(heading.nextElementSibling).toBe(text)
    }
  })

  it('is two to four short sentences for each topic', () => {
    for (const { title, text } of HELP_TOPICS) {
      const sentences = text.split(/[.!?](?=\s|$)/).map((s) => s.trim()).filter(Boolean)
      expect(sentences.length, `${title}: sentences`).toBeGreaterThanOrEqual(2)
      expect(sentences.length, `${title}: sentences`).toBeLessThanOrEqual(4)
      for (const s of sentences) expect(s.length, `${title}: a sentence of ${s.length} characters: ${s}`).toBeLessThanOrEqual(160)
    }
  })

  it('is short: everything that a person can read on the screen is within the limit (about 3,000 characters)', () => {
    expect(HELP_MAX_LENGTH, 'the limit was not raised').toBeLessThanOrEqual(3000)
    mount()
    expect(readable().length).toBeLessThanOrEqual(HELP_MAX_LENGTH)
    expect(readable().length, 'and it says something').toBeGreaterThan(800)
  })

  it('has no em dash and no stray markup', () => {
    mount()
    expect(readable()).not.toContain(EM_DASH)
    expect(JSON.stringify(HELP_TOPICS)).not.toContain(EM_DASH)
    expect(readable()).not.toMatch(/[<>{}]/)
  })

  it('is plain text: the sentences make no element, whatever they hold', () => {
    const { container } = mount()
    expect(container.querySelectorAll('*:not(div):not(h1):not(h2):not(p)')).toHaveLength(0)
  })

  it('is in Hebrew', () => {
    for (const { title, text } of HELP_TOPICS) {
      expect(title, 'a title in Hebrew').toMatch(/[֐-׿]/)
      expect(text, `${title}: text in Hebrew`).toMatch(/[֐-׿]/)
    }
  })

  it('says where the screens under "עוד" are on a phone', () => {
    const text = HELP_TOPICS.map((t) => t.text).join(' ')
    expect(text).toContain('בטלפון: "עוד" ואז "אייג׳נט"')
    expect(text).toContain('בטלפון: "עוד" ואז "יומן פעולות"')
    expect(text).not.toContain('"ועד"') // the screen of that name is gone
  })
})

describe('the names that the guide quotes', () => {
  // A name between double quotes is a button, a tab or a field of the committee app. The guide is only useful if the name is
  // there on a screen, so each one must be written in the source of the committee app, as a text of its own (between quotes,
  // or between the tags of an element). A screen that renames a button fails here until the guide says the new name.
  const source = (() => {
    const files = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(js|jsx)$/.test(entry.name) && entry.name !== 'help.js') files.push(full)
      }
    }
    walk(path.join(process.cwd(), 'src', 'admin'))
    files.push(path.join(process.cwd(), 'src', 'pages', 'AdminApp.jsx'))
    return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  })()
  const quoted = [...new Set(HELP_TOPICS.flatMap(({ text }) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1])))]
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  it('finds the quoted names at all (the check is not empty)', () => {
    expect(quoted.length).toBeGreaterThan(15)
    for (const name of ['נקודה חדשה', 'הדפסת שלט', 'מכשירים', 'יומן פעולות', 'לא נקלטו', 'עוד']) expect(quoted).toContain(name)
  })

  it.each(quoted)('"%s" is written on a screen of the committee app', (name) => {
    expect(source, name).toMatch(new RegExp(`["'\`>]${escape(name)}["'\`<]`))
  })
})

describe('in the settings screen', () => {
  it('is not there any more: no button for the guide and none for the audit log, and the screen asks the server for the members and the building only', async () => {
    adminApi.mockImplementation(async (apiPath) => {
      if (apiPath === '/admins') return { admins: [] }
      if (apiPath === '/building') return { building: { address: '' } }
      throw new Error(`unexpected call ${apiPath}`)
    })
    render(<ToastProvider><ConfirmProvider><SettingsView admin={{ id: 'a1', name: 'Dana', email: 'dana@example.test' }} /></ConfirmProvider></ToastProvider>)
    await screen.findByLabelText('כתובת הבניין')
    expect(screen.queryByRole('button', { name: TITLE })).toBeNull()
    expect(screen.queryByRole('button', { name: 'יומן פעולות' })).toBeNull()
    expect(within(document.body).queryAllByRole('heading', { level: 3 })).toHaveLength(0) // the members' cards (none in this list) are its only <h3>
    expect(adminApi.mock.calls.map(([p]) => p).sort()).toEqual(['/admins', '/building'])
  })
})
