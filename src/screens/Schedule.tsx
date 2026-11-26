import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDay, formatDeadline, formatTime, missingText, placesLeftText } from "../lib/format";
import type { AttendMode, ScheduleItem } from "../lib/types";
import { Loading, Sheet, useToast } from "../components/ui";

const WEEKS_AHEAD = 4; // הרשמה עד חודש מראש

/** מפתח יום (YYYY-MM-DD) פלוס מספר ימים */
function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ההיסט של שעון ישראל מ-UTC ביום מסוים, למשל "+02:00" או "+03:00" בשעון קיץ */
function israelOffset(key: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${key}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  return name?.replace("GMT", "") || "+02:00";
}

/** יום ראשון 00:00 בשעון ישראל, בהיסט שבועות מהשבוע הנוכחי */
function weekStart(offset: number): Date {
  const today = dayKey(new Date().toISOString());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = ראשון
  const sunday = addDays(today, -weekday + offset * 7);
  return new Date(`${sunday}T00:00:00${israelOffset(sunday)}`);
}

type Pending = { item: ScheduleItem; action: "book"; mode: AttendMode } | { item: ScheduleItem; action: "cancel" };

export function Schedule({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [week, setWeek] = useState(0);
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const range = useMemo(() => {
    const from = weekStart(week);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    return { from: week === 0 ? new Date() : from, start: from, to };
  }, [week]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await api.getSchedule(range.from, range.to));
    } catch (e) {
      setLoadError(errorMessage(e));
      setItems([]);
    }
  }, [range]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const it of items ?? []) {
      const k = dayKey(it.starts_at);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return [...map.entries()];
  }, [items]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pending.action === "book") {
        const res = await api.bookClass(pending.item.session_id, pending.mode);
        toast(
          res.status === "waitlist"
            ? "ההרשמה נוספה לרשימת ההמתנה. אם יתפנה מקום, היא תעבור אוטומטית ותישלח הודעה."
            : `ההרשמה ל${pending.item.title} נקלטה. אפשר לבטל ללא חיוב עד ${formatDeadline(pending.item.cancel_deadline)}.`,
        );
      } else {
        const res = await api.cancelBooking(pending.item.my_booking_id!);
        toast(res.refunded ? "ההרשמה בוטלה, והכניסה חזרה לכרטיסייה." : "ההרשמה בוטלה. הכניסה לא חזרה כי מועד הביטול ללא חיוב עבר.");
      }
      setPending(null);
      await load();
      onChanged?.();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const weekLabel =
    week === 0 ? "השבוע" : week === 1 ? "שבוע הבא" : `בעוד ${week} שבועות`;

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>לוח שיעורים</h1>
        <p>אפשר להירשם עד חודש מראש.</p>
      </div>

      <nav className="week-nav" aria-label="מעבר בין שבועות">
        <button type="button" className="btn btn--ghost" onClick={() => setWeek((w) => w - 1)} disabled={week === 0} aria-label="השבוע הקודם">
          →
        </button>
        <p className="week-label" aria-live="polite">{weekLabel}</p>
        <button type="button" className="btn btn--ghost" onClick={() => setWeek((w) => w + 1)} disabled={week >= WEEKS_AHEAD} aria-label="השבוע הבא">
          ←
        </button>
      </nav>

      {loadError && (
        <div className="notice notice--error" role="alert">
          {loadError}{" "}
          <button type="button" className="btn btn--secondary" onClick={load}>ניסיון נוסף</button>
        </div>
      )}

      {items === null ? (
        <Loading label="טוען את השיעורים…" />
      ) : byDay.length === 0 && !loadError ? (
        <p className="empty">אין שיעורים פתוחים בשבוע הזה.</p>
      ) : (
        byDay.map(([k, list]) => (
          <section key={k} aria-labelledby={`day-${k}`}>
            <h2 className="day-title" id={`day-${k}`}>{formatDay(list[0].starts_at)}</h2>
            {list.map((it) => (
              <ClassCard
                key={it.session_id}
                item={it}
                onBook={(mode) => { setActionError(null); setPending({ item: it, action: "book", mode }); }}
                onCancel={() => { setActionError(null); setPending({ item: it, action: "cancel" }); }}
              />
            ))}
          </section>
        ))
      )}

      <Sheet
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={
          !pending ? "" : pending.action === "cancel"
            ? "ביטול הרשמה"
            : isFull(pending.item) && pending.mode === "studio" ? "הצטרפות לרשימת המתנה" : "אישור הרשמה"
        }
      >
        {pending && <ConfirmBody pending={pending} />}
        {actionError && <p className="notice notice--error" role="alert">{actionError}</p>}
        <div className="btn-row">
          <button
            type="button"
            className={`btn ${pending?.action === "cancel" ? "btn--danger" : "btn--primary"}`}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "רגע…" : pending?.action === "cancel" ? "ביטול ההרשמה" : "אישור"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPending(null)} disabled={busy}>
            חזרה
          </button>
        </div>
      </Sheet>
    </main>
  );
}

