// A provider is written "contact (company)", or the company alone when there is no contact person, and the app writes no en dash
// (owner decision of 14/10/2026). Scans and refused visits are append-only and an entry of the audit log is never changed, so the rows
// written before the decision keep the older form ("company", a space, an en dash, a space, "contact") for ever. This file proves:
//   1. the two functions of shared/providerName.js: the form of today, and the reading of a stored name, with the edges of the split;
//   2. the SQL that the counts read the name with (providerNameSql in server/scans.js) gives exactly what readProviderName gives, for
//      the same texts, in the database;
//   3. end to end, on rows stored in the older form (written straight into the tables, the way the old code wrote them): the
//      committee's History, its CSV, its refused visits and its Home screen, and the agent's scans (JSON and CSV), counts, refused
//      visits and audit log all name the provider in today's form; the old and the new rows of one provider are one group of the
//      counts and one provider of the History filter (by id, never by the name); and a new scan, a new refused visit and the entry of
//      a delete are stored in today's form, while the old rows are left as they were.
// The old separator is built from its code point here: no file of the project holds the character (tests/no-em-dash.test.js).
// The data is fake.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { setupDb, call, seedAdmin, adminCookie, mintAgentKey } from './helpers.js'
import { providerName, readProviderName, OLD_PROVIDER_NAME_SEPARATOR } from '../shared/providerName.js'
import { providerNameSql, providerSnapshotName } from '../server/scans.js'
import { homeDays } from '../server/home.js'
import { TIMEZONE } from '../server/config.js'

const EN_DASH = String.fromCharCode(0x2013)
/** A provider's name as a scan stored it before 14/10/2026. */
const OLD = (company, contact) => `${company} ${EN_DASH} ${contact}`

// ======================================================================================================================
// 1. The two functions
// ======================================================================================================================

describe('the name of a provider in one line', () => {
  it('is "contact (company)", or the company alone when there is no contact person', () => {
    expect(providerName({ company: 'Fake Cleaners', contact_name: 'Fake Person' })).toBe('Fake Person (Fake Cleaners)')
    expect(providerName({ company: 'ניקיון', contact_name: 'ליאור' })).toBe('ליאור (ניקיון)') // the owner's example
    for (const none of ['', null, undefined]) expect(providerName({ company: 'Fake Cleaners', contact_name: none })).toBe('Fake Cleaners')
    expect(providerSnapshotName({ company: 'Fake Cleaners', contact_name: 'Fake Person' })).toBe('Fake Person (Fake Cleaners)') // the snapshot is this form
  })

  it('writes an en dash that the committee typed into a name as a hyphen: the app writes none', () => {
    expect(providerName({ company: `North${EN_DASH}South`, contact_name: `Dana ${EN_DASH} Lee` })).toBe('Dana - Lee (North-South)')
    expect(providerName({ company: `North ${EN_DASH} South`, contact_name: '' })).toBe('North - South')
  })

  it('the old separator is a space, the en dash and a space', () => {
    expect([...OLD_PROVIDER_NAME_SEPARATOR].map((c) => c.charCodeAt(0))).toEqual([0x20, 0x2013, 0x20])
  })
})

// Each stored text and the name it is read as. The edges of the split are the point of this list.
const READ_CASES = [
  [OLD('Fake Cleaners', 'Fake Person'), 'Fake Person (Fake Cleaners)'], // the older form
  [OLD('ניקיון', 'ליאור'), 'ליאור (ניקיון)'],
  [OLD('Уборка', 'Иван'), 'Иван (Уборка)'],
  ['Fake Person (Fake Cleaners)', 'Fake Person (Fake Cleaners)'], // today's form, as it is
  ['Fake Cleaners', 'Fake Cleaners'], // the company alone, in either form
  [OLD(`Cleaning ${EN_DASH} North`, 'Dana'), 'Dana (Cleaning - North)'], // the company held the separator: split at the last one
  [OLD('A', `B ${EN_DASH} C`), 'C (A - B)'], // a contact that held it: every word is there, the parentheses fall one word off
  [OLD('Fake Cleaners', ''), 'Fake Cleaners - '], // nothing after the separator: not a separator of two names
  [`Fake Cleaners ${EN_DASH}`, 'Fake Cleaners -'],
  [` ${EN_DASH} Dana`, ' - Dana'], // nothing before it: not one either
  [` ${EN_DASH} `, ' - '],
  [`North${EN_DASH}South`, 'North-South'], // an en dash with no spaces is not the separator, and is written as a hyphen
  [OLD('a (b)', 'c) & d'), 'c) & d (a (b))'], // brackets and an ampersand are only text
  [OLD('back\\slash \\1', '\\2 x'), '\\2 x (back\\slash \\1)'], // and so is a backslash, also one that looks like a group of a pattern
  [OLD('Line\none', 'two\nlines'), 'two\nlines (Line\none)'], // a line break inside a name
  [OLD('Emoji 🧹', 'Dana 🌿'), 'Dana 🌿 (Emoji 🧹)'],
  [OLD(OLD('x', 'y'), 'z'), 'z (x - y)'],
  ['', ''],
]

