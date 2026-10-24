// The building's own settings: its address, its name and the committee's contact for privacy requests, the three things the
// committee types in the committee app (table building_settings, one row). The public route (the provider app's header and its
// privacy notice) and the committee routes share these functions.
import { query } from './db.js'
import { bad, str } from './http.js'
import { ADDRESS_MAX_LENGTH, BUILDING_NAME_MAX_LENGTH, PRIVACY_CONTACT_MAX_LENGTH } from '../shared/contract.js'

// The longest address, ADDRESS_MAX_LENGTH, the longest name, BUILDING_NAME_MAX_LENGTH, and the longest contact,
// PRIVACY_CONTACT_MAX_LENGTH (shared/contract.js: the committee form checks them too), are also the limits of the columns
// (char_length(address) <= 200, char_length(name) <= 80, char_length(privacy_contact) <= 120).
// JavaScript counts UTF-16 units, Postgres counts characters, so whatever passes here also passes the database.

// Control characters (tab, line breaks, NUL, ...) and the line and paragraph separators. A line break would split the
// header of the provider app or a line of its privacy notice, and NUL cannot be stored in a text column. Everything else is
// allowed as typed: any language, digits, punctuation, and the invisible direction marks that mixed Hebrew and Latin text
// sometimes needs.
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u

/**
 * The building's three texts, as the routes answer them.
 * @typedef {object} Building
 * @property {string} address  empty means show nothing
 * @property {string} name  empty means no name
 * @property {string} privacy_contact  how to reach the committee about personal data; empty means not set (the notice then
 *   tells the providers to ask the committee's members)
 */

/**
 * The address from a request body, trimmed, or `undefined` when the request does not carry one. Empty is allowed (it means "show
 * nothing"). The field is optional since the committee card sends it only when it changed: a card that was opened before another
 * member saved a new address would otherwise send the older one back with a save of the name or the contact. The screens from before
 * this still send it with every save, and that is still accepted. `null` is refused with `missing_field`, the code it always had.
 */
export function parseAddress(value) {
  if (value === undefined) return undefined
  const address = str(value, { field: 'address', max: ADDRESS_MAX_LENGTH })
  if (address === undefined) throw bad('missing_field', 'address is required (it can be empty)', { field: 'address' })
  if (CONTROL.test(address)) throw bad('invalid_field', 'address must not contain control characters', { field: 'address' })
  return address
}

/**
 * The name from a request body, trimmed, or `undefined` when the request does not carry one. The field is optional: the
 * committee screens that were installed before the name existed send the address only, and a save from them must leave the
 * name alone (so `undefined` means "keep what is saved"). A name that is sent is checked like the address: text, empty is
 * allowed (it clears the name), no control characters, at most BUILDING_NAME_MAX_LENGTH characters. `null` is not text, so it is
 * refused rather than read as "not sent": clearing the name is an empty string.
 */
export function parseName(value) {
  if (value === undefined) return undefined
  const name = str(value, { field: 'name', max: BUILDING_NAME_MAX_LENGTH })
  if (name === undefined) throw bad('invalid_field', 'name must be text', { field: 'name' }) // null
  if (CONTROL.test(name)) throw bad('invalid_field', 'name must not contain control characters', { field: 'name' })
  return name
}

/**
 * The committee's contact for privacy requests from a request body, trimmed, or `undefined` when the request does not carry
 * one. Optional for the same reason as the name: a committee screen from before the contact existed sends the address and the
 * name only, and its save must leave the contact alone. A contact that is sent is checked like the name: text, empty is allowed
 * (it clears the contact), no control characters, at most PRIVACY_CONTACT_MAX_LENGTH characters, and `null` is refused.
 */
export function parsePrivacyContact(value) {
  if (value === undefined) return undefined
  const contact = str(value, { field: 'privacy_contact', max: PRIVACY_CONTACT_MAX_LENGTH })
  if (contact === undefined) throw bad('invalid_field', 'privacy_contact must be text', { field: 'privacy_contact' }) // null
  if (CONTROL.test(contact)) {
    throw bad('invalid_field', 'privacy_contact must not contain control characters', { field: 'privacy_contact' })
  }
  return contact
}

/**
 * The three texts of a row of building_settings, '' for each that is missing (also when the row is).
 * @returns {Building}
 */
const buildingOf = (row) => ({ address: row?.address ?? '', name: row?.name ?? '', privacy_contact: row?.privacy_contact ?? '' })

/**
 * The saved address, name and contact, '' for each that is empty (also when the row is missing, which the migration prevents).
 * @returns {Promise<Building>}
 */
export async function readBuilding() {
  const { rows } = await query('select address, name, privacy_contact from building_settings where id = 1')
  return buildingOf(rows[0])
}

/**
 * Saves the address, the name, the contact and who saved them, with the client `c` of the transaction that also writes the
 * audit row (server/audit.js), so the change and its record commit together. The row is locked and read first, so that the
 * caller can say what the three texts were (`before`, what readBuilding would have answered) and what they are now (`after`).
 * Each of the three is optional: `undefined` keeps the saved one, so `after` then holds the saved one. A save that
 * leaves all three texts as they are writes nothing (not the time and not the member either: they say who CHANGED it), and
 * answers `changed: false`, so that the caller records nothing. An upsert, so a row that went missing does not turn a save into
 * an error.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} c  the client of the transaction
 * @param {string} adminId
 * @param {{ address?: string, name?: string, privacy_contact?: string }} next
 * @returns {Promise<{ changed: boolean, before: Building, after: Building }>}
 */
export async function saveBuilding(c, adminId, { address, name, privacy_contact }) {
  const current = await c.query('select address, name, privacy_contact from building_settings where id = 1 for update')
  const before = buildingOf(current.rows[0])
  /** @type {Building} */
  const after = {
    address: address ?? before.address,
    name: name ?? before.name,
    privacy_contact: privacy_contact ?? before.privacy_contact,
  }
  const same = before.address === after.address && before.name === after.name && before.privacy_contact === after.privacy_contact
  if (same) return { changed: false, before, after }
  await c.query(
    `insert into building_settings (id, address, name, privacy_contact, updated_at, updated_by) values (1, $1, $2, $3, now(), $4)
     on conflict (id) do update
       set address = excluded.address, name = excluded.name, privacy_contact = excluded.privacy_contact,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [after.address, after.name, after.privacy_contact, adminId],
  )
  return { changed: true, before, after }
}
