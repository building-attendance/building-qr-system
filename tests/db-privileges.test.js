// The privileges of the two roles of db/migrations/016_runtime_roles.sql, pinned table by table:
//   app_runtime    what the server's code does to each table and nothing more; on audit_log and scan_refusals SELECT and
//                  INSERT only, so the append-only rows cannot be changed or removed by the app, whatever setting it sets;
//   backup_reader  SELECT on everything (pg_read_all_data) and no write anywhere.
// The map below is the decision. A table or a sequence that a migration adds and the map does not name fails this file, and so
// does a grant that is added to or removed from a migration without the map changing with it: a table never gets or misses a
// privilege silently. When a test here fails because you changed a grant on purpose, change the map in the same pull request
// and say in its description which statement of the code needs it.
// The privileges are read with has_table_privilege, has_any_column_privilege (so a grant on one column counts too) and
// has_sequence_privilege, for the role itself: the test runs as the owner, which holds everything. No row is read or written.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupDb, RUNTIME_ROLE } from './helpers.js'

const BACKUP_ROLE = 'backup_reader'
const ROLES = [RUNTIME_ROLE, BACKUP_ROLE]

// What a table, a view or a sequence can be granted. MAINTAIN exists from PostgreSQL 17 on and is added there (beforeAll).
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
// These four can also be granted on a single column: has_any_column_privilege sees a grant on the table and one on a column.
const COLUMN_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
const SEQUENCE_PRIVILEGES = ['USAGE', 'SELECT', 'UPDATE']

const ALL = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const READ = ['SELECT']
const NONE = []

// Every table and view of the schema: [app_runtime, backup_reader].
const TABLES = {
  admin_sessions: [ALL, READ],
  admins: [ALL, READ],
  alert_pings: [['SELECT', 'INSERT', 'DELETE'], READ],
  api_key_usage: [ALL, READ],
  api_keys: [ALL, READ],
  app_errors: [ALL, READ],
  audit_log: [['SELECT', 'INSERT'], READ],
  auth_attempts: [['SELECT', 'INSERT', 'DELETE'], READ],
  building_settings: [['SELECT', 'INSERT', 'UPDATE'], READ],
  point_providers: [['SELECT', 'INSERT', 'DELETE'], READ],
  points: [ALL, READ],
  provider_devices: [['SELECT', 'INSERT', 'UPDATE'], READ],
  providers: [ALL, READ],
  scan_refusals: [['SELECT', 'INSERT'], READ],
  scans: [ALL, READ],
  schema_migrations: [READ, READ],
  v_attendance: [NONE, READ],
}

// Every sequence of the schema (the bigserial columns): [app_runtime, backup_reader].
const SEQUENCES = {
  app_errors_id_seq: [['USAGE'], READ],
  audit_log_id_seq: [['USAGE'], READ],
  auth_attempts_id_seq: [['USAGE'], READ],
  scan_refusals_id_seq: [['USAGE'], READ],
}

let db
let tablePrivileges = TABLE_PRIVILEGES

beforeAll(async () => {
  db = await setupDb()
  const { rows } = await db.ownerPool.query("select current_setting('server_version_num')::int >= 170000 as maintain")
  if (rows[0].maintain) tablePrivileges = [...TABLE_PRIVILEGES, 'MAINTAIN']
})
afterAll(async () => db?.teardown())

/** `{ name: [privileges of app_runtime, privileges of backup_reader] }` for the relations of the schema of these kinds. */
async function granted(kinds, privileges, check) {
  const { rows } = await db.ownerPool.query(
    `select c.relname as name, r.role, p.privilege, ${check} as held
       from pg_class c
       cross join unnest($1::text[]) with ordinality as r(role, n)
       cross join unnest($2::text[]) with ordinality as p(privilege, m)
      where c.relnamespace = current_schema()::regnamespace and c.relkind = any($3::"char"[])
      order by c.relname, r.n, p.m`,
    [ROLES, privileges, kinds],
  )
  const found = {}
  for (const { name, role, privilege, held } of rows) {
    found[name] ??= ROLES.map(() => [])
    if (held) found[name][ROLES.indexOf(role)].push(privilege)
  }
  return found
}

/** The literal map with each list in the order of `privileges`, the way granted() returns it. */
const ordered = (map, privileges) =>
  Object.fromEntries(Object.entries(map).map(([name, lists]) => [name, lists.map((list) => privileges.filter((p) => list.includes(p)))]))

describe('the privileges of app_runtime and backup_reader, table by table', () => {
  it('are exactly the map for every table and view of the schema, and the map names every one of them', async () => {
    const found = await granted(
      ['r', 'p', 'v', 'm', 'f'],
      tablePrivileges,
      `case when p.privilege in (${COLUMN_PRIVILEGES.map((p) => `'${p}'`).join(', ')})
            then has_any_column_privilege(r.role, c.oid, p.privilege)
            else has_table_privilege(r.role, c.oid, p.privilege) end`,
    )
    expect(Object.keys(found).sort(), 'a table or view that the map does not name, or one the map names that is gone').toEqual(
      Object.keys(TABLES).sort(),
    )
    expect(found).toEqual(ordered(TABLES, tablePrivileges))
  })

  it('are exactly the map for every sequence of the schema', async () => {
    const found = await granted(['S'], SEQUENCE_PRIVILEGES, 'has_sequence_privilege(r.role, c.oid, p.privilege)')
    expect(Object.keys(found).sort(), 'a sequence that the map does not name').toEqual(Object.keys(SEQUENCES).sort())
    expect(found).toEqual(ordered(SEQUENCES, SEQUENCE_PRIVILEGES))
  })

  it('give backup_reader no write on any table: no INSERT, UPDATE, DELETE or TRUNCATE', () => {
    for (const [name, [, backup]] of Object.entries(TABLES)) expect(backup, name).toEqual(READ)
    for (const [name, [, backup]] of Object.entries(SEQUENCES)) expect(backup, name).toEqual(READ)
  })

  it('let both roles use the schema and create nothing in it', async () => {
    const { rows } = await db.ownerPool.query(
      `select r.role, has_schema_privilege(r.role, current_schema(), 'USAGE') as usage,
              has_schema_privilege(r.role, current_schema(), 'CREATE') as create
         from unnest($1::text[]) as r(role) order by r.role`,
      [ROLES],
    )
    expect(rows).toEqual([
      { role: RUNTIME_ROLE, usage: true, create: false },
      { role: BACKUP_ROLE, usage: true, create: false },
    ])
  })
})