describe('reading a stored name', () => {
  it('turns the older form into today\'s, and leaves today\'s as it is', () => {
    for (const [stored, read] of READ_CASES) expect(readProviderName(stored), JSON.stringify(stored)).toBe(read)
  })

  it('gives no en dash, and reading twice gives what reading once gives', () => {
    for (const [stored] of READ_CASES) {
      const once = readProviderName(stored)
      expect(once.includes(EN_DASH), JSON.stringify(stored)).toBe(false)
      expect(readProviderName(once), JSON.stringify(stored)).toBe(once)
    }
  })

  it('a stored name in the older form is read as the snapshot that today\'s code writes for the same provider', () => {
    for (const [company, contact] of [['Fake Cleaners', 'Fake Person'], ['ניקיון', 'ליאור'], ['גינון ירוק', 'שרה ברק']]) {
      expect(readProviderName(OLD(company, contact))).toBe(providerSnapshotName({ company, contact_name: contact }))
    }
  })

  it('leaves what is not a text as it is (a null stays a null)', () => {
    expect(readProviderName(null)).toBe(null)
    expect(readProviderName(undefined)).toBe(undefined)
  })
})

// ======================================================================================================================
// 2. and 3. In the database
// ======================================================================================================================

let db, cookie, agentKey
const world = {}

const post = async (path, body) => {
  const r = await call('POST', path, { cookie, body })
  if (r.status !== 200 && r.status !== 201) throw new Error(`seed ${path}: ${r.status} ${r.text}`)
  return r.json
}
const admin = (path) => call('GET', `/api/admin${path}`, { cookie })
const agent = (path) => call('GET', `/api/agent/v1${path}`, { token: agentKey })

/** Writes a scan straight into the table, the way the code wrote one before 14/10/2026: at 09:00 of `day` in the building. */
async function oldScan({ provider, providerNameStored, day, minute = 0 }) {
  const id = randomUUID()
  await db.pool.query(
    `insert into scans (id, point_id, provider_id, point_name, provider_name, service_type, checked_in_at, local_date, source, outcome, flags)
     values ($1, $2, $3, $4, $5, 'cleaning', (($6::date + make_time(9, $7, 0)) at time zone $8::text), $6::date, 'online', 'accepted', '{}')`,
    [id, world.point.id, provider.id, world.point.name, providerNameStored, day, minute, TIMEZONE],
  )
  return id
}

