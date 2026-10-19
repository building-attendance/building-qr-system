// The tutorial video's narration in Hebrew, one line per beat of video/script/index.js (SCENES), in the order of the scenes.
// `caption` is what the video writes on the screen, `say` is what the narrator says: the same words for now, and `say` is the place to
// fix the narrator's pronunciation (vowel points, a spelled-out word) without changing the caption.
// `{key}` is the label of the app, taken from src/i18n by scripts/video/script.mjs, so that a renamed button renames the narration too.
// No long dash, and no date or time in a line (tests/video-script.test.js). A beat that `continues` (index.js) has no line here.
export default {
  // 1. The opening
  intro: {
    caption: 'כך רושמים נוכחות בבניין. זה לוקח כמה שניות.',
    say: 'כך רושמים נוכחות בבניין. זה לוקח כמה שניות.',
  },
  // 2. The sign at the point
  sign: {
    caption: 'בכל נקודה בבניין תלוי שלט עם קוד QR. פותחים את המצלמה של הטלפון, מכוונים לקוד ולוחצים על הקישור שמופיע. אין אפליקציה להורדה.',
    say: 'בכל נקודה בבניין תלוי שלט עם קוד QR. פותחים את המצלמה של הטלפון, מכוונים לקוד ולוחצים על הקישור שמופיע. אין אפליקציה להורדה.',
  },
  // 3. The list of names
  list: {
    caption: 'בפעם הראשונה בוחרים את השם שלכם מהרשימה.',
    say: 'בפעם הראשונה בוחרים את השם שלכם מהרשימה.',
  },
  // 4. The password, "stay signed in" and the sign-in button
  password: {
    caption: 'מקלידים את הסיסמה שקיבלתם מוועד הבית,',
    say: 'מקלידים את הסיסמה שקיבלתם מוועד הבית,',
  },
  submit: {
    caption: 'משאירים מסומן "{login.remember}" ולוחצים "{login.submit}".',
    say: 'משאירים מסומן "{login.remember}" ולוחצים "{login.submit}".',
  },
  // 5. Checking the location
  locating: {
    caption: 'הטלפון שואל אם לאפשר מיקום: מאשרים. המיקום רק מוודא שאתם ליד הנקודה. המיקום עצמו לא נשמר בשרת, רק המרחק.',
    say: 'הטלפון שואל אם לאפשר מיקום: מאשרים. המיקום רק מוודא שאתם ליד הנקודה. המיקום עצמו לא נשמר בשרת, רק המרחק.',
  },
  // 6. The visit is recorded
  recorded: {
    caption: 'וזהו: "{checkin.success.title}". רואים את השעה, את הנקודה ואת השם שלכם. לוחצים "{checkin.done}".',
    say: 'וזהו: "{checkin.success.title}". רואים את השעה, את הנקודה ואת השם שלכם. לוחצים "{checkin.done}".',
  },
  // 7. The home screen
  home: {
    caption: 'מהפעם הבאה רק סורקים. במסך הבית מופיעים הביקורים שלכם היום.',
    say: 'מהפעם הבאה רק סורקים. במסך הבית מופיעים הביקורים שלכם היום.',
  },
  // 8. Too far from the point
  far: {
    caption: 'אם כתוב "{checkin.far.title}", גשו קרוב לשלט וסרקו שוב.',
    say: 'אם כתוב "{checkin.far.title}", גשו קרוב לשלט וסרקו שוב.',
  },
  // 9. No signal
  queued: {
    caption: 'אין קליטה? הנוכחות נשמרת בטלפון ונשלחת לבד כשהקליטה חוזרת.',
    say: 'אין קליטה? הנוכחות נשמרת בטלפון ונשלחת לבד כשהקליטה חוזרת.',
  },
  pending: {
    caption: 'אפשר גם ללחוץ "{home.syncNow}".',
    say: 'אפשר גם ללחוץ "{home.syncNow}".',
  },
  // 10. The language
  language: {
    caption: 'בכפתור הגלובוס למעלה בוחרים שפה: עברית, English, Русский או العربية.',
    say: 'בכפתור הגלובוס למעלה בוחרים שפה: עברית, English, Русский או العربية.',
  },
  // 11. The end
  outro: {
    caption: 'שאלות? פנו לוועד הבית.',
    say: 'שאלות? פנו לוועד הבית.',
  },
}
