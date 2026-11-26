import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatMoney, METHOD_LABEL, timeAgo } from "../lib/format";
import type { PaymentMethod, PendingOrder } from "../lib/types";
import { Sheet, useAsk, useToast } from "../components/ui";

const METHODS: PaymentMethod[] = ["bit", "paybox", "cash", "transfer", "other"];

/** הזמנות מהאפליקציה שממתינות לתשלום. אישור פותח את הכרטיסייה. */
export function PendingOrders({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<PendingOrder[] | null>(null);
  const [confirming, setConfirming] = useState<PendingOrder | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bit");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ask = useAsk();

  const load = useCallback(() => {
    api.getPendingOrders().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  async function confirm() {
    if (!confirming) return;
    setBusy(true);
    try {
      await api.confirmOrder(confirming.id, method);
      toast(`התשלום נרשם, והכרטיסייה של ${confirming.full_name} פתוחה.`);
      setConfirming(null);
      load();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(o: PendingOrder) {
    if (!(await ask({ title: "ביטול הזמנה", message: `${o.full_name}: ${o.title}, ${formatMoney(o.amount_ils)}.`, confirm: "ביטול ההזמנה" }))) return;
    try {
      await api.cancelOrder(o.id);
      toast("ההזמנה בוטלה.");
      load();
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <section aria-labelledby="orders">
      <div className="section-title"><h2 id="orders">ממתינות לתשלום ({rows.length})</h2></div>
      <ul className="card row-list">
        {rows.map((o) => (
          <li key={o.id}>
            <div className="row-head">
              <strong>{o.full_name}</strong>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(o.amount_ils)}</span>
            </div>
            <p className="row-sub">{o.title}, {timeAgo(o.created_at)}</p>
            <div className="slot-actions">
              <button type="button" className="btn btn--sm btn--primary" onClick={() => { setMethod("bit"); setConfirming(o); }}>
                התשלום התקבל
              </button>
              {o.phone && (
                <a className="btn btn--sm btn--ghost" href={`https://wa.me/${o.phone.replace(/^\+/, "").replace(/^0/, "972")}`} target="_blank" rel="noopener noreferrer">
                  וואטסאפ
                </a>
              )}
              <button type="button" className="text-btn" onClick={() => cancel(o)}>ביטול</button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!confirming} onClose={() => !busy && setConfirming(null)} title="אישור תשלום">
        {confirming && (
          <>
            <div className="confirm-head">
              <p className="confirm-title">{confirming.full_name}</p>
              <p className="confirm-when">{confirming.title}, {formatMoney(confirming.amount_ils)}</p>
            </div>
            <fieldset className="field">
              <legend>איך שולם?</legend>
              <div className="choice-row">
                {METHODS.map((m) => (
                  <label key={m} className="choice">
                    <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
                    {METHOD_LABEL[m]}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="quiet">אחרי האישור הכרטיסייה נפתחת, והתוקף מתחיל מהיום.</p>
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy}>{busy ? "רגע…" : "אישור ופתיחת כרטיסייה"}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirming(null)} disabled={busy}>חזרה</button>
            </div>
          </>
        )}
      </Sheet>
    </section>
  );
}
