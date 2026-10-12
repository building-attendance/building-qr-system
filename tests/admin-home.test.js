// GET /api/admin/home: the numbers of the committee's Home screen in one request (server/home.js). The app records facts and does not
// analyse, so the answer is counts, and every count is one that another screen shows already. The rule that holds it together is that
// NOTHING IS DEFINED AGAIN: the week table is countsQuery over scanWhere (the History's conditions), the refused visits are
// listRefusals' own conditions, the waiting phones are the Providers screen's phone health, and the providers come in its order.
// What this file proves:
//   1. the week table equals the History: for every provider row and every day, the cell is the number of rows that GET /admin/scans
//      returns for that provider and that day, and each total is the number of rows for that day, with no provider filter;
//   2. who gets a row: every active provider, also one with no visit (seven zeros); an inactive provider only when it had a visit in
//      the seven days (and then also a later window that holds a visit it had); a provider that was deleted, whose visits stay, last, with
//      the name its visits kept; the demo account never; and the rows are in the order of the Providers screen;
//   3. what is not counted: voided visits, the demo account's visits (and any visit flagged demo), refused outcomes, and the days just
//      outside the window (a minute before its first day, a minute after its last);
//   4. the seven days around midnight in the building's time zone, with an injected `now` one second before and one second after
//      midnight, across the two nights that change the clocks (a day of 23 hours and a day of 25 hours), where taking 24 hours away
//      from a moment would skip or repeat a day;
//   5. each count in `counts` against seeded rows: points and providers (active and total), committee members, agent keys, the visits
//      not counted (the very rows that GET /admin/scan-refusals returns from the first day to the last), and the waiting phones and visits
//      (the sum of what the Providers screen shows);
//   6. everything is read in one read-only transaction, and the shape: exactly the documented fields, no id of anything but a provider,
//      nothing secret in the text of the answer;
//   7. the route is the committee's: no session, a made-up one and an agent key are all refused with 401.
// It runs against the throwaway schema like the other API tests. The data is fake.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { setupDb, call, seedAdmin, adminCookie, mintAgentKey, revokeAgentKey } from './helpers.js'
import { getPool, setPool } from '../server/db.js'
import { sha256 } from '../server/crypto.js'
import { providerSnapshotName } from '../server/scans.js'
import { buildHome, homeDays, HOME_DAYS } from '../server/home.js'
import { ADMIN_COOKIE, ADMIN_TOKEN_PREFIX, API_KEY_PREFIX } from '../server/config.js'
import { QR_TOKEN_PREFIX } from '../shared/contract.js'

// "Now" for the route: 12:00 in the building on 2026-10-12, the middle of the day, so that the seven days are 06/10 to 12/10.
const NOW = new Date('2026-10-12T09:00:00Z')
const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']

const FAKE_LABEL = 'Mozilla/5.0 (Fake; Phone-Marker-7731) FakeBrowser/1.0'
const PROVIDER_ROW_KEYS = ['id', 'name', 'company', 'is_active', 'counts']

