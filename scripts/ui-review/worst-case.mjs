// The worst-case fake data of the UI review pictures (npm run ui-review:pictures, see docs/testing.md and the ui-review skill).
// Plain data and nothing else: no database, no browser and no app code, so the seed (scripts/ui-review/seed.mjs), the spec that takes
// the pictures and tests/ui-review.test.js can all import it.
//
// The rules are those of the break-ui skill. Every value is either something a real person could type or the longest value that the
// server accepts (the limits are in shared/contract.js and in the migrations, and tests/ui-review.test.js reads them from there): a
// building name of 80 characters, an address of 200, a company of 120. Every value is made up. The repository is public, so no real
// person, company, address, telephone number or coordinate is here: the names are the Hebrew and Russian placeholders (Ploni,
// Almoni, "Primerov-Obraztsovsky" is "Example-Sample"), the e-mail addresses end in example.test, and the points are at the sample
// position of scripts/sample-data.mjs (open sea).
//
// The data starts from the rows of the dev seed (scripts/dev-seed.mjs), which the seed of the review finds by the names in SAMPLE
// below, and replaces some of them (a rename of a row that already has the password the dev seed gave it, so that the spec can sign
// in as that person) and adds a few. A row that the worst case does not touch stays as the dev seed made it, so that every list also
// has ordinary rows next to the extreme ones, as real data does.

/** The rows of the dev seed that the worst case replaces, by the value that the dev seed gave them. */
export const SAMPLE = Object.freeze({
  admin: 'dev@example.test',
  gardener: 'גינון', // company of the provider whose contact is Almoni
  russian: 'Уборка', // company of the provider whose contact is Ivan
  english: 'Cleaning Co', // company of the provider whose contact is John
  cleaner: 'ניקיון', // company of the provider whose contact is Ploni: left as the dev seed made it
  lobby: 'לובי',
  basement: 'מינוס 1', // left as it is
  gym: 'גימבורי',
})

/** The member of the committee that the dev seed makes, for the empty building (a new installation has only the member who set it up). */
export const PLAIN_ADMIN = Object.freeze({ email: 'dev@example.test', name: 'Dev Admin' })

/**
 * The building: the name and the address at the longest the server accepts (80 and 200 characters), and the committee's contact
 * for privacy requests at its longest (120), a phone and an e-mail address that is one long word.
 */
export const BUILDING = Object.freeze({
  privacy_contact: 'ועד הבית, טלפון 000-0000000, דוא"ל committee.of.the.green.view.towers.and.the.tall.sycamores.north.building@example.test',
  name: 'ועד הבית של מגדלי הנוף הירוק והשקמים הגבוהים, בניין A ו-B בשכונת הדוגמה הצפונית.',
  address:
    'שדרות הדוגמה הצפונית הארוכה מאוד 11140, כניסה ג, קומה 12, דירה 144, מתחם מגדלי הנוף הירוק והשקמים, שכונת הפרחים הצפונית, עיר לדוגמה ואזור הדוגמה, ליד תחנת הרכבת הקלה וגן המשחקים הציבורי, מיקוד 0000000',
})

/**
 * The committee. `signedIn` is the member that the pictures sign in as (the local dev sign-in takes the e-mail): a name of 120
 * characters whose first word is long (the greeting of the Home screen takes it), and a long e-mail. `oneLetter` is a name of one
 * letter with the shortest e-mail there is. `noName` has no name at all, only a long address, and the screen must fall back to something.
 */