describe('the two roles', () => {
  it('log in as nobody and can create no role, no database and no replication, nor bypass row security', async () => {
    const { rows } = await db.ownerPool.query(
      `select rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         from pg_roles where rolname = any($1::text[]) order by rolname`,
      [ROLES],
    )
    const off = { rolsuper: false, rolcanlogin: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }
    expect(rows).toEqual([
      { rolname: RUNTIME_ROLE, ...off },
      { rolname: BACKUP_ROLE, ...off },
    ])
  })

  it('are members of nothing but this: backup_reader of pg_read_all_data, and app_runtime of no role', async () => {
    const { rows } = await db.ownerPool.query(
      `select member.rolname as member, coalesce(array_agg(granted.rolname::text order by granted.rolname) filter (where granted.rolname is not null), '{}'::text[]) as roles
         from pg_roles member
         left join pg_auth_members m on m.member = member.oid
         left join pg_roles granted on granted.oid = m.roleid
        where member.rolname = any($1::text[])
        group by member.rolname
        order by member.rolname`,
      [ROLES],
    )
    expect(rows).toEqual([
      { member: RUNTIME_ROLE, roles: [] },
      { member: BACKUP_ROLE, roles: ['pg_read_all_data'] },
    ])
  })

  it('run the server pool of the tests: app_runtime from the first statement, and also after reset role', async () => {
    const client = await db.pool.connect()
    try {
      expect((await client.query('select current_user as role')).rows[0].role).toBe(RUNTIME_ROLE)
      await client.query('reset role')
      expect((await client.query('select current_user as role')).rows[0].role).toBe(RUNTIME_ROLE)
    } finally {
      client.release()
    }
  })
})

describe('what app_runtime is refused, as the app would be', () => {
  /** Runs `sql` as app_runtime in a transaction of its own that is always rolled back, after `before` (statements). */
  async function refused(sql, before = []) {
    const client = await db.pool.connect()
    try {
      await client.query('begin')
      for (const statement of before) await client.query(statement)
      return await client.query(sql).then(
        () => null,
        (err) => ({ code: err.code, message: err.message }),
      )
    } finally {
      await client.query('rollback').catch(() => {})
      client.release()
    }
  }

  // Only the owner may alter a table or drop its trigger. PostgreSQL words it "of table" for one statement and "of relation"
  // for the other; the code is the same.
  const mustBeOwner = (table) => ({ code: '42501', message: expect.stringMatching(new RegExp(`^must be owner of (table|relation) ${table}$`)) })

  const RETENTION = ["select set_config('app.audit_retention', 'on', true)", "select set_config('app.refusal_retention', 'on', true)"]
  const APPEND_ONLY = [
    ['audit_log', 'audit_log_guard_trg', "update audit_log set action = 'changed'"],
    ['scan_refusals', 'scan_refusals_guard_trg', "update scan_refusals set code = 'changed'"],
  ]

  for (const [table, trigger, update] of APPEND_ONLY) {
    it(`may not update, delete or truncate ${table}, also after the retention settings`, async () => {
      const denied = { code: '42501', message: `permission denied for table ${table}` }
      expect(await refused(update)).toEqual(denied)
      expect(await refused(`delete from ${table}`)).toEqual(denied)
      expect(await refused(`delete from ${table}`, RETENTION)).toEqual(denied)
      expect(await refused(`truncate ${table}`)).toEqual(denied)
      expect(await refused(`truncate ${table}`, RETENTION)).toEqual(denied)
    })

    it(`may not switch off or drop the triggers of ${table}`, async () => {
      const notOwner = mustBeOwner(table)
      expect(await refused(`alter table ${table} disable trigger all`)).toEqual(notOwner)
      expect(await refused(`alter table ${table} disable trigger ${trigger}`)).toEqual(notOwner)
      expect(await refused(`drop trigger ${trigger} on ${table}`)).toEqual(notOwner)
    })
  }

  it('may not empty the scans, nor switch off or drop their guard', async () => {
    expect(await refused('truncate scans')).toEqual({ code: '42501', message: 'permission denied for table scans' })
    expect(await refused('alter table scans disable trigger all')).toEqual(mustBeOwner('scans'))
    expect(await refused('drop trigger scans_guard_trg on scans')).toEqual(mustBeOwner('scans'))
  })

  it('may not create a table, nor a role', async () => {
    expect((await refused('create table t_new (id int)'))?.code).toBe('42501')
    expect((await refused('create role t_new_role'))?.code).toBe('42501')
  })
})
