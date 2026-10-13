-- Three columns that nothing uses any more (owner decision of 13/10/2026: the app is not in production yet, so what was kept
-- for the old Firebase app and for older installed copies is removed). Their unique and check constraints go with them.
--
--   points.legacy_id, providers.legacy_id (001_init.sql)  the Firestore document ids that the one-time import from the old
--     Firebase app wrote, so that it could run twice without making the same row twice. That import is gone, nothing else ever
--     read or wrote them, no route selects them, and the agent API never showed them (they were on its list of secrets).
--   providers.lang (001_init.sql)  the provider's language, from before the language moved to the phone: no code reads or
--     writes it, every insert takes its default, and no answer of the API has carried it since (tests/api.test.js).
--
-- contract: no code reads or writes these columns (the import that wrote legacy_id is removed in the same change, and lang has
-- had no reader or writer since the language moved to the phone), so the deployment that is still serving while this one
-- builds does not depend on them, and no installed app ever saw them.
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

alter table points drop column legacy_id;
alter table providers drop column legacy_id;
alter table providers drop column lang;
