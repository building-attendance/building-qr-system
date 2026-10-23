import { useId, useRef, useState } from 'react'
import { adminApi, errorText } from '../api.js'
import { useLoad, setLoadCache, LOAD_KEY, formatDateTime } from '../hooks.js'
import { Modal, Field, Badge, EmptyState, Spinner, AddButton, Menu, useToast, useConfirm, useAction, useDirty } from '../ui.jsx'
import { IconBan, IconCheck, IconShield, IconAlert, IconTrash } from '../icons.jsx'
import { ADDRESS_MAX_LENGTH, BUILDING_NAME_MAX_LENGTH, NAME_MAX_LENGTH, PRIVACY_CONTACT_MAX_LENGTH } from '../../../shared/contract.js'
import { useBuildingName } from '../buildingName.jsx'
import MemberFace from '../MemberFace.jsx'
import Email from '../Email.jsx'
import BuildLabel from '../../ui/BuildLabel.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The same limits as the server (shared/contract.js), so that the person is told before sending.
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u

// What the field says when the server refused it (a limit or a character that the form could not know about).
const FIELD_REFUSED = {
  address: 'הכתובת לא נשמרה: היא ארוכה מדי או מכילה תווים שאי אפשר לשמור.',
  name: 'השם לא נשמר: הוא ארוך מדי או מכיל תווים שאי אפשר לשמור.',
  privacy_contact: 'פרטי הקשר לא נשמרו: הם ארוכים מדי או מכילים תווים שאי אפשר לשמור.',
}

/** What the toast says after a save, by what the person changed: one field alone says which, more than one say "the building's details". */
function savedMessage({ addressChanged, nameChanged, contactChanged }, building) {
  if ([addressChanged, nameChanged, contactChanged].filter(Boolean).length > 1) return 'פרטי הבניין נשמרו'
  if (nameChanged) return building.name ? 'שם הבניין נשמר' : 'שם הבניין הוסר'
  if (contactChanged) return building.privacy_contact ? 'פרטי הקשר לפניות פרטיות נשמרו' : 'פרטי הקשר לפניות פרטיות הוסרו'
  return building.address ? 'כתובת הבניין נשמרה' : 'כתובת הבניין הוסרה'
}

/**
 * The three fields of the card from a building as the server sends it (`null`: nothing yet). A server from before names existed sends
 * no name, and one from before the privacy contact existed sends no contact.
 */
const fieldsOf = (building) => ({ address: building?.address ?? '', name: building?.name ?? '', privacy_contact: building?.privacy_contact ?? '' })

/**
 * The building's name, address and contact for privacy requests: the name and address are shown at the top of the service providers' app
 * (the name above the address) and, the name, in the committee app too; the contact is shown in the providers' privacy notice (/privacy).
 * All are kept in the database of this committee and any can stay empty (the apps then show nothing for it, and the notice tells the
 * providers to ask the committee's members). One form and one save button for the three, so there are no row actions here (and the card is not an <article>: the committee
 * members' cards are). The heading of the section, with its line, stands above the card like the members' one, so the card holds
 * the fields alone. A save tells the committee app the name that the server now has, so its brand follows with no reload.
 */
