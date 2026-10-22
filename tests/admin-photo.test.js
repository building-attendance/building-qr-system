// The committee member's Google photo (owner decision of 14/10/2026: the photo fills the member's circle in the committee app, and
// the initial stays for a member without one). The `picture` of a verified Google ID token becomes admins.picture_url at every
// Google sign-in, and the committee app reads it from the answer of the sign-in, GET /api/admin/me and GET /api/admin/admins.
// Each check of the threat model has its test here:
//   1. a forged or odd value: googlePhotoUrl keeps only an https address on Google's photo host, at most
//      ADMIN_PICTURE_URL_MAX_LENGTH long, with no user, password or port, written as the URL parser writes it back; anything else
//      is no photo (the same values through a real signed token: tests/google.test.js);
//   2. tracking or mixed content: the same check, and the column itself refuses a longer value (the Content-Security-Policy that
//      names only Google's photo host is pinned in tests/security-headers.test.js, which ties it to GOOGLE_PHOTO_HOST);
//   3. the address leaking to the agent or to a log: no answer of the agent API carries it, the audit entry of the sign-in does not,
//      and neither a sign-in nor a failed one logs it or records it in app_errors;
//   4. a broken sign-in: a token with no photo, or with a photo that is refused, signs in as always, with no photo;
//   5. old clients: the new fields are additions to the answers, the request of the sign-in is what it was, and a photo that a
//      browser sends in the body is ignored (only Google's token gives one).
// The data is fake: the photo addresses are made up and never loaded.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { setupDb, call, adminCookie, mintAgentKey } from './helpers.js'
import { googlePhotoUrl, setGoogleVerifier } from '../server/google.js'
import { GOOGLE_PHOTO_HOST, ADMIN_PICTURE_URL_MAX_LENGTH } from '../server/config.js'
import { AGENT_ENDPOINTS } from '../server/agentEndpoints.js'

const PHOTO = 'https://lh3.googleusercontent.com/a/fake-photo-of-the-first-member=s96-c'
const NEW_PHOTO = 'https://lh3.googleusercontent.com/a/fake-photo-after-a-change=s96-c'
const FIRST = 'first@test.local'
const SECOND = 'second@test.local'

/** The values that must never become a photo, each as Google could put it in the token's `picture`. */
const REFUSED = [
  ['missing', undefined],
  ['null', null],
  ['a number', 7],
  ['a boolean', true],
  ['an object', { href: PHOTO }],
  ['a list', [PHOTO]],
  ['an empty string', ''],
  ['plain http', 'http://lh3.googleusercontent.com/a/fake'],
  ['another host', 'https://tracker.example/pixel.png'],
  ['a host that only starts like Google\'s', 'https://lh3.googleusercontent.com.evil.example/a/fake'],
  ['another host of Google\'s', 'https://lh4.googleusercontent.com/a/fake'],
  ['a sub-domain of the photo host', 'https://x.lh3.googleusercontent.com/a/fake'],
  ['a value that is too long', `https://lh3.googleusercontent.com/a/${'x'.repeat(ADMIN_PICTURE_URL_MAX_LENGTH)}`],
  ['a user name', 'https://someone@lh3.googleusercontent.com/a/fake'],
  ['a user and a password', 'https://someone:secret@lh3.googleusercontent.com/a/fake'],
  ['an odd port', 'https://lh3.googleusercontent.com:8443/a/fake'],
  ['the https port written out', 'https://lh3.googleusercontent.com:443/a/fake'],
  ['a host in capitals', 'https://LH3.googleusercontent.com/a/fake'],
  ['white space around it', ` ${PHOTO}`],
  ['a backslash for a slash', 'https:\\\\lh3.googleusercontent.com/a/fake'],
  ['an address with no scheme', '//lh3.googleusercontent.com/a/fake'],
  ['a data: picture', 'data:image/png;base64,iVBORw0KGgo='],
  ['a javascript: address', 'javascript:alert(1)'],
  ['not an address at all', 'a photo'],
]

let db, cookie

// The verifier of tests/helpers.js (the credential is the e-mail), with a photo: `picture` is what Google's token said.
const defaultGoogle = async (credential) => ({ email: String(credential).toLowerCase(), name: 'Test Admin', sub: 'sub-' + String(credential).toLowerCase() })
const googleGives = (picture) =>
  setGoogleVerifier(async (credential) => ({ ...(await defaultGoogle(credential)), picture }))

