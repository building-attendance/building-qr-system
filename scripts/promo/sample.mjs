// The invented building of the long promo: its committee, its service providers, its points and its week of visits. Plain data and one
// pure function, so that the seed (scripts/promo/seed.mjs), the spec (scripts/promo/capture.spec.mjs) and tests/promo-capture.test.js
// read the same values.
//
// EVERY value here is made up, for a public video (AGENTS.md, Safety): the people are natural first and last names that stand for nobody,
// the companies are names that were made up for this file, the e-mail addresses are on example.com (a name that is reserved for examples),
// the passwords open accounts that live only in the run's scratch schema, which the run drops at its end. The points stand where the
// sample data puts every point (scripts/sample-data.mjs: open sea, far from any shore), so no position in the pictures is a real place.
import { POINT_RADIUS_DEFAULT_M } from '../../shared/contract.js'
import { SAMPLE_POINT } from '../sample-data.mjs'
import { addDays, isWorkday, missingDay } from './settings.mjs'

/** The building, as the committee typed it in the settings. */
export const BUILDING = Object.freeze({ name: 'בית השקד', address: 'רחוב העפרוני 14' })

/** The committee: the member who signs in for the pictures, and a second one. */
export const MEMBERS = Object.freeze({
  yael: { email: 'yael.barkan@example.com', name: 'יעל ברקן' },
  david: { email: 'david.almagor@example.com', name: 'דוד אלמגור' },
})

/** The service providers. `password` is the one that the seed sets, for the sign-in of the run. */
export const PROVIDERS = Object.freeze({
  cleaner: { contact: 'רונית אלמוג', company: 'ניקיון תכלת הבית', service: 'cleaning', password: 'tkvt-4826' },
  gardener: { contact: 'יוסי דהן', company: 'גינון עלה ושורש', service: 'gardening', password: 'gnsh-7352' },
  technician: { contact: 'אנטון קרבצוב', company: 'מעליות גבעת השקד', service: 'maintenance', password: 'mgsh-2694' },
})

/** A provider that the committee is about to add in the picture of the new-provider dialog (never saved), with the password it shows. */
export const NEW_PROVIDER = Object.freeze({ contact: 'שירן עוזרי', company: 'ניקיון תכלת הבית', service: 'cleaning', password: 'shrn-5283' })

/** The points. `only` names the providers who may scan there (none: everyone). */
export const POINTS = Object.freeze({
  lobby: { name: 'לובי', description: 'ליד תיבות הדואר', service: 'cleaning', token: 'BQR-promo000000000000000001', only: [] },
  parking: { name: 'חניון מינוס 1', description: 'ליד המעלית', service: 'cleaning', token: 'BQR-promo000000000000000002', only: [] },
  garden: { name: 'גינה', description: 'ליד הברז', service: 'gardening', token: 'BQR-promo000000000000000003', only: ['gardener'] },
  elevator: { name: 'חדר המעלית', description: 'בקומת הגג', service: 'maintenance', token: 'BQR-promo000000000000000004', only: [] },
})

/** The radius of every point, in metres: the default of the committee app. */
export const RADIUS_M = POINT_RADIUS_DEFAULT_M

/**
 * The moments of the story that the run itself makes, in the building's time on the story's day: the cleaner checks in at the lobby
 * (online), at the parking (no signal, sent at `synced`), and tries a point from far away; the committee looks at it all afterwards.
 */
export const LIVE = Object.freeze({ lobby: '08:06', parking: '08:24', synced: '08:26', far: '08:31', committee: '08:40', start: '07:55' })

/** How far from the pin the phone stands for the live check-ins, in metres (D9: 5 to 10). */
export const LIVE_OFFSET_M = 7

/**
 * A position `metres` due north of the pin of every point (a degree of latitude is about 111,320 metres everywhere), with a good accuracy:
 * where the phone stands, in the seed's visits and in the run's own.
 * @param {number} metres
 */
export const positionNear = (metres) => ({ lat: SAMPLE_POINT.lat + metres / 111_320, lng: SAMPLE_POINT.lng, accuracy: 8 })

/**
 * The visits that the seed records before the run, for the week that ends on `today` (the story's day, see promoDay): a list of
 * `{ day, time, who, where, metres }`, where `metres` is how far from the pin the phone stood. The story:
 *  - the cleaner comes on the five workdays of the week (Sunday to Thursday), the lobby at about 08:05 and the parking at about 08:25, and
 *    missed one of them (`missingDay`). Today's two visits are the run's own (LIVE), so they are not here;
 *  - the gardener comes twice a week, early: today at 07:41 and four days ago, when the lobby was also scanned by mistake (the run
 *    cancels that visit in the committee app, which writes its audit row);
 *  - the elevator technician comes once, two days ago, and also tried the garden, where only the gardener may scan (the seed writes that
 *    refused visit, see REFUSAL).
 * @param {string} today  `YYYY-MM-DD`
 */
// The cleaner's times on the days before today (one to six days ago): about the same each morning, and never the two times of today's
// visits (LIVE), so that a row of 08:06 or 08:24 is today's.
const LOBBY_TIMES = ['08:04', '08:09', '08:02', '08:11', '08:05', '08:08']
const PARKING_TIMES = ['08:27', '08:31', '08:22', '08:33', '08:28', '08:29']

export function weekVisits(today) {
  const missing = missingDay(today)
  const visits = []
  for (let n = 6; n >= 1; n--) {
    const day = addDays(today, -n)
    if (!isWorkday(day) || day === missing) continue
    visits.push({ day, time: LOBBY_TIMES[n - 1], who: 'cleaner', where: 'lobby', metres: 5 + (n % 4) })
    visits.push({ day, time: PARKING_TIMES[n - 1], who: 'cleaner', where: 'parking', metres: 6 + (n % 3) })
  }
  const gardenDay = addDays(today, -4)
  visits.push({ day: gardenDay, time: '07:45', who: 'gardener', where: 'garden', metres: 8 })
  visits.push({ day: gardenDay, time: '07:47', who: 'gardener', where: 'lobby', metres: 6 }) // the visit by mistake
  visits.push({ day: addDays(today, -2), time: '10:12', who: 'technician', where: 'elevator', metres: 5 })
  visits.push({ day: today, time: '07:41', who: 'gardener', where: 'garden', metres: 9 })
  return visits.sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
}

/** The visit that the committee cancels in the run, and the reason it types. */
export const MISTAKE = Object.freeze({ who: 'gardener', where: 'lobby', time: '07:47', reason: 'נסרק בטעות' })

/** The refused visit: the technician at the garden, which only the gardener may scan, two days ago. */
export const REFUSAL = Object.freeze({ daysAgo: 2, time: '10:20', who: 'technician', where: 'garden' })
