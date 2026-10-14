// "Sign in with Google" for the committee. The browser gets a signed ID token from Google (Google
// Identity Services); the server verifies it here and then checks the e-mail against the admins list.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { ApiError, unauthorized } from './http.js'
import { GOOGLE_PHOTO_HOST, ADMIN_PICTURE_URL_MAX_LENGTH } from './config.js'

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/**
 * The address of a committee member's Google photo as a sign-in may keep it, or null for no photo (owner decision of 14/10/2026:
 * the photo fills the member's circle in the committee app, and the initial stays for a member without one).
 *
 * `value` is the `picture` of a verified ID token. Nobody can forge a verified token, but its photo is still a value from outside
 * that the committee's browsers will load, so it is kept only when it is plainly Google's photo: a string of at most
 * ADMIN_PICTURE_URL_MAX_LENGTH characters, an `https:` address on GOOGLE_PHOTO_HOST (server/config.js), with no user name, no
 * password and no port, and written exactly as the URL parser writes it back (so no white space, no backslash, no upper case in
 * the host, no `:443`, nothing that a browser would read differently from this check). Anything else, a missing photo included,
 * is null: the member signs in as always and the app shows the initial. Never throws, and logs nothing.
 * @param {unknown} value
 * @returns {string | null}
 */
export function googlePhotoUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > ADMIN_PICTURE_URL_MAX_LENGTH) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_PHOTO_HOST) return null
  if (url.port !== '' || url.username !== '' || url.password !== '') return null
  return url.href === value ? value : null
}

/**
 * Builds a verifier for one OAuth client id. `keys` is injectable so tests can sign their own tokens;
 * in production it is Google's published key set (fetched and cached by jose).
 */
export function createGoogleVerifier({ clientId, keys = googleKeys }) {
  return async function verify(credential) {
    if (!clientId) throw new ApiError(503, 'google_not_configured', 'Google sign-in is not configured on the server')
    let payload
    try {
      ;({ payload } = await jwtVerify(credential, keys, { issuer: GOOGLE_ISSUERS, audience: clientId }))
    } catch {
      throw unauthorized('google_invalid', 'Google sign-in could not be verified')
    }
    if (payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string') {
      throw unauthorized('google_email_unverified', 'The Google account e-mail is not verified')
    }
    return {
      email: payload.email.toLowerCase(),
      name: typeof payload.name === 'string' ? payload.name : '',
      sub: payload.sub,
      picture: googlePhotoUrl(payload.picture),
    }
  }
}

let override = null
/** Tests replace the verifier; production leaves this null. */
export const setGoogleVerifier = (fn) => {
  override = fn
}

export const verifyGoogleCredential = (credential) =>
  (override ?? createGoogleVerifier({ clientId: process.env.GOOGLE_CLIENT_ID }))(credential)
