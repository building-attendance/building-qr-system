-- Two roles that own nothing and log in as nobody, so that the app and a backup can stop running as the owner of the tables.
-- The owner can switch a trigger off, drop it, or empty a table; a role that does not own a table can do none of that. So the
-- append-only guarantee of audit_log and scan_refusals (007, 008), which today holds only as long as nobody runs `alter table`,
-- becomes a guarantee of the database once the app connects as app_runtime:
--
--   app_runtime    what the server's code does, table by table and nothing more (the rows of runtime_grants below). On
--                  audit_log and scan_refusals only SELECT and INSERT: no UPDATE, no DELETE, so
--                  `set_config('app.audit_retention', 'on', true)` opens nothing, and no TRUNCATE anywhere.
--   backup_reader  reads everything (pg_read_all_data: every table, view and sequence, this schema's and future ones, and the
--                  environment marker that no migration creates) and writes nothing.
--
-- Expand only (AGENTS.md, "Database and API changes"): this adds two roles, one small table, three functions and grants, and
-- changes no existing table, so the deployment that keeps serving while this one is built, which connects as the owner,
-- notices nothing. A later step (a login role that is a member of app_runtime, made by the owner in the database's console,
-- and the server reading its URL) is what puts the app behind these grants; the migrations keep running as the owner.
--
-- The grants live in the database, not only in this file: a backup is dumped and restored without privileges
-- (scripts/backup-db.mjs, docs/runbooks/restore.md), and roles belong to the cluster, not to a dump. So a restored database
-- would say that 016 ran and hold none of its grants. The table runtime_grants (restored with the data) lists what app_runtime
-- may do, and ensure_runtime_roles() makes the roles and the grants match it, whenever it is called: here, once, and by hand
-- after a restore (`select ensure_runtime_roles();` as the owner). A later migration that adds a table inserts its row into
-- runtime_grants and calls ensure_runtime_roles() again, so the grants are written in one place only; it never grants to
-- app_runtime directly and never uses `alter default privileges` (which would hand DELETE to a future append-only table
-- without anybody deciding it).
--
-- The privileges of app_runtime come from the code, read statement by statement (insert into, update, delete from, lock table,
-- select ... for update / for key share, on conflict ... do update, returning) in server/, the retention job and the first
-- committee member included. Cascades of a foreign key run as the owner of the table, so a delete that cascades needs no grant
-- on the rows it takes along. tests/db-privileges.test.js pins the result, table by table: a new table fails that test until it
-- has its row here (in its own migration) and in the test, so a table never gets or misses a privilege silently.
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

-- A role with one of these names that this migration did not make (one that can log in, a superuser, anything someone created
-- by hand) must never receive the grants: ensure_runtime_roles() stops instead, before the first grant. The check:
--   - the marker: the comment that ensure_runtime_roles() puts on a role in the step that creates it. Only a role that holds
--     ADMIN OPTION on a role (or a superuser) may set its comment, so a marked role is one this code made (or one that somebody
--     who already administers the cluster marked on purpose: the check does not stop that person, who can grant anything
--     anyway).
--   - none of LOGIN, SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS, whoever set them later.
-- Members are not checked: the owner's login role for the app (a later step) becomes a member of app_runtime on purpose.
-- The message names the role and the reason only. The decision is a pure function of the attributes and the comment
-- (app_role_problem), so that every reason can be tested with plain values, without making a superuser role; assert_app_role
-- reads the role and raises. EXECUTE on the three functions is revoked from PUBLIC: the owner runs them, and nobody else needs
-- them (tests/db-privileges.test.js pins that).
create function app_role_problem(can_login boolean, is_super boolean, create_role boolean, create_db boolean,
                                 replication boolean, bypass_rls boolean, role_comment text, marker text) returns text
language sql immutable as $$
  select case
    when role_comment is distinct from marker then 'was not made by this migration (it does not carry its marker): refused'
    when can_login or is_super or create_role or create_db or replication or bypass_rls
      then 'may log in or holds an elevated attribute: refused'
  end