export const ADMINS = Object.freeze({
  signedIn: Object.freeze({
    name: 'אברהם-יצחק בן-ציון הדוגמה-רוזנברג השני, יושב ראש הוועד ואחראי על מערכות הבניין, החניון והגגות המשותפים',
    email: 'avraham.yitzhak.ben-tzion+committee-chair-notifications@management.maintenance-department.north-region.example.test',
  }),
  oneLetter: Object.freeze({ name: 'ג', email: 'a@b.test' }),
  noName: Object.freeze({ name: '', email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.test' }),
})

/**
 * The service providers. `hebrew`, `russian` and `oneWord` rename the sample providers that carry the password of the dev seed
 * (`password`: dev-pass-2, dev-pass-3 and dev-pass-4 in scripts/dev-seed.mjs, values that exist only inside a scratch schema);
 * `short` is added, with a password of its own. A provider with no contact name is shown by its company.
 *  - hebrew: a company and a contact in Hebrew, both long, and a long service name;
 *  - russian: Russian runs longest of the four languages, a company of 120 characters and a contact with a hyphenated surname;
 *  - oneWord: one long word with no space and no contact, in the Latin alphabet (a German compound, as real ones are);
 *  - short: a contact of two letters and a company of one, and the only visit of the week (a count of exactly 1).
 */
export const PROVIDERS = Object.freeze({
  hebrew: Object.freeze({
    company: 'חברת הניקיון, התחזוקה והשירות המקצועית לבנייני מגורים ומשרדים בעיר הדוגמה ובסביבותיה, לכל הקומות, החניונים והחצרות, בע"מ',
    contact_name: 'פלוני בן אלמוני בן פלוני הדוגמה הראשון, מנהל הצוות לחדרי מדרגות ומעליות באזור הצפון והמרכז של העיר',
    service_type: 'גינון ותחזוקת גגות ירוקים ומערכות השקיה אוטומטיות במתחם',
    password: 'dev-pass-2',
  }),
  russian: Object.freeze({
    company: 'Общество с ограниченной ответственностью «Профессиональная уборка и содержание жилых и офисных зданий города Образцовое»',
    contact_name: 'Константин Константинович Примеров-Образцовский, старший бригадир по уборке лестничных клеток и лифтов',
    service_type: 'cleaning',
    password: 'dev-pass-3',
  }),
  oneWord: Object.freeze({
    company: 'Gebaeudereinigungsunternehmensdienstleistungsgesellschaft',
    contact_name: '',
    service_type: 'maintenance',
    password: 'dev-pass-4',
  }),
  short: Object.freeze({ company: 'J', contact_name: 'Jo', service_type: null, password: 'dev-pass-6' }),
})

/**
 * The points. `lobby` renames the sample point of that name: a name of 108 characters, a description of the longest the server
 * accepts (500), a long service name (the field is free text of 60 characters at most), and three providers who may scan it (the
 * card lists their names). `gym` has a long name in Hebrew and Latin letters and exactly one provider who may scan it (a count of 1).
 */
export const POINTS = Object.freeze({
  lobby: Object.freeze({
    name: 'כניסה ראשית ולובי הקומה הקרקעית של מגדל A, כולל חדר הדואר, עמדת השמירה והמעליות הצפוניות והדרומיות של הבניין',
    description:
      'הנקודה נמצאת מיד אחרי דלת הזכוכית הראשית, ליד עמדת השמירה ולוח המודעות של הוועד. השלט מודפס על עמוד הברזל הכחול משמאל לדלת המעלית הצפונית, בגובה העיניים, ' +
      'ואפשר לסרוק אותו גם כשהדלת פתוחה לרווחה. נותני השירות מתבקשים לסרוק בכניסה ולא בתוך המעלית, כדי שהמיקום יהיה מדויק ככל האפשר. ' +
      'בשעות הערב והלילה הכניסה הראשית נעולה, והכניסה היחידה היא דרך החניון התחתון, דלת הברזל האפורה ליד מכלי האשפה. ' +
      'אם השלט נקרע, פגום או חסר, יש להודיע לוועד ולא לסרוק את השלט הישן שמודבק על הקיר שם. תודה רבה על שיתוף הפעולה.',
    service_type: 'ניקיון וחיטוי חדרי מדרגות, מעליות ושטחים משותפים בכל הקומות',
  }),
  gym: Object.freeze({
    name: 'חדר כושר וסאונה, קומת הגג המערבית של מגדל B, כניסה נפרדת מחדר המדרגות הראשי',
  }),
})

/** The key of the committee's agent: the one key of the list (an item alone), and a name of the longest the server accepts (80). */
export const AGENT_KEY = Object.freeze({ name: "האייג'נט של ועד הבית לניתוח נוכחות, ניקיון וגינון, גרסת הניסוי השנייה והארוכה" })

/**
 * The visits of the last days, as [days ago, "HH:MM" in the building's time, who, where]. They go through recordScan, so each is an
 * ordinary accepted visit, with the names as they are at the moment of the visit (a visit keeps the name of the person and of the
 * point, so the renames above come first). A busy day, a quiet one, a day with exactly one visit, and a provider whose only visit of
 * the week is a single one. Every visit of the same person at the same point is more than 10 minutes after the one before it (the
 * cooldown of a scan).
 */
export const VISITS = Object.freeze([
  [1, '07:10', 'hebrew', 'lobby'],
  [1, '07:55', 'russian', 'lobby'],
  [1, '08:20', 'cleaner', 'gym'],
  [1, '08:45', 'cleaner', 'basement'],
  [1, '09:30', 'oneWord', 'lobby'],
  [1, '10:15', 'hebrew', 'basement'],
  [1, '11:40', 'russian', 'basement'],
  [1, '13:05', 'cleaner', 'basement'],
  [1, '14:20', 'oneWord', 'basement'],
  [1, '15:00', 'hebrew', 'lobby'],
  [1, '16:30', 'russian', 'lobby'],
  [1, '17:50', 'cleaner', 'gym'],
  [2, '07:20', 'hebrew', 'lobby'],
  [2, '08:05', 'russian', 'lobby'],
  [2, '08:30', 'cleaner', 'gym'],
  [2, '10:00', 'oneWord', 'basement'],
  [2, '13:15', 'russian', 'basement'],
  [2, '16:45', 'hebrew', 'basement'],
  [3, '07:40', 'hebrew', 'lobby'],
  [3, '08:10', 'cleaner', 'gym'],
  [3, '12:00', 'oneWord', 'lobby'],
  [4, '09:25', 'russian', 'lobby'],
  [5, '07:35', 'hebrew', 'lobby'],
  [5, '09:00', 'short', 'basement'],
  [5, '11:10', 'cleaner', 'basement'],
  [5, '15:30', 'russian', 'lobby'],
])

/**
 * Visits that the server did not count, with the names as the server keeps them (the person as "contact (company)", at most 243
 * characters; the point, at most 120). Added straight to the table as the dev seed does, for the list of them on the History screen
 * and the count on Home. [minutes ago, code, who, where]
 */
export const REFUSALS = Object.freeze([
  [90, 'not_assigned', 'russian', 'gym'],
  [45, 'point_inactive', 'hebrew', null],
])

/** What the pictures sign in as: the committee member, and the provider with the longest name (Russian). */
export const SIGN_IN = Object.freeze({
  admin: ADMINS.signedIn.email,
  provider: Object.freeze({ role: 'russian', name: PROVIDERS.russian.contact_name, password: PROVIDERS.russian.password }),
})
