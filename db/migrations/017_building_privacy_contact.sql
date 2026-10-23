-- The committee's contact for privacy requests, next to the building's address and name in the one row of building_settings
-- (migrations 006 and 012). The provider app's privacy notice names the committee and how to reach it, as Section 11 of the
-- Protection of Privacy Law asks, so the committee types the contact once in the committee app (docs/privacy.md).
--
-- Expand only: a new column with a default, so the code that is already running keeps working while this one is built. The
-- old code's upsert (insert into building_settings (id, address, name, updated_at, updated_by) ... on conflict do update set
-- address = ..., name = ...) names no other column, so it fills in the default on an insert and leaves the stored contact
-- alone on an update. The runtime role (016) has its privileges on the whole table, so it reads and writes the new column
-- with no new grant.
--
-- Like the address and the name, the contact starts empty and stays empty until a committee member types one: it is not in the
-- code or in the translation files, because the repository is public and each committee runs its own copy.
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

alter table building_settings
  add column privacy_contact text not null default '' check (char_length(privacy_contact) <= 120);

comment on column building_settings.privacy_contact is
  'How to reach the committee about personal data (for example a phone or an e-mail), as the committee typed it. Public on purpose: the provider app shows it in its privacy notice before sign-in. Empty means not set. At most 120 characters.';