$$;
revoke execute on function app_role_problem(boolean, boolean, boolean, boolean, boolean, boolean, text, text) from public;

create function assert_app_role(role_name text, marker text) returns void
language plpgsql security invoker as $$
declare
  r record;
  problem text;
begin
  select oid, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    into r from pg_catalog.pg_roles where rolname = role_name;
  if not found then
    raise exception 'role % does not exist', role_name;
  end if;
  problem := app_role_problem(r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
                              pg_catalog.shobj_description(r.oid, 'pg_authid'), marker);
  if problem is not null then
    raise exception 'role % %', role_name, problem;
  end if;
end $$;
revoke execute on function assert_app_role(text, text) from public;

-- What app_runtime may do, one row per table or sequence of this schema. A table holds some of SELECT, INSERT, UPDATE and
-- DELETE (never TRUNCATE, REFERENCES or TRIGGER); a sequence holds USAGE, which an insert into a bigserial column needs.
create table runtime_grants (
  object_name text primary key check (object_name ~ '^[a-z_][a-z0-9_]*$'),
  object_kind text not null check (object_kind in ('table', 'sequence')),
  privileges  text[] not null check (
    cardinality(privileges) > 0
    and (object_kind = 'table' and privileges <@ array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
         or object_kind = 'sequence' and privileges = array['USAGE'])
  )
);
comment on table runtime_grants is
  'What the role app_runtime may do, per table and sequence of this schema (migration 016). ensure_runtime_roles() applies it; a migration that adds a table adds its row and calls that function.';

