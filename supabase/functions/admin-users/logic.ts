// לוגיקה טהורה, בלי תלות ב-Supabase, כדי שאפשר יהיה לבדוק אותה בנפרד.

/** דומיין פנימי למשתמשות בלי אימייל. לא מקבל דואר ולעולם לא יקבל (RFC 2606). */
export const USERNAME_DOMAIN = "users.yoga.invalid";

/** אותו כלל כמו בבסיס הנתונים: אותיות לטיניות קטנות, ספרות, נקודה, קו תחתון ומקף. */
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export function usernameToEmail(username: string): string {
  return `${username}@${USERNAME_DOMAIN}`;
}

export function isUsernameAccount(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${USERNAME_DOMAIN}`);
}

// בלי תווים שקל להתבלבל ביניהם (0/O, 1/l/I), כדי שליאור תוכל להקריא בטלפון
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** סיסמה זמנית אקראית. 12 תווים מתוך 55 אפשרויות, כ-69 ביט אקראיות. */
export function generateTempPassword(length = 12): string {
  const out: string[] = [];
  // דחיית ערכים מעל הכפולה הגדולה ביותר של אורך האלפבית, כדי שכל תו יהיה שווה הסתברות
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("");
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().replace(/\s+/g, " ");
  return n.length >= 2 && n.length <= 80 ? n : null;
}

export function cleanPhone(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const p = raw.replace(/[\s-]/g, "");
  return /^\+?[0-9]{9,15}$/.test(p) ? p : null;
}
