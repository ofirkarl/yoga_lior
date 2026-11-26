import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { dayKey, formatDate } from "../lib/format";
import type { Entitlement, Profile } from "../lib/types";
import { Field, Loading, useToast } from "../components/ui";

export function MyCard({ profile, refreshKey, onProfileSaved }: { profile: Profile; refreshKey: number; onProfileSaved: () => void }) {
  const toast = useToast();
  const [ents, setEnts] = useState<Entitlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEnts(await api.getMyEntitlements());
    } catch (e) {
      setError(errorMessage(e));
      setEnts([]);
    }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const today = dayKey(new Date().toISOString());
  const active = (ents ?? []).filter((e) => e.status === "active" && e.valid_until >= today);
  const past = (ents ?? []).filter((e) => !active.includes(e));

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

  return (
    <main id="main" className="page">
      <div className="page-header">
        <h1>הכרטיסייה שלי</h1>
      </div>

      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {ents === null ? (
        <Loading />
      ) : active.length === 0 ? (
        <div className="card">
          <h2>אין כרגע כרטיסייה פעילה</h2>
          <p>כדי להירשם לשיעורים צריך כרטיסייה או שיעור בודד. אפשר לרכוש אצל ליאור.</p>
        </div>
      ) : (
        active.map((e) => <EntitlementCard key={e.id} e={e} today={today} />)
      )}

      {past.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>
            כרטיסיות קודמות ({past.length})
          </summary>
          <ul style={{ paddingInlineStart: "1.2rem", margin: ".5rem 0 0" }}>
            {past.map((e) => (
              <li key={e.id}>
                {e.title}, עד {formatDate(e.valid_until)}
                {e.status === "used_up" ? " · נוצלה" : " · פג תוקף"}
              </li>
            ))}
          </ul>
        </details>
      )}

      <h2 style={{ marginTop: "2rem" }}>הפרטים שלי</h2>
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

      <button type="button" className="btn btn--ghost btn--block" onClick={() => api.signOut()}>
        יציאה מהחשבון
      </button>
    </main>
  );
}

function EntitlementCard({ e, today }: { e: Entitlement; today: string }) {
  const daysLeft = Math.round((new Date(`${e.valid_until}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  const unlimited = e.entries_left === null;
  const pct = unlimited || !e.entries_total ? 100 : Math.round(((e.entries_left ?? 0) / e.entries_total) * 100);
  const lowEntries = !unlimited && (e.entries_left ?? 0) <= 1;
  const soon = daysLeft <= 7;

  return (
    <section className="card" aria-labelledby={`e-${e.id}`}>
      <h2 id={`e-${e.id}`}>{e.title}</h2>
      {unlimited ? (
        <p>ללא הגבלת כניסות</p>
      ) : (
        <>
          <p className="punch-count">
            <strong>{e.entries_left}</strong>
            <span>{e.entries_left === 1 ? "כניסה נשארה" : "כניסות נשארו"} מתוך {e.entries_total}</span>
          </p>
          <div className="meter" role="img" aria-label={`נשארו ${e.entries_left} מתוך ${e.entries_total} כניסות`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <p style={{ marginTop: ".75rem" }}>
        בתוקף עד <strong>{formatDate(e.valid_until)}</strong>
        {daysLeft >= 0 && daysLeft <= 30 && <> ({daysLeft === 0 ? "היום" : daysLeft === 1 ? "מחר" : `עוד ${daysLeft} ימים`})</>}
        {e.mode === "zoom" && " · לשיעורי זום"}
      </p>
      {(lowEntries || soon) && (
        <p className="notice notice--warn">
          {lowEntries && soon ? "הכרטיסייה כמעט נגמרה, וגם התוקף מתקרב." : lowEntries ? "הכרטיסייה כמעט נגמרה." : "התוקף מתקרב, כדאי לנצל את הכניסות."}
        </p>
      )}
    </section>
  );
}