beforeAll(async () => {
  db = await setupDb()
  await seedAdmin(db.pool)
  cookie = await adminCookie()
  agentKey = (await mintAgentKey(cookie, 'provider names')).key

  world.password = 'pw-fake-names-5521'
  world.p = (await post('/api/admin/providers', { company: 'Fake Cleaners', contact_name: 'Fake Person', password: world.password })).provider
  world.q = (await post('/api/admin/providers', { company: 'Gone Gardeners', contact_name: 'Fake Other', password: 'pw-fake-names-7730' })).provider
  world.point = (await post('/api/admin/points', { name: 'Fake Lobby', gps_mode: 'none' })).point
  world.closed = (await post('/api/admin/points', { name: 'Fake Roof', gps_mode: 'none', is_active: false })).point

  // The seven days of the Home screen, which end today: every visit below is in them, so one range covers every list.
  world.days = homeDays()
  world.range = `from=${world.days[0]}&to=${world.days[6]}`

  // Rows stored in the older form, the way the code wrote them before 14/10/2026.
  world.oldP = await oldScan({ provider: world.p, providerNameStored: OLD('Fake Cleaners', 'Fake Person'), day: world.days[2] })
  world.oldToDelete = await oldScan({ provider: world.p, providerNameStored: OLD('Fake Cleaners', 'Fake Person'), day: world.days[3], minute: 30 })
  world.oldQ = await oldScan({ provider: world.q, providerNameStored: OLD('Gone Gardeners', 'Fake Other'), day: world.days[3] })
  world.oldRefusal = randomUUID()
  await db.pool.query(
    `insert into scan_refusals (scan_id, source, code, provider_id, provider_name, point_id, point_name)
     values ($1, 'online', 'point_inactive', $2, $3, $4, $5)`,
    [world.oldRefusal, world.p.id, OLD('Fake Cleaners', 'Fake Person'), world.closed.id, world.closed.name],
  )
  world.oldEntry = randomUUID() // the scan of an entry of the log written before the decision (that scan is gone)
  await db.pool.query(
    `insert into audit_log (actor_type, actor_id, actor_name, action, entity, entity_id, detail)
     values ('admin', null, 'Test Admin', 'scan.delete', 'scan', $1, $2::jsonb)`,
    [world.oldEntry, JSON.stringify({ point_name: 'Fake Lobby', provider_name: OLD('Fake Cleaners', 'Fake Person'), checked_in_at: new Date().toISOString(), outcome: 'accepted', voided: false })],
  )

  // Today's code: a scan and a refused visit of the provider's phone, the delete of an old scan, and the delete of provider Q.
  const session = await call('POST', '/api/session', { body: { provider_id: world.p.id, password: world.password, device_label: 'Fake Browser' } })
  if (session.status !== 200) throw new Error(`sign-in: ${session.status} ${session.text}`)
  world.newScan = randomUUID()
  const scanned = await call('POST', '/api/scan', { token: session.json.token, body: { id: world.newScan, code: world.point.qr_token } })
  if (scanned.status !== 200) throw new Error(`scan: ${scanned.status} ${scanned.text}`)
  world.newRefusal = randomUUID()
  const refused = await call('POST', '/api/scan', { token: session.json.token, body: { id: world.newRefusal, code: world.closed.qr_token } })
  if (refused.json?.error?.code !== 'point_inactive') throw new Error(`refusal: ${refused.status} ${refused.text}`)
  expect((await call('DELETE', `/api/admin/scans/${world.oldToDelete}`, { cookie })).status).toBe(200)
  expect((await call('DELETE', `/api/admin/providers/${world.q.id}`, { cookie })).status).toBe(200)
}, 120_000)

afterAll(async () => db?.teardown())

describe('the SQL of the counts reads a name as readProviderName does', () => {
  it('gives the same text for every case, in the database', async () => {
    const texts = READ_CASES.map(([stored]) => stored)
    const { rows } = await db.pool.query(
      `select ${providerNameSql('x.t')} as name from unnest($1::text[]) with ordinality as x(t, n) order by x.n`,
      [texts],
    )
    expect(rows.map((r) => r.name)).toEqual(texts.map(readProviderName))
  })
})

describe('what is stored', () => {
  it('a new scan, a new refused visit and the entry of a delete are stored in today\'s form; the old rows are left as they were', async () => {
    const one = async (sql, params) => (await db.pool.query(sql, params)).rows[0]
    expect((await one('select provider_name from scans where id = $1', [world.newScan])).provider_name).toBe('Fake Person (Fake Cleaners)')
    expect((await one('select provider_name from scan_refusals where scan_id = $1', [world.newRefusal])).provider_name).toBe('Fake Person (Fake Cleaners)')
    // The scan that was deleted held the older form: its entry holds today's.
    const entry = await one(`select detail->>'provider_name' as name from audit_log where action = 'scan.delete' and entity_id = $1`, [world.oldToDelete])
    expect(entry.name).toBe('Fake Person (Fake Cleaners)')
    // Append-only: nothing rewrote a row of before.
    expect((await one('select provider_name from scans where id = $1', [world.oldP])).provider_name).toBe(OLD('Fake Cleaners', 'Fake Person'))
    expect((await one('select provider_name from scan_refusals where scan_id = $1', [world.oldRefusal])).provider_name).toBe(OLD('Fake Cleaners', 'Fake Person'))
    expect((await one(`select detail->>'provider_name' as name from audit_log where entity_id = $1`, [world.oldEntry])).name).toBe(OLD('Fake Cleaners', 'Fake Person'))
  })
})

