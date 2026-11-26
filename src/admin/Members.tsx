import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDate, formatMoney, METHOD_LABEL } from "../lib/format";
import type { Entitlement, HealthAnswers, Member, PaymentMethod, Product } from "../lib/types";
import { Field, Loading, Sheet, useToast } from "../components/ui";

const today = () => dayKey(new Date().toISOString());
const activeCards = (m: Member) => m.entitlements.filter((e) => e.status === "active" && e.valid_until >= today());

export function Members() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, p] = await Promise.all([api.listMembers(), api.listProducts()]);
      setMembers(m);
      setProducts(p);
    } catch (e) {
      setError(errorMessage(e));
      setMembers([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = members ?? [];
    return s ? list.filter((m) => [m.full_name, m.phone, m.email, m.username].some((v) => v?.toLowerCase().includes(s))) : list;
  }, [members, q]);
  const pending = filtered.filter((m) => m.status === "pending");
  const active = filtered.filter((m) => m.status === "active");
  const blocked = filtered.filter((m) => m.status === "blocked");
  const open = members?.find((m) => m.id === openId) ?? null;

  async function setStatus(m: Member, status: "active" | "blocked") {
    try {
      await api.setMemberStatus(m.id, status);
      toast(status === "active" ? `${m.full_name || "המתאמנת"} אושרה.` : `${m.full_name || "המתאמנת"} נחסמה.`);
      await load();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>מתאמנות</h1>
        <p>{members ? `${active.length} פעילות${pending.length ? ` · ${pending.length} ממתינות` : ""}` : " "}</p>
      </div>

      <div className="search">
        <Field label="חיפוש לפי שם, טלפון או אימייל">
          {({ id }) => <input id={id} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
      </div>

      <button type="button" className="btn btn--secondary btn--block" onClick={() => setCreating(true)}>
        מתאמנת חדשה בלי חשבון Google
      </button>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {members === null ? <Loading /> : (
        <>
          {pending.length > 0 && (
            <section aria-labelledby="pend">
              <div className="section-title"><h2 id="pend">ממתינות לאישור</h2></div>
              {pending.map((m) => (
                <article key={m.id} className="card" aria-labelledby={`p-${m.id}`}>
                  <h3 id={`p-${m.id}`} className="class-title">{m.full_name || "ללא שם"}</h3>
                  <p className="row-sub">{[m.email, m.phone].filter(Boolean).join(" · ") || "אין פרטי קשר"}</p>
                  <div className="btn-row">
                    <button type="button" className="btn btn--primary" onClick={() => setStatus(m, "active")}>
                      אישור<span className="visually-hidden"> של {m.full_name}</span>
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setOpenId(m.id)}>פרטים</button>
                  </div>
                </article>
              ))}
            </section>
          )}

          <section aria-labelledby="act">
            <div className="section-title"><h2 id="act">פעילות</h2></div>
            <div className="card">
              {active.length === 0 ? <p className="empty">{q ? "לא נמצאו מתאמנות." : "עוד אין מתאמנות פעילות."}</p> : (
                <ul className="row-list">
                  {active.map((m) => {
                    const cards = activeCards(m);
                    return (
                      <li key={m.id} style={{ padding: 0 }}>
                        <button type="button" className="member-btn" onClick={() => setOpenId(m.id)}>
                          <span className="member-name">{m.full_name || m.username || "ללא שם"}</span>
                          <span className="row-sub">
                            {cards.length === 0 ? "אין כרטיסייה" : cards.map((c) =>
                              `${c.entries_left ?? "∞"} כניסות · עד ${formatDate(c.valid_until)}`).join(" | ")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {blocked.length > 0 && (
            <details className="card">
              <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>חסומות ({blocked.length})</summary>
              <ul className="row-list">
                {blocked.map((m) => (
                  <li key={m.id} style={{ padding: 0 }}>
                    <button type="button" className="member-btn" onClick={() => setOpenId(m.id)}>
                      <span className="member-name">{m.full_name || "ללא שם"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Sheet open={!!open} onClose={() => setOpenId(null)} title={open?.full_name || open?.username || "מתאמנת"}>
        {open && <MemberDetail m={open} products={products} onChanged={load} onStatus={(s) => setStatus(open, s)} />}
        <button type="button" className="btn btn--ghost btn--block" style={{ marginTop: "1rem" }} onClick={() => setOpenId(null)}>סגירה</button>
      </Sheet>

      <Sheet open={creating} onClose={() => setCreating(false)} title="מתאמנת חדשה בלי Google">
        {creating && <CreateUser onDone={load} onClose={() => setCreating(false)} />}
      </Sheet>
    </main>
  );
}

function MemberDetail({ m, products, onChanged, onStatus }: {
  m: Member; products: Product[]; onChanged: () => Promise<void>; onStatus: (s: "active" | "blocked") => void;
}) {
  const toast = useToast();
  const [health, setHealth] = useState<{ answers: HealthAnswers; signed_at: string } | null | undefined>(undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(String(products[0]?.price_ils ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tempPw, setTempPw] = useState<string | null>(null);

  useEffect(() => {
    api.getHealthDeclaration(m.id).then(setHealth).catch(() => setHealth(null));
  }, [m.id]);

  const cards = m.entitlements.filter((e) => e.status === "active" && e.valid_until >= today());
  const old = m.entitlements.filter((e) => !cards.includes(e));

  async function pay(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.recordPayment({ userId: m.id, productId, method, amount: Number(amount), note: note || undefined });
      const p = products.find((x) => x.id === productId);
      toast(`נרשם תשלום של ${formatMoney(Number(amount))}. ${p?.name ?? "הכרטיסייה"} נפתחה.`);
      setNote("");
      await onChanged();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function adjust(ent: Entitlement, delta: number) {
    const reason = window.prompt(delta > 0 ? "למה מוסיפים כניסה? (נשמר ביומן)" : "למה מורידים כניסה? (נשמר ביומן)");
    if (!reason) return;
    try {
      await api.adjustEntitlement(ent.id, delta, null, reason);
      toast("הכרטיסייה עודכנה.");
      await onChanged();
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  async function reset() {
    if (!window.confirm("לאפס את הסיסמה? המתאמנת תנותק מכל המכשירים ותקבל סיסמה זמנית חדשה.")) return;
    try {
      setTempPw((await api.resetPassword(m.id)).temp_password);
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <p className="row-sub">
        {[m.phone && <a key="t" href={`tel:${m.phone}`}>{m.phone}</a>, m.email, m.username && `שם משתמש: ${m.username}`]
          .filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
      </p>

      <section aria-labelledby="cards-h">
        <h3 id="cards-h">כרטיסיות</h3>
        {cards.length === 0 && <p className="row-sub">אין כרטיסייה בתוקף.</p>}
        {cards.map((c) => (
          <div key={c.id} className="card" style={{ marginBottom: ".5rem" }}>
            <strong>{c.title}</strong>
            <p className="row-sub">{c.entries_left === null ? "ללא הגבלה" : `${c.entries_left} מתוך ${c.entries_total} כניסות`} · עד {formatDate(c.valid_until)}</p>
            {c.entries_left !== null && (
              <div className="btn-row">
                <button type="button" className="btn btn--ghost" onClick={() => adjust(c, 1)}>הוספת כניסה</button>
                <button type="button" className="btn btn--ghost" onClick={() => adjust(c, -1)} disabled={c.entries_left === 0}>הורדת כניסה</button>
              </div>
            )}
          </div>
        ))}
        {old.length > 0 && <p className="row-sub">{old.length} כרטיסיות קודמות</p>}
      </section>

      <form className="card stack" onSubmit={pay} aria-labelledby="pay-h">
        <h3 id="pay-h">רישום תשלום</h3>
        <p className="row-sub">לתשלום שהתקבל מחוץ לאפליקציה. תשלומי Grow נרשמים לבד.</p>
        <Field label="מוצר">
          {({ id }) => (
            <select id={id} className="select" value={productId} onChange={(e) => {
              setProductId(e.target.value);
              const p = products.find((x) => x.id === e.target.value);
              if (p) setAmount(String(p.price_ils));
            }}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price_ils)}</option>)}
            </select>
          )}
        </Field>
        <Field label="אמצעי תשלום">
          {({ id }) => (
            <select id={id} className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(["cash", "paybox", "bit", "transfer", "other"] as const).map((k) => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}
            </select>
          )}
        </Field>
        <Field label="סכום ששולם (₪)">
          {({ id }) => <input id={id} className="input input--ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="הערה (לא חובה)">
          {({ id }) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !productId || !(Number(amount) >= 0)}>
          {busy ? "רגע…" : "רישום ופתיחת הכרטיסייה"}
        </button>
      </form>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>
          הצהרת בריאות {health === undefined ? "" : health ? `· נחתמה ${formatDate(health.signed_at)}` : "· לא מולאה"}
        </summary>
        {health && <HealthView a={health.answers} />}
      </details>

      {tempPw && (
        <div className="notice notice--info">
          <p>סיסמה זמנית חדשה. כדאי להעביר אותה עכשיו, היא לא תוצג שוב:</p>
          <p className="secret">{tempPw}</p>
        </div>
      )}

      <div className="btn-row">
        {m.username && <button type="button" className="btn btn--ghost" onClick={reset}>איפוס סיסמה</button>}
        {m.status === "active"
          ? <button type="button" className="btn btn--danger" onClick={() => window.confirm(`לחסום את ${m.full_name}? היא לא תוכל להירשם לשיעורים.`) && onStatus("blocked")}>חסימה</button>
          : <button type="button" className="btn btn--primary" onClick={() => onStatus("active")}>{m.status === "pending" ? "אישור" : "ביטול חסימה"}</button>}
      </div>
    </div>
  );
}

const HEALTH_LABELS: [keyof HealthAnswers, string][] = [
  ["birth_date", "תאריך לידה"], ["practiced_before", "תרגלה יוגה בעבר"], ["practice_details", "פירוט"],
  ["back_joint_pain", "כאבי גב ומפרקים"], ["health_issue", "בעיה בריאותית"], ["regular_medication", "תרופות קבועות"],
  ["surgery", "הליך כירורגי"], ["menstrual_irregularity", "אי סדירות במחזור"], ["gynecological_issue", "בעיה גניקולוגית"],
  ["anything_else", "משהו נוסף"],
];

function HealthView({ a }: { a: HealthAnswers }) {
  return (
    <dl className="qa">
      {HEALTH_LABELS.filter(([k]) => a[k] !== "" && a[k] !== undefined).map(([k, label]) => (
        <div key={k}>
          <dt>{label}</dt>
          <dd>{k === "practiced_before" ? (a[k] === "yes" ? "כן" : "לא") : String(a[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

function CreateUser({ onDone, onClose }: { onDone: () => Promise<void>; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; temp_password: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.createUsernameUser({ username, full_name: fullName, phone }));
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result)
    return (
      <div className="stack">
        <p className="notice notice--ok">החשבון נוצר ומאושר. כדאי לשלוח את הפרטים עכשיו, הסיסמה לא תוצג שוב.</p>
        <p>שם משתמש:</p>
        <p className="secret">{result.username}</p>
        <p>סיסמה זמנית:</p>
        <p className="secret">{result.temp_password}</p>
        <p className="row-sub">בכניסה הראשונה המתאמנת תתבקש לבחור סיסמה משלה.</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>סיום</button>
      </div>
    );

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="שם מלא">
        {({ id }) => <input id={id} className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />}
      </Field>
      <Field label="שם משתמש" hint="באנגלית, לדוגמה michal.l">
        {({ id, describedBy }) => (
          <input id={id} className="input input--ltr" value={username} onChange={(e) => setUsername(e.target.value)}
                 aria-describedby={describedBy} autoCapitalize="off" spellCheck={false} required />
        )}
      </Field>
      <Field label="טלפון (לא חובה)">
        {({ id }) => <input id={id} className="input input--ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={busy || !username.trim() || fullName.trim().length < 2}>
          {busy ? "רגע…" : "יצירת חשבון"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>ביטול</button>
      </div>
    </form>
  );
}
