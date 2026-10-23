import { safeStorage, readJson } from './storage.js'

// The key has a version suffix, like the others: the shape can change later and the old one is read (or ignored).
// The shape grew without a new key: { address } became { address, name }, then { address, name, privacy_contact }. A phone that
// saved an older one has no `name` or no `privacy_contact`, and each is read as '' (not set); a phone that runs an older version
// of the app reads only the texts it knows out of the new one and ignores the rest.
const KEY = 'qr.building.v1'

/**
 * The building's texts: the name and the address for the header of the provider app, and the committee's contact for its privacy
 * notice.
 * @typedef {object} CachedBuilding
 * @property {string} address  empty means show no address
 * @property {string} name  empty means no name
 * @property {string} privacy_contact  empty means not set (the notice tells the providers to ask the committee's members)
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
 * Remembers the building's texts on the phone, so the header and the privacy notice can show them on the first paint and with no
 * signal. Stored as { address, name, privacy_contact }, and an empty one is stored too (the committee may have cleared it: the phone
 * must follow).
 * @param {CachedBuilding} building
 */
export function setCachedBuilding({ address, name, privacy_contact }, storage = safeStorage) {
  storage.setItem(KEY, JSON.stringify({ address, name, privacy_contact }))
}

/**
 * What the phone remembers: an empty text for each that was never saved or is not text. A value saved before the name or the
 * contact existed has none, so it is ''.
 * @returns {CachedBuilding}
 */
export function getCachedBuilding(storage = safeStorage) {
  const saved = readJson(storage, KEY, null)
  return {
    address: typeof saved?.address === 'string' ? saved.address : '',
    name: typeof saved?.name === 'string' ? saved.name : '',
    privacy_contact: typeof saved?.privacy_contact === 'string' ? saved.privacy_contact : '',
  }
}