describe('the committee app reads every row in today\'s form', () => {
  it('the History: the old and the new rows of a provider, by its id, with one name', async () => {
    const all = await admin(`/scans?${world.range}`)
    expect(all.status).toBe(200)
    const names = Object.fromEntries(all.json.scans.map((s) => [s.id, s.provider_name]))
    expect(names).toEqual({ [world.oldP]: 'Fake Person (Fake Cleaners)', [world.newScan]: 'Fake Person (Fake Cleaners)', [world.oldQ]: 'Fake Other (Gone Gardeners)' })
    expect(all.text.includes(EN_DASH)).toBe(false)
    // The filter is the provider's id (#199): the old and the new rows come together, never split by their stored text.
    const mine = await admin(`/scans?${world.range}&provider_id=${world.p.id}`)
    expect(mine.json.scans.map((s) => s.id).sort()).toEqual([world.oldP, world.newScan].sort())
  })

  it('the CSV of the History', async () => {
    const csv = await admin(`/scans?${world.range}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('Fake Person (Fake Cleaners)')
    expect(csv.text).toContain('Fake Other (Gone Gardeners)')
    expect(csv.text.includes(EN_DASH)).toBe(false)
  })

  it('the visits that were not counted', async () => {
    const list = await admin(`/scan-refusals?${world.range}`)
    expect(list.status).toBe(200)
    const names = Object.fromEntries(list.json.refusals.map((r) => [r.scan_id, r.provider_name]))
    expect(names).toEqual({ [world.oldRefusal]: 'Fake Person (Fake Cleaners)', [world.newRefusal]: 'Fake Person (Fake Cleaners)' })
    expect(list.text.includes(EN_DASH)).toBe(false)
  })

  it('the Home screen: a deleted provider is named by the name its visits kept, in today\'s form', async () => {
    const home = await admin('/home')
    expect(home.status).toBe(200)
    const gone = home.json.week.providers.find((p) => p.id === world.q.id)
    expect(gone).toMatchObject({ name: 'Fake Other (Gone Gardeners)', company: null, is_active: false })
    const listed = home.json.week.providers.find((p) => p.id === world.p.id)
    expect(listed).toMatchObject({ name: 'Fake Person', company: 'Fake Cleaners' }) // a provider on the list is named by its row
    expect(listed.counts.reduce((a, b) => a + b, 0)).toBe(2) // the old row and the new one, one provider
    expect(home.text.includes(EN_DASH)).toBe(false)
  })
})

describe('the agent reads every row in today\'s form: one format of provider_name', () => {
  it('/scans, as JSON and as CSV', async () => {
    const json = await agent(`/scans?${world.range}`)
    expect(json.status).toBe(200)
    expect(Object.fromEntries(json.json.scans.map((s) => [s.id, s.provider_name]))).toEqual({
      [world.oldP]: 'Fake Person (Fake Cleaners)', [world.newScan]: 'Fake Person (Fake Cleaners)', [world.oldQ]: 'Fake Other (Gone Gardeners)',
    })
    expect(json.text.includes(EN_DASH)).toBe(false)
    const csv = await agent(`/scans?${world.range}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('Fake Person (Fake Cleaners)')
    expect(csv.text.includes(EN_DASH)).toBe(false)
  })

  it('/counts: one group for each provider across the two forms, with one name', async () => {
    const r = await agent(`/counts?${world.range}&group_by=provider`)
    expect(r.status).toBe(200)
    expect(r.json.counts.map((row) => [row.provider_id, row.provider_name, row.count])).toEqual([
      [world.q.id, 'Fake Other (Gone Gardeners)', 1],
      [world.p.id, 'Fake Person (Fake Cleaners)', 2],
    ])
    // Only the day of the old row: the name of the group is in today's form all the same.
    const old = await agent(`/counts?from=${world.days[2]}&to=${world.days[2]}&group_by=provider`)
    expect(old.json.counts.map((row) => row.provider_name)).toEqual(['Fake Person (Fake Cleaners)'])
    expect(r.text.includes(EN_DASH) || old.text.includes(EN_DASH)).toBe(false)
  })

  it('/refusals', async () => {
    const r = await agent(`/refusals?${world.range}`)
    expect(r.status).toBe(200)
    expect(Object.fromEntries(r.json.refusals.map((x) => [x.scan_id, x.provider_name]))).toEqual({
      [world.oldRefusal]: 'Fake Person (Fake Cleaners)', [world.newRefusal]: 'Fake Person (Fake Cleaners)',
    })
    expect(r.text.includes(EN_DASH)).toBe(false)
  })

  it('/audit: the detail of a delete, also of an entry written before the decision, and the name of a provider', async () => {
    const r = await agent('/audit?group=scan')
    expect(r.status).toBe(200)
    const deletes = Object.fromEntries(r.json.entries.filter((e) => e.action === 'scan.delete').map((e) => [e.entity_id, e.detail.provider_name]))
    expect(deletes).toEqual({ [world.oldEntry]: 'Fake Person (Fake Cleaners)', [world.oldToDelete]: 'Fake Person (Fake Cleaners)' })
    const providers = await agent(`/audit?entity=provider&entity_id=${world.p.id}`)
    expect(providers.json.entries.map((e) => e.entity_name)).toEqual(['Fake Person (Fake Cleaners)']) // its create: the current name
    expect(r.text.includes(EN_DASH) || providers.text.includes(EN_DASH)).toBe(false)
  })
})
