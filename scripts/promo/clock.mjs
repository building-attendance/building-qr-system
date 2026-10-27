// The clock of the API in the long promo's recorder, and only there: playwright.promo.config.js starts the local API with
// `node --import ./scripts/promo/clock.mjs server/dev.mjs`, and nothing else imports this file. The story is a morning (the visit at 08:06
// is the same in the provider app and in the committee's history), whatever the hour of the run, so the server must say the same time as
// the browser, whose clock the spec sets with Playwright's page.clock.
//
// The spec writes the moment it wants into PROMO_CLOCK_FILE ({ at, setAt }, both in milliseconds: the story's moment, and the real time
// at which it was set), and from then on the server's `Date.now()` and `new Date()` are that moment plus the time that has passed. The
// database keeps its own clock (a default of now(), such as the time of an audit row, is the real time of the run). Without the file the
// clock is the real one. It never runs in a deployment: server/ does not import it, and the build does not bundle it.
import { readFileSync } from 'node:fs'

const file = process.env.PROMO_CLOCK_FILE
const RealDate = Date
const realNow = RealDate.now.bind(RealDate)
// The file is read again at most this often, so that a call of Date.now() costs no read of the disk.
const REREAD_MS = 50

let offset = 0
let readAt = -Infinity

/** The story's time now, in milliseconds. */
function now() {
  const real = realNow()
  if (file && real - readAt > REREAD_MS) {
    readAt = real
    try {
      const { at, setAt } = JSON.parse(readFileSync(file, 'utf8'))
      if (Number.isFinite(at) && Number.isFinite(setAt)) offset = at - setAt
    } catch {
      // no file yet, or one that is being written: keep the last offset
    }
  }
  return real + offset
}

// `new Date()` with no argument is now; with arguments it is the Date it always was. Called as a function, `Date()` is now's text.
// A Proxy, so that `instanceof Date` and Date.prototype stay the real ones.
globalThis.Date = new Proxy(RealDate, {
  construct: (target, args, newTarget) => Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
  apply: () => new RealDate(now()).toString(),
  get: (target, key) => (key === 'now' ? now : Reflect.get(target, key)),
})
