import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDay, formatDeadline, formatTime, missingText } from "../lib/format";
import type { AttendMode, ScheduleItem } from "../lib/types";
import { Loading, Sheet, useToast } from "../components/ui";
import { OfferBox } from "../components/OfferBox";

const DAYS_AHEAD = 30; // אפשר להירשם עד חודש מראש

/** מפתח יום (YYYY-MM-DD) פלוס מספר ימים */
function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const stripWeekday = new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: "UTC" });
const stripLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

type Pending = { item: ScheduleItem; action: "book"; mode: AttendMode } | { item: ScheduleItem; action: "cancel" };

export function Schedule({ onChanged, balance }: { onChanged?: () => void; balance?: ReactNode }) {
  const toast = useToast();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => dayKey(new Date().toISOString()), []);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(today, i)), [today]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const to = new Date(Date.now() + (DAYS_AHEAD + 1) * 86_400_000);
      setItems(await api.getSchedule(new Date(), to));
    } catch (e) {
      setLoadError(errorMessage(e));
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const it of items ?? []) {
      const k = dayKey(it.starts_at);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return map;
  }, [items]);

  // היום שבראש המסך מסומן בפס הימים
  useEffect(() => {
    if (!items?.length) return;
    const heads = [...document.querySelectorAll<HTMLElement>("[data-day]")];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveDay((top.target as HTMLElement).dataset.day!);
      },
      { rootMargin: "-90px 0px -60% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [items]);

  // הכפתור של היום הפעיל נשאר גלוי בפס
  useEffect(() => {
    if (!activeDay) return;
    stripRef.current?.querySelector<HTMLElement>(`[data-strip="${activeDay}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeDay]);

  function jumpTo(k: string) {
    const el = document.getElementById(`day-${k}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: reduce ? "auto" : "smooth" });
    setActiveDay(k);
    el.focus({ preventScroll: true });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pending.action === "book") {
        const res = await api.bookClass(pending.item.session_id, pending.mode, autoEnroll);
        toast(
          res.status === "waitlist"
            ? autoEnroll
              ? "ההרשמה לרשימת ההמתנה נקלטה. כשיתפנה מקום, היא תושלם אוטומטית."
              : "ההרשמה לרשימת ההמתנה נקלטה. כשיתפנה מקום תגיע הודעה."
            : `ההרשמה ל${pending.item.title} נקלטה.`,
        );
      } else {
        const res = await api.cancelBooking(pending.item.my_booking_id!);
        toast(res.refunded ? "ההרשמה בוטלה, והכניסה חזרה לכרטיסייה." : "ההרשמה בוטלה.");
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

  const visibleDays = days.filter((k) => byDay.has(k));
  const rel = (k: string) => (k === today ? "היום" : k === addDays(today, 1) ? "מחר" : null);
  const current = activeDay ?? visibleDays[0] ?? null;

  return (
    <main id="main" className="page page--schedule">
      <div className="page-header page-header--row">
        <h1>לוח שיעורים</h1>
        {balance}
      </div>

      <nav className="day-strip" aria-label="מעבר ליום">
        <div className="day-strip-scroll" ref={stripRef}>
          {days.map((k) => {
            const has = byDay.has(k);
            const d = new Date(`${k}T12:00:00Z`);
            const isMineDay = byDay.get(k)?.some((it) => it.my_status === "booked" || it.my_status === "waitlist");
            return (
              <button
                key={k}
                type="button"
                data-strip={k}
                className={`day-chip${k === current ? " is-current" : ""}${k === today ? " is-today" : ""}`}
                onClick={() => jumpTo(k)}
                disabled={!has}
                aria-current={k === current ? "date" : undefined}
                aria-label={`${stripLabel.format(d)}${has ? "" : ", אין שיעורים"}${isMineDay ? ", יש לך הרשמה" : ""}`}
              >
                <span className="day-chip-wd" aria-hidden="true">{stripWeekday.format(d)}</span>
                <span className="day-chip-n" aria-hidden="true">{d.getUTCDate()}</span>
                <span className={`day-chip-dot${isMineDay ? " is-mine" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </nav>

      {loadError && (
        <div className="notice notice--error" role="alert">
          {loadError}{" "}
          <button type="button" className="btn btn--secondary" onClick={load}>ניסיון נוסף</button>
        </div>
      )}

      {items === null ? (
        <Loading label="טוען את השיעורים…" />
      ) : visibleDays.length === 0 && !loadError ? (
        <p className="empty">אין שיעורים פתוחים בחודש הקרוב.</p>
      ) : (
        visibleDays.map((k) => {
          const list = byDay.get(k)!;
          return (
            <section key={k} className="day" aria-labelledby={`day-${k}`}>
              <h2 className="day-heading" id={`day-${k}`} data-day={k} tabIndex={-1}>
                {rel(k) ? <>{rel(k)}<span className="day-heading-date">{formatDay(list[0].starts_at)}</span></> : formatDay(list[0].starts_at)}
              </h2>
              <ol className="timeline">
                {list.map((it) => (
                  <li key={it.session_id}>
                    <ClassSlot
                      item={it}
                      onBook={(mode) => { setActionError(null); setAutoEnroll(false); setPending({ item: it, action: "book", mode }); }}
                      onCancel={() => { setActionError(null); setPending({ item: it, action: "cancel" }); }}
                      onChanged={() => { load(); onChanged?.(); }}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })
      )}

      <Sheet
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={
          !pending ? "" : pending.action === "cancel"
            ? pending.item.my_status === "waitlist" ? "יציאה מרשימת ההמתנה" : "ביטול הרשמה"
            : isFull(pending.item) && pending.mode === "studio" ? "הצטרפות לרשימת ההמתנה" : "הרשמה לשיעור"
        }
      >
        {pending && <ConfirmBody pending={pending} />}
        {pending?.action === "book" && pending.mode === "studio" && isFull(pending.item) && (
          <label className="checkbox-line" style={{ marginTop: ".75rem" }}>
            <input type="checkbox" checked={autoEnroll} onChange={(e) => setAutoEnroll(e.target.checked)} />
            <span>
              להירשם אוטומטית כשמתפנה מקום
              <span className="row-sub" style={{ display: "block" }}>
                ההרשמה תושלם מיד, והכניסה תירד מהכרטיסייה גם אם זה קורה סמוך לשיעור.
              </span>
            </span>
          </label>
        )}
        {actionError && <p className="notice notice--error" role="alert">{actionError}</p>}
        <div className="btn-row">
          <button
            type="button"
            className={`btn ${pending?.action === "cancel" ? "btn--danger" : "btn--primary"}`}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "רגע…"
              : pending?.action === "cancel"
                ? pending.item.my_status === "waitlist" ? "יציאה מהרשימה" : "ביטול ההרשמה"
                : pending && isFull(pending.item) && pending.mode === "studio" ? "הצטרפות לרשימה" : "הרשמה"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPending(null)} disabled={busy}>
            חזרה
          </button>
        </div>
      </Sheet>
    </main>
  );
}

const taken = (it: ScheduleItem) => it.booked_studio + (it.held_studio ?? 0);
const isFull = (it: ScheduleItem) => taken(it) >= it.max_participants;
const deadlinePassed = (it: ScheduleItem) => new Date(it.cancel_deadline).getTime() < Date.now();
const endTime = (it: ScheduleItem) => formatTime(new Date(new Date(it.starts_at).getTime() + it.duration_min * 60_000).toISOString());

function ConfirmBody({ pending }: { pending: Pending }) {
  const it = pending.item;
  const head = (
    <div className="confirm-head">
      <p className="confirm-title">{it.title}{pending.action === "book" && pending.mode === "zoom" ? " בזום" : ""}</p>
      <p className="confirm-when">{formatDay(it.starts_at)}, {formatTime(it.starts_at)}–{endTime(it)}</p>
    </div>
  );
  if (pending.action === "cancel") {
    if (it.my_status === "waitlist") return <>{head}<p className="quiet">היציאה מהרשימה לא משפיעה על הכרטיסייה.</p></>;
    return (
      <>
        {head}
        <p className="quiet">
          {deadlinePassed(it)
            ? "מועד הביטול ללא חיוב עבר, לכן הכניסה לא תחזור לכרטיסייה."
            : "הכניסה תחזור לכרטיסייה."}
        </p>
      </>
    );
  }
  if (pending.mode === "studio" && isFull(it)) {
    return (
      <>
        {head}
        <p>השיעור מלא. כשמתפנה מקום, מי שבתור מקבלים הודעה לפי הסדר, עם זמן קצוב להירשם.</p>
        <p className="quiet">כדי לא לפספס, אפשר להפעיל התראות בלשונית "הכרטיסייה".</p>
      </>
    );
  }
  return (
    <>
      {head}
      <p className="quiet">
        {deadlinePassed(it) ? "מועד הביטול ללא חיוב כבר עבר." : <>ביטול ללא חיוב עד {formatDeadline(it.cancel_deadline)}.</>}
      </p>
    </>
  );
}

/** שורת מושבים: עיגול לכל מקום בסטודיו, מלא = תפוס */
function Seats({ it }: { it: ScheduleItem }) {
  const max = it.max_participants;
  const used = Math.min(taken(it), max);
  const left = max - used;
  const mineSeat = it.my_status === "booked" && it.my_mode === "studio";
  const text = left > 0
    ? left === 1 ? "מקום אחד פנוי" : `${left} מקומות פנויים`
    : it.waitlist_count > 0 ? `מלא, ${it.waitlist_count} בהמתנה` : "מלא";
  return (
    <div className="seats">
      {max <= 14 && (
        <span className="seat-row" aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <span key={i} className={`seat${i < used ? " is-taken" : ""}${mineSeat && i === it.booked_studio - 1 ? " is-mine" : ""}`} />
          ))}
        </span>
      )}
      <span className={`seat-text${left === 0 ? " is-full" : ""}`}>
        {text}
        <span className="visually-hidden"> מתוך {max}</span>
      </span>
    </div>
  );
}

function ClassSlot({ item: it, onBook, onCancel, onChanged }: {
  item: ScheduleItem; onBook: (m: AttendMode) => void; onCancel: () => void; onChanged: () => void;
}) {
  const cancelled = it.status === "cancelled";
  const offer = it.my_status === "waitlist" && it.my_offer_expires_at && it.my_booking_id;
  const total = it.booked_studio + it.booked_zoom;
  const missing = it.min_participants - total;
  const mine = it.my_status;
  const titleId = `c-${it.session_id}`;
  const state = cancelled ? "cancelled" : offer ? "offer" : mine === "booked" ? "booked" : mine === "waitlist" ? "waitlist" : "open";

  return (
    <article className={`slot slot--${state}`} aria-labelledby={titleId}>
      <div className="slot-time">
        <span className="slot-start">{formatTime(it.starts_at)}</span>
        <span className="slot-end"><span className="visually-hidden">עד </span>{endTime(it)}</span>
      </div>
      <div className="slot-rail" aria-hidden="true"><span className="slot-node" /></div>
      <div className="slot-body">
        <div className="slot-head">
          <h3 className="slot-title" id={titleId}>{it.title}</h3>
          {cancelled ? <span className="tag tag--muted">בוטל</span>
            : offer ? <span className="tag tag--attention">התפנה מקום</span>
            : mine === "booked" ? <span className="tag tag--mine">{it.my_mode === "zoom" ? "ההרשמה שלך, בזום" : "ההרשמה שלך"}</span>
            : mine === "waitlist" ? <span className="tag tag--quiet">ברשימת ההמתנה</span>
            : mine === "late_cancel" ? <span className="tag tag--muted">בוטל מאוחר</span>
            : null}
        </div>

        {!cancelled && <Seats it={it} />}
        {!cancelled && it.zoom_enabled && !mine && <p className="slot-note">אפשר גם בזום</p>}
        {!cancelled && missing > 0 && !deadlinePassed(it) && !mine && <p className="slot-note">{missingText(missing)}</p>}

        {!cancelled && offer && (
          <OfferBox
            bookingId={it.my_booking_id!}
            title={it.title}
            expiresAt={it.my_offer_expires_at!}
            open={it.my_offer_open}
            cancelDeadline={it.cancel_deadline}
            onDone={onChanged}
          />
        )}

        {!cancelled && !offer && (mine === "booked" || mine === "waitlist") && (
          <div className="slot-actions">
            {mine === "booked" && (
              <span className="slot-note">
                {deadlinePassed(it) ? "מועד הביטול ללא חיוב עבר" : <>ביטול ללא חיוב עד {formatDeadline(it.cancel_deadline)}</>}
              </span>
            )}
            <button type="button" className="text-btn" onClick={onCancel}>
              {mine === "waitlist" ? "יציאה מהרשימה" : "ביטול"}
              <span className="visually-hidden"> של {it.title}</span>
            </button>
          </div>
        )}

        {!cancelled && !mine && (
          <div className="slot-actions">
            <button type="button" className={`btn btn--sm ${isFull(it) ? "btn--secondary" : "btn--primary"}`} onClick={() => onBook("studio")}>
              {isFull(it) ? "לרשימת ההמתנה" : "הרשמה"}
              <span className="visually-hidden"> ל{it.title} {formatTime(it.starts_at)}</span>
            </button>
            {it.zoom_enabled && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => onBook("zoom")}>
                בזום
                <span className="visually-hidden"> ל{it.title} {formatTime(it.starts_at)}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
