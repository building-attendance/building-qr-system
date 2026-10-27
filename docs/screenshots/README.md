# Screenshots

The pictures of the two apps that the project's README shows, so that a person who finds the repository sees what it looks
like before installing anything. Both apps are in Hebrew, in the light theme (one picture is dark).

**They show only the fake sample data** that `scripts/dev-seed.mjs` makes in a scratch schema (an invented building, five
invented providers, four points on an invented position, and sixteen visits that `scripts/screenshots/seed-history.mjs`
adds). No real name, address, phone number or coordinate is in them, and none may be: look at every picture before you
commit it. The dates and times in them are relative to the day that they were taken: the visits are one to five days old, the
check-in of the provider app is made at the moment of the run, and the Home screen greets by the hour of the run and shows
the seven days that end on that day. Every point in them checks the location, as the committee
app saves points: `seed-history.mjs` sets that in the run's own schema, while the sample seed keeps the older modes that the
end-to-end tests use.

| Image | What it shows |
|---|---|
| `provider-phone-sign-in.png` | The provider app on a phone: a scan link opens the list of accounts to pick from ("choose your account"), with the committee's entry as a lock in the top bar beside the language and theme buttons, the link to the tutorial video ("watch the tutorial video (a minute and a half)") above the list and the privacy note on what a scan records below it (the note is cut by the bottom of the screen, as it is on a phone before the person scrolls) |
| `provider-phone-check-in.png` | The same app after signing in: the check-in is recorded |
| `provider-phone-saved-offline.png` | The same app with no network: the visit is kept on the phone and is sent by itself later |
| `committee-phone-home.png` | The committee app on a phone: the Home screen, the summary card of the week (the screen that opens first) |
| `committee-phone-points.png` | The committee app on a phone: the Points tab, each card with one button of three dots, the "more" button (the edit action is the first item of its menu) |
| `committee-phone-history.png` | The committee app on a phone: the History tab, scrolled to the visits (on a phone the filters are behind a filter button, above the first day) |
| `committee-computer-home.png` | The committee app on a computer (1280 px wide): the Home screen with the side rail |
| `committee-computer-points.png` | The same, the Points tab |
| `committee-computer-history.png` | The same, the History tab, with the date filters (each date has a calendar button) |
| `committee-computer-help.png` | The same, the help screen ("How to work with the system"), its topics in two flowing columns |
| `committee-computer-points-dark.png` | The same, the Points tab in the dark theme |

Phone pictures are 390 px wide, drawn at twice the density. Every image is a PNG of at most 300 KB (the script refuses a bigger
one, and `tests/screenshots.test.js` fails on one that is committed).

## Taking them again

```
npm run screenshots
```

It builds the production app, starts the local API over a scratch schema with the sample data, drives both apps in Chromium
and writes the images here, replacing the old ones. It needs what the end-to-end tests need: the non-production database of
`.env.local` (or a local PostgreSQL), and `npx playwright install chromium`.

- It runs on ports 3300 and 3301 and in the schema `screenshots`, which it drops before and after the run, so it can run next
  to the development servers and to an E2E run.
- **It refuses to run against anything but `http://localhost` or `http://127.0.0.1` and a scratch schema** (never `public`,
  `dev_ui`, `neon_auth` or the E2E run's own `e2e`). The guard is `assertLocalScratch` in `scripts/screenshots/settings.mjs`.
- It is not part of `npm run test:e2e` and CI never runs it: its config, `playwright.screenshots.config.js`, reads
  `scripts/screenshots/`, not `e2e/`.
- Every run rewrites every image, because the times in them change. Commit them only when a screen has changed.

To add a picture, add a step to `scripts/screenshots/screenshots.spec.mjs`, run the command, look at the new image, and add its
row to the table above.
