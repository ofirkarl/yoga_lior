import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDay, formatDeadline, formatTime } from "../lib/format";
import type { MyBooking } from "../lib/types";
import { Loading, Sheet, useToast } from "../components/ui";
import { OfferBox } from "../components/OfferBox";

export function MyClasses({ refreshKey, onChanged, balance }: { refreshKey: number; onChanged?: () => void; balance?: ReactNode }) {
  const toast = useToast();
  const [rows, setRows] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<MyBooking | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.getMyUpcomingBookings();
      // הצעות פעילות קודם, כדי שלא יפספסו אותן
      const hasOffer = (b: MyBooking) => b.status === "waitlist" && !!b.offer_expires_at && new Date(b.offer_expires_at).getTime() > Date.now();
      setRows([...list.filter(hasOffer), ...list.filter((b) => !hasOffer(b))]);
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function openZoom(b: MyBooking) {
    // פותחים חלון מיד, בתוך הלחיצה, כדי שדפדפני טלפון לא יחסמו אותו
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    try {
      const link = await api.getZoomLink(b.session.id);
      if (link && win) win.location.href = link;
      else {
        win?.close();
        toast("הקישור לזום עוד לא פורסם. הוא יופיע כאן לפני השיעור.");
      }
    } catch (e) {
      win?.close();
      toast(errorMessage(e));
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      const res = await api.cancelBooking(cancelling.id);
      toast(cancelling.status === "waitlist" ? "יצאת מרשימת ההמתנה." : res.refunded ? "ההרשמה בוטלה, והכניסה חזרה לכרטיסייה." : "ההרשמה בוטלה.");
      setCancelling(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // קיבוץ לפי יום, בסדר שהשרת החזיר (הצעות פעילות קודם)
  const groups: [string, MyBooking[]][] = [];
  for (const b of rows ?? []) {
    const k = dayKey(b.session.starts_at);
    const g = groups.find(([key]) => key === k);
    if (g) g[1].push(b); else groups.push([k, [b]]);
  }

  const late = cancelling && cancelling.status === "booked" && new Date(cancelling.session.cancel_deadline).getTime() < Date.now();

  return (
    <main id="main" className="page">
      <div className="page-header page-header--row">
        <h1>השיעורים שלי</h1>
        {balance}
      </div>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="empty">אין כרגע שיעורים קרובים. אפשר להירשם בלוח השיעורים.</p>
      ) : (
        groups.map(([k, list]) => (
          <section key={k} className="day" aria-labelledby={`my-day-${k}`}>
            <h2 className="day-heading" id={`my-day-${k}`}>{formatDay(list[0].session.starts_at)}</h2>
            <ol className="timeline">
              {list.map((b) => {
                const cancelled = b.session.status === "cancelled";
                const offer = b.status === "waitlist" && !!b.offer_expires_at && new Date(b.offer_expires_at).getTime() > Date.now();
                const state = cancelled ? "cancelled" : offer ? "offer" : b.status === "waitlist" ? "waitlist" : "booked";
                const end = formatTime(new Date(new Date(b.session.starts_at).getTime() + b.session.duration_min * 60_000).toISOString());
                return (
                  <li key={b.id}>
                    <article className={`slot slot--${state}`} aria-labelledby={`b-${b.id}`}>
                      <div className="slot-time">
                        <span className="slot-start">{formatTime(b.session.starts_at)}</span>
                        <span className="slot-end"><span className="visually-hidden">עד </span>{end}</span>
                      </div>
                      <div className="slot-rail" aria-hidden="true"><span className="slot-node" /></div>
                      <div className="slot-body">
                        <div className="slot-head">
                          <h3 className="slot-title" id={`b-${b.id}`}>{b.session.title}</h3>
                          {cancelled ? <span className="tag tag--muted">השיעור בוטל</span>
                            : offer ? <span className="tag tag--attention">התפנה מקום</span>
                            : b.status === "waitlist" ? <span className="tag tag--quiet">ברשימת ההמתנה</span>
                            : <span className="tag tag--mine">{b.mode === "zoom" ? "בזום" : "בסטודיו"}</span>}
                        </div>

                        {!cancelled && offer && (
                          <OfferBox
                            bookingId={b.id}
                            title={b.session.title}
                            expiresAt={b.offer_expires_at!}
                            open={b.offer_open}
                            cancelDeadline={b.session.cancel_deadline}
                            onDone={() => { load(); onChanged?.(); }}
                          />
                        )}

                        {!cancelled && !offer && (
                          <div className="slot-actions">
                            {b.mode === "zoom" && b.status === "booked" && (
                              <button type="button" className="btn btn--sm btn--primary" onClick={() => openZoom(b)}>
                                כניסה לזום
                              </button>
                            )}
                            {b.status === "booked" && (
                              <span className="slot-note">
                                {new Date(b.session.cancel_deadline).getTime() < Date.now()
                                  ? "מועד הביטול ללא חיוב עבר"
                                  : <>ביטול ללא חיוב עד {formatDeadline(b.session.cancel_deadline)}</>}
                              </span>
                            )}
                            <button type="button" className="text-btn" onClick={() => setCancelling(b)}>
                              {b.status === "waitlist" ? "יציאה מהרשימה" : "ביטול"}
                              <span className="visually-hidden"> של {b.session.title}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}

      <Sheet open={!!cancelling} onClose={() => !busy && setCancelling(null)} title={cancelling?.status === "waitlist" ? "יציאה מרשימת ההמתנה" : "ביטול הרשמה"}>
        {cancelling && (
          <>
            <div className="confirm-head">
              <p className="confirm-title">{cancelling.session.title}</p>
              <p className="confirm-when">{formatDay(cancelling.session.starts_at)}, {formatTime(cancelling.session.starts_at)}</p>
            </div>
            <p className="quiet">
              {cancelling.status === "waitlist"
                ? "היציאה מהרשימה לא משפיעה על הכרטיסייה."
                : late ? "מועד הביטול ללא חיוב עבר, לכן הכניסה לא תחזור לכרטיסייה." : "הכניסה תחזור לכרטיסייה."}
            </p>
          </>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn--danger" onClick={confirmCancel} disabled={busy}>
            {busy ? "רגע…" : cancelling?.status === "waitlist" ? "יציאה מהרשימה" : "ביטול ההרשמה"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)} disabled={busy}>חזרה</button>
        </div>
      </Sheet>
    </main>
  );
}
