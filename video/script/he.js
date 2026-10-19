// The tutorial video's narration in Hebrew, one line per beat of video/script/index.js (SCENES), in the order of the scenes.
// `caption` is what the video writes on the screen, plain, with no vowel points. `say` is what the narrator reads: the same words with
// vowel points (niqqud) on every Hebrew word, because the narrator misread the plain text (the owner, 19/10/2026).
// `{key}` is the label of the app, taken from src/i18n by scripts/video/script.mjs, so that a renamed button renames the caption. The say
// line spells that label out with its vowel points instead, and scripts/video/script.mjs (VOWELLED_LANGUAGES) fails the script when the
// two no longer give the same words, so a renamed button waits for its vowelled form.
// No long dash, and no date or time in a line (tests/video-script.test.js). A beat that `continues` (index.js) has no line here.
export default {
  // 1. The opening
  intro: {
    caption: 'כך רושמים נוכחות בבניין. זה לוקח כמה שניות.',
    say: 'כָּךְ רוֹשְׁמִים נוֹכְחוּת בַּבִּנְיָן. זֶה לוֹקֵחַ כַּמָּה שְׁנִיּוֹת.',
  },
  // 2. The sign at the point
  sign: {
    caption: 'בכל נקודה בבניין תלוי שלט עם קוד QR. פותחים את המצלמה של הטלפון, מכוונים לקוד ולוחצים על הקישור שמופיע. אין אפליקציה להורדה.',
    say: 'בְּכָל נְקֻדָּה בַּבִּנְיָן תָּלוּי שֶׁלֶט עִם קוֹד QR. פּוֹתְחִים אֶת הַמַּצְלֵמָה שֶׁל הַטֶּלֶפוֹן, מְכַוְּנִים לַקּוֹד וְלוֹחֲצִים עַל הַקִּשּׁוּר שֶׁמּוֹפִיעַ. אֵין אַפְּלִיקַצְיָה לְהוֹרָדָה.',
  },
  // 3. The list of names
  list: {
    caption: 'בפעם הראשונה בוחרים את השם שלכם מהרשימה.',
    say: 'בַּפַּעַם הָרִאשׁוֹנָה בּוֹחֲרִים אֶת הַשֵּׁם שֶׁלָּכֶם מֵהָרְשִׁימָה.',
  },
  // 4. The password, "stay signed in" and the sign-in button
  password: {
    caption: 'מקלידים את הסיסמה שקיבלתם מוועד הבית,',
    say: 'מַקְלִידִים אֶת הַסִּיסְמָה שֶׁקִּבַּלְתֶּם מִוַּעַד הַבַּיִת,',
  },
  submit: {
    caption: 'משאירים מסומן "{login.remember}" ולוחצים "{login.submit}".',
    say: 'מַשְׁאִירִים מְסֻמָּן "לְהִשָּׁאֵר מְחֻבָּרִים בַּטֶּלֶפוֹן הַזֶּה" וְלוֹחֲצִים "כְּנִיסָה".',
  },
  // 5. Checking the location
  locating: {
    caption: 'הטלפון שואל אם לאפשר מיקום: מאשרים. המיקום רק מוודא שאתם ליד הנקודה. המיקום עצמו לא נשמר בשרת, רק המרחק.',
    say: 'הַטֶּלֶפוֹן שׁוֹאֵל אִם לְאַפְשֵׁר מִקּוּם: מְאַשְּׁרִים. הַמִּקּוּם רַק מְוַדֵּא שֶׁאַתֶּם לְיַד הַנְּקֻדָּה. הַמִּקּוּם עַצְמוֹ לֹא נִשְׁמָר בַּשָּׁרָת, רַק הַמֶּרְחָק.',
  },
  // 6. The visit is recorded
  recorded: {
    caption: 'וזהו: "{checkin.success.title}". רואים את השעה, את הנקודה ואת השם שלכם. לוחצים "{checkin.done}".',
    say: 'וְזֶהוּ: "הַנּוֹכְחוּת נִרְשְׁמָה". רוֹאִים אֶת הַשָּׁעָה, אֶת הַנְּקֻדָּה וְאֶת הַשֵּׁם שֶׁלָּכֶם. לוֹחֲצִים "סִיַּמְתִּי".',
  },
  // 7. The home screen
  home: {
    caption: 'מהפעם הבאה רק סורקים. במסך הבית מופיעים הביקורים שלכם היום.',
    say: 'מֵהַפַּעַם הַבָּאָה רַק סוֹרְקִים. בְּמָסַךְ הַבַּיִת מוֹפִיעִים הַבִּקּוּרִים שֶׁלָּכֶם הַיּוֹם.',
  },
  // 8. Too far from the point
  far: {
    caption: 'אם כתוב "{checkin.far.title}", גשו קרוב לשלט וסרקו שוב.',
    say: 'אִם כָּתוּב "לֹא נִרְאֶה שֶׁאַתֶּם לְיַד הַנְּקֻדָּה", גְּשׁוּ קָרוֹב לַשֶּׁלֶט וְסִרְקוּ שׁוּב.',
  },
  // 9. No signal
  queued: {
    caption: 'אין קליטה? הנוכחות נשמרת בטלפון ונשלחת לבד כשהקליטה חוזרת.',
    say: 'אֵין קְלִיטָה? הַנּוֹכְחוּת נִשְׁמֶרֶת בַּטֶּלֶפוֹן וְנִשְׁלַחַת לְבַד כְּשֶׁהַקְּלִיטָה חוֹזֶרֶת.',
  },
  pending: {
    caption: 'אפשר גם ללחוץ "{home.syncNow}".',
    say: 'אֶפְשָׁר גַּם לִלְחֹץ "שְׁלִיחָה עַכְשָׁו".',
  },
  // 10. The language
  language: {
    caption: 'בכפתור הגלובוס למעלה בוחרים שפה: עברית, English, Русский או العربية.',
    say: 'בְּכַפְתּוֹר הַגְּלוֹבּוּס לְמַעְלָה בּוֹחֲרִים שָׂפָה: עִבְרִית, English, Русский אוֹ العربية.',
  },
  // 11. The end
  outro: {
    caption: 'שאלות? פנו לוועד הבית.',
    say: 'שְׁאֵלוֹת? פְּנוּ לְוַעַד הַבַּיִת.',
  },
}