const isFull = (it: ScheduleItem) => it.booked_studio >= it.max_participants;
const deadlinePassed = (it: ScheduleItem) => new Date(it.cancel_deadline).getTime() < Date.now();

function ConfirmBody({ pending }: { pending: Pending }) {
  const it = pending.item;
  const when = `${formatDay(it.starts_at)}, ${formatTime(it.starts_at)}`;
  if (pending.action === "cancel") {
    const waitlist = it.my_status === "waitlist";
    return (
      <>
        <p><strong>{it.title}</strong><br />{when}</p>
        {waitlist ? (
          <p>היציאה מרשימת ההמתנה לא משפיעה על הכרטיסייה.</p>
        ) : deadlinePassed(it) ? (
          <p className="notice notice--warn">מועד הביטול ללא חיוב עבר, ולכן הכניסה לא תחזור לכרטיסייה.</p>
        ) : (
          <p className="notice notice--ok">הביטול בזמן, והכניסה תחזור לכרטיסייה.</p>
        )}
      </>
    );
  }
  const waitlist = pending.mode === "studio" && isFull(it);
  return (
    <>
      <p>
        <strong>{it.title}</strong>
        {pending.mode === "zoom" ? " · בזום" : " · בסטודיו"}
        <br />{when} · {it.duration_min} דקות
      </p>
      {waitlist ? (
        <p className="notice notice--info">
          השיעור מלא. כשיתפנה מקום ההרשמה תעבור אוטומטית, תנוכה כניסה אחת ותישלח הודעה.
        </p>
      ) : (
        <p className="notice notice--info">
          תנוכה כניסה אחת מהכרטיסייה.
          <br />
          <strong>ביטול ללא חיוב עד {formatDeadline(it.cancel_deadline)}.</strong>
        </p>
      )}
    </>
  );
}

function ClassCard({ item: it, onBook, onCancel }: { item: ScheduleItem; onBook: (m: AttendMode) => void; onCancel: () => void }) {
  const cancelled = it.status === "cancelled";
  const left = it.max_participants - it.booked_studio;
  const total = it.booked_studio + it.booked_zoom;
  const missing = it.min_participants - total;
  const mine = it.my_status;
  const titleId = `c-${it.session_id}`;

  return (
    <article className={`card class-card${cancelled ? " class-card--cancelled" : ""}`} aria-labelledby={titleId}>
      <div className="class-top">
        <span className="class-time">{formatTime(it.starts_at)}</span>
        {cancelled ? (
          <span className="badge badge--cancelled">השיעור בוטל</span>
        ) : mine === "booked" ? (
          <span className="badge badge--booked">{it.my_mode === "zoom" ? "ההרשמה שלך · זום" : "ההרשמה שלך"}</span>
        ) : mine === "waitlist" ? (
          <span className="badge badge--waitlist">ברשימת ההמתנה</span>
        ) : mine === "late_cancel" ? (
          <span className="badge badge--late">בוטל מאוחר</span>
        ) : null}
      </div>
      <h3 className="class-title" id={titleId}>{it.title}</h3>
      <p className="class-meta">
        {it.duration_min} דקות
        {!cancelled && <> · {placesLeftText(left)}</>}
        {!cancelled && it.zoom_enabled && <> · אפשר גם בזום</>}
      </p>

      {!cancelled && missing > 0 && !deadlinePassed(it) && <p className="deadline">{missingText(missing)}</p>}

      {!cancelled && (mine === "booked" || mine === "waitlist") && (
        <>
          {mine === "booked" && (
            <p className="deadline">
              {deadlinePassed(it)
                ? "מועד הביטול ללא חיוב עבר"
                : <>ביטול ללא חיוב עד <strong>{formatDeadline(it.cancel_deadline)}</strong></>}
            </p>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={onCancel}>
              {mine === "waitlist" ? "יציאה מרשימת ההמתנה" : "ביטול הרשמה"}
              <span className="visually-hidden"> ל{it.title}</span>
            </button>
          </div>
        </>
      )}

      {!cancelled && !mine && (
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={() => onBook("studio")}>
            {left > 0 ? "הרשמה" : "לרשימת ההמתנה"}
            <span className="visually-hidden"> ל{it.title} {formatTime(it.starts_at)}</span>
          </button>
          {it.zoom_enabled && (
            <button type="button" className="btn btn--secondary" onClick={() => onBook("zoom")}>
              הרשמה בזום
              <span className="visually-hidden"> ל{it.title} {formatTime(it.starts_at)}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
