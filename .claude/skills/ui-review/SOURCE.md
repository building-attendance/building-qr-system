Written for this project on 11/10/2026 (the design-intelligence plan, phase 4), not copied from another source. MIT
License, like the repository: see LICENSE (a copy of the root LICENSE).

It applies `docs/design.md`, the project's own rules, and points to two vendored skills: `break-ui` and `mobile-native`
(see their SOURCE.md). Where this skill and AGENTS.md or docs/design.md disagree, those win; change this file in a pull
request.

## Local changes

- 11/10/2026 (#178): step 3 takes the provider app's pictures in all four languages.
- 14/10/2026: the visual identity in the opening paragraph follows direction B of the redesign (#222 to #239): Rubik in
  place of Heebo, the violet palette, the edit button and "more" menu of a tile, the floating tab bar with its fade (T3),
  the add buttons as labelled pills and the quiet account circle with the Google photo (V5), and the scan sign of four
  corner brackets (V6). Step 4 applies the three rules that #239 added (T3, V5, V6). The other steps and the boundaries
  did not change.
- 16/10/2026 (#265, owner decision "small edges", an owner-directed change to `.claude/skills/`): step 3 runs the committed helper
  `npm run ui-review:pictures` (worst-case fake data in a schema of its own, the pictures in a folder that git ignores,
  `--grep` for a narrow change) in place of a scratch script and the dev seed, and says where the pictures land; they are still
  never committed. The line of the opening list about a tile now says what AGENTS.md says since #242 and #246: one "more"
  button, and edit is the first item of its menu. The other steps and the boundaries did not change. The worst-case data lives
  in `scripts/ui-review/worst-case.mjs` and not in the dev seed: it starts from the rows of the dev seed and adds to a copy of
  them in its own schema, so the line of `break-ui/SOURCE.md` that sends worst-case fixtures to the dev seed is read, for the
  review, as that seed.