describe('GET /api/admin/home', () => {
  let db
  let cookie
  const ids = {} // the providers and points of the seed, by the letter used below
  const rowsOf = (home) => home.week.providers
  const rowFor = (home, who) => rowsOf(home).find((row) => row.id === ids[who])

  const get = async () => {
    const r = await call('GET', '/api/admin/home', { cookie })
    if (r.status !== 200) throw new Error(`GET /api/admin/home: ${r.status} ${r.text}`)
    return r
  }
  const post = async (path, body) => {
    const r = await call('POST', path, { cookie, body })
    if (r.status !== 200 && r.status !== 201) throw new Error(`seed ${path}: ${r.status} ${r.text}`)
    return r.json
  }
  const patch = async (path, body) => {
    const r = await call('PATCH', path, { cookie, body })
    if (r.status !== 200) throw new Error(`seed ${path}: ${r.status} ${r.text}`)
    return r.json
  }
  /** Every row that the committee's list returns for a query string, paged to the end. */
  const pages = async (path, key, qs) => {
    const all = []
    let cursor
    for (let page = 0; page < 50; page++) {
      const r = await call('GET', `${path}?${qs}&limit=500${cursor ? `&cursor=${cursor}` : ''}`, { cookie })
      if (r.status !== 200) throw new Error(`GET ${path}?${qs}: ${r.status} ${r.text}`)
      all.push(...r.json[key])
      cursor = r.json.next_cursor
      if (!cursor) return all
    }
    throw new Error(`GET ${path} did not end`)
  }
  const history = (qs) => pages('/api/admin/scans', 'scans', qs)

  beforeAll(async () => {
    db = await setupDb()
    await seedAdmin(db.pool)
    cookie = await adminCookie()
    const q = (text, params) => db.pool.query(text, params)

    // ---- providers, in an order of creation that is not the order of the Providers screen ----
    const make = async (key, body) => {
      ids[key] = (await post('/api/admin/providers', { password: 'pw-fake-secret-4821', ...body })).provider.id
    }
    await make('B', { company: 'Bright Gardeners' })
    await make('C', { company: 'Cobalt Painters' }) // no visit at all
    await make('A1', { company: 'Acme Cleaners', contact_name: 'Dana' })
    await make('A2', { company: 'Acme Cleaners', contact_name: 'Avi' })
    await make('D', { company: 'Dormant Movers', contact_name: 'Eli' }) // switched off below, has visits in the window
    await make('E', { company: 'Echo Locksmiths' }) // switched off below, visits only just outside the window
    await make('F', { company: 'Fable Demo', is_demo: true })
    await make('G', { company: 'Gone Plumbers', contact_name: 'Gil' }) // deleted below, its visits stay
    await patch(`/api/admin/providers/${ids.D}`, { is_active: false })
    await patch(`/api/admin/providers/${ids.E}`, { is_active: false })

    // ---- points: three, one switched off ----
    for (const [key, name] of [['atrium', 'Atrium'], ['basement', 'Basement'], ['courtyard', 'Courtyard']]) {
      ids[key] = (await post('/api/admin/points', { name, gps_mode: 'none' })).point.id
    }
    await patch(`/api/admin/points/${ids.courtyard}`, { is_active: false })

    // ---- the visits, written straight into the table: a building day and a time of day in the building's zone ----
    const names = {
      A1: providerSnapshotName({ company: 'Acme Cleaners', contact_name: 'Dana' }),
      A2: providerSnapshotName({ company: 'Acme Cleaners', contact_name: 'Avi' }),
      B: 'Bright Gardeners',
      D: providerSnapshotName({ company: 'Dormant Movers', contact_name: 'Eli' }),
      E: 'Echo Locksmiths',
      F: 'Fable Demo',
      G: providerSnapshotName({ company: 'Gone Plumbers', contact_name: 'Gil' }),
    }
    const pointNames = { atrium: 'Atrium', basement: 'Basement' }
    const seeded = []
    const visit = (who, day, clock, extra = {}) =>
      seeded.push({
        id: randomUUID(),
        provider_id: ids[who],
        provider_name: names[who],
        point_id: ids[extra.point ?? 'atrium'],
        point_name: pointNames[extra.point ?? 'atrium'],
        day,
        clock,
        outcome: extra.outcome ?? 'accepted',
        flags: extra.flags ?? [],
        voided: extra.voided ?? false,
      })
    // Acme/Dana: counted on 06/10 (twice), 08/10 (once), 12/10 (three times, the last one at 23:50).
    visit('A1', '2026-10-06', '07:10')
    visit('A1', '2026-10-06', '07:40', { point: 'basement' })
    visit('A1', '2026-10-08', '07:10')
    visit('A1', '2026-10-12', '06:30')
    visit('A1', '2026-10-12', '12:15', { point: 'basement' })
    visit('A1', '2026-10-12', '23:50')
    // ...and what must not be counted: voided, refused outcomes, flagged demo, and the minutes just outside the seven days.
    visit('A1', '2026-10-06', '08:00', { voided: true })
    visit('A1', '2026-10-06', '09:00', { outcome: 'rejected_far' })
    visit('A1', '2026-10-07', '09:00', { outcome: 'rejected_no_location' })
    visit('A1', '2026-10-06', '10:00', { flags: ['demo'] })
    visit('A1', '2026-10-05', '23:50') // the day before the first day
    visit('A1', '2026-10-13', '00:10') // the day after the last day
    // Acme/Avi: once, on 09/10. Bright: 07/10 and just after midnight on 12/10 (which belongs to 12/10, not to 11/10).
    visit('A2', '2026-10-09', '11:00')
    visit('B', '2026-10-07', '13:00')
    visit('B', '2026-10-12', '00:05')
    // Dormant (switched off): twice on 10/10. Echo (switched off): only the minutes just outside the window. Gone (deleted): 11/10.
    visit('D', '2026-10-10', '09:00')
    visit('D', '2026-10-10', '09:30')
    visit('E', '2026-10-05', '23:55')
    visit('E', '2026-10-13', '00:05')
    visit('G', '2026-10-11', '08:00')
    visit('G', '2026-10-11', '08:30')
    // The demo account: its visits are flagged demo, as recordScan flags them, and are hidden everywhere.
    visit('F', '2026-10-12', '09:00', { flags: ['demo'] })
    await q(
      `insert into scans (id, point_id, provider_id, point_name, provider_name, service_type, checked_in_at, local_date, source, outcome, flags, voided_at, void_reason)
       select r.id, r.point_id, r.provider_id, r.point_name, r.provider_name, null,
              ((r.day + r.clock) at time zone 'Asia/Jerusalem'), r.day, 'online', r.outcome,
              array(select jsonb_array_elements_text(r.flags)), case when r.voided then now() end, case when r.voided then 'fake reason' end
         from jsonb_to_recordset($1::jsonb)
           as r(id uuid, point_id uuid, provider_id uuid, point_name text, provider_name text, day date, clock time, outcome text, flags jsonb, voided boolean)`,
      [JSON.stringify(seeded)],
    )
    expect((await call('DELETE', `/api/admin/providers/${ids.G}`, { cookie })).status).toBe(200)

    // ---- the committee: three people on the list, one of them switched off ----
    await q('insert into admins (email, name) values ($1, $2)', ['second.member@example.test', 'Second Member'])
    await q('insert into admins (email, name, is_active) values ($1, $2, false)', ['former.member@example.test', 'Former Member'])

    // ---- agent keys: two, one revoked ----
    await mintAgentKey(cookie, 'kept key')
    const revoked = await mintAgentKey(cookie, 'revoked key')
    await revokeAgentKey(cookie, revoked.id)

    // ---- refused visits: three inside the seven days and two just outside (a minute before, a minute after, in the building's zone) ----
    const refuse = (at, who = 'A1') =>
      q(
        `insert into scan_refusals (at, source, code, provider_id, provider_name, point_id, point_name)
         values ($1::timestamptz, 'offline_sync', 'point_inactive', $2, $3, $4, 'Courtyard')`,
        [at, ids[who], names[who], ids.courtyard],
      )
    await refuse('2026-10-05T21:05:00Z') // 06/10 00:05 in the building: the first minutes of the first day
    await refuse('2026-10-09T10:00:00Z', 'B')
    await refuse('2026-10-12T20:55:00Z', 'B') // 12/10 23:55: the last minutes of the last day
    await refuse('2026-10-05T20:55:00Z') // 05/10 23:55
    await refuse('2026-10-12T21:05:00Z') // 13/10 00:05
    // The two nights that change the clocks: 23:30 and 00:30 around the end of the 25-hour day of 25/10/2026, and 23:59 and 00:00
    // around the end of the 23-hour day of 26/03/2027 (the building's midnight is not at the same UTC hour on the two sides).
    await refuse('2026-10-25T21:30:00Z') // 25/10 23:30
    await refuse('2026-10-25T22:30:00Z') // 26/10 00:30
    await refuse('2027-03-26T20:59:00Z') // 26/03 23:59
    await refuse('2027-03-26T21:00:00Z') // 27/03 00:00

    // ---- phones: which have visits waiting ----
    const phone = (who, waiting, { revoked = false } = {}) =>
      q(
        `insert into provider_devices (provider_id, token_hash, label, waiting_count, revoked_at)
         values ($1, $2, $3, $4, case when $5::boolean then now() end)`,
        [ids[who], sha256(randomUUID()), FAKE_LABEL, waiting, revoked],
      )
    await phone('A1', 2)
    await phone('A1', 0) // reported, nothing waits
    await phone('B', 3)
    await phone('B', 5, { revoked: true }) // signed out: its queue is not counted
    await phone('C', null) // an old app that reports nothing
    await phone('D', 1) // the provider is switched off, the phone is still signed in: the Providers screen shows it, so it counts

    // The route reads the clock of the building at the moment of the request: stop it at NOW (only Date; timers and the pool run).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  }, 120_000)

  afterAll(async () => {
    vi.useRealTimers()
    await db?.teardown()
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 1. the week table equals the History
  // ------------------------------------------------------------------------------------------------------------------------------

  it('the seven days end today in the building, the oldest first', async () => {
    const { json } = await get()
    expect(json.days).toEqual(DAYS)
    expect(json.days.length).toBe(HOME_DAYS)
  })

  it('has the counts that the seed was built to give, row by row', async () => {
    const { json } = await get()
    expect(rowsOf(json).map((row) => [row.name, row.company, row.is_active, row.counts])).toEqual([
      ['Avi', 'Acme Cleaners', true, [0, 0, 0, 1, 0, 0, 0]],
      ['Dana', 'Acme Cleaners', true, [2, 0, 1, 0, 0, 0, 3]],
      ['Bright Gardeners', 'Bright Gardeners', true, [0, 1, 0, 0, 0, 0, 1]],
      ['Cobalt Painters', 'Cobalt Painters', true, [0, 0, 0, 0, 0, 0, 0]],
      ['Eli', 'Dormant Movers', false, [0, 0, 0, 0, 2, 0, 0]],
      [providerSnapshotName({ company: 'Gone Plumbers', contact_name: 'Gil' }), null, false, [0, 0, 0, 0, 0, 2, 0]],
    ])
    expect(json.week.totals).toEqual([2, 1, 1, 1, 2, 2, 4])
  })

  it('every cell is the number of rows that the History returns for that provider and that day, and every total for that day', async () => {
    const { json } = await get()
    let cells = 0
    for (const row of rowsOf(json)) {
      for (const [i, day] of json.days.entries()) {
        const scans = await history(`from=${day}&to=${day}&provider_id=${row.id}`)
        expect(row.counts[i], `${row.name} on ${day}`).toBe(scans.length)
        cells += 1
      }
    }
    expect(cells).toBe(rowsOf(json).length * HOME_DAYS)
    for (const [i, day] of json.days.entries()) {
      expect(json.week.totals[i], `total on ${day}`).toBe((await history(`from=${day}&to=${day}`)).length)
      expect(rowsOf(json).reduce((sum, row) => sum + row.counts[i], 0), `the rows of ${day}`).toBe(json.week.totals[i])
    }
    // The whole window at once is the sum of the totals.
    expect((await history(`from=${json.days[0]}&to=${json.days[6]}`)).length).toBe(json.week.totals.reduce((a, b) => a + b, 0))
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 2. who gets a row
  // ------------------------------------------------------------------------------------------------------------------------------

  it('a provider with no visit is there with seven zeros', async () => {
    const { json } = await get()
    const cobalt = rowFor(json, 'C')
    expect(cobalt).toMatchObject({ name: 'Cobalt Painters', company: 'Cobalt Painters', is_active: true })
    expect(cobalt.counts).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('an inactive provider is there only when it had a visit in the seven days', async () => {
    const { json } = await get()
    expect(rowFor(json, 'D')).toMatchObject({ is_active: false, counts: [0, 0, 0, 0, 2, 0, 0] }) // two visits on 10/10
    expect(rowFor(json, 'E')).toBeUndefined() // only the minutes before the first day and after the last
    // A window that holds the visit it had just after the last day: now it is there, with that one visit.
    const later = await buildHome({ now: new Date('2026-10-17T09:00:00Z') })
    expect(later.days).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'])
    expect(rowFor(later, 'E')).toMatchObject({ name: 'Echo Locksmiths', is_active: false, counts: [0, 0, 1, 0, 0, 0, 0] })
    expect(rowFor(later, 'D')).toBeUndefined() // its visits are before this window
  })

  it('a deleted provider whose visits are in the window has a row at the end, with the name its visits kept', async () => {
    const { json } = await get()
    const last = rowsOf(json).at(-1)
    expect(last).toEqual({
      id: ids.G,
      name: providerSnapshotName({ company: 'Gone Plumbers', contact_name: 'Gil' }),
      company: null,
      is_active: false,
      counts: [0, 0, 0, 0, 0, 2, 0],
    })
    // It is not on the Providers screen any more, and the rows still add up to the totals.
    const listed = (await call('GET', '/api/admin/providers', { cookie })).json.providers
    expect(listed.some((p) => p.id === ids.G)).toBe(false)
    expect(json.week.totals[5]).toBe(2)
  })

  it('the demo account has no row: its visits are hidden everywhere, so a row of zeros would say it never came', async () => {
    const { json } = await get()
    expect(rowFor(json, 'F')).toBeUndefined()
    // It is a provider all the same: the Providers screen lists it, and so does the count of providers.
    expect((await call('GET', '/api/admin/providers', { cookie })).json.providers.some((p) => p.id === ids.F)).toBe(true)
  })

  it('the rows are in the order of the Providers screen', async () => {
    const { json } = await get()
    const screen = (await call('GET', '/api/admin/providers', { cookie })).json.providers.map((p) => p.id)
    const home = rowsOf(json).map((row) => row.id).filter((id) => id !== ids.G) // the deleted one is not on the screen
    expect(home).toEqual(screen.filter((id) => home.includes(id)))
    // The switched-on providers come first, then by company and contact: Acme/Avi before Acme/Dana, though Dana was made first.
    expect(home).toEqual([ids.A2, ids.A1, ids.B, ids.C, ids.D])
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 3. what is not counted
  // ------------------------------------------------------------------------------------------------------------------------------

  it('does not count voided visits, refused outcomes, demo visits or the days just outside the window', async () => {
    const { json } = await get()
    // Dana has 12 rows in the table: 6 counted, one voided, two refused, one flagged demo, two outside the window.
    expect((await db.pool.query('select count(*)::int as n from scans where provider_id = $1', [ids.A1])).rows[0].n).toBe(12)
    expect(rowFor(json, 'A1').counts.reduce((a, b) => a + b, 0)).toBe(6)
    expect(rowFor(json, 'A1').counts[0]).toBe(2) // 06/10: two counted of five rows
    // Nothing the demo account did is in the totals: 12/10 has Dana's three and Bright's one.
    expect(json.week.totals[6]).toBe(4)
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 4. the seven days around midnight in the building's time zone
  // ------------------------------------------------------------------------------------------------------------------------------

  describe('the seven days around midnight in the building', () => {
    it('one second before midnight is still the old day, and midnight is the new one', async () => {
      const before = await buildHome({ now: new Date('2026-10-11T20:59:59Z') }) // 11/10 23:59:59 (UTC+3)
      const after = await buildHome({ now: new Date('2026-10-11T21:00:00Z') }) // 12/10 00:00:00
      expect(before.days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
      expect(after.days).toEqual(DAYS)
    })

    it('the window moves with the days: what is on the edge is counted in the one window and not in the other', async () => {
      const before = await buildHome({ now: new Date('2026-10-11T20:59:59Z') })
      const after = await buildHome({ now: new Date('2026-10-11T21:00:00Z') })
      // Echo's visit at 23:55 on 05/10 is the first day of the old window; Bright's at 00:05 on 12/10 is the last of the new one.
      expect(rowFor(before, 'E')).toMatchObject({ counts: [1, 0, 0, 0, 0, 0, 0] })
      expect(rowFor(after, 'E')).toBeUndefined()
      expect(rowFor(before, 'B').counts).toEqual([0, 0, 1, 0, 0, 0, 0]) // 07/10; 12/10 is not in the window
      expect(rowFor(after, 'B').counts).toEqual([0, 1, 0, 0, 0, 0, 1])
      expect(before.week.totals).toEqual([2, 2, 1, 1, 1, 2, 2]) // 05/10 holds Echo's visit and Dana's of 23:50; 12/10 is not in it
      expect(after.week.totals).toEqual([2, 1, 1, 1, 2, 2, 4])
    })

    it('a moment just after midnight and one just before the next midnight are the same day', () => {
      expect(homeDays(new Date('2026-10-11T21:00:00Z')).at(-1)).toBe('2026-10-12') // 00:00:00
      expect(homeDays(new Date('2026-10-12T20:59:59Z')).at(-1)).toBe('2026-10-12') // 23:59:59
      expect(homeDays(new Date('2026-10-12T21:00:00Z')).at(-1)).toBe('2026-10-13')
    })

    it('the night the clocks go forward (a day of 23 hours): no day is skipped', () => {
      // 27/03/2027 00:30 in the building. 24 hours before it is 25/03 23:30, so a window made by taking 24 hours away would skip 26/03.
      expect(homeDays(new Date('2027-03-26T21:30:00Z'))).toEqual([
        '2027-03-21', '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27',
      ])
    })

    it('the night the clocks go back (a day of 25 hours): no day is repeated', () => {
      // 26/10/2026 00:30, the night after the 25-hour day of 25/10.
      expect(homeDays(new Date('2026-10-25T22:30:00Z'))).toEqual([
        '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
      ])
      expect(homeDays(new Date('2026-10-25T21:59:59Z')).at(-1)).toBe('2026-10-25') // 23:59:59 on the long day
      expect(homeDays(new Date('2026-10-25T22:00:00Z')).at(-1)).toBe('2026-10-26')
    })

    it('a window across the end of a month and of a year', () => {
      expect(homeDays(new Date('2026-03-03T09:00:00Z'))).toEqual([
        '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03',
      ])
      expect(homeDays(new Date('2028-01-02T09:00:00Z'))).toEqual([
        '2027-12-27', '2027-12-28', '2027-12-29', '2027-12-30', '2027-12-31', '2028-01-01', '2028-01-02',
      ])
      expect(homeDays(new Date('2028-03-02T09:00:00Z'))[0]).toBe('2028-02-25') // a leap year has a 29th
    })
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 5. each count
  // ------------------------------------------------------------------------------------------------------------------------------

  describe('counts', () => {
    it('points: active and total', async () => {
      const { json } = await get()
      expect(json.counts.points).toEqual({ active: 2, total: 3 })
      const screen = (await call('GET', '/api/admin/points', { cookie })).json.points
      expect(json.counts.points).toEqual({ active: screen.filter((p) => p.is_active).length, total: screen.length })
    })

    it('providers: active and total, as the Providers screen lists them (the demo account included, a deleted one not)', async () => {
      const { json } = await get()
      expect(json.counts.providers).toEqual({ active: 5, total: 7 }) // Bright, Cobalt, Acme x2 and Fable are on; Dormant and Echo are off
      const screen = (await call('GET', '/api/admin/providers', { cookie })).json.providers
      expect(json.counts.providers).toEqual({ active: screen.filter((p) => p.is_active).length, total: screen.length })
    })

    it('committee members: the active ones', async () => {
      const { json } = await get()
      expect(json.counts.committee_members).toEqual({ active: 2 }) // the one who signed in and the second; the former one is off
      const screen = (await call('GET', '/api/admin/admins', { cookie })).json.admins
      expect(screen.length).toBe(3)
      expect(json.counts.committee_members.active).toBe(screen.filter((a) => a.is_active).length)
    })

    it('agent keys: the ones that are not revoked', async () => {
      const { json } = await get()
      expect(json.counts.agent_keys).toEqual({ active: 1 })
      const screen = (await call('GET', '/api/admin/api-keys', { cookie })).json.api_keys
      expect(screen.length).toBe(2)
      expect(json.counts.agent_keys.active).toBe(screen.filter((k) => k.revoked_at === null).length)
    })

    it('visits not counted: the refused visits of the seven days, the very rows the committee lists for them', async () => {
      const { json } = await get()
      expect(json.counts.visits_not_counted).toBe(3) // 00:05 on the first day, the middle, 23:55 on the last; not the two outside
      const listed = await pages('/api/admin/scan-refusals', 'refusals', `from=${json.days[0]}&to=${json.days[6]}`)
      expect(listed.length).toBe(json.counts.visits_not_counted)
      // The edges are the edges of a building day: one more refusal a minute outside either end is not in it.
      expect((await pages('/api/admin/scan-refusals', 'refusals', 'from=2026-10-05&to=2026-10-13')).length).toBe(5)
    })

    it('visits not counted: for any window, the rows the committee lists from its first day to its last', async () => {
      for (const iso of ['2026-10-06T09:00:00Z', '2026-10-11T09:00:00Z', '2026-10-12T20:59:59Z', '2026-10-12T21:00:00Z', '2026-10-17T09:00:00Z']) {
        const home = await buildHome({ now: new Date(iso) })
        const listed = await pages('/api/admin/scan-refusals', 'refusals', `from=${home.days[0]}&to=${home.days[6]}`)
        expect(home.counts.visits_not_counted, iso).toBe(listed.length)
      }
      // The windows differ: 30/09 to 06/10 holds the last minutes of 05/10 and the first of 06/10; 11/10 to 17/10 holds 12/10 23:55 and 13/10 00:05.
      expect((await buildHome({ now: new Date('2026-10-06T09:00:00Z') })).counts.visits_not_counted).toBe(2)
      expect((await buildHome({ now: new Date('2026-10-17T09:00:00Z') })).counts.visits_not_counted).toBe(2)
    })

    it('visits not counted: a day of 25 hours and a day of 23 hours end at the midnight of the building', async () => {
      const count = async (iso) => (await buildHome({ now: new Date(iso) })).counts.visits_not_counted
      expect(await count('2026-10-25T21:59:59Z')).toBe(1) // 25/10 23:59:59: the window ends with 25/10, and holds the 23:30 visit only
      expect(await count('2026-10-25T22:00:00Z')).toBe(2) // 26/10 00:00:00: the 00:30 visit is in the window now
      expect(await count('2027-03-26T20:59:30Z')).toBe(1) // 26/03 23:59:30: the 23:59 visit
      expect(await count('2027-03-26T21:00:00Z')).toBe(2) // 27/03 00:00:00: and the one at 00:00
    })

    it('waiting: the active phones that have visits waiting, and how many visits wait, as the Providers screen adds them up', async () => {
      const { json } = await get()
      expect(json.counts.waiting).toEqual({ phones: 3, visits: 6 }) // 2 + 3 + 1; the 0, the null and the signed-out phone count for nothing
      const screen = (await call('GET', '/api/admin/providers', { cookie })).json.providers
      expect(json.counts.waiting.visits).toBe(screen.reduce((sum, p) => sum + p.waiting, 0))
      let phones = 0
      for (const p of screen) {
        const devices = (await call('GET', `/api/admin/providers/${p.id}/devices`, { cookie })).json.devices
        phones += devices.filter((d) => d.waiting_count > 0).length
      }
      expect(json.counts.waiting.phones).toBe(phones)
    })
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 6. read only, and the shape
  // ------------------------------------------------------------------------------------------------------------------------------

  it('reads in one connection and one transaction, read-only from its first statement, and only selects', async () => {
    const real = getPool()
    const statements = []
    let connections = 0
    const note = (text) => statements.push(String(typeof text === 'string' ? text : text?.text).replace(/\s+/g, ' ').trim())
    setPool({
      limits: real.limits,
      query: (text, params, options) => (note(text), real.query(text, params, options)),
      connect: async () => {
        connections += 1
        const client = await real.connect()
        return { query: (text, params) => (note(text), client.query(text, params)), release: (broken) => client.release(broken) }
      },
    })
    try {
      await buildHome({ now: NOW })
    } finally {
      setPool(real)
    }
    expect(connections).toBe(1)
    expect(statements[0]).toMatch(/^begin; set local statement_timeout/)
    expect(statements[1]).toBe('set transaction read only')
    expect(statements.at(-1)).toBe('commit')
    const middle = statements.slice(2, -1)
    expect(middle.length).toBe(5) // the week, the providers, the plain counts, the refused visits, the waiting phones
    for (const text of middle) {
      expect(text, text).toMatch(/^(select|with) /i)
      expect(text, text).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|create)\b/i)
    }
  })

  it('has exactly the documented fields: counts and the ids of providers, nothing else', async () => {
    const r = await get()
    expect(Object.keys(r.json)).toEqual(['days', 'week', 'counts'])
    expect(Object.keys(r.json.week)).toEqual(['providers', 'totals'])
    expect(Object.keys(r.json.counts)).toEqual(['points', 'providers', 'committee_members', 'agent_keys', 'visits_not_counted', 'waiting'])
    expect(Object.keys(r.json.counts.waiting)).toEqual(['phones', 'visits'])
    for (const row of r.json.week.providers) expect(Object.keys(row)).toEqual(PROVIDER_ROW_KEYS)
    const numbers = [...r.json.week.totals, ...r.json.week.providers.flatMap((row) => row.counts), r.json.counts.visits_not_counted]
    for (const n of numbers) expect(Number.isInteger(n) && n >= 0).toBe(true)
    for (const row of r.json.week.providers) expect(row.counts.length).toBe(HOME_DAYS)
    expect(r.json.week.totals.length).toBe(HOME_DAYS)
  })

  it('has nothing secret in its text: no QR code, no phone label, no key, no e-mail, no point', async () => {
    const r = await get()
    const secrets = [
      FAKE_LABEL,
      'Phone-Marker-7731',
      'second.member@example.test',
      'former.member@example.test',
      'kept key',
      'revoked key',
      'Atrium',
      'Courtyard',
      API_KEY_PREFIX,
      QR_TOKEN_PREFIX,
      'pw-fake-secret-4821',
    ]
    const qrs = (await db.pool.query('select qr_token from points')).rows.map((row) => row.qr_token)
    const hashes = (await db.pool.query('select token_hash from provider_devices')).rows.map((row) => row.token_hash)
    for (const secret of [...secrets, ...qrs, ...hashes]) expect(r.text, secret).not.toContain(secret)
  })

  // ------------------------------------------------------------------------------------------------------------------------------
  // 7. the guard
  // ------------------------------------------------------------------------------------------------------------------------------

  it('is the committee\'s: no session, a made-up one and an agent key are all refused with 401', async () => {
    const none = await call('GET', '/api/admin/home')
    expect(none.status).toBe(401)
    expect(none.json.error.code).toBe('admin_required')
    const made = await call('GET', '/api/admin/home', { cookie: `${ADMIN_COOKIE}=${ADMIN_TOKEN_PREFIX}not-a-real-session-0123456789abcdef` })
    expect(made.status).toBe(401)
    const { key } = await mintAgentKey(cookie, 'home guard key')
    const withKey = await call('GET', '/api/admin/home', { token: key })
    expect(withKey.status).toBe(401)
    for (const refused of [none, made, withKey]) expect(refused.text).not.toContain('"days"')
  })
})
