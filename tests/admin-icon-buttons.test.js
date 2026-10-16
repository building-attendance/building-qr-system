// Secondary actions in the committee app are shown as icons (IconButton). Red is only for removing something.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IconButton, AddButton } from '../src/admin/ui.jsx'
import { IconEdit } from '../src/admin/icons.jsx'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const views = fs.readdirSync(path.join(root, 'src', 'admin', 'views')).filter((f) => f.endsWith('.jsx'))
const read = (f) => fs.readFileSync(path.join(root, 'src', 'admin', 'views', f), 'utf8')
const html = (el) => renderToStaticMarkup(el)

describe('IconButton', () => {
  it('is a button with the label as its accessible name and its tooltip, and no visible text', () => {
    const out = html(React.createElement(IconButton, { icon: IconEdit, label: 'עריכה', onClick: () => {} }))
    expect(out).toContain('<button')
    expect(out).toContain('type="button"')
    expect(out).toContain('aria-label="עריכה"')
    expect(out).toContain('title="עריכה"')
    expect(out).toContain('class="a-icon-btn"')
    expect(out.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '')).toBe('') // nothing but the icon
  })

  it('has a link form for downloads', () => {
    const link = html(React.createElement(IconButton, { icon: IconEdit, label: 'ייצוא', href: '/x.csv', download: 'x.csv' }))
    expect(link).toContain('<a ')
    expect(link).toContain('href="/x.csv"')
    expect(link).toContain('download="x.csv"')
    expect(link).toContain('aria-label="ייצוא"')
  })

  it('passes disabled through', () => {
    expect(html(React.createElement(IconButton, { icon: IconEdit, label: 'x', disabled: true }))).toContain('disabled')
  })
})

describe('icon button styling', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'admin', 'admin.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('is grey, with no edge and no fill, and turns the palette blue on hover, press and focus', () => {
    const base = rule('.a-icon-btn')
    expect(base).toContain('background: none')
    expect(base).toContain('border: 0')
    expect(base).toContain('var(--w-text-2)')
    expect(css).toMatch(/\.a-icon-btn:hover:not\(:disabled\)\s*\{\s*color:\s*var\(--w-info\)/)
    expect(css).toMatch(/\.a-icon-btn:active:not\(:disabled\),\s*\.a-icon-btn:focus-visible\s*\{\s*color:\s*var\(--w-info\);\s*outline:\s*none/)
  })
})

