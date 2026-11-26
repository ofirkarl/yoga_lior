import { useToast } from "../components/ui";

const APP_URL = "https://yoga-lior.vercel.app";

function message(kind: "new" | "reset", name: string, username: string, password: string): string {
  const first = name.trim().split(/\s+/)[0] || "";
  const opening = kind === "new"
    ? `שלום${first ? ` ${first}` : ""}, נפתח לך חשבון באפליקציה של יוגה עם ליאור.`
    : `שלום${first ? ` ${first}` : ""}, הסיסמה לאפליקציה של יוגה עם ליאור אופסה.`;
  return [
    opening,
    `כניסה: ${APP_URL}`,
    `שם משתמש: ${username}`,
    `סיסמה זמנית: ${password}`,
    "בכניסה הראשונה בוחרים סיסמה חדשה.",
  ].join("\n");
}

const intl = (phone: string) => phone.replace(/[\s-]/g, "").replace(/^\+/, "").replace(/^0/, "972");

/** שליחת פרטי הכניסה למתאמן: וואטסאפ, SMS, שיתוף או העתקה */
export function ShareCredentials({ kind, name, username, password, phone }: {
  kind: "new" | "reset"; name: string; username: string; password: string; phone?: string | null;
}) {
  const toast = useToast();
  const text = message(kind, name, username, password);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const wa = phone ? `https://wa.me/${intl(phone)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  const sms = `sms:${phone ? phone.replace(/[\s-]/g, "") : ""}?&body=${encodeURIComponent(text)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("ההודעה הועתקה.");
    } catch {
      toast("לא הצלחתי להעתיק. אפשר להעתיק ידנית את הפרטים מלמעלה.");
    }
  }

  return (
    <div className="share-creds">
      <p className="share-creds-label">שליחת הפרטים</p>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <a className="btn btn--primary" href={wa} target="_blank" rel="noopener noreferrer">וואטסאפ</a>
        <a className="btn btn--secondary" href={sms}>SMS</a>
        {canShare
          ? <button type="button" className="btn btn--ghost" onClick={() => navigator.share({ text }).catch(() => {})}>שיתוף</button>
          : <button type="button" className="btn btn--ghost" onClick={copy}>העתקה</button>}
      </div>
      <p className="quiet" style={{ margin: ".5rem 0 0" }}>
        {phone ? `ההודעה תיפתח מוכנה לשליחה ל־${phone}.` : "אין מספר טלפון, אז בוואטסאפ צריך לבחור את איש הקשר."}
      </p>
    </div>
  );
}
