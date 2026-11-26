import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDay, formatDeadline, formatTime } from "../lib/format";
import type { MyBooking } from "../lib/types";
import { Loading, Sheet, useToast } from "../components/ui";
import { OfferBox } from "../components/OfferBox";

export function MyClasses({ refreshKey }: { refreshKey: number }) {
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
      toast(res.refunded || cancelling.status === "waitlist"
        ? "ההרשמה בוטלה, והכניסה חזרה לכרטיסייה."
        : "ההרשמה בוטלה. הכניסה לא חזרה כי מועד הביטול ללא חיוב עבר.");
      setCancelling(null);
      await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const late = cancelling && cancelling.status === "booked" && new Date(cancelling.session.cancel_deadline).getTime() < Date.now();

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>השיעורים שלי</h1>
        <p>השיעורים הקרובים שנרשמת אליהם.</p>
      </div>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="empty">אין כרגע שיעורים קרובים. אפשר להירשם בלוח השיעורים.</p>
      ) : (
        rows.map((b) => {
          const cancelled = b.session.status === "cancelled";
          const offer = b.status === "waitlist" && b.offer_expires_at && new Date(b.offer_expires_at).getTime() > Date.now();
          return (
            <article key={b.id} className="card class-card" aria-labelledby={`b-${b.id}`}>
              <div className="class-top">
                <span className="class-time">{formatTime(b.session.starts_at)}</span>
                {cancelled ? (
                  <span className="badge badge--cancelled">השיעור בוטל</span>
                ) : offer ? (
                  <span className="badge badge--offer">התפנה מקום</span>
                ) : b.status === "waitlist" ? (
                  <span className="badge badge--waitlist">ברשימת ההמתנה</span>
                ) : (
                  <span className="badge badge--booked">{b.mode === "zoom" ? "בזום" : "בסטודיו"}</span>
                )}
              </div>
              <h2 className="class-title" id={`b-${b.id}`}>{b.session.title}</h2>
              <p className="class-meta">{formatDay(b.session.starts_at)}</p>
              {!cancelled && b.status === "booked" && (
                <p className="deadline">
                  {new Date(b.session.cancel_deadline).getTime() < Date.now()
                    ? "מועד הביטול ללא חיוב עבר"
                    : <>ביטול ללא חיוב עד <strong>{formatDeadline(b.session.cancel_deadline)}</strong></>}
                </p>
              )}
              {!cancelled && offer && (
                <OfferBox
                  bookingId={b.id}
                  title={b.session.title}
                  expiresAt={b.offer_expires_at!}
                  open={b.offer_open}
                  cancelDeadline={b.session.cancel_deadline}
                  onDone={load}
                />
              )}
              {!cancelled && !offer && (
                <div className="btn-row">
                  {b.mode === "zoom" && b.status === "booked" && (
                    <button type="button" className="btn btn--primary" onClick={() => openZoom(b)}>
                      כניסה לשיעור בזום
                    </button>
                  )}
                  <button type="button" className="btn btn--secondary" onClick={() => setCancelling(b)}>
                    {b.status === "waitlist" ? "יציאה מרשימת ההמתנה" : "ביטול הרשמה"}
                    <span className="visually-hidden"> ל{b.session.title}</span>
                  </button>
                </div>
              )}
            </article>
          );
        })
      )}

      <Sheet open={!!cancelling} onClose={() => !busy && setCancelling(null)} title="ביטול הרשמה">
        {cancelling && (
          <>
            <p><strong>{cancelling.session.title}</strong><br />{formatDay(cancelling.session.starts_at)}, {formatTime(cancelling.session.starts_at)}</p>
            {cancelling.status === "waitlist" ? (
              <p>היציאה מרשימת ההמתנה לא משפיעה על הכרטיסייה.</p>
            ) : late ? (
              <p className="notice notice--warn">מועד הביטול ללא חיוב עבר, ולכן הכניסה לא תחזור לכרטיסייה.</p>
            ) : (
              <p className="notice notice--ok">הביטול בזמן, והכניסה תחזור לכרטיסייה.</p>
            )}
          </>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn--danger" onClick={confirmCancel} disabled={busy}>
            {busy ? "רגע…" : "ביטול ההרשמה"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)} disabled={busy}>חזרה</button>
        </div>
      </Sheet>
    </main>
  );
}
