import { useState } from 'react'

/** The letter that stands for a member: the first letter of the name, of the e-mail when there is no name, in upper case. */
export const initialOf = (member) => [...String(member.name || member.email || '?').trim()][0]?.toUpperCase()

/**
 * What fills the circle of a committee member (owner decision of 14/10/2026): the member's Google photo when the server gives one
 * (`picture_url`, GET /api/admin/me and GET /api/admin/admins), and the initial when it gives none, or when the photo does not
 * load (offline, blocked, expired). It is the content of the circle and not the circle itself, so each place keeps its own element:
 * the account button of the top bar, the circle of the rail's button and of the head of the account menu (src/admin/AccountMenu.jsx),
 * and the mark of the member's card in Settings (src/admin/views/SettingsView.jsx). `.a-face` (admin.css) makes the photo fill the
 * circle.
 *
 * - `alt=""`: the photo says nothing that the text beside it does not say. The account button is named by its own label, and the
 *   circles of the rail, the menu and the cards are hidden from a screen reader, next to the member's name.
 * - `referrerPolicy="no-referrer"`: Google's photo host gets no address of the app with the request (and it may refuse a request
 *   that has a referrer).
 * - `lazy` (the cards): a long list of members loads the photos that come into view.
 * - The Content-Security-Policy allows pictures from Google's photo host only (vercel.json); the server keeps no other address.
 *   The service worker does not cache them: the precache is the app's own files, and there is no runtime caching (vite.config.js).
 *
 * The address that failed is remembered, so a new address (a new sign-in, a reload of the list) is tried again.
 * @param {{ member: { name?: string, email?: string, picture_url?: string | null }, lazy?: boolean }} props
 */
export default function MemberFace({ member, lazy = false }) {
  const [failed, setFailed] = useState(/** @type {string | null} */ (null))
  const picture = typeof member.picture_url === 'string' && member.picture_url ? member.picture_url : null
  if (!picture || picture === failed) return initialOf(member)
  return (
    <img
      className="a-face" src={picture} alt="" referrerPolicy="no-referrer" decoding="async" loading={lazy ? 'lazy' : undefined}
      onError={() => setFailed(picture)}
    />
  )
}