const signIn = (email, body = {}) => call('POST', '/api/admin/google', { body: { credential: email, ...body } })
const cookieOf = (answer) => String(answer.headers['set-cookie']).split(';')[0]
const storedPhoto = async (email) => (await db.pool.query('select picture_url from admins where email = $1', [email])).rows[0]?.picture_url
const me = async (asCookie) => (await call('GET', '/api/admin/me', { cookie: asCookie })).json.admin
const members = async () => (await call('GET', '/api/admin/admins', { cookie })).json.admins

beforeAll(async () => {
  db = await setupDb()
  // The first member of this deployment signs in through FIRST_ADMIN_EMAIL with a photo (server/firstAdmin.js adds the member in the
  // transaction of the sign-in, and the photo is written by the same statement as for any member).
  process.env.FIRST_ADMIN_EMAIL = FIRST
  googleGives(PHOTO)
  const first = await signIn(FIRST)
  delete process.env.FIRST_ADMIN_EMAIL
  if (first.status !== 200) throw new Error('the first sign-in failed: ' + first.text)
  cookie = cookieOf(first)
  setGoogleVerifier(defaultGoogle)
  const added = await call('POST', '/api/admin/admins', { cookie, body: { email: SECOND, name: 'Second Member' } })
  if (added.status !== 201) throw new Error('adding a member failed: ' + added.text)
})
afterAll(async () => {
  delete process.env.FIRST_ADMIN_EMAIL
  await db?.teardown()
})
afterEach(() => {
  setGoogleVerifier(defaultGoogle)
  vi.restoreAllMocks()
})

describe('googlePhotoUrl: what may become a photo', () => {
  it("keeps an https address on Google's photo host exactly as it is", () => {
    expect(GOOGLE_PHOTO_HOST).toBe('lh3.googleusercontent.com')
    expect(googlePhotoUrl(PHOTO)).toBe(PHOTO)
    expect(googlePhotoUrl('https://lh3.googleusercontent.com/a-/AOh14GfakeOlderShape=s96-c')).toBe('https://lh3.googleusercontent.com/a-/AOh14GfakeOlderShape=s96-c')
  })

  it.each(REFUSED)('refuses %s', (_name, value) => {
    expect(googlePhotoUrl(value)).toBeNull()
  })

  it('takes an address of exactly the longest length, and refuses one character more', () => {
    expect(ADMIN_PICTURE_URL_MAX_LENGTH).toBe(512)
    const head = 'https://lh3.googleusercontent.com/a/'
    const longest = head + 'x'.repeat(ADMIN_PICTURE_URL_MAX_LENGTH - head.length)
    expect(longest).toHaveLength(ADMIN_PICTURE_URL_MAX_LENGTH)
    expect(googlePhotoUrl(longest)).toBe(longest)
    expect(googlePhotoUrl(longest + 'x')).toBeNull()
  })
})

