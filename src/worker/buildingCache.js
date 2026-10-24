import { safeStorage, readJson } from './storage.js'

// The key has a version suffix, like the others: the shape can change later and the old one is read (or ignored).
// The shape grew without a new key: { address } became { address, name }. A phone that saved the old one has no `name`, and it is
// read as '' (no name); a phone that runs an older version of the app reads only `address` out of the new one and ignores the rest.
// The committee's contact for privacy requests is never kept here: it can be a committee member's phone or e-mail, and a copy on a
// phone that never connects again could not be removed when the committee changes it. The privacy notice shows it once the server
// answers, and asks the providers to contact the committee's members until then.
const KEY = 'qr.building.v1'

/**
 * The building's texts: the name and the address for the header of the provider app, and the committee's contact for its privacy
 * notice (from the server's answer only: what the phone remembers has it empty).
 * @typedef {object} CachedBuilding
 * @property {string} address  empty means show no address
 * @property {string} name  empty means no name
 * @property {string} privacy_contact  empty means not set or not known yet (the notice tells the providers to ask the committee's members)
 */

/**
 * Reads what the server answered (`building` of GET /api/public/building) as the three texts, or null when it is not an answer of
 * ours. The address must be text. The name and the contact are text too, but an answer without one (a server from before it existed)
 * means it is not set.
 * @param {unknown} building
 * @returns {CachedBuilding | null}
 */
export function parseBuilding(building) {
  if (building === null || typeof building !== 'object') return null
  const { address, name = '', privacy_contact = '' } =
    /** @type {{ address?: unknown, name?: unknown, privacy_contact?: unknown }} */ (building)
  const texts = typeof address === 'string' && typeof name === 'string' && typeof privacy_contact === 'string'
  return texts ? { address, name, privacy_contact } : null
}

/**
 * Remembers the building's address and name on the phone, so the header can show them on the first paint and with no signal.
 * Stored as { address, name }, never the contact (see the top of this file), and an empty one is stored too (the committee may have
 * cleared it: the phone must follow).
 * @param {{ address: string, name: string }} building
 */
export function setCachedBuilding({ address, name }, storage = safeStorage) {
  storage.setItem(KEY, JSON.stringify({ address, name }))
}

/**
 * What the phone remembers: an empty text for each that was never saved or is not text. A value saved before names existed has
 * no `name`, so its name is ''. The contact is always '', because the phone never keeps it.
 * @returns {CachedBuilding}
 */
export function getCachedBuilding(storage = safeStorage) {
  const saved = readJson(storage, KEY, null)
  return {
    address: typeof saved?.address === 'string' ? saved.address : '',
    name: typeof saved?.name === 'string' ? saved.name : '',
    privacy_contact: '',
  }
}
