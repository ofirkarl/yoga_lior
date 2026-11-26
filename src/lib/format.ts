// תאריכים ושעות תמיד לפי שעון ישראל, גם אם הטלפון מכוון אחרת
const TZ = "Asia/Jerusalem";

const dayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const shortDayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDate = (isoOrDate: string) =>
  dateFmt.format(new Date(isoOrDate.length === 10 ? `${isoOrDate}T12:00:00` : isoOrDate));

/** מפתח יום בשעון ישראל, לקיבוץ שיעורים לפי ימים */
export const dayKey = (iso: string) => keyFmt.format(new Date(iso));

/** "יום ראשון 20:00" — מועד הביטול כמו שמתאמנת אומרת אותו */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString());
  const k = dayKey(iso);
  const day = k === today ? "היום" : k === tomorrow ? "מחר" : shortDayFmt.format(d);
  return `${day} ב-${timeFmt.format(d)}`;
}

export function placesLeftText(left: number): string {
  if (left <= 0) return "השיעור מלא";
  if (left === 1) return "נותר מקום אחד";
  return `נותרו ${left} מקומות`;
}

export function missingText(missing: number): string {
  return missing === 1
    ? "חסרה עוד נרשמת אחת כדי שהשיעור יתקיים"
    : `חסרות עוד ${missing} נרשמות כדי שהשיעור יתקיים`;
}
