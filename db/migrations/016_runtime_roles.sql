-- Two roles that own nothing and log in as nobody, so that the app and a backup can stop running as the owner of the tables.
-- The owner can switch a trigger off, drop it, or empty a table; a role that does not own a table can do none of that. So the
-- append-only guarantee of audit_log and scan_refusals (007, 008), which today holds only as long as nobody runs `alter table`,
-- becomes a guarantee of the database once the app connects as app_runtime:
--
--   app_runtime    what the server's code does, table by table and nothing more (the list below). On audit_log and
--                  scan_refusals only SELECT and INSERT: no UPDATE, no DELETE, so `set_config('app.audit_retention', 'on', true)`
--                  opens nothing, and no TRUNCATE anywhere.
--   backup_reader  reads everything (pg_read_all_data: every table, view and sequence, this schema's and future ones, and the
--                  environment marker that no migration creates) and writes nothing.
--
-- Expand only (AGENTS.md, "Database and API changes"): this adds two roles and grants, and changes no table, so the deployment
-- that keeps serving while this one is built, which connects as the owner, notices nothing. A later step (a login role that is
-- a member of app_runtime, made by the owner in the database's console, and the server reading its URL) is what puts the app
-- behind these grants; the migrations keep running as the owner.
--
-- The privileges of app_runtime come from the code, read statement by statement (insert into, update, delete from, lock table,
-- select ... for update / for key share, on conflict ... do update, returning) in server/, the retention job and the first
-- committee member included. Cascades of a foreign key run as the owner of the table, so a delete that cascades needs no grant
-- on the rows it takes along. tests/db-privileges.test.js pins the result, table by table: a new table fails that test until it
-- is given its line here (in its own migration) and in the test, so a table never gets or misses a privilege silently.
--
-- A grant is written for every migration that adds a table from now on, next to its `create table`, never through
-- `alter default privileges` (which would hand DELETE to a future append-only table without anybody deciding it).
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

-- Roles belong to the whole cluster, not to a schema: the unit tests and the E2E run this file in their own schemas of one
-- database at the same time, and two transactions that create or grant the same role at once can fail with "tuple concurrently
-- updated", which no exception handler catches. One fixed key makes them take turns; the lock ends with this transaction.
select pg_advisory_xact_lock(hashtext('building-qr-system:runtime-roles'));

-- Created only when missing (a second schema of the same cluster finds them). NOLOGIN, and none of CREATEROLE, CREATEDB,
-- REPLICATION, BYPASSRLS or SUPERUSER: those are the defaults of `create role`. The role that is created is marked at once, in
-- the same block, with a comment of its own; a role that was already there is not marked again (the handler skips both).
do $$
begin
  create role app_runtime nologin;
  comment on role app_runtime is 'building-qr-system: the app''s own role, only what the server''s code does to each table (migration 016)';
exception when duplicate_object then
  null;
end $$;

do $$
begin
  create role backup_reader nologin;
  comment on role backup_reader is 'building-qr-system: reads every table for a backup and writes nothing (migration 016)';
exception when duplicate_object then
  null;
end $$;

-- A role with one of these names that this migration did not make (one that can log in, a superuser, anything someone created
-- by hand) must never receive the grants below: the migration stops instead, before the first grant. The check:
--   - the marker: the comment above, exactly. Only a role that holds ADMIN OPTION on a role (or a superuser) may set its
--     comment, and the migration sets it in the transaction that creates the role, so a marked role is one this file made (or
--     one that somebody who already administers the cluster marked on purpose: the check does not stop that person, who can
--     grant anything anyway).
--   - none of LOGIN, SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS, whoever set them later.
-- Members are not checked: the owner's login role for the app (a later step) becomes a member of app_runtime on purpose.
-- The message names the role and the reason only. EXECUTE is revoked from PUBLIC: the migration runs it as the owner, and
-- nobody else needs it (tests/db-privileges.test.js pins that).
create function assert_app_role(role_name text, marker text) returns void
language plpgsql security invoker as $$
declare
  r record;
begin
  select oid, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    into r from pg_catalog.pg_roles where rolname = role_name;
  if not found then
    raise exception 'role % does not exist', role_name;
  end if;
  if pg_catalog.shobj_description(r.oid, 'pg_authid') is distinct from marker then
    raise exception 'role % was not made by this migration (it does not carry its marker): refused', role_name;
  end if;
  if r.rolcanlogin or r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls then
    raise exception 'role % may log in or holds an elevated attribute: refused', role_name;
  end if;
end $$;
revoke execute on function assert_app_role(text, text) from public;

select assert_app_role('app_runtime', 'building-qr-system: the app''s own role, only what the server''s code does to each table (migration 016)');
select assert_app_role('backup_reader', 'building-qr-system: reads every table for a backup and writes nothing (migration 016)');

-- The schema these tables live in (public in a real database, the throwaway schema of a test).
do $$
begin
  execute format('grant usage on schema %I to app_runtime, backup_reader', current_schema());
end $$;

-- app_runtime, per table. What reads or writes each one:
-- points: the committee's points (create, edit with `for update`, new QR code, delete), the scan, the agent API.
grant select, insert, update, delete on points to app_runtime;
-- providers: the committee's providers (create, edit with `for update`, `for key share` before revoking phones, delete).
grant select, insert, update, delete on providers to app_runtime;
-- point_providers: who may scan a point, replaced as a whole on every edit (delete, then insert). Never updated.
grant select, insert, delete on point_providers to app_runtime;
-- provider_devices: a phone signs in (insert), the guard and the sync touch it, the phone reports its status, it is revoked, and
-- the retention job clears its label. It is deleted only by the cascade of its provider.
grant select, insert, update on provider_devices to app_runtime;
-- scans: recorded, voided (update with `for update`), and one row deleted on purpose by the committee (the guard of 004 lets it
-- through only with app.allow_scan_delete). Never emptied: no TRUNCATE.
grant select, insert, update, delete on scans to app_runtime;
-- admins: the committee's members (add, switch on and off, delete), the sign-in (`for update`, the first member's
-- `lock table admins in share row exclusive mode`, which needs UPDATE).
grant select, insert, update, delete on admins to app_runtime;
-- admin_sessions: opened at sign-in, revoked, deleted by the retention job.
grant select, insert, update, delete on admin_sessions to app_runtime;
-- api_keys: minted, revoked, deleted by the committee; the guard of the agent API reads it `for key share` and sets last_used_at.
grant select, insert, update, delete on api_keys to app_runtime;
-- auth_attempts: the login throttle counts, inserts and deletes; the retention job deletes. Never updated.
grant select, insert, delete on auth_attempts to app_runtime;
-- audit_log: append-only (007). Read by the audit screen and the agent API, written with every committee change.
grant select, insert on audit_log to app_runtime;
-- building_settings: the one row, saved with an upsert after a `for update` read. Never deleted.
grant select, insert, update on building_settings to app_runtime;
-- scan_refusals: append-only (008). A refused visit is inserted (`on conflict do nothing`) and read by the committee.
grant select, insert on scan_refusals to app_runtime;
-- app_errors: one row per kind of event per hour, upserted (server/errorLog.js), read by the summary, deleted by the retention job.
grant select, insert, update, delete on app_errors to app_runtime;
-- alert_pings: `insert ... on conflict do nothing returning day` (server/alerts.js), deleted by the retention job.
grant select, insert, delete on alert_pings to app_runtime;
-- api_key_usage: upserted by the guard of the agent API, read by the committee, deleted by the retention job.
grant select, insert, update, delete on api_key_usage to app_runtime;
-- schema_migrations: read by /api/health. The migrations run as the owner, who writes it.
grant select on schema_migrations to app_runtime;
-- v_attendance (001, 002) is read by nothing in the server: no grant.

-- The bigserial columns take their next value from a sequence, and an insert needs USAGE on it (an identity column would not).
grant usage on sequence auth_attempts_id_seq, audit_log_id_seq, scan_refusals_id_seq, app_errors_id_seq to app_runtime;

-- backup_reader reads everything and writes nothing (pg_read_all_data, PostgreSQL 14 and later). A membership of the cluster,
-- so it also covers tables that later migrations add and the environment marker, without a grant per table.
grant pg_read_all_data to backup_reader;

-- The owner becomes a member of app_runtime. It holds every privilege of the tables already, so this widens nothing; it lets
-- the owner `set role app_runtime`, which the unit tests do to run every route with exactly these grants. Where the owner is
-- not a superuser (Neon's neondb_owner), creating a role gives its creator only the right to administer it, not to become it.
-- No login role is made a member here: that is the owner's step, in the database's console.
grant app_runtime to current_user;
