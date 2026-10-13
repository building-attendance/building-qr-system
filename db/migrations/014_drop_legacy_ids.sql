-- The Firestore document ids of the points and the providers (`legacy_id`, 001_init.sql): the one-time import from the old
-- Firebase app wrote them so that it could run twice without making the same row twice. That import is gone (owner decision
-- of 13/10/2026: the app is not in production yet, so the old app's leftovers are removed), and nothing else ever read or
-- wrote these columns: no route selects them, and the agent API never showed them (they were on its list of secrets).
-- Their unique constraints go with them.
-- contract: no code reads or writes legacy_id since the import was removed, and no route ever did, so the deployment that is
-- still serving while this one builds does not depend on it, and no installed app ever saw it.
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

alter table points drop column legacy_id;
alter table providers drop column legacy_id;
