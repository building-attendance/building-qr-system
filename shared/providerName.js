// How the app names a service provider in one line of text: "contact (company)", or the company alone when the provider has no
// contact person (owner decision of 14/10/2026). It runs in the browser (the committee's audit log: src/admin/auditDescribe.js)
// and on the server, so the form is written once, here.
//
// It is the name that a record keeps of a provider (scans.provider_name and scan_refusals.provider_name, a snapshot made when the
// record is written: providerSnapshotName in server/scans.js), and the name that every reader shows: the committee's History and
// its CSV, the audit log, the Home screen and the agent API.
//
// Before that decision a snapshot was "company, an en dash, contact" (the separator is a space, U+2013 and a space), and scans and
// refused visits are append-only: the rows written then keep that text for ever. So every reader turns a stored name into today's
// form with readProviderName, and the old separator is named here by its code point, never written as the character (AGENTS.md,
// "Rules for every change"). Where the database groups and orders by the name, it does the same in SQL (providerNameSql in
// server/scans.js); tests/provider-name.test.js proves that the two agree.
//
// The app writes no en dash, so a name that the committee typed with one (a company "North<en dash>South") is written with a
// hyphen in the snapshot and on the way out. That also keeps the old form apart from the new one: a stored name that holds the
// old separator was written before the decision, never after it.

// The en dash, built from its code point (U+2013), so that this file does not contain the character.
const EN_DASH = String.fromCharCode(0x2013)

/** The separator of the snapshot before 14/10/2026: a space, an en dash and a space. */
export const OLD_PROVIDER_NAME_SEPARATOR = ` ${EN_DASH} `

/** The text with every en dash written as a hyphen (the app writes none). */
const noEnDash = (text) => String(text ?? '').split(EN_DASH).join('-')

/**
 * The name of a provider in one line: "contact (company)", or the company alone when there is no contact person.
 * @param {{ company?: string | null, contact_name?: string | null }} provider
 * @returns {string}
 */
export function providerName({ company, contact_name: contact }) {
  const firm = noEnDash(company)
  return contact ? `${noEnDash(contact)} (${firm})` : firm
}

/**
 * A provider's name as a record stored it, in today's form. A name stored before 14/10/2026 ("company, the old separator,
 * contact") becomes "contact (company)"; a name in today's form comes back as it is. Anything that is not a text (a null)
 * comes back as it is.
 *
 * The split is at the LAST separator that has text on both sides. A company may hold the separator itself (a company
 * "Cleaning <en dash> North" with a contact "Dana" was stored as two separators), and a person's name is much less likely to;
 * so that name reads "Dana (Cleaning - North)". With a contact that held the separator, the words are all still there, only
 * the parentheses fall one word off. A provider with no contact person and a company that held the separator was stored
 * with no sign of which it was, so it reads as a contact and a company: the one case that no reader can tell apart.
 * @template T
 * @param {string | T} stored
 * @returns {string | T}
 */
export function readProviderName(stored) {
  if (typeof stored !== 'string') return stored
  const separator = OLD_PROVIDER_NAME_SEPARATOR
  // The last separator with at least one character after it (one that ends the text is not a separator of two names).
  const at = stored.lastIndexOf(separator, stored.length - separator.length - 1)
  if (at < 1) return noEnDash(stored) // none, or none with a company before it
  return providerName({ company: stored.slice(0, at), contact_name: stored.slice(at + separator.length) })
}
