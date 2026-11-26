// הודעות שגיאה בעברית. לא מאשימות את המשתמשת, ותמיד אומרות מה אפשר לעשות.
const MESSAGES: Record<string, string> = {
  not_allowed: "אין הרשאה לפעולה הזו. אם זה נראה לך לא נכון, כדאי לפנות לליאור.",
  health_declaration_required: "לפני ההרשמה הראשונה צריך למלא הצהרת בריאות.",
  session_unavailable: "השיעור הזה כבר לא פתוח להרשמה.",
  session_started: "השיעור כבר התחיל.",
  too_early: "ההרשמה לשיעור הזה עוד לא נפתחה. אפשר להירשם עד חודש מראש.",
  zoom_unavailable: "בשיעור הזה אין השתתפות בזום.",
  already_booked: "כבר נרשמת לשיעור הזה.",
  no_entitlement: "אין כרגע כרטיסייה בתוקף שמתאימה לשיעור הזה. אפשר לרכוש אצל ליאור.",
  cannot_cancel: "את ההרשמה הזו כבר אי אפשר לבטל.",
  invalid_login: "שם המשתמש או הסיסמה לא תואמים. אפשר לנסות שוב, או לבקש מליאור לאפס את הסיסמה.",
  weak_password: "הסיסמה צריכה להיות באורך 8 תווים לפחות.",
  same_password: "הסיסמה החדשה צריכה להיות שונה מהזמנית.",
  network: "אין חיבור כרגע. כדאי לבדוק את האינטרנט ולנסות שוב.",
};

export const GENERIC_ERROR = "משהו השתבש. אפשר לנסות שוב בעוד רגע.";

/** מחלץ קוד שגיאה מוכר מתוך שגיאה של Supabase או מהדפדפן */
export function errorCode(err: unknown): string | null {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  if (/Failed to fetch|NetworkError|network/i.test(text)) return "network";
  if (/Invalid login credentials/i.test(text)) return "invalid_login";
  if (/should be different/i.test(text)) return "same_password";
  if (/at least \d+ characters|weak/i.test(text)) return "weak_password";
  const code = Object.keys(MESSAGES).find((k) => text.includes(k));
  return code ?? null;
}

export function errorMessage(err: unknown): string {
  const code = errorCode(err);
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}
