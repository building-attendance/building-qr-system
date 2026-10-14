// A page of the committee app's shared components on their own, for the end-to-end tests: the "more" menu before any screen uses it,
// and the dialog at both widths. e2e/harness.js builds it with Vite (React and the app's own CSS and components, as the app is built)
// and serves it to the test's page. It is never part of the app's build. Written without JSX, so that it is plain JavaScript for the
// linter and the type checker.
//
// The page: a card with its "more" menu between two buttons (where Tab goes on to), a box that clips what it holds with a menu in it
// (the rounded list of the History), a tile at the bottom of the screen (its menu opens upwards), every button, chip and field of the
// redesign, and two buttons that open a dialog and a sheet, with a menu inside. `?dir=ltr` lays it out left to right. The theme follows
// the device, as the apps do when nobody has chosen one.
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/ui/base.css'
import '../../src/ui/ui.css'
import '../../src/admin/admin.css'
import { Badge, Field, Menu, Modal } from '../../src/admin/ui.jsx'
import { IconBan, IconPrinter, IconTrash, IconUndo } from '../../src/admin/icons.jsx'

const root = document.documentElement
root.dir = new URLSearchParams(window.location.search).get('dir') === 'ltr' ? 'ltr' : 'rtl'
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const followTheDevice = () => { root.dataset.theme = dark.matches ? 'dark' : 'light' }
followTheDevice()
dark.addEventListener('change', followTheDevice)

/** The actions of a point, as the Points screen will list them: print, switch off, and the red delete. */
const pointActions = (name, choose) => [
  { label: 'הדפסת שלט QR', icon: IconPrinter, onSelect: () => choose(`הדפסת שלט QR (${name})`) },
  { label: 'השבתת הנקודה', icon: IconBan, onSelect: () => choose(`השבתת הנקודה (${name})`) },
  { label: 'מחיקת הנקודה', icon: IconTrash, danger: true, onSelect: () => choose(`מחיקת הנקודה (${name})`) },
]

function Card({ name, choose }) {
  return h('article', { className: 'a-card' },
    h('div', { className: 'a-card__top' },
      h('h2', { className: 'a-card__title' }, name),
      h('div', { className: 'a-card__tools' }, h(Menu, { label: `עוד פעולות ל${name}`, items: pointActions(name, choose) }))),
    h('div', { className: 'a-meta' }, h(Badge, { tone: 'ok' }, 'פעילה'), h(Badge, { tone: 'info' }, 'מיקום חובה')))
}

function Harness() {
  const [chosen, setChosen] = useState('')
  const [dialog, setDialog] = useState(null) // the size of the open dialog: 'md' or 'sheet'
  const [name, setName] = useState('לובי')
  const choose = (what) => setChosen(`נבחר: ${what}`)
  return h('div', { className: 'a-app' },
    h('main', { className: 'a-main' },
      h('div', { className: 'a-stack' },
        h('h1', null, 'הרכיבים המשותפים'),
        h('button', { type: 'button', className: 'w-btn w-btn--quiet w-btn--small' }, 'לפני'),
        h(Card, { name: 'לובי', choose }),
        h('button', { type: 'button', className: 'w-btn w-btn--quiet w-btn--small' }, 'אחרי'),
        h('p', { role: 'status' }, chosen),
        // A box that clips what it holds, as the rounded list of the History does: the menu must not be cut by it.
        h('div', { className: 'a-card', 'data-testid': 'clip', style: { overflow: 'hidden', height: 72 } },
          h('div', { className: 'a-card__top' },
            h('h2', { className: 'a-card__title' }, 'חניון'),
            h(Menu, {
              label: 'עוד פעולות לנוכחות בחניון',
              items: [
                { label: 'ביטול הנוכחות', icon: IconBan, onSelect: () => choose('ביטול הנוכחות (חניון)') },
                { label: 'החזרת הנוכחות', icon: IconUndo, disabled: true, onSelect: () => choose('החזרת הנוכחות (חניון)') },
                { label: 'מחיקת הנוכחות לצמיתות', icon: IconTrash, danger: true, onSelect: () => choose('מחיקת הנוכחות (חניון)') },
              ],
            }))),
        h('div', { className: 'a-actions' },
          h('button', { type: 'button', className: 'w-btn w-btn--small', onClick: () => setDialog('md') }, 'פתיחת חלון'),
          h('button', { type: 'button', className: 'w-btn w-btn--quiet w-btn--small', onClick: () => setDialog('sheet') }, 'פתיחת גיליון'),
          h('button', { type: 'button', className: 'w-btn w-btn--danger w-btn--small' }, 'מחיקה')),
        h('div', { className: 'a-meta' },
          h(Badge, { tone: 'ok' }, 'פעילה'), h(Badge, { tone: 'warn' }, 'ממתין לשליחה'), h(Badge, { tone: 'info' }, 'מיקום חובה'),
          h(Badge, { tone: 'sky' }, 'ניקיון'), h(Badge, null, 'מושבת'), h(Badge, { tone: 'danger' }, 'אין סיסמה')),
        h(Field, { label: 'שם הנקודה' }, h('input', { className: 'a-input', value: name, onChange: (e) => setName(e.target.value) })),
        h('div', { className: 'w-banner' }, h('span', { className: 'w-banner__body' }, 'הודעה בתוך באנר.')),
        // Room under the last thing, so that the tile at the bottom never covers it.
        h('div', { style: { height: 120 } })),
      // A tile at the bottom of the screen: there is no room under its button, so its menu opens upwards.
      h('div', { className: 'a-card', 'data-testid': 'bottom', style: { position: 'fixed', insetInline: 16, bottom: 8 } },
        h('div', { className: 'a-card__top' },
          h('h2', { className: 'a-card__title' }, 'גג'),
          h(Menu, { label: 'עוד פעולות לגג', items: pointActions('גג', choose) })))),
    dialog && h(Modal, {
      title: 'עריכת נקודה',
      size: dialog,
      onClose: () => setDialog(null),
      footer: [
        h('button', { key: 'cancel', type: 'button', className: 'w-btn w-btn--quiet w-btn--small', onClick: () => setDialog(null) }, 'ביטול'),
        h('button', { key: 'save', type: 'button', className: 'w-btn w-btn--small', onClick: () => setDialog(null) }, 'שמירת הנקודה'),
      ],
    },
    h(Field, { label: 'שם' }, h('input', { className: 'a-input', defaultValue: 'לובי' })),
    h('div', { className: 'a-actions' }, h(Menu, { label: 'עוד פעולות לנקודה בחלון', items: pointActions('הנקודה בחלון', choose) }))),
  )
}

createRoot(document.getElementById('root')).render(h(Harness))
