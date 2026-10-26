// The promo video's captions in Hebrew, one per scene of video/promo/script/index.js (SCENES), keyed by scene id. There is no narrator:
// the captions are the whole message, so each one is plain text (no vowel points, no long dash) that video/promo/timing.js splits into
// phrases at its punctuation (`.`, `,`, `?`, `:`) and brings in one phrase per beat. Every caption must get its reading time in its
// scene (tests/video-promo.test.js), so a caption that grows means a longer scene, never a faster one.
export default {
  // 1. The question
  question: 'מי היה היום בבניין?',
  // 2. The problem
  providers: 'ספקים באים והולכים. ומי רושם?',
  // 3. The sign and the camera (nothing to install: the provider app has no scanner and no download)
  scan: 'סורקים את השלט עם המצלמה. בלי להוריד אפליקציה.',
  // 4. Offline (the check-in is queued and sent when the connection is back)
  offline: 'גם בלי קליטה: הנוכחות נשמרת ונשלחת כשהקליטה חוזרת.',
  // 5. The committee's screens (Home and History)
  committee: 'הוועד רואה מי הגיע, מתי ולאיזו נקודה.',
  // 6. Open source (README, "Install your own copy")
  open: 'קוד פתוח. עותק משלכם, והנתונים בחשבונות שלכם.',
  // 7. The closing card (the repository's address and its QR code)
  closing: 'תעבירו למישהו טכני בבניין.',
}