describe('the column (db/migrations/015_admin_picture_url.sql)', () => {
  const MIGRATION = new URL('../db/migrations/015_admin_picture_url.sql', import.meta.url)

  it('is a nullable text column of admins, with no default: the migration only adds', async () => {
    const { rows } = await db.pool.query(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name = 'admins' and column_name = 'picture_url'`,
    )
    expect(rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/--[^\n]*/g, '')
    expect(sql.match(/\b(alter|create|drop|update|insert|delete|truncate|rename)\b/gi).map((w) => w.toLowerCase())).toEqual(['alter'])
    expect(sql).toMatch(/alter table admins add column picture_url text check \(char_length\(picture_url\) <= (\d+)\);/)
  })

  it('refuses a longer value than the server keeps, whatever writes it', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8')
    expect(Number(sql.match(/char_length\(picture_url\) <= (\d+)/)[1])).toBe(ADMIN_PICTURE_URL_MAX_LENGTH)
    await expect(db.pool.query("update admins set picture_url = repeat('x', $1) where email = $2", [ADMIN_PICTURE_URL_MAX_LENGTH + 1, SECOND]))
      .rejects.toMatchObject({ code: '23514' })
    expect(await storedPhoto(SECOND)).toBeNull()
  })
})

describe('a sign-in with a photo', () => {
  it('stores the photo of the first member of the deployment, and the answers of the committee app carry it', async () => {
    expect(await storedPhoto(FIRST)).toBe(PHOTO)
    expect(await me(cookie)).toMatchObject({ email: FIRST, picture_url: PHOTO })
  })

  it('answers with the photo, stores it, and GET /api/admin/me and the members list give it back', async () => {
    googleGives(PHOTO)
    const answer = await signIn(SECOND)
    expect(answer.status).toBe(200)
    expect(answer.json.admin).toEqual({ id: expect.any(String), email: SECOND, name: 'Second Member', picture_url: PHOTO })
    expect(await storedPhoto(SECOND)).toBe(PHOTO)
    expect(await me(cookieOf(answer))).toEqual(answer.json.admin)
    const second = (await members()).find((m) => m.email === SECOND)
    expect(second.picture_url).toBe(PHOTO)
  })

  it('writes the photo of each sign-in, so a changed photo, and a removed one, follow', async () => {
    googleGives(NEW_PHOTO)
    expect((await signIn(SECOND)).json.admin.picture_url).toBe(NEW_PHOTO)
    expect(await storedPhoto(SECOND)).toBe(NEW_PHOTO)
    googleGives(undefined)
    expect((await signIn(SECOND)).json.admin.picture_url).toBeNull()
    expect(await storedPhoto(SECOND)).toBeNull()
  })

  it('gives every member of the list the field, null for a member with no photo', async () => {
    const list = await members()
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (const member of list) {
      expect(Object.keys(member).sort()).toEqual(['created_at', 'email', 'id', 'is_active', 'last_login_at', 'name', 'picture_url'])
      expect(member.picture_url === null || googlePhotoUrl(member.picture_url) === member.picture_url).toBe(true)
    }
  })

  it('records the sign-in in the audit log with its method only, never the photo', async () => {
    googleGives(PHOTO)
    await signIn(SECOND)
    const { rows } = await db.pool.query("select detail from audit_log where action = 'session.sign_in' order by id desc limit 1")
    expect(rows[0].detail).toEqual({ method: 'google' })
    const all = await db.pool.query('select coalesce(string_agg(detail::text, \' \'), \'\') as text from audit_log')
    expect(all.rows[0].text).not.toContain('googleusercontent')
  })
})

describe('a photo that is missing or refused never stops a sign-in', () => {
  it.each(REFUSED)('a picture that is %s: the member signs in, with no photo', async (_name, value) => {
    googleGives(PHOTO)
    await signIn(SECOND) // a photo that was stored before
    googleGives(value)
    const answer = await signIn(SECOND)
    expect(answer.status).toBe(200)
    expect(answer.json.admin.picture_url).toBeNull()
    expect(await storedPhoto(SECOND)).toBeNull()
    expect((await me(cookieOf(answer))).picture_url).toBeNull()
  })

  it('a verifier that gives no picture field at all (as before this change) signs in with no photo', async () => {
    setGoogleVerifier(defaultGoogle)
    const answer = await signIn(SECOND)
    expect(answer.status).toBe(200)
    expect(answer.json.admin.picture_url).toBeNull()
  })

  it('a refused sign-in writes no photo: not on the list, or another Google account', async () => {
    const before = await storedPhoto(SECOND)
    googleGives(NEW_PHOTO)
    expect((await signIn('stranger@test.local')).json.error.code).toBe('not_an_admin')
    expect(await storedPhoto('stranger@test.local')).toBeUndefined()
    setGoogleVerifier(async () => ({ email: SECOND, name: 'Someone', sub: 'another-google-account', picture: NEW_PHOTO }))
    const mismatch = await signIn(SECOND)
    expect([mismatch.status, mismatch.json.error.code]).toEqual([403, 'google_account_mismatch'])
    expect(await storedPhoto(SECOND)).toBe(before)
  })

  it('a sign-in that fails after the photo was written leaves the photo as it was (one transaction)', async () => {
    googleGives(null)
    await signIn(SECOND)
    googleGives(NEW_PHOTO)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.ownerPool.query('alter table admin_sessions add constraint refuse_session check (false) not valid')
    let answer
    try {
      answer = await signIn(SECOND)
    } finally {
      await db.ownerPool.query('alter table admin_sessions drop constraint refuse_session')
    }
    expect(answer.status).toBe(500)
    expect(await storedPhoto(SECOND)).toBeNull()
  })
})

describe('old clients and what a browser sends', () => {
  it('the request of the sign-in is what it was: a photo in the body is ignored, only the token gives one', async () => {
    setGoogleVerifier(defaultGoogle) // the token has no photo
    const answer = await signIn(SECOND, { picture_url: PHOTO, picture: PHOTO })
    expect(answer.status).toBe(200)
    expect(answer.json.admin.picture_url).toBeNull()
    expect(await storedPhoto(SECOND)).toBeNull()
  })

  it('the fields that the answers had are all still there, with the photo after them', async () => {
    googleGives(PHOTO)
    const answer = await signIn(SECOND)
    expect(Object.keys(answer.json.admin)).toEqual(['id', 'email', 'name', 'picture_url'])
    expect(Object.keys(await me(cookieOf(answer)))).toEqual(['id', 'email', 'name', 'picture_url'])
  })

  it('the local dev sign-in answers with the same fields', async () => {
    process.env.DEV_ADMIN_LOGIN = '1'
    try {
      const answer = await call('POST', '/api/admin/dev-login', { body: { email: FIRST } })
      expect(answer.status).toBe(200)
      expect(answer.json.admin).toEqual({ id: expect.any(String), email: FIRST, name: 'Test Admin', picture_url: PHOTO })
    } finally {
      delete process.env.DEV_ADMIN_LOGIN
    }
  })
})

describe("the installed app keeps no copy of a member's photo", () => {
  it('the service worker precaches the files of the build only, and has no rule that caches what the page loads from elsewhere', () => {
    // vite.config.js: Workbox precaches what globPatterns finds in the build's own folder (relative patterns, no address), and a
    // runtimeCaching rule is the only way that it would keep a picture of another host. There is none, so Google's photo is
    // fetched by the browser like any picture, and the service worker never stores it.
    const config = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '')
    expect(config).not.toMatch(/runtimeCaching|googleusercontent|NetworkFirst|CacheFirst|StaleWhileRevalidate/)
    const patterns = config.match(/globPatterns:\s*\[([^\]]*)\]/)[1]
    expect(patterns).not.toMatch(/:\/\//)
    expect(patterns).toMatch(/^\s*'\*\*\/\*\.\{[a-z0-9,]+\}'\s*$/)
  })
})

describe('the photo never reaches the agent or a log', () => {
  it('no answer of the agent API carries the photo, or a field for it', async () => {
    googleGives(PHOTO)
    await signIn(SECOND)
    expect(await storedPhoto(SECOND)).toBe(PHOTO)
    const { key } = await mintAgentKey(await adminCookie(FIRST), 'the agent')
    const queries = { '/agent/v1/counts': '?from=2026-01-01&to=2026-10-14', '/agent/v1/audit': '?limit=200' }
    const paths = [...AGENT_ENDPOINTS.map((e) => `/api${e.path}${queries[e.path] ?? ''}`), '/api/agent/v1/scans?format=csv', '/api/health/db']
    expect(paths.length).toBeGreaterThanOrEqual(11)
    /** Every key of a JSON answer, at any depth. */
    const keysOf = (value) =>
      value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [...(Array.isArray(value) ? [] : [k]), ...keysOf(v)]) : []
    for (const path of paths) {
      const answer = await call('GET', path, { token: key })
      expect(answer.status, path).toBe(200)
      expect(answer.text, path).not.toContain('googleusercontent')
      // No field for a photo by any name (the text itself may name the migration that added the column: /health/db does).
      expect(keysOf(answer.json).filter((k) => /picture|photo|avatar/i.test(k)), path).toEqual([])
    }
  })

  it("the agent's audit entries of the members' sign-ins name the member and never the photo", async () => {
    const { key } = await mintAgentKey(cookie, 'the agent again')
    const entries = (await call('GET', '/api/agent/v1/audit?entity=admin&limit=200', { token: key })).json.entries
    expect(entries.some((e) => e.action === 'session.sign_in')).toBe(true)
    expect(JSON.stringify(entries)).not.toContain('googleusercontent')
  })

  it('a sign-in with a photo, and one that fails, log nothing of it and record nothing of it', async () => {
    const lines = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      vi.spyOn(console, level).mockImplementation((...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')))
    }
    googleGives(NEW_PHOTO)
    expect((await signIn(SECOND)).status).toBe(200)
    await db.ownerPool.query('alter table admin_sessions add constraint refuse_session check (false) not valid')
    try {
      expect((await signIn(SECOND)).status).toBe(500)
    } finally {
      await db.ownerPool.query('alter table admin_sessions drop constraint refuse_session')
    }
    expect(lines.length, 'the failed sign-in was logged').toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('googleusercontent')
    const recorded = await db.pool.query("select coalesce(string_agg(t::text, ' '), '') as text from app_errors t")
    expect(recorded.rows[0].text).not.toContain('googleusercontent')
  })
})
