import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { Field, useToast } from "../components/ui";

const HOLD = [15, 20, 30, 45, 60, 90, 120];
const OPEN = [0, 15, 30, 45, 60, 90, 120];

function minutesText(m: number): string {
  if (m === 0) return "בלי (התור ממשיך עד תחילת השיעור)";
  if (m === 60) return "שעה";
  if (m === 90) return "שעה וחצי";
  if (m === 120) return "שעתיים";
  if (m === 30) return "חצי שעה";
  if (m === 15) return "רבע שעה";
  return `${m} דקות`;
}

/** הגדרות רשימת ההמתנה: כמה זמן מקום שמור, ומתי עוברים להודעה לכולן */
export function WaitlistSettings() {
  const [hold, setHold] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ hold: number; open: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState("");
  const toast = useToast();

  useEffect(() => {
    api.getWaitlistTiming()
      .then((t) => { setHold(t.hold); setOpen(t.open); setSaved(t); })
      .catch((e) => toast(errorMessage(e)));
    api.getContactPhone().then((p) => { setPhone(p ?? ""); setSavedPhone(p ?? ""); }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hold === null || open === null || !saved) return null;
  const cleanPhone = phone.replace(/[\s-]/g, "");
  const phoneOk = cleanPhone === "" || /^\+?[0-9]{9,15}$/.test(cleanPhone);
  const dirty = hold !== saved.hold || open !== saved.open || cleanPhone !== savedPhone;

  async function save() {
    setBusy(true);
    try {
      await api.setWaitlistTiming(hold!, open!);
      if (cleanPhone !== savedPhone) {
        await api.setContactPhone(cleanPhone || null);
        setSavedPhone(cleanPhone);
      }
      setSaved({ hold: hold!, open: open! });
      toast("ההגדרות נשמרו. הן חלות על כל מקום שיתפנה מעכשיו.");
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="wl-settings">
      <div className="section-title"><h2 id="wl-settings">הגדרות</h2></div>
      <div className="card stack">
        <p style={{ margin: 0 }}>כשמתפנה מקום בשיעור מלא, מי שראשון בתור מקבל הודעה, והמקום נשמר לזמן קצוב. אם אין אישור, הוא עובר לבא בתור.</p>
        <Field label="רשימת המתנה: כמה זמן המקום נשמר">
          {({ id }) => (
            <select id={id} className="select" value={hold} onChange={(e) => setHold(Number(e.target.value))}>
              {HOLD.map((m) => <option key={m} value={m}>{minutesText(m)}</option>)}
            </select>
          )}
        </Field>
        <Field label="סמוך לשיעור, הודעה לכל הרשימה" hint="מהנקודה הזו לא שומרים מקום. כל הרשימה מקבלת הודעה, ומי שמאשר ראשון נכנס.">
          {({ id, describedBy }) => (
            <select id={id} className="select" value={open} aria-describedby={describedBy} onChange={(e) => setOpen(Number(e.target.value))}>
              {OPEN.map((m) => <option key={m} value={m}>{m === 0 ? minutesText(0) : `${minutesText(m)} לפני השיעור`}</option>)}
            </select>
          )}
        </Field>
        <Field label="טלפון לוואטסאפ על תשלומים" hint="מתאמנים שמזמינים כרטיסייה יוכלו לשלוח הודעה למספר הזה כדי לתאם תשלום. אפשר להשאיר ריק." error={phoneOk ? undefined : "מספר טלפון לא תקין"}>
          {({ id, describedBy }) => (
            <input id={id} className="input input--ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby={describedBy} aria-invalid={!phoneOk} />
          )}
        </Field>
        {dirty && (
          <button type="button" className="btn btn--primary btn--block" onClick={save} disabled={busy || !phoneOk}>
            {busy ? "בשמירה…" : "שמירת ההגדרות"}
          </button>
        )}
      </div>
    </section>
  );
}
