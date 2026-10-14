-- The address of a committee member's Google photo (owner decision of 14/10/2026: the photo fills the member's circle in the
-- committee app, the account button and the member's card in Settings, and the initial stays for a member without one).
-- Expand only: a new nullable column with no default and no backfill, so the code that is already running keeps working while
-- this one is built. The old code names its columns (or reads `select *` and picks the fields it knows), so it never sees the
-- new one, and a member's row that it inserts or updates simply leaves the photo empty.
--
-- The sign-in writes it, in its own transaction, every time a member signs in with Google: the photo that Google gives when it
-- passes the check of server/google.js (googlePhotoUrl), else null. Nothing else writes it. It is personal data
-- (docs/privacy.md): the committee app shows it, the agent API never does, and it goes with the member's row when the member is
-- deleted. The check repeats the server's limit (ADMIN_PICTURE_URL_MAX_LENGTH in server/config.js), so a longer value can never
-- be stored, whatever writes it.
-- No schema-qualified names on purpose: tests run this inside a throwaway schema.

alter table admins add column picture_url text check (char_length(picture_url) <= 512);

comment on column admins.picture_url is
  'The address of the member''s Google photo, from the last Google sign-in, or null (no photo, or one that the server refused). Only an https address on Google''s photo host, at most 512 characters.';
