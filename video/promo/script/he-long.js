// The long promo's captions in Hebrew, one per scene of video/promo/script/long.js (LONG_SCENES), keyed by scene id: the words of the
// topic plan "promo-long" (the recommended script), word for word. Like he.js there is no narrator and each caption is plain text that
// video/promo/timing.js cuts into phrases at `.`, `,`, `?` and `:`. A word that is not Hebrew (Excel, Google, AI) stays as it is; the
// composition isolates it. The terms are fixed: always "נותני שירות" (never "ספקים"), and never "free", "you cannot cheat", "working
// hours", "in real time" or "our AI" (tests/video-promo.test.js holds them). Every caption must get its reading time in its scene.
export default {
  // The title card: the short cut's opening question, word for word (he.js)
  question: 'מי היה היום בבניין?',
  // The opening
  pays: 'הוועד משלם על ניקיון וגינון. ומי בודק שהם הגיעו?',
  sign: 'שלט בכל נקודה. סורקים עם המצלמה, בלי להוריד אפליקציה.',
  sees: 'והוועד רואה מי הגיע, מתי ולאיזו נקודה.',
  // The committee prepares
  points: 'לובי או גינה: כל מקום הוא נקודה. מסמנים במפה ומדפיסים שלט.',
  access: 'בוחרים מי רשאי לסרוק בכל נקודה, ולכל נותן שירות סיסמה אישית.',
  // The providers scan: one cleaner's morning
  signin: 'רק בפעם הראשונה: בוחרים שם ומקלידים סיסמה.',
  far: 'רחוקים מהנקודה? הטלפון מבקש לגשת אליה ולסרוק שוב.',
  recorded: 'נרשם: מי, איפה ומתי. מהמיקום נשמר רק המרחק.',
  offline: 'אין קליטה במרתף? הנוכחות נשמרת בטלפון, ונשלחת לבד כשהקליטה חוזרת.',
  today: 'גם הם רואים מה נרשם להם היום, בעברית, אנגלית, רוסית וערבית.',
  // The committee sees
  counts: 'כל השבוע במבט אחד: מי הגיע, כמה פעמים, ומי לא.',
  visit: 'אותו ביקור אצל הוועד: השעה, הנקודה והמרחק.',
  late: 'וגם הביקור מהמרתף, בשעה שבה נסרק.',
  refused: 'סריקה שלא נקלטה? רואים אותה, עם הסיבה.',
  filters: 'מסננים לפי תאריך, נקודה ונותן שירות. וייצוא ל-Excel.',
  cancel: 'ביקור נרשם בטעות? מבטלים, ואפשר לשחזר. וכל שינוי נרשם ביומן.',
  // The committee's AI
  agent: 'AI עם מפתח לקריאה בלבד עונה מתי לא הגיעו.',
  // What it takes
  open: 'קוד פתוח, בלי דמי רישיון. הנתונים בענן שלכם.',
  install: 'בניין אחד בכל התקנה. מתקין מתנדב טכני אחד.',
  closing: 'תעבירו למישהו טכני בבניין.',
}

// The keyword of each caption (the same field as he.js): one or two consecutive words of it, exactly as the caption writes them.
export const keywords = {
  question: 'מי',
  pays: 'בודק',
  sign: 'סורקים',
  sees: 'רואה',
  points: 'נקודה.',
  access: 'סיסמה',
  signin: 'הראשונה:',
  far: 'רחוקים',
  recorded: 'המרחק.',
  offline: 'קליטה',
  today: 'אנגלית,',
  counts: 'השבוע',
  visit: 'אותו',
  late: 'מהמרתף,',
  refused: 'הסיבה.',
  filters: 'ל-Excel.',
  cancel: 'מבטלים,',
  agent: 'לקריאה בלבד',
  open: 'פתוח,',
  install: 'מתנדב',
  closing: 'טכני',
}

// The drawn chat of the AI scene (decision D8): the question as it is, and the answer as a template. The composition fills the
// `{...}` places from `agentSample` in L1's frames.json (the sample data's own counts, so the answer is true to what the video shows):
// {provider} the cleaning provider's name as the agent API writes it (the company is already in it, in parentheses), {days} the days of
// the week with a visit of theirs (the API counts check-ins, two a day, so the composition counts the days of `byDay`), {missingDate} the
// workday without one, as DD/MM/YYYY (formatDay of shared/datetime.js). The answer reads right for a provider of either gender ("visits
// were recorded", never "he was recorded"). The 5 is the question's own (the agreement). Nothing here is a real number.
export const agentChat = {
  question: 'לפי ההסכם הניקיון מגיע 5 פעמים בשבוע. מתי הוא לא הגיע?',
  answer: 'בשבוע האחרון נרשמו ביקורים של {provider} ב-{days} ימים מתוך 5. היום בלי ביקור: {missingDate}.',
  placeholders: ['provider', 'days', 'missingDate'],
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