function BuildingCard() {
  const titleId = useId()
  const toast = useToast()
  const { setName: showName } = useBuildingName()
  const [busy, run] = useAction(toast, errorText)
  // When this card was open before in this session, `loaded.data` is the last answer of the server and the fields start with it (the
  // brand is left alone: it shows the name that the shell, or a save, put there). The answer that follows comes through `take`.
  const loaded = useLoad(async () => {
    const { building } = await adminApi('/building')
    take(building, { keepEdits: true })
    return building
  }, [], { cacheKey: LOAD_KEY.building })
  const [stored, setStored] = useState(() => fieldsOf(loaded.data)) // as the server has it
  const storedRef = useRef(stored)
  const [addressText, setAddressText] = useState(stored.address) // what the fields say now
  const [nameText, setNameText] = useState(stored.name)
  const [contactText, setContactText] = useState(stored.privacy_contact)
  const [errors, setErrors] = useState({ address: '', name: '', privacy_contact: '' })

  // Takes what the server has (a load, a save) into the fields and the brand. With `keepEdits` a field that the person has changed
  // since the last answer keeps what they typed (an answer that arrives while a card drawn from the cache is already being edited);
  // a save replaces both fields.
  const take = (building, { keepEdits = false } = {}) => {
    const before = storedRef.current
    const next = fieldsOf(building)
    storedRef.current = next
    setStored(next)
    setAddressText((text) => (keepEdits && text !== before.address ? text : next.address))
    setNameText((text) => (keepEdits && text !== before.name ? text : next.name))
    setContactText((text) => (keepEdits && text !== before.privacy_contact ? text : next.privacy_contact))
    showName(next.name)
  }

  const address = addressText.trim()
  const name = nameText.trim()
  const addressChanged = address !== stored.address
  const nameChanged = name !== stored.name
  const contact = contactText.trim()
  const contactChanged = contact !== stored.privacy_contact
  const changed = addressChanged || nameChanged || contactChanged
  const submit = async (e) => {
    e.preventDefault()
    if (busy || !changed) return
    const next = {
      address: CONTROL_RE.test(address) ? 'הכתובת מכילה תווים שאי אפשר לשמור, למשל ירידת שורה.' : '',
      name: CONTROL_RE.test(name) ? 'השם מכיל תווים שאי אפשר לשמור, למשל ירידת שורה.' : '',
      privacy_contact: CONTROL_RE.test(contact) ? 'פרטי הקשר מכילים תווים שאי אפשר לשמור, למשל ירידת שורה.' : '',
    }
    if (next.address || next.name || next.privacy_contact) return setErrors(next)
    // The server says which field it refused (`invalid_field` with `field`): that one shows under its own field, and nothing else
    // is said. Any other failure is the usual toast.
    const res = await run(async () => {
      try {
        return await adminApi('/building', { method: 'PUT', body: { address, name, privacy_contact: contact } })
      } catch (err) {
        const field = err?.code === 'invalid_field' ? err.extra?.field : undefined
        if (field !== 'address' && field !== 'name' && field !== 'privacy_contact') throw err
        setErrors({ address: '', name: '', privacy_contact: '', [field]: FIELD_REFUSED[field] })
        return null
      }
    })
    if (!res) return
    take(res.building)
    setLoadCache(LOAD_KEY.building, res.building) // the next time this card opens it draws what was saved
    toast.ok(savedMessage({ addressChanged, nameChanged, contactChanged }, res.building))
  }

  return (
    <section aria-labelledby={titleId}>
      {/* The heading of the section is the same as the members' (a section heading with its line under it), outside the card. */}
      <div className="a-head a-head--section">
        <div>
          <h2 id={titleId}>פרטי הבניין</h2>
          <p>השם והכתובת שמופיעים בראש שתי האפליקציות, ופרטי הקשר שמופיעים בהודעת הפרטיות.</p>
        </div>
      </div>
      <div className="a-card a-card--form">
        {loaded.status === 'loading' && <Spinner />}
        {loaded.status === 'error' && !loaded.data && (
          <>
            <p className="w-error" role="alert"><IconAlert size={18} />לא הצלחנו לטעון את פרטי הבניין.</p>
            <div className="a-actions"><button type="button" className="w-btn w-btn--small w-btn--quiet" onClick={loaded.reload}>נסו שוב</button></div>
          </>
        )}
        {loaded.data && (
          <form className="a-form" onSubmit={submit} noValidate>
            <Field label="שם הבניין" error={errors.name}
              hint="השם מופיע בראש שתי האפליקציות, מעל הכתובת. בלי שם, הכותרת בוועד היא נוכחות בבניין.">
              {/* dir="auto": the name is typed in any language, and each one should read the right way round */}
              <input className="a-input" dir="auto" value={nameText} maxLength={BUILDING_NAME_MAX_LENGTH} autoComplete="off"
                onChange={(e) => { setNameText(e.target.value); setErrors((r) => ({ ...r, name: '' })) }} />
            </Field>
            <Field label="כתובת הבניין" error={errors.address}
              hint="הכתובת מופיעה בראש האפליקציה של נותני השירות, בדרך כלל תוך דקה מהשמירה. אפשר להשאיר ריק, ואז לא תוצג כתובת.">
              {/* dir="auto": the address is typed in any language, and each one should read the right way round */}
              <input className="a-input" dir="auto" value={addressText} maxLength={ADDRESS_MAX_LENGTH} autoComplete="off"
                onChange={(e) => { setAddressText(e.target.value); setErrors((r) => ({ ...r, address: '' })) }} />
            </Field>
            <Field label="פרטי קשר לפניות בנושא פרטיות" error={errors.privacy_contact}
              hint="מוצג לכל מי שפותח את אפליקציית נותני השירות, בהודעת הפרטיות. למשל טלפון או מייל של הוועד.">
              {/* dir="auto": a phone number or an address, typed in any language */}
              <input className="a-input" dir="auto" value={contactText} maxLength={PRIVACY_CONTACT_MAX_LENGTH} autoComplete="off"
                onChange={(e) => { setContactText(e.target.value); setErrors((r) => ({ ...r, privacy_contact: '' })) }} />
            </Field>
            {/* While no contact is saved the providers' notice sends them to "the committee members": a note with the next step, not an error. */}
            {!stored.privacy_contact && (
              <div className="w-banner">
                <IconShield size={18} />
                <div className="w-banner__body">עוד לא נשמרו פרטי קשר, ולכן הודעת הפרטיות אומרת לנותני השירות לפנות לחברי הוועד. הוסיפו כאן טלפון או מייל של הוועד ולחצו על שמירה.</div>
              </div>
            )}
            <div className="a-actions">
              <a className="w-link" href="/privacy" target="_blank" rel="noopener">הודעת הפרטיות שנותני השירות רואים</a>
            </div>
            <div className="a-actions">
              <button type="submit" className="w-btn w-btn--small" disabled={busy || !changed}>{busy ? 'שומר…' : 'שמירה'}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function AddDialog({ onClose, onAdded }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, run] = useAction(toast, errorText)
  const dirty = useDirty({ email, name })
  const submit = async (e) => {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError('כתובת מייל לא תקינה.')
    const res = await run(() => adminApi('/admins', { method: 'POST', body: { email: email.trim(), name: name.trim() } }), 'מנהל המערכת נוסף')
    if (res) onAdded()
  }
  return (
    <Modal title="מנהל מערכת חדש" onClose={onClose} dirty={dirty} busy={busy} size="sm"
      footer={(
        <>
          <button type="button" className="w-btn w-btn--quiet w-btn--small" onClick={onClose} disabled={busy}>ביטול</button>
          <button type="submit" form="admin-form" className="w-btn w-btn--small" disabled={busy}>{busy ? 'מוסיף…' : 'הוספה'}</button>
        </>
      )}>
      <form id="admin-form" className="a-form" onSubmit={submit} noValidate>
        <Field label="כתובת Gmail" error={error} hint="האדם ייכנס עם חשבון Google של הכתובת הזו. אין סיסמה שצריך לשלוח.">
          <input className="a-input" type="email" dir="ltr" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} autoComplete="off" />
        </Field>
        <Field label="שם (לא חובה)">
          <input className="a-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX_LENGTH} />
        </Field>
      </form>
    </Modal>
  )
}

/**
 * The settings: who may sign in to the committee app (the members, with the button that adds one) and the building's name and address.
 * It ends with the id of the build that this computer or phone runs. The audit log and the guide are screens of their own now
 * (AuditView.jsx, HelpView.jsx), and the address `#committee` of the screen that held all of them lands here (src/admin/tab.js).
 */
export default function SettingsView({ admin }) {
  const membersId = useId()
  const toast = useToast()
  const confirm = useConfirm()
  const admins = useLoad(() => adminApi('/admins'), [], { cacheKey: LOAD_KEY.admins })
  const [adding, setAdding] = useState(false)
  const [busy, run] = useAction(toast, errorText)
  const list = admins.data?.admins ?? []

  const toggle = async (a) => {
    if (a.is_active) {
      const ok = await confirm({
        title: `להסיר את הגישה של ${a.name || a.email}?`,
        body: 'הוא ינותק מיד ולא יוכל להיכנס לניהול. אפשר להחזיר את הגישה בכל עת.',
        confirmLabel: 'הסרת גישה', danger: true,
      })
      if (!ok) return
    }
    if (await run(() => adminApi(`/admins/${a.id}`, { method: 'PATCH', body: { is_active: !a.is_active } }), a.is_active ? 'הגישה הוסרה' : 'הגישה הוחזרה')) admins.reload()
  }

  // Deleting takes the person off the list for good (you cannot delete yourself); removing access only shuts them out.
  const deleteMember = async (a) => {
    const ok = await confirm({
      title: `למחוק את ${a.name || a.email} מרשימת מנהלי המערכת?`,
      body: 'הכתובת נמחקת מהרשימה והחשבון מתנתק מיד. אפשר להוסיף את אותה כתובת שוב בכל עת. כדי רק לעצור את הכניסה, אפשר להסיר גישה במקום.',
      confirmLabel: 'מחיקת מנהל המערכת', danger: true,
    })
    if (ok && await run(() => adminApi(`/admins/${a.id}`, { method: 'DELETE' }), 'מנהל המערכת נמחק')) admins.reload()
  }

  return (
    <>
      <div className="a-head">
        <div>
          <h1>הגדרות</h1>
          <p>מנהלי המערכת ופרטי הבניין.</p>
        </div>
      </div>

      {/* Two columns from 1024px (the members at the start, the building at the end), one under the other below it, the members first. */}
      <div className="a-settings">
        <section aria-labelledby={membersId}>
          <div className="a-head a-head--section a-head--add">
            <div>
              <h2 id={membersId}>מנהלי המערכת</h2>
              <p>מי רשאי להיכנס לניהול. הכניסה תמיד עם חשבון Google.</p>
            </div>
            <div className="a-actions"><AddButton label="מנהל מערכת חדש" onClick={() => setAdding(true)} /></div>
          </div>

          {admins.status === 'loading' && <Spinner />}
          {admins.status === 'error' && !admins.data && (
            <EmptyState icon={IconAlert} title="לא הצלחנו לטעון" action={<button className="w-btn w-btn--small" onClick={admins.reload}>נסו שוב</button>} />
          )}
          {admins.status === 'ready' && list.length === 0 && <EmptyState icon={IconShield} title="הרשימה ריקה" />}

          <div className="a-grid">
            {list.map((a) => {
              const me = a.id === admin.id
              const name = a.name || 'מנהל מערכת'
              return (
                <article key={a.id} className={`a-card${a.is_active ? '' : ' is-off'}`}>
                  <div className="a-card__top">
                    <div className="a-card__id">
                      {/* the member's Google photo, or the initial (the same face as the account circle) */}
                      <span className="a-card__icon a-card__icon--round" aria-hidden="true"><MemberFace member={a} lazy /></span>
                      <div>
                        <h3 className="a-card__title">{name}{me && ' (אתם)'}</h3>
                        {/* an address reads left to right, but it lines up with the title like the other cards' second line */}
                        <p className="a-card__sub"><Email address={a.email} /></p>
                      </div>
                    </div>
                    {/* your own card has no menu: you cannot remove or delete yourself */}
                    {!me && (
                      <div className="a-card__tools">
                        <Menu
                          label={`עוד פעולות ל${a.name || a.email}`}
                          items={[
                            { label: a.is_active ? 'הסרת גישה' : 'החזרת גישה', icon: a.is_active ? IconBan : IconCheck, disabled: busy, onSelect: () => toggle(a) },
                            { label: 'מחיקת מנהל המערכת', icon: IconTrash, danger: true, disabled: busy, onSelect: () => deleteMember(a) },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <div className="a-meta"><Badge tone={a.is_active ? 'ok' : 'neutral'}>{a.is_active ? 'פעיל' : 'הוסר'}</Badge></div>
                  <dl className="a-facts a-facts--tiles"><div><dt>כניסה אחרונה</dt><dd>{a.last_login_at ? formatDateTime(a.last_login_at) : 'עוד לא נכנס'}</dd></div></dl>
                </article>
              )
            })}
          </div>
        </section>

        <BuildingCard />
      </div>

      {/* Which build this computer or phone runs: the end of the settings, the one place that both layouts reach (the tab bar and the side rail). */}
      <BuildLabel label="גרסה" className="a-build" />

      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); admins.reload() }} />}
    </>
  )
}
