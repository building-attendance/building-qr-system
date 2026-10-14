Copied from https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d/skills/mobile-native
(commit e8a175de22ae1e49370fc144c1f3bb9aeedf988d of 02/10/2026), copied 11/10/2026, with the local changes below. MIT License, Copyright (c) 2026 Emil Kowalski: see LICENSE (the licence file of the repository, copied as it is).
Pinned on purpose. To update, read the new version first, then copy it over in a pull request.

Where this skill disagrees with AGENTS.md or docs/design.md, those win.

## Local changes

Only the em dash and the en dash, which this project never allows (AGENTS.md, `tests/no-em-dash.test.js`; the en dash since the owner's decision of 14/10/2026). The upstream file has 22 em dashes and 1 en dash. Each was replaced by hand with the text that keeps the meaning, and nothing else was changed:

- 17 by a colon (a list item or a sentence that explains the term before it, such as the "What was wrong / What changed / What needs a phone" lines).
- 4 by two pairs of parentheses (the sentence about the platform layer, and the one about inner scrollables).
- 1 by a comma, in the `description` of the front matter, where a colon would not be valid YAML.
- The en dash by a hyphen, in the range "100-160ms" of section 5, "Tap feels laggy" (14/10/2026).

## Where it disagrees with this project

- `theme-color`: the baseline adds two tags, one per `prefers-color-scheme`. The app has one tag in `index.html`, and `public/theme-boot.js` and `src/ui/theme.js` set its content to follow the person's own light/dark choice, which can differ from the device. Both read only the first matching tag, so with two tags the second would not follow the choice.
- The hover gate is `@media (hover: hover) and (pointer: fine)` here; the app's own CSS gates with `@media (hover: hover)` alone. Follow the CSS that exists.
- Section 11 says to run the dev server on `0.0.0.0` and open it by the LAN address. In this project `npm run dev` proxies `/api` to the dev API, whose scratch mode switches on a dev-only admin sign-in that skips Google (`server/dev.mjs`, AGENTS.md "Commands"), so a server open to the local network could expose it. Checks on a real phone follow `docs/manual-ios-checklist.md`, which AGENTS.md ("Testing") requires before a release that touches the PWA files, the layout or the location flow. Anything this skill changes in the viewport tag, the safe areas or standalone mode is such a change.
- The app is right-to-left by default (`dir="rtl"` in `index.html`; Hebrew and Arabic) and its CSS largely uses logical properties; this skill has no RTL guidance. The one deliberate physical case is the left and right safe-area insets (see the comment in `src/ui/ui.css`). Check both directions.
- The Tailwind note (section 1) and the Next.js note (section 10) do not apply: the app is Vite and React with plain CSS.
- "If the codebase uses the `animate` skill's tokens" refers to a sibling skill of the upstream repository (`animate`, `review-animations`, `animate-expo`) that is not copied here.

## Agent-addressed text, for review

- "Initial Response" (top of the file): when the skill is invoked without a specific question, the agent is told to answer with one fixed sentence (that it is ready to make a web app feel native, and that its knowledge comes from Emil Kowalski's design engineering philosophy) and to give no other information until the user asks. This is a canned reply: an automated task that loaded the skill would answer with it and stop.
- "Operating Posture" and "Tone" give the agent a persona (a senior design engineer who has been burned by every item below) and a manner of speaking. They are not instructions of this project.
