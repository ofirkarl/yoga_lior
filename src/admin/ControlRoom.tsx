import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import {
  formatDate, formatDeadline, formatMoney, formatMonth, formatShortWhen, METHOD_LABEL, timeAgo,
} from "../lib/format";
import type { ActivityItem, Dashboard, DashboardSession } from "../lib/types";
import { Loading } from "../components/ui";

export type AdminTab = "room" | "members" | "classes";

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : "ערב טוב";
}

export function ControlRoom({ name, go }: { name: string; go: (t: AdminTab) => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setD(await api.getDashboard());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
    // רענון כל דקה, ובכל חזרה ללשונית
    const t = window.setInterval(load, 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  if (error && !d)
    return (
      <main id="main" className="page">
        <p className="notice notice--error" role="alert">{error}</p>
        <button type="button" className="btn btn--primary btn--block" onClick={load}>ניסיון נוסף</button>
      </main>
    );
  if (!d) return <Loading label="טוען את חדר הבקרה…" />;

  const now = Date.now();
  const low = d.upcoming.filter(
    (s) => s.status === "scheduled" && s.studio + s.zoom < s.min && new Date(s.cancel_deadline).getTime() > now,
  );
  const k = d.kpis;

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>{greeting()}{name ? `, ${name.split(" ")[0]}` : ""}</h1>
        <p>חדר הבקרה של הסטודיו · מתעדכן כל דקה</p>
      </div>

      {/* דברים שדורשים תשומת לב */}
      {(low.length > 0 || d.pending.length > 0) && (
        <section aria-labelledby="attn">
          <h2 id="attn" className="visually-hidden">דורש תשומת לב</h2>
          <ul className="alert-list">
            {low.map((s) => (
              <li key={s.session_id} className="alert-item">
                <span>
                  <strong>{formatShortWhen(s.starts_at)}, {s.title}: נרשמו {s.studio + s.zoom} מתוך מינימום {s.min}</strong>
                  ההחלטה אם לקיים: עד {formatDeadline(s.cancel_deadline)}
                </span>
              </li>
            ))}
            {d.pending.length > 0 && (
              <li className="alert-item alert-item--info">
                <span>
                  <strong>{d.pending.length === 1 ? "מתעניינת אחת ממתינה לאישור" : `${d.pending.length} מתעניינות ממתינות לאישור`}</strong>
                  <button type="button" className="link-btn" style={{ background: "none", border: 0, padding: 0, color: "var(--primary)", font: "inherit", fontWeight: 600, cursor: "pointer", minHeight: 44 }} onClick={() => go("members")}>
                    למעבר לאישור
                  </button>
                </span>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* מספרים */}
      <section aria-labelledby="kpis">
        <h2 id="kpis" className="visually-hidden">מספרים עיקריים</h2>
        <div className="kpi-grid">
          <Kpi value={String(k.active_members)} label="מתאמנות פעילות" onClick={() => go("members")} />
          <Kpi value={String(k.pending_members)} label="ממתינות לאישור" alert={k.pending_members > 0} onClick={() => go("members")} />
          <Kpi value={String(k.active_cards)} label="כרטיסיות בתוקף" />
          <Kpi value={formatMoney(k.revenue_month)} label="הכנסות החודש" />
          <Kpi value={String(k.visits_month)} label="כניסות החודש" />
          <Kpi value={String(k.classes_week)} label="שיעורים בשבוע הקרוב" onClick={() => go("classes")} />
        </div>
      </section>

      {/* השבוע הקרוב */}
      <section aria-labelledby="week">
        <div className="section-title">
          <h2 id="week">השבוע הקרוב</h2>
          <button type="button" className="link-btn" onClick={() => go("classes")}>לכל השיעורים</button>
        </div>
        <div className="card">
          {d.upcoming.length === 0 ? (
            <p className="empty">אין שיעורים בשבוע הקרוב.</p>
          ) : (
            <ul className="row-list">{d.upcoming.map((s) => <WeekRow key={s.session_id} s={s} />)}</ul>
          )}
        </div>
      </section>

      {/* כרטיסיות שנגמרות */}
      {d.expiring.length > 0 && (
        <section aria-labelledby="exp">
          <div className="section-title"><h2 id="exp">כרטיסיות שעומדות להיגמר</h2></div>
          <div className="card">
            <ul className="row-list">
              {d.expiring.map((e) => (
                <li key={e.entitlement_id}>
                  <div className="row-head">
                    <span className="member-name">{e.full_name || "ללא שם"}</span>
                    {e.phone && <a href={`tel:${e.phone}`} aria-label={`התקשרות אל ${e.full_name}`}>{e.phone}</a>}
                  </div>
                  <p className="row-sub">
                    {e.title} · {e.entries_left === null ? "ללא הגבלה" : e.entries_left === 1 ? "כניסה אחרונה" : `${e.entries_left} כניסות`} · עד {formatDate(e.valid_until)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* הכנסות */}
      <section aria-labelledby="rev">
        <div className="section-title"><h2 id="rev">הכנסות</h2></div>
        <div className="card">
          <RevenueBars months={d.revenue_months} />
          {d.revenue_by_method.length > 0 && (
            <p className="row-sub" style={{ marginTop: ".75rem" }}>
              החודש: {d.revenue_by_method.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${formatMoney(m.total)}`).join(" · ")}
            </p>
          )}
        </div>
      </section>

      {/* פעילות */}
      <section aria-labelledby="act">
        <div className="section-title"><h2 id="act">פעילות אחרונה</h2></div>
        <div className="card">
          {d.activity.length === 0 ? (
            <p className="empty">עוד אין פעילות.</p>
          ) : (
            <ul className="feed">{d.activity.map((a, i) => <FeedItem key={i} a={a} />)}</ul>
          )}
        </div>
      </section>
    </main>
  );
}

function Kpi({ value, label, alert, onClick }: { value: string; label: string; alert?: boolean; onClick?: () => void }) {
  const cls = `kpi${alert ? " kpi--alert" : ""}`;
  const body = (<><span className="kpi-value">{value}</span><span className="kpi-label">{label}</span></>);
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

function WeekRow({ s }: { s: DashboardSession }) {
  const total = s.studio + s.zoom;
  const cancelled = s.status === "cancelled";
  const pct = Math.min(100, Math.round((s.studio / s.max) * 100));
  const minPct = Math.min(100, Math.round((s.min / s.max) * 100));
  const lowNow = !cancelled && total < s.min;
  return (
    <li>
      <div className="row-head">
        <span><strong>{formatShortWhen(s.starts_at)}</strong> · {s.title}</span>
        <span className="row-sub">
          {cancelled ? "בוטל" : `${s.studio}/${s.max}${s.zoom ? ` + ${s.zoom} בזום` : ""}`}
        </span>
      </div>
      {!cancelled && (
        <>
          <div className="fill" role="img" aria-label={`${s.studio} מתוך ${s.max} מקומות בסטודיו, מינימום ${s.min}`}>
            <span className={`fill-bar${lowNow ? " fill-bar--low" : ""}`} style={{ width: `${pct}%` }} />
            <span className="fill-min" style={{ insetInlineStart: `${minPct}%` }} />
          </div>
          {(lowNow || s.waitlist > 0) && (
            <p className="row-sub">
              {lowNow && `חסרות ${s.min - total} למינימום`}
              {lowNow && s.waitlist > 0 && " · "}
              {s.waitlist > 0 && `${s.waitlist} ברשימת המתנה`}
            </p>
          )}
        </>
      )}
    </li>
  );
}

function RevenueBars({ months }: { months: { month: string; total: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.total));
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="row-sub">הכנסות לפי חודש, חצי שנה אחרונה</figcaption>
      <div className="bars" role="list">
        {months.map((m, i) => (
          <div key={m.month} role="listitem" className={`bar${i === months.length - 1 ? " bar--current" : ""}`}
               aria-label={`${formatMonth(m.month)}: ${formatMoney(m.total)}`}>
            <span className="bar-val" aria-hidden="true">{m.total ? formatMoney(m.total) : "–"}</span>
            <span className="bar-col" style={{ height: `${Math.round((m.total / max) * 100)}%` }} aria-hidden="true" />
            <span className="bar-label" aria-hidden="true">{formatMonth(m.month)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function FeedItem({ a }: { a: ActivityItem }) {
  let text: string;
  let dot = "";
  switch (a.kind) {
    case "booked": text = `${a.who} נרשמה ל${a.what}, ${formatShortWhen(a.when)}${a.mode === "zoom" ? " (זום)" : ""}`; break;
    case "waitlist": text = `${a.who} נכנסה לרשימת ההמתנה ל${a.what}, ${formatShortWhen(a.when)}`; break;
    case "cancelled": text = `${a.who} ביטלה את ${a.what}, ${formatShortWhen(a.when)}`; dot = " feed-dot--cancel"; break;
    case "late_cancel": text = `${a.who} ביטלה מאוחר את ${a.what}, ${formatShortWhen(a.when)} (הכניסה נוכתה)`; dot = " feed-dot--cancel"; break;
    case "payment": text = `${a.who} שילמה ${formatMoney(a.amount)} ב${METHOD_LABEL[a.method] ?? a.method}${a.what ? ` · ${a.what}` : ""}`; dot = " feed-dot--pay"; break;
    case "joined": text = `${a.who || "מתאמנת חדשה"} הצטרפה לאפליקציה`; break;
  }
  return (
    <li>
      <span className={`feed-dot${dot}`} aria-hidden="true" />
      <span>
        {text}
        <br />
        <span className="feed-time">{timeAgo(a.at)}</span>
      </span>
    </li>
  );
}
