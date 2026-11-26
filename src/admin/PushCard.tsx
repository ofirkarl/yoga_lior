import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { disablePush, enablePush, getPushState, type PushState } from "../lib/push";
import { useToast } from "../components/ui";
import { InstallHelpButton } from "../components/InstallGuide";

const TEXT = {
  admin: {
    on: "המכשיר הזה מקבל התראה על כל הרשמה חדשה שממתינה לאישור.",
    off: "קבלי הודעה לטלפון ברגע שמישהי חדשה נרשמת וממתינה לאישור.",
  },
  member: {
    on: "המכשיר הזה יקבל הודעה כשמתפנה לך מקום בשיעור שאת ברשימת ההמתנה שלו.",
    off: "קבלי הודעה לטלפון כשמתפנה לך מקום בשיעור מלא, כדי לא לפספס את התור.",
  },
};

/** כרטיס הפעלת התראות לטלפון. בחדר הבקרה (מנהלת) ובכרטיסייה שלי (מתאמנת). */
export function PushCard({ audience = "admin" }: { audience?: "admin" | "member" }) {
  const text = TEXT[audience];
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "on") {
        const r = await api.sendTestPush();
        toast(r.sent > 0 ? "ההתראות הופעלו. שלחתי התראת בדיקה לטלפון." : "ההתראות הופעלו.");
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api.sendTestPush();
      toast(r.sent > 0 ? "נשלחה התראת בדיקה." : "לא נמצא מכשיר פעיל. נסי לכבות ולהפעיל מחדש.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      setState(await disablePush());
      toast("ההתראות כובו במכשיר הזה.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (state === null || state === "unsupported") return null;

  return (
    <section aria-labelledby="push">
      <div className="section-title"><h2 id="push">התראות לטלפון</h2></div>
      <div className="card stack">
        {state === "on" && (
          <>
            <p style={{ margin: 0 }}>{text.on}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn--secondary" onClick={test} disabled={busy}>שליחת התראת בדיקה</button>
              <button type="button" className="btn btn--ghost" onClick={turnOff} disabled={busy}>כיבוי במכשיר הזה</button>
            </div>
          </>
        )}
        {state === "off" && (
          <>
            <p style={{ margin: 0 }}>{text.off}</p>
            <button type="button" className="btn btn--primary btn--block" onClick={turnOn} disabled={busy}>
              {busy ? "רגע…" : "הפעלת התראות"}
            </button>
          </>
        )}
        {state === "needs-install" && (
          <>
            <p style={{ margin: 0 }}>באייפון, התראות עובדות רק כשהאפליקציה פתוחה מהאייקון במסך הבית.</p>
            <InstallHelpButton label="איך מוסיפים למסך הבית" />
          </>
        )}
        {state === "denied" && (
          <p className="notice notice--warn" style={{ margin: 0 }}>
            ההתראות חסומות בהגדרות של הטלפון. כדי לאפשר אותן: הגדרות ← התראות ← יוגה עם ליאור, ואז לרענן את הדף.
          </p>
        )}
      </div>
    </section>
  );
}
