// The long promo's captions in Hebrew, one per scene of video/promo/script/long.js (LONG_SCENES), keyed by scene id: the words of the
// topic plan "promo-long" (the recommended script), word for word. Like he.js there is no narrator and each caption is plain text that
// video/promo/timing.js cuts into phrases at `.`, `,`, `?` and `:`. A word that is not Hebrew (Excel, Google, AI) stays as it is; the
// composition isolates it. The terms are fixed: always "נותני שירות" (never "ספקים"), and never "free", "you cannot cheat", "working
// hours", "in real time" or "our AI" (tests/video-promo.test.js holds them). Every caption must get its reading time in its scene.
export default {
  // The opening
  pays: 'הוועד משלם על ניקיון וגינון. ומי בודק שהם הגיעו?',
  sign: 'שלט בכל נקודה. סורקים עם המצלמה, בלי להוריד אפליקציה.',
  sees: 'והוועד רואה מי הגיע, מתי ולאיזו נקודה.',
  // The committee prepares
  points: 'לובי או גינה: כל מקום כזה הוא נקודה.',
  map: 'מסמנים אותה במפה, ומדפיסים לה שלט.',
  access: 'ובוחרים מי רשאי לסרוק בכל נקודה.',
  provider: 'מוסיפים כל נותן שירות, עם סיסמה אישית.',
  // The providers scan
  signin: 'רק בפעם הראשונה: בוחרים שם ומקלידים סיסמה.',
  notice: 'לפני הכניסה, כתוב בדיוק מה נרשם ולמה.',
  recorded: 'נרשם: מי, איפה ומתי. מהמיקום נשמר רק המרחק.',
  offline: 'אין קליטה במרתף? הנוכחות נשמרת בטלפון, ונשלחת לבד כשהקליטה חוזרת.',
  far: 'רחוקים מהנקודה? הטלפון מבקש לגשת אליה ולסרוק שוב.',
  today: 'גם הם רואים מה נרשם להם היום.',
  languages: 'בעברית, אנגלית, רוסית וערבית.',
  tutorial: 'ובאפליקציה יש סרטון הדרכה קצר.',
  // The committee sees
  week: 'כל השבוע במבט אחד.',
  counts: 'כמה ביקורים לכל נותן שירות, בכל יום. וגם מי לא הגיע.',
  visit: 'אותו ביקור אצל הוועד: השעה, הנקודה והמרחק.',
  late: 'וגם הביקור מהמרתף, בשעה שבה נסרק.',
  refused: 'סריקה שלא נקלטה? רואים אותה, עם הסיבה.',
  filters: 'מסננים לפי תאריך, נקודה ונותן שירות. וייצוא ל-Excel.',
  cancel: 'ביקור נרשם בטעות? מבטלים, ואפשר לשחזר.',
  audit: 'וכל שינוי של הוועד נרשם ביומן: מי, מה ומתי.',
  admins: 'חברי הוועד נכנסים עם Google. רק מי שברשימה.',
  // The committee's AI
  agent: 'יש לוועד AI משלו? נותנים לו מפתח לקריאה בלבד.',
  // What it takes
  open: 'קוד פתוח, בלי דמי רישיון. הנתונים בענן שלכם.',
  install: 'בניין אחד בכל התקנה. מתקין מתנדב טכני אחד.',
  closing: 'תעבירו למישהו טכני בבניין.',
}

// The keyword of each caption (the same field as he.js): one or two consecutive words of it, exactly as the caption writes them.
export const keywords = {
  pays: 'בודק',
  sign: 'סורקים',
  sees: 'רואה',
  points: 'נקודה.',
  map: 'במפה,',
  access: 'רשאי',
  provider: 'סיסמה',
  signin: 'הראשונה:',
  notice: 'בדיוק',
  recorded: 'המרחק.',
  offline: 'קליטה',
  far: 'רחוקים',
  today: 'היום.',
  languages: 'אנגלית,',
  tutorial: 'הדרכה',
  week: 'השבוע',
  counts: 'לא הגיע.',
  visit: 'אותו',
  late: 'מהמרתף,',
  refused: 'הסיבה.',
  filters: 'ל-Excel.',
  cancel: 'מבטלים,',
  audit: 'ביומן:',
  admins: 'שברשימה.',
  agent: 'לקריאה בלבד.',
  open: 'פתוח,',
  install: 'מתנדב',
  closing: 'טכני',
}

// The drawn chat of the AI scene (decision D8): the question as it is, and the answer as a template. The composition fills the
// `{...}` places from `agentSample` in L1's frames.json (the sample data's own counts, so the answer is true to what the video shows):
// {provider} the provider's name, {type} the service type, {visits} the visits that week, {missingDate} the one day without a visit, as
// DD/MM/YYYY (shared/datetime.js). The 5 is the question's own (the agreement). Nothing here is a real number.
export const agentChat = {
  question: 'לפי ההסכם הניקיון מגיע 5 פעמים בשבוע. מתי הוא לא הגיע?',
  answer: 'בשבוע האחרון {provider} ({type}) נרשם {visits} פעמים מתוך 5. היום החסר: {missingDate}.',
  placeholders: ['provider', 'type', 'visits', 'missingDate'],
}

// The words that are not captions: the tag over the drawn chat, the label of the guide on the closing card, and the stages of the
// progress strip (the four that STRIP_STAGES in long.js names).
export const labels = {
  illustration: 'המחשה, נתוני דוגמה',
  guide: 'המדריך באנגלית',
  stages: {
    prepare: 'הוועד מכין',
    scan: 'נותני השירות סורקים',
    see: 'הוועד רואה',
    need: 'מה צריך',
  },
}
