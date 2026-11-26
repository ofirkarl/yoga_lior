import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import type { ImportedBalance, Member } from "../lib/types";
import { Field, useAsk, useToast } from "../components/ui";
import { parseBalances, type Parsed } from "./migrationLogic";
export { downloadCsv, membersCsv } from "./migrationLogic";

const digits = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.startsWith("972") ? `0${d.slice(3)}` : d;
};

/** הצעת התאמה: אותו טלפון, או אותו שם מלא */
function suggest(b: ImportedBalance, members: Member[]): Member | undefined {
  return members.find((m) => m.status === "active" && b.phone && digits(m.phone) && digits(m.phone) === digits(b.phone))
      ?? members.find((m) => m.status === "active" && m.full_name.trim() === b.full_name.trim());
}

export function Migration({ members, onChanged }: { members: Member[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const ask = useAsk();
  const [text, setText] = useState("");
  const [balances, setBalances] = useState<ImportedBalance[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setBalances(await api.listBalances()); } catch (e) { toast(errorMessage(e)); setBalances([]); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const parsed = useMemo(() => parseBalances(text), [text]);
  const good = parsed.filter((p): p is Extract<Parsed, { ok: true }> => p.ok);
  const bad = parsed.filter((p): p is Extract<Parsed, { ok: false }> => !p.ok);
  const waiting = (balances ?? []).filter((b) => !b.claimed_by);
  const done = (balances ?? []).filter((b) => b.claimed_by);
  const active = members.filter((m) => m.status === "active");

  async function doImport() {
    setBusy(true);
    try {
      const r = await api.importBalances(good.map((g) => g.row));
      toast(`נוספו ${r.inserted} יתרות. ${r.claimed ? `${r.claimed} נקשרו מיד לחשבונות שכבר באפליקציה.` : ""}`);
      setText("");
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function claim(b: ImportedBalance, userId: string) {
    const m = members.find((x) => x.id === userId);
    if (!(await ask({ title: "שיוך יתרה", message: `${b.entries_left} כניסות, בתוקף עד ${formatDate(b.valid_until)}, יעברו ל${m?.full_name ?? "החשבון שנבחר"}.`, confirm: "שיוך" }))) return;
    try {
      await api.claimBalance(b.id, userId);
      toast(`היתרה שויכה ל${m?.full_name ?? "החשבון שנבחר"}.`);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  async function remove(b: ImportedBalance) {
    if (!(await ask({ title: "מחיקת יתרה", message: `למחוק את היתרה של ${b.full_name}? זה לא משפיע על אף כרטיסייה קיימת.`, confirm: "מחיקה", danger: true }))) return;
    try { await api.deleteBalance(b.id); await load(); } catch (e) { toast(errorMessage(e)); }
  }

  return (
    <div className="stack">
      <p>
        מעתיקים מארבוקס או מהמחברת שורה לכל מתאמן: <strong>שם, אימייל או טלפון, כניסות שנשארו, תוקף</strong>.
        אפשר להדביק ישר מאקסל.
      </p>
      <p className="row-sub">
        מי שמצטרפת עם Google באותו אימייל מקבלת את היתרה לבד ברגע האישור. התאמה לפי טלפון או שם מוצעת כאן, ואת מאשרת אותה,
        כי טלפון כל אחד יכול להקליד.
      </p>
      <Field label="רשימת היתרות" hint="לדוגמה: דנה כהן, dana@gmail.com, 3, 15/01/2027">
        {({ id, describedBy }) => (
          <textarea id={id} className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)}
                    aria-describedby={describedBy} style={{ direction: "rtl" }} />
        )}
      </Field>
      {parsed.length > 0 && (
        <div className="card" aria-live="polite">
          <p><strong>{good.length}</strong> שורות מוכנות{bad.length > 0 && <>, <strong>{bad.length}</strong> צריכות תיקון</>}</p>
          {bad.length > 0 && (
            <ul className="row-list">
              {bad.map((b, i) => <li key={i}><span className="row-sub">{b.line}</span><br /><span className="error">{b.reason}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <button type="button" className="btn btn--primary btn--block" disabled={busy || good.length === 0} onClick={doImport}>
        {busy ? "רגע…" : good.length ? `העברת ${good.length} יתרות` : "העברת יתרות"}
      </button>

      <h3>ממתינות לשיוך ({waiting.length})</h3>
      {balances === null ? <p className="row-sub">טוען…</p> : waiting.length === 0 ? (
        <p className="row-sub">אין יתרות שממתינות.</p>
      ) : (
        <ul className="row-list">
          {waiting.map((b) => {
            const s = suggest(b, members);
            const chosen = pick[b.id] ?? s?.id ?? "";
            return (
              <li key={b.id}>
                <div className="row-head">
                  <strong>{b.full_name}</strong>
                  <span className="row-sub">{b.entries_left} כניסות · עד {formatDate(b.valid_until)}</span>
                </div>
                <p className="row-sub">{b.email ?? b.phone}{s && ` · נראה כמו ${s.full_name}`}</p>
                <div className="btn-row" style={{ alignItems: "flex-end" }}>
                  <div className="field" style={{ flex: "2 1 12rem" }}>
                    <label htmlFor={`pick-${b.id}`} className="visually-hidden">שיוך של {b.full_name} לחשבון</label>
                    <select id={`pick-${b.id}`} className="select" value={chosen} onChange={(e) => setPick((p) => ({ ...p, [b.id]: e.target.value }))}>
                      <option value="">בחירת חשבון…</option>
                      {active.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.username}</option>)}
                    </select>
                  </div>
                  <button type="button" className="btn btn--secondary" disabled={!chosen} onClick={() => claim(b, chosen)}>שיוך</button>
                  <button type="button" className="btn btn--ghost" onClick={() => remove(b)}>מחיקה<span className="visually-hidden"> של {b.full_name}</span></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && <p className="row-sub">{done.length} יתרות כבר שויכו.</p>}
    </div>
  );
}

