Copied from https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/wizard
(commit 49dd158d1076134a641b33efb035946536778336 of 09/10/2026), copied 11/10/2026. MIT License, Copyright (c) 2026 Matt Pocock: see LICENSE.
Pinned on purpose: not the auto-updating plugin. To update, read the new version first, then copy it over.

Local changes (11/10/2026):
- `SKILL.md`, step 1: the files to read for a setup were `.env`, `.env.example` and `.env.*`. Now only `.env.example`,
  with the reason. `.env.*` includes `.env.local`, which holds the real database credentials, and AGENTS.md (Safety) says
  an agent never reads or prints it (`.claude/settings.json` also denies it). Found by the Codex review of the pull
  request that tracked this skill.

Where this skill disagrees with AGENTS.md or docs/design.md, those win. `template.sh` writes captured values to `.env` by
default (`ENV_FILE`); in this project the local file is `.env.local`, and the wizard is run by a person, never by an agent.
