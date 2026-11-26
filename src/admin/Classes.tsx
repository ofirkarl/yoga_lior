import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDay, formatDeadline, formatTime } from "../lib/format";
import type { AdminSession } from "../lib/types";
import { Field, Loading, Sheet, useAsk, useToast } from "../components/ui";

const ACTIVE = ["booked", "attended", "no_show"];
const STATUS_LABEL: Record<string, string> = {
  booked: "רשומה", attended: "הגיעה", no_show: "לא הגיעה", waitlist: "בהמתנה", late_cancel: "ביטול מאוחר",
};

export function Classes() {
  const toast = useToast();
  const ask = useAsk();
  const [sessions, setSessions] = useState<AdminSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AdminSession | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const from = new Date(Date.now() - 2 * 86_400_000);
      const to = new Date(Date.now() + 14 * 86_400_000);
      setSessions(await api.getAdminSessions(from, to));
    } catch (e) {
      setError(errorMessage(e));
      setSessions([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, AdminSession[]>();
    for (const s of sessions ?? []) map.set(dayKey(s.starts_at), [...(map.get(dayKey(s.starts_at)) ?? []), s]);
    return [...map.entries()];
  }, [sessions]);

  async function generate() {
    const from = dayKey(new Date().toISOString());
    const to = dayKey(new Date(Date.now() + 35 * 86_400_000).toISOString());
    try {
      const n = await api.generateSessions(from, to);
      toast(n === 0 ? "כל השיעורים לחודש הקרוב כבר פתוחים." : `נפתחו ${n} שיעורים חדשים.`);
      await load();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      const n = await api.cancelSession(cancelling.id, reason.trim());
      toast(n === 0 ? "השיעור בוטל." : `השיעור בוטל, ו-${n} נרשמות קיבלו את הכניסה בחזרה.`);
      setCancelling(null);
      setReason("");
      await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function attendance(bookingId: string, attended: boolean) {
    try {
      await api.markAttendance(bookingId, attended);
      await load();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  async function removeBooking(bookingId: string, name: string) {
    if (!(await ask({ title: `הסרת ${name} מהשיעור`, message: "הכניסה תחזור לכרטיסייה שלה.", confirm: "הסרה", danger: true }))) return;
    try {
      await api.cancelBooking(bookingId);
      toast("ההרשמה בוטלה והכניסה הוחזרה.");
      await load();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>שיעורים</h1>
        <p>יומיים אחורה ושבועיים קדימה. שיעורים חדשים נפתחים אוטומטית כל לילה לחודש קדימה.</p>
      </div>
      <button type="button" className="btn btn--secondary btn--block" onClick={generate}>פתיחת שיעורים לחודש הקרוב עכשיו</button>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {sessions === null ? <Loading /> : byDay.length === 0 ? (
        <p className="empty">אין שיעורים בטווח הזה.</p>
      ) : byDay.map(([k, list]) => (
        <section key={k} aria-labelledby={`d-${k}`}>
          <h2 className="day-title" id={`d-${k}`}>{formatDay(list[0].starts_at)}</h2>
          {list.map((s) => {
            const live = s.bookings.filter((b) => ACTIVE.includes(b.status));
            const wait = s.bookings.filter((b) => b.status === "waitlist").sort((a, b) => a.created_at.localeCompare(b.created_at));
            const late = s.bookings.filter((b) => b.status === "late_cancel");
            const past = new Date(s.starts_at).getTime() < Date.now();
            const cancelled = s.status === "cancelled";
            const low = !cancelled && !past && live.length < s.min_participants;
            return (
              <article key={s.id} className={`card${cancelled ? " class-card--cancelled" : ""}`} aria-labelledby={`s-${s.id}`}>
                <div className="class-top">
                  <span className="class-time">{formatTime(s.starts_at)}</span>
                  <span className={`badge ${cancelled ? "badge--cancelled" : low ? "badge--waitlist" : "badge--booked"}`}>
                    {cancelled ? "בוטל" : `${live.length}/${s.max_participants}`}
                  </span>
                </div>
                <h3 id={`s-${s.id}`} className="class-title">{s.title}</h3>
                {cancelled && s.cancel_reason && <p className="row-sub">סיבה: {s.cancel_reason}</p>}
                {low && <p className="deadline">חסרות {s.min_participants - live.length} למינימום · החלטה עד {formatDeadline(s.cancel_deadline)}</p>}

                {!cancelled && (live.length > 0 || wait.length > 0 || late.length > 0) && (
                  <ul className="roster" aria-label={`נרשמות ל${s.title}`}>
                    {[...live, ...late, ...wait].map((b) => (
                      <li key={b.id}>
                        <span>
                          <strong>{b.profile.full_name || "ללא שם"}</strong>
                          <span className="row-sub"> · {b.mode === "zoom" ? "זום" : "סטודיו"} · {STATUS_LABEL[b.status]}</span>
                        </span>
                        <span className="btn-row" style={{ marginTop: 0 }}>
                          {past && ACTIVE.includes(b.status) && (
                            <>
                              <button type="button" className="btn btn--ghost" aria-pressed={b.status === "attended"} onClick={() => attendance(b.id, true)}>הגיעה</button>
                              <button type="button" className="btn btn--ghost" aria-pressed={b.status === "no_show"} onClick={() => attendance(b.id, false)}>לא הגיעה</button>
                            </>
                          )}
                          {!past && (b.status === "booked" || b.status === "waitlist") && (
                            <button type="button" className="btn btn--ghost" onClick={() => removeBooking(b.id, b.profile.full_name)}>
                              הסרה<span className="visually-hidden"> של {b.profile.full_name}</span>
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!cancelled && live.length === 0 && wait.length === 0 && <p className="row-sub">אין נרשמות עדיין.</p>}

                {!cancelled && !past && (
                  <div className="btn-row">
                    <button type="button" className="btn btn--danger" onClick={() => { setReason(low ? "אין מספיק נרשמות" : ""); setCancelling(s); }}>
                      ביטול השיעור<span className="visually-hidden"> {s.title} {formatTime(s.starts_at)}</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}

      <Sheet open={!!cancelling} onClose={() => !busy && setCancelling(null)} title="ביטול שיעור">
        {cancelling && (
          <div className="stack">
            <p><strong>{cancelling.title}</strong><br />{formatDay(cancelling.starts_at)}, {formatTime(cancelling.starts_at)}</p>
            <p className="notice notice--info">
              כל הנרשמות יקבלו את הכניסה בחזרה לכרטיסייה, והשיעור יסומן אצלן כמבוטל.
            </p>
            <Field label="סיבה (תוצג למתאמנות)">
              {({ id }) => <input id={id} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <div className="btn-row">
              <button type="button" className="btn btn--danger" onClick={confirmCancel} disabled={busy}>{busy ? "רגע…" : "ביטול השיעור"}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)} disabled={busy}>חזרה</button>
            </div>
          </div>
        )}
      </Sheet>
    </main>
  );
}
