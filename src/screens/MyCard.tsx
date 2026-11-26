import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDate, formatMoney } from "../lib/format";
import type { Entitlement, Order, Profile, ShopProduct } from "../lib/types";
import { InstallHelpButton } from "../components/InstallGuide";
import { PushCard } from "../admin/PushCard";
import { Field, Loading, Sheet, useAsk, useToast } from "../components/ui";

/** "שבוע", "6 שבועות", "חודשיים" */
function validityText(days: number): string {
  if (days === 7) return "שבוע";
  if (days % 7 === 0) return `${days / 7} שבועות`;
  if (days === 30) return "חודש";
  if (days === 60) return "חודשיים";
  return `${days} ימים`;
}

function productDetail(p: ShopProduct): string {
  const entries = p.entries === null ? "ללא הגבלת כניסות" : p.entries === 1 ? "כניסה אחת" : `${p.entries} כניסות`;
  return `${entries}${p.mode === "zoom" ? " בזום" : ""}, בתוקף ${validityText(p.validity_days)}`;
}

function whatsappLink(phone: string, text: string): string {
  const intl = phone.replace(/^\+/, "").replace(/^0/, "972");
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

export function MyCard({ profile, refreshKey, onProfileSaved, onChanged }: {
  profile: Profile; refreshKey: number; onProfileSaved: () => void; onChanged?: () => void;
}) {
  const toast = useToast();
  const ask = useAsk();
  const [ents, setEnts] = useState<Entitlement[] | null>(null);
  const [shop, setShop] = useState<ShopProduct[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [phoneForPay, setPhoneForPay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState<ShopProduct | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [e, s, o, c] = await Promise.all([api.getMyEntitlements(), api.getShop(), api.getMyOrders(), api.getContactPhone()]);
      setEnts(e); setShop(s); setOrders(o); setPhoneForPay(c);
    } catch (e) {
      setError(errorMessage(e));
      setEnts((x) => x ?? []);
      setShop((x) => x ?? []);
    }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const today = dayKey(new Date().toISOString());
  const active = (ents ?? []).filter((e) => e.status === "active" && e.valid_until >= today);
  const past = (ents ?? []).filter((e) => !active.includes(e));
  const pending = orders.filter((o) => o.status === "pending");
  const history = orders.filter((o) => o.status !== "pending");

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateMyProfile({ full_name: name.trim(), phone: phone.trim() || null });
      toast("הפרטים נשמרו.");
      onProfileSaved();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function placeOrder() {
    if (!choosing) return;
    setBusy(true);
    try {
      const o = await api.createOrder(choosing.id);
      if (o.payment_url) {
        window.location.href = o.payment_url; // דף התשלום של Grow, כשיחובר
        return;
      }
      setPlaced(o);
      setChoosing(null);
      await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(o: Order) {
    if (!(await ask({ title: "ביטול ההזמנה", message: `${o.title}, ${formatMoney(o.amount_ils)}. אם כבר שילמת, כדאי לעדכן את ליאור.`, confirm: "ביטול ההזמנה" }))) return;
    try {
      await api.cancelOrder(o.id);
      toast("ההזמנה בוטלה.");
      await load();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  const payText = (o: Order) => `היי ליאור, הזמנתי באפליקציה: ${o.title} (${formatMoney(o.amount_ils)}). איך הכי נוח לשלם?`;

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>הכרטיסייה</h1>
      </div>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {ents === null ? (
        <Loading />
      ) : active.length === 0 ? (
        <section className="card ticket ticket--empty">
          <h2>אין כרגע כרטיסייה פעילה</h2>
          <p className="quiet" style={{ margin: 0 }}>כדי להירשם לשיעורים צריך כרטיסייה או שיעור בודד. אפשר לבחור למטה.</p>
        </section>
      ) : (
        active.map((e) => <Ticket key={e.id} e={e} today={today} />)
      )}

      {pending.map((o) => (
        <section key={o.id} className="card order-pending" aria-label={`הזמנה ממתינה: ${o.title}`}>
          <div className="row-head">
            <strong>{o.title}</strong>
            <span className="tag tag--attention">ממתינה לתשלום</span>
          </div>
          <p className="quiet" style={{ margin: ".25rem 0 0" }}>
            {formatMoney(o.amount_ils)}. הכרטיסייה תיפתח כשליאור תאשר שהתשלום התקבל.
          </p>
          <div className="slot-actions">
            {o.payment_url ? (
              <a className="btn btn--sm btn--primary" href={o.payment_url}>לתשלום</a>
            ) : phoneForPay ? (
              <a className="btn btn--sm btn--primary" href={whatsappLink(phoneForPay, payText(o))} target="_blank" rel="noopener noreferrer">
                תיאום תשלום בוואטסאפ
              </a>
            ) : null}
            <button type="button" className="text-btn" onClick={() => cancelOrder(o)}>ביטול ההזמנה</button>
          </div>
        </section>
      ))}

      <h2 className="section-heading">רכישה</h2>
      {shop === null ? null : shop.length === 0 ? (
        <p className="quiet">אין כרגע מוצרים לרכישה באפליקציה.</p>
      ) : (
        <ul className="shop">
          {shop.filter((p) => p.available).map((p) => (
            <li key={p.id}>
              <button type="button" className="shop-item" onClick={() => setChoosing(p)} disabled={!!p.pending_order}>
                <span className="shop-text">
                  <span className="shop-name">{p.name}</span>
                  <span className="shop-detail">{p.pending_order ? "יש הזמנה שממתינה לתשלום" : productDetail(p)}</span>
                </span>
                <span className="shop-price">{formatMoney(p.price_ils)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(past.length > 0 || history.length > 0) && (
        <details className="card history">
          <summary>היסטוריה</summary>
          <ul className="row-list">
            {history.map((o) => (
              <li key={o.id} className="row-head">
                <span>{o.title}<span className="row-sub" style={{ display: "block" }}>{formatDate(o.created_at)}</span></span>
                <span className="row-sub">{o.status === "paid" ? formatMoney(o.amount_ils) : "בוטלה"}</span>
              </li>
            ))}
            {past.map((e) => (
              <li key={e.id} className="row-head">
                <span>{e.title}<span className="row-sub" style={{ display: "block" }}>עד {formatDate(e.valid_until)}</span></span>
                <span className="row-sub">{e.status === "used_up" ? "נוצלה" : "פג תוקף"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h2 className="section-heading">הפרטים שלי</h2>
      <form className="card stack" onSubmit={save}>
        <Field label="שם מלא">
          {({ id }) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
        </Field>
        <Field label="טלפון" hint="כדי שליאור תוכל לעדכן אם שיעור מתבטל">
          {({ id, describedBy }) => (
            <input id={id} className="input input--ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-describedby={describedBy} />
          )}
        </Field>
        <button type="submit" className="btn btn--secondary btn--block" disabled={saving || name.trim().length < 2}>
          {saving ? "בשמירה…" : "שמירת הפרטים"}
        </button>
      </form>

      <PushCard audience="member" />

      <div style={{ marginBottom: "1rem" }}>
        <InstallHelpButton />
      </div>

      <button type="button" className="btn btn--ghost btn--block" onClick={() => api.signOut()}>
        יציאה מהחשבון
      </button>

      <Sheet open={!!choosing} onClose={() => !busy && setChoosing(null)} title="סיכום הזמנה">
        {choosing && (
          <>
            <div className="confirm-head">
              <p className="confirm-title">{choosing.name}</p>
              <p className="confirm-when">{productDetail(choosing)}</p>
            </div>
            <p className="order-total"><span>לתשלום</span><strong>{formatMoney(choosing.price_ils)}</strong></p>
            <p className="quiet">התוקף מתחיל ביום שהכרטיסייה נפתחת.</p>
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={placeOrder} disabled={busy}>{busy ? "רגע…" : "המשך לתשלום"}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setChoosing(null)} disabled={busy}>חזרה</button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={!!placed} onClose={() => setPlaced(null)} title="ההזמנה התקבלה">
        {placed && (
          <>
            <p>
              <strong>{placed.title}</strong>, {formatMoney(placed.amount_ils)}.
            </p>
            <p className="quiet">
              ליאור קיבלה הודעה על ההזמנה. אחרי שהתשלום יתקבל, הכרטיסייה תיפתח ותופיע כאן.
            </p>
            <div className="btn-row">
              {phoneForPay && (
                <a className="btn btn--primary" href={whatsappLink(phoneForPay, payText(placed))} target="_blank" rel="noopener noreferrer">
                  תיאום תשלום בוואטסאפ
                </a>
              )}
              <button type="button" className="btn btn--ghost" onClick={() => setPlaced(null)}>סגירה</button>
            </div>
          </>
        )}
      </Sheet>
    </main>
  );
}

/** הכרטיסייה עצמה: עיגול לכל כניסה, מלא = עוד זמין */
function Ticket({ e, today }: { e: Entitlement; today: string }) {
  const daysLeft = Math.round((new Date(`${e.valid_until}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  const unlimited = e.entries_left === null;
  const left = e.entries_left ?? 0;
  const total = e.entries_total ?? left;
  const soon = daysLeft <= 7;

  return (
    <section className="card ticket" aria-labelledby={`e-${e.id}`}>
      <h2 id={`e-${e.id}`} className="ticket-title">{e.title}</h2>
      {unlimited ? (
        <p className="ticket-count"><strong>∞</strong> ללא הגבלת כניסות</p>
      ) : (
        <>
          <p className="ticket-count">
            <strong>{left}</strong>
            <span>{left === 1 ? "כניסה נשארה" : "כניסות נשארו"}<span className="quiet"> מתוך {total}</span></span>
          </p>
          {total <= 20 && (
            <span className="punches" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => <span key={i} className={`punch${i < left ? " is-left" : ""}`} />)}
            </span>
          )}
        </>
      )}
      <p className="ticket-until">
        בתוקף עד {formatDate(e.valid_until)}
        {daysLeft >= 0 && daysLeft <= 14 && <span className={soon ? "ticket-soon" : undefined}> ({daysLeft === 0 ? "היום" : daysLeft === 1 ? "מחר" : `עוד ${daysLeft} ימים`})</span>}
        {e.mode === "zoom" && ", לשיעורי זום"}
      </p>
    </section>
  );
}
