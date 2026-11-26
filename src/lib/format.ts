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

/** "יום ראשון ב-20:00": מועד הביטול כמו שאומרים אותו */
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
    ? "השיעור יתקיים אם תהיה עוד הרשמה אחת"
    : `השיעור יתקיים אם יהיו עוד ${missing} הרשמות`;
}

const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
export const formatMoney = (n: number) => money.format(n);

const monthFmt = new Intl.DateTimeFormat("he-IL", { month: "short" });
export const formatMonth = (yyyyMm: string) => monthFmt.format(new Date(`${yyyyMm}-15T12:00:00Z`));

/** "לפני 5 דקות", "אתמול" — לפיד הפעילות */
export function timeAgo(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1) return "עכשיו";
  if (diff < 60) return diff === 1 ? "לפני דקה" : `לפני ${diff} דקות`;
  const h = Math.round(diff / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : h === 2 ? "לפני שעתיים" : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  if (d === 1) return "אתמול";
  if (d < 7) return `לפני ${d} ימים`;
  return formatDate(iso);
}

export const METHOD_LABEL: Record<string, string> = {
  grow: "Grow", cash: "מזומן", paybox: "פייבוקס", bit: "ביט", transfer: "העברה", other: "אחר",
};

/** "א׳ 18:30" — יום ושעה קצרים */
const shortWeekday = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short" });
export const formatShortWhen = (iso: string) => `${shortWeekday.format(new Date(iso))} ${formatTime(iso)}`;
