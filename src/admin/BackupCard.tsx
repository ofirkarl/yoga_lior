import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { timeAgo } from "../lib/format";
import { Sheet, useAsk, useToast } from "../components/ui";
import { backupScript } from "./backupScript";

/** כרטיס בחדר הבקרה: מצב הגיבוי השבועי, והגדרה שלו בפעם הראשונה */
export function BackupCard() {
  const [status, setStatus] = useState<{ last_at: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ask = useAsk();

  const load = useCallback(() => {
    api.backupStatus().then(setStatus).catch(() => setStatus({ last_at: null }));
  }, []);
  useEffect(load, [load]);

  async function openSetup() {
    setOpen(true);
    if (token) return;
    try {
      setToken(await api.getBackupToken());
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(backupScript(token));
      toast("הקוד הועתק.");
    } catch {
      toast("לא הצלחתי להעתיק. אפשר לסמן את הקוד בתיבה ולהעתיק ידנית.");
    }
  }

  async function rotate() {
    const ok = await ask({
      title: "החלפת מפתח הגיבוי",
      message: "הסקריפט הקיים יפסיק לגבות. אחרי ההחלפה צריך להדביק בו את הקוד החדש. כדאי לעשות את זה אם הקוד הגיע למישהו אחר.",
      confirm: "החלפה",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setToken(await api.rotateBackupToken());
      toast("המפתח הוחלף. עכשיו צריך להעתיק את הקוד החדש לסקריפט.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const last = status.last_at;
  const stale = last !== null && Date.now() - new Date(last).getTime() > 9 * 86_400_000;

  return (
    <section aria-labelledby="backup">
      <div className="section-title"><h2 id="backup">גיבוי שבועי לדרייב</h2></div>
      <div className="card stack">
        {last === null ? (
          <p style={{ margin: 0 }}>עוד לא הוגדר. הגדרה של כמה דקות, פעם אחת, ומאז כל הנתונים נשמרים אוטומטית בדרייב שלך כל שבוע.</p>
        ) : stale ? (
          <p className="notice notice--warn" style={{ margin: 0 }}>הגיבוי האחרון היה {timeAgo(last)}. כנראה שהסקריפט הפסיק לרוץ. כדאי להגדיר אותו מחדש.</p>
        ) : (
          <p style={{ margin: 0 }}>הגיבוי האחרון נשמר בדרייב {timeAgo(last)}.</p>
        )}
        <button type="button" className={last === null || stale ? "btn btn--primary btn--block" : "btn btn--secondary btn--block"} onClick={openSetup}>
          {last === null ? "הגדרת הגיבוי" : "הוראות והקוד"}
        </button>
      </div>

      <Sheet open={open} onClose={() => { setOpen(false); load(); }} title="הגדרת גיבוי שבועי">
        <div className="stack">
          <p style={{ margin: 0 }}>עדיף לעשות את זה במחשב. הגיבוי רץ בחשבון הגוגל שלך ונשמר בדרייב שלך, כך שהוא לא תלוי באפליקציה.</p>
          <ol className="install-steps">
            <li>לפתוח את <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com</a> עם חשבון הגוגל שלך. ייפתח פרויקט חדש.</li>
            <li>למחוק את מה שכתוב שם ולהדביק את הקוד (כפתור ההעתקה למטה).</li>
            <li>לשמור (Ctrl+S). למעלה, ליד "הפעלה", לבחור את הפונקציה <b dir="ltr">setup</b> וללחוץ <b>הפעלה</b>.</li>
            <li>גוגל תבקש אישור, ותזהיר שהאפליקציה לא מאומתת, כי זה סקריפט שלך. ללחוץ "מתקדם", ואז "מעבר אל…", ואז "אישור".</li>
            <li>זהו. בדרייב נוצרה התיקייה "גיבויים · יוגה עם ליאור" עם הגיבוי הראשון. מעכשיו הגיבוי ירוץ כל מוצאי שבת.</li>
          </ol>

          {token ? (
            <>
              <textarea
                readOnly
                dir="ltr"
                aria-label="קוד הגיבוי להדבקה ב-Apps Script"
                value={backupScript(token)}
                onFocus={(e) => e.currentTarget.select()}
                className="input"
                style={{ height: 160, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.4, whiteSpace: "pre" }}
              />
              <button type="button" className="btn btn--primary btn--block" onClick={copy}>העתקת הקוד</button>
              <p className="hint" style={{ margin: 0, color: "var(--muted)" }}>
                הקוד כולל מפתח סודי שמאפשר להוריד את כל נתוני הסטודיו. לא לשלוח אותו לאף אחד.
              </p>
              <button type="button" className="btn btn--ghost btn--block" onClick={rotate} disabled={busy}>החלפת המפתח</button>
            </>
          ) : (
            <p style={{ margin: 0 }}>טוען את הקוד…</p>
          )}
        </div>
      </Sheet>
    </section>
  );
}
