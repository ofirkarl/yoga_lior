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

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}
const todayLine = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long" });

export function Schedule({ onChanged, balance, name }: { onChanged?: () => void; balance?: ReactNode; name?: string }) {
  const toast = useToast();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
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

  const visibleDays = days.filter((k) => byDay.has(k));
  const current = sel && byDay.has(sel) ? sel : visibleDays[0] ?? null;
  const later = (items ?? []).filter((it) => current !== null && dayKey(it.starts_at) > current && it.status !== "cancelled").slice(0, 4);

  useEffect(() => {
    if (!current) return;
    stripRef.current?.querySelector<HTMLElement>(`[data-strip="${current}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  function openDay(k: string) {
    setSel(k);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
              ? "ההרשמה לרשימת ההמתנה נקלטה. כשיתפנה מזרן, היא תושלם אוטומטית."
              : "ההרשמה לרשימת ההמתנה נקלטה. כשיתפנה מזרן תגיע הודעה."
            : pending.mode === "zoom" ? `ההרשמה ל${pending.item.title} בזום נקלטה.` : "המזרן שלך שמור.",
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

  const rel = (k: string) => (k === today ? "היום" : k === addDays(today, 1) ? "מחר" : null);
  const book = (it: ScheduleItem, mode: AttendMode) => { setActionError(null); setAutoEnroll(false); setPending({ item: it, action: "book", mode }); };

  return (
    <main id="main" className="page page--schedule">
      <header className="hello">
        <div>
          <p className="hello-date">{todayLine.format(new Date())}</p>
          <h1>{greeting()}{name ? `, ${name.trim().split(/\s+/)[0]}` : ""}</h1>
        </div>
        {balance}
      </header>

      <nav className="day-strip" aria-label="בחירת יום">
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
                className={`day-chip${k === current ? " is-current" : ""}`}
                onClick={() => setSel(k)}
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
      ) : current === null ? (
        !loadError && <p className="empty">אין שיעורים פתוחים בחודש הקרוב.</p>
      ) : (
        <>
          <h2 className="day-heading" aria-live="polite">
            {rel(current) ? <>{rel(current)}<span className="day-heading-date">{formatDay(byDay.get(current)![0].starts_at)}</span></> : formatDay(byDay.get(current)![0].starts_at)}
          </h2>
          {byDay.get(current)!.map((it) => (
            <RoomCard
              key={it.session_id}
              item={it}
              onBook={(mode) => book(it, mode)}
              onCancel={() => { setActionError(null); setPending({ item: it, action: "cancel" }); }}
              onChanged={() => { load(); onChanged?.(); }}
            />
          ))}

          {later.length > 0 && (
            <section aria-labelledby="later" className="later">
              <h2 id="later" className="later-title">אחר כך</h2>
              <ul className="later-list">
                {later.map((it) => (
                  <li key={it.session_id}>
                    <span className="later-time">{formatTime(it.starts_at)}</span>
                    <span className="later-text">
                      <span className="later-name">{it.title} <span className="later-day">{shortDay.format(new Date(it.starts_at))}</span></span>
                      <MiniMats it={it} />
                    </span>
                    <button type="button" className={`btn btn--sm ${it.my_status === "booked" ? "btn--ghost" : "btn--primary"}`} onClick={() => openDay(dayKey(it.starts_at))}>
                      {it.my_status === "booked" ? "שלך" : "לחדר"}
                      <span className="visually-hidden">: {it.title}, {formatDay(it.starts_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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

/** שורת מזרנים קטנה: תפוסה במבט אחד */
function MiniMats({ it }: { it: ScheduleItem }) {
  const max = it.max_participants;
  const used = Math.min(taken(it), max);
  const mine = it.my_status === "booked" && it.my_mode === "studio";
  return (
    <span className="mini-mats" role="img" aria-label={used >= max ? `מלא, ${max} מתוך ${max}` : `${used} מתוך ${max} מזרנים תפוסים`}>
      {Array.from({ length: Math.min(max, 16) }, (_, i) => (
        <span key={i} className={`mini-mat${i < used ? (mine && i === used - 1 ? " is-mine" : " is-taken") : ""}`} />
      ))}
    </span>
  );
}

/** שיעור אחד: השעה, והחדר עם המזרנים. נוגעים במזרן פנוי כדי להירשם. */
function RoomCard({ item: it, onBook, onCancel, onChanged }: {
  item: ScheduleItem; onBook: (m: AttendMode) => void; onCancel: () => void; onChanged: () => void;
}) {
  const cancelled = it.status === "cancelled";
  const offer = it.my_status === "waitlist" && it.my_offer_expires_at && it.my_booking_id;
  const mine = it.my_status;
  const mineStudio = mine === "booked" && it.my_mode === "studio";
  const max = it.max_participants;
  const used = Math.min(taken(it), max);
  const others = used - (mineStudio ? 1 : 0);
  const free = max - used;
  const canPick = !cancelled && !mine;
  const missing = it.min_participants - (it.booked_studio + it.booked_zoom);
  const titleId = `c-${it.session_id}`;
  const freeText = cancelled ? "השיעור בוטל" : free === 0 ? (it.waitlist_count > 0 ? `מלא, ${it.waitlist_count} בהמתנה` : "כל המזרנים תפוסים") : free === 1 ? "מזרן אחד פנוי" : `${free} מזרנים פנויים`;

  return (
    <article className={`room-card${cancelled ? " is-cancelled" : ""}`} aria-labelledby={titleId}>
      <div className="room-head">
        <div>
          <p className="room-time">{formatTime(it.starts_at)}</p>
          <h3 className="room-title" id={titleId}>{it.title}</h3>
        </div>
        <p className="room-meta">
          <span>עד {endTime(it)}</span>
          <span>{freeText}</span>
        </p>
      </div>

      {!cancelled && (
        <div className="room" role="group" aria-label={`החדר: ${max} מזרנים, ${used} תפוסים`}>
          {Array.from({ length: max }, (_, i) => {
            if (i < others) return <span key={i} className="mat is-taken" aria-hidden="true" />;
            if (mineStudio && i === others) return <span key={i} className="mat is-mine">שלך</span>;
            return canPick ? (
              <button key={i} type="button" className="mat is-free" onClick={() => onBook("studio")} aria-label={`מזרן פנוי. הרשמה ל${it.title}, ${formatTime(it.starts_at)}`} />
            ) : (
              <span key={i} className="mat is-free" aria-hidden="true" />
            );
          })}
        </div>
      )}

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

      {!cancelled && !offer && mine === "booked" && (
        <div className="room-foot">
          <p className="room-status is-mine">
            {it.my_mode === "zoom" ? "ההרשמה שלך בזום" : "המזרן שלך שמור"}
            <span className="room-note">{deadlinePassed(it) ? "מועד הביטול ללא חיוב עבר" : <>ביטול ללא חיוב עד {formatDeadline(it.cancel_deadline)}</>}</span>
          </p>
          <button type="button" className="text-btn" onClick={onCancel}>ביטול<span className="visually-hidden"> של {it.title}</span></button>
        </div>
      )}

      {!cancelled && !offer && mine === "waitlist" && (
        <div className="room-foot">
          <p className="room-status">ברשימת ההמתנה<span className="room-note">כשיתפנה מזרן תגיע הודעה</span></p>
          <button type="button" className="text-btn" onClick={onCancel}>יציאה מהרשימה<span className="visually-hidden"> של {it.title}</span></button>
        </div>
      )}

      {!cancelled && mine === "late_cancel" && <p className="room-status">ההרשמה בוטלה אחרי מועד הביטול</p>}

      {canPick && (
        <div className="room-foot">
          {free > 0 ? (
            <p className="room-status">
              נוגעים במזרן פנוי כדי לתפוס מקום
              {missing > 0 && !deadlinePassed(it) && <span className="room-note">{missingText(missing)}</span>}
            </p>
          ) : (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => onBook("studio")}>
              להמתין למזרן<span className="visually-hidden"> ב{it.title} {formatTime(it.starts_at)}</span>
            </button>
          )}
          {it.zoom_enabled && (
            <button type="button" className="text-btn" onClick={() => onBook("zoom")}>
              הצטרפות בזום<span className="visually-hidden"> ל{it.title} {formatTime(it.starts_at)}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
