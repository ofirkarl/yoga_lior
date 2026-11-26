import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { getPushState } from "../lib/push";

type Mark = "done" | "todo" | "wait";
interface Row { name: string; detail: string; mark: Mark }

/** מצב המערכת: מה כבר פועל, מה עוד צריך להגדיר, ומה ממתין לגורם חיצוני. הכול נקרא מהנתונים בפועל. */
export function SystemStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [backup, push, phone, balances] = await Promise.all([
        api.backupStatus().catch(() => null),
        getPushState().catch(() => "unsupported" as const),
        api.getContactPhone().catch(() => null),
        api.listBalances().catch(() => null),
      ]);
      if (!alive) return;
      const claimed = balances?.filter((b) => b.claimed_by).length ?? 0;
      const stale = backup?.last_at ? Date.now() - new Date(backup.last_at).getTime() > 9 * 86_400_000 : false;
      setRows([
        {
          name: "גיבוי שבועי לדרייב",
          detail: !backup?.last_at ? "עוד לא הוגדר. ההגדרה בכרטיס שמתחת."
            : stale ? `הגיבוי האחרון היה ${timeAgo(backup.last_at)}. כדאי לבדוק את הסקריפט.`
            : `פועל. הגיבוי האחרון נשמר ${timeAgo(backup.last_at)}.`,
          mark: !backup?.last_at ? "todo" : stale ? "wait" : "done",
        },
        {
          name: "התראות במכשיר הזה",
          detail: push === "on" ? "פועלות." : push === "needs-install" ? "באייפון צריך קודם להוסיף את האפליקציה למסך הבית."
            : push === "denied" ? "חסומות בהגדרות הטלפון." : push === "unsupported" ? "הדפדפן הזה לא תומך בהתראות." : "כבויות. ההפעלה בכרטיס ההתראות למעלה.",
          mark: push === "on" ? "done" : "todo",
        },
        {
          name: "וואטסאפ לתיאום תשלומים",
          detail: phone ? `מוגדר: ${phone}.` : "לא הוגדר מספר. מזינים אותו בלשונית שיעורים, תחת הגדרות.",
          mark: phone ? "done" : "todo",
        },
        {
          name: "יתרות מ-Arbox",
          detail: balances === null ? "לא ניתן לקרוא כרגע."
            : balances.length === 0 ? "עוד לא יובאו. הייבוא בלשונית מתאמנים."
            : claimed === balances.length ? `כל ${balances.length} היתרות שויכו לחשבונות.`
            : `${claimed} מתוך ${balances.length} יתרות שויכו. השאר ישויכו כשבעליהן ייכנסו לאפליקציה.`,
          mark: balances && balances.length > 0 ? (claimed === balances.length ? "done" : "wait") : "todo",
        },
        {
          name: "תשלום באשראי (Grow)",
          detail: "ממתין לחיבור. עד אז הזמנות מאושרות ידנית, והכרטיסייה נפתחת באישור.",
          mark: "wait",
        },
        {
          name: "אבטחה ופרטיות",
          detail: "הנתונים נשמרים בשרתים באירופה (פרנקפורט). כל משתמש רואה רק את המידע שלו, והצהרות הבריאות גלויות רק למנהלת.",
          mark: "done",
        },
      ]);
    })();
    return () => { alive = false; };
  }, []);

  if (!rows) return null;
  const label: Record<Mark, string> = { done: "פועל", todo: "להגדרה", wait: "ממתין" };

  return (
    <section aria-labelledby="sys-status">
      <div className="section-title"><h2 id="sys-status">מצב המערכת</h2></div>
      <ul className="card status-list">
        {rows.map((r) => (
          <li key={r.name}>
            <span className={`status-mark${r.mark === "done" ? " is-done" : r.mark === "wait" ? " is-wait" : ""}`} aria-hidden="true" />
            <div>
              <p className="status-name">{r.name}<span className="visually-hidden">: {label[r.mark]}</span></p>
              <p className="status-detail">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
