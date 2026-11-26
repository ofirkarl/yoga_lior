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
  admin_only: "הפעולה הזו פתוחה רק לליאור.",
  product_once_per_user: "שיעור ניסיון אפשר לקבל פעם אחת בלבד, והמתאמנת כבר קיבלה.",
  reason_required: "צריך לכתוב בקצרה למה מתקנים, כדי שיישאר תיעוד.",
  username_taken: "שם המשתמש הזה כבר תפוס. אפשר להוסיף אות או ספרה.",
  bad_username: "שם משתמש: 3–30 אותיות באנגלית, ספרות, נקודה או מקף.",
  bad_name: "צריך שם מלא, לפחות 2 אותיות.",
  bad_phone: "מספר הטלפון לא נראה שלם.",
  not_username_account: "למשתמשת הזו אין סיסמה אצלנו. היא נכנסת עם גוגל.",
  function_unavailable: "יצירת משתמשות עם שם משתמש עוד לא הופעלה בשרת. אופיר יפעיל אותה כשהאפליקציה תעלה לאוויר.",
  balance_already_claimed: "היתרה הזו כבר שויכה למתאמנת.",
  bad_rows: "לא נמצאו שורות תקינות להעברה.",
  booking_not_found: "ההרשמה הזו כבר לא פעילה.",
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
  if (/Failed to send a request|FunctionsFetchError|FunctionsRelayError/i.test(text)) return "function_unavailable";
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
