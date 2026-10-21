// The words that the video draws itself, in the four languages of the app: the title cards of the opening and the end, and the phone's own
// question about the location (the camera and the question are drawn, not recorded: video/src/Video.jsx). Like the narration in he.js
// (AGENTS.md, "Rules for every change"), this is text that a person reads in the video. Plain data, read by video/src/ and by the site step (scripts/video/render-all.mjs).
//
// - `link` is the address that the camera offers over the QR code of the sign: the production domain that is printed on every sign.
// - `voiceCredit` is the credit of a voice that a service made (decision D2): the closing card shows it under the title.
// - `watchFromStart` is the link of the player page that starts after the sign-in (video/site/player.html), back to the whole video.
// - The question is neutral on purpose: it does not copy the dialog of Android or of iOS, which differ between phones and versions.
export const DRAWN = Object.freeze({
  he: {
    introTitle: 'רישום נוכחות בבניין',
    introSubtitle: 'הדרכה קצרה לנותני שירות',
    outroTitle: 'בהצלחה!',
    outroSubtitle: 'רישום נוכחות בבניין',
    link: 'building-qr-system.vercel.app',
    locationTitle: 'לאפשר גישה למיקום?',
    locationBody: 'המיקום מוודא שאתם ליד הנקודה.',
    locationAllow: 'לאפשר',
    locationDeny: 'לא לאפשר',
    voiceCredit: 'קול: ElevenLabs',
    watchFromStart: 'לצפות מההתחלה',
  },
  en: {
    introTitle: 'Checking in at the building',
    introSubtitle: 'A short guide for service providers',
    outroTitle: 'Good luck!',
    outroSubtitle: 'Checking in at the building',
    link: 'building-qr-system.vercel.app',
    locationTitle: 'Allow access to your location?',
    locationBody: 'It confirms that you are near the point.',
    locationAllow: 'Allow',
    locationDeny: 'Do not allow',
    voiceCredit: 'Voice: ElevenLabs',
    watchFromStart: 'Watch from the start',
  },
  ru: {
    introTitle: 'Отметка о посещении здания',
    introSubtitle: 'Краткая инструкция для подрядчиков',
    outroTitle: 'Удачи!',
    outroSubtitle: 'Отметка о посещении здания',
    link: 'building-qr-system.vercel.app',
    locationTitle: 'Разрешить доступ к местоположению?',
    locationBody: 'Оно подтверждает, что вы рядом с точкой.',
    locationAllow: 'Разрешить',
    locationDeny: 'Не разрешать',
    voiceCredit: 'Голос: ElevenLabs',
    watchFromStart: 'Смотреть с начала',
  },
  ar: {
    introTitle: 'تسجيل الحضور في المبنى',
    introSubtitle: 'دليل قصير لمقدمي الخدمة',
    outroTitle: 'بالتوفيق!',
    outroSubtitle: 'تسجيل الحضور في المبنى',
    link: 'building-qr-system.vercel.app',
    locationTitle: 'السماح بالوصول إلى الموقع؟',
    locationBody: 'يؤكد الموقع أنك قرب النقطة.',
    locationAllow: 'السماح',
    locationDeny: 'عدم السماح',
    voiceCredit: 'الصوت: ElevenLabs',
    watchFromStart: 'المشاهدة من البداية',
  },
})