describe('the account circle and the headings that have an add button', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'admin', 'admin.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('the account circle is the violet tint with its ink, not the solid primary (tests/contrast.test.js holds the pair to 4.5:1)', () => {
    const circle = rule('.a-avatar')
    expect(circle).toContain('background: var(--w-tint-violet)')
    expect(circle).toContain('color: var(--w-tint-violet-ink)')
    expect(circle).not.toContain('--w-primary')
    expect(circle).not.toContain('--w-on-primary')
  })

  it('it is a 44px disc, so the button stays a target of 44px (an image of the member can fill it later)', () => {
    const circle = rule('.a-avatar')
    expect(circle).toContain('width: 44px')
    expect(circle).toContain('height: 44px')
    expect(circle).toContain('border-radius: 50%')
  })

  it('under the pointer it shows a ring, and while its menu is open a stronger one (drawn inside: the focus ring outside it is the global one)', () => {
    expect(css).toMatch(/\.a-avatar--btn:hover\s*\{\s*box-shadow:\s*inset 0 0 0 2px var\(--w-info-line\)/)
    expect(css).toMatch(/\.a-avatar--btn\[aria-expanded='true'\]\s*\{\s*box-shadow:\s*inset 0 0 0 2px var\(--w-info\)/)
    expect(css, 'no state of the circle is the solid primary').not.toMatch(/\.a-avatar[^{]*\{[^}]*--w-primary/)
  })

  it('a heading with an add button puts its actions in a row under the text, on a phone and on a computer (no media query: the same layout)', () => {
    expect(rule('.a-head--add')).toContain('flex-direction: column')
    expect(rule('.a-head--add > :first-child'), 'the text is no longer a flexible column beside the actions').toContain('flex: none')
    // it is not the rule of one width: nothing of it is inside a media query, and no `row-reverse` reorders the pill away from the page order
    expect(css.match(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g)?.filter((block) => block.includes('.a-head--add')) ?? []).toEqual([])
    expect(css).not.toContain('row-reverse')
  })
})

describe('the same design on a phone and on a computer', () => {
  const app =fs.readFileSync(path.join(root, 'src', 'pages', 'AdminApp.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src', 'admin', 'admin.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('the provider-app link, the light / dark choice and the sign-out are one account menu, the same in the side rail and in the top bar', () => {
    expect(app.match(/<AccountMenu admin=\{admin\} onSignOut=\{signOut\} where="(rail|top)" \/>/g)).toHaveLength(2) // once in .a-side, once in .a-top
    expect(app).not.toContain('ShellTools') // the three icons are gone
    const menu = fs.readFileSync(path.join(root, 'src', 'admin', 'AccountMenu.jsx'), 'utf8')
    expect(menu).toContain('href="/"')
    expect(menu).toContain('אפליקציית נותני השירות')
    expect(menu).toContain('type="radio"') // the light / dark choice: a radio group
    expect(menu).toContain('<span>יציאה</span>')
  })

  it('the page icons are the same in the side rail and in the bottom bar, at the same size, and the sheet under "עוד" has them too', () => {
    // in the order of the source: the side rail, then the bar (whose fifth button, "עוד", is not a screen and has its own icon)
    const sizes = [...app.matchAll(/<NavItem [^\n]*className="(a-nav__item|a-tab)" size=\{(\d+)\}/g)].map((m) => `${m[1]}:${m[2]}`)
    expect(sizes).toEqual(['a-nav__item:24', 'a-tab:24'])
    expect(app).toContain('<IconMore size={24} />')
    expect(app).toContain('<t.icon size={22} />') // the rows of the sheet
    // one list of screens, with the icon of each, feeds all three: the rail shows both groups, the bar the work group, the sheet the rest
    expect(app).toContain('const WORK_TABS = TABS.filter(')
    expect(app).toContain('const MORE_TABS = TABS.filter(')
    expect(app).toContain('[WORK_TABS, MORE_TABS].map(')
    expect(app).toContain('WORK_TABS.map((t) => <NavItem')
    expect(app).toContain('MORE_TABS.map((t) => (')
  })

  it('the side rail keeps no text buttons for them (only the page links stay as rows)', () => {
    expect(app).not.toMatch(/className="a-nav__item" href=/)
    expect(app).not.toMatch(/<button className="a-nav__item" onClick=\{signOut\}/)
    const theme = fs.readFileSync(path.join(root, 'src', 'ui', 'ThemeSwitch.jsx'), 'utf8')
    expect(theme).not.toMatch(/variant/)
  })

  it('a date field stays inside its column, and always reads DD/MM/YYYY (the native date field did neither on iPhone)', () => {
    const rule = css.match(/\.a-input--date\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('min-width: 0')
    expect(rule).toContain('direction: ltr') // the digits run left to right, not jumbled by an RTL page
    expect(css).toMatch(/\.a-filters > \*\s*\{\s*min-width:\s*0/)
    expect(css).not.toContain("[type='date']") // no native date field is left to style
    for (const f of views) expect(read(f), `${f} uses a native date field`).not.toMatch(/type=["']date["']/)
  })
})

describe('the tiles and headers of the committee screens', () => {
  // The actions of a tile are the items of the "more" menu of its card, and those of a History row the items of the menu of that row
  // (`items={[ ... ]}` of a <Menu>, one item to a line).
  const menus = (f) => [...read(f).matchAll(/<Menu\b[\s\S]*?items=\{\[([\s\S]*?)\]\}/g)].map((m) => m[1])
  const itemsOf = (menu) => menu.split(/\r?\n/).filter((line) => /\{ label:/.test(line))

  it('red is used for exactly one thing, deleting, and every screen that lists things has it', () => {
    const uses = views.flatMap((f) =>
      menus(f).flatMap((menu) => itemsOf(menu).filter((line) => line.includes('danger: true')).map((line) => [f, line])),
    )
    expect(uses.map(([f]) => f).sort()).toEqual([
      'AgentView.jsx', 'HistoryView.jsx', 'PointsView.jsx', 'ProvidersView.jsx', 'SettingsView.jsx',
    ])
    for (const [f, attrs] of uses) expect(attrs, `${f}: a red action must be a trash can`).toMatch(/icon: IconTrash/)
  })

  it('the red trash can is the last action of every tile and row, so it sits in the same place on every screen', () => {
    let groups = 0
    for (const f of views) {
      for (const menu of menus(f)) {
        groups++
        const list = itemsOf(menu)
        expect(list.at(-1), `${f}: the last action in the menu of a tile is the trash can`).toContain('danger: true')
        expect(list.slice(0, -1).filter((line) => line.includes('danger')), `${f}: it is the only red one`).toEqual([])
      }
      expect(read(f), `${f}: no row keeps a row of icons of its own`).not.toContain('a-scan__tools')
    }
    expect(groups, 'points, providers, committee, agent keys and history rows').toBe(5)
  })

  it('a row of the History shows its "more" button and nothing else, with the actions of the visit in its menu: cancel or restore, then the red delete', () => {
    const src = read('HistoryView.jsx')
    const row = src.match(/<li key=\{s\.id\}[\s\S]*?<\/li>/)?.[0] ?? ''
    expect(row, 'a row of the History is found').toContain('a-scan__time')
    expect(row, 'the row has its menu').toContain('<Menu')
    expect(row, 'and no icon button of its own').not.toContain('<IconButton')
    const [menu, ...others] = menus('HistoryView.jsx')
    expect(others, 'one menu for the rows').toEqual([])
    expect(itemsOf(menu).map((line) => line.match(/label: '([^']+)'/)[1])).toEqual(['שחזור הנוכחות', 'ביטול הנוכחות', 'מחיקת הנוכחות לצמיתות'])
    // the first two are the actions of a visit that was accepted (a refused attempt has neither), one for each state
    const [restore, cancel, remove] = itemsOf(menu)
    expect(restore).toContain('OUTCOME_ACCEPTED && s.voided &&')
    expect(cancel).toContain('OUTCOME_ACCEPTED && !s.voided &&')
    expect(remove, 'the delete is for every row').not.toContain('OUTCOME_ACCEPTED')
    expect(src, 'the button names the visit it acts on').toMatch(/label=\{`עוד פעולות לביקור: \$\{s\.point_name\} · \$\{s\.provider_name\} · \$\{formatDateTime\(s\.checked_in_at\)\}`\}/)
    // a refused visit (the list of visits that were not counted) is read only: no menu
    expect(src.match(/function RefusalRow[\s\S]*?\n}\n/)?.[0] ?? '').not.toContain('<Menu')
  })

  it('a tile shows its "more" menu alone, with no icon button and no text button of its own (edit is the first item of the menu)', () => {
    for (const f of ['PointsView.jsx', 'ProvidersView.jsx', 'SettingsView.jsx', 'AgentView.jsx']) {
      expect(menus(f), `${f}: one menu for the tiles`).toHaveLength(1)
      const tools = [...read(f).matchAll(/className="a-card__tools">([\s\S]*?)<\/div>/g)].map((m) => m[1])
      expect(tools.length, `${f}: its tiles have tools`).toBeGreaterThan(0)
      for (const group of tools) {
        expect(group, `${f}: the tools of a tile are the menu alone`).not.toContain('<IconButton')
        expect(group, `${f}: no button of its own beside the menu (edit is its first item)`).not.toContain('<button')
      }
    }
  })

  it('removing something that can come back (switching off) uses the same icon on every screen: a circle with a bar', () => {
    for (const f of ['PointsView.jsx', 'ProvidersView.jsx', 'SettingsView.jsx', 'AgentView.jsx', 'HistoryView.jsx']) {
      expect(read(f), f).toMatch(/icon=\{[^}]*IconBan[^}]*\}|icon: [^,}]*IconBan/)
    }
  })

  it('no tile keeps a row of text buttons at its bottom (the actions are in its header)', () => {
    for (const f of views) expect(read(f), `${f} still has a tile actions row`).not.toContain('a-card__actions')
  })

  it('every page that adds something offers it as a pill with the plus and its words, the first action of its heading', () => {
    const adds = { 'PointsView.jsx': 'נקודה חדשה', 'ProvidersView.jsx': 'נותן שירות חדש', 'SettingsView.jsx': 'מנהל מערכת חדש', 'AgentView.jsx': 'מפתח חדש' }
    for (const [f, label] of Object.entries(adds)) {
      // the heading is marked (a-head--add: its actions go under the text), and the pill is the first thing in its actions
      const pill = new RegExp(`<div className="a-head[^"]*a-head--add">[\\s\\S]*?<div className="a-actions">\\s*<AddButton label="${label}" onClick=\\{[^}]*\\} />`)
      expect(read(f), f).toMatch(pill)
    }
  })

  it('the add button is the small primary pill (the one of the empty states): the plus and the words, a button that is named by its words', () => {
    const out = html(React.createElement(AddButton, { label: 'x', onClick: () => {} }))
    expect(out).toContain('<button type="button" class="w-btn w-btn--small"')
    expect(out).toMatch(/^<button[^>]*><svg[^>]*width="20"[^>]*height="20"[\s\S]*<\/svg>x<\/button>$/) // the plus first, then the words
    expect(out).not.toContain('aria-label') // the name is the visible text
    expect(out).not.toContain('title=')
  })

  it('deleting a point is a real delete, and the confirmation says its scans stay in the history', () => {
    const src = read('PointsView.jsx')
    expect(src).toMatch(/adminApi\(`\/points\/\$\{p\.id\}`, \{ method: 'DELETE' \}\)/)
    expect(src).toContain('בהיסטוריה, עם שם הנקודה')
    expect(src).toContain('מחיקת הנקודה')
  })

  it('every history row has a delete button, with a confirmation that offers cancelling instead', () => {
    const src = read('HistoryView.jsx')
    expect(src).toMatch(/adminApi\(`\/scans\/\$\{s\.id\}`, \{ method: 'DELETE' \}\)/)
    expect(src).toContain('אי אפשר לשחזר אותה')
    expect(src).toContain('אפשר לבטל אותה במקום')
    // the delete is outside the "accepted only" condition: a refused attempt can be cleaned up too
    expect(src).toMatch(/\n\s*\{ label: 'מחיקת הנוכחות לצמיתות', icon: IconTrash, danger: true, disabled: busy, onSelect: \(\) => remove\(s\) \},\r?\n/)
  })
})