-- What reads or writes each table:
insert into runtime_grants (object_name, object_kind, privileges) values
  -- the committee's points (create, edit with `for update`, new QR code, delete), the scan, the agent API
  ('points', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- the committee's providers (create, edit with `for update`, `for key share` before revoking phones, delete)
  ('providers', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- who may scan a point, replaced as a whole on every edit (delete, then insert); never updated
  ('point_providers', 'table', array['SELECT', 'INSERT', 'DELETE']),
  -- a phone signs in (insert), the guard and the sync touch it, the phone reports its status, it is revoked, and the retention
  -- job clears its label; it is deleted only by the cascade of its provider
  ('provider_devices', 'table', array['SELECT', 'INSERT', 'UPDATE']),
  -- recorded, voided (update with `for update`), and one row deleted on purpose by the committee (the guard of 004 lets it
  -- through only with app.allow_scan_delete); never emptied
  ('scans', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- the committee's members (add, switch on and off, delete), the sign-in (`for update`, the first member's
  -- `lock table admins in share row exclusive mode`, which needs UPDATE)
  ('admins', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- opened at sign-in, revoked, deleted by the retention job
  ('admin_sessions', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- minted, revoked, deleted by the committee; the guard of the agent API reads it `for key share` and sets last_used_at
  ('api_keys', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- the login throttle counts, inserts and deletes; the retention job deletes; never updated
  ('auth_attempts', 'table', array['SELECT', 'INSERT', 'DELETE']),
  -- append-only (007): read by the audit screen and the agent API, written with every committee change
  ('audit_log', 'table', array['SELECT', 'INSERT']),
  -- the one row, saved with an upsert after a `for update` read; never deleted
  ('building_settings', 'table', array['SELECT', 'INSERT', 'UPDATE']),
  -- append-only (008): a refused visit is inserted (`on conflict do nothing`) and read by the committee
  ('scan_refusals', 'table', array['SELECT', 'INSERT']),
  -- one row per kind of event per hour, upserted (server/errorLog.js), read by the summary, deleted by the retention job
  ('app_errors', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- `insert ... on conflict do nothing returning day` (server/alerts.js), deleted by the retention job
  ('alert_pings', 'table', array['SELECT', 'INSERT', 'DELETE']),
  -- upserted by the guard of the agent API, read by the committee, deleted by the retention job
  ('api_key_usage', 'table', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
  -- read by /api/health; the migrations run as the owner, who writes it
  ('schema_migrations', 'table', array['SELECT']),
  -- the sequences of the bigserial columns (an identity column would need no grant)
  ('auth_attempts_id_seq', 'sequence', array['USAGE']),
  ('audit_log_id_seq', 'sequence', array['USAGE']),
  ('scan_refusals_id_seq', 'sequence', array['USAGE']),
  ('app_errors_id_seq', 'sequence', array['USAGE']);
-- Not listed, so app_runtime gets nothing on them: v_attendance (001, 002), which nothing in the server reads, and
-- runtime_grants itself.

-- Makes the two roles and their grants match runtime_grants, in the current schema; safe to call any number of times.
create function ensure_runtime_roles() returns void
language plpgsql security invoker as $$
declare
  g record;
begin
  -- Roles belong to the whole cluster, not to a schema: the unit tests and the E2E run this in their own schemas of one
  -- database at the same time, and two transactions that create or grant the same role at once can fail with "tuple
  -- concurrently updated", which no exception handler catches. One fixed key makes them take turns until the transaction ends.
  perform pg_advisory_xact_lock(hashtext('building-qr-system:runtime-roles'));

  -- Created only when missing, and marked in the same step; a role that was already there is not marked again (the handler
  -- skips both). NOLOGIN, and none of CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS or SUPERUSER: the defaults of `create role`.
  begin
    create role app_runtime nologin;
    comment on role app_runtime is 'building-qr-system: the app''s own role, only what the server''s code does to each table (migration 016)';
  exception when duplicate_object then
    null;
  end;
  begin
    create role backup_reader nologin;
    comment on role backup_reader is 'building-qr-system: reads every table for a backup and writes nothing (migration 016)';
  exception when duplicate_object then
    null;
  end;
  perform assert_app_role('app_runtime', 'building-qr-system: the app''s own role, only what the server''s code does to each table (migration 016)');
  perform assert_app_role('backup_reader', 'building-qr-system: reads every table for a backup and writes nothing (migration 016)');

  -- A restore without privileges gives every function back its default EXECUTE for PUBLIC: take it away again.
  revoke execute on function app_role_problem(boolean, boolean, boolean, boolean, boolean, boolean, text, text) from public;
  revoke execute on function assert_app_role(text, text) from public;
  revoke execute on function ensure_runtime_roles() from public;

  -- The schema these tables live in (public in a real database, the throwaway schema of a test).
  execute format('grant usage on schema %I to app_runtime, backup_reader', current_schema());

  -- Each row exactly: what app_runtime held on the object before is taken away first, so a row that a later migration narrows
  -- narrows the grant too. The names and the privileges are checked by the table's constraints, and the name is quoted.
  for g in select object_name, object_kind, privileges from runtime_grants order by object_name loop
    execute format('revoke all on %s %I from app_runtime', g.object_kind, g.object_name);
    execute format('grant %s on %s %I to app_runtime', array_to_string(g.privileges, ', '), g.object_kind, g.object_name);
  end loop;

  -- backup_reader reads everything and writes nothing (pg_read_all_data, PostgreSQL 14 and later). A membership of the
  -- cluster, so it also covers tables that later migrations add and the environment marker, without a grant per table.
  grant pg_read_all_data to backup_reader;

  -- The owner becomes a member of app_runtime. It holds every privilege of the tables already, so this widens nothing; it lets
  -- the owner `set role app_runtime`, which the unit tests do to run every route with exactly these grants. Where the owner is
  -- not a superuser (Neon's neondb_owner), creating a role gives its creator only the right to administer it, not to become it.
  -- No login role is made a member here: that is the owner's step, in the database's console.
  grant app_runtime to current_user;
end $$;
revoke execute on function ensure_runtime_roles() from public;

select ensure_runtime_roles();
