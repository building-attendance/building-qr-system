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
import { randomBytes } from 'node:crypto'
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
  runtime_grants: [NONE, READ],
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

// Every function of the schema, with whether each role may EXECUTE it: [app_runtime, backup_reader]. The trigger functions keep
// the EXECUTE that PUBLIC has by default (a trigger runs without it anyway); the three functions of 016 are the owner's alone.
const RUN = ['EXECUTE']
const FUNCTIONS = {
  app_role_problem: [NONE, NONE],
  assert_app_role: [NONE, NONE],
  audit_log_block_truncate: [RUN, RUN],
  audit_log_guard: [RUN, RUN],
  ensure_runtime_roles: [NONE, NONE],
  scan_refusals_block_truncate: [RUN, RUN],
  scan_refusals_guard: [RUN, RUN],
  scans_block_truncate: [RUN, RUN],
  scans_guard: [RUN, RUN],
}

// The marker that 016 puts on each role it creates, and checks before it grants anything (assert_app_role).
const MARKERS = {
  [RUNTIME_ROLE]: "building-qr-system: the app's own role, only what the server's code does to each table (migration 016)",
  [BACKUP_ROLE]: 'building-qr-system: reads every table for a backup and writes nothing (migration 016)',
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

/** What the two roles hold now on every table and view of the schema. */
const tablesNow = () =>
  granted(
    ['r', 'p', 'v', 'm', 'f'],
    tablePrivileges,
    `case when p.privilege in (${COLUMN_PRIVILEGES.map((p) => `'${p}'`).join(', ')})
          then has_any_column_privilege(r.role, c.oid, p.privilege)
          else has_table_privilege(r.role, c.oid, p.privilege) end`,
  )

/** What the two roles hold now on every sequence of the schema. */
const sequencesNow = () => granted(['S'], SEQUENCE_PRIVILEGES, 'has_sequence_privilege(r.role, c.oid, p.privilege)')

/** Whether each of the two roles may run each function of the schema now. */
async function functionsNow() {
  const { rows } = await db.ownerPool.query(
    `select f.proname as name, r.role, has_function_privilege(r.role, f.oid, 'EXECUTE') as held
       from pg_proc f
       cross join unnest($1::text[]) with ordinality as r(role, n)
      where f.pronamespace = current_schema()::regnamespace
      order by f.proname, r.n`,
    [ROLES],
  )
  const found = {}
  for (const { name, role, held } of rows) {
    found[name] ??= ROLES.map(() => [])
    if (held) found[name][ROLES.indexOf(role)].push('EXECUTE')
  }
  return found
}

/** What the two roles may do with the schema itself now. */
const schemaNow = async () =>
  (
    await db.ownerPool.query(
      `select r.role, has_schema_privilege(r.role, current_schema(), 'USAGE') as usage,
              has_schema_privilege(r.role, current_schema(), 'CREATE') as create
         from unnest($1::text[]) as r(role) order by r.role`,
      [ROLES],
    )
  ).rows
const SCHEMA = [
  { role: RUNTIME_ROLE, usage: true, create: false },
  { role: BACKUP_ROLE, usage: true, create: false },
]

describe('the privileges of app_runtime and backup_reader, table by table', () => {
  it('are exactly the map for every table and view of the schema, and the map names every one of them', async () => {
    const found = await tablesNow()
    expect(Object.keys(found).sort(), 'a table or view that the map does not name, or one the map names that is gone').toEqual(
      Object.keys(TABLES).sort(),
    )
    expect(found).toEqual(ordered(TABLES, tablePrivileges))
  })

  it('are exactly the map for every sequence of the schema', async () => {
    const found = await sequencesNow()
    expect(Object.keys(found).sort(), 'a sequence that the map does not name').toEqual(Object.keys(SEQUENCES).sort())
    expect(found).toEqual(ordered(SEQUENCES, SEQUENCE_PRIVILEGES))
  })

  it('are exactly the map for every function of the schema: nobody but the owner runs the three functions of 016', async () => {
    const found = await functionsNow()
    expect(Object.keys(found).sort(), 'a function that the map does not name').toEqual(Object.keys(FUNCTIONS).sort())
    expect(found).toEqual(FUNCTIONS)
  })

  it('give backup_reader no write on any table: no INSERT, UPDATE, DELETE or TRUNCATE', () => {
    for (const [name, [, backup]] of Object.entries(TABLES)) expect(backup, name).toEqual(READ)
    for (const [name, [, backup]] of Object.entries(SEQUENCES)) expect(backup, name).toEqual(READ)
  })

  it('let both roles use the schema and create nothing in it', async () => {
    expect(await schemaNow()).toEqual(SCHEMA)
  })

  it('are written in runtime_grants exactly as in the map, which ensure_runtime_roles() applies', async () => {
    const { rows } = await db.ownerPool.query('select object_name, object_kind, privileges from runtime_grants order by object_name collate "C"')
    const expected = [
      ...Object.entries(TABLES)
        .filter(([, [runtime]]) => runtime.length)
        .map(([name, [runtime]]) => ({ object_name: name, object_kind: 'table', privileges: runtime })),
      ...Object.entries(SEQUENCES).map(([name, [runtime]]) => ({ object_name: name, object_kind: 'sequence', privileges: runtime })),
    ].sort((a, b) => (a.object_name < b.object_name ? -1 : 1))
    expect(rows).toEqual(expected)
  })
})

// A backup is dumped and restored without privileges (scripts/backup-db.mjs, docs/runbooks/restore.md): the tables and the
// rows of runtime_grants come back, the grants do not, and every function gets back the EXECUTE of PUBLIC. Here that is done to
// this file's own schema (nothing outside it changes), and ensure_runtime_roles(), run by the owner as the runbook says, must
// bring back the whole matrix.
describe('after a restore without privileges', () => {
  it('ensure_runtime_roles() brings back every grant of the map, and takes EXECUTE on its functions away from PUBLIC again', async () => {
    await db.ownerPool.query(
      `do $$
       begin
         execute format('revoke all on all tables in schema %I from app_runtime, backup_reader', current_schema());
         execute format('revoke all on all sequences in schema %I from app_runtime, backup_reader', current_schema());
         execute format('revoke all on schema %I from app_runtime, backup_reader', current_schema());
         execute format('grant execute on all functions in schema %I to public', current_schema());
       end $$`,
    )
    // What the restore leaves: app_runtime holds nothing, and anyone may run the functions of 016.
    for (const [name, [runtime]] of Object.entries(await tablesNow())) expect(runtime, name).toEqual([])
    for (const [name, [runtime]] of Object.entries(await sequencesNow())) expect(runtime, name).toEqual([])
    expect((await functionsNow()).ensure_runtime_roles).toEqual([RUN, RUN])

    await db.ownerPool.query('select ensure_runtime_roles()')

    expect(await tablesNow()).toEqual(ordered(TABLES, tablePrivileges))
    expect(await sequencesNow()).toEqual(ordered(SEQUENCES, SEQUENCE_PRIVILEGES))
    expect(await functionsNow()).toEqual(FUNCTIONS)
    expect(await schemaNow()).toEqual(SCHEMA)
  })

  it('is safe to run again: a second call changes nothing', async () => {
    await db.ownerPool.query('select ensure_runtime_roles()')
    expect(await tablesNow()).toEqual(ordered(TABLES, tablePrivileges))
    expect(await sequencesNow()).toEqual(ordered(SEQUENCES, SEQUENCE_PRIVILEGES))
    expect(await functionsNow()).toEqual(FUNCTIONS)
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

  it('carry the marker of 016, which says the migration made them', async () => {
    const { rows } = await db.ownerPool.query(
      `select rolname, shobj_description(oid, 'pg_authid') as marker from pg_roles where rolname = any($1::text[]) order by rolname`,
      [ROLES],
    )
    expect(rows).toEqual([
      { rolname: RUNTIME_ROLE, marker: MARKERS[RUNTIME_ROLE] },
      { rolname: BACKUP_ROLE, marker: MARKERS[BACKUP_ROLE] },
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

// assert_app_role is what keeps 016 from granting anything to a role of the same name that it did not make. Its decision,
// app_role_problem, is tried with plain values, every reason of it; assert_app_role itself is tried on roles that this file
// creates under names of its own (roles belong to the whole cluster, and the real two are in use by the other test files at
// the same time), dropped at the end. Those roles have only what the owner of a Neon database may give (CREATEROLE, not
// SUPERUSER): NOLOGIN or LOGIN, and a comment.
const MARKER = 'building-qr-system: a fake role of tests/db-privileges.test.js'

describe('app_role_problem: the decision of assert_app_role, for every attribute and comment', () => {
  const ATTRIBUTES = ['can_login', 'is_super', 'create_role', 'create_db', 'replication', 'bypass_rls']
  const NOT_MARKED = 'was not made by this migration (it does not carry its marker): refused'
  const ELEVATED = 'may log in or holds an elevated attribute: refused'
  /** The answer for a role with the attributes in `on` set, and the comment `comment`. */
  const problem = async (on, comment) =>
    (
      await db.ownerPool.query('select app_role_problem($1, $2, $3, $4, $5, $6, $7, $8) as problem', [
        ...ATTRIBUTES.map((a) => on.includes(a)),
        comment,
        MARKER,
      ])
    ).rows[0].problem

  it('has nothing against a role with none of the attributes and the marker exactly', async () => {
    expect(await problem([], MARKER)).toBeNull()
  })

  it('refuses a role with no comment, another comment, or the marker with anything added', async () => {
    for (const comment of [null, '', 'made by hand', `${MARKER} `, ` ${MARKER}`, MARKER.toUpperCase()]) {
      expect(await problem([], comment), String(comment)).toBe(NOT_MARKED)
    }
  })

  it('refuses a marked role with any one of the attributes, and with all of them', async () => {
    for (const attribute of ATTRIBUTES) expect(await problem([attribute], MARKER), attribute).toBe(ELEVATED)
    expect(await problem(ATTRIBUTES, MARKER)).toBe(ELEVATED)
  })
})

describe('assert_app_role: a role of the same name that 016 did not make gets no grant', () => {
  const prefix = `t_role_${randomBytes(4).toString('hex')}`
  const made = []

  /** Creates a role named `<prefix>_<suffix>` with `attributes`, and the comment `comment` when it is given; returns the name. */
  async function role(suffix, attributes = 'nologin', comment = undefined) {
    const name = `${prefix}_${suffix}`
    await db.ownerPool.query(`create role ${name} ${attributes}`)
    made.push(name)
    if (comment !== undefined) await db.ownerPool.query(`comment on role ${name} is '${comment.replace(/'/g, "''")}'`)
    return name
  }
  const check = (name, marker = MARKER) => db.ownerPool.query('select assert_app_role($1, $2)', [name, marker])

  afterAll(async () => {
    for (const name of made) await db.ownerPool.query(`drop role if exists ${name}`)
  })

  it('lets a NOLOGIN role through that carries the marker exactly', async () => {
    await expect(check(await role('ok', 'nologin', MARKER))).resolves.toBeDefined()
  })

  it('refuses a role with no marker, or another one, and says only the role and the reason', async () => {
    const bare = await role('bare')
    await expect(check(bare)).rejects.toThrow(`role ${bare} was not made by this migration (it does not carry its marker): refused`)
    const other = await role('other', 'nologin', 'made by hand')
    await expect(check(other)).rejects.toThrow(`role ${other} was not made by this migration (it does not carry its marker): refused`)
    const close = await role('close', 'nologin', `${MARKER} `)
    await expect(check(close)).rejects.toThrow(/does not carry its marker/)
  })

  it('refuses a marked role that may log in', async () => {
    const name = await role('login', 'login', MARKER)
    await expect(check(name)).rejects.toThrow(`role ${name} may log in or holds an elevated attribute: refused`)
  })

  it('refuses a role that does not exist', async () => {
    await expect(check(`${prefix}_missing`)).rejects.toThrow(`role ${prefix}_missing does not exist`)
  })
})
